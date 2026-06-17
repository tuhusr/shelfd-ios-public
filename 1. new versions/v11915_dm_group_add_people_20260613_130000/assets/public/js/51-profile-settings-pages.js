/*
   51-profile-settings-pages.js
   Extracted from 15-profile-settings.js to keep surface ownership explicit.
*/

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

