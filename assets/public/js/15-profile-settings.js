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
let profileEditModeOpen = false;
let profileSharedFavoriteFocus = null;
let profileSharedFavoriteOpening = false;

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
let _mylistSettingsScrollY = 0;
const MYLIST_CLEAR_CATEGORY_SECTIONS = [
  { key: 'shows', label: 'TV Shows' },
  { key: 'movies', label: 'Movies' },
  { key: 'anime', label: 'Anime' },
  { key: 'games', label: 'Games' },
  { key: 'manga', label: 'Manga' },
  { key: 'books', label: 'Books' }
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
  const profilePhoto = userProfile?.photo || currentUser?.photoURL || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(profileName) + '&background=1c1535&color=a78bfa');

  if (profileHost) {
    // v429: avoid avatar flicker on category switch. Only rebuild the avatar
    // shortcut when the profile name/photo (or signed-in state) actually changes.
    // Re-rendering innerHTML on every render() destroys the <img>, which made
    // the avatar momentarily blank during pager transitions.
    const stateKey = currentUser
      ? `signed:${profileName}::${profilePhoto}`
      : 'anon';
    if (profileHost.dataset.shelfdProfileKey !== stateKey) {
      const currentBio = (userProfile?.bio || '').trim();
      const profileShortcut = currentUser ? `
    <div class="mylist-own-profile-center">
      <button type="button" class="mylist-own-profile-shortcut" onclick="openProfile()" aria-label="Open my profile" title="Open my profile">
        <img src="${escAttr(profilePhoto)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(profileName).replace(/'/g, '%27')}&background=1c1535&color=a78bfa'">
      </button>
      <div class="mylist-own-profile-name">${escHtml(profileName)}</div>
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
    <div class="mylist-settings-import-box">
      <div class="mylist-settings-row">
        <span class="mylist-settings-row-label">Import Lists</span>
        <button type="button" class="mylist-settings-action-btn" onclick="event.stopPropagation();closeMyListSettingsModal();setTimeout(openImportPage,180)">Import</button>
      </div>
    </div>
    <div class="mylist-settings-milky-divider"></div>
    <div class="mylist-settings-section-label">Clear Category Data</div>
    <div class="mylist-settings-clear-section">
      ${renderMyListCategoryClearRows()}
    </div>`;
}

function openMyListSettingsModal(triggerEl) {
  if (document.getElementById('mylist-settings-modal')) {
    closeMyListSettingsModal();
    return;
  }
  myListTabDraftVisibility = normalizeListTabVisibility(userProfile?.listTabVisibility);
  const triggerRect = triggerEl ? triggerEl.getBoundingClientRect() : null;

  const modal = document.createElement('div');
  modal.id = 'mylist-settings-modal';
  modal.className = 'mylist-settings-modal';

  const panel = document.createElement('div');
  panel.className = 'mylist-settings-panel';
  panel.innerHTML = renderMyListSettingsInner();
  modal.appendChild(panel);
  document.body.appendChild(modal);

  if (triggerRect) {
    const rect = triggerRect;
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const panelW = isMobile ? window.innerWidth : 230;
    let left = isMobile ? 0 : rect.left;
    if (!isMobile && left + panelW > window.innerWidth - 10) left = window.innerWidth - panelW - 10;
    left = isMobile ? 0 : Math.max(10, left);
    const top = rect.bottom + 8;
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.width = panelW + 'px';
    panel.style.maxHeight = `calc(100dvh - ${Math.ceil(top + 10)}px)`;
    const originX = rect.left + rect.width / 2 - left;
    panel.style.transformOrigin = originX + 'px 0px';
  }
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
    steamConnection: normalizeSteamConnection(raw.steamConnection || raw.steam || {}),
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
  const allMediaAvg = formatAverageRatingForSection([...(source.movies || []), ...(source.shows || []), ...(source.anime || [])], 'shows');
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
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  const cards = [
    { key: 'allMediaHours', optional: false, tone: 'hours', value: formatProfileHours(stats.allMediaHours), labelMain: 'All Media', labelSub: 'Hours Watched' },
    { key: 'allMediaAvg', optional: false, tone: 'score', value: stats.allMediaAvg, labelMain: 'All Media', labelSub: 'Average Rating' },
    { key: 'movieHours', optional: false, tone: 'hours', value: formatProfileHours(stats.movieHours), labelMain: 'Movies', labelSub: 'Hours Watched' },
    { key: 'movieAvg', optional: false, tone: 'score', value: stats.movieAvg, labelMain: 'Movies', labelSub: 'Average Rating' },
    { key: 'tvHours', optional: false, tone: 'hours', value: formatProfileHours(stats.tvHours), labelMain: 'TV Shows', labelSub: 'Hours Watched' },
    { key: 'tvAvg', optional: false, tone: 'score', value: stats.tvAvg, labelMain: 'TV Shows', labelSub: 'Average Rating' },
    { key: 'statsAnimeHours', optional: true, tone: 'hours', value: formatProfileHours(stats.animeHours), labelMain: 'Anime', labelSub: 'Hours Watched' },
    { key: 'statsAnimeAvg', optional: true, tone: 'score', value: stats.animeAvg, labelMain: 'Anime', labelSub: 'Average Score' },
    { key: 'statsGameHours', optional: true, tone: 'hours', value: formatProfileHours(stats.gameHours), labelMain: 'Games', labelSub: 'Hours Played' },
    { key: 'statsGamesAvg', optional: true, tone: 'score', value: stats.gamesAvg, labelMain: 'Games', labelSub: 'Average Score' }
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
  return Number.isFinite(n) && n > 0 ? `${n}` : '';
}
function renderGoldStarIconHTML(extraClass = '') {
  return `<span class="screenlist-gold-star-icon ${escAttr(extraClass)}" aria-hidden="true">★</span>`;
}
function renderProfileRatingValueHTML(value) {
  const text = formatProfileFavoriteRatingDisplay(value, '');
  return text ? `${renderGoldStarIconHTML('profile-rating-star')}<span>${escHtml(text)}</span>` : '';
}
function getProfileStatLabelHTML(key) {
  return escHtml(getProfileStatLabel(key));
}
function getProfileShowcaseStatLabel(key) {
  const map = {
    movieHours: 'Hours Watched',
    tvHours: 'Hours Watched',
    animeHours: 'Hours Watched',
    gameHours: 'Hours Played',
    movieAvg: 'Avg Rating',
    tvAvg: 'Avg Rating',
    animeAvg: 'Avg Rating',
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
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*10)?$/);
  return match ? match[1] : normalized.replace(/\s*\/\s*10\s*$/, '');
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
function getProfileFavoriteShareButtonHTML(section, index) {
  return `<button type="button" class="profile-fav-share-btn" onclick="shareProfileFavoriteCard(event, this.closest('.profile-fav-poster-card'))" aria-label="Share ranked card ${index + 1}" title="Share this card">${getProfileFavoriteShareIconHTML()}</button>`;
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
  return escHtml(card.labelMain);
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
    movieHours: 'Hours',
    tvHours: 'Hours',
    animeHours: 'Hours',
    gameHours: 'Hours Played',
    movieAvg: 'Average Rating',
    tvAvg: 'Average Rating',
    animeAvg: 'Average Score',
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
  const labelMap = { movies: 'Movie', shows: 'TV Show', anime: 'Anime', games: 'Game' };
  return [year, status, labelMap[section] || 'Library'].filter(Boolean).join(' · ');
}

function buildProfileFavoriteHitFromLibraryItem(config = {}, item = {}, section = '') {
  const isGame = section === 'games' || config.source === 'rawg';
  const tmdbId = String(item.tmdbId || item.tmdb_id || '').trim();
  const rawgId = String(item.rawgId || item.rawg_id || item.id || '').trim();
  const source = isGame ? (rawgId ? 'rawg' : 'library') : (tmdbId ? 'tmdb' : 'library');
  const id = isGame ? (rawgId || String(item.id || '')) : (tmdbId || String(item.id || ''));
  const type = isGame ? 'game' : (section === 'movies' ? 'movie' : 'tv');
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
    const hits = state.config.source === 'rawg' ? await searchProfileRawgFavorites(query) : await searchProfileTmdbFavorites(state.config, query);
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
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  const rowShareBtn = editing ? '' : `<button type="button" class="profile-fav-row-share-btn" onclick="shareProfileFavoriteRow(event, this)" aria-label="Share ${escAttr(config.label)}">${getProfileFavoriteShareIconHTML()}</button>`;
  const rowHead = `<div class="profile-fav-row-head"><div class="profile-fav-row-title">${escHtml(config.label)}</div>${renderProfileVisibilityToggle(key)}${rowShareBtn}</div>`;
  if (!visible) return editing ? `<div class="profile-fav-row">${rowHead}<div class="profile-hidden-note">Hidden from profile. Toggle Display to show this row again.</div></div>` : '';
  const slots = [0,1,2].map(i => {
    const entry = getProfileDatabaseFavoriteDisplay(config, pins[config.key]?.[i]);
    const title = entry.title || '';
    const image = entry.image || '';
    const rating = isProfileNoRatingFavoriteKey(config.key) ? '' : (entry.rating || '');
    const cover = image ? `style="background-image:url('${escAttr(image)}')"` : '';
    const canOpenProfile = !editing && !!entry.id && !!title;
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

function renderManualFavoriteRow(key, showcase) {
  const config = getProfileFavoriteConfig(key);
  if (!config) return '';
  const visible = isProfileRowVisible(key);
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  const rowShareBtn = editing ? '' : `<button type="button" class="profile-fav-row-share-btn" onclick="shareProfileFavoriteRow(event, this)" aria-label="Share ${escAttr(config.label)}">${getProfileFavoriteShareIconHTML()}</button>`;
  const rowHead = `<div class="profile-fav-row-head"><div class="profile-fav-row-title">${escHtml(config.label)}</div>${renderProfileVisibilityToggle(key)}${rowShareBtn}</div>`;
  if (!visible) return editing ? `<div class="profile-fav-row">${rowHead}<div class="profile-hidden-note">Hidden from profile. Toggle Display to show this row again.</div></div>` : '';
  const entries = showcase[key] || [0,1,2].map(() => getEmptyManualFavorite());
  const slots = [0,1,2].map(i => {
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

function renderProfileMediaGroup(group, stats, pins, showcase) {
  const statHtml = group.statKeys.length ? `<div class="profile-group-stats profile-group-stats-showcase-labels">${group.statKeys.map(key => `<div class="profile-group-stat" data-profile-group-stat="${escAttr(key)}"><div class="profile-group-stat-value">${getProfileStatValueHTML(stats, key)}</div><div class="profile-group-stat-label">${getProfileShowcaseStatLabelHTML(key)}</div></div>`).join('')}</div>` : '';
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
    profilePage.classList.toggle('profile-edit-mode', !viewingOther && profileEditModeOpen);
  }
  document.body.classList.toggle('own-profile-active', !!document.body.classList.contains('profile-active') && !viewingOther && !!currentUser);
  if (settingsPage) settingsPage.style.display = profileSettingsOpen && !viewingOther ? 'block' : 'none';
  if (titleEl) titleEl.textContent = viewingOther ? `${getViewingProfileName()}'s Profile` : 'Profile Studio';
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
  const themeMode = normalizeThemeMode(
    userProfile?.themeMode ||
    (document.body.classList.contains('light-mode') ? 'light' : document.body.classList.contains('true-dark-mode') ? 'true-dark' : 'default')
  );
  const prefs = normalizeRatingPreferences(readProfileFromPage()?.ratingPreferences);
  const themeLight = document.getElementById('theme-mode-light');
  const themeTrueDark = document.getElementById('theme-mode-true-dark');
  if (themeLight) {
    themeLight.checked = false;
    themeLight.disabled = true;
  }
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
  if (document.getElementById('theme-mode-true-dark')?.checked) return 'true-dark';
  return getDefaultThemeMode();
}

function readAnimeTitleDisplayModeFromPage() {
  if (isViewingOtherProfile()) return getAnimeTitleDisplayMode(userProfile || {});
  if (document.getElementById('anime-title-pref-romaji')?.checked) return 'romaji';
  if (document.getElementById('anime-title-pref-japanese')?.checked) return 'japanese';
  return 'english';
}

async function saveProfileSettingsPatch(patch = {}) {
  // v429 hardening: when a Steam-only patch (steamConnection) is being saved, scrub
  // root-level Shelfd identity fields out of the patch even if a caller accidentally
  // passes them. Shelfd profile name/photo/bio/customName/customPhoto must NEVER be
  // overwritten as a side-effect of Steam connect/sync.
  let safePatch = { ...(patch && typeof patch === 'object' ? patch : {}) };
  const looksSteamOnly = Object.keys(safePatch).every(k => k === 'steamConnection');
  if (looksSteamOnly) {
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
  if (isViewingOtherProfile()) return;
  if (mode === 'light') {
    const themeLight = document.getElementById('theme-mode-light');
    const themeTrueDark = document.getElementById('theme-mode-true-dark');
    if (themeLight) themeLight.checked = false;
    if (themeTrueDark) themeTrueDark.checked = true;
    if (typeof showToast === 'function') showToast('Light Mode is under fixes for contrast');
    return;
  }
  const normalized = applyThemeMode(mode, true);
  await saveProfileSettingsPatch({ themeMode: normalized });

  const themeLight = document.getElementById('theme-mode-light');
  const themeTrueDark = document.getElementById('theme-mode-true-dark');
  if (themeLight) themeLight.checked = false;
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

function parseScreenListProfileRoute() {
  try {
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/^\/profile-card\/([^/?#]+)\/([^/?#]+)\/([1-3])/i);
    const uid = pathMatch ? decodeURIComponent(pathMatch[1] || '') : (url.searchParams.get('profile') || '');
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
    profileReturnTab = currentUser ? (getActiveMainTab ? getActiveMainTab() : 'community') : 'landing';
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
  profileEditModeOpen = false;
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
  requestAnimationFrame(() => focusProfileSharedFavoriteIfNeeded());
}

function openProfile() {
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  profileSettingsOpen = false;
  profileEditModeOpen = false;
  if (!userProfile) userProfile = normalizeUserProfile({});
  profileReturnTab = getActiveMainTab ? getActiveMainTab() : 'mylist';
  openProfilePageShell();
}

function openProfileEditMode() {
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
  applyThemeMode(getDefaultThemeMode(), false);
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
  const url = hasFavoriteTarget
    ? new URL(`/profile-card/${encodeURIComponent(favorite.uid)}/${encodeURIComponent(favorite.section)}/${Number(favorite.index || 0) + 1}`, window.location.origin)
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

async function buildProfileFavoriteRowShareImageFile(cardData, profileName, label) {
  if (!Array.isArray(cardData) || typeof File === 'undefined') return null;
  const W = 1200, H = 800;
  const PAD = 48, GAP = 18;
  const posterW = Math.floor((W - PAD * 2 - GAP * 2) / 3);
  const posterH = Math.floor(posterW * 1.5);
  const POSTER_Y = 148;
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
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  ctx.fillStyle = 'rgba(255,255,255,0.50)';
  ctx.font = '300 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${profileName}'s`, W / 2, 68);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 40px system-ui, sans-serif';
  ctx.fillText(label, W / 2, 114);
  const images = await Promise.all(cardData.map(c => loadProfileShareImage(c.image)));
  for (let i = 0; i < 3; i++) {
    const x = PAD + i * (posterW + GAP);
    const y = POSTER_Y;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    profileShareRoundRect(ctx, x, y, posterW, posterH, 12);
    ctx.fill();
    const img = images[i];
    if (img) {
      ctx.save();
      profileShareRoundRect(ctx, x, y, posterW, posterH, 12);
      ctx.clip();
      const sr = img.width / img.height;
      const tr = posterW / posterH;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if (sr > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
      else { sh = img.width / tr; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, posterW, posterH);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.arc(x + 22, y + 22, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#C9A84C';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(['#1','#2','#3'][i] || `#${i+1}`, x + 22, y + 27);
    const title = String(cardData[i]?.title || '');
    ctx.fillStyle = '#f7f3ff';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const maxTW = posterW - 8;
    let dTitle = title;
    while (dTitle.length > 1 && ctx.measureText(dTitle).width > maxTW) dTitle = dTitle.slice(0, -1);
    if (dTitle !== title) dTitle += '…';
    ctx.fillText(dTitle, x + posterW / 2, y + posterH + 30);
    if (cardData[i]?.rating) {
      ctx.fillStyle = '#f4d27a';
      ctx.font = '700 17px system-ui, sans-serif';
      ctx.fillText(cardData[i].rating, x + posterW / 2, y + posterH + 56);
    }
  }
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], 'screenlist-top-three.png', { type: 'image/png' }));
      }, 'image/png', 0.92);
    } catch (e) { resolve(null); }
  });
}

async function shareProfileFavoriteRow(event, btn) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const grid = btn.closest('.profile-fav-row')?.querySelector('.profile-fav-poster-grid');
  if (!grid) return;
  const uid = getProfileShareUid();
  if (!uid || uid === 'preview-user') { showToast('Save your profile before sharing'); return; }
  const cards = [...grid.querySelectorAll('.profile-fav-poster-card')];
  const firstCard = cards[0];
  const section = firstCard?.dataset.profileDbSection || firstCard?.dataset.manualSection || '';
  const config = getProfileFavoriteConfigByKey(section);
  const label = config?.label || 'Top 3';
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
  const shareUrl = getShareProfileUrl();
  const shareData = {
    title: `${profileName}'s ${label}`,
    text: `Check out ${profileName}'s ${label} on ScreenList.`,
    url: shareUrl
  };
  try {
    const file = await buildProfileFavoriteRowShareImageFile(cardData, profileName, label);
    if (file && navigator.canShare?.({ files: [file] })) shareData.files = [file];
    if (navigator.share) { await navigator.share(shareData); showToast('Shared!'); return; }
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

function selectProfileCharacterSearchResult(index) {
  const state = profileCharacterEditorState;
  if (!state) return;
  const hit = state.searchResults?.[index];
  if (!hit?.imageUrl) return;
  state.pendingImage = hit.imageUrl;
  state.pendingImageSource = 'search';
  renderProfileCharacterEditor();
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

function confirmProfileCharacterCrop() {
  commitProfileCharacterCrop();
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
