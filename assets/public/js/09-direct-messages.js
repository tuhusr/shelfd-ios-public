// Direct Messages: request-first lightweight messaging stored through users docs.
let dmIncomingRequestIds = [];
let dmOutgoingRequestIds = [];
let dmIncomingRequestMap = {};
let dmOutgoingRequestMap = {};
let dmThreadIds = [];
let dmThreadMap = {};
let activeMessagesSubTab = 'chats';
let activeDmThreadId = '';
let dmSearchTimer = null;
let dmSearchResults = [];
let dmNewChatOpen = false;
let dmNewChatMode = 'direct';
let dmNewChatSelectedUids = [];
let dmNewChatGroupPhotoData = '';
let dmNewChatGroupName = '';
let activeDmGroupEditThreadId = '';
let dmGroupEditPhotoData = '';
let dmGroupEditCropState = null;
let dmGroupEditCropImage = null;
let dmGroupEditCropImageSrc = '';

function normalizeDirectMessageIds(value) {
  return Array.isArray(value) ? value.map(id => String(id || '').trim()).filter(Boolean) : [];
}

function isDirectMessageEncryptedRecord(message = {}) {
  return !!(message && (message.isEncrypted || message.dmE2ee || message.encryptedPayload || message.ciphertext));
}

function normalizeDirectMessageMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [id, raw]) => {
    if (!id || !raw || typeof raw !== 'object') return acc;
    const normalized = { ...raw, id: raw.id || id };
    acc[id] = Array.isArray(normalized.messages) ? normalizeDirectMessageThread(normalized) : normalized;
    return acc;
  }, {});
}

function buildDirectMessagePairId(prefix = 'dm', uidA = '', uidB = '') {
  const a = String(uidA || '').trim();
  const b = String(uidB || '').trim();
  if (!a || !b) return '';
  return `${prefix}_${[a, b].sort().join('_')}`;
}

function getCurrentUserDirectMessageProfile() {
  return {
    uid: currentUser?.uid || '',
    name: userProfile?.name || currentUser?.displayName || currentUser?.email || 'User',
    photo: userProfile?.photo || currentUser?.photoURL || ''
  };
}

function getDirectMessageProfile(uid = '', fallback = {}) {
  const cached = usersMap[uid] || {};
  return {
    uid,
    name: cached.name || cached.customName || fallback.name || fallback.displayName || 'User',
    photo: cached.photo || fallback.photo || fallback.photoURL || ''
  };
}

function getDirectMessageAvatar(profile = {}) {
  return profile.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name || 'User')}&background=1e2028&color=a78bfa`;
}

function isDirectMessageGroupThread(thread = {}) {
  return thread?.isGroup === true || thread?.type === 'group' || (Array.isArray(thread?.participantUids) && thread.participantUids.length > 2);
}

function getDirectMessageOtherUid(thread = {}) {
  if (isDirectMessageGroupThread(thread)) return '';
  const participants = Array.isArray(thread.participantUids) ? thread.participantUids : [];
  return participants.find(uid => uid && uid !== currentUser?.uid) || '';
}

function getDirectMessageOtherProfile(thread = {}) {
  if (isDirectMessageGroupThread(thread)) return getDirectMessageThreadProfile(thread);
  const otherUid = getDirectMessageOtherUid(thread);
  return getDirectMessageProfile(otherUid, thread.participants?.[otherUid] || {});
}

function getDirectMessageThreadTitle(thread = {}) {
  if (!isDirectMessageGroupThread(thread)) return getDisplayName(getDirectMessageOtherProfile(thread), 'User');
  const explicitName = String(thread.groupName || '').trim();
  if (explicitName) return explicitName;
  const names = (thread.participantUids || [])
    .filter(uid => uid && uid !== currentUser?.uid)
    .map(uid => getDisplayName(getDirectMessageProfile(uid, thread.participants?.[uid] || {}), 'User'))
    .filter(Boolean)
    .slice(0, 3);
  return names.length ? names.join(', ') : 'Group Chat';
}

function getDirectMessageThreadProfile(thread = {}) {
  if (!isDirectMessageGroupThread(thread)) return getDirectMessageOtherProfile(thread);
  const title = getDirectMessageThreadTitle(thread);
  return {
    uid: thread.id || '',
    name: title,
    photo: thread.groupPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(title || 'Group')}&background=1e2028&color=a78bfa`
  };
}

function getDirectMessageThreadSubtitle(thread = {}) {
  if (!isDirectMessageGroupThread(thread)) return 'Direct Message';
  const count = Array.isArray(thread.participantUids) ? thread.participantUids.length : 0;
  return `${count || 0} member${count === 1 ? '' : 's'}`;
}

function getDirectMessageRequestOtherProfile(req = {}, direction = 'incoming') {
  const otherUid = direction === 'incoming' ? req.fromUid : req.toUid;
  const fallback = direction === 'incoming' ? req.fromProfile : req.toProfile;
  return getDirectMessageProfile(otherUid, fallback || {});
}

function getDirectMessageThreadWithUser(uid = '') {
  return Object.values(dmThreadMap || {}).find(thread => {
    if (isDirectMessageGroupThread(thread)) return false;
    const participants = Array.isArray(thread.participantUids) ? thread.participantUids : [];
    return participants.includes(currentUser?.uid) && participants.includes(uid);
  }) || null;
}

function isDirectMessageFriend(uid = '') {
  return !!uid && Array.isArray(friends) && friends.includes(uid);
}

function getDirectMessageRequestWithUser(uid = '', direction = '') {
  const maps = direction === 'incoming'
    ? [dmIncomingRequestMap]
    : direction === 'outgoing'
      ? [dmOutgoingRequestMap]
      : [dmIncomingRequestMap, dmOutgoingRequestMap];
  for (const map of maps) {
    const req = Object.values(map || {}).find(item => item && (item.fromUid === uid || item.toUid === uid));
    if (req) return req;
  }
  return null;
}

function getDirectMessageParticipantUids(thread = {}) {
  const fromArray = Array.isArray(thread.participantUids) ? thread.participantUids : [];
  const fromParticipants = thread.participants && typeof thread.participants === 'object'
    ? Object.keys(thread.participants)
    : [];
  const fromId = String(thread.id || '')
    .replace(/^dm_/, '')
    .split('_')
    .filter(part => part && part.length >= 8);
  return [...new Set([...fromArray, ...fromParticipants, ...fromId].map(uid => String(uid || '').trim()).filter(Boolean))];
}

function getUnreadDirectMessageThreadCount() {
  return Object.values(dmThreadMap || {}).filter(thread => Array.isArray(thread.unreadUids) && thread.unreadUids.includes(currentUser?.uid)).length;
}

function getDirectMessageNotificationCount() {
  return dmIncomingRequestIds.length + getUnreadDirectMessageThreadCount();
}

function updateDirectMessagesBadge() {
  const count = getDirectMessageNotificationCount();
  const badges = Array.from(document.querySelectorAll('#messages-count-badge, #header-dm-badge'));
  const headerBtn = document.getElementById('header-dm-btn');
  badges.forEach(badge => {
    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  });
  if (headerBtn) {
    headerBtn.classList.toggle('has-ping', count > 0);
    headerBtn.setAttribute('aria-label', count > 0 ? 'Open messages, ' + count + ' new' : 'Open messages');
    headerBtn.title = count > 0 ? count + ' new message activity' : 'Messages';
  }
}

function isDirectMessagesPageOpen() {
  const page = document.getElementById('direct-messages-page');
  return !!(page && page.style.display !== 'none');
}

function updateDirectMessagesTopbar() {
  const page = document.getElementById('direct-messages-page');
  const topbar = page ? page.querySelector('.direct-messages-topbar') : null;
  const title = document.getElementById('direct-messages-title');
  const subtitle = document.getElementById('direct-messages-subtitle');
  const avatar = document.getElementById('direct-messages-top-avatar');
  const backBtn = document.getElementById('direct-messages-back-btn');
  const editingThread = activeDmGroupEditThreadId ? dmThreadMap[activeDmGroupEditThreadId] : null;
  const thread = !editingThread && activeDmThreadId ? dmThreadMap[activeDmThreadId] : null;
  const visibleThread = editingThread || thread;
  const isGroup = isDirectMessageGroupThread(visibleThread);
  const isGroupEdit = !!editingThread;
  const isThread = !!visibleThread;
  if (page) {
    page.classList.toggle('dm-thread-open', isThread);
    page.classList.toggle('dm-group-edit-open', isGroupEdit);
  }
  if (topbar) topbar.classList.toggle('dm-thread-topbar', isThread);
  if (visibleThread) {
    const profile = getDirectMessageThreadProfile(visibleThread);
    const threadTitle = getDirectMessageThreadTitle(visibleThread);
    if (title) {
      title.textContent = isGroupEdit ? 'Edit group' : threadTitle;
      title.title = isGroup && !isGroupEdit ? 'Edit group chat' : (isGroupEdit ? threadTitle : threadTitle);
      title.classList.toggle('dm-group-title-clickable', isGroup && !isGroupEdit);
      if (isGroup && !isGroupEdit) {
        title.setAttribute('role', 'button');
        title.setAttribute('tabindex', '0');
        title.onclick = () => openDirectMessageGroupEdit(visibleThread.id);
        title.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDirectMessageGroupEdit(visibleThread.id);
          }
        };
      } else {
        title.removeAttribute('role');
        title.removeAttribute('tabindex');
        title.onclick = null;
        title.onkeydown = null;
      }
    }
    if (subtitle) subtitle.textContent = isGroupEdit ? threadTitle : getDirectMessageThreadSubtitle(visibleThread);
    if (avatar) {
      avatar.src = getDirectMessageAvatar(profile);
      avatar.style.display = 'block';
      avatar.classList.toggle('editable-group-avatar', isGroup);
      avatar.onclick = isGroup ? () => openDirectMessageGroupEdit(visibleThread.id) : null;
      avatar.title = isGroup ? 'Edit group chat' : '';
    }
    if (backBtn) backBtn.setAttribute('aria-label', isGroupEdit ? 'Back to group chat' : 'Back to messages');
  } else {
    if (title) {
      title.textContent = 'Messages';
      title.title = 'Messages';
      title.classList.remove('dm-group-title-clickable');
      title.removeAttribute('role');
      title.removeAttribute('tabindex');
      title.onclick = null;
      title.onkeydown = null;
    }
    if (subtitle) subtitle.textContent = '';
    if (avatar) {
      avatar.removeAttribute('src');
      avatar.style.display = 'none';
      avatar.classList.remove('editable-group-avatar');
      avatar.onclick = null;
      avatar.title = '';
    }
    if (backBtn) backBtn.setAttribute('aria-label', 'Close messages');
  }
}
function isDirectMessagesMobileViewport() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 700px)').matches);
}

let directMessagesStableLayoutHeight = 0;

function getDirectMessagesLayoutHeight() {
  return Math.max(320, Math.round(window.innerHeight || document.documentElement.clientHeight || window.visualViewport?.height || 0));
}

function isDirectMessageTypingActive() {
  const active = document.activeElement;
  return !!(active && active.closest && active.closest('.direct-messages-page .dm-compose-row'));
}

function setDirectMessagesStableLayoutHeight(force = false) {
  const page = document.getElementById('direct-messages-page');
  if (!page) return;
  const isMobile = isDirectMessagesMobileViewport();
  const typing = isDirectMessageTypingActive();
  if (!isMobile) {
    directMessagesStableLayoutHeight = 0;
    page.style.removeProperty('--dm-layout-height');
    return;
  }
  if (force || !directMessagesStableLayoutHeight || !typing) {
    directMessagesStableLayoutHeight = getDirectMessagesLayoutHeight();
  }
  page.style.setProperty('--dm-layout-height', directMessagesStableLayoutHeight + 'px');
}

function lockDirectMessageScrollPosition() {
  if (!isDirectMessagesMobileViewport()) return;
  const list = document.getElementById('dm-message-list');
  const listTop = list ? list.scrollTop : 0;
  const winX = window.scrollX || 0;
  const winY = window.scrollY || 0;
  requestAnimationFrame(() => {
    try { window.scrollTo(winX, winY); } catch (error) {}
    if (list && listTop > 0) list.scrollTop = listTop;
  });
}

function getDirectMessageKeyboardBottom() {
  if (!window.visualViewport) return 0;
  const viewport = window.visualViewport;
  const lift = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
  return lift > 80 ? lift : 0;
}

function updateDirectMessageKeyboardLift() {
  const page = document.getElementById('direct-messages-page');
  if (!page || !isDirectMessagesPageOpen()) return;
  setDirectMessagesStableLayoutHeight(false);
  const typing = isDirectMessageTypingActive();
  const isMobile = isDirectMessagesMobileViewport();
  const lift = isMobile && typing ? getDirectMessageKeyboardBottom() : 0;
  page.classList.toggle('dm-keyboard-active', isMobile && typing && lift > 0);
  page.style.setProperty('--dm-keyboard-bottom', lift + 'px');
  page.style.setProperty('--dm-keyboard-lift', '0px');
  if (isMobile && typing) lockDirectMessageScrollPosition();
}

function resetDirectMessageKeyboardLift() {
  const page = document.getElementById('direct-messages-page');
  if (!page) return;
  page.classList.remove('dm-keyboard-active');
  page.style.setProperty('--dm-keyboard-lift', '0px');
  page.style.setProperty('--dm-keyboard-bottom', '0px');
}

function initDirectMessageKeyboardLift() {
  if (window.__screenListDmKeyboardLiftReady) return;
  window.__screenListDmKeyboardLiftReady = true;
  const schedule = () => {
    setDirectMessagesStableLayoutHeight(false);
    requestAnimationFrame(updateDirectMessageKeyboardLift);
    window.setTimeout(updateDirectMessageKeyboardLift, 90);
    window.setTimeout(updateDirectMessageKeyboardLift, 260);
  };
  document.addEventListener('touchstart', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('#dm-message-input') : null;
    if (!target || !isDirectMessagesMobileViewport()) return;
    event.preventDefault();
    setDirectMessagesStableLayoutHeight(false);
    try { target.focus({ preventScroll: true }); }
    catch (error) { target.focus(); }
    lockDirectMessageScrollPosition();
    schedule();
  }, { passive: false });
  document.addEventListener('focusin', (event) => {
    if (event.target && event.target.closest && event.target.closest('.direct-messages-page .dm-compose-row')) {
      lockDirectMessageScrollPosition();
      schedule();
    }
  });
  document.addEventListener('focusout', (event) => {
    if (event.target && event.target.closest && event.target.closest('.direct-messages-page .dm-compose-row')) {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!(active && active.closest && active.closest('.direct-messages-page .dm-compose-row'))) resetDirectMessageKeyboardLift();
      }, 80);
    }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule, { passive: true });
    window.visualViewport.addEventListener('scroll', schedule, { passive: true });
  }
  window.addEventListener('resize', schedule, { passive: true });
}


/* v71: mobile DM swipe-right close */
let directMessagesSwipeState = null;
let directMessagesSwipeRaf = 0;

function resetDirectMessagesSwipeVisual(page = document.getElementById('direct-messages-page')) {
  if (!page) return;
  page.style.setProperty('--dm-swipe-x', '0px');
  page.style.setProperty('--dm-swipe-opacity', '1');
  page.classList.remove('dm-swiping', 'dm-swipe-cancel', 'dm-swipe-closing', 'dm-thread-swipe-revealing');
  page.querySelectorAll('.dm-thread-swipe-ghost').forEach(node => node.remove());
}

function shouldIgnoreDirectMessagesSwipe(target) {
  return !!(target && target.closest && target.closest('input, textarea, select, button, a, [contenteditable="true"], .mobile-bottom-nav'));
}

function applyDirectMessagesSwipeVisual(page, x) {
  if (!page) return;
  const viewport = Math.max(320, window.innerWidth || 390);
  const nextX = Math.max(0, Math.min(x, viewport + 40));
  const state = directMessagesSwipeState;
  if (state?.mode === 'thread' && state.ghost) {
    const progress = Math.min(1, nextX / Math.min(viewport, 430));
    const radius = Math.round(10 + progress * 20);
    state.ghost.style.transform = `translate3d(${nextX}px, 0, 0)`;
    state.ghost.style.borderRadius = `${radius}px`;
    state.ghost.style.opacity = '1';
    page.style.setProperty('--dm-swipe-x', '0px');
    page.style.setProperty('--dm-swipe-opacity', '1');
    return;
  }
  const nextOpacity = Math.max(0.28, 1 - (nextX / Math.min(viewport, 430)) * 0.82);
  page.style.setProperty('--dm-swipe-x', nextX + 'px');
  page.style.setProperty('--dm-swipe-opacity', String(nextOpacity));
}

function scheduleDirectMessagesSwipeVisual(page, x) {
  if (directMessagesSwipeState) directMessagesSwipeState.pendingX = x;
  if (directMessagesSwipeRaf) return;
  directMessagesSwipeRaf = requestAnimationFrame(() => {
    directMessagesSwipeRaf = 0;
    applyDirectMessagesSwipeVisual(page, directMessagesSwipeState?.pendingX ?? x);
  });
}

function prepareDirectMessageThreadSwipeReveal(page, state) {
  if (!page || !state || state.mode !== 'thread' || state.ghost) return;
  const content = page.querySelector('.direct-messages-content');
  if (!content) return;
  const ghost = document.createElement('div');
  ghost.className = 'dm-thread-swipe-ghost';
  const clone = content.cloneNode(true);
  clone.querySelectorAll('[id]').forEach((node, index) => {
    node.id = `dm-thread-swipe-ghost-${index}`;
  });
  ghost.appendChild(clone);
  const threadId = state.threadId;
  page.appendChild(ghost);
  page.classList.add('dm-thread-swipe-revealing');
  state.ghost = ghost;
  state.threadId = threadId;
  ghost.getBoundingClientRect();
  activeDmGroupEditThreadId = '';
  activeDmThreadId = '';
  resetDirectMessageKeyboardLift();
  renderDirectMessagesView();
  persistUiState();
}

function finishDirectMessagesSwipeClose(page, state = directMessagesSwipeState) {
  if (!page) return;
  const viewport = Math.max(320, window.innerWidth || 390);
  if (state?.mode === 'thread' && state.ghost) {
    const ghost = state.ghost;
    ghost.style.transition = 'transform 0.30s cubic-bezier(.16,1,.3,1), border-radius 0.30s cubic-bezier(.16,1,.3,1)';
    ghost.style.transform = `translate3d(${viewport + 48}px, 0, 0)`;
    ghost.style.opacity = '1';
    ghost.style.borderRadius = '30px';
    window.setTimeout(() => {
      ghost.remove();
      page.classList.remove('dm-swiping', 'dm-swipe-cancel', 'dm-swipe-closing', 'dm-thread-swipe-revealing');
      page.style.setProperty('--dm-swipe-x', '0px');
      page.style.setProperty('--dm-swipe-opacity', '1');
    }, 310);
    return;
  }
  page.classList.remove('dm-swiping', 'dm-swipe-cancel');
  page.classList.add('dm-swipe-closing');
  page.style.setProperty('--dm-swipe-x', (viewport + 48) + 'px');
  page.style.setProperty('--dm-swipe-opacity', '0');
  window.setTimeout(() => {
    closeDirectMessagesPage(true);
    resetDirectMessagesSwipeVisual(page);
  }, 210);
}

function cancelDirectMessagesSwipeClose(page, state = directMessagesSwipeState) {
  if (!page) return;
  if (state?.mode === 'thread' && state.ghost) {
    const ghost = state.ghost;
    ghost.style.transition = 'transform 0.26s cubic-bezier(.16,1,.3,1), border-radius 0.26s cubic-bezier(.16,1,.3,1)';
    ghost.style.transform = 'translate3d(0, 0, 0)';
    ghost.style.borderRadius = '0px';
    window.setTimeout(() => {
      if (state.threadId) activeDmThreadId = state.threadId;
      ghost.remove();
      page.classList.remove('dm-swiping', 'dm-swipe-closing', 'dm-thread-swipe-revealing');
      page.style.setProperty('--dm-swipe-x', '0px');
      page.style.setProperty('--dm-swipe-opacity', '1');
      renderDirectMessagesView();
    }, 270);
    return;
  }
  page.classList.remove('dm-swiping', 'dm-swipe-closing');
  page.classList.add('dm-swipe-cancel');
  page.style.setProperty('--dm-swipe-x', '0px');
  page.style.setProperty('--dm-swipe-opacity', '1');
  window.setTimeout(() => page.classList.remove('dm-swipe-cancel'), 240);
}

function initDirectMessagesSwipeClose() {
  const page = document.getElementById('direct-messages-page');
  if (!page || page.dataset.swipeCloseReady === 'true') return;
  page.dataset.swipeCloseReady = 'true';
  page.classList.add('dm-swipe-ready');

  page.addEventListener('touchstart', (event) => {
    if (!isDirectMessagesPageOpen() || event.touches.length !== 1 || shouldIgnoreDirectMessagesSwipe(event.target)) return;
    const touch = event.touches[0];
    const now = performance.now();
    directMessagesSwipeState = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastT: now,
      startT: now,
      mode: activeDmThreadId && !activeDmGroupEditThreadId ? 'thread' : 'page',
      threadId: activeDmThreadId || '',
      ghost: null,
      pendingX: 0,
      swiping: false,
      verticalLocked: false
    };
  }, { passive: true });

  page.addEventListener('touchmove', (event) => {
    if (!directMessagesSwipeState || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const now = performance.now();
    const dx = touch.clientX - directMessagesSwipeState.startX;
    const dy = touch.clientY - directMessagesSwipeState.startY;

    directMessagesSwipeState.lastX = touch.clientX;
    directMessagesSwipeState.lastT = now;

    if (!directMessagesSwipeState.swiping) {
      if (dx < 0 || (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.05)) {
        directMessagesSwipeState.verticalLocked = true;
        return;
      }
      if (directMessagesSwipeState.verticalLocked) return;
      if (dx < 14 || dx < Math.abs(dy) * 1.18) return;
      directMessagesSwipeState.swiping = true;
      prepareDirectMessageThreadSwipeReveal(page, directMessagesSwipeState);
      page.classList.add('dm-swiping');
    }

    if (directMessagesSwipeState.swiping) {
      event.preventDefault();
      scheduleDirectMessagesSwipeVisual(page, dx);
    }
  }, { passive: false });

  const endSwipe = () => {
    const state = directMessagesSwipeState;
    if (!state) return;
    directMessagesSwipeState = null;
    if (directMessagesSwipeRaf) {
      cancelAnimationFrame(directMessagesSwipeRaf);
      directMessagesSwipeRaf = 0;
    }
    if (!state.swiping) return;
    const page = document.getElementById('direct-messages-page');
    const elapsed = Math.max(1, performance.now() - state.startT);
    const distance = Math.max(0, state.lastX - state.startX);
    const velocity = distance / elapsed;
    const threshold = Math.min(132, Math.max(88, (window.innerWidth || 390) * 0.28));
    if (distance > threshold || velocity > 0.72) finishDirectMessagesSwipeClose(page, state);
    else cancelDirectMessagesSwipeClose(page, state);
  };

  page.addEventListener('touchend', endSwipe, { passive: true });
  page.addEventListener('touchcancel', endSwipe, { passive: true });
}

function handleDirectMessagesBack() {
  if (activeDmGroupEditThreadId) {
    closeDirectMessageGroupEdit();
    return;
  }
  if (activeDmThreadId) {
    closeDirectMessageThread();
    return;
  }
  closeDirectMessagesPage();
}

function openDirectMessagesPage() {
  const page = document.getElementById('direct-messages-page');
  if (!page) return;
  page.style.display = 'block';
  resetDirectMessagesSwipeVisual(page);
  resetDirectMessageKeyboardLift();
  setDirectMessagesStableLayoutHeight(true);
  initDirectMessagesSwipeClose();
  initDirectMessageKeyboardLift();
  page.setAttribute('aria-hidden', 'false');
  document.body.classList.add('dm-fullscreen-open');
  updateDirectMessagesTopbar();
  pruneEncryptedDirectMessageThreadsForCurrentUser();
  renderDirectMessagesView();
  requestAnimationFrame(() => page.classList.add('open'));
}

function closeDirectMessagesPage(immediate = false) {
  const page = document.getElementById('direct-messages-page');
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  if (!page) return;
  page.classList.remove('open');
  resetDirectMessagesSwipeVisual(page);
  resetDirectMessageKeyboardLift();
  page.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('dm-fullscreen-open');
  directMessagesStableLayoutHeight = 0;
  page.style.removeProperty('--dm-layout-height');
  if (immediate) {
    page.style.display = 'none';
    return;
  }
  window.setTimeout(() => {
    if (!page.classList.contains('open')) page.style.display = 'none';
  }, 260);
}

function getDirectMessageRequestPayload(targetUser = {}, requestId = '') {
  const targetUid = targetUser.uid || '';
  const fromProfile = getCurrentUserDirectMessageProfile();
  const toProfile = getDirectMessageProfile(targetUid, targetUser);
  const threadId = buildDirectMessagePairId('dm', fromProfile.uid, targetUid);
  const now = Date.now();
  return {
    id: requestId || buildDirectMessagePairId('dmreq', fromProfile.uid, targetUid),
    threadId,
    fromUid: fromProfile.uid,
    toUid: targetUid,
    fromProfile,
    toProfile,
    participantUids: [fromProfile.uid, targetUid].filter(Boolean),
    participants: {
      [fromProfile.uid]: fromProfile,
      [targetUid]: toProfile
    },
    status: 'pending',
    createdAtMs: now,
    updatedAtMs: now
  };
}

async function setDirectMessageRequestMirror(uid = '', direction = 'incoming', requestId = '', payload = {}, include = true) {
  if (!uid || !requestId) return;
  const isIncoming = direction === 'incoming';
  const idsField = isIncoming ? 'directMessageIncomingRequests' : 'directMessageOutgoingRequests';
  const mapField = isIncoming ? 'directMessageIncomingRequestMap' : 'directMessageOutgoingRequestMap';
  await db.collection('users').doc(uid).set({
    [idsField]: include ? firebase.firestore.FieldValue.arrayUnion(requestId) : firebase.firestore.FieldValue.arrayRemove(requestId),
    [mapField]: { [requestId]: { ...payload, id: requestId, updatedAtMs: Date.now() } }
  }, { merge: true });
}

async function clearDirectMessageRequestMirror(uid = '', direction = 'incoming', requestId = '') {
  if (!uid || !requestId) return;
  const isIncoming = direction === 'incoming';
  const idsField = isIncoming ? 'directMessageIncomingRequests' : 'directMessageOutgoingRequests';
  const mapField = isIncoming ? 'directMessageIncomingRequestMap' : 'directMessageOutgoingRequestMap';
  const ref = db.collection('users').doc(uid);
  await ref.set({ [idsField]: firebase.firestore.FieldValue.arrayRemove(requestId) }, { merge: true });
  try {
    await ref.update({ [`${mapField}.${requestId}`]: firebase.firestore.FieldValue.delete() });
  } catch (error) {
    console.warn('Direct Message request cleanup skipped:', error);
  }
}

function getDirectMessageLastPreviewFromMessages(messages = [], fallback = '') {
  const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
  if (!last) return String(fallback || '').replace(/^(Encrypted|Secure)\s+(message|photo|share)$/i, '').trim();
  if (last.imageData) return 'Photo';
  if (last.shareMedia) return 'Shared media';
  return String(last.text || fallback || '').trim();
}

function normalizeDirectMessageThread(thread = {}) {
  const participantUids = getDirectMessageParticipantUids(thread);
  const rawMessages = Array.isArray(thread.messages) ? thread.messages.filter(Boolean) : [];
  const removedEncryptedCount = rawMessages.filter(isDirectMessageEncryptedRecord).length;
  const messages = rawMessages
    .filter(message => !isDirectMessageEncryptedRecord(message))
    .slice(-80)
    .map(message => {
      const nextMessage = { ...(message || {}), isEncrypted: false };
      delete nextMessage.dmE2ee;
      delete nextMessage.encryptedPayload;
      delete nextMessage.ciphertext;
      if (nextMessage.shareMedia) {
        nextMessage.shareMedia = normalizeSharedMediaPayload(nextMessage.shareMedia);
      }
      return nextMessage;
    });
  const isGroup = thread.isGroup === true || thread.type === 'group' || participantUids.length > 2;
  const lastMessage = getDirectMessageLastPreviewFromMessages(messages, thread.lastMessage || '');
  const cleanThread = {
    id: thread.id || '',
    type: isGroup ? 'group' : 'direct',
    isGroup,
    groupName: thread.groupName || '',
    groupPhoto: thread.groupPhoto || '',
    ownerUid: thread.ownerUid || '',
    adminUids: Array.isArray(thread.adminUids) ? [...new Set(thread.adminUids.filter(Boolean))] : [],
    participantUids,
    participants: thread.participants || {},
    messages,
    lastMessage,
    lastMessageFromUid: thread.lastMessageFromUid || (messages.length ? messages[messages.length - 1].fromUid : ''),
    lastMessageAtMs: Number(thread.lastMessageAtMs || (messages.length ? messages[messages.length - 1].createdAtMs : 0) || Date.now()),
    unreadUids: Array.isArray(thread.unreadUids) ? thread.unreadUids.filter(Boolean) : [],
    createdAtMs: Number(thread.createdAtMs || Date.now()),
    updatedAtMs: Number(thread.updatedAtMs || thread.lastMessageAtMs || Date.now())
  };
  if (removedEncryptedCount) cleanThread._removedEncryptedMessages = removedEncryptedCount;
  return cleanThread;
}

let directMessageEncryptedPruneInFlight = false;
async function pruneEncryptedDirectMessageThreadsForCurrentUser() {
  if (!currentUser || directMessageEncryptedPruneInFlight) return;
  const dirty = Object.values(dmThreadMap || {}).filter(thread => Number(thread?._removedEncryptedMessages || 0) > 0);
  if (!dirty.length) return;
  directMessageEncryptedPruneInFlight = true;
  try {
    const ref = db.collection('users').doc(currentUser.uid);
    const patch = {};
    dirty.forEach(thread => {
      const cleanThread = { ...thread };
      delete cleanThread._removedEncryptedMessages;
      dmThreadMap[cleanThread.id] = cleanThread;
      patch[`directMessageThreadMap.${cleanThread.id}`] = cleanThread;
    });
    await ref.update(patch);
  } catch (error) {
    console.warn('Direct Message encrypted-message cleanup skipped:', error);
  } finally {
    directMessageEncryptedPruneInFlight = false;
  }
}
async function setDirectMessageThreadMirror(uid = '', thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  if (!uid || !cleanThread.id) return;
  delete cleanThread._removedEncryptedMessages;
  await db.collection('users').doc(uid).set({
    directMessageThreads: firebase.firestore.FieldValue.arrayUnion(cleanThread.id),
    directMessageThreadMap: { [cleanThread.id]: cleanThread }
  }, { merge: true });
}

async function mirrorDirectMessageThreadToParticipants(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  const participants = cleanThread.participantUids.filter(Boolean);
  await Promise.all(participants.map(uid => setDirectMessageThreadMirror(uid, cleanThread)));
}

async function searchDirectMessageUsers(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const resultsEl = document.getElementById('dm-search-results');
  if (!resultsEl) return;
  if (!q) {
    dmSearchResults = [];
    resultsEl.innerHTML = '';
    return;
  }
  resultsEl.innerHTML = `<div class="dm-search-empty">Searching...</div>`;
  try {
    const snap = await db.collection('users')
      .where('nameLower', '>=', q)
      .where('nameLower', '<=', q + '\uf8ff')
      .limit(10)
      .get();
    dmSearchResults = [];
    snap.forEach(doc => {
      const user = { uid: doc.id, ...(doc.data() || {}) };
      if (user.uid && user.uid !== currentUser?.uid) {
        dmSearchResults.push(user);
        usersMap[user.uid] = { ...(usersMap[user.uid] || {}), ...user };
      }
    });
    renderDirectMessageSearchResults(q);
  } catch (error) {
    console.error('Direct Message search failed:', error);
    resultsEl.innerHTML = `<div class="dm-search-empty">Could not search right now.</div>`;
  }
}

function onDirectMessageSearchInput(value = '') {
  clearTimeout(dmSearchTimer);
  dmSearchTimer = setTimeout(() => searchDirectMessageUsers(value), 220);
}

function renderDirectMessageSearchResults(query = '') {
  const resultsEl = document.getElementById('dm-search-results');
  if (!resultsEl) return;
  if (!dmSearchResults.length) {
    resultsEl.innerHTML = `<div class="dm-search-empty">No users found for "${escHtml(query)}".</div>`;
    return;
  }
  resultsEl.innerHTML = dmSearchResults.map(user => {
    const profile = getDirectMessageProfile(user.uid, user);
    const isSelected = dmNewChatSelectedUids.includes(user.uid);
    if (dmNewChatMode === 'group') {
      return `<div class="dm-user-result ${isSelected ? 'selected' : ''}">
        <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
        <div><strong>${renderDisplayNameHTML(profile, 'User')}</strong><span>${isSelected ? 'Selected for group chat' : 'Tap to add to group chat'}</span></div>
        <button class="dm-result-action ${isSelected ? 'dm-action-sent' : 'dm-action-open'}" type="button" onclick="toggleDirectMessageGroupUser('${escAttr(user.uid)}')">${isSelected ? 'Added' : 'Add'}</button>
      </div>`;
    }
    const thread = getDirectMessageThreadWithUser(user.uid);
    const incoming = getDirectMessageRequestWithUser(user.uid, 'incoming');
    const outgoing = getDirectMessageRequestWithUser(user.uid, 'outgoing');
    const isFriend = isDirectMessageFriend(user.uid);
    let label = isFriend ? 'Message' : '+ Request';
    let className = isFriend ? 'dm-action-open' : 'dm-action-request';
    let action = `sendDirectMessageRequest('${escAttr(user.uid)}')`;
    if (thread) {
      label = 'Open';
      className = 'dm-action-open';
      action = `openDirectMessageThread('${escAttr(thread.id)}')`;
    } else if (isFriend) {
      label = 'Message';
      className = 'dm-action-open';
      action = `openOrCreateDirectMessageThreadForUser('${escAttr(user.uid)}')`;
    } else if (incoming) {
      label = 'Accept';
      className = 'dm-action-accept';
      action = `acceptDirectMessageRequest('${escAttr(incoming.id)}')`;
    } else if (outgoing) {
      label = 'Sent';
      className = 'dm-action-sent';
      action = `cancelDirectMessageRequest('${escAttr(outgoing.id)}')`;
    }
    const helperText = thread ? 'Chat unlocked' : isFriend ? 'Friend • tap to message' : outgoing ? 'Tap Sent to cancel' : incoming ? 'They requested to message you' : 'Send a message request';
    return `<div class="dm-user-result">
      <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
      <div><strong>${renderDisplayNameHTML(profile, 'User')}</strong><span>${helperText}</span></div>
      <button class="dm-result-action ${className}" type="button" onclick="${action}">${label}</button>
    </div>`;
  }).join('');
}
function openDirectMessageComposer(mode = 'direct') {
  dmNewChatOpen = true;
  dmNewChatMode = mode === 'group' ? 'group' : 'direct';
  dmNewChatSelectedUids = [];
  dmNewChatGroupPhotoData = '';
  dmNewChatGroupName = '';
  dmSearchResults = [];
  clearTimeout(dmSearchTimer);
  renderDirectMessagesView();
}

function closeDirectMessageComposer() {
  dmNewChatOpen = false;
  dmNewChatSelectedUids = [];
  dmNewChatGroupPhotoData = '';
  dmNewChatGroupName = '';
  dmSearchResults = [];
  clearTimeout(dmSearchTimer);
  renderDirectMessagesView();
}

function switchDirectMessageComposerMode(mode = 'direct') {
  dmNewChatMode = mode === 'group' ? 'group' : 'direct';
  dmNewChatSelectedUids = [];
  dmSearchResults = [];
  renderDirectMessagesView();
}

function toggleDirectMessageGroupUser(uid = '') {
  if (!uid || uid === currentUser?.uid) return;
  const query = String(document.getElementById('dm-user-search')?.value || '').trim();
  dmNewChatGroupName = String(document.getElementById('dm-group-name-input')?.value || dmNewChatGroupName || '').trim();
  if (dmNewChatSelectedUids.includes(uid)) {
    dmNewChatSelectedUids = dmNewChatSelectedUids.filter(id => id !== uid);
  } else {
    dmNewChatSelectedUids = [...dmNewChatSelectedUids, uid];
  }
  renderDirectMessagesView();
  const input = document.getElementById('dm-user-search');
  if (input) input.value = query;
  if (dmSearchResults.length) renderDirectMessageSearchResults(query);
}
function renderDirectMessageComposerPanel() {
  const selectedProfiles = dmNewChatSelectedUids.map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}));
  return `<div class="dm-new-chat-panel">
    <div class="dm-new-chat-head">
      <div><strong>New Message</strong>${dmNewChatMode === 'group' ? '<span>Create a group chat</span>' : ''}</div>
      <button type="button" onclick="closeDirectMessageComposer()" aria-label="Close new message">×</button>
    </div>
    <div class="dm-new-chat-tabs">
      <button class="${dmNewChatMode === 'direct' ? 'active' : ''}" type="button" onclick="switchDirectMessageComposerMode('direct')">1:1</button>
      <button class="${dmNewChatMode === 'group' ? 'active' : ''}" type="button" onclick="switchDirectMessageComposerMode('group')">Group</button>
    </div>
    ${dmNewChatMode === 'group' ? `<div class="dm-group-setup-row">
      <button class="dm-group-photo-btn" type="button" onclick="triggerDirectMessageNewGroupPhotoInput()">
        ${dmNewChatGroupPhotoData ? `<img src="${escAttr(dmNewChatGroupPhotoData)}" alt="" loading="lazy">` : '<span>＋</span>'}
      </button>
      <input id="dm-new-group-photo-input" type="file" accept="image/*" style="display:none" onchange="handleDirectMessageNewGroupPhoto(this.files && this.files[0])">
      <input id="dm-group-name-input" type="text" maxlength="48" placeholder="Group name" autocomplete="off" value="${escAttr(dmNewChatGroupName)}" oninput="dmNewChatGroupName=this.value">
    </div>
    <div class="dm-group-selected" id="dm-group-selected-count">${dmNewChatSelectedUids.length} selected</div>
    ${selectedProfiles.length ? `<div class="dm-group-selected-list">${selectedProfiles.map(profile => `<button type="button" onclick="toggleDirectMessageGroupUser('${escAttr(profile.uid)}')"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt=""><span>${renderDisplayNameHTML(profile, 'User')}</span>×</button>`).join('')}</div>` : ''}
    <button class="dm-create-group-btn" type="button" onclick="createDirectMessageGroupChat()" ${dmNewChatSelectedUids.length ? '' : 'disabled'}>Create Group Chat</button>` : ''}
    <div class="dm-search-strip dm-new-search-strip"><input id="dm-user-search" type="text" placeholder="Search users" autocomplete="off" oninput="onDirectMessageSearchInput(this.value)"><div id="dm-search-results"></div></div>
  </div>`;
}

function triggerDirectMessageNewGroupPhotoInput() {
  document.getElementById('dm-new-group-photo-input')?.click();
}

async function handleDirectMessageNewGroupPhoto(file) {
  if (!file) return;
  try {
    dmNewChatGroupPhotoData = await resizeDirectMessageImageFile(file, 420, 0.78);
    renderDirectMessagesView();
  } catch (error) {
    console.error('Group photo load failed:', error);
    showToast('Could not use that photo');
  }
}

async function createDirectMessageGroupChat() {
  if (!currentUser || !dmNewChatSelectedUids.length) return;
  const selected = [...new Set(dmNewChatSelectedUids.filter(uid => uid && uid !== currentUser.uid))];
  if (!selected.length) return;
  const nameInput = document.getElementById('dm-group-name-input');
  dmNewChatGroupName = String(nameInput?.value || dmNewChatGroupName || '').trim();
  const now = Date.now();
  const selfProfile = getCurrentUserDirectMessageProfile();
  const participants = { [currentUser.uid]: selfProfile };
  selected.forEach(uid => {
    participants[uid] = getDirectMessageProfile(uid, usersMap[uid] || {});
  });
  const defaultName = selected.map(uid => getDisplayName(participants[uid], 'User')).filter(Boolean).slice(0, 3).join(', ');
  const thread = normalizeDirectMessageThread({
    id: `dmgroup_${currentUser.uid}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'group',
    isGroup: true,
    groupName: dmNewChatGroupName || defaultName || 'Group Chat',
    groupPhoto: dmNewChatGroupPhotoData || '',
    ownerUid: currentUser.uid,
    adminUids: [currentUser.uid],
    participantUids: [currentUser.uid, ...selected],
    participants,
    messages: [],
    lastMessage: 'Group chat created',
    lastMessageFromUid: currentUser.uid,
    lastMessageAtMs: now,
    unreadUids: selected,
    createdAtMs: now,
    updatedAtMs: now
  });
  try {
    await mirrorDirectMessageThreadToParticipants(thread);
    dmThreadIds = [...new Set([...dmThreadIds, thread.id])];
    dmThreadMap[thread.id] = thread;
    dmNewChatOpen = false;
    dmNewChatSelectedUids = [];
    dmNewChatGroupPhotoData = '';
    dmNewChatGroupName = '';
    activeMessagesSubTab = 'chats';
    activeDmThreadId = thread.id;
    renderDirectMessagesView();
    showToast('Group chat created');
  } catch (error) {
    console.error('createDirectMessageGroupChat failed:', error);
    showToast('Could not create group chat');
  }
}

function triggerDirectMessageGroupPhotoInput(threadId = activeDmThreadId) {
  if (!threadId || !isDirectMessageGroupThread(dmThreadMap[threadId])) return;
  const input = document.getElementById('dm-group-photo-input') || (() => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/*';
    el.id = 'dm-group-photo-input';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  })();
  input.onchange = () => handleDirectMessageGroupPhotoUpload(threadId, input.files && input.files[0]);
  input.click();
}

async function handleDirectMessageGroupPhotoUpload(threadId = activeDmThreadId, file) {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !file || !isDirectMessageGroupThread(thread)) return;
  try {
    const groupPhoto = await resizeDirectMessageImageFile(file, 420, 0.78);
    const nextThread = normalizeDirectMessageThread({ ...thread, groupPhoto, updatedAtMs: Date.now() });
    dmThreadMap[threadId] = nextThread;
    renderDirectMessagesView();
    await mirrorDirectMessageThreadToParticipants(nextThread);
    showToast('Group photo updated');
  } catch (error) {
    console.error('Group photo update failed:', error);
    showToast('Could not update group photo');
  }
}

function resizeDirectMessageImageFile(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('Not an image'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = String(reader.result || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function triggerDirectMessagePhotoUpload(threadId = activeDmThreadId) {
  const input = document.getElementById(`dm-photo-input-${threadId}`);
  input?.click();
}

async function handleDirectMessagePhotoUpload(threadId = activeDmThreadId, file) {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !file) return;
  try {
    const imageData = await resizeDirectMessageImageFile(file, 720, 0.74);
    await appendDirectMessageToThread(threadId, '', null, { imageData, name: file.name || 'Photo' });
  } catch (error) {
    console.error('Direct Message photo upload failed:', error);
    showToast('Could not send photo');
  }
}

async function openOrCreateDirectMessageThreadForUser(uid = '') {
  if (!currentUser || !uid || uid === currentUser.uid) return null;
  const existingThread = getDirectMessageThreadWithUser(uid);
  if (existingThread) {
    openDirectMessageThread(existingThread.id);
    return existingThread;
  }

  try {
    const targetSnap = await db.collection('users').doc(uid).get();
    const targetUser = targetSnap.exists ? { uid: targetSnap.id, ...(targetSnap.data() || {}) } : { uid, ...(usersMap[uid] || {}) };
    if (!targetUser.uid) throw new Error('Missing target user');
    usersMap[uid] = { ...(usersMap[uid] || {}), ...targetUser };

    const selfProfile = getCurrentUserDirectMessageProfile();
    const targetProfile = getDirectMessageProfile(uid, targetUser);
    const now = Date.now();
    const thread = normalizeDirectMessageThread({
      id: buildDirectMessagePairId('dm', currentUser.uid, uid),
      participantUids: [currentUser.uid, uid].filter(Boolean),
      participants: {
        [currentUser.uid]: selfProfile,
        [uid]: targetProfile
      },
      messages: [],
      lastMessage: '',
      lastMessageFromUid: '',
      lastMessageAtMs: now,
      unreadUids: [],
      createdAtMs: now,
      updatedAtMs: now
    });

    const requestId = buildDirectMessagePairId('dmreq', currentUser.uid, uid);
    await Promise.all([
      mirrorDirectMessageThreadToParticipants(thread),
      clearDirectMessageRequestMirror(currentUser.uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(currentUser.uid, 'outgoing', requestId),
      clearDirectMessageRequestMirror(uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(uid, 'outgoing', requestId)
    ]);

    dmIncomingRequestIds = dmIncomingRequestIds.filter(id => id !== requestId);
    dmOutgoingRequestIds = dmOutgoingRequestIds.filter(id => id !== requestId);
    delete dmIncomingRequestMap[requestId];
    delete dmOutgoingRequestMap[requestId];
    dmThreadIds = [...new Set([...dmThreadIds, thread.id])];
    dmThreadMap[thread.id] = thread;
    activeMessagesSubTab = 'chats';
    activeDmThreadId = thread.id;
    updateDirectMessagesBadge();
    if (activeFriendsTab === 'messages' || isDirectMessagesPageOpen()) renderDirectMessagesView();
    return thread;
  } catch (error) {
    console.error('openOrCreateDirectMessageThreadForUser failed:', error);
    showToast('Could not open message');
    return null;
  }
}

async function sendDirectMessageRequest(uid = '') {
  if (!currentUser || !uid || uid === currentUser.uid) return;
  const existingThread = getDirectMessageThreadWithUser(uid);
  if (existingThread) {
    openDirectMessageThread(existingThread.id);
    return;
  }
  if (isDirectMessageFriend(uid)) {
    await openOrCreateDirectMessageThreadForUser(uid);
    return;
  }
  const incoming = getDirectMessageRequestWithUser(uid, 'incoming');
  if (incoming) {
    await acceptDirectMessageRequest(incoming.id);
    return;
  }
  const outgoing = getDirectMessageRequestWithUser(uid, 'outgoing');
  if (outgoing) {
    showToast('Message request already sent');
    return;
  }
  try {
    const targetSnap = await db.collection('users').doc(uid).get();
    const targetUser = targetSnap.exists ? { uid: targetSnap.id, ...(targetSnap.data() || {}) } : { uid, ...(usersMap[uid] || {}) };
    if (!targetUser.uid) throw new Error('Missing target user');
    usersMap[uid] = { ...(usersMap[uid] || {}), ...targetUser };
    const requestId = buildDirectMessagePairId('dmreq', currentUser.uid, uid);
    const payload = getDirectMessageRequestPayload(targetUser, requestId);
    dmOutgoingRequestIds = [...new Set([...dmOutgoingRequestIds, requestId])];
    dmOutgoingRequestMap[requestId] = payload;
    await Promise.all([
      setDirectMessageRequestMirror(currentUser.uid, 'outgoing', requestId, payload, true),
      setDirectMessageRequestMirror(uid, 'incoming', requestId, payload, true)
    ]);
    dmNewChatOpen = false;
    activeMessagesSubTab = 'requests';
    updateDirectMessagesBadge();
    if (activeFriendsTab === 'messages' || isDirectMessagesPageOpen()) renderDirectMessagesView();
    showToast('Message request sent');
  } catch (error) {
    console.error('sendDirectMessageRequest failed:', error);
    showToast('Could not send message request');
  }
}

async function acceptDirectMessageRequest(requestId = '') {
  const request = dmIncomingRequestMap[requestId];
  if (!currentUser || !request) {
    showToast('Request not found');
    return;
  }
  try {
    const now = Date.now();
    const thread = normalizeDirectMessageThread({
      id: request.threadId || buildDirectMessagePairId('dm', request.fromUid, request.toUid),
      participantUids: [request.fromUid, request.toUid].filter(Boolean),
      participants: request.participants || {
        [request.fromUid]: request.fromProfile || {},
        [request.toUid]: request.toProfile || {}
      },
      messages: [],
      lastMessage: 'Messages unlocked',
      lastMessageFromUid: currentUser.uid,
      lastMessageAtMs: now,
      unreadUids: [request.fromUid].filter(Boolean),
      createdAtMs: request.createdAtMs || now,
      updatedAtMs: now
    });
    await Promise.all([
      clearDirectMessageRequestMirror(currentUser.uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(request.fromUid, 'outgoing', requestId),
      mirrorDirectMessageThreadToParticipants(thread)
    ]);
    dmIncomingRequestIds = dmIncomingRequestIds.filter(id => id !== requestId);
    delete dmIncomingRequestMap[requestId];
    dmThreadIds = [...new Set([...dmThreadIds, thread.id])];
    dmThreadMap[thread.id] = thread;
    activeMessagesSubTab = 'chats';
    activeDmThreadId = thread.id;
    updateDirectMessagesBadge();
    renderDirectMessagesView();
    showToast('Message request accepted');
  } catch (error) {
    console.error('acceptDirectMessageRequest failed:', error);
    showToast('Could not accept request');
  }
}

async function declineDirectMessageRequest(requestId = '') {
  const request = dmIncomingRequestMap[requestId];
  if (!currentUser || !request) return;
  try {
    await Promise.all([
      clearDirectMessageRequestMirror(currentUser.uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(request.fromUid, 'outgoing', requestId)
    ]);
    dmIncomingRequestIds = dmIncomingRequestIds.filter(id => id !== requestId);
    delete dmIncomingRequestMap[requestId];
    updateDirectMessagesBadge();
    renderDirectMessagesView();
    showToast('Message request declined');
  } catch (error) {
    console.error('declineDirectMessageRequest failed:', error);
    showToast('Could not decline request');
  }
}

async function cancelDirectMessageRequest(requestId = '') {
  const request = dmOutgoingRequestMap[requestId];
  if (!currentUser || !request) return;
  try {
    await Promise.all([
      clearDirectMessageRequestMirror(currentUser.uid, 'outgoing', requestId),
      clearDirectMessageRequestMirror(request.toUid, 'incoming', requestId)
    ]);
    dmOutgoingRequestIds = dmOutgoingRequestIds.filter(id => id !== requestId);
    delete dmOutgoingRequestMap[requestId];
    updateDirectMessagesBadge();
    renderDirectMessagesView();
    showToast('Message request removed');
  } catch (error) {
    console.error('cancelDirectMessageRequest failed:', error);
    showToast('Could not remove request');
  }
}

function switchMessagesSubTab(tab = 'chats') {
  activeMessagesSubTab = tab === 'requests' ? 'requests' : 'chats';
  if (activeMessagesSubTab !== 'chats') activeDmThreadId = '';
  renderDirectMessagesView();
  persistUiState();
}

function getSortedDirectMessageThreads() {
  return Object.values(dmThreadMap || {})
    .filter(thread => thread && thread.id && Array.isArray(thread.participantUids) && thread.participantUids.includes(currentUser?.uid))
    .sort((a, b) => Number(b.lastMessageAtMs || b.updatedAtMs || 0) - Number(a.lastMessageAtMs || a.updatedAtMs || 0));
}

function formatDirectMessageTime(ts = 0) {
  const n = Number(ts || 0);
  if (!n) return '';
  const diff = Math.max(0, Date.now() - n);
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m`;
  if (diff < 86400000) return `${Math.max(1, Math.round(diff / 3600000))}h`;
  return new Date(n).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDirectMessageChatPreviewText(thread = {}) {
  const msg = thread.lastMessage || (isDirectMessageGroupThread(thread) ? 'Group chat created' : 'Messages unlocked');
  return msg;
}

function renderDirectMessageRequests() {
  const incoming = dmIncomingRequestIds.map(id => dmIncomingRequestMap[id]).filter(Boolean)
    .sort((a, b) => Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0));
  const outgoing = dmOutgoingRequestIds.map(id => dmOutgoingRequestMap[id]).filter(Boolean)
    .sort((a, b) => Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0));
  if (!incoming.length && !outgoing.length) {
    return `<div class="dm-empty-card"><strong>No message requests</strong><span>Message requests appear here.</span></div>`;
  }
  const renderCard = (req, direction) => {
    const profile = getDirectMessageRequestOtherProfile(req, direction);
    const incomingCard = direction === 'incoming';
    return `<article class="dm-request-card ${incomingCard ? 'incoming' : 'outgoing'}">
      <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
      <div class="dm-request-copy">
        <span>${incomingCard ? 'Wants to message you' : 'Request sent'}</span>
        <strong>${renderDisplayNameHTML(profile, 'User')}</strong>
        <em>${incomingCard ? 'Accept to unlock a private direct message thread.' : 'Waiting for them to accept. You can remove it anytime.'}</em>
      </div>
      <div class="dm-request-actions">
        ${incomingCard
          ? `<button class="dm-action accept" type="button" onclick="acceptDirectMessageRequest('${escAttr(req.id)}')">Accept</button><button class="dm-action decline" type="button" onclick="declineDirectMessageRequest('${escAttr(req.id)}')">Decline</button>`
          : `<button class="dm-action decline" type="button" onclick="cancelDirectMessageRequest('${escAttr(req.id)}')">Remove</button>`}
      </div>
    </article>`;
  };
  return `<div class="dm-requests-list">
    ${incoming.length ? `<section><div class="dm-section-label">Needs your response</div>${incoming.map(req => renderCard(req, 'incoming')).join('')}</section>` : ''}
    ${outgoing.length ? `<section><div class="dm-section-label">Sent by you</div>${outgoing.map(req => renderCard(req, 'outgoing')).join('')}</section>` : ''}
  </div>`;
}

function renderDirectMessageChats() {
  const threads = getSortedDirectMessageThreads();
  if (!threads.length) {
    return `<div class="dm-empty-card"><strong>No chats yet</strong><span>Tap the pencil to start a message.</span></div>`;
  }
  return `<div class="dm-chat-list">${threads.map(thread => {
    const profile = getDirectMessageThreadProfile(thread);
    const unread = Array.isArray(thread.unreadUids) && thread.unreadUids.includes(currentUser?.uid);
    return `<div class="dm-chat-swipe-item" data-dm-thread-id="${escAttr(thread.id)}">
      <button class="dm-chat-delete-action" type="button" onclick="event.stopPropagation();deleteDirectMessageThreadForMe('${escAttr(thread.id)}')" aria-label="Delete chat" title="Delete chat">🗑</button>
      <button class="dm-chat-row ${unread ? 'unread' : ''}" type="button" onclick="handleDirectMessageChatRowClick(event, '${escAttr(thread.id)}')">
        <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
        <div class="dm-chat-copy"><strong>${renderDisplayNameHTML(profile, 'User')}</strong><span>${escHtml(getDirectMessageChatPreviewText(thread))}</span></div>
        <em>${formatDirectMessageTime(thread.lastMessageAtMs || thread.updatedAtMs)}</em>
      </button>
    </div>`;
  }).join('')}</div>`;
}


function closeDirectMessageChatSwipeRows(exceptItem = null) {
  document.querySelectorAll('.dm-chat-swipe-item.swipe-open').forEach(item => {
    if (exceptItem && item === exceptItem) return;
    item.classList.remove('swipe-open');
    item.style.setProperty('--dm-chat-swipe-x', '0px');
  });
}

function handleDirectMessageChatRowClick(event, threadId = '') {
  const item = event?.currentTarget?.closest?.('.dm-chat-swipe-item');
  if (item && item.classList.contains('swipe-open')) {
    event.preventDefault();
    event.stopPropagation();
    closeDirectMessageChatSwipeRows();
    return;
  }
  openDirectMessageThread(threadId);
}

async function deleteDirectMessageThreadForMe(threadId = '') {
  if (!currentUser || !threadId) return;
  const thread = dmThreadMap[threadId];
  delete dmThreadMap[threadId];
  dmThreadIds = dmThreadIds.filter(id => id !== threadId);
  if (activeDmThreadId === threadId) activeDmThreadId = '';
  closeDirectMessageChatSwipeRows();
  updateDirectMessagesBadge();
  renderDirectMessagesView();
  try {
    const ref = db.collection('users').doc(currentUser.uid);
    await ref.set({
      directMessageThreads: firebase.firestore.FieldValue.arrayRemove(threadId)
    }, { merge: true });
    try {
      await ref.update({ [`directMessageThreadMap.${threadId}`]: firebase.firestore.FieldValue.delete() });
    } catch (mapError) {
      console.warn('Direct Message thread map cleanup skipped:', mapError);
    }
    showToast('Chat deleted');
  } catch (error) {
    console.error('deleteDirectMessageThreadForMe failed:', error);
    if (thread) dmThreadMap[threadId] = thread;
    dmThreadIds = [...new Set([...dmThreadIds, threadId])];
    renderDirectMessagesView();
    showToast('Could not delete chat');
  }
}

let dmChatSwipeState = null;
let dmChatSwipeRaf = 0;

function applyDirectMessageChatSwipe(item, x) {
  if (!item) return;
  const clamped = Math.max(-88, Math.min(0, x));
  item.style.setProperty('--dm-chat-swipe-x', clamped + 'px');
}

function scheduleDirectMessageChatSwipe(item, x) {
  if (dmChatSwipeRaf) cancelAnimationFrame(dmChatSwipeRaf);
  dmChatSwipeRaf = requestAnimationFrame(() => {
    dmChatSwipeRaf = 0;
    applyDirectMessageChatSwipe(item, x);
  });
}

function initDirectMessageChatSwipeActions() {
  if (window.__screenListDmChatSwipeActionsReady) return;
  window.__screenListDmChatSwipeActionsReady = true;

  document.addEventListener('touchstart', event => {
    const item = event.target?.closest?.('.dm-chat-swipe-item');
    if (!item || activeDmThreadId || activeDmGroupEditThreadId || event.touches.length !== 1) return;
    if (event.target?.closest?.('.dm-chat-delete-action')) return;
    const touch = event.touches[0];
    dmChatSwipeState = {
      item,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      swiping: false,
      verticalLocked: false
    };
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    const state = dmChatSwipeState;
    if (!state || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    state.lastX = touch.clientX;

    if (!state.swiping) {
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 1.05) {
        state.verticalLocked = true;
        return;
      }
      if (state.verticalLocked) return;
      if (dx > -12 || Math.abs(dx) < Math.abs(dy) * 1.12) return;
      state.swiping = true;
      closeDirectMessageChatSwipeRows(state.item);
      state.item.classList.add('is-swiping');
    }

    if (state.swiping) {
      event.preventDefault();
      scheduleDirectMessageChatSwipe(state.item, dx);
    }
  }, { passive: false });

  const finishSwipe = () => {
    const state = dmChatSwipeState;
    dmChatSwipeState = null;
    if (!state) return;
    if (dmChatSwipeRaf) {
      cancelAnimationFrame(dmChatSwipeRaf);
      dmChatSwipeRaf = 0;
    }
    state.item.classList.remove('is-swiping');
    if (!state.swiping) return;
    const distance = state.lastX - state.startX;
    if (distance <= -42) {
      state.item.classList.add('swipe-open');
      state.item.style.setProperty('--dm-chat-swipe-x', '-88px');
    } else {
      state.item.classList.remove('swipe-open');
      state.item.style.setProperty('--dm-chat-swipe-x', '0px');
    }
  };

  document.addEventListener('touchend', finishSwipe, { passive: true });
  document.addEventListener('touchcancel', finishSwipe, { passive: true });
  document.addEventListener('click', event => {
    if (event.target?.closest?.('.dm-chat-swipe-item, .dm-chat-delete-action')) return;
    closeDirectMessageChatSwipeRows();
  }, { passive: true });
}

initDirectMessageChatSwipeActions();
function openDirectMessageGroupEdit(threadId = activeDmThreadId) {
  const thread = dmThreadMap[threadId];
  if (!thread || !isDirectMessageGroupThread(thread)) return;
  activeDmGroupEditThreadId = threadId;
  dmGroupEditPhotoData = thread.groupPhoto || '';
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  renderDirectMessagesView();
}

function closeDirectMessageGroupEdit() {
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  renderDirectMessagesView();
}

function triggerDirectMessageGroupEditPhotoInput() {
  document.getElementById('dm-group-edit-photo-input')?.click();
}

function clampDirectMessageCropValue(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function getDirectMessageCropDrawMetrics(img, size, crop = {}) {
  const naturalWidth = Math.max(1, img?.naturalWidth || img?.width || 1);
  const naturalHeight = Math.max(1, img?.naturalHeight || img?.height || 1);
  const zoom = clampDirectMessageCropValue(crop.zoom, 1, 3, 1);
  const x = clampDirectMessageCropValue(crop.x, -100, 100, 0);
  const y = clampDirectMessageCropValue(crop.y, -100, 100, 0);
  const baseScale = Math.max(size / naturalWidth, size / naturalHeight);
  const drawWidth = naturalWidth * baseScale * zoom;
  const drawHeight = naturalHeight * baseScale * zoom;
  const extraX = Math.max(0, (drawWidth - size) / 2);
  const extraY = Math.max(0, (drawHeight - size) / 2);
  return {
    dx: (size - drawWidth) / 2 + (x / 100) * extraX,
    dy: (size - drawHeight) / 2 + (y / 100) * extraY,
    drawWidth,
    drawHeight
  };
}

function primeDirectMessageGroupEditCropImage(sourceData = '') {
  if (!sourceData) return;
  if (dmGroupEditCropImage && dmGroupEditCropImageSrc === sourceData) {
    requestAnimationFrame(renderDirectMessageGroupEditCropCanvas);
    return;
  }
  const image = new Image();
  dmGroupEditCropImage = image;
  dmGroupEditCropImageSrc = sourceData;
  image.onload = () => requestAnimationFrame(renderDirectMessageGroupEditCropCanvas);
  image.onerror = () => showToast('Could not preview that photo');
  image.src = sourceData;
}

function renderDirectMessageGroupEditCropCanvas() {
  const canvas = document.getElementById('dm-group-edit-crop-canvas');
  const state = dmGroupEditCropState;
  const image = dmGroupEditCropImage;
  if (!canvas || !state || !image || !image.complete) return;
  const size = canvas.width || 260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  const metrics = getDirectMessageCropDrawMetrics(image, size, state);
  ctx.drawImage(image, metrics.dx, metrics.dy, metrics.drawWidth, metrics.drawHeight);
  ctx.restore();
}

function updateDirectMessageGroupEditCrop(field, value) {
  if (!dmGroupEditCropState) return;
  if (field === 'zoom') dmGroupEditCropState.zoom = clampDirectMessageCropValue(value, 1, 3, 1);
  if (field === 'x') dmGroupEditCropState.x = clampDirectMessageCropValue(value, -100, 100, 0);
  if (field === 'y') dmGroupEditCropState.y = clampDirectMessageCropValue(value, -100, 100, 0);
  renderDirectMessageGroupEditCropCanvas();
}

function cropDirectMessageGroupEditPhoto(size = 520, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const state = dmGroupEditCropState;
    if (!state?.sourceData) {
      reject(new Error('Missing crop source'));
      return;
    }
    const finish = (image) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const metrics = getDirectMessageCropDrawMetrics(image, size, state);
        ctx.drawImage(image, metrics.dx, metrics.dy, metrics.drawWidth, metrics.drawHeight);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (error) {
        reject(error);
      }
    };
    if (dmGroupEditCropImage && dmGroupEditCropImageSrc === state.sourceData && dmGroupEditCropImage.complete) {
      finish(dmGroupEditCropImage);
      return;
    }
    const image = new Image();
    image.onload = () => finish(image);
    image.onerror = reject;
    image.src = state.sourceData;
  });
}

async function handleDirectMessageGroupEditPhoto(file) {
  if (!file) return;
  try {
    const sourceData = await resizeDirectMessageImageFile(file, 1400, 0.9);
    dmGroupEditCropState = { sourceData, zoom: 1, x: 0, y: 0 };
    primeDirectMessageGroupEditCropImage(sourceData);
    renderDirectMessagesView();
  } catch (error) {
    console.error('Group edit photo load failed:', error);
    showToast('Could not use that photo');
  }
}

async function applyDirectMessageGroupEditCrop() {
  if (!dmGroupEditCropState) return;
  try {
    dmGroupEditPhotoData = await cropDirectMessageGroupEditPhoto(520, 0.86);
    dmGroupEditCropState = null;
    dmGroupEditCropImage = null;
    dmGroupEditCropImageSrc = '';
    renderDirectMessagesView();
  } catch (error) {
    console.error('Group edit crop failed:', error);
    showToast('Could not crop that photo');
  }
}

function cancelDirectMessageGroupEditCrop() {
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  renderDirectMessagesView();
}

function getDirectMessageGroupEditDefaultName(thread = {}) {
  return (thread.participantUids || [])
    .filter(uid => uid && uid !== currentUser?.uid)
    .map(uid => getDisplayName(getDirectMessageProfile(uid, thread.participants?.[uid] || {}), 'User'))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ') || 'Group Chat';
}

async function saveDirectMessageGroupEdit(threadId = activeDmGroupEditThreadId) {
  if (dmGroupEditCropState) await applyDirectMessageGroupEditCrop();
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !isDirectMessageGroupThread(thread)) return;
  const nameInput = document.getElementById('dm-group-edit-name');
  const cleanName = String(nameInput?.value || '').trim().slice(0, 48) || getDirectMessageGroupEditDefaultName(thread);
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    groupName: cleanName,
    groupPhoto: dmGroupEditPhotoData || '',
    updatedAtMs: Date.now()
  });
  dmThreadMap[threadId] = nextThread;
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  renderDirectMessagesView();
  try {
    await mirrorDirectMessageThreadToParticipants(nextThread);
    showToast('Group updated');
  } catch (error) {
    console.error('saveDirectMessageGroupEdit failed:', error);
    showToast('Could not update group');
  }
}

function renderDirectMessageGroupEditPage(threadId = activeDmGroupEditThreadId) {
  const thread = dmThreadMap[threadId];
  if (!thread || !isDirectMessageGroupThread(thread)) {
    activeDmGroupEditThreadId = '';
    return renderDirectMessageChats();
  }
  const currentName = thread.groupName || getDirectMessageGroupEditDefaultName(thread);
  const photoProfile = { name: currentName, photo: dmGroupEditPhotoData || thread.groupPhoto || '' };
  const members = (thread.participantUids || []).map(uid => getDirectMessageProfile(uid, thread.participants?.[uid] || {})).filter(profile => profile.uid);
  const cropUi = dmGroupEditCropState?.sourceData ? `<div class="dm-group-edit-crop-panel">
      <canvas id="dm-group-edit-crop-canvas" width="260" height="260" aria-label="Crop group photo preview"></canvas>
      <div class="dm-group-edit-crop-controls">
        <label>Zoom <input type="range" min="1" max="3" step="0.01" value="${escAttr(dmGroupEditCropState.zoom || 1)}" oninput="updateDirectMessageGroupEditCrop('zoom', this.value)"></label>
        <label>Move sideways <input type="range" min="-100" max="100" step="1" value="${escAttr(dmGroupEditCropState.x || 0)}" oninput="updateDirectMessageGroupEditCrop('x', this.value)"></label>
        <label>Move up/down <input type="range" min="-100" max="100" step="1" value="${escAttr(dmGroupEditCropState.y || 0)}" oninput="updateDirectMessageGroupEditCrop('y', this.value)"></label>
      </div>
      <div class="dm-group-edit-crop-actions">
        <button type="button" onclick="cancelDirectMessageGroupEditCrop()">Cancel</button>
        <button type="button" onclick="applyDirectMessageGroupEditCrop()">Use photo</button>
      </div>
    </div>` : '';
  return `<div class="dm-group-edit-page">
    <div class="dm-group-edit-hero">
      <button class="dm-group-edit-photo" type="button" onclick="triggerDirectMessageGroupEditPhotoInput()" aria-label="Change group photo">
        <img src="${escAttr(getDirectMessageAvatar(photoProfile))}" alt="" loading="lazy">
        <span>✎</span>
      </button>
      <input id="dm-group-edit-photo-input" type="file" accept="image/*" style="display:none" onchange="handleDirectMessageGroupEditPhoto(this.files && this.files[0]); this.value='';">
      ${cropUi}
      <div class="dm-group-edit-name-wrap">
        <label for="dm-group-edit-name">Group name</label>
        <input id="dm-group-edit-name" type="text" maxlength="48" autocomplete="off" value="${escAttr(currentName)}" placeholder="Group name">
      </div>
      <button class="dm-group-edit-save" type="button" onclick="saveDirectMessageGroupEdit('${escAttr(thread.id)}')">Save</button>
    </div>
    <section class="dm-group-edit-members">
      <div class="dm-group-edit-section-title">Members <span>${members.length}</span></div>
      ${members.map(profile => `<div class="dm-group-edit-member"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy"><span>${renderDisplayNameHTML(profile, 'User')}</span>${profile.uid === currentUser?.uid ? '<em>You</em>' : ''}</div>`).join('')}
    </section>
  </div>`;
}

function renderDirectMessageThread(threadId = activeDmThreadId) {
  const thread = dmThreadMap[threadId];
  if (!thread) {
    activeDmThreadId = '';
    return renderDirectMessageChats();
  }
  const profile = getDirectMessageThreadProfile(thread);
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const isGroup = isDirectMessageGroupThread(thread);
  const title = getDirectMessageThreadTitle(thread);
  return `<div class="dm-thread-panel">
    <div class="dm-thread-head">
      <button type="button" onclick="closeDirectMessageThread()">←</button>
      <button class="dm-thread-avatar-btn ${isGroup ? 'editable' : ''}" type="button" ${isGroup ? `onclick="openDirectMessageGroupEdit('${escAttr(thread.id)}')" title="Edit group chat"` : 'tabindex="-1"'}>
        <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
      </button>
      <div class="${isGroup ? 'dm-thread-title-editable' : ''}" ${isGroup ? `onclick="openDirectMessageGroupEdit('${escAttr(thread.id)}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openDirectMessageGroupEdit('${escAttr(thread.id)}')}"` : ''}><strong>${escHtml(title)}</strong><span>${escHtml(getDirectMessageThreadSubtitle(thread))}</span></div>
    </div>
    <div class="dm-message-list" id="dm-message-list">
      ${messages.length ? messages.map(message => {
        const mine = message.fromUid === currentUser?.uid;
        const sender = isGroup && !mine ? getDirectMessageProfile(message.fromUid || '', thread.participants?.[message.fromUid] || {}) : null;
        const content = renderDirectMessagePayloadContent(getDirectMessagePlainPayload(message), false);
        return `<div class="dm-bubble-row ${mine ? 'mine' : 'theirs'}"><div class="dm-bubble">${sender ? `<small>${renderDisplayNameHTML(sender, 'User')}</small>` : ''}${content}<em>${formatDirectMessageTime(message.createdAtMs)}</em></div></div>`;
      }).join('') : `<div class="dm-thread-empty">Chat accepted. Send the first message.</div>`}
    </div>
    <div class="dm-compose-row">
      <input id="dm-photo-input-${escAttr(thread.id)}" type="file" accept="image/*" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <button class="dm-photo-upload-btn" type="button" aria-label="Send photo" onclick="triggerDirectMessagePhotoUpload('${escAttr(thread.id)}')">＋</button>
      <input id="dm-message-input" type="text" placeholder="Message ${escAttr(title || 'chat')}..." autocomplete="off" onkeydown="if(event.key==='Enter'){sendDirectMessage('${escAttr(thread.id)}')}">
      <button class="dm-send-btn" type="button" onpointerdown="if(window.matchMedia && window.matchMedia('(max-width: 700px)').matches){event.preventDefault();}" onclick="sendDirectMessage('${escAttr(thread.id)}')">Send</button>
    </div>
  </div>`;
}
async function markDirectMessageThreadRead(threadId = '') {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !(thread.unreadUids || []).includes(currentUser.uid)) return;
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    unreadUids: (thread.unreadUids || []).filter(uid => uid !== currentUser.uid),
    updatedAtMs: Date.now()
  });
  dmThreadMap[threadId] = nextThread;
  try {
    await setDirectMessageThreadMirror(currentUser.uid, nextThread);
    updateDirectMessagesBadge();
  } catch (error) {
    console.warn('Direct Message read marker failed:', error);
  }
}

function openDirectMessageThread(threadId = '') {
  if (!threadId || !dmThreadMap[threadId]) return;
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  const page = document.getElementById('direct-messages-page');
  if (page) page.classList.add('dm-opening-thread');
  activeMessagesSubTab = 'chats';
  activeDmThreadId = threadId;
  renderDirectMessagesView();
  if (page) window.setTimeout(() => page.classList.remove('dm-opening-thread'), 520);
  markDirectMessageThreadRead(threadId);
  requestAnimationFrame(() => {
    const list = document.getElementById('dm-message-list');
    if (list) list.scrollTop = list.scrollHeight;
  });
  persistUiState();
}

function closeDirectMessageThread() {
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  activeDmThreadId = '';
  resetDirectMessageKeyboardLift();
  renderDirectMessagesView();
  persistUiState();
}

async function sendDirectMessage(threadId = '') {
  const input = document.getElementById('dm-message-input');
  const text = String(input?.value || '').trim();
  const thread = dmThreadMap[threadId];
  if (!text || !currentUser || !thread) return;
  const keepMobileKeyboardOpen = isDirectMessagesMobileViewport();
  if (input) {
    input.value = '';
    if (!keepMobileKeyboardOpen) input.blur();
  }
  if (!keepMobileKeyboardOpen) resetDirectMessageKeyboardLift();
  const sent = await appendDirectMessageToThread(threadId, text, null);
  if (!sent && input) input.value = text;
  if (keepMobileKeyboardOpen) {
    requestAnimationFrame(() => {
      const nextInput = document.getElementById('dm-message-input');
      if (nextInput) {
        try { nextInput.focus({ preventScroll: true }); }
        catch (error) { nextInput.focus(); }
      }
      updateDirectMessageKeyboardLift();
      const list = document.getElementById('dm-message-list');
      if (list) list.scrollTop = list.scrollHeight;
    });
  } else {
    resetDirectMessageKeyboardLift();
  }
}

function renderDirectMessagesView() {
  const fullscreenShell = document.getElementById('dm-fullscreen-shell');
  const communityShell = document.getElementById('dm-shell');
  const shells = isDirectMessagesPageOpen() && fullscreenShell ? [fullscreenShell] : (communityShell ? [communityShell] : []);
  if (!shells.length) return;
  let html = '';
  if (!currentUser) {
    html = `<div class="dm-empty-card"><strong>Sign in required</strong><span>Direct Messages will appear here.</span></div>`;
    shells.forEach(shell => { shell.innerHTML = html; });
    return;
  }
  updateDirectMessagesBadge();
  const requestCount = dmIncomingRequestIds.length;
  const unreadCount = getUnreadDirectMessageThreadCount();

  if (activeDmGroupEditThreadId) {
    html = renderDirectMessageGroupEditPage(activeDmGroupEditThreadId);
  } else if (activeDmThreadId) {
    html = renderDirectMessageThread(activeDmThreadId);
  } else {
    const body = activeMessagesSubTab === 'requests' ? renderDirectMessageRequests() : renderDirectMessageChats();
    html = `<div class="dm-lite-head"><strong>Messages</strong><button class="dm-new-chat-btn" type="button" onclick="openDirectMessageComposer('direct')" aria-label="New message">✎</button><span>${requestCount ? `${requestCount} request${requestCount === 1 ? '' : 's'}` : unreadCount ? `${unreadCount} unread` : 'Direct messages'}</span></div>
      <div class="dm-subtabs">
        <button class="${activeMessagesSubTab === 'chats' ? 'active' : ''}" type="button" onclick="switchMessagesSubTab('chats')">Chats${unreadCount ? `<span>${unreadCount}</span>` : ''}</button>
        <button class="${activeMessagesSubTab === 'requests' ? 'active' : ''}" type="button" onclick="switchMessagesSubTab('requests')">Requests${requestCount ? `<span>${requestCount}</span>` : ''}</button>
      </div>
      ${dmNewChatOpen ? renderDirectMessageComposerPanel() : ''}
      ${body}`;
  }

  updateDirectMessagesTopbar();
  shells.forEach(shell => {
    shell.classList.toggle('dm-thread-active', !!activeDmThreadId || !!activeDmGroupEditThreadId);
    shell.classList.toggle('dm-group-edit-active', !!activeDmGroupEditThreadId);
    shell.innerHTML = html;
  });
  if (dmGroupEditCropState?.sourceData) {
    primeDirectMessageGroupEditCropImage(dmGroupEditCropState.sourceData);
  }
  requestAnimationFrame(() => {
    document.querySelectorAll('#dm-message-list').forEach(list => {
      list.scrollTop = list.scrollHeight;
    });
  });
}


function openDirectMessageFromUser(uid = '') {
  if (!uid || uid === currentUser?.uid) return;
  openDirectMessagesPage();
  const thread = getDirectMessageThreadWithUser(uid);
  if (thread) {
    openDirectMessageThread(thread.id);
    return;
  }
  if (isDirectMessageFriend(uid)) {
    openOrCreateDirectMessageThreadForUser(uid);
    return;
  }
  sendDirectMessageRequest(uid).then(() => {
    activeMessagesSubTab = 'requests';
    renderDirectMessagesView();
  });
}
