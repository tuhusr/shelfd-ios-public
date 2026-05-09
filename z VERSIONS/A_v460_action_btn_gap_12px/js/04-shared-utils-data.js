function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDisplayName(value) {
  return String(value || '').trim().toLowerCase();
}

function getUserAccountEmail(userLike = null) {
  if (!userLike) return '';
  return normalizeEmail(
    userLike.accountEmailLower ||
    userLike.emailLower ||
    userLike.accountEmail ||
    userLike.email ||
    ''
  );
}

function isCreatorAdmin(userLike = null) {
  const uid = String(userLike?.uid || userLike?.id || '').trim();
  if (uid === CREATOR_PUBLIC_UID) return true;
  const candidateEmail = getUserAccountEmail(userLike);
  const candidateName = normalizeDisplayName(
    userLike?.name ||
    userLike?.customName ||
    ''
  );
  return candidateEmail === CREATOR_ADMIN_EMAIL && candidateName === normalizeDisplayName(CREATOR_DEFAULT_NAME);
}

function getDisplayName(userLike = null, fallback = 'Unknown User') {
  return (userLike && (userLike.name || userLike.customName)) || fallback;
}

function getDisplayNameKey(value = '') {
  return normalizeDisplayName(value).replace(/\s+/g, ' ');
}

function isCreativeTeamUser(userLike = null) {
  if (!userLike) return false;
  const uid = String(userLike.uid || userLike.id || userLike.userId || '').trim();
  if (uid && CREATIVE_TEAM_UIDS.has(uid)) return true;
  const candidates = [
    userLike.name,
    userLike.customName,
    userLike.displayName,
    userLike.nameLower,
    userLike.customNameLower
  ];
  return candidates.some(value => {
    const key = getDisplayNameKey(value || '');
    return key && CREATIVE_TEAM_DISPLAY_NAMES.has(key);
  });
}

function renderCreativeTeamTagHTML() {
  return '<span class="creative-team-role">Creative Team</span>';
}

function renderDisplayNameHTML(userLike = null, fallback = 'Unknown User', extraClass = '') {
  const classes = ['creator-name'];
  if (extraClass) classes.push(extraClass);
  const nameHtml = escHtml(getDisplayName(userLike, fallback));
  const creativeTeamTag = isCreativeTeamUser(userLike) ? renderCreativeTeamTagHTML() : '';
  if (isCreatorAdmin(userLike)) {
    return `<span class="creator-name-wrap user-badged-name-wrap"><span class="${classes.join(' ')}">👑 ${nameHtml}</span><span class="creator-role">(Creator)</span>${creativeTeamTag}</span>`;
  }
  if (creativeTeamTag) {
    return `<span class="creator-name-wrap user-badged-name-wrap"><span${extraClass ? ` class="${extraClass}"` : ''}>${nameHtml}</span>${creativeTeamTag}</span>`;
  }
  return `<span${extraClass ? ` class="${extraClass}"` : ''}>${nameHtml}</span>`;
}

function shouldExposeInUserSearch(userLike = null) {
  const uid = String(userLike?.uid || userLike?.id || '').trim();
  const email = getUserAccountEmail(userLike);
  const publicFlag = userLike?.isPublic !== false;
  const creatorByUid = uid === CREATOR_PUBLIC_UID;
  const creatorByEmail = email === CREATOR_ADMIN_EMAIL;
  const creatorByFlag = userLike?.isCreatorAdmin === true;
  return publicFlag && (creatorByUid || creatorByEmail || creatorByFlag);
}

function normalizeCreatorPublicUser(raw = {}, uid = '') {
  if (!raw || typeof raw !== 'object') return null;
  const resolvedUid = String(raw.uid || uid || (raw.isCreatorAdmin === true ? CREATOR_PUBLIC_UID : '') || '').trim();
  const email = normalizeEmail(raw.emailLower || raw.accountEmailLower || raw.email || '');
  const user = {
    ...raw,
    uid: resolvedUid,
    name: raw.name || raw.customName || raw.displayName || CREATOR_DEFAULT_NAME,
    photo: raw.photo || raw.customPhoto || '',
    emailLower: email,
    accountEmailLower: normalizeEmail(raw.accountEmailLower || raw.emailLower || raw.email || ''),
    isCreatorAdmin: resolvedUid === CREATOR_PUBLIC_UID || raw.isCreatorAdmin === true || email === CREATOR_ADMIN_EMAIL,
    isPublic: raw.isPublic !== false
  };
  return user.uid ? user : null;
}

function cacheCreatorPublicUser(user = null) {
  if (!user?.uid) return null;
  const normalized = normalizeCreatorPublicUser(user, user.uid);
  if (!normalized) return null;
  usersMap[normalized.uid] = normalized;
  creatorSearchUserCache = normalized;
  try {
    localStorage.setItem(CREATOR_PUBLIC_PROFILE_CACHE_KEY, JSON.stringify({
      uid: normalized.uid,
      name: normalized.name || CREATOR_DEFAULT_NAME,
      customName: normalized.customName || normalized.name || CREATOR_DEFAULT_NAME,
      photo: normalized.photo || normalized.customPhoto || '',
      customPhoto: normalized.customPhoto || normalized.photo || '',
      bio: normalized.bio || normalized.profileBio || '',
      profileBio: normalized.profileBio || normalized.bio || '',
      socialLinks: normalized.socialLinks || getDefaultSocialLinks(),
      pinnedFavorites: normalized.pinnedFavorites || getDefaultPinnedFavorites(),
      showcaseFavorites: normalized.showcaseFavorites || getDefaultShowcaseFavorites(),
      profileVisibility: normalized.profileVisibility || getDefaultProfileVisibility(),
      listTabVisibility: normalized.listTabVisibility || getDefaultListTabVisibility(),
      ratingPreferences: normalized.ratingPreferences || getDefaultRatingPreferences(),
      animeTitleDisplayMode: normalized.animeTitleDisplayMode || getDefaultAnimeTitleDisplayMode(),
      emailLower: CREATOR_ADMIN_EMAIL,
      accountEmailLower: CREATOR_ADMIN_EMAIL,
      isCreatorAdmin: true,
      isPublic: true,
      cachedAt: Date.now()
    }));
  } catch (e) {}
  return normalized;
}

function getCachedCreatorPublicUser() {
  try {
    const raw = localStorage.getItem(CREATOR_PUBLIC_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const user = normalizeCreatorPublicUser(parsed, parsed.uid || CREATOR_PUBLIC_UID);
    if (!user || user.uid !== CREATOR_PUBLIC_UID) return null;
    return shouldExposeInUserSearch(user) ? cacheCreatorPublicUser(user) : null;
  } catch (e) {
    return null;
  }
}

function updateLandingCreatorProfileCard(user = null) {
  const avatar = document.getElementById('landing-profile-avatar');
  if (!avatar) return;
  const photo = (user && (user.photo || user.customPhoto)) || '';
  avatar.src = photo || 'https://ui-avatars.com/api/?name=King%20Kooom&background=1c1535&color=a78bfa';
  avatar.onerror = () => {
    avatar.onerror = null;
    avatar.src = 'https://ui-avatars.com/api/?name=King%20Kooom&background=1c1535&color=a78bfa';
  };
}

async function loadCreatorPublicProfileMirrorRaw() {
  try {
    const snap = await db.collection('publicProfiles').doc(CREATOR_PUBLIC_PROFILE_SLUG).get();
    return snap.exists ? (snap.data() || {}) : null;
  } catch (e) {
    console.warn('Creator public profile mirror unavailable:', e);
    return null;
  }
}

async function loadCreatorPublicProfileMirror() {
  const raw = await loadCreatorPublicProfileMirrorRaw();
  if (!raw) return null;
  const uid = raw.uid || raw.creatorUid || raw.ownerUid || raw.userId || CREATOR_PUBLIC_UID;
  const user = normalizeCreatorPublicUser(raw, uid);
  if (!user || !shouldExposeInUserSearch(user)) return null;
  updateLandingCreatorProfileCard(user);
  return cacheCreatorPublicUser(user);
}

async function loadCreatorSearchUser(force = false) {
  if (!force && creatorSearchUserCache?.uid === CREATOR_PUBLIC_UID) return creatorSearchUserCache;

  try {
    const directSnap = await db.collection('users').doc(CREATOR_PUBLIC_UID).get();
    if (directSnap.exists) {
      const directUser = normalizeCreatorPublicUser({ ...(directSnap.data() || {}), uid: CREATOR_PUBLIC_UID, isCreatorAdmin: true, isPublic: true }, CREATOR_PUBLIC_UID);
      if (directUser && shouldExposeInUserSearch(directUser)) {
        updateLandingCreatorProfileCard(directUser);
        return cacheCreatorPublicUser(directUser);
      }
    }
  } catch (e) {
    console.warn('Creator direct UID lookup failed:', e);
  }

  const mirrorUser = await loadCreatorPublicProfileMirror();
  if (mirrorUser?.uid === CREATOR_PUBLIC_UID) return mirrorUser;

  const queryAttempts = [
    ['accountEmailLower', CREATOR_ADMIN_EMAIL],
    ['emailLower', CREATOR_ADMIN_EMAIL],
    ['accountEmail', CREATOR_ADMIN_EMAIL],
    ['email', CREATOR_ADMIN_EMAIL]
  ];

  for (const [field, value] of queryAttempts) {
    try {
      const snap = await db.collection('users').where(field, '==', value).limit(1).get();
      if (snap.empty) continue;
      const doc = snap.docs[0];
      const user = normalizeCreatorPublicUser({ ...(doc.data() || {}), uid: doc.id }, doc.id);
      if (user?.uid === CREATOR_PUBLIC_UID && shouldExposeInUserSearch(user)) { updateLandingCreatorProfileCard(user); return cacheCreatorPublicUser(user); }
    } catch (e) {
      console.warn(`Creator lookup failed for ${field}:`, e);
    }
  }

  const cachedCreator = getCachedCreatorPublicUser();
  if (cachedCreator) {
    updateLandingCreatorProfileCard(cachedCreator);
    return cachedCreator;
  }

  const creatorShell = normalizeCreatorPublicUser({
    uid: CREATOR_PUBLIC_UID,
    name: CREATOR_DEFAULT_NAME,
    isCreatorAdmin: true,
    isPublic: true
  }, CREATOR_PUBLIC_UID);
  updateLandingCreatorProfileCard(creatorShell);
  return cacheCreatorPublicUser(creatorShell);
}

async function syncCreatorPublicProfileMirror(user = null, profile = null, listSource = null) {
  const email = normalizeEmail(user?.email || profile?.accountEmailLower || profile?.emailLower || profile?.email || '');
  const isCreator = String(user?.uid || '').trim() === CREATOR_PUBLIC_UID || email === CREATOR_ADMIN_EMAIL;
  if (!isCreator || !user?.uid) return;
  const source = normalizeUserProfile(profile || userProfile || {});
  const publicListData = listSource ? cloneListData(listSource) : null;
  const publicPayload = {
    uid: user.uid,
    name: CREATOR_DEFAULT_NAME,
    customName: CREATOR_DEFAULT_NAME,
    nameLower: normalizeDisplayName(CREATOR_DEFAULT_NAME),
    customNameLower: normalizeDisplayName(CREATOR_DEFAULT_NAME),
    photo: source.photo || user.photoURL || '',
    customPhoto: source.photo || user.photoURL || '',
    bio: source.bio || '',
    profileBio: source.bio || '',
    socialLinks: source.socialLinks || getDefaultSocialLinks(),
    pinnedFavorites: source.pinnedFavorites || getDefaultPinnedFavorites(),
    showcaseFavorites: source.showcaseFavorites || getDefaultShowcaseFavorites(),
    profileVisibility: source.profileVisibility || getDefaultProfileVisibility(),
    listTabVisibility: source.listTabVisibility || getDefaultListTabVisibility(),
    ratingPreferences: source.ratingPreferences || getDefaultRatingPreferences(),
    animeTitleDisplayMode: source.animeTitleDisplayMode || getDefaultAnimeTitleDisplayMode(),
    themeMode: source.themeMode || getDefaultThemeMode(),
    emailLower: CREATOR_ADMIN_EMAIL,
    accountEmailLower: CREATOR_ADMIN_EMAIL,
    isCreatorAdmin: true,
    isPublic: true
  };
  if (publicListData) publicPayload.publicListData = publicListData;
  try {
    const mirrorWrite = {
      ...publicPayload,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (publicListData) mirrorWrite.publicListUpdatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('publicProfiles').doc(CREATOR_PUBLIC_PROFILE_SLUG).set(mirrorWrite, { merge: true });
    cacheCreatorPublicUser(publicPayload);
  } catch (e) {
    console.warn('Creator public profile mirror sync failed:', e);
  }
}

function parsePublicCreatorListData(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.publicListData || raw.listData || raw.lists || raw.watchlist || raw.library || null;
  if (!source || typeof source !== 'object') return null;
  const parsed = {};
  SCREENLIST_SECTIONS.forEach(section => {
    const value = source[section];
    if (typeof value === 'string') {
      try { parsed[section] = JSON.parse(value); } catch (e) { parsed[section] = []; }
    } else if (Array.isArray(value)) {
      parsed[section] = value;
    } else {
      parsed[section] = [];
    }
  });
  return normalizeListData(parsed);
}

async function loadCreatorPublicListData() {
  const rawMirror = await loadCreatorPublicProfileMirrorRaw();
  const mirrorList = parsePublicCreatorListData(rawMirror);
  if (mirrorList && listDataItemCount(mirrorList) > 0) {
    return await autoSortAnimeBuckets(mirrorList, false);
  }
  const direct = await loadPublicProfileListData(CREATOR_PUBLIC_UID, { suppressError: true });
  if (listDataItemCount(direct) > 0) return direct;
  return direct || getEmptyListData();
}

const SCREENLIST_SECTIONS = ["movies", "shows", "anime", "games", "manga", "books"];
const SCREENLIST_MEDIA_PROFILE_SECTIONS = ["movies", "shows", "anime", "games"];

function getEmptyListData() {
  return SCREENLIST_SECTIONS.reduce((acc, section) => {
    acc[section] = [];
    return acc;
  }, {});
}

function isShowSection(section) {
  return section === "shows" || section === "anime";
}

function isReadingSection(section) {
  return section === "manga" || section === "books";
}

function canOpenLibraryMediaProfile(section) {
  return SCREENLIST_MEDIA_PROFILE_SECTIONS.includes(section);
}

function getDefaultAnimeTitleDisplayMode() {
  return 'english';
}

function normalizeAnimeTitleDisplayMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'romanji' || mode === 'romaji') return 'romaji';
  if (mode === 'japanese' || mode === 'original') return 'japanese';
  return 'english';
}

function getAnimeTitleDisplayMode(profile = null) {
  const source = profile || (getActiveProfile?.() || userProfile || {});
  return normalizeAnimeTitleDisplayMode(source.animeTitleDisplayMode || source.animeTitleDisplay || getDefaultAnimeTitleDisplayMode());
}

function normalizeAnimeTitleVariants(raw = {}, fallbackTitle = '') {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    english: String(input.english || input.englishTitle || fallbackTitle || '').trim(),
    romaji: String(input.romaji || input.romanji || input.romajiTitle || input.title || fallbackTitle || '').trim(),
    japanese: String(input.japanese || input.japaneseTitle || input.original || '').trim()
  };
}

function getAnimeDisplayTitle(item = {}, mode = getAnimeTitleDisplayMode()) {
  const variants = normalizeAnimeTitleVariants(item.titleVariants, item.title || item.name || '');
  const originalTitle = String(item.originalTitle || item.original_name || item.original_title || '').trim();
  if (mode === 'japanese') {
    return variants.japanese || (detectJapaneseScript(originalTitle) ? originalTitle : '') || variants.romaji || variants.english || item.title || item.name || '';
  }
  if (mode === 'romaji') {
    return variants.romaji || variants.english || item.title || item.name || originalTitle || '';
  }
  return variants.english || item.title || item.name || variants.romaji || originalTitle || '';
}

function isAnimeTitleContext(item = {}, sectionHint = '') {
  return sectionHint === 'anime' || item?.mediaCategory === 'anime' || item?.librarySection === 'anime' || item?.isAnime === true;
}

function getDisplayTitleForItem(item = {}, sectionHint = '') {
  if (isAnimeTitleContext(item, sectionHint)) return getAnimeDisplayTitle(item);
  return item?.title || item?.name || '';
}

function getDefaultTabForSection(section) {
  return section === "movies" ? "planned" : "watching";
}

const SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION = {
  shows: ['watching', 'planned', 'watched', 'paused'],
  anime: ['watching', 'planned', 'watched', 'paused'],
  movies: ['planned', 'watched', 'paused'],
  games: ['watching', 'planned', 'watched', 'wishlist'],
  manga: ['watching', 'planned', 'watched', 'paused'],
  books: ['watching', 'planned', 'watched', 'paused']
};

function isVisibleMyListStatusTab(tab = activeTab, section = activeSection) {
  return (SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION[section] || SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION.shows).includes(tab);
}

function normalizeVisibleMyListStatusTab(tab = activeTab, section = activeSection) {
  if (section === 'games' && tab === 'live') return 'watching';
  return isVisibleMyListStatusTab(tab, section) ? tab : getDefaultTabForSection(section);
}

function getMyListStatusLabel(status = '', section = activeSection) {
  if (status === 'live') return 'Live Games';
  if (status === 'wishlist') return section === 'games' ? 'Wishlist' : 'Wishlist';
  if (status === 'watching') {
    if (section === 'games') return 'Playing';
    return isReadingSection(section) ? 'Reading' : 'Watching';
  }
  if (status === 'planned') {
    if (section === 'games') return 'Backlog';
    return isReadingSection(section) ? 'TBR' : 'Watchlist';
  }
  if (status === 'watched') {
    if (section === 'games') return 'Played';
    return isReadingSection(section) ? 'Read' : 'Watched';
  }
  if (status === 'paused') return 'Paused';
  if (status === 'dropped') return 'Dropped';
  return String(status || '');
}

function getMyListStatusButtonConfigs(section = activeSection) {
  const statuses = section === 'games'
    ? ['watching', 'live', 'planned', 'watched', 'wishlist']
    : (SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION[section] || SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION.shows);
  return statuses.map(status => ({ status, label: getMyListStatusLabel(status, section) }));
}


function getSectionLabel(section, singular = false) {
  if (section === "movies") return singular ? "movie" : "movies";
  if (section === "anime") return singular ? "anime" : "anime";
  if (section === "games") return singular ? "game" : "games";
  if (section === "manga") return singular ? "manga" : "manga";
  if (section === "books") return singular ? "book" : "books";
  return singular ? "show" : "shows";
}

function getSectionIcon(section) {
  if (section === "movies") return "🎬";
  if (section === "anime") return "🌸";
  if (section === "games") return "🎮";
  if (section === "manga") return "📚";
  if (section === "books") return "📖";
  return "📺";
}

function getAddButtonSectionLabel(section) {
  if (section === 'anime') return 'Anime';
  if (section === 'shows') return 'Show';
  if (section === 'movies') return 'Movie';
  if (section === 'games') return 'Game';
  if (section === 'manga') return 'Manga';
  if (section === 'books') return 'Book';
  return 'Title';
}

function getDefaultRatingPreferences() {
  return { media: 'ten', games: 'ten' };
}

function getDefaultThemeMode() {
  return 'true-dark';
}

function normalizeThemeMode(value) {
  return value === 'light' || value === 'true-dark' ? value : 'default';
}

function normalizeRatingPreferences(raw) {
  const defaults = getDefaultRatingPreferences();
  if (raw && typeof raw === 'object') {
    defaults.media = raw.media === 'five' ? 'five' : 'ten';
    defaults.games = raw.games === 'five' ? 'five' : 'ten';
  }
  return defaults;
}

function getRatingPreferenceKeyForSection(section = '') {
  return section === 'games' ? 'games' : 'media';
}

function getRatingPreferencesForProfile(profile = null) {
  if (profile) return normalizeRatingPreferences(profile.ratingPreferences);
  if (viewingUser && !isViewingOtherProfile()) {
    return normalizeRatingPreferences(
      viewingUser.ratingPreferences ||
      usersMap[viewingUser.uid || '']?.ratingPreferences
    );
  }
  return normalizeRatingPreferences((getActiveProfile?.() || userProfile || {}).ratingPreferences);
}

function getRatingPreferenceForSection(section = '', profile = null) {
  const prefs = getRatingPreferencesForProfile(profile);
  return prefs[getRatingPreferenceKeyForSection(section)] || 'ten';
}

function getRatingStepCountForSection(section = '', profile = null) {
  return getRatingPreferenceForSection(section, profile) === 'five' ? 5 : 10;
}

function isFivePointRatingSection(section = '', profile = null) {
  return getRatingPreferenceForSection(section, profile) === 'five';
}

function formatRatingValueForSection(value, section = '', withSuffix = false, emptyValue = '') {
  const numeric = Number(value || 0);
  if (!(numeric > 0)) return emptyValue;
  if (isFivePointRatingSection(section)) {
    const display = numeric / 2;
    const text = Number.isInteger(display) ? String(display) : display.toFixed(1);
    return withSuffix ? `${text}/5` : text;
  }
  const text = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
  return withSuffix ? `${text}/10` : text;
}

function formatAverageRatingForSection(list = [], section = '') {
  const rated = list.filter(item => Number(item.rating || 0) > 0);
  if (!rated.length) return 'N/A';
  const avg = rated.reduce((sum, item) => sum + Number(item.rating || 0), 0) / rated.length;
  return formatRatingValueForSection(avg, section, true, 'N/A');
}

function getRatingSectionForDiscoverType(type = '') {
  if (type === 'game') return 'games';
  if (activeDiscoveryHub === 'anime') return 'anime';
  if (type === 'movie') return 'movies';
  return 'shows';
}

function buildRatingStarsMarkup(rating, itemId, prefix, size, section, interactive = true) {
  const stepCount = getRatingStepCountForSection(section);
  const currentRating = Number(rating || 0);
  const classes = ['stars'];
  if (stepCount === 5) classes.push('rating-scale-five');
  const attrs = interactive
    ? ` data-item-id="${itemId}" data-prefix="${prefix}" data-section="${section}"
    ontouchstart="starsTouchStart(event)"
    ontouchmove="starsTouchMove(event)"
    ontouchend="starsTouchEnd(event)"`
    : '';
  let html = `<div class="${classes.join(' ')}" style="--star-size:${size}px;"${attrs}>`;
  if (stepCount === 5) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      if (interactive) {
        html += `<button class="star-btn half-step left ${leftVal <= currentRating ? 'lit' : ''}" data-star="${leftVal}" style="font-size:${size}px"
          onclick="event.stopPropagation();rate('${itemId}','${prefix}',${leftVal})"
          onmouseenter="hoverStars(this,${leftVal})" onmouseleave="unhoverStars(this,${currentRating})">★</button>`;
        html += `<button class="star-btn half-step right ${rightVal <= currentRating ? 'lit' : ''}" data-star="${rightVal}" style="font-size:${size}px"
          onclick="event.stopPropagation();rate('${itemId}','${prefix}',${rightVal})"
          onmouseenter="hoverStars(this,${rightVal})" onmouseleave="unhoverStars(this,${currentRating})">★</button>`;
      } else {
        html += `<span class="star-btn half-step left ${leftVal <= currentRating ? 'lit' : ''}" style="font-size:${size}px;cursor:default;">★</span>`;
        html += `<span class="star-btn half-step right ${rightVal <= currentRating ? 'lit' : ''}" style="font-size:${size}px;cursor:default;">★</span>`;
      }
    }
  } else {
    for (let s = 1; s <= 10; s++) {
      if (interactive) {
        html += `<button class="star-btn ${s <= currentRating ? 'lit' : ''}" data-star="${s}" style="font-size:${size}px"
          onclick="event.stopPropagation();rate('${itemId}','${prefix}',${s})"
          onmouseenter="hoverStars(this,${s})" onmouseleave="unhoverStars(this,${currentRating})">★</button>`;
      } else {
        html += `<span class="star-btn ${s <= currentRating ? 'lit' : ''}" style="font-size:${size}px;cursor:default;">★</span>`;
      }
    }
  }
  if (currentRating > 0) html += `<span class="star-label">${formatRatingValueForSection(currentRating, section)}</span>`;
  html += `</div>`;
  return html;
}

function buildStandaloneRatingStarsMarkup(selectedRating = 0, section = '', clickHandler = '') {
  const stepCount = getRatingStepCountForSection(section);
  const classes = ['stars', 'discover-rating-stars'];
  if (stepCount === 5) classes.push('rating-scale-five');
  let stars = `<div class="${classes.join(' ')}" data-discover-rating="${selectedRating}" data-section="${section}" style="--star-size:18px;">`;
  if (stepCount === 5) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      stars += `<button class="star-btn half-step left ${leftVal <= selectedRating ? 'lit' : ''}" onclick="${clickHandler}(${leftVal})" onmouseenter="hoverStars(this,${leftVal})" onmouseleave="unhoverStars(this,${selectedRating})">★</button>`;
      stars += `<button class="star-btn half-step right ${rightVal <= selectedRating ? 'lit' : ''}" onclick="${clickHandler}(${rightVal})" onmouseenter="hoverStars(this,${rightVal})" onmouseleave="unhoverStars(this,${selectedRating})">★</button>`;
    }
  } else {
    for (let i = 1; i <= 10; i++) {
      stars += `<button class="star-btn ${i <= selectedRating ? 'lit' : ''}" onclick="${clickHandler}(${i})" onmouseenter="hoverStars(this,${i})" onmouseleave="unhoverStars(this,${selectedRating})">★</button>`;
    }
  }
  if (selectedRating > 0) stars += `<span class="star-label">${formatRatingValueForSection(selectedRating, section)}</span>`;
  stars += `</div>`;
  return stars;
}

function detectJapaneseScript(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(value || ""));
}

function detectKoreanScript(value) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(String(value || ""));
}

function toGenreNameList(item) {
  if (Array.isArray(item?.genreNames)) {
    return item.genreNames.map(name => String(name || '').trim().toLowerCase()).filter(Boolean);
  }
  return String(item?.genre || '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);
}

function toOriginCountryList(item) {
  if (Array.isArray(item?.originCountries)) {
    return item.originCountries.map(code => String(code || '').trim().toUpperCase()).filter(Boolean);
  }
  return String(item?.originCountries || '')
    .split(',')
    .map(code => code.trim().toUpperCase())
    .filter(Boolean);
}

function detectAnimeFromMetadata(item) {
  const genres = toGenreNameList(item);
  const hasAnimationGenre = genres.includes('animation');
  if (!hasAnimationGenre) return false;

  const originalLanguage = String(item?.originalLanguage || '').trim().toLowerCase();
  const originCountries = toOriginCountryList(item);
  const originalTitle = item?.originalTitle || item?.originalName || '';
  const title = item?.title || '';
  const hasJapaneseSignal =
    originalLanguage === 'ja' ||
    originCountries.includes('JP') ||
    detectJapaneseScript(originalTitle) ||
    detectJapaneseScript(title);

  return hasJapaneseSignal;
}

function isAnimeDiscoverCandidate(item) {
  if (!item || typeof item !== 'object') return false;
  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  const hasAnimationGenre = genreIds.includes(16) || toGenreNameList(item).includes('animation');
  if (!hasAnimationGenre) return false;

  const originalLanguage = String(item.original_language || item.originalLanguage || '').trim().toLowerCase();
  const originCountries = Array.isArray(item.origin_country)
    ? item.origin_country.map(code => String(code || '').trim().toUpperCase()).filter(Boolean)
    : toOriginCountryList(item);
  const titleSignals = [
    item.original_name,
    item.originalTitle,
    item.name,
    item.title
  ].filter(Boolean);
  const hasRegionalSignal =
    originalLanguage === 'ja' ||
    originalLanguage === 'ko' ||
    originCountries.includes('JP') ||
    originCountries.includes('KR') ||
    titleSignals.some(value => detectJapaneseScript(value) || detectKoreanScript(value));

  return hasRegionalSignal;
}

function resolveShowSection(item, fallbackSection = "shows") {
  if (!isShowSection(fallbackSection)) return fallbackSection;
  const explicit = String(item?.librarySection || item?.mediaCategory || '').trim().toLowerCase();
  if (explicit === 'anime') return 'anime';
  if (explicit === 'shows' || explicit === 'show' || explicit === 'tv') return 'shows';
  return detectAnimeFromMetadata(item) ? 'anime' : 'shows';
}


function normalizeScreenListGameDetailHoursValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return '0';
  return String(Math.round(n * 10) / 10);
}

function normalizeScreenListGameDetailUrlValue(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^(https?:|mailto:)/i.test(clean)) return clean;
  return `https://${clean}`;
}

function normalizeGameDetailFieldsForStorage(item = {}) {
  const next = { ...item };
  const platform = String(
    next.gamePlatform ||
    next.gamePlayedPlatform ||
    next.playedPlatform ||
    next.platformPlayed ||
    next.userPlatform ||
    ''
  ).trim();
  const hours = normalizeScreenListGameDetailHoursValue(
    next.gameHoursPlayed ??
    next.gameHours ??
    next.hoursPlayed ??
    next.playtimeHours ??
    next.currentHours ??
    ''
  );
  const tracker = normalizeScreenListGameDetailUrlValue(
    next.gameTrackerUrl ||
    next.gameStatsUrl ||
    next.trackerStatsUrl ||
    next.trackerUrl ||
    next.statsUrl ||
    ''
  );

  next.gamePlatform = platform;
  next.gamePlayedPlatform = platform;
  next.gameHoursPlayed = hours;
  next.gameHours = hours;
  next.hoursPlayed = hours;
  next.playtimeHours = hours;
  next.gameTrackerUrl = tracker;
  next.gameStatsUrl = tracker;
  next.trackerStatsUrl = tracker;
  return next;
}

function normalizeListEntry(item, fallbackSection) {
  if (!item || typeof item !== 'object') return null;
  let next = { ...item };
  if (isShowSection(fallbackSection)) {
    const resolvedSection = resolveShowSection(next, fallbackSection);
    next.mediaCategory = resolvedSection;
    next.librarySection = resolvedSection;
    next.isAnime = resolvedSection === 'anime';
    if (Array.isArray(next.episodes)) {
      next.episodes = next.episodes.map((ep, idx) => {
        if (ep && !ep.id) {
          return { ...ep, id: (next.id || 'item') + '-ep-' + (ep.seasonNum ? ep.seasonNum + '-' : '') + (ep.epNum || ep.number || idx + 1) };
        }
        return ep;
      });
    }
  } else {
    next.librarySection = fallbackSection;
    if (fallbackSection === 'games') {
      // Ensure every game has a stable id so the details panel and save button work correctly.
      // Older entries were saved with only rawgId; without id the save key is '' and silently fails.
      if (!next.id) {
        next.id = next.rawgId || next.metacriticSlug || next.rawgSlug || next.backloggdSlug || next.title || String(Date.now());
      }
      next = normalizeGameDetailFieldsForStorage(next);
    }
  }
  return next;
}

function normalizeListData(source) {
  const normalized = getEmptyListData();
  const input = source && typeof source === 'object' ? source : {};

  ["movies", "games", "manga", "books"].forEach(section => {
    const items = Array.isArray(input[section]) ? input[section] : [];
    normalized[section] = items
      .map(item => normalizeListEntry(item, section))
      .filter(Boolean);
  });

  ["shows", "anime"].forEach(section => {
    const items = Array.isArray(input[section]) ? input[section] : [];
    items.forEach(item => {
      const normalizedItem = normalizeListEntry(item, section);
      if (!normalizedItem) return;
      normalized[resolveShowSection(normalizedItem, section)].push(normalizedItem);
    });
  });

  return JSON.parse(JSON.stringify(normalized));
}

async function hydrateShowMetadataFromTmdb(item) {
  if (!item?.tmdbId) return false;
  try {
    const res = await fetchTmdbProxy(`tv/${item.tmdbId}`);
    if (!res.ok) return false;
    const d = await res.json();
    item.genre = (d.genres || []).map(g => g.name).join(', ');
    item.genreNames = (d.genres || []).map(g => g.name).filter(Boolean);
    item.originalTitle = d.original_name || item.originalTitle || '';
    item.originalLanguage = d.original_language || item.originalLanguage || '';
    item.originCountries = Array.isArray(d.origin_country) ? d.origin_country : (item.originCountries || []);
    item.mediaCategory = detectAnimeFromMetadata(item) ? 'anime' : 'shows';
    item.librarySection = item.mediaCategory;
    item.isAnime = item.mediaCategory === 'anime';
    return true;
  } catch (e) {
    console.error('Anime classification refresh failed:', e);
    return false;
  }
}

async function autoSortAnimeBuckets(source, persist = false) {
  const working = cloneListData(source);
  const candidates = [...(working.shows || []), ...(working.anime || [])]
    .filter(item => item?.tmdbId)
    .filter(item =>
      !item.librarySection ||
      !item.mediaCategory ||
      !item.originalLanguage ||
      !Array.isArray(item.originCountries) ||
      !Array.isArray(item.genreNames)
    );

  let enriched = false;
  for (const item of candidates) {
    const changed = await hydrateShowMetadataFromTmdb(item);
    enriched = enriched || changed;
  }

  const normalized = normalizeListData(working);
  if (!enriched && isSameListData(normalized, source)) return normalized;

  if (persist && currentUser && !viewingUser) {
    await writeOwnDataDirect(normalized);
  }

  return normalized;
}

let data = getEmptyListData();
let ownDataCache = null; // durable in-session copy of the signed-in user's own library
let friendViewData = null; // isolated data for a friend's profile; never used for saving your own list
let viewingReturnTab = 'mylist';
function cloneListData(source) {
  return normalizeListData(source);
}

function getCompactImportedAnimeItem(item = {}) {
  if (!item || typeof item !== 'object') return item;
  // v451: per-item opt-out — once the user expands a MAL-imported anime's
  // synthetic episodes (toggle-watched, rate, mark-all), we set
  // preserveEpisodes so this function leaves item.episodes alone instead of
  // stripping them back to []. Without this, every save would re-strip and the
  // user's per-episode state would silently disappear.
  if (item.preserveEpisodes === true) return item;
  const isMalImport = String(item.source || '').toLowerCase() === 'myanimelist' || !!item.bulkImportCompact;
  if (!isMalImport) return item;
  const next = { ...item };
  const episodes = Array.isArray(next.episodes) ? next.episodes : [];
  const total = Number(next.totalEps || next.totalEpisodes || episodes.length || 0);
  const watched = episodes.length
    ? episodes.filter(ep => ep && ep.watched).length
    : Number(next.currentEp || next.watchedEpisodes || 0);
  next.totalEpisodes = total;
  next.totalEps = total;
  next.currentEp = next.status === 'watched' ? total : Math.max(0, Math.min(total || Infinity, watched));
  next.episodes = [];
  next.bulkImportCompact = true;
  return next;
}

function compactImportedAnimeForStorage(source) {
  const safe = cloneListData(source);
  safe.anime = (safe.anime || []).map(item => getCompactImportedAnimeItem(item));
  return safe;
}

function getVisibleListData() {
  return viewingUser && friendViewData ? friendViewData : data;
}
function listDataSignature(source) {
  return JSON.stringify(cloneListData(source));
}
function isSameListData(a, b) {
  return !!a && !!b && listDataSignature(a) === listDataSignature(b);
}
function listDataItemCount(source) {
  const d = cloneListData(source);
  return SCREENLIST_SECTIONS.reduce((sum, section) => sum + (d[section] || []).length, 0);
}
function readOwnLocalBackup(excludeData = null) {
  const keys = [];
  if (currentUser) keys.push("screenlist-own-data-backup-" + currentUser.uid);
  keys.push("watchlist-tracker-data");
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = cloneListData(JSON.parse(raw));
      if (listDataItemCount(parsed) === 0) continue;
      if (excludeData && isSameListData(parsed, excludeData)) continue;
      return parsed;
    } catch(e) {}
  }
  return null;
}

function getOwnDataFirestorePayload(safeData) {
  return {
    shows: JSON.stringify(safeData.shows),
    movies: JSON.stringify(safeData.movies),
    anime: JSON.stringify(safeData.anime),
    games: JSON.stringify(safeData.games),
    manga: JSON.stringify(safeData.manga),
    books: JSON.stringify(safeData.books),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

function parseOwnFirestoreData(docData = {}) {
  return normalizeListData({
    shows: docData.shows ? JSON.parse(docData.shows) : [],
    movies: docData.movies ? JSON.parse(docData.movies) : [],
    anime: docData.anime ? JSON.parse(docData.anime) : [],
    games: docData.games ? JSON.parse(docData.games) : [],
    manga: docData.manga ? JSON.parse(docData.manga) : [],
    books: docData.books ? JSON.parse(docData.books) : []
  });
}

function getOwnDataFirestorePayloadSizeBytes(safeData = null) {
  try {
    const payload = getOwnDataFirestorePayload(safeData || getEmptyListData());
    const serializable = {
      shows: payload.shows || '',
      movies: payload.movies || '',
      anime: payload.anime || '',
      games: payload.games || '',
      manga: payload.manga || '',
      books: payload.books || ''
    };
    const json = JSON.stringify(serializable);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
    return unescape(encodeURIComponent(json)).length;
  } catch (e) {
    return 0;
  }
}

function formatOwnDataSaveError(error, safeData = null) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || error || '').trim();
  const sizeBytes = getOwnDataFirestorePayloadSizeBytes(safeData);
  const sizeKb = Math.round((sizeBytes / 1024) * 10) / 10;
  const codeLabel = code || 'unknown';
  return `Save failed [${codeLabel}] ${sizeKb} KB${message ? `: ${message}` : ''}`;
}

async function loadWatchlistDataFromDocRef(docRef, fallbackData = null) {
  const fallback = fallbackData
    ? cloneListData(fallbackData)
    : (ownDataCache ? cloneListData(ownDataCache) : cloneListData(data));
  if (!docRef) return fallback;
  try {
    const snap = await docRef.get();
    if (!snap.exists) return getEmptyListData();
    return parseOwnFirestoreData(snap.data() || {});
  } catch(e) {
    console.error("Watchlist reload failed:", e);
    return fallback;
  }
}

async function persistOwnDataToFirestore(safeData, options = {}) {
  if (!DOC_REF) {
    if (options.verify) throw new Error("No library document is available for saving.");
    return;
  }
  try {
    const payload = getOwnDataFirestorePayload(safeData);
    await DOC_REF.set(payload, { merge: true });
    if (typeof window !== 'undefined') {
      window.__lastOwnDataSaveDebug = {
        ok: true,
        sizeBytes: getOwnDataFirestorePayloadSizeBytes(safeData),
        itemCount: listDataItemCount(safeData),
        gamesCount: Array.isArray(safeData?.games) ? safeData.games.length : 0,
        at: new Date().toISOString()
      };
    }
  } catch (error) {
    const formatted = formatOwnDataSaveError(error, safeData);
    if (typeof window !== 'undefined') {
      window.__lastOwnDataSaveDebug = {
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || error || ''),
        formatted,
        sizeBytes: getOwnDataFirestorePayloadSizeBytes(safeData),
        itemCount: listDataItemCount(safeData),
        gamesCount: Array.isArray(safeData?.games) ? safeData.games.length : 0,
        at: new Date().toISOString()
      };
    }
    throw error;
  }
  if (options.verify) await verifyOwnDataDirectWrite(safeData);
}

async function verifyOwnDataDirectWrite(expectedData) {
  if (!DOC_REF) throw new Error("No library document is available for saving.");
  const storedData = await loadWatchlistDataFromDocRef(DOC_REF);
  if (listDataItemCount(storedData) < listDataItemCount(expectedData)) {
    throw new Error("Library save verification did not match the imported library.");
  }
}

async function writeOwnDataDirect(nextData, options = {}) {
  const safeData = compactImportedAnimeForStorage(nextData);
  if (typeof saveTimeout !== 'undefined' && saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);
  if (currentUser) localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(safeData));
  localStorage.setItem("watchlist-tracker-data", JSON.stringify(safeData));
  if (DOC_REF) {
    await persistOwnDataToFirestore(safeData, options);
    if (currentUser?.uid === CREATOR_PUBLIC_UID) {
      await syncCreatorPublicProfileMirror(currentUser, userProfile, safeData);
    }
  } else if (options.verify) {
    throw new Error("You need to be signed in before importing to Shelfd.");
  }
  return safeData;
}
async function loadOwnDataFromFirestore() {
  return loadWatchlistDataFromDocRef(DOC_REF);
}
