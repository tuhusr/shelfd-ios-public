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

function getProfileSocialIds(kind) {
  if (isPreviewMode()) {
    return PREVIEW_COMMUNITY_USERS
      .filter(user => user.uid !== (profileViewingUser?.uid || 'preview-user'))
      .map(user => user.uid);
  }
  const profile = getActiveProfile() || {};
  const ids = new Set();
  const addIds = list => {
    if (!Array.isArray(list)) return;
    list.forEach(uid => {
      if (uid) ids.add(uid);
    });
  };

  /* v11438: This is a MUTUAL-friendship app — the only relationship the app
     actually maintains is the confirmed `friends` list, and "Followers" /
     "Following" are just Instagram-style presentations of that same mutual set
     (the code already folded `friends` into both). The legacy follow arrays
     (following / followingIds / follows / outgoingFollowing / followers /
     followerIds / followedBy / incomingFollowers) are NOT written by any current
     code path, and were the ONLY place a still-pending "requested to follow"
     entry could live — exactly what was leaking into a viewed user's public
     Following list (v11.207 + v11434 only stripped outgoingRequests, which the
     leaked entries were NOT in). Build BOTH lists from confirmed friends only,
     then defensively strip any pending uids. You can never see who someone is
     merely requesting to follow. (`kind` kept for API symmetry + mutual calc.) */
  addIds(profile.friends);
  if (!isViewingOtherProfile()) addIds(friends);
  excludePendingSocialIds(ids, profile);
  ids.delete(profile.uid);
  ids.delete(currentUser?.uid === profile.uid ? currentUser.uid : '');
  return [...ids];
}

/* v11378: pure social-id resolver for ANY profile object (not the active-state
   one). Mirrors the field set in getProfileSocialIds so counts shown on the
   friend-shelf banner match the followers/following page exactly. */
function getSocialIdsForProfile(profile, kind) {
  profile = profile || {};
  const ids = new Set();
  const add = list => { if (Array.isArray(list)) list.forEach(uid => { if (uid) ids.add(uid); }); };
  /* v11438: confirmed friends only (see getProfileSocialIds). Fold in the
     reconciled `friends` global for my OWN profile so my header counts stay
     accurate even if userProfile.friends lags the live state. */
  add(profile.friends);
  if (currentUser && profile.uid === currentUser.uid && typeof friends !== 'undefined' && Array.isArray(friends)) add(friends);
  excludePendingSocialIds(ids, profile);
  ids.delete(profile.uid);
  return [...ids];
}

/* v11378: open the followers/following/mutual page for a user whose shelf you're
   viewing (the counts under their banner name are tappable). Sets the profile
   viewing context so the social page reads the right user's arrays + @handle. */
function openShelfUserSocialPage(uid, kind) {
  const u = String(uid || '').trim();
  if (!u) return;
  let src = null;
  if (typeof viewingUser === 'object' && viewingUser && String(viewingUser.uid) === u) src = viewingUser;
  else if (typeof usersMap === 'object' && usersMap && usersMap[u]) src = usersMap[u];
  src = src || { uid: u };
  profileViewingUser = { uid: u, name: src.name || src.displayName || 'Friend', photo: src.photo || '' };
  profileViewingProfile = normalizeUserProfile({ ...src, uid: u });
  openProfileSocialModal(kind);
}

function renderProfileSocialCounts() {
  const host = document.querySelector('.profile-main-fields');
  if (!host) return;
  let row = document.getElementById('profile-social-counts');
  if (!row) {
    row = document.createElement('div');
    row.id = 'profile-social-counts';
    row.className = 'profile-social-counts';
    const bio = document.getElementById('profile-bio');
    if (bio?.parentElement === host) bio.insertAdjacentElement('afterend', row);
    else host.appendChild(row);
  }
  const followingCount = getProfileSocialIds('following').length;
  const followersCount = getProfileSocialIds('followers').length;
  /* v11.208: order is Followers (left) → Following (right) per request. */
  row.innerHTML = `
    <button type="button" class="profile-social-count" onclick="openProfileSocialModal('followers')">
      <strong>${followersCount.toLocaleString('en-US')}</strong>
      <span>Followers</span>
    </button>
    <button type="button" class="profile-social-count" onclick="openProfileSocialModal('following')">
      <strong>${followingCount.toLocaleString('en-US')}</strong>
      <span>Following</span>
    </button>
  `;
}

/* ===========================================================================
   v11367 — Followers / Following / Mutual as a FULL PAGE (Instagram-style).
   Replaces the old bottom sheet. Header = back chevron + the viewed user's
   @handle. Three tabs: mutual | followers | following. Each row = avatar +
   @username + display name, with a single Follow / Following button on the
   right; tapping the name/avatar opens that user's profile.
   =========================================================================== */
function getProfileMutualIds() {
  /* mutual = people connected to this profile (its followers ∪ following) that
     YOU also follow (your confirmed friends). */
  const union = new Set([...getProfileSocialIds('followers'), ...getProfileSocialIds('following')]);
  const mine = new Set(Array.isArray(friends) ? friends : []);
  const out = [];
  union.forEach(uid => { if (uid && mine.has(uid)) out.push(uid); });
  return out;
}
function getProfileSocialIdsForTab(kind) {
  return kind === 'mutual' ? getProfileMutualIds() : getProfileSocialIds(kind);
}
function normalizeProfileSocialTab(kind) {
  return (kind === 'mutual' || kind === 'followers' || kind === 'following') ? kind : 'followers';
}
function getProfileSocialUserHandle(user) {
  return String(
    user?.usernameHandle || user?.userHandle || user?.handle || user?.username ||
    user?.usernameHandleLower || user?.handleLower || user?.usernameLower || ''
  ).trim().replace(/^@+/, '');
}
function getProfileSocialTitleHandle() {
  const p = getActiveProfile() || {};
  const u = profileViewingUser || {};
  const h = getProfileSocialUserHandle(p) || getProfileSocialUserHandle(u);
  return h ? ('@' + h) : (p.name || u.name || 'Profile');
}

async function getProfileSocialUsers(kind) {
  const ids = getProfileSocialIdsForTab(kind);
  if (!ids.length) return [];
  if (isPreviewMode()) {
    return ids.map(uid => getPreviewCommunityUser(uid)).filter(Boolean);
  }
  const rows = await Promise.all(ids.map(async uid => {
    if (usersMap[uid]?.name) return usersMap[uid];
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return null;
      const user = { ...(snap.data() || {}), uid };
      usersMap[uid] = user;
      return user;
    } catch(e) {
      console.error('Profile social user load failed:', e);
      return usersMap[uid] || null;
    }
  }));
  return rows.filter(Boolean);
}

/* v11379: restore the underlying page scroll that was locked while the social
   page was open (see openProfileSocialModal). */
function restoreProfileSocialPageScroll(modal) {
  if (!modal) return;
  document.body.style.overflow = modal.dataset.prevBodyOverflow || '';
  document.documentElement.style.overflow = modal.dataset.prevHtmlOverflow || '';
}

function closeProfileSocialModal() {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  restoreProfileSocialPageScroll(modal);
  modal.classList.remove('profile-social-page-open');
  setTimeout(() => modal.remove(), 300);
}

function openProfileSocialUser(uid) {
  const u = String(uid || '').trim();
  closeProfileSocialModal();
  if (!u) return;
  /* v11436: tapping a name/avatar in the followers / following / mutual list
     opens that user's SHELF (My List) page — not their profile page.
     viewUserList already handles preview mode (community profile) and self
     (switches to your own My List) internally, so route everything through it. */
  if (typeof viewUserList === 'function') {
    const src = (typeof usersMap === 'object' && usersMap && usersMap[u]) ? usersMap[u] : {};
    viewUserList(u, src.name || src.displayName || '', src.photo || src.photoURL || '');
    return;
  }
  /* defensive fallback — original profile-page behavior */
  if (isPreviewMode()) { openPreviewUserProfile(u); return; }
  if (currentUser && u === currentUser.uid) { openProfile(); return; }
  openUserProfile(u);
}

/* v11381: open MY OWN followers/following/mutual page from the My List header.
   Clears any viewing context so getActiveProfile() resolves to my own profile. */
function openOwnSocialPage(kind) {
  profileViewingUser = null;
  profileViewingProfile = null;
  openProfileSocialModal(kind);
}

/* Kept for any external callers; the social rows now use the dedicated
   getProfileSocialFollowButtonHTML below. */
function getSocialRelationshipActionHTML(user) {
  if (!currentUser || !user?.uid || user.uid === currentUser.uid || isPreviewMode()) return '';
  const uid = user.uid;
  if (friends.includes(uid)) {
    return `<button type="button" class="friend-action-btn friend-pending-btn" disabled>Following</button>`;
  }
  if (outgoingRequests.includes(uid)) {
    return `<button type="button" class="friend-action-btn friend-pending-btn" onclick="event.stopPropagation(); cancelFriendRequest('${escAttr(uid)}')" title="Tap to cancel">Pending</button>`;
  }
  if (incomingRequests.includes(uid)) {
    return `<button type="button" class="friend-action-btn friend-accept-btn" onclick="event.stopPropagation(); acceptFriendRequest('${escAttr(uid)}')">Accept</button>`;
  }
  return `<button type="button" class="friend-action-btn friend-add-btn" onclick="event.stopPropagation(); sendFriendRequest('${escAttr(uid)}')">+ Follow</button>`;
}

/* Single right-side Follow / Following button (IG-style). Lavender for the
   actionable states, grayish once following / requested. */
function getProfileSocialFollowButtonHTML(user) {
  if (!currentUser || !user?.uid || user.uid === currentUser.uid || isPreviewMode()) return '';
  const uid = escAttr(user.uid);
  const u = user.uid;
  /* v11435: every state routes through the single optimistic handler
     toggleProfileSocialFollow (re-derives the action from live state). Keeps
     the card button instant + double-tap safe and consistent with the banner. */
  if (friends.includes(u)) {
    return `<button type="button" class="profile-social-follow-btn is-following" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Following</button>`;
  }
  if (outgoingRequests.includes(u)) {
    return `<button type="button" class="profile-social-follow-btn is-requested" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Requested</button>`;
  }
  if (incomingRequests.includes(u)) {
    return `<button type="button" class="profile-social-follow-btn is-followback" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Follow Back</button>`;
  }
  return `<button type="button" class="profile-social-follow-btn is-follow" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Follow</button>`;
}

/* ===========================================================================
   v11435 — Shared optimistic follow-state plumbing (Follow / Pending /
   Following). The relationship globals (friends / outgoingRequests /
   incomingRequests) are already mutated SYNCHRONOUSLY by the action fns
   (sendFriendRequest / cancelFriendRequest / acceptFriendRequest / removeFriend)
   BEFORE their network await, and rolled back on failure — so the UI can reflect
   the new state instantly and self-heal once the write resolves.

   syncFollowButtonsForUid repaints EVERY visible follow button for one uid (the
   shelf/profile banner + any social-list rows) IN PLACE. Nothing re-renders, the
   list never rebuilds, and scroll position is preserved.
   =========================================================================== */
function shelfdFollowBusySet() {
  if (!window._shelfdFollowBusy) window._shelfdFollowBusy = new Set();
  return window._shelfdFollowBusy;
}
function replaceProfileSocialRowBtn(row, html) {
  if (!row) return;
  const btn = row.querySelector('.profile-social-follow-btn');
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').trim();
  const fresh = tpl.content.firstElementChild;
  if (btn) { if (fresh) btn.replaceWith(fresh); else btn.remove(); }
  else if (fresh) row.appendChild(fresh);
}
function syncProfileSocialRowButtons(modal) {
  modal = modal || document.getElementById('profile-social-modal');
  if (!modal) return;
  modal.querySelectorAll('.profile-social-row[data-uid]').forEach(row => {
    const uid = row.getAttribute('data-uid');
    if (!uid) return;
    const user = (typeof usersMap === 'object' && usersMap && usersMap[uid]) ? usersMap[uid] : { uid };
    replaceProfileSocialRowBtn(row, getProfileSocialFollowButtonHTML(user));
  });
}
function syncFollowButtonsForUid(uid) {
  const u = String(uid || '').trim();
  if (!u) return;
  /* shelf / profile viewing-banner button (16-friends-requests.js) */
  if (typeof refreshFriendListFollowButton === 'function') refreshFriendListFollowButton(u);
  /* social-list rows — in place, no panel rebuild, scroll preserved */
  const modal = document.getElementById('profile-social-modal');
  if (modal) {
    modal.querySelectorAll('.profile-social-row[data-uid]').forEach(row => {
      if (row.getAttribute('data-uid') !== u) return;
      const user = (typeof usersMap === 'object' && usersMap && usersMap[u]) ? usersMap[u] : { uid: u };
      replaceProfileSocialRowBtn(row, getProfileSocialFollowButtonHTML(user));
    });
  }
}
/* Centralized tap handler for the social-list row Follow buttons. Optimistic,
   double-tap safe, and reconciles after the backend resolves — including the
   failure case, because the action fn rolls the globals back and we always
   repaint from the live globals. */
async function toggleProfileSocialFollow(uid) {
  const u = String(uid || '').trim();
  if (!u || !currentUser || u === currentUser.uid) return;
  if (typeof isPreviewMode === 'function' && isPreviewMode()) return;
  const busy = shelfdFollowBusySet();
  if (busy.has(u)) return;        // race / double-tap guard
  busy.add(u);
  let action = null;
  if (friends.includes(u)) action = (typeof removeFriend === 'function') ? removeFriend : null;
  else if (incomingRequests.includes(u)) action = (typeof acceptFriendRequest === 'function') ? acceptFriendRequest : null;
  else if (outgoingRequests.includes(u)) action = (typeof cancelFriendRequest === 'function') ? cancelFriendRequest : null;
  else action = (typeof sendFriendRequest === 'function') ? sendFriendRequest : null;
  let p = Promise.resolve();
  try { if (action) p = action(u) || Promise.resolve(); } catch (e) { p = Promise.reject(e); }
  /* action mutated the relationship globals synchronously → paint immediately */
  syncFollowButtonsForUid(u);
  try { await p; } catch (e) { console.warn('toggleProfileSocialFollow failed:', e); }
  busy.delete(u);
  /* reconcile against the confirmed (or rolled-back) state — no flicker */
  syncFollowButtonsForUid(u);
}

function renderProfileSocialLoadingState() {
  return `<div class="profile-social-state-card">
    <div class="profile-social-state-spinner" aria-hidden="true"></div>
    <p>Loading…</p>
  </div>`;
}

function renderProfileSocialEmptyState(kind) {
  const label = kind === 'mutual' ? 'mutual connections' : kind === 'followers' ? 'followers' : 'following';
  return `<div class="profile-social-state-card profile-social-state-empty">
    <p>No ${escHtml(label)} yet</p>
  </div>`;
}

function renderProfileSocialUserRow(user) {
  const name = user?.name || user?.displayName || 'ScreenList User';
  const photo = user?.photo || user?.photoURL || getProfileFallbackPhotoFor({ name });
  if (user?.uid) usersMap[user.uid] = { ...(usersMap[user.uid] || {}), ...user, uid: user.uid };
  const handle = getProfileSocialUserHandle(user);
  const primary = handle || name;
  const secondary = handle ? name : '';
  const uidAttr = escAttr(user.uid);
  return `<div class="profile-social-row" data-uid="${uidAttr}">
    <button type="button" class="profile-social-row-main" onclick="openProfileSocialUser('${uidAttr}')">
      <img class="profile-social-avatar" src="${escAttr(photo)}" alt="" decoding="async">
      <span class="profile-social-row-copy">
        <span class="profile-social-row-name">${escHtml(primary)}</span>
        ${secondary ? `<span class="profile-social-row-sub">${escHtml(secondary)}</span>` : ''}
      </span>
    </button>
    ${getProfileSocialFollowButtonHTML(user)}
  </div>`;
}

function updateProfileSocialTabCounts(modal) {
  if (!modal) return;
  const counts = {
    mutual: getProfileMutualIds().length,
    followers: getProfileSocialIds('followers').length,
    following: getProfileSocialIds('following').length
  };
  ['mutual', 'followers', 'following'].forEach(kind => {
    const el = modal.querySelector(`.profile-social-tab[data-kind="${kind}"] strong`);
    if (el) el.textContent = counts[kind].toLocaleString('en-US');
  });
}

const PROFILE_SOCIAL_TABS = ['mutual', 'followers', 'following'];

async function renderProfileSocialPanel(modal, kind) {
  if (!modal) return;
  const panel = modal.querySelector(`.profile-social-panel[data-kind="${kind}"]`);
  if (!panel) return;
  panel.innerHTML = renderProfileSocialLoadingState();
  const users = await getProfileSocialUsers(kind);
  const live = document.body.contains(modal) ? modal.querySelector(`.profile-social-panel[data-kind="${kind}"]`) : null;
  if (!live) return;
  if (!users.length) { live.innerHTML = renderProfileSocialEmptyState(kind); return; }
  live.innerHTML = users.map(renderProfileSocialUserRow).join('');
}

function renderAllProfileSocialPanels(modal) {
  PROFILE_SOCIAL_TABS.forEach(kind => { renderProfileSocialPanel(modal, kind); });
}

function updateProfileSocialActiveTab(modal, index) {
  if (!modal) return;
  const kind = PROFILE_SOCIAL_TABS[Math.max(0, Math.min(PROFILE_SOCIAL_TABS.length - 1, index))];
  modal.dataset.mode = kind;
  modal.querySelectorAll('.profile-social-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.kind === kind);
  });
}

function switchProfileSocialTab(kind) {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  const i = PROFILE_SOCIAL_TABS.indexOf(normalizeProfileSocialTab(kind));
  if (modal._socialPager) modal._socialPager.goTo(i, true);
  else updateProfileSocialActiveTab(modal, i);
}

async function refreshProfileSocialModal() {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  updateProfileSocialTabCounts(modal);
  /* v11435: was renderAllProfileSocialPanels(modal) — a full async refetch +
     innerHTML reset that flashed "Loading…" and snapped every panel back to the
     top whenever ANY follow action fired. Now we only repaint the existing rows'
     buttons in place, so scroll position and the rendered list are preserved.
     (Initial population still uses renderAllProfileSocialPanels in
     openProfileSocialModal; membership changes surface on next open.) */
  syncProfileSocialRowButtons(modal);
}

function openProfileSocialModal(kind) {
  const mode = normalizeProfileSocialTab(kind);
  const existing = document.getElementById('profile-social-modal');
  if (existing) existing.remove();
  const title = escHtml(getProfileSocialTitleHandle());
  const counts = {
    mutual: getProfileMutualIds().length,
    followers: getProfileSocialIds('followers').length,
    following: getProfileSocialIds('following').length
  };
  const tab = (k, lbl) =>
    `<button type="button" class="profile-social-tab${k === mode ? ' active' : ''}" data-kind="${k}" role="tab" onclick="switchProfileSocialTab('${k}')"><strong>${counts[k].toLocaleString('en-US')}</strong> ${lbl}</button>`;
  const panel = (k) => `<div class="profile-social-panel" data-kind="${k}" role="list">${renderProfileSocialLoadingState()}</div>`;
  const modal = document.createElement('div');
  modal.id = 'profile-social-modal';
  modal.dataset.mode = mode;
  modal.className = 'profile-social-page-overlay';
  modal.setAttribute('role', 'dialog');
  modal.innerHTML = `
    <div class="profile-social-page">
      <div class="profile-social-page-header">
        <button type="button" class="profile-social-page-back" onclick="closeProfileSocialModal()" aria-label="Back">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4 6 10l6.5 6"></path></svg>
        </button>
        <div class="profile-social-page-title">${title}</div>
        <span class="profile-social-page-spacer" aria-hidden="true"></span>
      </div>
      <div class="profile-social-tabs" role="tablist">
        ${tab('mutual', 'mutual')}${tab('followers', 'followers')}${tab('following', 'following')}
      </div>
      <div class="profile-social-pager">
        <div class="profile-social-track">
          ${panel('mutual')}${panel('followers')}${panel('following')}
        </div>
      </div>
    </div>`;
  /* v11379: lock the underlying page scroll while the social page is open.
     Without this, opening from a window-scrolling page (the friend SHELF) lets
     the page behind scroll on the swipe's vertical component, fighting the
     horizontal pager and making it hitchy. The profile page already uses a
     contained scroller so it was fine — this makes both entry points behave
     identically. Mirrors how the app's other full-screen overlays lock scroll. */
  modal.dataset.prevBodyOverflow = document.body.style.overflow || '';
  modal.dataset.prevHtmlOverflow = document.documentElement.style.overflow || '';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.body.appendChild(modal);
  /* v11375: drive the 3-tab pager with the shared instagramPageSwipe preset
     (assets/public/js/39-instagram-page-swipe.js) — the single source of truth
     for horizontal page swipes. Attaching also places the track on the opening
     tab (no animation). lockTarget = modal so the .horizontal-swipe-active scroll
     lock CSS keeps matching; edgeClose = modal so swiping right on the first tab
     slides the whole page off and removes it. */
  const pagerEl = modal.querySelector('.profile-social-pager');
  const trackEl = modal.querySelector('.profile-social-track');
  if (typeof attachInstagramPageSwipe === 'function' && pagerEl && trackEl) {
    modal._socialPager = attachInstagramPageSwipe(pagerEl, {
      track: trackEl,
      pageCount: PROFILE_SOCIAL_TABS.length,
      getIndex: () => PROFILE_SOCIAL_TABS.indexOf(normalizeProfileSocialTab(modal.dataset.mode)),
      onIndexChange: (i) => updateProfileSocialActiveTab(modal, i),
      duration: 450,
      lockTarget: modal,
      edgeCloseElement: modal,
      onEdgeClose: () => { restoreProfileSocialPageScroll(modal); if (modal.isConnected) modal.remove(); }
    });
  }
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('profile-social-page-open')));
  renderAllProfileSocialPanels(modal);
}


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

function renderProfileSettingsPage() {
  if (isViewingOtherProfile()) return;
  syncProfileSettingsSubpageState();
  bindProfileSettingsSubpageSwipeBack();
  renderProfileNotificationPreferenceRows();
  syncProfileSettingsPremiumVisibility();
  /* v812/v813: in-memory userProfile.themeMode is always 'true-dark'
     (resolveActiveThemeMode coerces). The "Default Theme" radio is the
     only selectable option; legacy radios stay in DOM hidden so their
     querySelector calls below don't crash on older code paths. */
  const themeMode = resolveActiveThemeMode(userProfile?.themeMode);
  const prefs = normalizeRatingPreferences(readProfileFromPage()?.ratingPreferences);
  const themeDefault  = document.getElementById('theme-mode-default');
  const themeLight    = document.getElementById('theme-mode-light');
  const themeTrueDark = document.getElementById('theme-mode-true-dark');
  const themeCream    = document.getElementById('theme-mode-cream');
  if (themeDefault)  { themeDefault.checked  = themeMode === 'true-dark'; }
  if (themeLight)    { themeLight.disabled = true;  themeLight.checked    = false; }
  if (themeTrueDark) { themeTrueDark.disabled = true; themeTrueDark.checked = false; }
  if (themeCream)    { themeCream.disabled = true;  themeCream.checked    = false; }
  const mediaTen = document.getElementById('rating-pref-media-ten');
  const mediaFive = document.getElementById('rating-pref-media-five');
  const gamesTen = document.getElementById('rating-pref-games-ten');
  const gamesFive = document.getElementById('rating-pref-games-five');
  /* v10.509: app-wide rating scale is forced to 5-star half-step (see
     `getRatingPreferenceForSection` in 04-shared-utils-data.js). Lock
     the settings UI to match — 5-star is always checked, 10-star is
     always disabled. The stored profile preference is left intact; only
     the visual control state is overridden. Mirror of the theme-mode
     pattern at line 2738-2741 above. */
  if (mediaTen) { mediaTen.checked = false; mediaTen.disabled = true; }
  if (mediaFive) { mediaFive.checked = true; mediaFive.disabled = true; }
  if (gamesTen) { gamesTen.checked = false; gamesTen.disabled = true; }
  if (gamesFive) { gamesFive.checked = true; gamesFive.disabled = true; }
  const animeTitleMode = getAnimeTitleDisplayMode(userProfile || {});
  const animeTitleEnglish = document.getElementById('anime-title-pref-english');
  const animeTitleRomaji = document.getElementById('anime-title-pref-romaji');
  const animeTitleJapanese = document.getElementById('anime-title-pref-japanese');
  if (animeTitleEnglish) animeTitleEnglish.checked = animeTitleMode === 'english';
  if (animeTitleRomaji) animeTitleRomaji.checked = animeTitleMode === 'romaji';
  if (animeTitleJapanese) animeTitleJapanese.checked = animeTitleMode === 'japanese';
}

function syncProfileSettingsSubpageState() {
  const settingsPage = document.getElementById('profile-settings-page');
  const accountCardsHost = document.getElementById('profile-settings-account-cards');
  if (accountCardsHost) {
    const order = ['username', 'displayname', 'password', 'data', 'danger'];
    [...document.querySelectorAll('[data-profile-account-card]')]
      .sort((a, b) => order.indexOf(a.dataset.profileAccountCard) - order.indexOf(b.dataset.profileAccountCard))
      .forEach(card => {
      if (card.parentElement !== accountCardsHost) accountCardsHost.appendChild(card);
    });
  }
  const openId = profileSettingsActiveSection ? `profile-settings-${profileSettingsActiveSection}-subpage` : '';
  document.querySelectorAll('.profile-settings-subpage').forEach(page => {
    const open = !!openId && page.id === openId;
    page.classList.toggle('is-open', open);
    page.setAttribute('aria-hidden', open ? 'false' : 'true');
  });
  if (settingsPage) settingsPage.classList.toggle('settings-subpage-open', !!profileSettingsActiveSection);
}

function clearProfileSettingsSubpageTransientState(cancelPending = true) {
  if (cancelPending) profileSettingsSubpageGestureEpoch += 1;
  document.querySelectorAll('.profile-settings-subpage').forEach(page => {
    page.classList.remove('profile-settings-subpage-dragging', 'profile-settings-subpage-snapping');
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.boxShadow = '';
    page.style.touchAction = '';
  });
}

function bindProfileSettingsSubpageSwipeBack(settingsPage = document.getElementById('profile-settings-page')) {
  if (!settingsPage || settingsPage.dataset.settingsSubpageSwipeBackBound === 'true') return;
  settingsPage.dataset.settingsSubpageSwipeBackBound = 'true';

  const EDGE_WIDTH = 54;
  const MIN_ARM_DISTANCE = 12;
  const DIRECTION_LOCK_RATIO = 1.45;
  const VERTICAL_CANCEL_RATIO = 1.12;
  const VELOCITY_CLOSE_PX_PER_MS = 0.72;
  const INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="button"]',
    '.profile-settings-premium-tabs',
    '.profile-notification-toggle-list'
  ].join(', ');

  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocityX = 0, viewportW = 0;
  let canSwipe = false, swiping = false, closing = false, pointerId = null, rafId = 0, pendingX = 0;
  let activePage = null;

  const getActiveSubpage = () => {
    if (!profileSettingsOpen || !profileSettingsActiveSection) return null;
    const page = document.getElementById(`profile-settings-${profileSettingsActiveSection}-subpage`);
    return page?.classList.contains('is-open') ? page : null;
  };
  const applyFrame = () => {
    rafId = 0;
    if (!activePage) return;
    const x = Math.max(0, Math.min(pendingX, viewportW || 390));
    activePage.style.transform = `translate3d(${x}px, 0, 0)`;
    activePage.style.boxShadow = '-18px 0 42px rgba(0,0,0,0.28)';
  };
  const scheduleFrame = () => { if (!rafId) rafId = requestAnimationFrame(applyFrame); };
  const clearFrame = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
  const reset = () => {
    clearFrame();
    if (activePage) {
      activePage.classList.remove('profile-settings-subpage-dragging', 'profile-settings-subpage-snapping');
      activePage.style.transition = '';
      activePage.style.transform = '';
      activePage.style.willChange = '';
      activePage.style.boxShadow = '';
      activePage.style.touchAction = '';
    }
    canSwipe = false;
    swiping = false;
    closing = false;
    pointerId = null;
    pendingX = 0;
    activePage = null;
  };
  const arm = () => {
    if (swiping || closing || !activePage) return;
    swiping = true;
    activePage.classList.add('profile-settings-subpage-dragging');
    activePage.style.transition = 'none';
    activePage.style.willChange = 'transform';
    activePage.style.touchAction = 'none';
  };
  const snapBack = () => {
    if (!activePage) {
      reset();
      return;
    }
    clearFrame();
    activePage.classList.add('profile-settings-subpage-snapping');
    activePage.style.transition = 'transform 0.22s cubic-bezier(0.2, 1, 0.3, 1), box-shadow 0.22s ease';
    activePage.style.transform = 'translate3d(0, 0, 0)';
    activePage.style.boxShadow = '';
    window.setTimeout(reset, 240);
  };
  const completeBack = () => {
    if (closing || !activePage) return;
    closing = true;
    const closeEpoch = ++profileSettingsSubpageGestureEpoch;
    clearFrame();
    activePage.classList.add('profile-settings-subpage-snapping');
    activePage.style.transition = 'transform 0.24s cubic-bezier(0.18, 0.92, 0.18, 1), box-shadow 0.22s ease';
    activePage.style.transform = 'translate3d(104%, 0, 0)';
    activePage.style.boxShadow = '-20px 0 44px rgba(0,0,0,0.12)';
    window.setTimeout(() => {
      if (closeEpoch !== profileSettingsSubpageGestureEpoch) {
        reset();
        return;
      }
      window.closeProfileSettingsSection?.();
      reset();
    }, 245);
  };
  const start = event => {
    activePage = getActiveSubpage();
    if (!activePage || closing) return;
    const point = event.touches?.[0] || event;
    if (!point) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.touches && event.touches.length !== 1) return;
    if (point.clientX > EDGE_WIDTH) return;
    if (event.target?.closest?.(INTERACTIVE_SELECTOR)) return;
    event.stopPropagation();
    startX = point.clientX;
    startY = point.clientY;
    lastX = startX;
    lastT = performance.now();
    velocityX = 0;
    viewportW = window.innerWidth || 390;
    canSwipe = true;
    swiping = false;
    pointerId = event.pointerId ?? null;
  };
  const move = event => {
    if (!canSwipe || !activePage) return;
    event.stopPropagation();
    const point = event.touches?.[0] || event;
    if (!point) return;
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (dx < 0) {
      reset();
      return;
    }
    if (!swiping) {
      if (dx > MIN_ARM_DISTANCE && absDx > absDy * DIRECTION_LOCK_RATIO) {
        arm();
        try { if (event.pointerId !== undefined) activePage.setPointerCapture?.(event.pointerId); } catch (e) {}
      } else if (absDy > absDx * VERTICAL_CANCEL_RATIO) {
        reset();
        return;
      } else {
        return;
      }
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocityX = (point.clientX - lastX) / dt;
    lastX = point.clientX;
    lastT = now;
    pendingX = Math.max(0, Math.min(viewportW, dx));
    scheduleFrame();
  };
  const end = event => {
    if (!canSwipe && !swiping) return;
    event.stopPropagation();
    const point = event.changedTouches?.[0] || event;
    const dx = point ? point.clientX - startX : pendingX;
    try { if (pointerId !== null) activePage?.releasePointerCapture?.(pointerId); } catch (e) {}
    if (swiping) {
      const shouldClose = dx >= viewportW * 0.28 || (dx > 54 && velocityX > VELOCITY_CLOSE_PX_PER_MS);
      shouldClose ? completeBack() : snapBack();
    } else {
      reset();
    }
  };

  if (window.PointerEvent) {
    settingsPage.addEventListener('pointerdown', start, { passive: true });
    settingsPage.addEventListener('pointermove', move, { passive: false });
    settingsPage.addEventListener('pointerup', end, { passive: true });
    settingsPage.addEventListener('pointercancel', reset, { passive: true });
  } else {
    settingsPage.addEventListener('touchstart', start, { passive: true });
    settingsPage.addEventListener('touchmove', move, { passive: false });
    settingsPage.addEventListener('touchend', end, { passive: true });
    settingsPage.addEventListener('touchcancel', reset, { passive: true });
  }
}

function syncProfileSettingsPremiumVisibility() {
  const premiumRow = document.getElementById('profile-settings-premium-row');
  if (premiumRow) premiumRow.hidden = !isOwnCreatorSettingsAccount();
  const customizationRow = document.getElementById('profile-settings-customization-row');
  if (customizationRow) customizationRow.hidden = !isOwnCreatorSettingsAccount();
}

window.openProfileSettingsSection = function(section = '') {
  const clean = String(section || '').trim();
  if ((clean === 'premium' || clean === 'customization') && !isOwnCreatorSettingsAccount()) return;
  if (!['account', 'premium', 'privacy', 'notifications', 'customization'].includes(clean)) return;
  clearProfileSettingsSubpageTransientState();
  profileSettingsActiveSection = clean;
  syncProfileSettingsSubpageState();
  const target = document.getElementById(`profile-settings-${clean}-subpage`);
  if (target) target.scrollTo({ top: 0, behavior: 'auto' });
  if (clean === 'notifications') renderProfileNotificationPreferenceRows();
  if (clean === 'account' && typeof renderProfileSettingsIdentityCards === 'function') {
    try { renderProfileSettingsIdentityCards(); } catch (_) {}
  }
};

window.closeProfileSettingsSection = function() {
  profileSettingsActiveSection = '';
  clearProfileSettingsSubpageTransientState();
  syncProfileSettingsSubpageState();
};

window.switchProfilePremiumTab = function(tab = '') {
  const clean = String(tab || '').trim();
  if (!clean) return;
  document.querySelectorAll('[data-premium-tab]').forEach(button => {
    const active = button.dataset.premiumTab === clean;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-premium-panel]').forEach(panel => {
    const active = panel.dataset.premiumPanel === clean;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
};

function renderProfileNotificationPreferenceRows() {
  const host = document.getElementById('profile-notification-toggle-list');
  if (!host) return;
  const prefs = normalizeNotificationPreferences(userProfile?.notificationPreferences);
  host.innerHTML = PROFILE_NOTIFICATION_PREF_CONFIG.map(item => `
    <label class="profile-notification-toggle-row" for="profile-notification-pref-${item.key}">
      <span class="profile-notification-toggle-copy">
        <strong>${escHtml(item.label)}</strong>
        <small>${escHtml(item.sub)}</small>
      </span>
      <span class="profile-notification-switch">
        <input type="checkbox" id="profile-notification-pref-${item.key}" ${prefs[item.key] !== false ? 'checked' : ''} onchange="handleProfileNotificationPreferenceChange('${escAttr(item.key)}', this.checked)">
        <span aria-hidden="true"></span>
      </span>
    </label>`).join('');
}

window.handleProfileNotificationPreferenceChange = async function(key = '', checked = true) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (isViewingOtherProfile()) return;
  const clean = String(key || '').trim();
  if (!PROFILE_NOTIFICATION_PREF_CONFIG.some(item => item.key === clean)) return;
  const next = normalizeNotificationPreferences(userProfile?.notificationPreferences);
  next[clean] = checked !== false;
  if (!userProfile) userProfile = normalizeUserProfile({ uid: currentUser?.uid });
  userProfile.notificationPreferences = next;
  renderProfileNotificationPreferenceRows();
  const saved = await saveProfileSettingsPatch({ notificationPreferences: next });
  if (saved && typeof showToast === 'function') {
    try { showToast('Notification setting saved'); } catch (_) {}
  }
};

window.isShelfdNotificationTypeEnabledForRecipient = async function(recipientUid = '', type = '') {
  const key = getNotificationPreferenceKeyForType(type);
  if (!key) return true;
  const uid = String(recipientUid || '').trim();
  if (!uid) return true;
  let profile = uid === String(currentUser?.uid || '').trim()
    ? userProfile
    : (typeof usersMap === 'object' && usersMap ? usersMap[uid] : null);
  if ((!profile || !profile.notificationPreferences) && typeof db !== 'undefined' && db) {
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) {
        profile = { uid, ...(snap.data() || {}) };
        if (typeof usersMap === 'object' && usersMap) usersMap[uid] = { ...(usersMap[uid] || {}), ...profile };
      }
    } catch (_) {}
  }
  const prefs = normalizeNotificationPreferences(profile?.notificationPreferences);
  return prefs[key] !== false;
};

window.sendProfilePasswordResetEmail = async function() {
  if (!currentUser || typeof firebase === 'undefined' || !firebase.auth) return;
  const email = String(currentUser.email || userProfile?.emailLower || userProfile?.accountEmailLower || '').trim();
  if (!email) {
    if (typeof showToast === 'function') showToast('No email is attached to this account');
    return;
  }
  try {
    await firebase.auth().sendPasswordResetEmail(email);
    if (typeof showToast === 'function') showToast('Password reset link sent');
  } catch (error) {
    console.warn('[settings] password reset failed:', error?.code || error?.message || error);
    if (typeof showToast === 'function') showToast('Could not send reset link');
  }
};

window.downloadShelfdAccountData = function() {
  if (!currentUser) return;
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      uid: currentUser.uid,
      email: currentUser.email || '',
      profile: userProfile || {},
      library: typeof cloneListData === 'function' ? cloneListData(data || {}) : (data || {}),
      friends: Array.isArray(friends) ? friends : []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shelfd-account-data-${currentUser.uid}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof showToast === 'function') showToast('Account data export prepared');
  } catch (error) {
    console.warn('[settings] account export failed:', error?.message || error);
    if (typeof showToast === 'function') showToast('Could not export account data');
  }
};

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
  document.body.classList.remove('profile-swipe-back-active');
}

function restoreFriendShelfAfterProfileClose(returnState = null) {
  const target = returnState?.user || null;
  if (!target?.uid) return false;
  if (!viewingUser || viewingUser.uid !== target.uid || !friendViewData) return false;

  const myListView = document.getElementById('mylist-view');
  if (myListView) {
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
    profilePage.style.transition = ''; profilePage.style.transform = ''; profilePage.style.willChange = ''; profilePage.style.boxShadow = '';
    profilePage.style.borderTopLeftRadius = ''; profilePage.style.borderBottomLeftRadius = ''; profilePage.style.touchAction = '';
  };
  const arm = () => {
    if (swiping || closing) return; swiping = true;
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
   v465: Top 3 Fictional Characters editor
   ----------------------------------------------------------------------------
   - Mobile/PWA-first centered modal (own overlay, not the legacy bottom-sheet).
   - Character name input.
   - Tavily web image search (worker route /api/tavily/character-image-search).
   - Upload from phone with 2:3 poster-shape crop (drag to reposition,
     pinch/slider to zoom, render to canvas at save).
   - Saves only the targeted slot's name + image; preserves all unrelated
     showcaseFavorites entries and other profile fields.
   ========================================================================== */

let profileCharacterEditorState = null;
let profileCharacterSearchSeq = 0;
let profileCharacterSearchTimer = null;

function getProfilePosterEditorStateFromCard(card) {
  const databaseMode = card?.classList?.contains('profile-db-slot');
  const section = databaseMode ? card.dataset.profileDbSection : card.dataset.manualSection;
  const config = getProfileFavoriteConfig(section) || { label: 'Profile Pick', shortLabel: 'Pick', namePlaceholder: 'Name' };
  const slotIndex = Number(databaseMode ? card.dataset.profileDbIndex || 0 : card.dataset.manualIndex || 0);
  const name = databaseMode ? (card.dataset.profileDbTitle || '').trim() : (card.dataset.manualName || '').trim();
  const image = databaseMode ? (card.dataset.profileDbImage || '').trim() : (card.dataset.manualImage || '').trim();
  return {
    mode: databaseMode ? 'database' : 'manual',
    section,
    config,
    slotIndex,
    name,
    image,
    rating: databaseMode ? (card.dataset.profileDbRating || '').trim() : (card.dataset.manualRating || '').trim(),
    searchQuery: name
  };
}

function getProfilePosterEditorSlotLabel(state = profileCharacterEditorState) {
  const label = state?.config?.shortLabel || state?.config?.label || 'Pick';
  return `${label} ${Number(state?.slotIndex || 0) + 1}`;
}

function getProfilePosterEditorNameLabel(state = profileCharacterEditorState) {
  if (state?.section === 'fictionalCharacters') return 'Character name';
  if (state?.section === 'musicArtists') return 'Artist name';
  return 'Name';
}

function getProfilePosterEditorNamePlaceholder(state = profileCharacterEditorState) {
  return state?.config?.namePlaceholder || (state?.section === 'musicArtists' ? 'Artist' : state?.section === 'directors' ? 'Director' : state?.section === 'actors' ? 'Actor' : 'Name');
}

function ensureProfileCharacterEditorOverlay() {
  let overlay = document.getElementById('profile-character-editor-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'profile-character-editor-overlay';
    overlay.className = 'profile-character-editor-overlay';
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeProfileCharacterEditor();
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function openProfileCharacterEditor(event, card) {
  if (isViewingOtherProfile() || !card) return;
  if (event) event.stopPropagation();
  const base = getProfilePosterEditorStateFromCard(card);
  profileCharacterEditorState = {
    ...base,
    card,
    pendingImage: null,
    pendingImageSource: '',
    cropState: null,
    searchResults: [],
    searchStatus: ''
  };
  document.documentElement.classList.add('profile-character-editor-open');
  document.body.classList.add('profile-character-editor-open');
  renderProfileCharacterEditor();
}

function closeProfileCharacterEditor() {
  const overlay = document.getElementById('profile-character-editor-overlay');
  if (overlay) overlay.classList.remove('open');
  clearTimeout(profileCharacterSearchTimer);
  profileCharacterEditorState = null;
  document.documentElement.classList.remove('profile-character-editor-open');
  document.body.classList.remove('profile-character-editor-open');
}

function renderProfileCharacterEditor() {
  const state = profileCharacterEditorState;
  if (!state) return;
  const overlay = ensureProfileCharacterEditorOverlay();
  const slotLabel = getProfilePosterEditorSlotLabel(state);
  const previewImage = state.pendingImage || state.image || '';
  const previewStyle = previewImage ? `style="background-image:url('${previewImage.replace(/'/g, "%27")}')"` : '';
  const hasName = !!state.name;
  const hasImage = !!previewImage;
  const cropPanel = state.cropState
    ? renderProfileCharacterCropPanel(state.cropState)
    : '';
  overlay.innerHTML = `
    <div class="profile-character-editor-modal" role="dialog" aria-modal="true" aria-label="Edit ${slotLabel}">
      <div class="profile-character-editor-head">
        <div class="profile-character-editor-title-wrap">
          <div class="profile-character-editor-kicker">${escHtml(state.config?.label || 'Profile Pick')}</div>
          <div class="profile-character-editor-title">${escHtml(slotLabel)}</div>
        </div>
        <button type="button" class="profile-character-editor-close" onclick="closeProfileCharacterEditor()" aria-label="Close">×</button>
      </div>

      <div class="profile-character-editor-body">
        <div class="profile-character-preview-row">
          <div class="profile-character-preview-poster ${hasImage ? '' : 'profile-character-preview-empty'}" ${previewStyle} aria-hidden="true">
            ${hasImage ? '' : `<span class="profile-character-preview-rank">${state.slotIndex + 1}</span>`}
          </div>
          <div class="profile-character-preview-meta">
            <label class="profile-character-field-label" for="profile-character-name-input">${escHtml(getProfilePosterEditorNameLabel(state))}</label>
            <input id="profile-character-name-input" class="profile-character-field-input" type="text" maxlength="30" placeholder="${escAttr(getProfilePosterEditorNamePlaceholder(state))}" value="${escAttr(state.name)}" autocomplete="off" oninput="handleProfileCharacterNameInput(this.value)">
          </div>
        </div>

        ${cropPanel || `
          <div class="profile-character-section">
            <div class="profile-character-section-head">
              <div class="profile-character-section-title">Search the web</div>
              <div class="profile-character-section-sub">Find an image from Tavily.</div>
            </div>
            <form class="profile-character-search-form" onsubmit="event.preventDefault(); runProfileCharacterImageSearch();">
              <input id="profile-character-search-input" class="profile-character-field-input" type="text" placeholder="Search ${escAttr(state.config?.shortLabel || state.config?.label || 'person')}..." value="${escAttr(state.searchQuery)}" autocomplete="off">
              <button type="submit" class="profile-character-search-btn">Search</button>
            </form>
            <div id="profile-character-search-results" class="profile-character-search-results" data-state="${state.searchStatus || 'idle'}">
              ${renderProfileCharacterSearchResultsHTML(state)}
            </div>
          </div>

          <div class="profile-character-section">
            <div class="profile-character-section-head">
              <div class="profile-character-section-title">Upload from your phone</div>
              <div class="profile-character-section-sub">Crop to a vertical poster.</div>
            </div>
            <label class="profile-character-upload-btn">
              <input type="file" accept="image/*" onchange="handleProfileCharacterUploadInput(this)" style="display:none">
              <span>Choose photo</span>
            </label>
          </div>
        `}
      </div>

      <div class="profile-character-editor-actions">
        ${(hasName || hasImage || state.pendingImage) ? '<button type="button" class="profile-character-editor-clear" onclick="clearProfileCharacterSlotFromEditor()">Clear slot</button>' : ''}
        <button type="button" class="profile-character-editor-save" onclick="saveProfileCharacterFromEditor()">Save</button>
      </div>
    </div>
  `;
  overlay.classList.add('open');
  if (!state.cropState) {
    /* v617: requestAnimationFrame keeps us inside the user-gesture context
       so iOS Safari raises the keyboard when the input auto-focuses. */
    requestAnimationFrame(() => {
      const input = document.getElementById('profile-character-name-input');
      if (input) {
        input.focus();
        /* Move cursor to end of existing value */
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    });
  }
}

function renderProfileCharacterSearchResultsHTML(state) {
  if (state.searchStatus === 'loading') {
    return '<div class="profile-character-search-empty">Searching…</div>';
  }
  if (state.searchStatus === 'error') {
    return `<div class="profile-character-search-empty">${escHtml(state.searchError || "Search failed. Try a different query.")}</div>`;
  }
  if (state.searchStatus === 'empty') {
    return '<div class="profile-character-search-empty">No image results. Try another search term.</div>';
  }
  if (!state.searchResults || !state.searchResults.length) {
    return '<div class="profile-character-search-empty">Search to see image results.</div>';
  }
  return `<div class="profile-character-search-grid">${state.searchResults.map((hit, i) => {
    const safeUrl = String(hit.imageUrl || '').replace(/'/g, "%27");
    return `<button type="button" class="profile-character-search-tile" data-character-search-index="${i}" onclick="selectProfileCharacterSearchResult(${i})" aria-label="Use this image">
      <img src="${escAttr(hit.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('button').classList.add('profile-character-search-tile-broken')">
    </button>`;
  }).join('')}</div>`;
}

function handleProfileCharacterNameInput(value) {
  if (!profileCharacterEditorState) return;
  const input = document.getElementById('profile-character-name-input');
  const next = String(value || '').slice(0, 30);
  if (input && input.value !== next) input.value = next;
  profileCharacterEditorState.name = next.trim();
}

async function runProfileCharacterImageSearch() {
  const state = profileCharacterEditorState;
  if (!state) return;
  const queryEl = document.getElementById('profile-character-search-input');
  const query = String(queryEl?.value || '').trim();
  if (!query) return;
  state.searchQuery = query;
  state.searchStatus = 'loading';
  state.searchResults = [];
  state.searchError = '';
  const resultsEl = document.getElementById('profile-character-search-results');
  if (resultsEl) {
    resultsEl.dataset.state = 'loading';
    resultsEl.innerHTML = renderProfileCharacterSearchResultsHTML(state);
  }
  const seq = ++profileCharacterSearchSeq;
  try {
    const res = await fetch('/api/tavily/character-image-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 9 })
    });
    if (seq !== profileCharacterSearchSeq || !profileCharacterEditorState) return;
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data?.results) ? data.results.slice(0, 9) : [];
    if (!res.ok || !results.length) {
      state.searchStatus = res.ok ? 'empty' : 'error';
      state.searchError = String(data?.error || (res.ok ? '' : 'Search failed.'));
      state.searchResults = [];
    } else {
      state.searchStatus = 'ready';
      state.searchResults = results;
    }
  } catch (error) {
    if (seq !== profileCharacterSearchSeq || !profileCharacterEditorState) return;
    state.searchStatus = 'error';
    state.searchError = 'Network error. Please try again.';
    state.searchResults = [];
  }
  const finalEl = document.getElementById('profile-character-search-results');
  if (finalEl) {
    finalEl.dataset.state = state.searchStatus;
    finalEl.innerHTML = renderProfileCharacterSearchResultsHTML(state);
  }
}

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

function selectProfileCharacterSearchResult(index) {
  const state = profileCharacterEditorState;
  if (!state) return;
  const hit = state.searchResults?.[index];
  if (!hit?.imageUrl) return;
  state.pendingImage = hit.imageUrl;
  state.pendingImageSource = 'search';
  renderProfileCharacterEditor();
}

/* v10.543: Account deletion — required by App Store guideline 5.1.1(v).
   Opens / closes a confirmation modal, then on confirm permanently
   deletes the user's Firestore profile doc AND the Firebase Auth
   account.  If Firebase throws `requires-recent-login` (credential
   older than the re-auth window) we sign them out and ask them to sign
   back in — on the next sign-in the deletion attempt can be retried. */

function getDeleteAccountSource(source = '') {
  const explicit = String(source || '').trim();
  if (explicit) return explicit;
  if (document.getElementById('shelfd-setup-page')?.classList.contains('is-open')) return 'onboarding';
  if (document.getElementById('shelfd-verify-page')?.classList.contains('is-open')) return 'verification';
  if (document.getElementById('shelfd-signup-page')?.classList.contains('is-open')) return 'signup';
  return 'settings';
}

function resetShelfdUiAfterAccountDeletion(message = '') {
  window.__shelfdSignupInProgress = false;
  try {
    if (typeof window.resetShelfdSetupDraftFieldsForAccountDeletion === 'function') {
      window.resetShelfdSetupDraftFieldsForAccountDeletion();
    } else {
      const setupUsername = document.getElementById('shelfd-setup-username');
      const setupDisplayName = document.getElementById('shelfd-setup-display-name');
      if (setupUsername) setupUsername.value = '';
      if (setupDisplayName) setupDisplayName.value = '';
    }
  } catch (_) {}
  try {
    if (typeof window.closeShelfdAuthPanelsForAccountDeletion === 'function') {
      window.closeShelfdAuthPanelsForAccountDeletion();
    }
    document.querySelectorAll('.shelfd-auth-page').forEach(page => {
      page.classList.remove('is-open');
      page.setAttribute('aria-hidden', 'true');
    });
    document.body.classList.remove('shelfd-auth-page-open');
  } catch (_) {}
  try { if (typeof stopFriendsDataListener === 'function') stopFriendsDataListener(); } catch (_) {}
  try { if (typeof stopWatchTogetherListener === 'function') stopWatchTogetherListener(); } catch (_) {}
  try { if (typeof resetFriendsDataState === 'function') resetFriendsDataState(); } catch (_) {}
  try { if (typeof setBottomNavVisibility === 'function') setBottomNavVisibility(false); } catch (_) {}
  try { document.body.classList.remove('profile-active', 'own-profile-active', 'viewing-other-user', 'viewing-other-profile'); } catch (_) {}
  try {
    currentUser = null;
    DOC_REF = null;
    userProfile = null;
    myData = null;
    ownDataCache = null;
    viewingUser = null;
    friendViewData = null;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
  } catch (_) {}
  try {
    const profilePage = document.getElementById('profile-page');
    if (profilePage) profilePage.style.display = 'none';
    const app = document.getElementById('app-container');
    if (app) app.style.display = 'none';
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'flex';
  } catch (_) {}
  try {
    if (window.location.pathname !== '/' || window.location.hash) {
      history.replaceState(null, '', window.location.origin + '/');
    }
  } catch (_) {}
  try {
    if (typeof showLandingPage === 'function') showLandingPage();
  } catch (_) {}
  if (message && typeof showToast === 'function') {
    try { showToast(message, { durationMs: 4200 }); } catch (_) {}
  }
}

function openDeleteAccountModal(source = '') {
  const modal = document.getElementById('delete-account-modal');
  if (modal) {
    modal.dataset.deleteSource = getDeleteAccountSource(source);
    modal.style.display = 'flex';
    setTimeout(() => {
      try { document.getElementById('delete-account-confirm-btn')?.focus?.({ preventScroll: true }); } catch (_) {}
    }, 30);
  }
}

function closeDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.dataset.deleteSource = '';
  }
  /* Re-enable the confirm button in case a previous attempt failed. */
  const btn = document.getElementById('delete-account-confirm-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
}

async function deleteAccountQuerySnapshot(snapshot, label) {
  if (!snapshot || snapshot.empty) return;
  const refs = [];
  snapshot.forEach(doc => refs.push(doc.ref));
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  console.info('[deleteAccount] deleted ' + refs.length + ' ' + label + ' document(s)');
}

async function getDeleteAccountProfileSnapshot(uid) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    return snap && snap.exists ? snap : null;
  } catch (err) {
    console.warn('[deleteAccount] could not read profile before cleanup:', err?.code || err?.message || err);
    return null;
  }
}

function collectDeleteAccountUsernameHandles(profileData = {}) {
  const handles = new Set();
  [
    profileData.usernameHandleLower,
    profileData.handleLower,
    profileData.usernameHandle,
    profileData.userHandle,
    profileData.username,
    userProfile?.usernameHandleLower,
    userProfile?.usernameHandle,
    userProfile?.userHandle,
    userProfile?.username
  ].forEach(value => {
    const clean = String(value || '').trim().replace(/^@+/, '').toLowerCase();
    if (clean) handles.add(clean);
  });
  return Array.from(handles);
}

async function deleteAccountUsernameClaims(uid, profileData = {}) {
  const usernamesRef = db.collection('usernames');
  const refsById = new Map();

  collectDeleteAccountUsernameHandles(profileData).forEach(handleLower => {
    refsById.set(handleLower, usernamesRef.doc(handleLower));
  });

  try {
    const ownedSnap = await usernamesRef.where('uid', '==', uid).get();
    ownedSnap.forEach(doc => refsById.set(doc.id, doc.ref));
  } catch (err) {
    console.warn('[deleteAccount] username lookup by uid failed:', err?.code || err?.message || err);
  }

  for (const [handleLower, ref] of refsById.entries()) {
    const snap = await ref.get();
    if (!snap.exists) continue;
    const ownerUid = String(snap.data()?.uid || '').trim();
    if (ownerUid && ownerUid !== uid) {
      console.warn('[deleteAccount] skipped username owned by another uid:', handleLower, ownerUid);
      continue;
    }
    await ref.delete();
    console.info('[deleteAccount] released username:', handleLower);
  }
}

function getDeleteAccountServerTimestamp() {
  try {
    return firebase.firestore.FieldValue.serverTimestamp();
  } catch (_) {
    return Date.now();
  }
}

function getDeleteAccountFieldDelete() {
  try {
    return firebase.firestore.FieldValue.delete();
  } catch (_) {
    return null;
  }
}

async function cleanupAccountSharedDmThreads(uid) {
  const snap = await db.collection('dmThreads').where('participantUids', 'array-contains', uid).get();
  await deleteAccountQuerySnapshot(snap, 'direct message thread');
}

async function cleanupAccountComments(uid) {
  const snap = await db.collection('comments').get();
  if (!snap || snap.empty) return;

  let changed = 0;
  const writes = [];
  snap.forEach(doc => {
    const data = doc.data() || {};
    const comments = Array.isArray(data.comments) ? data.comments : [];
    if (!comments.length) return;
    const nextComments = comments.filter(comment => String(comment?.uid || '').trim() !== uid);
    if (nextComments.length === comments.length) return;
    changed += comments.length - nextComments.length;
    writes.push({
      ref: doc.ref,
      data: {
        comments: nextComments,
        updatedAt: getDeleteAccountServerTimestamp()
      }
    });
  });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    writes.slice(i, i + 450).forEach(write => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
  if (changed) console.info('[deleteAccount] removed ' + changed + ' comment(s)');
}

async function cleanupAccountReports(uid) {
  const refs = new Map();
  const authoredSnap = await db.collection('reports').where('reportedBy', '==', uid).get();
  authoredSnap.forEach(doc => refs.set(doc.id, doc.ref));
  const targetSnap = await db.collection('reports').where('reportedUid', '==', uid).get();
  targetSnap.forEach(doc => refs.set(doc.id, doc.ref));
  if (!refs.size) return;
  const snapLike = {
    empty: false,
    forEach(callback) {
      refs.forEach(ref => callback({ ref }));
    }
  };
  await deleteAccountQuerySnapshot(snapLike, 'report');
}

function getDeleteAccountScrubbedInteractionPatch(data = {}, uid = '', options = {}) {
  const likes = Array.isArray(data.likes) ? data.likes : null;
  const replies = Array.isArray(data.replies) ? data.replies : null;
  if (!likes && !replies) return null;

  const patch = {};
  let changed = false;

  if (likes) {
    const nextLikes = likes.filter(likeUid => String(likeUid || '').trim() !== uid);
    if (nextLikes.length !== likes.length) {
      patch.likes = nextLikes;
      changed = true;
    }
  }

  if (replies) {
    const nextReplies = replies
      .filter(reply => String(reply?.uid || '').trim() !== uid)
      .map(reply => {
        if (!Array.isArray(reply?.likes)) return reply;
        const nextReplyLikes = reply.likes.filter(likeUid => String(likeUid || '').trim() !== uid);
        if (nextReplyLikes.length === reply.likes.length) return reply;
        changed = true;
        return { ...reply, likes: nextReplyLikes };
      });
    if (nextReplies.length !== replies.length) {
      patch.replies = nextReplies;
      changed = true;
    } else if (changed && !Object.prototype.hasOwnProperty.call(patch, 'replies')) {
      patch.replies = nextReplies;
    }
  }

  if (!changed) return null;
  if (options.includeUpdatedAt !== false) patch.updatedAt = getDeleteAccountServerTimestamp();
  return patch;
}

async function cleanupAccountFeedInteractionRefs(uid) {
  const snap = await db.collection('feed').get();
  if (!snap || snap.empty) return;

  const writes = [];
  snap.forEach(doc => {
    const patch = getDeleteAccountScrubbedInteractionPatch(doc.data() || {}, uid, { includeUpdatedAt: false });
    if (patch) writes.push({ ref: doc.ref, data: patch });
  });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    writes.slice(i, i + 450).forEach(write => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
  if (writes.length) console.info('[deleteAccount] scrubbed user interaction refs from ' + writes.length + ' feed doc(s)');
}

async function cleanupAccountAlbumCommunityRatings(uid) {
  const fieldDelete = getDeleteAccountFieldDelete();
  if (!fieldDelete) return;

  const snap = await db.collection('albumRatings').get();
  if (!snap || snap.empty) return;

  const writes = [];
  snap.forEach(doc => {
    const ratings = doc.data()?.ratings || {};
    if (!Object.prototype.hasOwnProperty.call(ratings, uid)) return;
    writes.push({
      ref: doc.ref,
      data: {
        ratings: { [uid]: fieldDelete },
        updatedAt: getDeleteAccountServerTimestamp()
      }
    });
  });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    writes.slice(i, i + 450).forEach(write => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
  if (writes.length) console.info('[deleteAccount] removed album rating entry from ' + writes.length + ' community doc(s)');
}

async function cleanupAccountMetaInteractionRefs(uid) {
  const snap = await db.collection('meta').get();
  if (!snap || snap.empty) return;

  const writes = [];
  snap.forEach(doc => {
    const patch = getDeleteAccountScrubbedInteractionPatch(doc.data() || {}, uid);
    if (patch) writes.push({ ref: doc.ref, data: patch });
  });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    writes.slice(i, i + 450).forEach(write => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }
  if (writes.length) console.info('[deleteAccount] scrubbed user interaction refs from ' + writes.length + ' meta doc(s)');
}

async function runDeleteAccountCleanupStep(label, task, failures) {
  try {
    await task();
  } catch (err) {
    failures.push(label);
    console.warn('[deleteAccount] ' + label + ' cleanup failed:', err?.code || err?.message || err);
  }
}

async function cleanupAccountOwnedFirestoreData(user, options = {}) {
  const uid = String(user?.uid || '').trim();
  if (!uid) return;
  const failures = [];
  const isOnboardingDelete = !!options.isOnboardingDelete;
  const profileSnap = await getDeleteAccountProfileSnapshot(uid);
  const profileData = profileSnap?.data?.() || {};

  await runDeleteAccountCleanupStep('username claims', () => deleteAccountUsernameClaims(uid, profileData), failures);
  await runDeleteAccountCleanupStep('watchlist sections', async () => {
    const sectionsSnap = await db.collection('watchlist').doc(uid).collection('sections').get();
    await deleteAccountQuerySnapshot(sectionsSnap, 'watchlist section');
  }, failures);
  await runDeleteAccountCleanupStep('watchlist parent', () => db.collection('watchlist').doc(uid).delete(), failures);
  await runDeleteAccountCleanupStep('feed posts', async () => {
    const feedSnap = await db.collection('feed').where('uid', '==', uid).get();
    await deleteAccountQuerySnapshot(feedSnap, 'feed');
  }, failures);
  await runDeleteAccountCleanupStep('feed interactions', () => cleanupAccountFeedInteractionRefs(uid), failures);
  await runDeleteAccountCleanupStep('activity posts', async () => {
    const activitiesSnap = await db.collection('activities').where('uid', '==', uid).get();
    await deleteAccountQuerySnapshot(activitiesSnap, 'activity');
  }, failures);
  await runDeleteAccountCleanupStep('notifications', async () => {
    const notificationsSnap = await db.collection('notifications').doc(uid).collection('items').get();
    await deleteAccountQuerySnapshot(notificationsSnap, 'notification');
  }, failures);
  const sharedCleanupFailures = isOnboardingDelete ? [] : failures;
  await runDeleteAccountCleanupStep('direct message threads', () => cleanupAccountSharedDmThreads(uid), sharedCleanupFailures);
  await runDeleteAccountCleanupStep('comments', () => cleanupAccountComments(uid), sharedCleanupFailures);
  await runDeleteAccountCleanupStep('reports', () => cleanupAccountReports(uid), sharedCleanupFailures);
  await runDeleteAccountCleanupStep('album community ratings', () => cleanupAccountAlbumCommunityRatings(uid), sharedCleanupFailures);
  await runDeleteAccountCleanupStep('meta interactions', () => cleanupAccountMetaInteractionRefs(uid), sharedCleanupFailures);
  if (isOnboardingDelete && sharedCleanupFailures.length) {
    console.warn('[deleteAccount] onboarding shared cleanup was best-effort and did not block Auth deletion:', sharedCleanupFailures);
  }
  await runDeleteAccountCleanupStep('user profile', async () => {
    if (profileSnap) await profileSnap.ref.delete();
    else await db.collection('users').doc(uid).delete();
  }, failures);

  if (failures.length) {
    const error = new Error('Firestore account cleanup failed: ' + failures.join(', '));
    error.code = 'firestore/account-cleanup-failed';
    error.failures = failures;
    throw error;
  }
}

async function confirmDeleteAccount() {
  const user = auth.currentUser;
  if (!user) {
    closeDeleteAccountModal();
    resetShelfdUiAfterAccountDeletion();
    return;
  }

  const modal = document.getElementById('delete-account-modal');
  const deleteSource = String(modal?.dataset?.deleteSource || getDeleteAccountSource()).trim();
  const isOnboardingDelete = deleteSource === 'onboarding' || deleteSource === 'verification' || deleteSource === 'signup';
  const btn = document.getElementById('delete-account-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

  try {
    /* 1. Wipe Firestore first. If any cleanup step fails, stop before Auth
       deletion so we do not strand account data behind an unreachable UID. */
    await cleanupAccountOwnedFirestoreData(user, { isOnboardingDelete });

    /* 2. Delete the Firebase Auth account. */
    await user.delete();

    /* 3. Success: sign out fully and land back on the login screen. */
    closeDeleteAccountModal();
    try { await auth.signOut(); } catch (_) {}
    resetShelfdUiAfterAccountDeletion(isOnboardingDelete
      ? 'Account deleted. You can start again anytime.'
      : 'Account deleted.');

  } catch (err) {
    console.error('[deleteAccount] error:', err);

    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }

    if (err.code === 'auth/requires-recent-login') {
      /* Credential too old — sign them out. Next sign-in refreshes it
         and they can retry deletion. */
      closeDeleteAccountModal();
      try { await auth.signOut(); } catch (_) {}
      resetShelfdUiAfterAccountDeletion();
      if (typeof showToast === 'function') {
        showToast('Please sign in again to complete account deletion.', { durationMs: 5000 });
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('Could not delete account. Please try again.', { durationMs: 4000 });
      }
    }
  }
}

function handleProfileCharacterUploadInput(input) {
  const state = profileCharacterEditorState;
  if (!state) return;
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = String(e.target?.result || '');
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      // Init crop state — fit image into 2:3 frame (cover), centered, scale=1.
      // Drag/zoom adjust translate + scale. Save renders to 600×900 canvas.
      const aspect = 2 / 3;
      const frameW = 1, frameH = 1 / aspect; // unit space; we use pixels at render
      // Compute base scale so the image covers the frame at scale=1
      const imgRatio = img.width / img.height;
      // We treat the frame as 600×900 in pixel space.
      const FRAME_W = 600;
      const FRAME_H = 900;
      let baseScale;
      if (imgRatio > (FRAME_W / FRAME_H)) {
        // Image wider than frame relative to height — scale so height fills
        baseScale = FRAME_H / img.height;
      } else {
        baseScale = FRAME_W / img.width;
      }
      state.cropState = {
        dataUrl,
        img,
        FRAME_W,
        FRAME_H,
        baseScale,
        zoom: 1,           // user-adjustable multiplier on top of baseScale
        offsetX: 0,        // translation in frame pixels
        offsetY: 0,
        minZoom: 1,
        maxZoom: 4
      };
      renderProfileCharacterEditor();
      // After re-render, attach drag handlers and clamp.
      requestAnimationFrame(() => {
        installProfileCharacterCropInteractions();
      });
    };
    img.onerror = () => { showToast?.('Could not read image.'); };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
  // reset input so the same file can be re-selected
  try { input.value = ''; } catch (e) {}
}

function renderProfileCharacterCropPanel(crop) {
  return `
    <div class="profile-character-section">
      <div class="profile-character-section-head">
        <div class="profile-character-section-title">Adjust crop</div>
        <div class="profile-character-section-sub">Drag to reposition. Use the slider to zoom.</div>
      </div>
      <div class="profile-character-crop-stage" id="profile-character-crop-stage" data-character-crop-stage>
        <img class="profile-character-crop-image" id="profile-character-crop-image" src="${escAttr(crop.dataUrl)}" alt="" draggable="false">
        <div class="profile-character-crop-mask" aria-hidden="true"></div>
      </div>
      <div class="profile-character-crop-controls">
        <input id="profile-character-crop-zoom" class="profile-character-crop-zoom" type="range" min="1" max="4" step="0.01" value="${crop.zoom}" oninput="handleProfileCharacterCropZoom(this.value)">
        <div class="profile-character-crop-buttons">
          <button type="button" class="profile-character-editor-clear" onclick="cancelProfileCharacterCrop()">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function applyProfileCharacterCropTransform() {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const imgEl = document.getElementById('profile-character-crop-image');
  if (!imgEl) return;
  const crop = state.cropState;
  // Frame DOM size (CSS px). The transform is computed in CSS-px space using
  // the ratio of CSS-px to FRAME_H to keep behaviour proportional.
  const stage = document.getElementById('profile-character-crop-stage');
  if (!stage) return;
  const stageH = stage.clientHeight || 1;
  const cssScale = stageH / crop.FRAME_H;
  const finalScale = crop.baseScale * crop.zoom * cssScale;
  imgEl.style.transformOrigin = '0 0';
  imgEl.style.width = `${crop.img.width}px`;
  imgEl.style.height = `${crop.img.height}px`;
  imgEl.style.transform = `translate3d(${crop.offsetX * cssScale}px, ${crop.offsetY * cssScale}px, 0) scale(${finalScale})`;
}

function clampProfileCharacterCropOffsets() {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const crop = state.cropState;
  const scaledW = crop.img.width * crop.baseScale * crop.zoom;
  const scaledH = crop.img.height * crop.baseScale * crop.zoom;
  // Image (in FRAME pixel space) must always cover [0..FRAME_W] x [0..FRAME_H].
  // Offset is the top-left corner of the image inside the frame (FRAME px).
  const minX = crop.FRAME_W - scaledW;
  const maxX = 0;
  const minY = crop.FRAME_H - scaledH;
  const maxY = 0;
  crop.offsetX = Math.min(maxX, Math.max(minX, crop.offsetX));
  crop.offsetY = Math.min(maxY, Math.max(minY, crop.offsetY));
}

function installProfileCharacterCropInteractions() {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const stage = document.getElementById('profile-character-crop-stage');
  if (!stage) return;
  // Center the image initially
  const crop = state.cropState;
  const scaledW = crop.img.width * crop.baseScale * crop.zoom;
  const scaledH = crop.img.height * crop.baseScale * crop.zoom;
  crop.offsetX = (crop.FRAME_W - scaledW) / 2;
  crop.offsetY = (crop.FRAME_H - scaledH) / 2;
  clampProfileCharacterCropOffsets();
  applyProfileCharacterCropTransform();

  let dragging = false;
  let startX = 0, startY = 0;
  let startOffsetX = 0, startOffsetY = 0;
  const onPointerDown = e => {
    dragging = true;
    stage.setPointerCapture?.(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    startOffsetX = crop.offsetX; startOffsetY = crop.offsetY;
    e.preventDefault();
  };
  const onPointerMove = e => {
    if (!dragging) return;
    const stageH = stage.clientHeight || 1;
    const cssScale = stageH / crop.FRAME_H;
    const dxFrame = (e.clientX - startX) / cssScale;
    const dyFrame = (e.clientY - startY) / cssScale;
    crop.offsetX = startOffsetX + dxFrame;
    crop.offsetY = startOffsetY + dyFrame;
    clampProfileCharacterCropOffsets();
    applyProfileCharacterCropTransform();
  };
  const onPointerUp = e => { dragging = false; try { stage.releasePointerCapture?.(e.pointerId); } catch (err) {} };
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('pointerleave', onPointerUp);
  // Re-apply on viewport changes (orientation, keyboard)
  const onResize = () => applyProfileCharacterCropTransform();
  window.addEventListener('resize', onResize, { passive: true });
}

function handleProfileCharacterCropZoom(value) {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const crop = state.cropState;
  const next = Math.max(crop.minZoom, Math.min(crop.maxZoom, Number(value) || 1));
  // Keep crop centered around the same focal point of the frame
  const focusX = crop.FRAME_W / 2;
  const focusY = crop.FRAME_H / 2;
  const oldScale = crop.baseScale * crop.zoom;
  const newScale = crop.baseScale * next;
  // Image-space focal point under cursor (so it remains stable on zoom)
  const imgX = (focusX - crop.offsetX) / oldScale;
  const imgY = (focusY - crop.offsetY) / oldScale;
  crop.zoom = next;
  crop.offsetX = focusX - imgX * newScale;
  crop.offsetY = focusY - imgY * newScale;
  clampProfileCharacterCropOffsets();
  applyProfileCharacterCropTransform();
}

function cancelProfileCharacterCrop() {
  if (!profileCharacterEditorState) return;
  profileCharacterEditorState.cropState = null;
  renderProfileCharacterEditor();
}

function commitProfileCharacterCrop(options = {}) {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return '';
  const crop = state.cropState;
  /* v618: Render at 400×600 (was 600×900) at q0.70 (was q0.85) so the
     base64 output stays well under Firestore's 1MiB document limit.
     Three posters at ~40KB each = ~120KB, safely leaving room for all
     other profile fields. The previous 600×900 q0.85 produced ~150KB
     per image — three of them could push the document over the limit and
     cause silent save failures, making data appear to revert. */
  const OUT_W = 400;
  const OUT_H = 600;
  const scaleX = OUT_W / crop.FRAME_W;
  const scaleY = OUT_H / crop.FRAME_H;
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scaledW = crop.img.width * crop.baseScale * crop.zoom * scaleX;
  const scaledH = crop.img.height * crop.baseScale * crop.zoom * scaleY;
  ctx.drawImage(crop.img, crop.offsetX * scaleX, crop.offsetY * scaleY, scaledW, scaledH);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.70);
  state.pendingImage = dataUrl;
  state.pendingImageSource = 'upload';
  state.cropState = null;
  if (options.render !== false) renderProfileCharacterEditor();
  return dataUrl;
}

function saveProfileCharacterFromEditor() {
  const state = profileCharacterEditorState;
  if (!state || !state.card) return;
  // Read latest name input value (in case oninput hadn't fired)
  const nameInput = document.getElementById('profile-character-name-input');
  if (nameInput) state.name = String(nameInput.value || '').slice(0, 30).trim();
  if (state.cropState) commitProfileCharacterCrop({ render: false });
  const finalImage = state.pendingImage || state.image || '';
  if (state.mode === 'database') {
    state.card.dataset.profileDbTitle = state.name;
    state.card.dataset.profileDbImage = finalImage;
    state.card.dataset.profileDbSource = state.card.dataset.profileDbSource || 'custom';
    state.card.dataset.profileDbType = state.card.dataset.profileDbType || 'person';
    updateProfileDatabaseCardPreview(state.card);
  } else {
    state.card.dataset.manualName = state.name;
    state.card.dataset.manualImage = finalImage;
    state.card.dataset.manualRating = state.section === 'fictionalCharacters' ? '' : (state.rating || state.card.dataset.manualRating || '');
    updateProfileManualCardPreview(state.card);
  }
  if (userProfile) readProfileDraftFromPage(userProfile);
  closeProfileCharacterEditor();
  saveProfileFavoritesAuto('saved');
}

function clearProfileCharacterSlotFromEditor() {
  const state = profileCharacterEditorState;
  if (!state || !state.card) return;
  if (state.mode === 'database') {
    state.card.dataset.profileDbId = '';
    state.card.dataset.profileDbSource = '';
    state.card.dataset.profileDbType = '';
    state.card.dataset.profileDbTitle = '';
    state.card.dataset.profileDbImage = '';
    state.card.dataset.profileDbMeta = '';
    state.card.dataset.profileDbLegacyId = '';
    state.card.dataset.profileDbRating = '';
    updateProfileDatabaseCardPreview(state.card);
  } else {
    state.card.dataset.manualName = '';
    state.card.dataset.manualImage = '';
    state.card.dataset.manualRating = '';
    updateProfileManualCardPreview(state.card);
  }
  if (userProfile) readProfileDraftFromPage(userProfile);
  closeProfileCharacterEditor();
  saveProfileFavoritesAuto('saved');
}

/* ════════════════════════════════════════════════════════════════════════
   v10.765 — USERNAME (@handle) + DISPLAY NAME edit flows for the
   Profile Settings page.
   ════════════════════════════════════════════════════════════════════════
   Data model (already established at signup, see 19c-auth-flow-setup.js):
     usernameHandle       — the @handle, case-preserved
     usernameHandleLower  — lowercase for uniqueness lookups
     name + customName    — the display name (rendered in friend rows etc.)
     nameLower            — lowercase mirror
   New field added by this module:
     usernameLastChangedAtMs — Date.now() at the moment of change.
                                The Firestore rule on users/{uid} reads
                                this to enforce the 14-day cooldown
                                server-side. Tamper-proof.

   On username change we:
     1. Validate (USERNAME_RE: 1-30, letters/digits/periods/underscores)
     2. Check 14-day cooldown client-side (UX) — server rule enforces too
     3. CREATE the new usernames/{newLower} doc (rule blocks if taken)
     4. UPDATE users/{uid} with new handle + usernameLastChangedAtMs
        (rule blocks if within cooldown window)
     5. DELETE old usernames/{oldLower} doc (rule allows self-delete)
     If step 4 fails, we roll back the new-username claim from step 3.
     Step 5 is best-effort: if it fails, the new handle is live anyway.
   ════════════════════════════════════════════════════════════════════════ */

const PROFILE_USERNAME_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/* v10.988: universal username rule across signup + profile edit — min
   1, max 30, letters/numbers/periods/underscores only. */
const PROFILE_USERNAME_RE = /^[a-z0-9._]{1,30}$/;
function sanitizeProfileUsernameInput(value = '') {
  return String(value || '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 30);
}
function validateProfileUsernameModeration(value) {
  const moderator = window.ShelfdUsernameModeration;
  if (!moderator || typeof moderator.validateUsernameContent !== 'function') return { allowed: true };
  return moderator.validateUsernameContent(value);
}
function profileUsernameModerationMessage() {
  return window.ShelfdUsernameModeration?.message || 'This username is not allowed. Please choose another one.';
}

function getProfileUsernameLastChangedMs() {
  if (!userProfile) return 0;
  const raw = userProfile.usernameLastChangedAtMs
    || userProfile.usernameLastChangedAt
    || 0;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw.toMillis === 'function') {
    try { return raw.toMillis(); } catch (_) { return 0; }
  }
  return 0;
}

function getProfileUsernameCooldownRemainingMs() {
  const last = getProfileUsernameLastChangedMs();
  if (!last) return 0;
  return Math.max(0, last + PROFILE_USERNAME_COOLDOWN_MS - Date.now());
}

function formatProfileCooldownDays(ms) {
  if (!ms) return '';
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? '1 day' : `${days} days`;
}

function renderProfileSettingsIdentityCards() {
  /* Populate the @handle + display-name cards with current values from
     userProfile, and lock the Edit button if we're inside the cooldown. */
  const handleDisplay = document.getElementById('profile-settings-handle-display');
  const handleEditBtn = document.getElementById('profile-settings-handle-edit-btn');
  const nameDisplay = document.getElementById('profile-settings-displayname-display');
  const handle = String(
    userProfile?.usernameHandle
    || userProfile?.userHandle
    || userProfile?.username
    || ''
  ).trim();
  const displayName = String(
    userProfile?.customName
    || userProfile?.name
    || ''
  ).trim();
  if (handleDisplay) handleDisplay.textContent = handle ? '@' + handle : '@—';
  if (nameDisplay) nameDisplay.textContent = displayName || '—';
  /* v10.775: button always says "Edit" regardless of cooldown state.
     The cooldown surfaces as an inline red message under the username
     when the user actually taps Edit (see openUsernameHandleEdit). */
  if (handleEditBtn) {
    handleEditBtn.classList.remove('is-locked');
    handleEditBtn.disabled = false;
    handleEditBtn.textContent = 'Edit';
    handleEditBtn.removeAttribute('aria-label');
  }
  /* Hide the locked message on re-render so it doesn't linger after the
     user navigates away and back. */
  const lockedMsgEl = document.getElementById('profile-settings-handle-locked-msg');
  if (lockedMsgEl) lockedMsgEl.hidden = true;
}
window.renderProfileSettingsIdentityCards = renderProfileSettingsIdentityCards;

function setProfileEditError(errorEl, message) {
  if (!errorEl) return;
  if (message) {
    errorEl.textContent = String(message);
    errorEl.hidden = false;
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }
}

/* ── Username @handle edit flow ── */

window.openUsernameHandleEdit = function() {
  /* v10.775: cooldown gate now surfaces as an INLINE red message under
     the @username row rather than a toast at the bottom of the screen.
     Tap Edit during the 14-day lock → message appears, edit form stays
     closed. Tap Edit after cooldown elapses → message hidden, edit form
     opens normally. Server rule still rejects the write either way if
     somehow bypassed. */
  const lockedMsg = document.getElementById('profile-settings-handle-locked-msg');
  const remaining = getProfileUsernameCooldownRemainingMs();
  if (remaining > 0) {
    if (lockedMsg) {
      lockedMsg.textContent = 'Locked, you recently changed your username';
      lockedMsg.hidden = false;
    }
    return;
  }
  if (lockedMsg) lockedMsg.hidden = true;
  const row = document.getElementById('profile-settings-handle-row');
  const edit = document.getElementById('profile-settings-handle-edit');
  const input = document.getElementById('profile-settings-handle-input');
  if (!row || !edit || !input) return;
  row.hidden = true;
  edit.hidden = false;
  input.value = sanitizeProfileUsernameInput(userProfile?.usernameHandle || '');
  if (!input.__shelfdUsernameRuleBound) {
    input.__shelfdUsernameRuleBound = true;
    input.addEventListener('input', () => {
      const cleaned = sanitizeProfileUsernameInput(input.value);
      if (input.value !== cleaned) input.value = cleaned;
    });
  }
  setProfileEditError(document.getElementById('profile-settings-handle-edit-error'), '');
  setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
};

window.cancelUsernameHandleEdit = function() {
  const row = document.getElementById('profile-settings-handle-row');
  const edit = document.getElementById('profile-settings-handle-edit');
  if (row) row.hidden = false;
  if (edit) edit.hidden = true;
  setProfileEditError(document.getElementById('profile-settings-handle-edit-error'), '');
};

window.saveUsernameHandleChange = async function() {
  const input = document.getElementById('profile-settings-handle-input');
  const saveBtn = document.getElementById('profile-settings-handle-save-btn');
  const errorEl = document.getElementById('profile-settings-handle-edit-error');
  if (!input || !currentUser || typeof firebase === 'undefined') return;
  const newHandle = sanitizeProfileUsernameInput(input.value || '');
  if (input.value !== newHandle) input.value = newHandle;
  const oldHandle = String(userProfile?.usernameHandle || '').trim();
  const oldHandleLower = oldHandle.toLowerCase();
  const newHandleLower = newHandle.toLowerCase();
  /* Empty / unchanged / invalid format guards before we touch Firestore. */
  if (!PROFILE_USERNAME_RE.test(newHandle)) {
    setProfileEditError(errorEl, 'Username must be 1-30 characters and can only use letters, numbers, periods, and underscores.');
    return;
  }
  if (!validateProfileUsernameModeration(newHandle).allowed) {
    setProfileEditError(errorEl, profileUsernameModerationMessage());
    return;
  }
  if (newHandleLower === oldHandleLower) {
    window.cancelUsernameHandleEdit();
    return;
  }
  /* Re-check cooldown right before save (in case the user opened edit
     somehow and time hasn't actually elapsed). */
  const remaining = getProfileUsernameCooldownRemainingMs();
  if (remaining > 0) {
    setProfileEditError(errorEl, 'You must wait ' + formatProfileCooldownDays(remaining) + ' until you can edit your username again.');
    return;
  }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  setProfileEditError(errorEl, '');
  const db = firebase.firestore();
  const newUsernameRef = db.collection('usernames').doc(newHandleLower);
  const userRef = db.collection('users').doc(currentUser.uid);
  const now = Date.now();
  /* Step 1 — claim the new username (rule blocks if taken). */
  try {
    await newUsernameRef.set({
      uid: currentUser.uid,
      username: newHandle,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    /* permission-denied here almost always means "taken". Disambiguate
       by re-fetching. */
    console.error('[v10.767] username step 1 (claim new) failed:', e?.code, e?.message, e);
    let taken = false;
    try {
      const probe = await newUsernameRef.get();
      taken = probe.exists && probe.data()?.uid !== currentUser.uid;
    } catch (_) {}
    setProfileEditError(errorEl, taken
      ? 'That username is already taken.'
      : ('Could not reserve username (' + (e?.code || 'unknown') + '). Try again.'));
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    return;
  }
  /* Step 2 — update user doc with new handle + cooldown timestamp.
     If the rule rejects (cooldown still active server-side), roll back
     the username claim from step 1 so the new handle isn't orphaned.
     v10.767: log the full error to console so we can diagnose if a
     "save failed" report turns out to be a rules / network / quota
     issue rather than the cooldown.
     v10.768: cooldown stamp now uses serverTimestamp() (resolved
     server-side) instead of client Date.now(). Eliminates the previous
     ±5s clock-drift failure mode where the server's request.time would
     be a few seconds off from the client's clock and the rule check
     `usernameLastChangedAtMs >= request.time - 5s` would reject the
     write. We ALSO write usernameLastChangedAtMs (number) as a
     convenience for client-side cooldown display, but the SERVER rule
     trusts only the Timestamp field. */
  /* v10.769: defensive guard — if the compat SDK didn't expose
     FieldValue.serverTimestamp() for any reason (SDK load order,
     WKWebView quirk, etc), the sentinel would be undefined and Firestore
     would throw invalid-argument with a confusing message. Catch it
     here so the user sees a clearer hint instead. */
  const serverTs = firebase.firestore.FieldValue && firebase.firestore.FieldValue.serverTimestamp
    ? firebase.firestore.FieldValue.serverTimestamp()
    : null;
  if (!serverTs) {
    console.error('[v10.769] FieldValue.serverTimestamp() unavailable on this runtime');
    setProfileEditError(errorEl, 'Could not save the username change. Firestore SDK is missing serverTimestamp — reload the app and try again.');
    try { await newUsernameRef.delete(); } catch (_) {}
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    return;
  }
  try {
    await userRef.set({
      usernameHandle: newHandle,
      usernameHandleLower: newHandleLower,
      usernameLastChangedAt: serverTs,
      usernameLastChangedAtMs: now,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error('[v10.770] username step 2 (user doc update) failed:', e?.code, e?.message, e);
    /* v10.770: 1 MiB document-size rescue. Firestore caps user docs at
       1,048,576 bytes; once you cross it the SDK throws invalid-argument
       BEFORE the request leaves the device, so the rules never run and
       even a tiny 5-field username patch is refused. Same situation the
       v620 favorites-save rescue solves — re-use that pattern here.
       Strategy: pull the full doc, log per-field byte sizes so we know
       what's bloating it, shrink every oversized base64 data URL,
       apply the username patch on top (fresh sentinels — never put
       sentinels through shrinkDataUrlsDeep), and overwrite with
       merge:false. The new username claim from step 1 stays valid. */
    const msg = String(e?.message || '').toLowerCase();
    const isSizeError = !!(e && (
      msg.includes('1048576') ||
      msg.includes('maximum allowed size') ||
      (e.code === 'invalid-argument' && msg.includes('size'))
    ));
    if (isSizeError) {
      try {
        if (typeof showToast === 'function') {
          try { showToast('Cleaning up oversized profile data…', { durationMs: 2400 }); } catch (_) {}
        }
        const snap = await userRef.get();
        const existing = snap.exists ? snap.data() : {};
        /* Diagnostic: per-top-level-field byte sizes, sorted desc.
           Helps us see WHICH field is the bloat culprit (typically
           customPhoto, showcaseFavorites, or pinnedFavorites). */
        try {
          const sizes = Object.entries(existing).map(([k, v]) => {
            let bytes = 0;
            try { bytes = JSON.stringify(v).length; } catch (_) { bytes = -1; }
            return { key: k, bytes };
          }).sort((a, b) => b.bytes - a.bytes);
          const total = sizes.reduce((s, x) => s + Math.max(0, x.bytes), 0);
          console.warn('[v10.770] user doc bloat audit — total bytes ≈', total);
          console.table(sizes);
        } catch (auditErr) {
          console.warn('[v10.770] bloat audit failed:', auditErr);
        }
        const cleaned = await shrinkDataUrlsDeep(existing);
        /* v10.771: NUKE LEGACY DM MIRROR FIELDS. These are the actual
           bloat source on heavy accounts — the data-URL shrink (v10.770)
           only touches base64 strings, but `directMessageThreadMap`
           holds full structured message arrays for every DM thread,
           which can hit MBs by itself.
           Safe to delete because v10.739 moved DMs to the canonical
           `dmThreads/{threadId}` collection. Real-time delivery,
           inbox rendering, message history — all read from there now.
           These legacy fields are just historical mirror cruft from
           before the migration. Wiping them by omission (set with
           merge:false) shrinks the user doc dramatically and lets the
           1 MiB-limited username write fit. */
        const KNOWN_BLOAT_FIELDS = [
          'directMessageThreadMap',           // legacy DM message-history mirror
          'directMessageThreads',             // legacy DM thread-ID list
          'directMessageIncomingRequestMap',  // legacy DM request payloads (with optional images)
          'directMessageOutgoingRequestMap',
          'directMessageIncomingRequests',
          'directMessageOutgoingRequests'
        ];
        let removedBytes = 0;
        for (const field of KNOWN_BLOAT_FIELDS) {
          if (cleaned[field] !== undefined) {
            try { removedBytes += JSON.stringify(cleaned[field]).length; } catch (_) {}
            delete cleaned[field];
            console.warn('[v10.771] removed bloat field from user doc:', field);
          }
        }
        if (removedBytes > 0) {
          console.warn('[v10.771] freed ≈', removedBytes, 'bytes from legacy DM mirror fields');
        }
        const merged = Object.assign({}, cleaned, {
          usernameHandle: newHandle,
          usernameHandleLower: newHandleLower,
          usernameLastChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
          usernameLastChangedAtMs: now,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        try {
          const afterBytes = JSON.stringify(merged).length;
          console.warn('[v10.771] post-cleanup merged doc bytes ≈', afterBytes);
        } catch (_) {}
        await userRef.set(merged, { merge: false });
        /* Rescue succeeded — fall through to step 3 below. */
      } catch (rescueErr) {
        console.error('[v10.770] username size-rescue failed:', rescueErr?.code, rescueErr?.message, rescueErr);
        try { await newUsernameRef.delete(); } catch (_) {}
        setProfileEditError(errorEl, 'Could not save the username change. Your profile doc is over the 1 MiB Firestore cap and the auto-cleanup didn\'t free enough space. Remove a profile favorite or shrink your profile photo and try again.');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        return;
      }
    } else {
      try { await newUsernameRef.delete(); } catch (_) {}
      let detail;
      if (e?.code === 'permission-denied') {
        detail = 'Permission denied — likely the 14-day cooldown is still active server-side, or the new Firestore rules haven\'t been deployed yet.';
      } else if (e?.code === 'unavailable' || e?.code === 'failed-precondition') {
        detail = 'Network or persistence issue. Try again in a moment.';
      } else if (e?.code) {
        detail = 'Error code: ' + e.code + (e.message ? ' — ' + String(e.message).slice(0, 200) : '');
      } else {
        detail = 'Try again.';
      }
      setProfileEditError(errorEl, 'Could not save the username change. ' + detail);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      return;
    }
  }
  /* Step 3 — release the OLD username (best-effort). If this fails the
     new handle is still live; we just leave the old one orphaned. The
     rule should allow self-delete (allow delete: if isSignedIn() &&
     request.auth.uid == resource.data.uid). */
  if (oldHandleLower && oldHandleLower !== newHandleLower) {
    try {
      await db.collection('usernames').doc(oldHandleLower).delete();
    } catch (e) {
      console.warn('[v10.765] could not release old username (rule may need allow-delete-self):', e?.code || e?.message);
    }
  }
  /* Mirror locally so the UI reflects immediately without waiting for
     the next onSnapshot from friendsDataListener.
     v10.773: also defensively initialize a userProfile object if it
     was null/undefined (rare but possible during cold-start race
     conditions). Without this, the save would succeed in Firestore
     but the local display would stay stuck on "@—". */
  if (!userProfile) userProfile = normalizeUserProfile({ uid: currentUser?.uid });
  userProfile.usernameHandle = newHandle;
  userProfile.usernameHandleLower = newHandleLower;
  userProfile.usernameLastChangedAtMs = now;
  /* v10.766: clearer in-place success feedback so the user immediately
     sees their save took effect. Save button flips to a green "Saved ✓"
     for 900ms, then we close the edit form (display row now reflects
     the new value). Toast fires alongside as a secondary signal at the
     bottom of the screen.
     v10.773: ALSO write the new @handle straight to the display element
     here. Belt-and-suspenders against any state where renderProfileSettingsIdentityCards
     might read a stale userProfile (e.g. if a snapshot fires mid-save
     and overwrites our mirror). The truth is what just got saved. */
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Saved ✓';
    saveBtn.classList.add('is-saved');
  }
  const handleDisplayEl = document.getElementById('profile-settings-handle-display');
  if (handleDisplayEl) handleDisplayEl.textContent = '@' + newHandle;
  renderProfileSettingsIdentityCards();
  if (typeof showToast === 'function') {
    try { showToast('Username updated'); } catch (_) {}
  }
  setTimeout(() => {
    if (saveBtn) {
      saveBtn.textContent = 'Save';
      saveBtn.classList.remove('is-saved');
    }
    window.cancelUsernameHandleEdit();
  }, 900);
};

/* ── Display name edit flow ── */

window.openDisplayNameEdit = function() {
  const row = document.getElementById('profile-settings-displayname-row');
  const edit = document.getElementById('profile-settings-displayname-edit');
  const input = document.getElementById('profile-settings-displayname-input');
  if (!row || !edit || !input) return;
  row.hidden = true;
  edit.hidden = false;
  input.value = String(userProfile?.customName || userProfile?.name || '').trim();
  setProfileEditError(document.getElementById('profile-settings-displayname-edit-error'), '');
  setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
};

window.cancelDisplayNameEdit = function() {
  const row = document.getElementById('profile-settings-displayname-row');
  const edit = document.getElementById('profile-settings-displayname-edit');
  if (row) row.hidden = false;
  if (edit) edit.hidden = true;
  setProfileEditError(document.getElementById('profile-settings-displayname-edit-error'), '');
};

window.saveDisplayNameChange = async function() {
  const input = document.getElementById('profile-settings-displayname-input');
  const saveBtn = document.getElementById('profile-settings-displayname-save-btn');
  const errorEl = document.getElementById('profile-settings-displayname-edit-error');
  if (!input || !currentUser || typeof firebase === 'undefined') return;
  const newName = String(input.value || '').trim();
  if (!newName) {
    setProfileEditError(errorEl, 'Display name cannot be empty.');
    return;
  }
  if (newName.length > 64) {
    setProfileEditError(errorEl, 'Display name must be 64 characters or fewer.');
    return;
  }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  setProfileEditError(errorEl, '');
  try {
    await firebase.firestore().collection('users').doc(currentUser.uid).set({
      name: newName,
      nameLower: newName.toLowerCase(),
      customName: newName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    setProfileEditError(errorEl, 'Could not save. ' + (e?.code === 'permission-denied' ? 'Permission denied.' : 'Try again.'));
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    return;
  }
  /* v10.773: defensive userProfile init + direct display element write,
     same pattern as the username save above (see comments there). */
  if (!userProfile) userProfile = normalizeUserProfile({ uid: currentUser?.uid });
  userProfile.name = newName;
  userProfile.customName = newName;
  userProfile.nameLower = newName.toLowerCase();
  /* v10.766: same inline "Saved ✓" feedback as the username flow. */
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Saved ✓';
    saveBtn.classList.add('is-saved');
  }
  const displayNameEl = document.getElementById('profile-settings-displayname-display');
  if (displayNameEl) displayNameEl.textContent = newName;
  renderProfileSettingsIdentityCards();
  if (typeof showToast === 'function') {
    try { showToast('Display name updated'); } catch (_) {}
  }
  setTimeout(() => {
    if (saveBtn) {
      saveBtn.textContent = 'Save';
      saveBtn.classList.remove('is-saved');
    }
    window.cancelDisplayNameEdit();
  }, 900);
};
