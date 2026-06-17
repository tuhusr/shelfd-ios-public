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

/* v11.391: shelf privacy gate. Accounts are PRIVATE by default — only the owner,
   a confirmed mutual friend, or a public creator account may see a user's lists.
   Everyone else gets the locked "Private account" shelf (banner + tabs still
   show; the list content area is replaced with a lock). */
function isShelfUserShelfPrivate(uid) {
  const u = String(uid || '').trim();
  if (!u) return false;
  if (typeof currentUser !== 'undefined' && currentUser && u === currentUser.uid) return false;
  if (Array.isArray(friends) && friends.includes(u)) return false;
  const userLike = (typeof usersMap === 'object' && usersMap && usersMap[u]) ? usersMap[u] : { uid: u };
  if (typeof isCreatorAdmin === 'function' && isCreatorAdmin(userLike)) return false;
  return true;
}

function isOwnerBadgeAccount(userLike = null) {
  const uid = String(userLike?.uid || userLike?.id || '').trim();
  if (uid === CREATOR_PUBLIC_UID) return true;
  const email = getUserAccountEmail(userLike);
  if (email === CREATOR_ADMIN_EMAIL) return true;
  const handle = String(
    userLike?.usernameHandleLower ||
    userLike?.usernameLower ||
    userLike?.username ||
    userLike?.handle ||
    ''
  ).trim().replace(/^@+/, '').toLowerCase();
  return handle === CREATOR_PUBLIC_PROFILE_SLUG;
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

function renderDisplayNameHTML(userLike = null, fallback = 'Unknown User', extraClass = '', options = {}) {
  const classes = ['creator-name'];
  if (extraClass) classes.push(extraClass);
  const nameHtml = escHtml(getDisplayName(userLike, fallback));
  const creativeTeamTag = isCreativeTeamUser(userLike) ? renderCreativeTeamTagHTML() : '';
  if (isCreatorAdmin(userLike)) {
    /* v10.710: compact-creator-badge mode for activity-feed contexts.
       The full "(Creator)" pill was eating horizontal space on Base-class
       iPhones (390pt) and truncating the username. Compact mode swaps the
       pill for a tappable circular "C" with a tooltip popover that reveals
       the word "Creator" for ~1.8s above it. Only opted into by the
       activity-card / post-detail / stack-card renders in 10-activity-feed.js;
       profile, DMs, and comment replies keep the original full pill. */
    if (options && options.compactCreatorBadge) {
      if (isOwnerBadgeAccount(userLike)) {
        return `<span class="creator-name-wrap user-badged-name-wrap"><span class="${classes.join(' ')}">${nameHtml}</span><button type="button" class="creator-role creator-role-compact creator-role-owner" onclick="event.stopPropagation();toggleCreatorRoleTooltip(this)" aria-label="Creator and Developer"><img class="creator-owner-badge-img" src="/badges/owner-badge.svg" width="12" height="15" alt="" decoding="async"><span class="creator-role-tooltip creator-owner-tooltip" role="status" aria-hidden="true">Creator and Developer</span></button>${creativeTeamTag}</span>`;
      }
      return `<span class="creator-name-wrap user-badged-name-wrap"><span class="${classes.join(' ')}"><svg class="creator-crown-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" style="vertical-align:-0.12em;margin-right:0.28em;"><path d="M3.2 7.4c-.65-.4-1.45.24-1.2.97l2.7 7.95c.18.54.69.9 1.26.9h12.08c.57 0 1.08-.36 1.26-.9l2.7-7.95c.25-.73-.55-1.37-1.2-.97l-4.3 2.65c-.55.34-1.27.16-1.6-.4L12.86 5.1a1 1 0 0 0-1.72 0L8.1 9.65c-.33.56-1.05.74-1.6.4L3.2 7.4Zm2.6 11.1c0 .55.45 1 1 1h10.4c.55 0 1-.45 1-1v-.5H5.8v.5Z"/></svg>${nameHtml}</span><button type="button" class="creator-role creator-role-compact" onclick="event.stopPropagation();toggleCreatorRoleTooltip(this)" aria-label="Creator">C<span class="creator-role-tooltip" role="status" aria-hidden="true">Creator</span></button>${creativeTeamTag}</span>`;
    }
    return `<span class="creator-name-wrap user-badged-name-wrap"><span class="${classes.join(' ')}"><svg class="creator-crown-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" style="vertical-align:-0.12em;margin-right:0.28em;"><path d="M3.2 7.4c-.65-.4-1.45.24-1.2.97l2.7 7.95c.18.54.69.9 1.26.9h12.08c.57 0 1.08-.36 1.26-.9l2.7-7.95c.25-.73-.55-1.37-1.2-.97l-4.3 2.65c-.55.34-1.27.16-1.6-.4L12.86 5.1a1 1 0 0 0-1.72 0L8.1 9.65c-.33.56-1.05.74-1.6.4L3.2 7.4Zm2.6 11.1c0 .55.45 1 1 1h10.4c.55 0 1-.45 1-1v-.5H5.8v.5Z"/></svg>${nameHtml}</span><span class="creator-role">(Creator)</span>${creativeTeamTag}</span>`;
  }
  if (creativeTeamTag) {
    return `<span class="creator-name-wrap user-badged-name-wrap"><span${extraClass ? ` class="${extraClass}"` : ''}>${nameHtml}</span>${creativeTeamTag}</span>`;
  }
  return `<span${extraClass ? ` class="${extraClass}"` : ''}>${nameHtml}</span>`;
}

/* v10.710: tap-to-reveal tooltip handler for the compact creator-role C.
   Single-button-active-at-a-time semantics: tapping a different C closes
   any other open tooltip first. Auto-dismisses after 1.8s or on retap. */
function toggleCreatorRoleTooltip(btn) {
  if (!btn) return;
  const tooltip = btn.querySelector('.creator-role-tooltip');
  if (!tooltip) return;
  try {
    if (btn._creatorTooltipTimer) {
      clearTimeout(btn._creatorTooltipTimer);
      btn._creatorTooltipTimer = null;
    }
  } catch (_) {}
  const isVisible = tooltip.classList.contains('creator-role-tooltip-visible');
  /* Hide every other visible tooltip on the page. */
  document.querySelectorAll('.creator-role-tooltip-visible').forEach(el => {
    if (el !== tooltip) el.classList.remove('creator-role-tooltip-visible');
  });
  if (isVisible) {
    tooltip.classList.remove('creator-role-tooltip-visible');
    return;
  }
  tooltip.classList.add('creator-role-tooltip-visible');
  tooltip.setAttribute('aria-hidden', 'false');
  btn._creatorTooltipTimer = setTimeout(() => {
    tooltip.classList.remove('creator-role-tooltip-visible');
    tooltip.setAttribute('aria-hidden', 'true');
    btn._creatorTooltipTimer = null;
  }, 1800);
}
if (typeof window !== 'undefined') window.toggleCreatorRoleTooltip = toggleCreatorRoleTooltip;

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
  avatar.src = photo || '/default-avatar.svg#King%20Kooom&background=1c1535&color=a78bfa';
  avatar.onerror = () => {
    avatar.onerror = null;
    avatar.src = '/default-avatar.svg#King%20Kooom&background=1c1535&color=a78bfa';
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

function normalizeShelfdUserSearchQuery(value = '') {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}
if (typeof window !== 'undefined') window.normalizeShelfdUserSearchQuery = normalizeShelfdUserSearchQuery;

async function fetchShelfdUsersByHandlePrefix(query = '', options = {}) {
  const normalized = normalizeShelfdUserSearchQuery(query);
  if (!normalized || typeof db === 'undefined' || !db || typeof firebase === 'undefined' || !firebase?.firestore?.FieldPath) return [];

  const limit = Math.max(1, Math.min(Number(options.limit) || 12, 30));
  const excludeUid = String(options.excludeUid || '').trim();
  const usernameEntries = new Map();
  const addUsernameDoc = (doc) => {
    if (!doc?.exists) return;
    const raw = doc.data() || {};
    const uid = String(raw.uid || '').trim();
    const handleLower = normalizeShelfdUserSearchQuery(doc.id || raw.usernameLower || raw.handleLower || raw.username || '');
    if (!uid || !handleLower || uid === excludeUid) return;
    if (usernameEntries.has(uid)) return;
    usernameEntries.set(uid, {
      uid,
      usernameHandle: String(raw.username || '').trim(),
      usernameHandleLower: handleLower
    });
  };

  try {
    const exactSnap = await db.collection('usernames').doc(normalized).get();
    addUsernameDoc(exactSnap);
  } catch (_) {}

  try {
    const prefixSnap = await db.collection('usernames')
      .orderBy(firebase.firestore.FieldPath.documentId())
      .startAt(normalized)
      .endAt(normalized + '\uf8ff')
      .limit(Math.max(limit * 2, limit + 4))
      .get();
    prefixSnap.forEach(addUsernameDoc);
  } catch (_) {}

  if (!usernameEntries.size) return [];

  const hydrated = await Promise.all(
    [...usernameEntries.values()].map(async entry => {
      try {
        const userSnap = await db.collection('users').doc(entry.uid).get();
        const raw = userSnap.exists ? (userSnap.data() || {}) : {};
        const user = { ...raw, uid: entry.uid };
        if (!user.usernameHandle) user.usernameHandle = entry.usernameHandle || entry.usernameHandleLower;
        if (!user.usernameHandleLower) user.usernameHandleLower = entry.usernameHandleLower;
        if (typeof usersMap === 'object' && usersMap) {
          usersMap[entry.uid] = { ...(usersMap[entry.uid] || {}), ...user };
          return usersMap[entry.uid];
        }
        return user;
      } catch (_) {
        return {
          uid: entry.uid,
          usernameHandle: entry.usernameHandle || entry.usernameHandleLower,
          usernameHandleLower: entry.usernameHandleLower
        };
      }
    })
  );

  return hydrated
    .filter(user => user?.uid && String(user.uid || '').trim() !== excludeUid)
    .sort((a, b) => {
      const aHandle = normalizeShelfdUserSearchQuery(a?.usernameHandleLower || a?.usernameHandle || a?.username || a?.handle || '');
      const bHandle = normalizeShelfdUserSearchQuery(b?.usernameHandleLower || b?.usernameHandle || b?.username || b?.handle || '');
      const aExact = aHandle === normalized ? 0 : 1;
      const bExact = bHandle === normalized ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStarts = aHandle.startsWith(normalized) ? 0 : 1;
      const bStarts = bHandle.startsWith(normalized) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      const aName = String(a?.name || a?.customName || a?.displayName || '').trim().toLowerCase();
      const bName = String(b?.name || b?.customName || b?.displayName || '').trim().toLowerCase();
      return aName.localeCompare(bName);
    })
    .slice(0, limit);
}
if (typeof window !== 'undefined') window.fetchShelfdUsersByHandlePrefix = fetchShelfdUsersByHandlePrefix;

async function syncCreatorPublicProfileMirror(user = null, profile = null, listSource = null, options = {}) {
  const email = normalizeEmail(user?.email || profile?.accountEmailLower || profile?.emailLower || profile?.email || '');
  const isCreator = String(user?.uid || '').trim() === CREATOR_PUBLIC_UID || email === CREATOR_ADMIN_EMAIL;
  if (!isCreator || !user?.uid) return;
  const source = normalizeUserProfile(profile || userProfile || {});
  const shouldClearListData = options.clearListData === true || (listSource && options.includeListData === false);
  const publicListData = listSource && options.includeListData !== false
    ? compactImportedAnimeForStorage(listSource)
    : null;
  const publicListBytes = publicListData ? getShelfdJsonByteLength(publicListData) : 0;
  const canMirrorListData = !!publicListData && publicListBytes < 760000;
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
  if (canMirrorListData) publicPayload.publicListData = publicListData;
  try {
    const mirrorWrite = {
      ...publicPayload,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (canMirrorListData) {
      mirrorWrite.publicListUpdatedAt = firebase.firestore.FieldValue.serverTimestamp();
    } else if (shouldClearListData || publicListData) {
      mirrorWrite.publicListData = firebase.firestore.FieldValue.delete();
      mirrorWrite.publicListUpdatedAt = firebase.firestore.FieldValue.delete();
    }
    await db.collection('publicProfiles').doc(CREATOR_PUBLIC_PROFILE_SLUG).set(mirrorWrite, { merge: true });
    if (typeof window !== 'undefined') {
      window.__lastCreatorPublicMirrorDebug = {
        ok: true,
        includedListData: canMirrorListData,
        clearedListData: !!(!canMirrorListData && (shouldClearListData || publicListData)),
        publicListBytes,
        reason: String(options.reason || ''),
        at: new Date().toISOString()
      };
    }
    cacheCreatorPublicUser(publicPayload);
  } catch (e) {
    if (typeof window !== 'undefined') {
      window.__lastCreatorPublicMirrorDebug = {
        ok: false,
        code: String(e?.code || ''),
        message: String(e?.message || e || ''),
        includedListData: canMirrorListData,
        publicListBytes,
        reason: String(options.reason || ''),
        at: new Date().toISOString()
      };
    }
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

/* v10.231: replaced "books" with "music" in the My Lists category toggle.
   Books data array stays in SCREENLIST_SECTIONS for back-compat (no UI surface
   to view it; safe to leave untouched in stored data). Music gets its own
   array, single status tab, and "Listened" label. */
const SCREENLIST_SECTIONS = ["movies", "shows", "anime", "games", "manga", "books", "music"];
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
  if (section === "movies") return "planned";
  /* v10.897: "In Rotation" (storage 'watching') was removed from the music
     section. Music now exposes only "Listened" (storage 'watched') and
     "Planned" (storage 'planned'). Default landing tab is Listened.
     Legacy 'watching' items get auto-migrated to 'watched' on read in
     `normalizeListEntry`, so any pre-v10.897 data still surfaces. */
  if (section === "music") return "watched";
  return "watching";
}

const SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION = {
  shows: ['watching', 'planned', 'watched', 'paused'],
  anime: ['watching', 'planned', 'watched', 'paused'],
  movies: ['planned', 'watched', 'paused'],
  games: ['watching', 'planned', 'watched', 'wishlist'],
  manga: ['watching', 'planned', 'watched', 'paused'],
  books: ['watching', 'planned', 'watched', 'paused'],
  /* v10.897: music drops "In Rotation" (storage 'watching'). Only
     "Listened" (storage 'watched') and "Planned" (storage 'planned')
     remain. Order matches the existing left→right convention. */
  music: ['watched', 'planned']
};

function isVisibleMyListStatusTab(tab = activeTab, section = activeSection) {
  return (SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION[section] || SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION.shows).includes(tab);
}

function normalizeVisibleMyListStatusTab(tab = activeTab, section = activeSection) {
  if (section === 'games' && (tab === 'live' || tab === 'competitive')) return 'watching';
  return isVisibleMyListStatusTab(tab, section) ? tab : getDefaultTabForSection(section);
}

function getMyListStatusLabel(status = '', section = activeSection) {
  if (status === 'live') return 'Live Games';
  if (status === 'competitive') return 'Competitive';
  if (status === 'wishlist') return section === 'games' ? 'Wishlist' : 'Wishlist';
  if (status === 'watching') {
    if (section === 'games') return 'Playing';
    /* v10.897: music's 'watching' status was removed. If any stale
       item still has it (pre-migration), label it as Listened so the
       UI is coherent with the new music status set. */
    if (section === 'music') return 'Listened';
    return isReadingSection(section) ? 'Reading' : 'Watching';
  }
  if (status === 'planned') {
    if (section === 'games') return 'Planning';
    if (section === 'music') return 'Planning';
    return isReadingSection(section) ? 'TBR' : 'Planning';
  }
  if (status === 'watched') {
    if (section === 'games') return 'Played';
    if (section === 'music') return 'Listened';
    return isReadingSection(section) ? 'Read' : 'Watched';
  }
  if (status === 'paused') return 'Paused';
  if (status === 'dropped') return 'Dropped';
  return String(status || '');
}

function getMyListStatusButtonConfigs(section = activeSection) {
  const statuses = section === 'games'
    ? ['watching', 'live', 'competitive', 'planned', 'watched', 'wishlist']
    : (SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION[section] || SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION.shows);
  return statuses.map(status => ({ status, label: getMyListStatusLabel(status, section) }));
}


function getSectionLabel(section, singular = false) {
  if (section === "movies") return singular ? "movie" : "movies";
  if (section === "anime") return singular ? "anime" : "anime";
  if (section === "games") return singular ? "game" : "games";
  if (section === "manga") return singular ? "manga" : "manga";
  if (section === "books") return singular ? "book" : "books";
  if (section === "music") return singular ? "album" : "music";
  return singular ? "show" : "shows";
}

function getSectionIcon(section) {
  if (section === "movies") return "🎬";
  if (section === "anime") return "🌸";
  if (section === "games") return "🎮";
  if (section === "manga") return "📚";
  if (section === "books") return "📖";
  if (section === "music") return "🎵";
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
  /* v10.509: app-wide default rating scale switched from 10-star to
     5-star with half-star steps. Internal storage stays as a 1–10
     integer (each unit = half-star) so existing ratings carry over
     without migration; display layers everywhere now render the 5-
     point scale with halves and the "X/5" suffix. */
  return { media: 'five', games: 'five' };
}

/* v813 — Theme value mapping (corrected against screenshots):
   ───────────────────────────────────────────────────────────────────────
   Visual ground truth: correct_default_theme.png + wrong_legacy_theme.png
   in the project root.

     'true-dark' → adds body.true-dark-mode. Page #0E0E0E, cards #272727 /
                   #0a0a0a, neutral-charcoal overrides on Discover /
                   My Lists / Activity, lavender ACCENTS on buttons.
                   ✅ This matches correct_default_theme.png — the current
                   user-facing "Default Theme — Standard Shelfd look".
                   The v482 rename ("True Dark Mode renamed to Default
                   Theme") was correct: the underlying class still
                   produces the modern Shelfd UI.

     'default'   → no body class. BASE CSS leaves cards on
                   rgba(8, 6, 18, 0.92) deep purple-navy and the page
                   shows a stronger purple feel throughout.
                   ❌ This matches wrong_legacy_theme.png — the OLD
                   purple-gradient legacy UI. Quarantined.

     'light'     → adds body.light-mode. LEGACY Light Mode (quarantined).
     'cream'     → adds body.light-mode + body.cream-mode. LEGACY Cream
                   paper theme (quarantined).

   v812 had this inverted (made 'default' the active value). v813
   reverts the inversion based on the visual screenshots while keeping
   the rest of the v808–v812 hardening (Light/Cream hidden, stale
   values normalized, legacy trailer button killed, SW cache bumps). */
function getDefaultThemeMode() {
  return 'true-dark';
}

function normalizeThemeMode(value) {
  if (value === 'light')     return 'light';
  if (value === 'cream')     return 'cream';
  if (value === 'true-dark') return 'true-dark';
  return 'default';
}

/* v808/v812/v813 — Step 1: force every user into the current Default
   Theme. Anything that isn't literally 'true-dark' (default / light /
   cream / null / undefined / invalid / legacy) coerces to 'true-dark'.
   To re-enable other themes later, replace this body with
   `return normalizeThemeMode(value);` */
function resolveActiveThemeMode(value) {
  if (value === 'true-dark') return 'true-dark';
  return getDefaultThemeMode();
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
  /* v10.393: music was forced to 5-star half-step regardless of the
     user's media preference.
     v10.407: REVERTED — music now follows the same media preference as
     movies / shows / anime / etc., defaulting to 10-star. Albums and
     individual tracks both share the same scale via this one path.
     v10.509: FORCED app-wide to 'five' (5-star with half-star steps)
     for EVERY section — games / movies / shows / anime / music.
     Pattern matches `resolveActiveThemeMode` at line 523-526 which
     hard-coerces every user into the active default theme. The stored
     `ratingPreferences` on each profile is left intact (untouched) so
     this can be reverted to a per-user preference later by deleting
     the next two lines. The legacy `prefs` resolution below is kept
     dormant for that potential rollback. */
  return 'five';
  // eslint-disable-next-line no-unreachable
  const prefs = getRatingPreferencesForProfile(profile);
  return prefs[getRatingPreferenceKeyForSection(section)] || 'five';
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

function extractAnimeMalIdFromUrl(value = '') {
  const clean = String(value || '').trim();
  const match = clean.match(/myanimelist\.net\/anime\/(\d+)/i) || clean.match(/\/anime\/(\d+)(?:[/?#]|$)/i);
  return match ? String(match[1]) : '';
}

function getAnimeMalIdFromItem(item = {}) {
  if (!item || typeof item !== 'object') return '';
  const direct = item.malId || item.mal_id || item.__mal_id || item.animeMalId || item.external_ids?.mal_id || '';
  if (direct && Number(direct) > 0) return String(Number(direct));
  const sourceId = String(item.sourceId || '').trim();
  if (String(item.source || '').toLowerCase() === 'myanimelist' && /^\d+$/.test(sourceId)) return sourceId;
  return extractAnimeMalIdFromUrl(item.malUrl || item.jikanUrl || item.url || item.sourceUrl || '');
}

function normalizeAnimeIdentityFieldsForStorage(item = {}) {
  const next = item && typeof item === 'object' ? { ...item } : {};
  const malId = getAnimeMalIdFromItem(next);
  if (malId) {
    next.malId = malId;
    next.mal_id = malId;
    next.animeIdentityKey = `mal:${malId}`;
    const existingMalUrl = /myanimelist\.net\/anime\//i.test(String(next.malUrl || next.url || ''))
      ? (next.malUrl || next.url)
      : '';
    next.malUrl = existingMalUrl || `https://myanimelist.net/anime/${malId}`;
    next.jikanUrl = next.jikanUrl || next.malUrl;
    if (!next.url || /myanimelist\.net\/anime\//i.test(String(next.url))) next.url = next.malUrl;
    if (!next.source) next.source = 'myanimelist';
  }
  return next;
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

function getShelfdJsonByteLength(value = null) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text || '').length;
    return unescape(encodeURIComponent(text || '')).length;
  } catch (_) {
    return 0;
  }
}

const GAME_STORAGE_DROP_KEYS = new Set([
  'screenshots',
  'short_screenshots',
  'movies',
  'trailers',
  'clips',
  'videos',
  'video',
  'raw',
  'rawData',
  'rawProfile',
  'providerPayload',
  'apiResponse',
  'searchResults',
  'recommendations',
  'similar',
  'similarGames',
  'moreLikeThis',
  'storesRaw',
  'platformsRaw',
  'tags',
  'tagNames',
  'ratings',
  'reactions',
  'added_by_status',
  'description',
  'description_raw',
  'about',
  'detailedDescription',
  '_aliases',
  '_ranking',
  '_match',
  '_sourceCandidate',
  'alternative_names'
]);
const GAME_STORAGE_IMPORTANT_OBJECT_KEYS = new Set([
  'competitiveStats',
  'trackerAccount',
  'shelfdGameIdentityLock'
]);

function normalizeGameStorageText(value = '', key = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^data:(image|video|audio|application)\//i.test(raw)) return '';
  const urlish = /(url|cover|poster|image|background|photo|logo|icon|highlight|clip|trailer|store)/i.test(key);
  const maxBytes = urlish ? 4096 : 16000;
  if (getShelfdJsonByteLength(raw) <= maxBytes) return raw;
  return raw.slice(0, maxBytes);
}

function compactGameStorageValue(value, key = '', depth = 0) {
  if (GAME_STORAGE_DROP_KEYS.has(key)) return undefined;
  if (value == null) return value;
  if (typeof File !== 'undefined' && value instanceof File) return undefined;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return undefined;
  if (typeof value === 'string') return normalizeGameStorageText(value, key);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth > 4) return [];
    const limit = key === 'genreNames' || key === 'stores' ? 40 : 80;
    const compact = value.slice(0, limit)
      .map(row => compactGameStorageValue(row, key, depth + 1))
      .filter(row => row !== undefined && row !== '');
    if (getShelfdJsonByteLength(compact) > 60000 && key !== 'genreNames') return [];
    return compact;
  }
  if (typeof value === 'object') {
    if (depth > 4) return undefined;
    const compact = {};
    Object.entries(value).forEach(([childKey, childValue]) => {
      const nextValue = compactGameStorageValue(childValue, childKey, depth + 1);
      if (nextValue !== undefined) compact[childKey] = nextValue;
    });
    if (!GAME_STORAGE_IMPORTANT_OBJECT_KEYS.has(key) && getShelfdJsonByteLength(compact) > 80000) return undefined;
    return compact;
  }
  return undefined;
}

function normalizeGameNameArray(value = null) {
  if (!Array.isArray(value)) return [];
  return value
    .map(row => {
      if (typeof row === 'string') return row;
      return row?.name || row?.platform?.name || row?.store?.name || row?.developer?.name || row?.publisher?.name || '';
    })
    .map(row => String(row || '').trim())
    .filter(Boolean)
    .slice(0, 24);
}

function compactGameItemForStorage(item = {}) {
  if (!item || typeof item !== 'object') return item;
  const beforeBytes = getShelfdJsonByteLength(item);
  const next = normalizeGameDetailFieldsForStorage({ ...item });

  const genreNames = Array.isArray(next.genreNames) && next.genreNames.length
    ? normalizeGameNameArray(next.genreNames)
    : normalizeGameNameArray(next.genres);
  if (genreNames.length) {
    next.genreNames = genreNames;
    if (!next.genre) next.genre = genreNames.join(', ');
  }
  if (Array.isArray(next.platforms)) {
    next.platforms = normalizeGameNameArray(next.platforms).join(', ');
  }
  if (Array.isArray(next.stores)) {
    next.stores = normalizeGameNameArray(next.stores);
  }
  if (Array.isArray(next.episodes) && next.episodes.length === 0) next.episodes = [];

  const compact = compactGameStorageValue(next, 'game', 0) || {};
  compact.mediaCategory = compact.mediaCategory || 'games';
  compact.librarySection = compact.librarySection || 'games';
  if (!compact.name && compact.title) compact.name = compact.title;
  if (!compact.title && compact.name) compact.title = compact.name;
  if (!Array.isArray(compact.episodes)) compact.episodes = [];

  const afterBytes = getShelfdJsonByteLength(compact);
  if (typeof window !== 'undefined' && beforeBytes > Math.max(50000, afterBytes * 2)) {
    window.__lastGameStorageCompactionDebug = {
      title: String(compact.title || compact.name || ''),
      beforeBytes,
      afterBytes,
      savedBytes: Math.max(0, beforeBytes - afterBytes),
      at: new Date().toISOString()
    };
  }
  return compact;
}
if (typeof window !== 'undefined') {
  window.compactGameItemForStorage = compactGameItemForStorage;
  window.getShelfdJsonByteLength = getShelfdJsonByteLength;
}

function normalizeListEntry(item, fallbackSection) {
  if (!item || typeof item !== 'object') return null;
  let next = { ...item };
  /* v10.897: music dropped the "In Rotation" status (storage 'watching').
     Any legacy item still stored as `status: 'watching'` is migrated to
     'watched' (Listened) on read. Idempotent — runs on every load and
     save normalization pass, so the next user-triggered save naturally
     persists the migration to Firestore. */
  if (fallbackSection === 'music' && next.status === 'watching') {
    next.status = 'watched';
  }
  if (fallbackSection === 'movies' || fallbackSection === 'shows' || fallbackSection === 'anime' || fallbackSection === 'games') {
    const rawPriority = Number(next.watchPriority || next.watchlistPriority || next.priority || 0);
    if (Number.isFinite(rawPriority) && rawPriority > 0) {
      next.watchPriority = Math.max(1, Math.floor(rawPriority));
    } else {
      delete next.watchPriority;
      delete next.watchlistPriority;
    }
  }
  if (isShowSection(fallbackSection)) {
    const resolvedSection = resolveShowSection(next, fallbackSection);
    next.mediaCategory = resolvedSection;
    next.librarySection = resolvedSection;
    next.isAnime = resolvedSection === 'anime';
    if (resolvedSection === 'anime') next = normalizeAnimeIdentityFieldsForStorage(next);
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

/* =============================================================================
   v11.087: Anime parent/season consolidation for My Lists.

   Anime is now treated like TV shows: ONE parent series card per anime, with
   its seasons/parts grouped underneath (rendered via the same episodes[] +
   seasonsInfo[] + per-season rating machinery TV already uses). For a stretch
   the app SPLIT anime into one library card per season (see the now-removed
   shouldSplitAnimeSeasons path) — this collapses those legacy separate-season
   cards back into a single parent at load time.

   SAFETY:
   - Only groups anime entries that share a real TMDB id (tmdb tv id == the
     series). The per-season number comes from the stored `tmdbSeasonNumber`,
     so no title-guessing is involved and distinct series never merge.
   - Non-destructive: every season's episodes, watched flags, per-episode and
     per-season ratings, and status are preserved INSIDE the parent. The
     original per-season records are kept under `animeSeasonSources` so the
     grouping is fully reversible.
   - Idempotent: a consolidated parent (no tmdbSeasonNumber, multi-season
     episodes) sitting alone in its group is returned unchanged.
   - Anime-only. Never touches shows / movies / games / music.

   MAL/Jikan-only multi-entry series (no shared TMDB id, e.g. arc-named titles)
   are intentionally left as-is here — reliable grouping for those needs Jikan
   relation data, not display titles, so it is handled separately and never by
   risky title matching against a real library. ========================== */
function stripAnimeSeasonMarkerFromTitle(title = '') {
  return String(title || '')
    .replace(/\s*[:\-—–]\s*(the\s+)?(final\s+season|season\s*\d+|part\s*\d+|cour\s*\d+|\d+(?:st|nd|rd|th)\s+season)\b.*$/i, '')
    .replace(/\s+(the\s+)?(final\s+season|season\s*\d+|part\s*\d+|cour\s*\d+|\d+(?:st|nd|rd|th)\s+season)\b.*$/i, '')
    .trim();
}

function deriveConsolidatedAnimeStatus(statuses = []) {
  const present = new Set(statuses.filter(Boolean));
  /* Most "active" status wins so a part-finished series reads correctly. */
  for (const s of ['watching', 'paused', 'planned', 'watched', 'dropped']) {
    if (present.has(s)) return s;
  }
  return statuses[0] || 'planned';
}

/* Jikan-first grouping key: the MAL series root (resolved via Jikan prequel
   chains, stored on the item as animeSeriesRootId) is the primary identity.
   A TMDB id is only used as a fallback when an anime has not been matched to
   MAL yet. Items with neither stay standalone (passthrough). */
function getAnimeSeriesGroupKey(item) {
  const root = String(item?.animeSeriesRootId || '').trim();
  if (root) return 'mal:' + root;
  const tmdbId = String(item?.tmdbId || '').trim();
  if (tmdbId) return 'tmdb:' + tmdbId;
  return '';
}

function consolidateAnimeLibrarySeasons(list) {
  const items = Array.isArray(list) ? list : [];
  if (items.length < 2) return items;

  const groups = new Map();
  const order = [];
  const passthrough = [];
  items.forEach(item => {
    const key = getAnimeSeriesGroupKey(item);
    if (!key) { passthrough.push(item); return; }
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(item);
  });

  const result = [];
  let mergedAny = false;
  order.forEach(key => {
    const group = groups.get(key);
    if (group.length < 2) { result.push(group[0]); return; }
    mergedAny = true;
    result.push(mergeAnimeSeasonGroup(group));
  });

  if (window.SHELFD_DEBUG_ANIME_GROUPING && mergedAny) {
    try { console.log('[anime-grouping] consolidated', items.length, '→', result.length + passthrough.length, 'anime cards'); } catch (_) {}
  }
  return result.concat(passthrough);
}

/* Chronological sort key for a season "unit": air date → year → TMDB season
   number → date added. Keeps seasons in real release order across TMDB cards,
   MAL entries, and already-consolidated parents alike. */
function animeSeasonUnitSortKey(unit) {
  if (unit.airDate) return '0:' + String(unit.airDate);
  if (unit.year) return '0:' + unit.year + '-00-00';
  if (unit.tmdbSeasonNumber) return '1:' + String(unit.tmdbSeasonNumber).padStart(4, '0');
  if (unit.dateAdded) return '2:' + String(unit.dateAdded);
  return '3:';
}

function mergeAnimeSeasonGroup(group) {
  /* Break every entry down into season "units". An already-consolidated parent
     contributes one unit per existing season; a single-season card (TMDB split
     card OR a MAL entry) contributes one unit. This makes the merge robust and
     idempotent — re-running, or adding a new season later, just re-derives the
     same ordered season list. */
  const units = [];
  const carriedSources = [];
  let earliestAdded = '';

  group.forEach(entry => {
    const eps = Array.isArray(entry.episodes) ? entry.episodes : [];
    if (entry.dateAdded && (!earliestAdded || entry.dateAdded < earliestAdded)) earliestAdded = entry.dateAdded;
    const isConsolidatedParent = Array.isArray(entry.animeSeasonSources) && entry.animeSeasonSources.length > 0;
    const bySeason = new Map();
    eps.forEach(ep => {
      const sn = Number(ep?.seasonNum || 1) || 1;
      if (!bySeason.has(sn)) bySeason.set(sn, []);
      bySeason.get(sn).push(ep);
    });

    if (isConsolidatedParent && bySeason.size) {
      /* Expand a parent back into its seasons so nothing is lost on re-merge. */
      [...bySeason.keys()].sort((a, b) => a - b).forEach(sn => {
        const info = (entry.seasonsInfo || []).find(s => Number(s.seasonNum || s.season_number) === sn) || {};
        const seasonEps = bySeason.get(sn);
        units.push({
          episodes: seasonEps,
          name: info.name || info.title || '',
          cover: info.cover || entry.cover || '',
          airDate: info.airDate || (seasonEps[0] && (seasonEps[0].airDate || seasonEps[0].air_date)) || '',
          year: '',
          tmdbSeasonNumber: 0,
          rating: Number(entry.seasonRatings?.[sn] || 0),
          status: '',
          watchedCount: seasonEps.filter(ep => ep && ep.watched).length,
          episodeCount: Math.max(seasonEps.length, Number(info.episodeCount || 0) || 0)
        });
      });
      (entry.animeSeasonSources || []).forEach(s => carriedSources.push(s));
    } else {
      const info0 = Array.isArray(entry.seasonsInfo) && entry.seasonsInfo[0] ? entry.seasonsInfo[0] : {};
      /* Compact MAL imports store progress as a COUNT (currentEp / watchedEpisodes)
         with episodes:[] — read it so the per-season watched count survives the
         merge instead of being dropped. */
      const hasRealEps = eps.length > 0;
      const unitWatched = hasRealEps
        ? eps.filter(ep => ep && ep.watched).length
        : (Number(entry.currentEp || entry.watchedEpisodes || 0) || 0);
      const unitTotal = hasRealEps
        ? eps.length
        : (Number(entry.totalEpisodes || entry.totalEps || 0) || 0);
      units.push({
        episodes: eps,
        name: info0.name || info0.title || (entry.parentTitle ? entry.title : '') || '',
        cover: entry.cover || info0.cover || '',
        airDate: info0.airDate || (eps[0] && (eps[0].airDate || eps[0].air_date)) || '',
        year: String(entry.year || '').slice(0, 4),
        tmdbSeasonNumber: Number(entry.tmdbSeasonNumber || 0) || 0,
        rating: Number(entry.rating || 0),
        status: entry.status || '',
        watchedCount: unitWatched,
        episodeCount: unitTotal
      });
      carriedSources.push({
        originalId: entry.id || '',
        malId: entry.malId || entry.mal_id || '',
        tmdbSeasonNumber: Number(entry.tmdbSeasonNumber || 0) || 0,
        title: entry.title || '',
        status: entry.status || '',
        rating: Number(entry.rating || 0),
        episodeCount: unitTotal,
        watchedCount: unitWatched
      });
    }
  });

  units.sort((a, b) => animeSeasonUnitSortKey(a).localeCompare(animeSeasonUnitSortKey(b)));

  /* Base = the series root: the entry whose MAL id IS the resolved root, else
     an existing consolidated parent, else the entry with no season marker. */
  const root = String(group.find(e => e && e.animeSeriesRootId)?.animeSeriesRootId || '');
  const base = (root && group.find(e => String(e.malId || e.mal_id || '') === root))
    || group.find(e => Array.isArray(e.animeSeasonSources) && e.animeSeasonSources.length)
    || group.find(e => !e.tmdbSeasonNumber && stripAnimeSeasonMarkerFromTitle(e.title) === e.title)
    || group[0];

  const parent = JSON.parse(JSON.stringify(base));
  delete parent.tmdbSeasonNumber;            /* series-level identity, TV-style */
  parent.title = base.parentTitle || stripAnimeSeasonMarkerFromTitle(base.title) || base.title;
  if (base.parentTitle) delete parent.parentTitle;
  parent.mediaCategory = 'anime';
  parent.librarySection = 'anime';
  parent.isAnime = true;
  if (root) parent.animeSeriesRootId = root;

  /* Reindex seasons 1..N in chronological order and re-tag every episode. */
  const seasonsInfo = [];
  const seasonRatings = {};
  const episodes = [];
  const statuses = [];
  units.forEach((u, idx) => {
    const sn = idx + 1;
    seasonsInfo.push({
      seasonNum: sn, season_number: sn,
      name: u.name || `Season ${sn}`, title: u.name || `Season ${sn}`,
      cover: u.cover || '', airDate: u.airDate || '',
      episodeCount: Number(u.episodeCount || u.episodes.length || 0) || 0,
      watchedCount: Number(u.watchedCount || 0) || 0
    });
    if (Number(u.rating) > 0) seasonRatings[sn] = Number(u.rating);
    if (u.status) statuses.push(u.status);
    u.episodes.forEach(ep => episodes.push({ ...ep, seasonNum: sn, seasonName: u.name || `Season ${sn}` }));
  });
  episodes.sort((a, b) => (a.seasonNum - b.seasonNum) || (Number(a.epNum || a.number || 0) - Number(b.epNum || b.number || 0)));
  episodes.forEach((ep, i) => { ep.number = i + 1; });

  /* Sums across seasons let a COMPACT merged parent (MAL imports, episodes:[])
     still report correct total + watched progress before on-demand enrichment
     materializes the real episodes. */
  const sumEpisodeCount = units.reduce((s, u) => s + (Number(u.episodeCount || u.episodes.length || 0) || 0), 0);
  const sumWatched = units.reduce((s, u) => s + (Number(u.watchedCount || 0) || 0), 0);
  parent.episodes = episodes;
  parent.totalEpisodes = Math.max(episodes.length, sumEpisodeCount);
  parent.totalEps = parent.totalEpisodes;
  parent.currentEp = Math.max(episodes.filter(ep => ep.watched).length, sumWatched);
  parent.seasonsInfo = seasonsInfo;
  parent.seasonRatings = seasonRatings;
  parent.status = deriveConsolidatedAnimeStatus(statuses.length ? statuses : group.map(e => e.status));
  parent.dateAdded = earliestAdded || parent.dateAdded;
  parent.animeSeasonSources = carriedSources;
  return parent;
}

/* =============================================================================
   v11.088: background Jikan resolver — assigns each library anime its MAL
   series-root id (via Jikan prequel chains) so consolidateAnimeLibrarySeasons
   can group seasons/parts under one parent the MyAnimeList way. Runs once per
   session, rate-limited through the Jikan queue, cached in localStorage. Only
   ANNOTATES items (malId + animeSeriesRootId) — never deletes data — then
   re-consolidates, persists, and re-renders. TMDB ids are only used as a
   fallback group key for anime Jikan can't match. ========================== */
const ANIME_SERIES_ROOT_CACHE_KEY = 'shelfd-anime-series-root-v1';
let _animeSeriesRootResolveDone = false;
let _animeSeriesRootResolveInFlight = false;

function _loadAnimeRootCache() {
  try { return JSON.parse(localStorage.getItem(ANIME_SERIES_ROOT_CACHE_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function _saveAnimeRootCache(map) {
  try { localStorage.setItem(ANIME_SERIES_ROOT_CACHE_KEY, JSON.stringify(map)); } catch (_) {}
}

/* v11.092: expand a single anime library item into the FULL series — every
   TV/ONA season with its episodes, assembled from Jikan — so My Lists shows
   Season 1 / 2 / 3 just like a TV show (a Jikan add only carries its own
   season's episodes, flat as season 1). Watched flags + per-episode ratings
   the user already set are preserved by (season, episode). Runs once per item
   (animeSeriesEnriched flag). */
async function enrichAnimeItemWithSeriesSeasons(item, J) {
  const malId = String(item.malId || item.mal_id || '').replace(/[^0-9]/g, '');
  if (!malId) return false;
  let seasons = [];
  try { seasons = await J.getSeriesSeasons(malId); } catch (_) {}
  if (!Array.isArray(seasons) || !seasons.length) { item.animeSeriesEnriched = true; return false; }
  if (seasons.length === 1 && Array.isArray(item.episodes) && item.episodes.length) {
    /* Single-season series already fully represented — nothing to expand. */
    item.animeSeriesEnriched = true;
    return false;
  }

  /* Preserve existing progress. A consolidated parent already has correct
     per-season episodes; a single Jikan entry stores everything as season 1,
     so map it onto whichever assembled season matches the item's own mal id. */
  const isParent = Array.isArray(item.animeSeasonSources) && item.animeSeasonSources.length > 0;
  let ownIdx = seasons.findIndex(s => String(s.malId) === malId);
  if (ownIdx < 0) ownIdx = 0;
  const preserve = {};
  (Array.isArray(item.episodes) ? item.episodes : []).forEach(ep => {
    const sNum = isParent ? (Number(ep.seasonNum || 1) || 1) : (ownIdx + 1);
    const epNum = Number(ep.epNum || ep.number || 0) || 0;
    if (!epNum) return;
    if (ep.watched || Number(ep.rating || 0) > 0) preserve[sNum + ':' + epNum] = { watched: !!ep.watched, rating: Number(ep.rating || 0) };
  });

  /* MAL imports keep progress as a COUNT (currentEp / watchedEpisodes) with no
     episode flags. Bridge it to flags: per season mal id, how many episodes
     (from #1) the user has watched. Sourced from the merged parent's
     animeSeasonSources, and for a single compact entry, its own watched count. */
  const watchedCountByMal = {};
  (Array.isArray(item.animeSeasonSources) ? item.animeSeasonSources : []).forEach(src => {
    const m = String(src.malId || src.mal_id || '').replace(/[^0-9]/g, '');
    const wc = Number(src.watchedCount || 0) || 0;
    if (m && wc > 0) watchedCountByMal[m] = Math.max(watchedCountByMal[m] || 0, wc);
  });
  if (!isParent) {
    const ownCount = Number(item.currentEp || item.watchedEpisodes || 0) || 0;
    if (ownCount > 0 && malId) watchedCountByMal[malId] = Math.max(watchedCountByMal[malId] || 0, ownCount);
  }

  const newEpisodes = [];
  const seasonsInfo = [];
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    const sNum = i + 1;
    let eps = [];
    try { eps = await J.animeEpisodes(s.malId); } catch (_) {}
    if (!Array.isArray(eps) || !eps.length) {
      const cnt = Number(s.episodes || 0) || 0;
      eps = Array.from({ length: cnt }, (_, k) => ({ number: k + 1, title: '' }));
    }
    const seasonMal = String(s.malId || '').replace(/[^0-9]/g, '');
    const watchedUpTo = watchedCountByMal[seasonMal] || 0;
    seasonsInfo.push({
      seasonNum: sNum, season_number: sNum,
      name: s.title || `Season ${sNum}`, title: s.title || `Season ${sNum}`,
      cover: s.image || '', airDate: s.airedFrom || (s.year ? `${s.year}-01-01` : ''),
      episodeCount: eps.length
    });
    eps.forEach(ep => {
      const epNum = Number(ep.number || 0) || (newEpisodes.length + 1);
      const prev = preserve[sNum + ':' + epNum];
      /* Real saved flag wins; otherwise apply the MAL watched COUNT (eps 1..N). */
      const watched = prev ? !!prev.watched : (watchedUpTo > 0 && epNum <= watchedUpTo);
      newEpisodes.push({
        id: `${item.id}-ep-${sNum}-${epNum}`,
        number: newEpisodes.length + 1,
        seasonNum: sNum,
        seasonName: s.title || '',
        epNum,
        title: ep.title || '',
        airDate: String(ep.aired || '').slice(0, 10),
        watched,
        rating: prev ? prev.rating : 0
      });
    });
  }
  if (!newEpisodes.length) { item.animeSeriesEnriched = true; return false; }
  item.episodes = newEpisodes;
  item.seasonsInfo = seasonsInfo;
  item.totalEpisodes = newEpisodes.length;
  item.totalEps = newEpisodes.length;
  item.currentEp = newEpisodes.filter(e => e.watched).length;
  item.animeSeriesEnriched = true;
  return true;
}

/* v11.095: small, transient progress pill for the anime backlog migration.
   Inline-styled (no CSS file dependency) so it can't be cache-busted out of
   sync. Editorial Dark: surface-2 pill, single lavender pulse dot. Removed
   when the migration finishes. */
function showAnimeBacklogProgress(done, total) {
  try {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('shelfd-anime-backlog-progress');
    if (!(total > 0) || done >= total) {
      if (el) { el.style.opacity = '0'; setTimeout(() => { try { el.remove(); } catch (_) {} }, 400); }
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'shelfd-anime-backlog-progress';
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 88px);transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:9px;max-width:88vw;background:rgba(23,23,27,0.96);color:#f5f5f7;border:1px solid rgba(255,255,255,0.10);border-radius:999px;padding:9px 15px;font-size:12px;font-weight:700;letter-spacing:0.2px;box-shadow:0 10px 30px rgba(0,0,0,0.45);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:opacity .35s ease;opacity:0;';
      const dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#a78bfa;box-shadow:0 0 9px #a78bfa;flex:0 0 auto;animation:shelfdBacklogPulse 1.1s ease-in-out infinite;';
      const txt = document.createElement('span');
      txt.setAttribute('data-backlog-text', '');
      el.appendChild(dot);
      el.appendChild(txt);
      document.body.appendChild(el);
      if (!document.getElementById('shelfd-anime-backlog-style')) {
        const style = document.createElement('style');
        style.id = 'shelfd-anime-backlog-style';
        style.textContent = '@keyframes shelfdBacklogPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}';
        document.head.appendChild(style);
      }
      requestAnimationFrame(() => { el.style.opacity = '1'; });
    }
    const txt = el.querySelector('[data-backlog-text]');
    if (txt) txt.textContent = `Organizing your anime… ${done}/${total}`;
    el.style.opacity = '1';
  } catch (_) {}
}

/* v11.095: proactive, RESUMABLE backlog migration that merges a user's existing
   separate anime season entries into one parent series — no delete/re-add. For
   each anime it resolves the MAL series root (Jikan relation walk; cached in
   localStorage so it survives reloads), then consolidateAnimeLibrarySeasons
   collapses same-root entries into one parent, preserving every season's
   episodes/watched/ratings/status. Processed in batches with an incremental
   persist after each batch, so partial progress is saved if the session ends
   mid-run — the next open picks up exactly where it left off (the resolved
   roots are already cached). Full per-season episode assembly stays on-demand
   (episode page) to avoid a library-wide Jikan call storm. */
async function resolveAnimeSeriesRootsInBackground() {
  if (_animeSeriesRootResolveInFlight || _animeSeriesRootResolveDone) return;
  const J = window.JikanAnime;
  if (!J || typeof J.resolveSeriesRoot !== 'function') return;
  if (typeof data === 'undefined' || !data || !Array.isArray(data.anime) || !data.anime.length) return;
  if (typeof viewingUser !== 'undefined' && viewingUser) return;   /* own library only */
  const needsRoot = data.anime.filter(it => it && !it.animeSeriesRootId);
  if (!needsRoot.length) { _animeSeriesRootResolveDone = true; return; }

  _animeSeriesRootResolveInFlight = true;
  const rootCache = _loadAnimeRootCache();
  const malBridge = rootCache.__malBridge || (rootCache.__malBridge = {});
  const total = needsRoot.length;
  const BATCH = 5;
  let processed = 0;
  let dirtySincePersist = false;

  const persist = () => {
    _saveAnimeRootCache(rootCache);
    data.anime = consolidateAnimeLibrarySeasons(data.anime);
    try { if (typeof writeOwnDataDirect === 'function') writeOwnDataDirect(data); } catch (_) {}
    try { if (typeof render === 'function') render(); } catch (_) {}
  };

  try {
    showAnimeBacklogProgress(0, total);
    for (const item of needsRoot) {
      let malId = String(item.malId || item.mal_id || '').replace(/[^0-9]/g, '');
      if (!malId) {
        /* TMDB-only anime: conservative title → MAL bridge, cached (incl. misses). */
        const bridgeKey = 't:' + (item.tmdbId || '') + ':' + (item.title || '');
        if (Object.prototype.hasOwnProperty.call(malBridge, bridgeKey)) {
          malId = malBridge[bridgeKey] || '';
        } else {
          malId = (await J.resolveMalIdByTitle(item.title, item.year).catch(() => '')) || '';
          malBridge[bridgeKey] = malId;
        }
        if (malId) { item.malId = malId; item.mal_id = malId; }
      }
      if (malId) {
        let rootId = rootCache[malId];
        if (!rootId) {
          rootId = (await J.resolveSeriesRoot(malId).catch(() => malId)) || malId;
          rootCache[malId] = rootId;
        }
        if (item.animeSeriesRootId !== String(rootId)) { item.animeSeriesRootId = String(rootId); dirtySincePersist = true; }
      }
      processed += 1;
      showAnimeBacklogProgress(processed, total);
      /* Incremental persist so a mid-run reload keeps what we resolved. */
      if (dirtySincePersist && processed % BATCH === 0) { persist(); dirtySincePersist = false; }
    }
    if (dirtySincePersist) persist();
    else _saveAnimeRootCache(rootCache);
  } catch (_) {
  } finally {
    _animeSeriesRootResolveInFlight = false;
    _animeSeriesRootResolveDone = true;
    showAnimeBacklogProgress(total, total);   /* hide */
  }
}

/* v11.570: force a fresh anime root-resolution pass on demand (e.g. right after a
   MAL import adds ungrouped per-season entries). Resets the once-per-session guard
   then runs the existing throttled/cached resolver; the in-flight guard prevents a
   double run. Owned here so callers never poke the module-scoped guard directly. */
function kickAnimeSeriesRootResolve() {
  _animeSeriesRootResolveDone = false;
  if (typeof resolveAnimeSeriesRootsInBackground === 'function') {
    return resolveAnimeSeriesRootsInBackground();
  }
}
if (typeof window !== 'undefined') window.kickAnimeSeriesRootResolve = kickAnimeSeriesRootResolve;

function normalizeListData(source) {
  const normalized = getEmptyListData();
  const input = source && typeof source === 'object' ? source : {};

  /* v10.233: include "music" so loaded data always has an array we can push
     into. Previously music was added to SCREENLIST_SECTIONS but skipped here,
     leaving data.music undefined for users whose stored payload predates the
     section — which caused the "Sign in to add album..." prompt to fire even
     when logged in. */
  ["movies", "games", "manga", "books", "music"].forEach(section => {
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

  /* v11.087: collapse legacy split anime season cards into one parent series
     card (TV-style). Anime-only; reliable TMDB-id grouping; fully reversible. */
  normalized.anime = consolidateAnimeLibrarySeasons(normalized.anime);

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
let viewingReturnState = null;
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
  safe.games = (safe.games || []).map(item => compactGameItemForStorage(item)).filter(Boolean);
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
  if (!currentUser) keys.push("watchlist-tracker-data");
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

function writeOwnLocalBackupSafely(safeData, context = 'library-save') {
  try {
    if (currentUser) localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(safeData));
    else localStorage.setItem("watchlist-tracker-data", JSON.stringify(safeData));
    return true;
  } catch (lsErr) {
    /* localStorage is only a fast-restore cache. iOS can throw
       QuotaExceededError when the user's library backup grows past the
       WebView quota; that must never block the Firestore save. */
    console.warn(`[${context}] local library backup write skipped:`, lsErr && lsErr.name, lsErr && lsErr.message);
    if (typeof window !== 'undefined') {
      window.__lastOwnLocalBackupDebug = {
        ok: false,
        context,
        name: String(lsErr?.name || ''),
        message: String(lsErr?.message || lsErr || ''),
        at: new Date().toISOString()
      };
    }
    return false;
  }
}
if (typeof window !== 'undefined') window.writeOwnLocalBackupSafely = writeOwnLocalBackupSafely;

/* v10.387: schema-v2 split — each section now lives in its own subdoc at
   watchlist/{uid}/sections/{section} (shape: { data: '<JSON>', updatedAt }).
   The parent watchlist/{uid} doc becomes a tiny coordination doc:
   { updatedAt, schemaVersion: 2 }. Live listeners keep watching the parent
   for an updatedAt heartbeat and fan out via loadWatchlistDataForUid() in
   their callbacks. Legacy single-doc reads still work via fallback so
   un-migrated friends remain visible. */
const WATCHLIST_SECTION_DOC_NAMES = ['shows', 'movies', 'anime', 'games', 'manga', 'books', 'music'];

function getWatchlistSectionDocRef(uid, section) {
  if (typeof db === 'undefined' || !db || !uid || !section) return null;
  try {
    return db.collection('watchlist').doc(uid).collection('sections').doc(section);
  } catch (_) {
    return null;
  }
}

function parseWatchlistSectionDocJson(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/* Fan-out reader. Reads parent + every requested section doc in parallel,
   then picks the best source per section:
     1. section doc data (post-migration users)
     2. parent doc's legacy JSON field (un-migrated users)
     3. empty array
   Returns a normalized list-data object — same shape as parseOwnFirestoreData. */
async function loadWatchlistDataForUid(uid, options = {}) {
  const sections = Array.isArray(options.sections) && options.sections.length
    ? options.sections
    : WATCHLIST_SECTION_DOC_NAMES;
  const empty = getEmptyListData();
  if (typeof db === 'undefined' || !db || !uid) return empty;
  const parentRef = db.collection('watchlist').doc(uid);
  const parentSnapPromise = options.parentSnap
    ? Promise.resolve(options.parentSnap)
    : parentRef.get().catch(() => null);
  const sectionSnapPromises = sections.map(section =>
    parentRef.collection('sections').doc(section).get().catch(() => null)
  );
  const [parentSnap, ...sectionSnaps] = await Promise.all([parentSnapPromise, ...sectionSnapPromises]);
  const parentData = (parentSnap && parentSnap.exists ? parentSnap.data() : null) || {};
  const merged = {};
  sections.forEach((section, idx) => {
    const snap = sectionSnaps[idx];
    let json = '';
    if (snap && snap.exists) {
      const d = snap.data() || {};
      if (typeof d.data === 'string') json = d.data;
    }
    if (!json && typeof parentData[section] === 'string') {
      json = parentData[section];
    }
    merged[section] = parseWatchlistSectionDocJson(json);
  });
  WATCHLIST_SECTION_DOC_NAMES.forEach(section => {
    if (!Array.isArray(merged[section])) merged[section] = [];
  });
  return normalizeListData(merged);
}

function getOwnDataFirestorePayload(safeData) {
  /* v10.237 / v10.387: kept for size-estimation only. Real writes now go to
     per-section subdocs via persistOwnDataToFirestore(); this single-doc
     shape no longer hits Firestore directly. */
  return {
    shows: JSON.stringify(safeData.shows),
    movies: JSON.stringify(safeData.movies),
    anime: JSON.stringify(safeData.anime),
    games: JSON.stringify(safeData.games),
    manga: JSON.stringify(safeData.manga),
    books: JSON.stringify(safeData.books),
    music: JSON.stringify(safeData.music || []),
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
    books: docData.books ? JSON.parse(docData.books) : [],
    music: docData.music ? JSON.parse(docData.music) : []
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
      books: payload.books || '',
      music: payload.music || ''
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

function getShelfdActiveFirebaseAuthUser() {
  try {
    if (typeof auth !== 'undefined' && auth?.currentUser?.uid) return auth.currentUser;
  } catch (_) {}
  try {
    const firebaseAuth = typeof firebase !== 'undefined' && firebase?.auth ? firebase.auth() : null;
    if (firebaseAuth?.currentUser?.uid) return firebaseAuth.currentUser;
  } catch (_) {}
  return null;
}

function ensureOwnWatchlistDocRefForSave(options = {}) {
  const authUser = getShelfdActiveFirebaseAuthUser();
  const activeUid = String((currentUser && currentUser.uid) || (authUser && authUser.uid) || '').trim();
  if (!activeUid) {
    if (typeof window !== 'undefined') {
      window.__lastOwnDataSaveDebug = {
        ok: false,
        code: 'no-auth-user',
        message: 'No signed-in Firebase Auth user was available for library save.',
        at: new Date().toISOString()
      };
    }
    if (options.verify) throw new Error("No signed-in Firebase Auth user was available for saving.");
    return null;
  }
  if ((!currentUser || currentUser.uid !== activeUid) && authUser?.uid === activeUid) {
    currentUser = authUser;
  }
  if (!DOC_REF || DOC_REF.id !== activeUid) {
    console.warn('[v10.853] repaired library DOC_REF before save', {
      previousDocUid: DOC_REF?.id || '',
      activeUid
    });
    DOC_REF = db.collection('watchlist').doc(activeUid);
  }
  return DOC_REF;
}

async function loadWatchlistDataFromDocRef(docRef, fallbackData = null) {
  const isActiveOwnRef = !!(currentUser?.uid && docRef?.id === currentUser.uid);
  const fallback = fallbackData
    ? cloneListData(fallbackData)
    : (isActiveOwnRef && ownDataCache ? cloneListData(ownDataCache) : getEmptyListData());
  if (!docRef) return fallback;
  try {
    /* v10.387: defer to the section-aware fan-out reader. The docRef.id is
       the uid; that's all loadWatchlistDataForUid needs. Works for both own
       (DOC_REF) and friend (db.collection('watchlist').doc(uid)) refs. */
    const uid = docRef.id;
    return await loadWatchlistDataForUid(uid);
  } catch(e) {
    console.error("Watchlist reload failed:", e);
    return fallback;
  }
}

async function persistOwnDataToFirestore(safeData, options = {}) {
  const docRef = ensureOwnWatchlistDocRefForSave(options);
  if (!docRef) {
    if (options.verify) throw new Error("No library document is available for saving.");
    return;
  }
  const requestedSections = Array.isArray(options.sections) && options.sections.length
    ? new Set(options.sections.map(section => String(section || '').trim()).filter(section => WATCHLIST_SECTION_DOC_NAMES.includes(section)))
    : null;
  const targetSections = requestedSections && requestedSections.size
    ? WATCHLIST_SECTION_DOC_NAMES.filter(section => requestedSections.has(section))
    : WATCHLIST_SECTION_DOC_NAMES;
  const isFullSectionWrite = targetSections.length === WATCHLIST_SECTION_DOC_NAMES.length;
  const sectionPayloads = {};
  const sectionStats = {};
  targetSections.forEach(section => {
    const arr = Array.isArray(safeData[section]) ? safeData[section] : [];
    const json = JSON.stringify(arr);
    sectionPayloads[section] = json;
    sectionStats[section] = {
      count: arr.length,
      bytes: getShelfdJsonByteLength(json)
    };
  });
  const largestGameItems = Array.isArray(safeData.games)
    ? safeData.games.map(item => ({
        title: String(item?.title || item?.name || item?.id || ''),
        bytes: getShelfdJsonByteLength(item)
      })).sort((a, b) => b.bytes - a.bytes).slice(0, 8)
    : [];
  /* v10.387/v10.853: schema-v2 split. Full saves write every section and
     clean legacy parent fields; targeted saves can write one changed section
     while keeping legacy parent fallback data for older accounts intact. */
  try {
    const sectionWrites = targetSections.map(section => {
      const ref = docRef.collection('sections').doc(section);
      return ref.set({
        data: sectionPayloads[section] || '[]',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await Promise.all(sectionWrites);

    const parentUpdate = {
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 2
    };
    if (isFullSectionWrite && options.cleanupLegacyParentFields !== false) {
      WATCHLIST_SECTION_DOC_NAMES.forEach(field => {
        parentUpdate[field] = firebase.firestore.FieldValue.delete();
      });
    }
    await docRef.set(parentUpdate, { merge: true });

    if (typeof window !== 'undefined') {
      window.__lastOwnDataSaveDebug = {
        ok: true,
        schemaVersion: 2,
        sizeBytes: getOwnDataFirestorePayloadSizeBytes(safeData),
        sectionStats,
        largestGameItems,
        targetSections: [...targetSections],
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
        sectionStats,
        largestGameItems,
        targetSections: [...targetSections],
        itemCount: listDataItemCount(safeData),
        gamesCount: Array.isArray(safeData?.games) ? safeData.games.length : 0,
        at: new Date().toISOString()
      };
    }
    throw error;
  }
  if (options.verify) await verifyOwnDataDirectWrite(safeData, options);
}

async function verifyOwnDataDirectWrite(expectedData, options = {}) {
  const docRef = ensureOwnWatchlistDocRefForSave({ verify: true });
  if (!docRef) throw new Error("No library document is available for saving.");
  /* v10.387: verification re-reads via the fan-out path so it sees what was
     just written to the section subdocs. */
  const requestedSections = Array.isArray(options.sections) && options.sections.length
    ? options.sections.map(section => String(section || '').trim()).filter(section => WATCHLIST_SECTION_DOC_NAMES.includes(section))
    : null;
  const storedData = await loadWatchlistDataForUid(docRef.id, requestedSections ? { sections: requestedSections } : {});
  if (requestedSections && requestedSections.length) {
    for (const section of requestedSections) {
      const expectedCount = Array.isArray(expectedData?.[section]) ? expectedData[section].length : 0;
      const storedCount = Array.isArray(storedData?.[section]) ? storedData[section].length : 0;
      if (storedCount < expectedCount) {
        throw new Error(`Library save verification did not match the ${section} section.`);
      }
    }
    return;
  }
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
  writeOwnLocalBackupSafely(safeData, options.localBackupContext || 'writeOwnDataDirect');
  if (DOC_REF) {
    await persistOwnDataToFirestore(safeData, options);
    if (currentUser?.uid === CREATOR_PUBLIC_UID) {
      const targetedSections = Array.isArray(options.sections) && options.sections.length
        ? options.sections.map(section => String(section || '').trim()).filter(Boolean)
        : [];
      const isTargetedSectionWrite = targetedSections.length > 0 && targetedSections.length < WATCHLIST_SECTION_DOC_NAMES.length;
      await syncCreatorPublicProfileMirror(
        currentUser,
        userProfile,
        isTargetedSectionWrite ? null : safeData,
        {
          clearListData: isTargetedSectionWrite,
          reason: options.localBackupContext || 'writeOwnDataDirect',
          includeListData: !isTargetedSectionWrite
        }
      );
    }
  } else if (options.verify) {
    throw new Error("You need to be signed in before importing to Shelfd.");
  }
  return safeData;
}
async function loadOwnDataFromFirestore() {
  return loadWatchlistDataFromDocRef(DOC_REF);
}
