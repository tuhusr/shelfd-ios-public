let profileReturnTab = 'mylist';
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

const PROFILE_LINK_CONFIG = [
  { key: 'imdb', label: 'IMDb', domain: 'imdb.com', placeholder: 'https://www.imdb.com/user/...' },
  { key: 'letterboxd', label: 'Letterboxd', domain: 'letterboxd.com', placeholder: 'https://letterboxd.com/username/' },
  { key: 'backloggd', label: 'Backloggd', domain: 'backloggd.com', placeholder: 'https://www.backloggd.com/u/username/', optionalMobile: true, visibilityKey: 'linkBackloggd' },
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
  { key: 'anime', title: 'Anime', icon: '🌸', sub: 'Anime watch time, rating, and optional top 3 anime.', statKeys: ['animeHours', 'animeAvg'], rows: ['anime'] },
  { key: 'games', title: 'Video Games', icon: '🎮', sub: 'Played hours, game rating, and optional top 3 games.', statKeys: ['gameHours', 'gamesAvg'], rows: ['games'] },
  { key: 'characters', title: 'Fictional Characters', icon: '🦸', sub: 'Optional top 3 characters that define your taste.', statKeys: [], rows: ['fictionalCharacters'], wide: true },
  { key: 'people', title: 'Actors & Directors', icon: '🎭', sub: 'Optional top 3 actors / actresses and directors.', statKeys: [], rows: ['actors', 'directors'], wide: true },
  { key: 'music', title: 'Music', icon: '🎵', sub: 'Optional top 3 musical artists.', statKeys: [], rows: ['musicArtists'], wide: true }
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
    linkBackloggd: true,
    linkAppleMusic: true,
    linkSpotify: true
  };
}


function getDefaultListTabVisibility() {
  return { anime: true, games: true, manga: true, books: true };
}

function normalizeListTabVisibility(raw) {
  const defaults = getDefaultListTabVisibility();
  if (raw && typeof raw === 'object') {
    defaults.anime = raw.anime !== false;
    defaults.games = raw.games !== false;
    defaults.manga = raw.manga !== false;
    defaults.books = raw.books !== false;
  }
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
  if (section === 'anime') return safe.anime !== false;
  if (section === 'games') return safe.games !== false;
  if (section === 'manga') return safe.manga !== false;
  if (section === 'books') return safe.books !== false;
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
  const order = [preferred, 'shows', 'movies', 'anime', 'games', 'manga', 'books'];
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

function renderMyListEditControls() {
  const editHost = document.getElementById('mylist-edit-controls');
  const profileHost = document.getElementById('mylist-profile-controls');
  if (!editHost && !profileHost) return;

  if (viewingUser || document.body.classList.contains('profile-active')) {
    if (editHost) editHost.innerHTML = '';
    if (profileHost) profileHost.innerHTML = '';
    return;
  }

  const profileName = userProfile?.name || currentUser?.displayName || 'Me';
  const profilePhoto = userProfile?.photo || currentUser?.photoURL || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(profileName) + '&background=1c1535&color=a78bfa');
  const profileShortcut = currentUser ? `
    <div class="mylist-own-profile-center">
      <button type="button" class="mylist-own-profile-shortcut" onclick="openProfile()" aria-label="Open my profile" title="Open my profile">
        <img src="${escAttr(profilePhoto)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(profileName).replace(/'/g, '%27')}&background=1c1535&color=a78bfa'">
      </button>
      <div class="mylist-own-profile-name">${escHtml(profileName)}</div>
    </div>` : '';

  if (profileHost) profileHost.innerHTML = profileShortcut;
  if (editHost) editHost.innerHTML = '';
}

function renderMyListSettingsInner() {
  const vis = normalizeListTabVisibility(myListTabDraftVisibility || userProfile?.listTabVisibility);
  const sections = [
    { key: 'games', label: 'Games' },
    { key: 'anime', label: 'Anime' },
    { key: 'manga', label: 'Manga' },
    { key: 'books', label: 'Books' },
  ];
  return `
    <div class="mylist-settings-title">My List Settings</div>
    <div class="mylist-settings-section-label">Visible Categories</div>
    ${sections.map(s => `
      <div class="mylist-settings-row">
        <span class="mylist-settings-row-label">${escHtml(s.label)}</span>
        <button type="button" class="mylist-vis-toggle ${vis[s.key] !== false ? 'on' : 'off'}" onclick="event.stopPropagation();toggleMyListDraftSection('${s.key}')" aria-label="Toggle ${escAttr(s.label)}">
          <span class="mylist-vis-knob"></span>
        </button>
      </div>`).join('')}
    <div class="mylist-settings-divider"></div>
    <div class="mylist-settings-section-label">Library</div>
    <div class="mylist-settings-row">
      <span class="mylist-settings-row-label">Import Lists</span>
      <button type="button" class="mylist-settings-action-btn" onclick="event.stopPropagation();closeMyListSettingsModal();setTimeout(openImportPage,180)">Import</button>
    </div>`;
}

function openMyListSettingsModal(triggerEl) {
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

  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    const panelW = 230;
    let left = rect.left;
    if (left + panelW > window.innerWidth - 10) left = window.innerWidth - panelW - 10;
    left = Math.max(10, left);
    panel.style.top = (rect.bottom + 8) + 'px';
    panel.style.left = left + 'px';
    const originX = rect.left + rect.width / 2 - left;
    panel.style.transformOrigin = originX + 'px 0px';
  }

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
    }, 150);
  } else {
    const modal = document.getElementById('mylist-settings-modal');
    if (modal) modal.remove();
  }
  _commitMyListVisibility();
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
  return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1c1535&color=a78bfa';
}

function getViewingProfileName() {
  const profile = getActiveProfile();
  return profile?.name || profileViewingUser?.name || 'ScreenList User';
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

  if (kind === 'followers') {
    addIds(profile.followers);
    addIds(profile.followerIds);
    addIds(profile.followedBy);
    addIds(profile.incomingFollowers);
    addIds(profile.friends);
    addIds(profile.incomingRequests);
  } else {
    addIds(profile.following);
    addIds(profile.followingIds);
    addIds(profile.follows);
    addIds(profile.outgoingFollowing);
    addIds(profile.friends);
    addIds(profile.outgoingRequests);
  }
  if (!isViewingOtherProfile()) addIds(friends);
  ids.delete(profile.uid);
  ids.delete(currentUser?.uid === profile.uid ? currentUser.uid : '');
  return [...ids];
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
  row.innerHTML = `
    <button type="button" class="profile-social-count" onclick="openProfileSocialModal('following')">
      <strong>${followingCount.toLocaleString('en-US')}</strong>
      <span>Following</span>
    </button>
    <button type="button" class="profile-social-count" onclick="openProfileSocialModal('followers')">
      <strong>${followersCount.toLocaleString('en-US')}</strong>
      <span>Followers</span>
    </button>
  `;
}

async function getProfileSocialUsers(kind) {
  const ids = getProfileSocialIds(kind);
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

function closeProfileSocialModal() {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  modal.classList.remove('plm-open');
  setTimeout(() => modal.remove(), 230);
}

function openProfileSocialUser(uid) {
  closeProfileSocialModal();
  if (!uid) return;
  if (isPreviewMode()) {
    openPreviewUserProfile(uid);
    return;
  }
  if (currentUser && uid === currentUser.uid) {
    openProfile();
    return;
  }
  openUserProfile(uid);
}


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

async function refreshProfileSocialModal() {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  const mode = modal.dataset.mode === 'followers' ? 'followers' : 'following';
  const list = modal.querySelector('.profile-social-list');
  if (!list) return;
  const users = await getProfileSocialUsers(mode);
  if (!document.body.contains(modal)) return;
  if (!users.length) {
    list.innerHTML = `<div class="friends-empty"><div class="friends-empty-icon">👥</div><p style="color:#7a6f99;">No ${mode} yet</p></div>`;
    return;
  }
  list.innerHTML = users.map(renderProfileSocialUserRow).join('');
}

function renderProfileSocialUserRow(user) {
  const name = user?.name || user?.displayName || 'ScreenList User';
  const photo = user?.photo || user?.photoURL || getProfileFallbackPhotoFor({ name });
  if (user?.uid) usersMap[user.uid] = { ...(usersMap[user.uid] || {}), ...user, uid: user.uid };
  const action = getSocialRelationshipActionHTML(user);
  return `<div class="profile-social-user-row">
    <button type="button" class="profile-social-user-main" onclick="openProfileSocialUser('${escAttr(user.uid)}')">
      <img class="profile-social-avatar" src="${escAttr(photo)}" alt="">
      <span>${renderDisplayNameHTML(user, name)}</span>
    </button>
    <div class="friend-actions-group">
      <button type="button" class="profile-social-view-btn" onclick="openProfileSocialUser('${escAttr(user.uid)}')">Profile</button>
      ${action}
    </div>
  </div>`;
}

async function openProfileSocialModal(kind) {
  const mode = kind === 'followers' ? 'followers' : 'following';
  const existing = document.getElementById('profile-social-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'profile-social-modal';
  modal.dataset.mode = mode;
  modal.className = 'plm-overlay profile-social-modal';
  modal.innerHTML = `
    <div class="plm-sheet profile-social-sheet">
      <div class="plm-header">
        <span class="plm-title">${mode === 'followers' ? 'Followers' : 'Following'}</span>
        <button class="plm-close" onclick="closeProfileSocialModal()">×</button>
      </div>
      <div class="profile-social-list"><div class="discover-message">Loading people...</div></div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) closeProfileSocialModal(); });
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('plm-open'));
  const list = modal.querySelector('.profile-social-list');
  const users = await getProfileSocialUsers(mode);
  if (!document.body.contains(modal) || !list) return;
  if (!users.length) {
    list.innerHTML = `<div class="friends-empty"><div class="friends-empty-icon">👥</div><p style="color:#7a6f99;">No ${mode} yet</p></div>`;
    return;
  }
  list.innerHTML = users.map(renderProfileSocialUserRow).join('');
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
  return {
    name: baseName,
    photo: raw.photo || raw.customPhoto || (useCurrentUserFallback ? (currentUser?.photoURL) : '') || '',
    bio: raw.bio || raw.profileBio || '',
    themeMode: normalizeThemeMode(raw.themeMode),
    ratingPreferences: normalizeRatingPreferences(raw.ratingPreferences),
    animeTitleDisplayMode: normalizeAnimeTitleDisplayMode(raw.animeTitleDisplayMode || raw.animeTitleDisplay),
    socialLinks: normalizeSocialLinks(raw.socialLinks),
    pinnedFavorites: normalizePinnedFavorites(raw.pinnedFavorites),
    profileVisibility: normalizeProfileVisibility(raw.profileVisibility),
    listTabVisibility: normalizeListTabVisibility(raw.listTabVisibility),
    showcaseFavorites: normalizeShowcaseFavorites(raw.showcaseFavorites || raw.manualFavorites),
    uid: raw.uid || currentUser?.uid || 'preview-user',
    emailLower: raw.emailLower || raw.accountEmailLower || (useCurrentUserFallback ? normalizeEmail(currentUser?.email) : ''),
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
    outgoingRequests: Array.isArray(raw.outgoingRequests) ? raw.outgoingRequests.filter(Boolean) : []
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
  const moviesTvHours = movieHours + tvHours;
  const allMediaHours = moviesTvHours + animeHours;
  const movieAvg = formatAverageRatingForSection(source.movies || [], 'movies');
  const tvAvg = formatAverageRatingForSection(source.shows || [], 'shows');
  const moviesTvAvg = formatAverageRatingForSection([...(source.movies || []), ...(source.shows || [])], 'shows');
  const animeAvg = formatAverageRatingForSection(source.anime || [], 'anime');
  const gamesAvg = formatAverageRatingForSection(source.games || [], 'games');
  const allMediaAvg = formatAverageRatingForSection([...(source.movies || []), ...(source.shows || []), ...(source.anime || []), ...(source.games || [])], 'shows');
  return { movieHours, tvHours, moviesTvHours, allMediaHours, animeHours, gameHours, movieAvg, tvAvg, moviesTvAvg, animeAvg, gamesAvg, allMediaAvg };
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
  const profile = getActiveProfile();
  const visibility = normalizeProfileVisibility(profile?.profileVisibility);
  const listVisibility = getProfileListTabVisibility(profile);
  const editing = !isViewingOtherProfile();
  const cards = [
    { key: 'allMediaHours', optional: false, tone: 'hours', value: formatProfileHours(stats.allMediaHours), labelMain: 'All Media', labelSub: 'Hours Watched' },
    { key: 'moviesTvHours', optional: false, tone: 'hours', value: formatProfileHours(stats.moviesTvHours), labelMain: 'TV Shows + Movies', labelSub: 'Hours Watched' },
    { key: 'statsAnimeHours', optional: true, tone: 'hours', value: formatProfileHours(stats.animeHours), labelMain: 'Anime', labelSub: 'Hours Watched' },
    { key: 'statsGameHours', optional: true, tone: 'hours', value: formatProfileHours(stats.gameHours), labelMain: 'Games', labelSub: 'Hours Played' },
    { key: 'allMediaAvg', optional: false, tone: 'score', value: stats.allMediaAvg, labelMain: 'Average Score', labelSub: 'All Media' },
    { key: 'moviesTvAvg', optional: false, tone: 'score', value: stats.moviesTvAvg, labelMain: 'Average Score', labelSub: 'TV Shows + Movies' },
    { key: 'statsAnimeAvg', optional: true, tone: 'score', value: stats.animeAvg, labelMain: 'Average Score', labelSub: 'Anime' },
    { key: 'statsGamesAvg', optional: true, tone: 'score', value: stats.gamesAvg, labelMain: 'Average Score', labelSub: 'Video Games' }
  ];
  el.innerHTML = cards.map(card => {
    const hiddenByListTab =
      (card.key === 'statsAnimeHours' || card.key === 'statsAnimeAvg') ? listVisibility.anime === false :
      (card.key === 'statsGameHours' || card.key === 'statsGamesAvg') ? listVisibility.games === false : false;
    const visible = !hiddenByListTab && (!card.optional || visibility[card.key] !== false);
    if (!visible && !editing) return '';
    if (hiddenByListTab && editing) return '';
    const toggle = card.optional && editing
      ? `<label class="profile-stat-toggle"><input type="checkbox" class="profile-section-toggle-input" data-profile-visible-key="${escAttr(card.key)}" ${visible ? 'checked' : ''} onchange="toggleProfileStatVisibility('${escAttr(card.key)}', this.checked)"> Display</label>`
      : '';
    return `
      <div class="profile-stat-card profile-stat-${escAttr(card.tone || 'default')} ${visible ? '' : 'profile-stat-hidden'}">
        ${toggle}
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

function getProfileFavoriteConfig(key) { return PROFILE_DATABASE_FAVORITES.find(group => group.key === key) || PROFILE_MANUAL_FAVORITES.find(group => group.key === key) || null; }
function isProfileNoRatingFavoriteKey(key) {
  return ['fictionalCharacters', 'actors', 'directors', 'musicArtists'].includes(String(key || ''));
}
function getProfileSlotRankText(index, dotted = false) {
  const n = Number(index) + 1;
  return Number.isFinite(n) && n > 0 ? `${n}${dotted ? '.' : ''}` : '';
}
function renderGoldStarIconHTML(extraClass = '') {
  return `<span class="screenlist-gold-star-icon ${escAttr(extraClass)}" aria-hidden="true">★</span>`;
}
function renderProfileRatingValueHTML(value) {
  const text = formatProfileFavoriteRatingDisplay(value, '');
  return text ? `${renderGoldStarIconHTML('profile-rating-star')}<span>${escHtml(text)}</span>` : '';
}
function getProfileStatLabelHTML(key) {
  const text = getProfileStatLabel(key);
  return key.endsWith('Avg') ? `${renderGoldStarIconHTML('profile-stat-label-star')}<span>${escHtml(text)}</span>` : escHtml(text);
}
function getProfileStatValueHTML(stats, key) {
  const value = getProfileStatValue(stats, key);
  return key.endsWith('Avg') ? `${renderGoldStarIconHTML('profile-stat-value-star')}<span>${escHtml(value)}</span>` : escHtml(value);
}
function getProfileSummaryCardValueHTML(card, visible) {
  const value = visible ? card.value : 'Hidden';
  return card.tone === 'score' && visible ? `${renderGoldStarIconHTML('profile-stat-value-star')}<span>${escHtml(value)}</span>` : escHtml(value);
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
function getProfilePickerEmptyText() {
  return '';
}
function getProfileRatingInputRequired(config) {
  return !isProfileNoRatingFavoriteKey(config?.key);
}
function getProfilePickerSubtext(config, mode = 'database') {
  if (mode === 'manual') return 'Add the name and optional image for this profile spot.';
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
function getProfilePlaceholderText(key, index) {
  return isProfileNoRatingFavoriteKey(key) ? getProfilePosterEmptyText(index) : getProfilePosterEmptyText(index);
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
function getProfileRatingPreviewAttr(key, manual = false) {
  return isProfileNoRatingFavoriteKey(key) ? '' : `data-${manual ? 'manual' : 'db'}-rating-preview`;
}
function getProfileRatingPreviewHTML(key, value, manual = false) {
  if (isProfileNoRatingFavoriteKey(key)) return '';
  return `${renderGoldStarIconHTML('profile-fav-rating-star')}<span>${escHtml(formatProfileFavoriteRatingDisplay(value, 'Tap to rate'))}</span>`;
}
function getProfilePickerSelectedFallback(hit, state) {
  return hit.image ? '' : getProfilePickerImageFallbackHTML();
}
function getProfileSearchResultFallback(hit, state) {
  return hit.image ? '' : getProfilePickerImageFallbackHTML();
}
function getProfileRowIconHTML(group) {
  return '';
}
function getProfileGroupTitleHTML(group) {
  return `<span>${escHtml(group.title)}</span>`;
}
function getProfileStatSubLabelHTML(card) {
  return escHtml(card.labelSub);
}
function getProfileStatsMainLabelHTML(card) {
  return card.tone === 'score'
    ? `${renderGoldStarIconHTML('profile-stat-label-star')}<span>${escHtml(card.labelMain)}</span>`
    : escHtml(card.labelMain);
}
function getProfileFavoriteRankLabel(index) {
  return getProfileSlotRankText(index, true);
}
function getProfileFavoriteEmptyPoster(index) {
  return getProfileImageFallbackHTML(index);
}
function getProfileFavoriteTitleFallback(editing, manual = false) {
  return editing ? (manual ? 'Tap poster to add' : 'Tap poster to choose') : 'Empty';
}
function getProfileFavoritePickerResultFallback(state) {
  return getProfilePickerImageFallbackHTML();
}
function getProfileFavoriteSelectedFallback(state) {
  return state?.hit?.image ? '' : getProfilePickerImageFallbackHTML();
}
function getProfileFavoriteNoRatingInput(config) {
  return getProfileRatingInputRequired(config) ? '' : ' profile-no-rating-favorite';
}
function getProfileFavoriteCleanRating(value, placeholder = 'Tap to rate') {
  return formatProfileFavoriteRatingDisplay(value, placeholder);
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
    movieHours: 'Movies · Hours Watched',
    tvHours: 'TV Shows · Hours Watched',
    animeHours: 'Anime · Hours Watched',
    gameHours: 'Games · Hours Played',
    movieAvg: 'Average Score · Movies',
    tvAvg: 'Average Score · TV Shows',
    animeAvg: 'Average Score · Anime',
    gamesAvg: 'Average Score · Video Games'
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
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*10)?$/);
    if (!match) return normalized;
    return match[1];
  };
  if (!raw) return placeholder;
  if (/^⭐/.test(raw) || /^★/.test(raw)) return compactMobile ? compact(raw) : raw.replace(/^★\s*/, '').replace(/^⭐\s*/, '');
  if (/^\d+(\.\d+)?\s*(\/\s*10)?$/.test(raw)) {
    const clean = raw.includes('/') ? raw.replace(/\s+/g, '') : raw + '/10';
    return compactMobile ? compact(clean) : clean;
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
  return config.source === 'rawg' ? 'RAWG' : 'TMDB';
}

function getProfileFavoriteCard(section, index) {
  return Array.from(document.querySelectorAll('.profile-db-slot')).find(card => card.dataset.profileDbSection === String(section) && card.dataset.profileDbIndex === String(index)) || null;
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

  const patch = {
    pinnedFavorites: userProfile.pinnedFavorites || getDefaultPinnedFavorites(),
    showcaseFavorites: userProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
    profileVisibility: userProfile.profileVisibility || getDefaultProfileVisibility(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
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
    if (typeof showToast === 'function') showToast('sync failed');
    return false;
  }
}

function openProfileFavoritePicker(event, card) {
  if (isViewingOtherProfile() || !card) return;
  if (event) event.stopPropagation();
  if (card.classList.contains('profile-manual-slot')) {
    openProfileManualFavoritePicker(event, card);
    return;
  }
  const section = card.dataset.profileDbSection;
  const index = Number(card.dataset.profileDbIndex || 0);
  const config = getProfileFavoriteConfig(section);
  if (!config) return;
  profileFavoritePickerState = { mode: 'database', section, index, config, card, query: '', results: [], hit: null, rating: card.dataset.profileDbRating || '', libraryRating: '' };
  renderProfileFavoritePickerSearch();
}

function renderProfileFavoritePickerShell(inner) {
  const overlay = ensureProfileFavoritePickerModal();
  overlay.innerHTML = `<div class="profile-favorite-picker-modal" role="dialog" aria-modal="true">
    <div class="profile-picker-head">
      <div><div class="profile-picker-title">${escHtml(profileFavoritePickerState?.title || 'Choose Favorite')}</div><div class="profile-picker-sub">${escHtml(profileFavoritePickerState?.sub || '')}</div></div>
      <button type="button" class="profile-picker-close" onclick="closeProfileFavoritePicker()" aria-label="Close">×</button>
    </div>
    ${inner}
  </div>`;
  overlay.classList.add('open');
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
    const hits = state.config.source === 'rawg' ? await searchProfileRawgFavorites(query) : await searchProfileTmdbFavorites(state.config, query);
    if (!profileFavoritePickerState || profileFavoritePickerState !== state || searchSeq !== profileFavoritePickerSearchSeq) return;
    state.results = hits.slice(0, 8);
    if (!state.results.length) {
      resultsEl.innerHTML = '<div class="profile-picker-message">No results found.</div>';
      return;
    }
    resultsEl.innerHTML = state.results.map((hit, i) => {
      const thumb = hit.image ? `<img src="${escAttr(hit.image)}" alt="">` : getProfileFavoritePickerResultFallback(state);
      return `<button type="button" class="profile-picker-result" onclick="selectProfileFavoritePickerResult(${i})">
        <div class="profile-picker-result-img">${thumb}</div>
        <div class="profile-picker-result-copy"><strong>${escHtml(hit.title || 'Untitled')}</strong><span>${escHtml(hit.meta || getProfileDatabaseSearchLabel(state.config))}</span></div>
      </button>`;
    }).join('');
  } catch(e) {
    console.error('Profile favorite picker search failed:', e);
    if (!profileFavoritePickerState || profileFavoritePickerState !== state || searchSeq !== profileFavoritePickerSearchSeq) return;
    resultsEl.innerHTML = '<div class="profile-picker-message">Search failed. Try again.</div>';
  }
}

function selectProfileFavoritePickerResult(resultIndex) {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database') return;
  const hit = state.results?.[resultIndex];
  if (!hit) return;
  state.hit = hit;
  state.libraryRating = getProfileLibraryRatingForFavorite(state.config, hit);
  state.rating = state.libraryRating || '';
  renderProfileFavoritePickerConfirm();
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
  card.dataset.profileDbLegacyId = '';
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

function handleProfileDatabaseRatingInput(input) {
  updateProfileDatabaseCardPreview(input.closest('.profile-db-slot'));
  if (userProfile) readProfileDraftFromPage(userProfile);
  saveProfileFavoritesAuto('saved', { debounceMs: 500 });
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

function renderDatabaseFavoriteRow(key, pins) {
  const config = getProfileFavoriteConfig(key);
  if (!config) return '';
  const visible = isProfileRowVisible(key);
  const editing = !isViewingOtherProfile();
  const rowHead = `<div class="profile-fav-row-head"><div class="profile-fav-row-title">${escHtml(config.label)}</div>${renderProfileVisibilityToggle(key)}</div>`;
  if (!visible) return editing ? `<div class="profile-fav-row">${rowHead}<div class="profile-hidden-note">Hidden from profile. Toggle Display to show this row again.</div></div>` : '';
  const slots = [0,1,2].map(i => {
    const entry = getProfileDatabaseFavoriteDisplay(config, pins[config.key]?.[i]);
    const title = entry.title || '';
    const image = entry.image || '';
    const rating = isProfileNoRatingFavoriteKey(config.key) ? '' : (entry.rating || '');
    const cover = image ? `style="background-image:url('${escAttr(image)}')"` : '';
    const canOpenProfile = !editing && !!entry.id && !!title;
    const posterClick = editing
      ? `onclick="openProfileFavoritePicker(event, this.closest('.profile-fav-poster-card'))" title="Click to search title"`
      : (canOpenProfile ? `onclick="openProfileDatabaseFavorite(event, this.closest('.profile-fav-poster-card'))" title="Open profile"` : '');
    const openClass = canOpenProfile ? ' profile-db-openable' : '';
    const nameClick = canOpenProfile ? `onclick="openProfileDatabaseFavorite(event, this.closest('.profile-fav-poster-card'))" title="Open profile"` : '';
    return `<div class="profile-fav-poster-card profile-db-slot${openClass}${getProfileFavoriteNoRatingInput(config)}" data-profile-db-section="${escAttr(config.key)}" data-profile-db-index="${i}" data-profile-db-id="${escAttr(entry.id)}" data-profile-db-source="${escAttr(entry.source)}" data-profile-db-type="${escAttr(entry.type)}" data-profile-db-title="${escAttr(title)}" data-profile-db-image="${escAttr(image)}" data-profile-db-meta="${escAttr(entry.meta)}" data-profile-db-legacy-id="${escAttr(entry.legacyId)}" data-profile-db-rating="${escAttr(rating)}">
      ${getProfileCardRankHTML(i)}
      <div class="profile-fav-poster ${editing ? 'profile-fav-poster-action' : ''}" ${getProfileFavoritePosterAttrs(i)} ${cover} ${posterClick}>${getProfileFavoritePosterContent(image, i)}</div>
      <div class="profile-fav-name ${title ? '' : 'profile-fav-empty'}" data-db-name-preview ${nameClick}>${getProfileTitleHtml(title, editing, false)}</div>
      ${getProfileFavoriteDisplayRatingHTML(config.key, rating, false)}
    </div>`;
  }).join('');
  return `<div class="profile-fav-row">${rowHead}<div class="profile-fav-poster-grid">${slots}</div></div>`;
}

function renderManualFavoriteRow(key, showcase) {
  const config = getProfileFavoriteConfig(key);
  if (!config) return '';
  const visible = isProfileRowVisible(key);
  const editing = !isViewingOtherProfile();
  const rowHead = `<div class="profile-fav-row-head"><div class="profile-fav-row-title">${escHtml(config.label)}</div>${renderProfileVisibilityToggle(key)}</div>`;
  if (!visible) return editing ? `<div class="profile-fav-row">${rowHead}<div class="profile-hidden-note">Hidden from profile. Toggle Display to show this row again.</div></div>` : '';
  const entries = showcase[key] || [0,1,2].map(() => getEmptyManualFavorite());
  const slots = [0,1,2].map(i => {
    const entry = entries[i] || getEmptyManualFavorite();
    const rating = isProfileNoRatingFavoriteKey(key) ? '' : (entry.rating || '');
    const cover = entry.image ? `style="background-image:url('${escAttr(entry.image)}')"` : '';
    const posterClick = editing ? `onclick="openProfileFavoritePicker(event, this.closest('.profile-fav-poster-card'))" title="Click to edit"` : '';
    return `<div class="profile-fav-poster-card profile-manual-slot${getProfileFavoriteNoRatingInput(config)}" data-manual-section="${escAttr(key)}" data-manual-index="${i}" data-manual-name="${escAttr(entry.name)}" data-manual-image="${escAttr(entry.image)}" data-manual-rating="${escAttr(rating)}">
      ${getProfileCardRankHTML(i)}
      <div class="profile-fav-poster ${editing ? 'profile-fav-poster-action' : ''} profile-manual-preview" ${getProfileFavoritePosterAttrs(i)} ${cover} ${posterClick}>${getProfileFavoritePosterContent(entry.image, i)}</div>
      <div class="profile-fav-name ${entry.name ? '' : 'profile-fav-empty'}" data-manual-name-preview>${getProfileTitleHtml(entry.name, editing, true)}</div>
      ${getProfileFavoriteDisplayRatingHTML(key, rating, true)}
    </div>`;
  }).join('');
  return `<div class="profile-fav-row">${rowHead}<div class="profile-fav-poster-grid">${slots}</div></div>`;
}

function renderProfileMediaGroup(group, stats, pins, showcase) {
  const statHtml = group.statKeys.length ? `<div class="profile-group-stats">${group.statKeys.map(key => `<div class="profile-group-stat"><div class="profile-group-stat-value">${getProfileStatValueHTML(stats, key)}</div><div class="profile-group-stat-label">${getProfileStatLabelHTML(key)}</div></div>`).join('')}</div>` : '';
  const rows = group.rows.map(rowKey => PROFILE_DATABASE_FAVORITES.some(item => item.key === rowKey) ? renderDatabaseFavoriteRow(rowKey, pins) : renderManualFavoriteRow(rowKey, showcase)).join('');
  return `<section class="profile-media-group ${group.wide ? 'profile-media-group-wide' : ''}" data-profile-group="${escAttr(group.key)}"><div class="profile-media-head"><div class="profile-media-title-wrap"><div class="profile-media-title">${getProfileGroupTitleHTML(group)}</div><div class="profile-media-sub">${escHtml(group.sub)}</div></div></div>${statHtml}${rows}</section>`;
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
function handleManualFavoriteInput(input) {
  const card = input.closest('.profile-manual-slot');
  if (!card) return;
  const nameInput = card.querySelector('[data-profile-manual-field="name"]');
  const ratingInput = card.querySelector('[data-profile-manual-field="rating"]');
  const imageInput = card.querySelector('[data-profile-manual-field="image"]');
  const namePreview = card.querySelector('[data-manual-name-preview]');
  const ratingPreview = card.querySelector('[data-manual-rating-preview]');
  const poster = card.querySelector('.profile-manual-preview');
  const section = input.dataset.profileManualSection;
  const index = Number(card.dataset.manualIndex || 0);
  if (namePreview) { const name = (nameInput?.value || '').trim(); namePreview.textContent = name || 'Tap poster to add'; namePreview.classList.toggle('profile-fav-empty', !name); }
  if (ratingPreview) { const rating = isProfileNoRatingFavoriteKey(section) ? '' : (ratingInput?.value || '').trim(); setProfileFavoriteRatingPreview(ratingPreview, section, rating, 'Tap to rate'); }
  if (poster) {
    const image = (imageInput?.value || '').trim();
    poster.style.backgroundImage = image ? `url('${image.replace(/'/g, "%27")}')` : '';
    poster.innerHTML = getProfileFavoritePosterContent(image, index);
  }
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
  grid.innerHTML = PROFILE_MEDIA_GROUPS
    .filter(group => isProfileSectionVisibleFromListTabs(group.key, profile))
    .map(group => renderProfileMediaGroup(group, stats, pins, showcase))
    .join('');
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
  const editing = !isViewingOtherProfile();
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
  const editing = !isViewingOtherProfile();
  const visibleLinks = PROFILE_MOBILE_LINK_CONFIG.map(link => {
    const visible = !link.optionalMobile || visibility[link.visibilityKey] !== false;
    if (!visible && !editing) return '';
    const href = safeProfileUrl(links[link.key] || '');
    const hiddenClass = visible ? '' : 'mobile-link-hidden';
    const emptyClass = href ? '' : 'empty';
    const toggle = link.optionalMobile && editing
      ? `<label class="profile-mobile-link-toggle" title="Show ${escAttr(link.label)} on profile"><input type="checkbox" class="profile-section-toggle-input" data-profile-visible-key="${escAttr(link.visibilityKey)}" ${visible ? 'checked' : ''} onchange="toggleProfileLinkVisibility('${escAttr(link.visibilityKey)}', this.checked)"></label>`
      : '';
    return `<div class="profile-mobile-link-wrap">
      ${toggle}
      <button type="button" class="profile-mobile-link-badge ${emptyClass} ${hiddenClass}" onclick="handleProfileMobileLinkClick(event, '${escAttr(link.key)}')" aria-label="${escAttr(link.label)} profile link" title="${escAttr(link.label)}">
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

  if (!isViewingOtherProfile()) {
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

  const toggleHtml = link.optionalMobile ? `
    <div class="plm-toggle-row">
      <span class="plm-toggle-label">Show on profile</span>
      <label class="plm-toggle-track">
        <input type="checkbox" id="plm-visibility" ${isVisible ? 'checked' : ''}>
        <span class="plm-toggle-thumb"></span>
      </label>
    </div>` : '';

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
    userProfile.profileVisibility[link.visibilityKey] = visCheck.checked;
  }
  closeProfileLinkModal();
  renderProfileLinks();
  renderProfileMobileLinks();
  showToast(input.value.trim() ? `${link.label} link updated` : `${link.label} link removed`);
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
  const heroCard = document.querySelector('.profile-hero-card');
  let heroLogoutBtn = document.getElementById('profile-card-logout-btn');
  if (heroCard && !heroLogoutBtn) {
    heroCard.insertAdjacentHTML('afterbegin', '<button type="button" id="profile-card-logout-btn" class="profile-card-logout-btn" onclick="openSignOutModal()">Log out</button>');
    heroLogoutBtn = document.getElementById('profile-card-logout-btn');
  }
  const creativeTeamProfile = isCreativeTeamUser(profile);
  if (profilePage) {
    profilePage.classList.toggle('viewing-other-profile', viewingOther);
    profilePage.classList.toggle('own-profile-view', !viewingOther && !!currentUser);
    profilePage.classList.toggle('landing-public-profile', landingPublicProfileActive && !currentUser);
    profilePage.classList.toggle('own-creator-profile', !viewingOther && isCreatorAdmin(profile));
    profilePage.classList.toggle('creative-team-profile', creativeTeamProfile);
    profilePage.classList.toggle('settings-open', profileSettingsOpen && !viewingOther);
  }
  document.body.classList.toggle('own-profile-active', !!document.body.classList.contains('profile-active') && !viewingOther && !!currentUser);
  if (settingsPage) settingsPage.style.display = profileSettingsOpen && !viewingOther ? 'block' : 'none';
  if (titleEl) titleEl.textContent = viewingOther ? `${getViewingProfileName()}'s Profile` : 'Profile Studio';
  if (subEl) subEl.textContent = viewingOther ? 'Stats, favorites, linked profiles, and personal showcase' : 'Customize your ScreenList home page';
  if (saveBtn) saveBtn.style.display = viewingOther ? 'none' : '';
  if (viewListsBtn) {
    viewListsBtn.textContent = viewingOther ? 'View Lists' : 'My Lists';
    viewListsBtn.style.display = (profileSettingsOpen && !viewingOther) ? 'none' : '';
  }
  if (heroLogoutBtn) heroLogoutBtn.style.display = viewingOther || isPreviewMode() ? 'none' : '';
  if (avatarActions) avatarActions.style.display = viewingOther ? 'none' : '';
  if (nameInput) {
    nameInput.value = profile.name || '';
    nameInput.readOnly = viewingOther;
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
  if (creatorBadge) {
    if (isCreatorAdmin(profile)) {
      creatorBadge.innerHTML = '<span>👑 Admin Account</span><span class="creator-role">(Developer And Creator)</span>';
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
  if (bioInput) {
    bioInput.value = profile.bio || (viewingOther ? 'No bio yet.' : '');
    bioInput.readOnly = viewingOther;
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
}

function renderProfileSettingsPage() {
  if (isViewingOtherProfile()) return;
  const themeMode = normalizeThemeMode(
    userProfile?.themeMode ||
    (document.body.classList.contains('light-mode') ? 'light' : document.body.classList.contains('true-dark-mode') ? 'true-dark' : 'default')
  );
  const prefs = normalizeRatingPreferences(readProfileFromPage()?.ratingPreferences);
  const themeDefault = document.getElementById('theme-mode-default');
  const themeLight = document.getElementById('theme-mode-light');
  const themeTrueDark = document.getElementById('theme-mode-true-dark');
  if (themeDefault) themeDefault.checked = themeMode === 'default';
  if (themeLight) themeLight.checked = themeMode === 'light';
  if (themeTrueDark) themeTrueDark.checked = themeMode === 'true-dark';
  const mediaTen = document.getElementById('rating-pref-media-ten');
  const mediaFive = document.getElementById('rating-pref-media-five');
  const gamesTen = document.getElementById('rating-pref-games-ten');
  const gamesFive = document.getElementById('rating-pref-games-five');
  if (mediaTen) mediaTen.checked = prefs.media !== 'five';
  if (mediaFive) mediaFive.checked = prefs.media === 'five';
  if (gamesTen) gamesTen.checked = prefs.games !== 'five';
  if (gamesFive) gamesFive.checked = prefs.games === 'five';
  const animeTitleMode = getAnimeTitleDisplayMode(userProfile || {});
  const animeTitleEnglish = document.getElementById('anime-title-pref-english');
  const animeTitleRomaji = document.getElementById('anime-title-pref-romaji');
  const animeTitleJapanese = document.getElementById('anime-title-pref-japanese');
  if (animeTitleEnglish) animeTitleEnglish.checked = animeTitleMode === 'english';
  if (animeTitleRomaji) animeTitleRomaji.checked = animeTitleMode === 'romaji';
  if (animeTitleJapanese) animeTitleJapanese.checked = animeTitleMode === 'japanese';
}

function readProfileRatingPreferencesFromPage() {
  if (isViewingOtherProfile()) return normalizeRatingPreferences(getActiveProfile()?.ratingPreferences);
  return normalizeRatingPreferences({
    media: document.getElementById('rating-pref-media-five')?.checked ? 'five' : 'ten',
    games: document.getElementById('rating-pref-games-five')?.checked ? 'five' : 'ten'
  });
}

function readThemeModeFromPage() {
  if (isViewingOtherProfile()) return normalizeThemeMode(userProfile?.themeMode);
  if (document.getElementById('theme-mode-light')?.checked) return 'light';
  if (document.getElementById('theme-mode-true-dark')?.checked) return 'true-dark';
  return 'default';
}

function readAnimeTitleDisplayModeFromPage() {
  if (isViewingOtherProfile()) return getAnimeTitleDisplayMode(userProfile || {});
  if (document.getElementById('anime-title-pref-romaji')?.checked) return 'romaji';
  if (document.getElementById('anime-title-pref-japanese')?.checked) return 'japanese';
  return 'english';
}

async function saveProfileSettingsPatch(patch = {}) {
  if (!userProfile) userProfile = normalizeUserProfile({});
  Object.assign(userProfile, patch);

  if (isPreviewMode() || !currentUser) return true;

  try {
    await db.collection("users").doc(currentUser.uid).set({
      ...patch,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    usersMap[currentUser.uid] = {
      ...(usersMap[currentUser.uid] || {}),
      uid: currentUser.uid,
      ...patch
    };
    return true;
  } catch (e) {
    console.error("Settings auto-save failed:", e);
    showToast("Setting changed locally, but sync failed");
    return false;
  }
}

async function handleThemeModeChange(mode) {
  if (isViewingOtherProfile()) return;
  const normalized = applyThemeMode(mode, true);
  await saveProfileSettingsPatch({ themeMode: normalized });

  const themeDefault = document.getElementById('theme-mode-default');
  const themeLight = document.getElementById('theme-mode-light');
  const themeTrueDark = document.getElementById('theme-mode-true-dark');
  if (themeDefault) themeDefault.checked = normalized === 'default';
  if (themeLight) themeLight.checked = normalized === 'light';
  if (themeTrueDark) themeTrueDark.checked = normalized === 'true-dark';
  document.body.getBoundingClientRect();
}

async function handleAnimeTitlePreferenceChange(mode) {
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
      showcaseFavorites: userProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
      emailLower: accountEmailLower,
      accountEmailLower: accountEmailLower,
      isCreatorAdmin: creatorAccount,
      isPublic: creatorAccount,
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
      showcaseFavorites: userProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
      emailLower: accountEmailLower,
      accountEmailLower: accountEmailLower,
      isCreatorAdmin: creatorAccount,
      isPublic: creatorAccount
    };
    await syncCreatorPublicProfileMirror(user, userProfile, creatorAccount ? data : null);
    applyThemeMode(userProfile.themeMode || getDefaultThemeMode(), true);
    applyProfile();
  } catch(e) { console.error("Profile save failed:", e); }
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
    source: section === 'games' ? 'rawg' : 'tmdb',
    type: section === 'games' ? 'game' : section === 'movies' ? 'movie' : 'tv',
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
  profileReturnTab = viewingUser ? viewingReturnTab : (getActiveMainTab ? getActiveMainTab() : 'community');
  profileViewingUser = { uid: user.uid, name: user.name, photo: user.photo, preview: true };
  profileViewingProfile = buildPreviewProfileForUser(user);
  profileViewingData = cloneListData(user.listData || getEmptyListData());
  openProfilePageShell();
}

async function loadPublicProfileListData(uid, options = {}) {
  try {
    const snap = await db.collection('watchlist').doc(uid).get();
    if (!snap.exists) return getEmptyListData();
    const d = snap.data();
    const loaded = {
      shows: d.shows ? JSON.parse(d.shows) : [],
      movies: d.movies ? JSON.parse(d.movies) : [],
      anime: d.anime ? JSON.parse(d.anime) : [],
      games: d.games ? JSON.parse(d.games) : [],
      manga: d.manga ? JSON.parse(d.manga) : [],
      books: d.books ? JSON.parse(d.books) : []
    };
    return await autoSortAnimeBuckets(normalizeListData(loaded), false);
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
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return false;
    const u = userDoc.data() || {};
    usersMap[uid] = { ...u, uid: u.uid || uid };
    if (shouldExposeInUserSearch({ ...u, uid: u.uid || uid })) return true;
    if (!friends.includes(uid)) return false;
    const theirFriends = Array.isArray(u.friends) ? u.friends : [];
    return theirFriends.includes(currentUser.uid);
  } catch(e) {
    console.error('Profile privacy check failed:', e);
    return false;
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
  profileReturnTab = viewingUser ? viewingReturnTab : (getActiveMainTab ? getActiveMainTab() : 'community');
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
  document.body.classList.add('profile-active');
  if (commentsPage) commentsPage.style.display = 'none';
  if (activityPage) activityPage.classList.remove('active');
  syncActivityPageQuickActions();
  setBottomNavVisibility(false);
  renderProfilePage();
  const profilePage = document.getElementById('profile-page');
  if (profilePage) {
    profilePage.style.display = 'block';
    profilePage.scrollTo({ top: 0, behavior: 'auto' });
    bindProfilePageSwipeBack(profilePage);
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function openProfile() {
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  profileSettingsOpen = false;
  if (!userProfile) userProfile = normalizeUserProfile({});
  profileReturnTab = getActiveMainTab ? getActiveMainTab() : 'mylist';
  openProfilePageShell();
}

function openProfileSettingsFocus() {
  if (isViewingOtherProfile()) return;
  profileSettingsOpen = true;
  renderProfilePage();
  const settingsPage = document.getElementById('profile-settings-page');
  settingsPage?.scrollTo({ top: 0, behavior: 'auto' });
  setTimeout(() => document.getElementById('rating-pref-media-ten')?.focus(), 80);
}

function closeProfileSettingsPage() {
  profileSettingsOpen = false;
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

  document.body.classList.remove('profile-active');
  setBottomNavVisibility(true);
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;

  if (viewingUser && viewingUser.uid === targetUser.uid) {
    syncMainNavButtons('mylist');
    setMainNavVisibility('mylist');
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  await viewUserList(targetUser.uid, targetUser.name || 'Friend', targetUser.photo || '');
}



function bindProfilePageSwipeBack(profilePage = document.getElementById('profile-page')) {
  if (!profilePage || profilePage.dataset.profileSwipeBackBound === 'true') return;
  profilePage.dataset.profileSwipeBackBound = 'true';
  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocityX = 0, viewportW = 0;
  let canSwipe = false, swiping = false, pointerId = null, rafId = 0, pendingX = 0;
  const applyFrame = () => {
    rafId = 0;
    const x = Math.max(0, Math.min(pendingX, viewportW || 390));
    const progress = Math.min(1, x / Math.max(1, viewportW || 390));
    profilePage.style.transform = `translate3d(${x}px, 0, 0)`;
    profilePage.style.boxShadow = `-${Math.round(18 + progress * 12)}px 0 ${Math.round(44 + progress * 18)}px rgba(0,0,0,${Math.max(0.12, 0.34 - progress * 0.20)})`;
  };
  const scheduleFrame = () => { if (!rafId) rafId = requestAnimationFrame(applyFrame); };
  const clearFrame = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
  const reset = () => {
    clearFrame(); canSwipe = false; swiping = false; pointerId = null; pendingX = 0;
    profilePage.classList.remove('profile-swipe-back-dragging', 'profile-swipe-back-snapping');
    document.body.classList.remove('profile-swipe-back-active');
    profilePage.style.transition = ''; profilePage.style.transform = ''; profilePage.style.willChange = ''; profilePage.style.boxShadow = '';
    profilePage.style.borderTopLeftRadius = ''; profilePage.style.borderBottomLeftRadius = ''; profilePage.style.touchAction = '';
  };
  const arm = () => {
    if (swiping) return; swiping = true;
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
    clearFrame(); profilePage.classList.add('profile-swipe-back-snapping');
    profilePage.style.transition = 'transform 0.22s cubic-bezier(0.18, 0.92, 0.18, 1), box-shadow 0.22s ease';
    profilePage.style.transform = 'translate3d(105vw, 0, 0)'; profilePage.style.boxShadow = '-10px 0 24px rgba(0,0,0,0.10)';
    window.setTimeout(() => { reset(); closeProfile(); }, 225);
  };
  const start = event => {
    const point = event.touches?.[0] || event; if (!point) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.touches && event.touches.length !== 1) return;
    if (point.clientX > 48) return;
    if (event.target?.closest?.('button, a, input, textarea, select, [contenteditable="true"], .profile-favorites-grid, .profile-links-grid')) return;
    startX = point.clientX; startY = point.clientY; lastX = startX; lastT = performance.now(); velocityX = 0; viewportW = window.innerWidth || 390;
    canSwipe = true; swiping = false; pointerId = event.pointerId ?? null;
  };
  const move = event => {
    if (!canSwipe) return; const point = event.touches?.[0] || event; if (!point) return;
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    const dx = point.clientX - startX, dy = point.clientY - startY, absDx = Math.abs(dx), absDy = Math.abs(dy);
    if (!swiping) {
      if (dx > 14 && absDx > absDy * 1.35) { arm(); try { profilePage.setPointerCapture?.(event.pointerId); } catch(e) {} }
      else if (absDy > absDx * 1.12) { canSwipe = false; return; }
      else return;
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now(); const dt = Math.max(1, now - lastT);
    velocityX = (point.clientX - lastX) / dt; lastX = point.clientX; lastT = now; pendingX = Math.max(0, Math.min(viewportW, dx)); scheduleFrame();
  };
  const end = event => {
    if (!canSwipe && !swiping) return; const point = event.changedTouches?.[0] || event; const dx = point ? point.clientX - startX : pendingX;
    try { if (pointerId !== null) profilePage.releasePointerCapture?.(pointerId); } catch(e) {}
    if (swiping) { const shouldClose = dx >= viewportW * 0.34 || (dx > 58 && velocityX > 0.75); shouldClose ? completeBack() : snapBack(); }
    else reset();
  };
  if (window.PointerEvent) { profilePage.addEventListener('pointerdown', start, { passive: true }); profilePage.addEventListener('pointermove', move, { passive: false }); profilePage.addEventListener('pointerup', end, { passive: true }); profilePage.addEventListener('pointercancel', reset, { passive: true }); }
  profilePage.addEventListener('touchstart', start, { passive: true }); profilePage.addEventListener('touchmove', move, { passive: false }); profilePage.addEventListener('touchend', end, { passive: true }); profilePage.addEventListener('touchcancel', reset, { passive: true });
}

function closeProfile() {
  if (landingPublicProfileActive || !currentUser) {
    profileSettingsOpen = false;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    document.body.classList.remove('own-profile-active');
    showLandingPage();
    return;
  }
  profileSettingsOpen = false;
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  if (profileReturnTab === 'games-discover') {
    activeDiscoveryHub = 'gaming';
    profileReturnTab = 'discover';
  }
  document.body.classList.remove('profile-active', 'landing-public-lists');
  setBottomNavVisibility(true);
  setMainNavVisibility(profileReturnTab || 'mylist');
  if (profileReturnTab === 'community') loadCommunity();
  if (profileReturnTab === 'discover') loadActiveDiscoveryHub();
  if ((profileReturnTab || 'mylist') === 'mylist') render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function applyThemeMode(mode, persist = true) {
  const normalized = normalizeThemeMode(mode);
  document.body.classList.remove('light-mode', 'true-dark-mode');
  if (normalized === 'light') document.body.classList.add('light-mode');
  if (normalized === 'true-dark') document.body.classList.add('true-dark-mode');
  if (persist) {
    localStorage.setItem('theme-mode', normalized);
    localStorage.setItem('theme', normalized === 'light' ? 'light' : 'dark');
  }
  return normalized;
}

function toggleTheme(isLight) {
  applyThemeMode(isLight ? 'light' : 'default', true);
}

// Restore saved theme on load
(function() {
  const saved = localStorage.getItem('theme-mode');
  if (saved) {
    applyThemeMode(saved, false);
    return;
  }
  if (localStorage.getItem('theme') === 'light') {
    applyThemeMode('light', false);
    return;
  }
  applyThemeMode('default', false);
})();

function previewProfilePhoto(url) {
  const preview = document.getElementById("profile-preview");
  if (url.trim()) {
    preview.src = url.trim();
    preview.onerror = () => { preview.src = 'https://ui-avatars.com/api/?name=?&background=1c1535&color=a78bfa'; };
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
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function getShareProfileUrl() {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.delete('preview');
  const uid = profileViewingUser?.uid || profileViewingProfile?.uid || userProfile?.uid || currentUser?.uid || '';
  if (uid && uid !== 'preview-user') url.searchParams.set('profile', uid);
  else url.searchParams.delete('profile');
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
  const profileName = activeProfile?.name || currentUser?.displayName || 'ScreenList Profile';
  const shareData = {
    title: `${profileName} on ScreenList`,
    text: `Check out ${profileName}'s ScreenList profile.`,
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

async function saveProfile() {
  if (isViewingOtherProfile()) { showToast('This is a read-only profile'); return; }
  const nextProfile = readProfileFromPage();
  userProfile = nextProfile;
  if (isPreviewMode() || !currentUser) {
    applyProfile();
    renderProfilePage();
    showToast("Preview profile updated");
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
  renderProfilePage();
  showToast("Profile updated");
}
