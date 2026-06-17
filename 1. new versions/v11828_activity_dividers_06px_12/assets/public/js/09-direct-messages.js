// Direct Messages: request-first lightweight messaging stored through users docs.
let dmIncomingRequestIds = [];
let dmOutgoingRequestIds = [];
let dmIncomingRequestMap = {};
let dmOutgoingRequestMap = {};
let dmThreadIds = [];
let dmThreadMap = {};
/* v11.776: thread ids whose messages have been CONFIRMED from Firestore (the
   live listener or a direct fetch) — as opposed to the inbox cache, which seeds
   message-LESS stubs. Used so we show a loading state (not the empty "Chat
   accepted" state) until a thread's messages are actually hydrated. */
const dmHydratedThreadIds = (typeof Set !== 'undefined') ? new Set() : { has() { return false; }, add() {} };
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
let dmGroupEditAddSelectedUids = [];
let dmGroupEditRemovedUids = [];
const dmGroupEditCropPointers = new Map();
let dmGroupEditCropGesture = null;

/* v10.739: Shared dmThreads collection — the new canonical store for
   DM data. Replaces the per-user `users/{uid}.directMessageThreadMap`
   mirror approach which fundamentally cannot deliver cross-user because
   Firestore rules block writes to other users' docs. The shared doc at
   `dmThreads/{threadId}` carries `participantUids: [...]`; both
   participants can read/write because they're in that array (see the
   v10.739 rule block in FIRESTORE_RULES_CREATOR_PUBLIC_READ.txt).
   Same architecture as Instagram / Discord / WhatsApp / iMessage / etc. */
let dmSharedThreadsUnsubscribe = null;
let dmSharedThreadsMigrationDone = false;

function normalizeDirectMessageIds(value) {
  return Array.isArray(value) ? value.map(id => String(id || '').trim()).filter(Boolean) : [];
}

/* v10.761: isDirectMessageEncryptedRecord() now lives in 02-messages-e2ee.js
   (single source of truth). It is loaded before this file so it's available
   to all references below — same identical implementation, just deduped. */

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
    username: cached.username || cached.handle || fallback.username || fallback.handle || '',
    handle: cached.handle || cached.username || fallback.handle || fallback.username || '',
    photo: cached.photo || fallback.photo || fallback.photoURL || ''
  };
}

function getDirectMessageUsernameLabel(uid = '', profile = {}) {
  const cached = usersMap[uid] || {};
  const username = String(cached.username || cached.handle || profile.username || profile.handle || '').trim();
  if (username) return username.startsWith('@') ? username : `@${username}`;
  return String(profile.name || cached.name || cached.customName || 'User').trim();
}

function getDirectMessageAvatar(profile = {}) {
  return profile.photo || `/default-avatar.svg#${encodeURIComponent(profile.name || 'User')}&background=1e2028&color=a78bfa`;
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
    photo: thread.groupPhoto || `/default-avatar.svg#${encodeURIComponent(title || 'Group')}&background=1e2028&color=a78bfa`
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
  const badges = Array.from(document.querySelectorAll('#messages-count-badge, #header-dm-badge, #header-discover-dm-badge'));
  const headerBtns = [
    document.getElementById('header-dm-btn'),
    document.getElementById('header-discover-dm-btn')
  ].filter(Boolean);
  badges.forEach(badge => {
    /* v10.786: badge is now a numberless red DOT. Don't write the
       count to textContent — just toggle visibility. The CSS sizes it
       as a fixed 9x9 circle so any inline-flex/text positioning is
       irrelevant; use plain `inline-block` for the on-state. */
    badge.textContent = '';
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  });
  headerBtns.forEach(headerBtn => {
    /* aria-label still conveys the precise unread count to screen
       readers — only the visual badge dropped the number. */
    headerBtn.classList.toggle('has-ping', count > 0);
    headerBtn.setAttribute('aria-label', count > 0 ? 'Open messages, ' + count + ' new' : 'Open messages');
    headerBtn.title = count > 0 ? count + ' new message activity' : 'Messages';
  });
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
    page.classList.toggle('dm-new-chat-modal-open', !!dmNewChatOpen);
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

/* ════════════════════════════════════════════════════════════════════════
   v10.782 — SIMPLIFIED DM KEYBOARD + SCROLL HANDLING
   ════════════════════════════════════════════════════════════════════════
   Replaces 200+ lines of stacked patches (stableLayoutHeight tracking,
   token-based auto-scroll, manual touchstart preventDefault, multiple
   setTimeout chains, continuous window.scrollTo pins) with the minimal
   architecture the user asked for:

     1. ONE CSS variable (`--dm-keyboard-bottom`) driven by
        `visualViewport.resize`. The composer's `bottom` reads from it.
        Everything else flexes naturally — message list shrinks when
        keyboard rises, returns when keyboard drops.

     2. Send DOES NOT blur the input (iMessage behavior). Keyboard stays
        up. User decides when to dismiss by scrolling the message list
        UP (= swiping down with their finger). That swipe-down blurs
        the input and iOS plays its native keyboard-dismiss animation.

     3. Body locked via `position: fixed` while the DM page is open so
        iOS WKWebView can't drift the panel above the dynamic island.
        Saves/restores the user's pre-DM scroll position so closing
        the page returns them exactly where they were.

   Removed (dead code now):
     directMessagesStableLayoutHeight, --dm-layout-height, --dm-keyboard-lift,
     getDirectMessagesLayoutHeight, isDirectMessageTypingActive,
     getDirectMessageListBottomGap, cancelDirectMessageComposerAutoScroll,
     keepDirectMessageLastMessageInFrame, setDirectMessagesStableLayoutHeight,
     lockDirectMessageScrollPosition, directMessageComposerAutoScrollToken,
     the touchstart preventDefault + manual focus hack,
     the [60,130,200,320,450,520] setTimeout chains,
     the continuous window.scrollTo(0,0) listeners. */

function scrollDirectMessageListToBottom(options = {}) {
  const list = options?.list || document.getElementById('dm-message-list');
  if (!list) return;
  const instant = !!options?.instant;
  const previousBehavior = list.style.scrollBehavior;
  let addedInstantClass = false;
  if (instant) {
    addedInstantClass = !list.classList.contains('dm-initial-bottom-anchor');
    if (addedInstantClass) list.classList.add('dm-initial-bottom-anchor');
    list.style.scrollBehavior = 'auto';
  }
  list.scrollTop = list.scrollHeight;
  if (instant) {
    if (previousBehavior) list.style.scrollBehavior = previousBehavior;
    else list.style.removeProperty('scroll-behavior');
    if (addedInstantClass) list.classList.remove('dm-initial-bottom-anchor');
  }
}

function pinDirectMessageThreadToLatestMessage(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const pin = () => {
    if (activeDmThreadId !== id) return;
    scrollDirectMessageListToBottom({ instant: true });
  };
  pin();
  requestAnimationFrame(() => {
    pin();
    requestAnimationFrame(pin);
  });
  [40, 90, 180, 300, DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS + 120].forEach(delay => {
    window.setTimeout(pin, delay);
  });
  requestAnimationFrame(() => {
    if (activeDmThreadId !== id) return;
    const list = document.getElementById('dm-message-list');
    if (!list) return;
    list.querySelectorAll('img, video').forEach(media => {
      if (media.complete || media.readyState >= 2) return;
      try { media.addEventListener('load', pin, { once: true }); } catch (_) {}
      try { media.addEventListener('loadedmetadata', pin, { once: true }); } catch (_) {}
    });
  });
}

/* v11.788 DIAGNOSTIC: set false to DISABLE the "open the thread at the most recent
   message" bottom-anchor (the synchronous + rAF + setTimeout scroll-to-bottom that runs
   during the open slide). Per user request — testing whether that scroll-forcing is what
   kills the open slide animation. If the slide returns with this off, we re-implement the
   open-at-bottom to run AFTER the slide completes instead of during it. */
const DM_OPEN_BOTTOM_ANCHOR_ENABLED = false;
function beginDirectMessageInitialBottomAnchor(threadId = '') {
  if (!DM_OPEN_BOTTOM_ANCHOR_ENABLED) { dmInitialBottomAnchor = null; return null; }
  const id = String(threadId || '').trim();
  if (!id) return null;
  dmInitialBottomAnchor = {
    threadId: id,
    token: ++dmInitialBottomAnchorToken,
    mediaBound: false
  };
  return dmInitialBottomAnchor;
}

function endDirectMessageInitialBottomAnchor(token) {
  if (!dmInitialBottomAnchor || dmInitialBottomAnchor.token !== token) return;
  document.querySelectorAll('#dm-message-list.dm-initial-bottom-anchor').forEach(list => {
    list.classList.remove('dm-initial-bottom-anchor');
    list.style.removeProperty('scroll-behavior');
  });
  dmInitialBottomAnchor = null;
}

function anchorDirectMessageInitialOpenToBottom() {
  const state = dmInitialBottomAnchor;
  if (!state || activeDmThreadId !== state.threadId) return false;
  const list = document.getElementById('dm-message-list');
  if (!list) return false;
  list.classList.add('dm-initial-bottom-anchor');
  list.style.scrollBehavior = 'auto';
  list.scrollTop = list.scrollHeight;
  if (!state.mediaBound) {
    state.mediaBound = true;
    list.querySelectorAll('img, video').forEach(media => {
      if (media.complete || media.readyState >= 2) return;
      const correct = () => anchorDirectMessageInitialOpenToBottom();
      try { media.addEventListener('load', correct, { once: true }); } catch (_) {}
      try { media.addEventListener('loadedmetadata', correct, { once: true }); } catch (_) {}
    });
  }
  return true;
}

function stabilizeDirectMessageInitialBottomAnchor() {
  const state = dmInitialBottomAnchor;
  if (!state) return;
  const token = state.token;
  const run = () => {
    if (!dmInitialBottomAnchor || dmInitialBottomAnchor.token !== token) return;
    anchorDirectMessageInitialOpenToBottom();
  };
  run();
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
  [40, 120, 260, DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS + 80].forEach(delay => window.setTimeout(run, delay));
  window.setTimeout(() => endDirectMessageInitialBottomAnchor(token), DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS + 260);
}

function getDirectMessageKeyboardBottom() {
  if (!window.visualViewport) return 0;
  const viewport = window.visualViewport;
  const lift = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
  /* iOS sometimes reports tiny phantom lifts (~10-40px) when the URL
     bar resizes — treat anything under 80px as "no keyboard". */
  return lift > 80 ? lift : 0;
}

function updateDirectMessageKeyboardLift() {
  const page = document.getElementById('direct-messages-page');
  if (!page || !isDirectMessagesPageOpen()) return;
  /* v11.781 — root cause #3 (vertical snap): .dm-v2-panel is position:fixed bound to
     --vv-offset-top / --dm-keyboard-bottom with NO transition. While the chat OPEN
     slide is in flight, an incidental visualViewport resize/scroll (the inbox-search
     keyboard settling down, iOS safe-area/auto-scroll-to-input) would rewrite those
     vars instantly and SNAP the panel vertically mid-tween. Suppress the write during
     the slide; finishDirectMessageThreadOpenAnimation re-applies the settled value. */
  if (dmThreadOpenAnimationState) return;   /* v11.781 */
  const lift = isDirectMessagesMobileViewport() ? getDirectMessageKeyboardBottom() : 0;
  if (lift > 0) {
    page.classList.add('dm-keyboard-active');
    page.style.setProperty('--dm-keyboard-bottom', lift + 'px');
  } else {
    page.classList.remove('dm-keyboard-active');
    page.style.setProperty('--dm-keyboard-bottom', '0px');
  }
  /* v10.793: pin .dm-v2-panel top to visualViewport.offsetTop so iOS's
     auto-scroll-to-input behavior doesn't drift the header above the
     visible viewport when the keyboard opens. */
  const offsetTop = (window.visualViewport && Math.round(window.visualViewport.offsetTop)) || 0;
  page.style.setProperty('--vv-offset-top', offsetTop + 'px');
}

function resetDirectMessageKeyboardLift() {
  const page = document.getElementById('direct-messages-page');
  if (!page) return;
  page.classList.remove('dm-keyboard-active');
  page.style.setProperty('--dm-keyboard-bottom', '0px');
  page.style.setProperty('--vv-offset-top', '0px');
}

function setDirectMessagesBottomChromeHidden(hidden = false) {
  document.querySelectorAll('#mobile-bottom-nav, .mobile-bottom-nav').forEach(nav => {
    if (!nav) return;
    if (hidden) {
      nav.dataset.dmHiddenChrome = '1';
      nav.setAttribute('aria-hidden', 'true');
      try { nav.inert = true; } catch (_) {}
      nav.style.setProperty('display', 'none', 'important');
      nav.style.setProperty('visibility', 'hidden', 'important');
      nav.style.setProperty('pointer-events', 'none', 'important');
    } else if (nav.dataset.dmHiddenChrome === '1') {
      delete nav.dataset.dmHiddenChrome;
      nav.removeAttribute('aria-hidden');
      try { nav.inert = false; } catch (_) {}
      nav.style.removeProperty('display');
      nav.style.removeProperty('visibility');
      nav.style.removeProperty('pointer-events');
    }
  });
}

function initDirectMessageKeyboardLift() {
  if (window.__screenListDmKeyboardLiftReady) return;
  window.__screenListDmKeyboardLiftReady = true;

  /* Single source of truth for keyboard state — visualViewport resize
     fires per-frame while iOS animates the keyboard in/out.
     v10.793: also listen to `scroll` because visualViewport.offsetTop
     changes during iOS auto-scroll-to-input fire scroll, not resize. */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (!isDirectMessagesPageOpen()) return;
      updateDirectMessageKeyboardLift();
    });
    window.visualViewport.addEventListener('scroll', () => {
      if (!isDirectMessagesPageOpen()) return;
      updateDirectMessageKeyboardLift();
    });
  }
  window.addEventListener('resize', () => {
    if (!isDirectMessagesPageOpen()) return;
    updateDirectMessageKeyboardLift();
  });

  /* iMessage-style swipe-down-to-dismiss keyboard:
     User starts scrolling UP in the message list (= swiping their
     finger DOWN). After ~24px of upward scroll, blur the input so
     iOS dismisses the keyboard with its native slide-down animation.
     Threshold prevents accidental dismiss on tiny touch jitters. */
  let swipeStartY = null;
  document.addEventListener('touchstart', (event) => {
    if (!isDirectMessagesPageOpen()) return;
    const list = event.target && event.target.closest ? event.target.closest('#dm-message-list') : null;
    if (!list) { swipeStartY = null; return; }
    const input = document.getElementById('dm-message-input');
    if (!input || document.activeElement !== input) { swipeStartY = null; return; }
    swipeStartY = event.touches?.[0]?.clientY ?? null;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (swipeStartY === null) return;
    const currentY = event.touches?.[0]?.clientY;
    if (typeof currentY !== 'number') return;
    /* finger moved DOWN by >= 24px → user wants the keyboard gone. */
    if (currentY - swipeStartY >= 24) {
      swipeStartY = null;
      const input = document.getElementById('dm-message-input');
      if (input && document.activeElement === input) {
        try { input.blur(); } catch (_) {}
      }
    }
  }, { passive: true });
  document.addEventListener('touchend', () => { swipeStartY = null; }, { passive: true });
  document.addEventListener('touchcancel', () => { swipeStartY = null; }, { passive: true });
}

/* Body-lock helpers — when DM page opens we save window scrollY and
   put `position: fixed; top: -scrollY` on the body so iOS can't scroll
   the document. On close we undo it and scroll back. This eliminates
   the iOS WKWebView bug where focusing an input inside position:fixed
   silently scrolls the body, drifting the panel above the dynamic
   island. */
function lockBodyForDirectMessagesPage() {
  const body = document.body;
  if (!body || body.classList.contains('dm-fullscreen-open')) return;
  const scrollY = Math.max(0, window.scrollY || 0);
  body.dataset.dmRestoreScrollY = String(scrollY);
  body.style.setProperty('--dm-saved-scrollY', `-${scrollY}px`);
  body.classList.add('dm-fullscreen-open');
  setDirectMessagesBottomChromeHidden(true);
}
function unlockBodyForDirectMessagesPage() {
  const body = document.body;
  if (!body) return;
  const saved = Number(body.dataset.dmRestoreScrollY || 0);
  body.classList.remove('dm-fullscreen-open');
  body.style.removeProperty('--dm-saved-scrollY');
  delete body.dataset.dmRestoreScrollY;
  setDirectMessagesBottomChromeHidden(false);
  if (saved > 0) {
    try { window.scrollTo(0, saved); } catch (_) {}
  }
}


/* v71 / v11.680: mobile DM swipe-right close — INBOX PAGE ONLY. The chat-thread
   swipe-back is now driven by the generic news-reader engine (31-edge-swipe-back.js),
   so the old custom --dm-thread-swipe-x thread system (and its inbox-parallax
   underlay) has been deleted. This handler only slides the whole DM page away. */
let directMessagesSwipeState = null;
let directMessagesSwipeRaf = 0;
const DIRECT_MESSAGES_PAGE_EDGE_SWIPE_PX = 24;
const DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS = 390;   // v11.785: chat open slide-in / back-button slide-out, WAAPI-driven (see startDirectMessageThreadOpenAnimation)
let dmInitialBottomAnchor = null;
let dmInitialBottomAnchorToken = 0;
let dmThreadOpenAnimationState = null;

function cancelDirectMessageThreadOpenAnimation(page = document.getElementById('direct-messages-page')) {
  try { dmThreadOpenAnimationState?.animation?.cancel?.(); } catch (_) {}
  if (dmThreadOpenAnimationState?.timer) window.clearTimeout(dmThreadOpenAnimationState.timer);
  if (dmThreadOpenAnimationState?.deferTimer) window.clearTimeout(dmThreadOpenAnimationState.deferTimer);
  dmThreadOpenAnimationState = null;
  if (page) {
    page.classList.remove('dm-nav-open-thread');
    page.querySelectorAll('.dm-v2-panel-entering').forEach(panel => {
      panel.classList.remove('dm-v2-panel-entering');
      panel.style.transition = '';
      panel.style.transform = '';
      panel.style.willChange = '';
      panel.style.animation = '';
    });
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
  }
}

function finishDirectMessageThreadOpenAnimation(token = 0) {
  const state = dmThreadOpenAnimationState;
  if (!state || state.token !== token) return;
  const page = document.getElementById('direct-messages-page');
  if (page) {
    page.classList.remove('dm-nav-open-thread');
    page.querySelectorAll('.dm-v2-panel-entering').forEach(panel => {
      panel.classList.remove('dm-v2-panel-entering');
      panel.style.transition = '';
      panel.style.transform = '';
      panel.style.willChange = '';
      panel.style.animation = '';
    });
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
  }
  const shouldRenderDeferred = !!state.deferred;
  try { state.animation?.cancel?.(); } catch (_) {}
  dmThreadOpenAnimationState = null;
  /* v11.781: the slide is over — apply any keyboard/viewport lift that was
     suppressed during it (see updateDirectMessageKeyboardLift), so the panel
     settles to the correct top/bottom in ONE step instead of snapping mid-tween. */
  try { updateDirectMessageKeyboardLift(); } catch (_) {}
  if (shouldRenderDeferred && activeDmThreadId === state.threadId && isDirectMessagesPageOpen()) {
    renderDirectMessagesView();
  }
}

function beginDirectMessageThreadOpenAnimation(threadId = '', page = document.getElementById('direct-messages-page')) {
  const id = String(threadId || '').trim();
  if (!id) return null;
  cancelDirectMessageThreadOpenAnimation();
  if (page) renderDirectMessageSwipeInboxUnderlay(page);
  const token = Date.now() + Math.random();
  dmThreadOpenAnimationState = {
    threadId: id,
    token,
    consumed: false,
    started: false,
    deferred: false,
    animation: null,
    timer: 0,
    deferTimer: 0,
    doneAt: 0
  };
  return dmThreadOpenAnimationState;
}

function consumeDirectMessageThreadOpenAnimation(threadId = '') {
  const state = dmThreadOpenAnimationState;
  if (!state || state.threadId !== String(threadId || '').trim() || state.consumed) return false;
  state.consumed = true;
  state.doneAt = performance.now() + DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS;
  return true;
}

function startDirectMessageThreadOpenAnimation(shell = document.getElementById('dm-fullscreen-shell')) {
  const state = dmThreadOpenAnimationState;
  if (!state || !state.consumed || state.started || state.threadId !== activeDmThreadId) return;
  const panel = shell?.querySelector?.('.dm-v2-panel-entering');
  if (!panel) return;
  state.started = true;
  const duration = DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS;   // 390ms
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
  state.doneAt = performance.now() + duration;
  const token = state.token;

  /* ──────────────────────────────────────────────────────────────────────────
     v11.787 — chat OPEN slide-in: WAAPI, PIXEL offsets, started on the NEXT frame.
     ──────────────────────────────────────────────────────────────────────────
     THE bug behind every prior failed attempt: the panel is BRAND NEW — it was just
     inserted via `shell.innerHTML` in this same synchronous task and has NEVER been
     painted. On iOS WKWebView, calling `element.animate()` (or starting a CSS transition)
     on a never-yet-painted element silently NO-OPS, so the chat "just appeared." The CLOSE
     path animates a panel that has been on screen for a while (already painted), which is
     exactly why close worked and open didn't — same API, same units, different freshness.
     FIX: pin the fresh panel at its OFF-SCREEN start position + force a layout NOW so the
     first painted frame is off-screen, then start the WAAPI on the NEXT animation frame,
     once the panel has actually been painted. Pixels (not vw — WKWebView mis-interpolates
     viewport units in WAAPI). 390ms, 120fps-ready (transform-only, composited). */
  const offRightPx = (window.innerWidth || document.documentElement.clientWidth || 390) + 48;
  panel.style.willChange = 'transform';
  panel.style.backfaceVisibility = 'hidden';
  panel.style.animation = 'none';
  panel.style.transition = 'none';
  panel.style.transform = 'translate3d(' + offRightPx + 'px, 0, 0)';   // start off-screen RIGHT
  void panel.offsetWidth;                                              // force layout of the fresh panel

  let finished = false;
  const finish = () => { if (finished) return; finished = true; finishDirectMessageThreadOpenAnimation(token); };

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    panel.style.transform = 'translate3d(0, 0, 0)';
    finish();
    return;
  }

  /* Next frame: the panel is now painted off-screen → animate it in. */
  requestAnimationFrame(() => {
    if (!panel.isConnected || dmThreadOpenAnimationState?.token !== token) { finish(); return; }
    panel.style.transform = 'translate3d(0, 0, 0)';   // resting state the panel falls back to after the fill
    if (typeof panel.animate === 'function') {
      try {
        const animation = panel.animate(
          [
            { transform: 'translate3d(' + offRightPx + 'px, 0, 0)' },
            { transform: 'translate3d(0, 0, 0)' }
          ],
          { duration, easing, fill: 'both' }
        );
        state.animation = animation;
        animation.onfinish = finish;
        state.timer = window.setTimeout(finish, duration + 120);   // safety if onfinish is dropped (backgrounded mid-slide)
        return;
      } catch (_) { /* fall through to the CSS-transition fallback */ }
    }
    /* Fallback for engines without WAAPI: CSS transition (panel is painted now, so it fires). */
    panel.style.transition = 'none';
    panel.style.transform = 'translate3d(' + offRightPx + 'px, 0, 0)';
    void panel.offsetWidth;
    try { panel.addEventListener('transitionend', event => { if (!event || event.target === panel) finish(); }, { once: true }); } catch (_) {}
    panel.style.transition = `transform ${duration}ms ${easing}`;
    panel.style.transform = 'translate3d(0, 0, 0)';
    state.timer = window.setTimeout(finish, duration + 120);
  });
}

function shouldDeferDirectMessageThreadOpenRender() {
  const state = dmThreadOpenAnimationState;
  if (!state || !state.consumed || state.threadId !== activeDmThreadId) return false;
  const remaining = Math.max(0, (state.doneAt || 0) - performance.now());
  const enteringPanel = document.querySelector('.dm-v2-panel-entering');
  if (!enteringPanel || remaining <= 24) return false;
  state.deferred = true;
  if (!state.deferTimer) {
    state.deferTimer = window.setTimeout(() => {
      if (dmThreadOpenAnimationState && dmThreadOpenAnimationState.token === state.token) {
        finishDirectMessageThreadOpenAnimation(state.token);
      }
    }, remaining + 32);
  }
  return true;
}

function resetDirectMessagesSwipeVisual(page = document.getElementById('direct-messages-page')) {
  if (!page) return;
  page.style.setProperty('--dm-swipe-x', '0px');
  page.style.setProperty('--dm-swipe-opacity', '1');
  page.style.setProperty('--dm-swipe-radius', '0px');
  page.classList.remove('dm-swiping', 'dm-swipe-cancel', 'dm-swipe-closing');
}

function shouldIgnoreDirectMessagesSwipe(target, allowInteractiveEdgeSwipe = false) {
  if (!target || !target.closest) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], .mobile-bottom-nav')) return true;
  if (allowInteractiveEdgeSwipe) return false;
  return !!target.closest('button, a');
}

/* Inbox page slides at FULL opacity with 45px corners (no dim/scale), revealing
   the screen behind it exactly like the music-profile / news-reader swipe. */
function applyDirectMessagesSwipeVisual(page, x) {
  if (!page) return;
  const viewport = Math.max(320, window.innerWidth || 390);
  const nextX = Math.max(0, Math.min(x, viewport + 40));
  page.style.setProperty('--dm-swipe-x', nextX + 'px');
  page.style.setProperty('--dm-swipe-radius', '45px');
  page.style.setProperty('--dm-swipe-opacity', '1');
}

function scheduleDirectMessagesSwipeVisual(page, x) {
  if (directMessagesSwipeState) directMessagesSwipeState.pendingX = x;
  if (directMessagesSwipeRaf) return;
  directMessagesSwipeRaf = requestAnimationFrame(() => {
    directMessagesSwipeRaf = 0;
    applyDirectMessagesSwipeVisual(page, directMessagesSwipeState?.pendingX ?? x);
  });
}

function prepareDirectMessagesThreadSwipe(page, panel, state) {
  if (!page || !panel || !state || state.threadPrepared) return;
  cancelDirectMessageThreadOpenAnimation(page);
  state.threadPrepared = true;
  state.prevPanelTransform = panel.style.transform || '';
  state.prevPanelTransition = panel.style.transition || '';
  state.prevPanelWillChange = panel.style.willChange || '';
  state.prevPanelBorderRadius = panel.style.borderRadius || '';
  state.prevPanelOverflow = panel.style.overflow || '';
  state.prevPanelAnimation = panel.style.animation || '';
  resetDirectMessageKeyboardLift();
  renderDirectMessageSwipeInboxUnderlay(page);
  page.classList.remove('dm-nav-open-thread');
  page.classList.add('dm-thread-swiping');
  panel.style.animation = 'none';
  panel.style.transition = 'none';
  panel.style.willChange = 'transform';
  panel.style.borderRadius = '45px';
  panel.style.overflow = 'hidden';
}

function applyDirectMessagesThreadSwipeVisual(panel, x) {
  if (!panel) return;
  const viewport = Math.max(320, window.innerWidth || 390);
  const nextX = Math.max(0, Math.min(x, viewport + 40));
  panel.style.transform = `translate3d(${nextX}px, 0, 0)`;
  panel.style.opacity = '1';
}

function scheduleDirectMessagesThreadSwipeVisual(panel, x) {
  if (directMessagesSwipeState) directMessagesSwipeState.pendingX = x;
  if (directMessagesSwipeRaf) return;
  directMessagesSwipeRaf = requestAnimationFrame(() => {
    directMessagesSwipeRaf = 0;
    applyDirectMessagesThreadSwipeVisual(panel, directMessagesSwipeState?.pendingX ?? x);
  });
}

/* Inbox page slides off at full opacity with 45px corners (music-profile / reader
   feel), then closes the DM page. */
function finishDirectMessagesSwipeClose(page, state = directMessagesSwipeState) {
  if (!page) return;
  const viewport = Math.max(320, window.innerWidth || 390);
  page.classList.remove('dm-swiping', 'dm-swipe-cancel');
  page.classList.add('dm-swipe-closing');
  page.style.setProperty('--dm-swipe-x', (viewport + 48) + 'px');
  page.style.setProperty('--dm-swipe-radius', '45px');
  page.style.setProperty('--dm-swipe-opacity', '1');
  window.setTimeout(() => {
    closeDirectMessagesPage(true);
    resetDirectMessagesSwipeVisual(page);
  }, 320);
}

function cancelDirectMessagesSwipeClose(page, state = directMessagesSwipeState) {
  if (!page) return;
  page.classList.remove('dm-swiping', 'dm-swipe-closing');
  page.classList.add('dm-swipe-cancel');
  page.style.setProperty('--dm-swipe-x', '0px');
  page.style.setProperty('--dm-swipe-radius', '0px');
  page.style.setProperty('--dm-swipe-opacity', '1');
  window.setTimeout(() => page.classList.remove('dm-swipe-cancel'), 240);
}

function finishDirectMessagesThreadSwipeClose(page, panel, state = directMessagesSwipeState) {
  if (!page || !panel) {
    finalizeDirectMessageThreadClose(page);
    return;
  }
  page.classList.remove('dm-thread-swiping');
  page.classList.add('dm-nav-finalizing-inbox');
  animateDirectMessagePanelOffscreen(panel, () => finalizeDirectMessageThreadClose(page), 320);
}

function cancelDirectMessagesThreadSwipeClose(page, panel, state = directMessagesSwipeState) {
  if (!page || !panel) return;
  panel.style.transition = 'transform 220ms cubic-bezier(0.33, 1, 0.68, 1), border-radius 220ms cubic-bezier(0.33, 1, 0.68, 1)';
  panel.style.transform = 'translate3d(0, 0, 0)';
  panel.style.opacity = '1';
  window.setTimeout(() => {
    if (!panel.isConnected) return;
    page.classList.remove('dm-thread-swiping');
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
    panel.style.transform = state?.prevPanelTransform || '';
    panel.style.transition = state?.prevPanelTransition || '';
    panel.style.willChange = state?.prevPanelWillChange || '';
    panel.style.borderRadius = state?.prevPanelBorderRadius || '';
    panel.style.overflow = state?.prevPanelOverflow || '';
    panel.style.animation = state?.prevPanelAnimation || '';
    panel.style.opacity = '';
  }, 240);
}

function getDirectMessagePanelTransform(panel) {
  if (!panel) return 'translate3d(0, 0, 0)';
  const inline = String(panel.style.transform || '').trim();
  if (inline && inline !== 'none') return inline;
  try {
    const computed = window.getComputedStyle(panel).transform;
    if (!computed || computed === 'none') return 'translate3d(0, 0, 0)';
    const Matrix = window.DOMMatrixReadOnly || window.DOMMatrix || window.WebKitCSSMatrix;
    if (Matrix) {
      const matrix = new Matrix(computed);
      return `translate3d(${matrix.m41 || 0}px, ${matrix.m42 || 0}px, 0)`;
    }
    return computed;
  } catch (_) {
    return 'translate3d(0, 0, 0)';
  }
}

function animateDirectMessagePanelOffscreen(panel, done, duration = 320) {
  if (!panel) {
    if (typeof done === 'function') done();
    return;
  }
  const fromTransform = getDirectMessagePanelTransform(panel);
  const offscreenX = Math.max(window.innerWidth || 390, panel.getBoundingClientRect().width || 0) + 48;
  const toTransform = `translate3d(${offscreenX}px, 0, 0)`;
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { if (animation && animation.playState !== 'finished') animation.cancel(); } catch (_) {}
    if (panel && panel.isConnected) {
      panel.style.transition = 'none';
      panel.style.transform = toTransform;
      panel.style.opacity = '1';
    }
    if (typeof done === 'function') done();
  };
  let animation = null;
  panel.style.animation = 'none';
  panel.style.borderRadius = '45px';
  panel.style.overflow = 'hidden';
  panel.style.willChange = 'transform';
  panel.style.opacity = '1';
  if (typeof panel.animate === 'function') {
    try {
      panel.style.transition = 'none';
      panel.style.transform = fromTransform;
      animation = panel.animate([
        { transform: fromTransform, opacity: 1 },
        { transform: toTransform, opacity: 1 }
      ], { duration, easing, fill: 'forwards' });
      animation.onfinish = finish;
      window.setTimeout(finish, duration + 90);
      return;
    } catch (_) {}
  }
  const onEnd = (event) => {
    if (event && event.target !== panel) return;
    finish();
  };
  try { panel.addEventListener('transitionend', onEnd, { once: true }); } catch (_) {}
  panel.style.transition = `transform ${duration}ms ${easing}, border-radius ${duration}ms ${easing}`;
  panel.style.transform = fromTransform;
  void panel.offsetWidth;
  panel.style.transform = toTransform;
  window.setTimeout(finish, duration + 90);
}

function initDirectMessagesSwipeClose() {
  const page = document.getElementById('direct-messages-page');
  if (!page || page.dataset.swipeCloseReady === 'true') return;
  page.dataset.swipeCloseReady = 'true';
  page.classList.add('dm-swipe-ready');

  page.addEventListener('touchstart', (event) => {
    if (!isDirectMessagesPageOpen() || event.touches.length !== 1) return;
    /* v11.680: a CHAT thread is open → the generic edge-swipe engine
       (31-edge-swipe-back.js) owns that swipe. This handler only closes the
       INBOX page, so bail so the two never fight. */
    const touch = event.touches[0];
    if (touch.clientX > DIRECT_MESSAGES_PAGE_EDGE_SWIPE_PX) return;
    if (shouldIgnoreDirectMessagesSwipe(event.target, true)) return;
    const threadPanel = activeDmThreadId && !activeDmGroupEditThreadId ? page.querySelector('.dm-v2-panel') : null;
    if (threadPanel) return;
    const now = performance.now();
    directMessagesSwipeState = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastT: now,
      startT: now,
      mode: 'page',
      panel: null,
      pendingX: 0,
      swiping: false,
      verticalLocked: false
    };
    event.stopPropagation();
  }, { passive: true });

  page.addEventListener('touchmove', (event) => {
    if (!directMessagesSwipeState || event.touches.length !== 1) return;
    event.stopPropagation();
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
      if (directMessagesSwipeState.mode === 'thread') {
        prepareDirectMessagesThreadSwipe(page, directMessagesSwipeState.panel, directMessagesSwipeState);
      } else {
        page.classList.add('dm-swiping');
      }
    }

    if (directMessagesSwipeState.swiping) {
      event.preventDefault();
      if (directMessagesSwipeState.mode === 'thread') {
        scheduleDirectMessagesThreadSwipeVisual(directMessagesSwipeState.panel, dx);
      } else {
        scheduleDirectMessagesSwipeVisual(page, dx);
      }
    }
  }, { passive: false });

  const endSwipe = (event) => {
    const state = directMessagesSwipeState;
    if (!state) return;
    if (event && event.stopPropagation) event.stopPropagation();
    directMessagesSwipeState = null;
    if (directMessagesSwipeRaf) {
      cancelAnimationFrame(directMessagesSwipeRaf);
      directMessagesSwipeRaf = 0;
    }
    const page = document.getElementById('direct-messages-page');
    if (!state.swiping) return;
    const elapsed = Math.max(1, performance.now() - state.startT);
    const distance = Math.max(0, state.lastX - state.startX);
    const velocity = distance / elapsed;
    /* v11.069: commit threshold aligned to the generic/music-profile swipe
       (80px), with a velocity flick kept as a secondary trigger. */
    const threshold = 80;
    if (state.mode === 'thread') {
      if (distance > threshold || velocity > 0.72) finishDirectMessagesThreadSwipeClose(page, state.panel, state);
      else cancelDirectMessagesThreadSwipeClose(page, state.panel, state);
    } else {
      if (distance > threshold || velocity > 0.72) finishDirectMessagesSwipeClose(page, state);
      else cancelDirectMessagesSwipeClose(page, state);
    }
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

function openDirectMessagesPage(instant = false) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const page = document.getElementById('direct-messages-page');
  if (!page) return;
  page.style.display = 'block';
  resetDirectMessagesSwipeVisual(page);
  resetDirectMessageKeyboardLift();
  initDirectMessagesSwipeClose();
  initDirectMessageKeyboardLift();
  page.setAttribute('aria-hidden', 'false');
  /* v10.782: body-lock prevents iOS WKWebView from drifting the panel
     above the dynamic island when an input is focused. */
  lockBodyForDirectMessagesPage();
  setDirectMessagesBottomChromeHidden(true);
  updateDirectMessagesTopbar();
  pruneEncryptedDirectMessageThreadsForCurrentUser();
  renderDirectMessagesView();
  if (instant) {
    /* v11.783: open the page with NO page-level slide — used when we drill STRAIGHT into a
       thread (notification deep-link, "Message" from a profile). Otherwise the page's own
       translate3d(100%)→0 .34s slide is still in flight when the chat panel starts its 360ms
       slide; because .direct-messages-page is a transformed containing-block for the
       position:fixed .dm-v2-panel, the panel is carried by the page's residual motion AND
       slides itself = a compound double-slide. Snap the page open instantly so ONLY the
       panel slides — identical to the inbox-tap experience. */
    page.style.transition = 'none';
    page.classList.add('open');
    void page.offsetWidth;            // commit the no-transition open before transition is restored
    page.style.transition = '';
    setDirectMessagesBottomChromeHidden(true);
    return;
  }
  requestAnimationFrame(() => {
    setDirectMessagesBottomChromeHidden(true);
    page.classList.add('open');
  });
}

function closeDirectMessagesPage(immediate = false) {
  const page = document.getElementById('direct-messages-page');
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  if (!page) return;
  /* v11.783: FULLY tear down any open CHAT thread when the whole DM page closes. A
     bottom-nav switch routes through switchMainNav → closeDirectMessagesPage(true) even
     while a thread is open; previously that left activeDmThreadId set AND a stale
     .dm-v2-panel mounted in #dm-fullscreen-shell (it survives display:none). The next
     openDirectMessagesPage then rendered that STALE chat instead of the inbox, and a
     subsequent thread open compounded into a visible double slide. Cancelling the open
     animation + clearing activeDmThreadId here guarantees the next open starts from a
     clean inbox (renderDirectMessagesView rebuilds the inbox because activeDmThreadId
     is now ''), so one tap is always exactly one slide. */
  cancelDirectMessageThreadOpenAnimation(page);
  activeDmThreadId = '';
  page.classList.remove('open');
  resetDirectMessagesSwipeVisual(page);
  resetDirectMessageKeyboardLift();
  page.setAttribute('aria-hidden', 'true');
  /* v10.782: restore body scroll position the user had before opening DM. */
  unlockBodyForDirectMessagesPage();
  if (immediate) {
    page.style.display = 'none';
    return;
  }
  window.setTimeout(() => {
    if (!page.classList.contains('open')) page.style.display = 'none';
  }, 360);   /* v11.663: was 260 — match the .34s slide-out so the inbox isn't hidden mid-animation */
}

function openDirectMessageHeaderProfile(uid = '') {
  const targetUid = String(uid || '').trim();
  if (!targetUid) return;
  closeDirectMessagesPage(true);
  setTimeout(() => {
    try { openUserProfile(targetUid); }
    catch (error) {
      console.warn('[dm] open profile from header failed:', error);
      if (typeof showToast === 'function') showToast('Could not open profile');
    }
  }, 0);
}
window.openDirectMessageHeaderProfile = openDirectMessageHeaderProfile;

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
    /* v10.900: per-uid read timestamps. Written by markDirectMessageThreadRead
       when a participant opens the thread and clears their unread state.
       The sender reads `readAtMsByUid[otherUid]` to render the
       "Read {time}" receipt under their last sent message. Old threads
       without this field surface as `{}`; render falls back to
       thread.updatedAtMs so the receipt still renders gracefully. */
    readAtMsByUid: (thread.readAtMsByUid && typeof thread.readAtMsByUid === 'object' && !Array.isArray(thread.readAtMsByUid))
      ? Object.fromEntries(
          Object.entries(thread.readAtMsByUid)
            .filter(([k, v]) => k && Number(v) > 0)
            .map(([k, v]) => [k, Number(v)])
        )
      : {},
    createdAtMs: Number(thread.createdAtMs || Date.now()),
    updatedAtMs: Number(thread.updatedAtMs || thread.lastMessageAtMs || Date.now())
  };
  if (removedEncryptedCount) cleanThread._removedEncryptedMessages = removedEncryptedCount;
  return cleanThread;
}

function getDirectMessageMessageKey(message = {}) {
  const explicitId = String(message?.id || message?.clientId || '').trim();
  if (explicitId) return explicitId;
  return [
    String(message?.fromUid || '').trim(),
    String(Number(message?.createdAtMs || 0)),
    String(message?.text || '').trim(),
    message?.imageData ? 'photo' : '',
    message?.shareMedia?.url || ''
  ].join('|');
}

function getDirectMessageMessageTime(message = {}) {
  return Number(message?.createdAtMs || message?.sentAtMs || message?.updatedAtMs || 0);
}

function mergeDirectMessageMessages(...messageLists) {
  const byKey = new Map();
  messageLists.flat().filter(Boolean).forEach(rawMessage => {
    if (isDirectMessageEncryptedRecord(rawMessage)) return;
    const message = { ...(rawMessage || {}), isEncrypted: false };
    delete message.dmE2ee;
    delete message.encryptedPayload;
    delete message.ciphertext;
    if (message.shareMedia) message.shareMedia = normalizeSharedMediaPayload(message.shareMedia);
    const key = getDirectMessageMessageKey(message);
    if (!key) return;
    const previous = byKey.get(key);
    byKey.set(key, previous ? {
      ...previous,
      ...message,
      text: message.text || previous.text || '',
      imageData: message.imageData || previous.imageData || '',
      imageName: message.imageName || previous.imageName || '',
      shareMedia: message.shareMedia || previous.shareMedia || null
    } : message);
  });
  return [...byKey.values()]
    .sort((a, b) => {
      const timeDelta = getDirectMessageMessageTime(a) - getDirectMessageMessageTime(b);
      if (timeDelta) return timeDelta;
      return getDirectMessageMessageKey(a).localeCompare(getDirectMessageMessageKey(b));
    })
    .slice(-80);
}

function getDirectMessageThreadClock(thread = {}) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const latestMessageMs = messages.reduce((max, message) => Math.max(max, getDirectMessageMessageTime(message)), 0);
  return Math.max(
    Number(thread.updatedAtMs || 0),
    Number(thread.lastMessageAtMs || 0),
    latestMessageMs
  );
}

function mergeDirectMessageThreadState(existingThread = {}, incomingThread = {}) {
  const existing = normalizeDirectMessageThread(existingThread);
  const incoming = normalizeDirectMessageThread(incomingThread);
  if (!existing.id) return incoming;
  if (!incoming.id) return existing;
  const existingClock = getDirectMessageThreadClock(existing);
  const incomingClock = getDirectMessageThreadClock(incoming);
  const newest = incomingClock >= existingClock ? incoming : existing;
  const older = newest === incoming ? existing : incoming;
  const messages = mergeDirectMessageMessages(existing.messages || [], incoming.messages || []);
  const participantUids = [...new Set([
    ...(existing.participantUids || []),
    ...(incoming.participantUids || [])
  ].filter(Boolean))];
  const participants = { ...(older.participants || {}), ...(newest.participants || {}) };
  const lastMessageRecord = messages.length ? messages[messages.length - 1] : null;
  const lastMessageAtMs = Math.max(
    Number(existing.lastMessageAtMs || 0),
    Number(incoming.lastMessageAtMs || 0),
    lastMessageRecord ? getDirectMessageMessageTime(lastMessageRecord) : 0
  );
  return normalizeDirectMessageThread({
    ...older,
    ...newest,
    participantUids,
    participants,
    messages,
    lastMessage: lastMessageRecord
      ? getDirectMessageLastPreviewFromMessages(messages, newest.lastMessage || older.lastMessage || '')
      : (newest.lastMessage || older.lastMessage || ''),
    lastMessageFromUid: lastMessageRecord
      ? (lastMessageRecord.fromUid || newest.lastMessageFromUid || older.lastMessageFromUid || '')
      : (newest.lastMessageFromUid || older.lastMessageFromUid || ''),
    lastMessageAtMs: lastMessageAtMs || newest.lastMessageAtMs || older.lastMessageAtMs || Date.now(),
    unreadUids: Array.isArray(newest.unreadUids) ? newest.unreadUids.filter(Boolean) : [],
    createdAtMs: Math.min(
      Number(existing.createdAtMs || incoming.createdAtMs || Date.now()),
      Number(incoming.createdAtMs || existing.createdAtMs || Date.now())
    ),
    updatedAtMs: Math.max(
      Number(existing.updatedAtMs || 0),
      Number(incoming.updatedAtMs || 0),
      lastMessageAtMs || 0
    ) || Date.now()
  });
}

function mergeDirectMessageThreadIntoState(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  if (!cleanThread.id) return null;
  if (currentUser?.uid && cleanThread.participantUids.length && !cleanThread.participantUids.includes(currentUser.uid)) {
    return dmThreadMap[cleanThread.id] || null;
  }
  const existingThread = dmThreadMap[cleanThread.id];
  const mergedThread = existingThread ? mergeDirectMessageThreadState(existingThread, cleanThread) : cleanThread;
  dmThreadMap[cleanThread.id] = mergedThread;
  if (!dmThreadIds.includes(cleanThread.id)) dmThreadIds.push(cleanThread.id);
  return mergedThread;
}

function mergeDirectMessageThreadCollectionIntoState(threadMap = {}) {
  Object.values(threadMap || {}).forEach(thread => mergeDirectMessageThreadIntoState(thread));
  dmThreadIds = [...new Set([
    ...dmThreadIds,
    ...Object.keys(dmThreadMap || {})
  ])].filter(id => {
    const thread = dmThreadMap[id];
    return !thread || !currentUser?.uid || (thread.participantUids || []).includes(currentUser.uid);
  });
  /* v10.761: refresh device-cached inbox snapshot for instant cold-start
     paint on the next launch. Debounced inside scheduleDmInboxCacheWrite()
     so a burst of snapshot updates becomes a single write. See 09b-dm-inbox-cache.js. */
  if (typeof scheduleDmInboxCacheWrite === 'function') {
    try { scheduleDmInboxCacheWrite(); } catch (e) { /* never block a merge */ }
  }
}

let directMessageEncryptedPruneInFlight = false;
async function pruneEncryptedDirectMessageThreadsForCurrentUser() {
  if (!currentUser || directMessageEncryptedPruneInFlight) return;
  const dirty = Object.values(dmThreadMap || {}).filter(thread => Number(thread?._removedEncryptedMessages || 0) > 0);
  if (!dirty.length) return;
  directMessageEncryptedPruneInFlight = true;
  try {
    /* v10.771: was rewriting cleaned threads back into the legacy
       directMessageThreadMap field on the user doc — but that field is
       the very bloat source we're trying to retire (see setDirectMessageThreadMirror
       v10.771). Now we only update the LOCAL dmThreadMap so the UI
       drops the encrypted records; no server write. The canonical
       dmThreads/{threadId} doc is left untouched (it's where the real
       messages live and the existing record-skipping renderers already
       hide encrypted ones). */
    dirty.forEach(thread => {
      const cleanThread = { ...thread };
      delete cleanThread._removedEncryptedMessages;
      dmThreadMap[cleanThread.id] = cleanThread;
    });
  } catch (error) {
    console.warn('Direct Message encrypted-message local cleanup skipped:', error);
  } finally {
    directMessageEncryptedPruneInFlight = false;
  }
}
async function setDirectMessageThreadMirror(uid = '', thread = {}) {
  /* v10.771: LEGACY USER-DOC MIRROR DISABLED. This used to write the
     full thread (messages array and all) to /users/{uid}.directMessageThreadMap
     as a backward-compat path for clients that didn't yet have the
     v10.739 dmThreads listener. Every client is on v10.762+ now (which
     attaches that listener immediately at sign-in), so the mirror is
     dead weight — every DM was bloating the user doc with KB of message
     history, eventually pushing it past Firestore's 1 MiB per-doc cap
     and breaking ALL user-doc writes (username saves, profile updates,
     etc — the v10.770 1 MiB rescue logs were the smoking gun).
     Kept as a no-op stub so callers don't need restructuring.
     The canonical dmThreads/{threadId} write in mirrorDirectMessageThreadToParticipants
     handles real-time delivery and inbox state for everyone. */
  return;
}

/* v10.739: Write the thread to the SHARED dmThreads/{threadId} collection.
   This is the new canonical store — both participants can read/write because
   they're in participantUids (per the v10.739 Firestore rule). Used by
   mirrorDirectMessageThreadToParticipants as the PRIMARY write so the message
   is actually delivered cross-user. */
async function writeSharedDmThread(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  if (!cleanThread.id) throw new Error('writeSharedDmThread: missing thread id');
  delete cleanThread._removedEncryptedMessages;
  await db.collection('dmThreads').doc(cleanThread.id).set(cleanThread, { merge: true });
}

async function mirrorDirectMessageThreadToParticipants(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  const participants = cleanThread.participantUids.filter(Boolean);
  /* v10.739: PRIMARY write goes to the shared `dmThreads/{id}` doc. Both
     participants can read this in real time (their dmThreads listener fires
     immediately on any change). If this throws, the message did NOT deliver
     — caller's catch reverts the optimistic local state. This is the path
     that actually fixes the "recipient never gets the message" bug.

     The legacy per-user mirror writes below are best-effort during the
     transition (Deploy 1). The sender's OWN doc mirror still needs to land
     so the legacy friendsDataListener continues to surface threads on
     existing clients that haven't loaded the new dmThreads listener yet.
     Recipient mirror writes WILL fail (Firestore rules block cross-user
     writes to users docs — that's the original bug). We catch + swallow
     those expected failures so they don't tear down the shared write.

     Once Deploy 2 cuts reads over to dmThreads exclusively, the legacy
     per-user mirror writes can be removed entirely. */
  await writeSharedDmThread(cleanThread);
  await Promise.all(participants.map(uid =>
    setDirectMessageThreadMirror(uid, cleanThread).catch(error => {
      if (uid === currentUser?.uid) {
        /* self-mirror failure is unexpected — log loudly */
        console.warn('[v10.739] legacy self user-doc mirror failed:', error?.code || error?.message);
      }
      /* recipient mirror failure is EXPECTED under the standard rules.
         Silent swallow — the shared write above already delivered. */
    })
  ));
}

/* v10.739: Real-time listener on the shared dmThreads collection. Fires
   whenever ANY thread the current user participates in is created or
   updated. Populates dmThreadMap so the UI shows new messages instantly
   on the recipient side — finally fixing the "recipient never gets it"
   bug.

   Runs in parallel with the legacy `friendsDataListener` (which reads
   directMessageThreadMap from the user's own doc) during Deploy 1.
   Both can coexist because incoming thread snapshots are merged into
   local state by message id + timestamp instead of replacing the active
   thread. That keeps an optimistic just-sent message visible while the
   shared write and legacy mirror catch up. */
function startDirectMessageSharedThreadsListener() {
  if (!currentUser || typeof db === 'undefined' || !db) return;
  stopDirectMessageSharedThreadsListener();
  try {
    dmSharedThreadsUnsubscribe = db.collection('dmThreads')
      .where('participantUids', 'array-contains', currentUser.uid)
      .onSnapshot(snap => {
        const incoming = {};
        snap.forEach(doc => {
          const raw = doc.data() || {};
          const cleanThread = normalizeDirectMessageThread({ ...raw, id: doc.id });
          if (cleanThread.id && (cleanThread.participantUids || []).includes(currentUser.uid)) {
            incoming[cleanThread.id] = cleanThread;
            dmHydratedThreadIds.add(cleanThread.id);   // v11.776: server-confirmed → genuine empty distinguishable from loading
          }
        });
        mergeDirectMessageThreadCollectionIntoState(incoming);
        try { if (typeof renderDirectMessagesView === 'function') renderDirectMessagesView(); } catch (_) {}
        try { if (typeof updateDirectMessagesBadge === 'function') updateDirectMessagesBadge(); } catch (_) {}
        /* One-shot migration: copy any legacy thread that exists ONLY in
           the user's own doc mirror (and not yet in shared) into the shared
           collection so future writes can update it there. */
        if (!dmSharedThreadsMigrationDone) {
          dmSharedThreadsMigrationDone = true;
          migrateLegacyDirectMessageThreadsToShared(incoming).catch(error => {
            console.warn('[v10.739] legacy DM migration skipped:', error?.code || error?.message);
          });
        }
      }, error => {
        console.warn('[v10.739] dmThreads listener error:', error?.code || error?.message);
        /* If the listener fails (likely because the Firestore rule for
           dmThreads hasn't been published yet), don't throw — the legacy
           friendsDataListener path still surfaces threads from the
           sender's own doc, so the UI degrades gracefully. */
      });
  } catch (error) {
    console.warn('[v10.739] startDirectMessageSharedThreadsListener failed:', error?.code || error?.message);
  }
}

function stopDirectMessageSharedThreadsListener() {
  if (dmSharedThreadsUnsubscribe) {
    try { dmSharedThreadsUnsubscribe(); } catch (_) {}
    dmSharedThreadsUnsubscribe = null;
  }
  dmSharedThreadsMigrationDone = false;
}

/* v10.739: One-shot migration — for users with existing threads on their
   user-doc mirror that aren't yet in the shared dmThreads collection, copy
   them over so subsequent writes (which go to dmThreads as primary) update
   the same doc rather than creating an orphan. Fire-and-forget; per-thread
   failures are swallowed so one bad thread can't block the rest. */
async function migrateLegacyDirectMessageThreadsToShared(sharedSnapshot = {}) {
  if (!currentUser || typeof db === 'undefined' || !db) return;
  const sharedIds = new Set(Object.keys(sharedSnapshot || {}));
  const legacyThreads = Object.values(dmThreadMap || {}).filter(thread =>
    thread
    && thread.id
    && !sharedIds.has(thread.id)
    && Array.isArray(thread.participantUids)
    && thread.participantUids.includes(currentUser.uid)
    /* v11.776: NEVER migrate a message-LESS thread. The inbox cache seeds stubs
       with messages:[] for instant paint; if the listener's first snapshot is
       empty/partial (Firestore can emit a cached-empty snapshot first on a cold
       start), every cached stub would look "legacy" and get written to dmThreads
       as an empty thread — wiping the real messages server-side. Only ever copy
       threads that actually carry content. */
    && Array.isArray(thread.messages) && thread.messages.length > 0
  );
  if (!legacyThreads.length) return;
  let migrated = 0;
  for (const thread of legacyThreads) {
    try {
      await writeSharedDmThread(thread);
      migrated += 1;
    } catch (error) {
      console.warn('[v10.739] migrate thread', thread.id, 'failed:', error?.code || error?.message);
    }
  }
  if (migrated) console.info(`[v10.739] migrated ${migrated} legacy DM threads to dmThreads collection`);
}

if (typeof window !== 'undefined') {
  window.startDirectMessageSharedThreadsListener = startDirectMessageSharedThreadsListener;
  window.stopDirectMessageSharedThreadsListener = stopDirectMessageSharedThreadsListener;
}

async function searchDirectMessageUsers(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const resultsEl = document.getElementById('dm-search-results');
  const suggestedEl = document.getElementById('dm-new-suggested');
  if (!resultsEl) return;
  if (!q) {
    dmSearchResults = [];
    resultsEl.innerHTML = '';
    if (suggestedEl) suggestedEl.style.display = '';
    return;
  }
  if (suggestedEl) suggestedEl.style.display = 'none';
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
  resultsEl.innerHTML = dmSearchResults
    .map(user => dmComposerUserRowHTML(getDirectMessageProfile(user.uid, user)))
    .join('');
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
  requestAnimationFrame(() => {
    const input = document.getElementById('dm-user-search');
    if (!input) return;
    try { input.focus({ preventScroll: true }); }
    catch (_) { input.focus(); }
  });
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

/* v11.389: full-page Instagram-style new-message flow.
     • Direct mode → "New message": back chevron + centered title, a "To: Search"
       field, a "Group chat" entry row, then a "Suggested" people list. (No
       AI-chats row.)
     • Group mode → "New group chat": back chevron + title + Create action, a
       "Group name (optional)" field, a search bar, then the "Suggested" people
       list with circular checkboxes on the right for multi-select.
   The legacy modal renderer above is kept for rollback history; this later
   declaration owns the active UI at runtime. */
function renderDirectMessageComposerPanel() {
  const suggestedHtml = renderDmComposerSuggestedUsers();
  const suggestedBlock = suggestedHtml
    ? `<div class="dm-new-suggested" id="dm-new-suggested"><div class="dm-new-suggested-head">Suggested</div>${suggestedHtml}</div>`
    : `<div class="dm-new-suggested" id="dm-new-suggested"></div>`;

  if (dmNewChatMode === 'group') {
    const selectedProfiles = dmNewChatSelectedUids.map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}));
    return `<div class="dm-new-chat-page dm-new-chat-group" role="dialog" aria-modal="true" aria-label="New group chat">
      <header class="dm-new-chat-topbar">
        <button class="dm-new-chat-back" type="button" onclick="switchDirectMessageComposerMode('direct')" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
        </button>
        <span class="dm-new-chat-title">New group chat</span>
        <button class="dm-new-chat-create" type="button" onclick="createDirectMessageGroupChat()" ${dmNewChatSelectedUids.length ? '' : 'disabled'}>Create</button>
      </header>
      <div class="dm-new-chat-body">
        <input class="dm-group-name-field" id="dm-group-name-input" type="text" maxlength="48" placeholder="Group name (optional)" autocomplete="off" value="${escAttr(dmNewChatGroupName)}" oninput="dmNewChatGroupName=this.value">
        <div class="dm-new-search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="dm-user-search" type="text" placeholder="Search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="onDirectMessageSearchInput(this.value)">
        </div>
        ${selectedProfiles.length ? `<div class="dm-group-selected-list">${selectedProfiles.map(profile => `<button type="button" class="dm-group-selected-chip" onclick="toggleDirectMessageGroupUser('${escAttr(profile.uid)}')"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt=""><span>${renderDisplayNameHTML(profile, 'User')}</span><em aria-hidden="true">&times;</em></button>`).join('')}</div>` : ''}
        <div id="dm-search-results" class="dm-new-search-results"></div>
        ${suggestedBlock}
      </div>
    </div>`;
  }

  return `<div class="dm-new-chat-page dm-new-chat-direct" role="dialog" aria-modal="true" aria-label="New message">
    <header class="dm-new-chat-topbar">
      <button class="dm-new-chat-back" type="button" onclick="closeDirectMessageComposer()" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
      </button>
      <span class="dm-new-chat-title">New message</span>
      <span class="dm-new-chat-topbar-spacer" aria-hidden="true"></span>
    </header>
    <div class="dm-new-chat-body">
      <div class="dm-new-to-row">
        <span class="dm-new-to-label">To:</span>
        <input id="dm-user-search" type="text" placeholder="Search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="onDirectMessageSearchInput(this.value)">
      </div>
      <button class="dm-new-group-entry" type="button" onclick="switchDirectMessageComposerMode('group')">
        <span class="dm-new-group-entry-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
        <span class="dm-new-group-entry-label">Group chat</span>
        <span class="dm-new-group-entry-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </button>
      <div id="dm-search-results" class="dm-new-search-results"></div>
      ${suggestedBlock}
    </div>
  </div>`;
}

/* Suggested people = the user's confirmed friends. Shown by default (before any
   search). Group mode renders the same rows but with a circular checkbox. */
function renderDmComposerSuggestedUsers() {
  const uids = (Array.isArray(friends) ? friends : []).filter(uid => uid && uid !== currentUser?.uid);
  if (!uids.length) return '';
  const rows = uids.map(uid => dmComposerUserRowHTML(getDirectMessageProfile(uid, usersMap[uid] || {}))).join('');
  return `<div class="dm-new-suggested-list">${rows}</div>`;
}

/* One person row, used by both the Suggested list and live search results. */
function dmComposerUserRowHTML(profile = {}) {
  const uid = String(profile.uid || '');
  const username = String(usersMap[uid]?.username || usersMap[uid]?.handle || '').trim();
  const sub = username ? `<span class="dm-new-user-sub">${escHtml(username)}</span>` : '';
  const nameHtml = `<span class="dm-new-user-name">${renderDisplayNameHTML(profile, 'User')}</span>`;
  const avatar = `<img class="dm-new-user-avatar" src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">`;
  if (dmNewChatMode === 'group') {
    const isSelected = dmNewChatSelectedUids.includes(uid);
    const check = isSelected
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
      : '';
    return `<button type="button" class="dm-new-user-row ${isSelected ? 'is-selected' : ''}" onclick="toggleDirectMessageGroupUser('${escAttr(uid)}')">
      ${avatar}
      <span class="dm-new-user-text">${nameHtml}${sub}</span>
      <span class="dm-new-user-check ${isSelected ? 'is-checked' : ''}" aria-hidden="true">${check}</span>
    </button>`;
  }
  const thread = getDirectMessageThreadWithUser(uid);
  const isFriend = isDirectMessageFriend(uid);
  let hint = '';
  if (!thread && !isFriend) {
    const outgoing = getDirectMessageRequestWithUser(uid, 'outgoing');
    const incoming = getDirectMessageRequestWithUser(uid, 'incoming');
    hint = outgoing ? 'Requested' : incoming ? 'Accept' : 'Request';
  }
  const hintHtml = hint ? `<span class="dm-new-user-hint ${hint === 'Requested' ? 'is-muted' : ''}">${hint}</span>` : '';
  return `<button type="button" class="dm-new-user-row" onclick="dmComposerPickUser('${escAttr(uid)}')">
    ${avatar}
    <span class="dm-new-user-text">${nameHtml}${sub}</span>
    ${hintHtml}
  </button>`;
}

/* Direct-mode row tap: open existing thread, message a friend, accept an
   incoming request, or send a new message request. */
function dmComposerPickUser(uid = '') {
  if (!uid) return;
  const thread = getDirectMessageThreadWithUser(uid);
  if (thread) { openDirectMessageThread(thread.id); return; }
  if (isDirectMessageFriend(uid)) { openOrCreateDirectMessageThreadForUser(uid); return; }
  const incoming = getDirectMessageRequestWithUser(uid, 'incoming');
  if (incoming) { acceptDirectMessageRequest(incoming.id); return; }
  const outgoing = getDirectMessageRequestWithUser(uid, 'outgoing');
  if (outgoing) { if (typeof showToast === 'function') showToast('Message request already sent'); return; }
  sendDirectMessageRequest(uid);
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
    if (isDirectMessagesPageOpen()) renderDirectMessagesView();
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
    if (isDirectMessagesPageOpen()) renderDirectMessagesView();
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
        <div class="dm-chat-copy">
          <strong>${renderDisplayNameHTML(profile, 'User')}</strong>
          <div class="dm-chat-line2"><span class="dm-chat-preview">${escHtml(getDirectMessageChatPreviewText(thread))}</span><span class="dm-chat-time">${formatDirectMessageTime(thread.lastMessageAtMs || thread.updatedAtMs)}</span></div>
        </div>
        ${unread ? '<span class="dm-chat-unread-dot" aria-hidden="true"></span>' : ''}
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
  dmGroupEditAddSelectedUids = [];
  dmGroupEditRemovedUids = [];
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  dmGroupEditCropPointers.clear();
  dmGroupEditCropGesture = null;
  renderDirectMessagesView();
}

function closeDirectMessageGroupEdit() {
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  dmGroupEditAddSelectedUids = [];
  dmGroupEditRemovedUids = [];
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  dmGroupEditCropPointers.clear();
  dmGroupEditCropGesture = null;
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
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  [size / 3, (size * 2) / 3].forEach(pos => {
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  ctx.restore();
}

function updateDirectMessageGroupEditCrop(field, value) {
  if (!dmGroupEditCropState) return;
  if (field === 'zoom') dmGroupEditCropState.zoom = clampDirectMessageCropValue(value, 1, 3, 1);
  if (field === 'x') dmGroupEditCropState.x = clampDirectMessageCropValue(value, -100, 100, 0);
  if (field === 'y') dmGroupEditCropState.y = clampDirectMessageCropValue(value, -100, 100, 0);
  renderDirectMessageGroupEditCropCanvas();
}

function getDirectMessagePointerDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
}

function getDirectMessagePointerCenter(a, b) {
  return {
    x: ((a?.x || 0) + (b?.x || 0)) / 2,
    y: ((a?.y || 0) + (b?.y || 0)) / 2
  };
}

function beginDirectMessageGroupEditCropGesture() {
  const points = Array.from(dmGroupEditCropPointers.values());
  const state = dmGroupEditCropState;
  const image = dmGroupEditCropImage;
  const canvas = document.getElementById('dm-group-edit-crop-canvas');
  if (!points.length || !state || !image || !canvas) {
    dmGroupEditCropGesture = null;
    return;
  }
  const size = canvas.width || 260;
  const metrics = getDirectMessageCropDrawMetrics(image, size, state);
  const center = points.length > 1 ? getDirectMessagePointerCenter(points[0], points[1]) : points[0];
  dmGroupEditCropGesture = {
    startX: state.x || 0,
    startY: state.y || 0,
    startZoom: state.zoom || 1,
    startCenter: center,
    startDistance: points.length > 1 ? Math.max(1, getDirectMessagePointerDistance(points[0], points[1])) : 0,
    extraX: Math.max(1, (metrics.drawWidth - size) / 2),
    extraY: Math.max(1, (metrics.drawHeight - size) / 2)
  };
}

function moveDirectMessageGroupEditCropGesture() {
  const state = dmGroupEditCropState;
  const gesture = dmGroupEditCropGesture;
  if (!state || !gesture || !dmGroupEditCropPointers.size) return;
  const points = Array.from(dmGroupEditCropPointers.values());
  const center = points.length > 1 ? getDirectMessagePointerCenter(points[0], points[1]) : points[0];
  if (!center) return;
  if (points.length > 1 && gesture.startDistance) {
    const distance = Math.max(1, getDirectMessagePointerDistance(points[0], points[1]));
    state.zoom = clampDirectMessageCropValue(gesture.startZoom * (distance / gesture.startDistance), 1, 4, 1);
  }
  state.x = clampDirectMessageCropValue(gesture.startX + ((center.x - gesture.startCenter.x) / gesture.extraX) * 100, -100, 100, 0);
  state.y = clampDirectMessageCropValue(gesture.startY + ((center.y - gesture.startCenter.y) / gesture.extraY) * 100, -100, 100, 0);
  renderDirectMessageGroupEditCropCanvas();
}

window.startDirectMessageGroupEditCropPointer = function(event) {
  if (!dmGroupEditCropState) return;
  event.preventDefault();
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
  dmGroupEditCropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  beginDirectMessageGroupEditCropGesture();
};

window.moveDirectMessageGroupEditCropPointer = function(event) {
  if (!dmGroupEditCropPointers.has(event.pointerId)) return;
  event.preventDefault();
  dmGroupEditCropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  moveDirectMessageGroupEditCropGesture();
};

window.endDirectMessageGroupEditCropPointer = function(event) {
  dmGroupEditCropPointers.delete(event.pointerId);
  if (dmGroupEditCropPointers.size) beginDirectMessageGroupEditCropGesture();
  else dmGroupEditCropGesture = null;
};

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
    dmGroupEditCropPointers.clear();
    dmGroupEditCropGesture = null;
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
  dmGroupEditCropPointers.clear();
  dmGroupEditCropGesture = null;
  renderDirectMessagesView();
}

function canEditDirectMessageGroupMembers(thread = {}) {
  if (!currentUser?.uid || !thread) return false;
  const admins = Array.isArray(thread.adminUids) ? thread.adminUids : [];
  return thread.ownerUid === currentUser.uid || admins.includes(currentUser.uid);
}

function getDirectMessageGroupAddableProfiles(thread = {}) {
  const existing = new Set((Array.isArray(thread.participantUids) ? thread.participantUids : []).filter(uid => !dmGroupEditRemovedUids.includes(uid)));
  return (Array.isArray(friends) ? friends : [])
    .filter(uid => uid && uid !== currentUser?.uid && !existing.has(uid))
    .map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}))
    .filter(profile => profile.uid);
}

window.toggleDirectMessageGroupEditAddUser = function(uid = '') {
  const id = String(uid || '').trim();
  if (!id) return;
  if (dmGroupEditAddSelectedUids.includes(id)) {
    dmGroupEditAddSelectedUids = dmGroupEditAddSelectedUids.filter(value => value !== id);
  } else {
    dmGroupEditAddSelectedUids = [...dmGroupEditAddSelectedUids, id];
  }
  renderDirectMessagesView();
};

window.removeDirectMessageGroupEditMember = function(uid = '') {
  const id = String(uid || '').trim();
  const thread = dmThreadMap[activeDmGroupEditThreadId];
  if (!id || !thread || !canEditDirectMessageGroupMembers(thread)) return;
  if (id === currentUser?.uid) {
    showToast('You cannot remove yourself here');
    return;
  }
  const nextUids = (thread.participantUids || []).filter(value => value !== id && !dmGroupEditRemovedUids.includes(value));
  const futureUids = [...new Set([...nextUids, ...dmGroupEditAddSelectedUids].filter(Boolean))];
  if (futureUids.length < 2) {
    showToast('A group needs at least two members');
    return;
  }
  dmGroupEditRemovedUids = [...new Set([...dmGroupEditRemovedUids, id])];
  dmGroupEditAddSelectedUids = dmGroupEditAddSelectedUids.filter(value => value !== id);
  renderDirectMessagesView();
};

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
  const canManageMembers = canEditDirectMessageGroupMembers(thread);
  const removed = canManageMembers ? new Set(dmGroupEditRemovedUids) : new Set();
  const participantUids = [...new Set([
    ...(thread.participantUids || []).filter(uid => !removed.has(uid)),
    ...(canManageMembers ? dmGroupEditAddSelectedUids : [])
  ].filter(Boolean))];
  const participants = { ...(thread.participants || {}) };
  if (!participants[currentUser.uid]) participants[currentUser.uid] = getCurrentUserDirectMessageProfile();
  participantUids.forEach(uid => {
    participants[uid] = getDirectMessageProfile(uid, participants[uid] || usersMap[uid] || {});
  });
  Object.keys(participants).forEach(uid => {
    if (!participantUids.includes(uid)) delete participants[uid];
  });
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    groupName: cleanName,
    groupPhoto: dmGroupEditPhotoData || '',
    participantUids,
    participants,
    adminUids: (thread.adminUids || []).filter(uid => participantUids.includes(uid)),
    unreadUids: [...new Set([...(thread.unreadUids || []), ...(canManageMembers ? dmGroupEditAddSelectedUids : [])].filter(uid => uid && uid !== currentUser.uid))],
    updatedAtMs: Date.now()
  });
  dmThreadMap[threadId] = nextThread;
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  dmGroupEditAddSelectedUids = [];
  dmGroupEditRemovedUids = [];
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
  const canManageMembers = canEditDirectMessageGroupMembers(thread);
  const removed = new Set(dmGroupEditRemovedUids);
  const members = (thread.participantUids || [])
    .filter(uid => uid && !removed.has(uid))
    .map(uid => getDirectMessageProfile(uid, thread.participants?.[uid] || {}))
    .filter(profile => profile.uid);
  const addableProfiles = canManageMembers ? getDirectMessageGroupAddableProfiles(thread) : [];
  const pendingAddProfiles = dmGroupEditAddSelectedUids
    .map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}))
    .filter(profile => profile.uid);
  const cropUi = dmGroupEditCropState?.sourceData ? `<div class="dm-group-edit-crop-panel">
      <div class="dm-group-edit-crop-stage">
        <canvas id="dm-group-edit-crop-canvas" width="300" height="300" aria-label="Crop group photo preview" onpointerdown="startDirectMessageGroupEditCropPointer(event)" onpointermove="moveDirectMessageGroupEditCropPointer(event)" onpointerup="endDirectMessageGroupEditCropPointer(event)" onpointercancel="endDirectMessageGroupEditCropPointer(event)" onpointerleave="endDirectMessageGroupEditCropPointer(event)"></canvas>
      </div>
      <div class="dm-group-edit-crop-actions">
        <button type="button" onclick="cancelDirectMessageGroupEditCrop()">Cancel</button>
        <button type="button" onclick="applyDirectMessageGroupEditCrop()">Use photo</button>
      </div>
    </div>` : '';
  return `<div class="dm-group-edit-page">
    <header class="dm-group-edit-topbar">
      <button class="dm-group-edit-back" type="button" onclick="closeDirectMessageGroupEdit()" aria-label="Back to group chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
      </button>
      <span class="dm-group-edit-title">Edit Group</span>
      <button class="dm-group-edit-save" type="button" onclick="saveDirectMessageGroupEdit('${escAttr(thread.id)}')">Save</button>
    </header>
    <div class="dm-group-edit-body">
      <div class="dm-group-edit-hero">
        <button class="dm-group-edit-photo" type="button" onclick="triggerDirectMessageGroupEditPhotoInput()" aria-label="Change group photo">
          <img src="${escAttr(getDirectMessageAvatar(photoProfile))}" alt="" loading="lazy">
          <span>Change</span>
        </button>
        <input id="dm-group-edit-photo-input" type="file" accept="image/*" style="display:none" onchange="handleDirectMessageGroupEditPhoto(this.files && this.files[0]); this.value='';">
        ${cropUi}
        <div class="dm-group-edit-name-wrap">
          <label for="dm-group-edit-name">Group name</label>
          <input id="dm-group-edit-name" type="text" maxlength="48" autocomplete="off" value="${escAttr(currentName)}" placeholder="Group name">
        </div>
      </div>
      ${canManageMembers ? `<section class="dm-group-edit-add">
        <div class="dm-group-edit-section-title">Add Members <span>${dmGroupEditAddSelectedUids.length}</span></div>
        ${pendingAddProfiles.length ? `<div class="dm-group-edit-pending-adds">${pendingAddProfiles.map(profile => `<button type="button" onclick="toggleDirectMessageGroupEditAddUser('${escAttr(profile.uid)}')"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt=""><span>${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}</span></button>`).join('')}</div>` : ''}
        <div class="dm-group-edit-add-list">
          ${addableProfiles.length ? addableProfiles.map(profile => {
            const selected = dmGroupEditAddSelectedUids.includes(profile.uid);
            return `<button class="dm-group-edit-add-row ${selected ? 'is-selected' : ''}" type="button" onclick="toggleDirectMessageGroupEditAddUser('${escAttr(profile.uid)}')">
              <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
              <span>${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}</span>
              <em>${selected ? 'Added' : 'Add'}</em>
            </button>`;
          }).join('') : '<div class="dm-group-edit-empty">No friends available to add.</div>'}
        </div>
      </section>` : ''}
      <section class="dm-group-edit-members">
        <div class="dm-group-edit-section-title">Members <span>${members.length}</span></div>
        ${members.map(profile => `<div class="dm-group-edit-member">
          <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
          <span>${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}</span>
          ${profile.uid === currentUser?.uid ? '<em>You</em>' : ''}
          ${canManageMembers && profile.uid !== currentUser?.uid ? `<button type="button" onclick="removeDirectMessageGroupEditMember('${escAttr(profile.uid)}')">Remove</button>` : ''}
        </div>`).join('')}
      </section>
    </div>
  </div>`;
}
/* v10.467: Instagram-style DM rebuild.
   - Header: back chevron + avatar + name/handle + 3-dot overflow menu
   - Messages: date dividers between conversational sessions, per-sender
     bubble grouping (avatar only on first incoming in a run), mine
     bubbles in Shelfd lavender, theirs in dark gray, emoji-only renders
     without bubble background, "Seen" indicator under last sent bubble
   - Composer: round purple camera button + pill input + mic + gallery
     icons inside the pill (no separate Send button — Enter or tap-send)
   Critical DOM hooks retained for legacy JS (keyboard lift, photo
   upload, scroll, focus): `.dm-compose-row`, `#dm-message-input`,
   `#dm-message-list`, `#dm-photo-input-{threadId}`. */
/* v11.781: the chat message-list INNER HTML (bubbles + date dividers + per-sender
   grouping + the inline "Read {time}" receipt, or the v11.776 loading-vs-empty
   gate). Pulled out of renderDirectMessageThread so a hydrate/snapshot re-render of
   an ALREADY-OPEN thread can swap ONLY #dm-message-list.innerHTML in place, leaving
   the sliding .dm-v2-panel element untouched. Self-contained (recomputes its own
   read-state) so the patched list and a full panel rebuild are byte-identical. */
function buildDirectMessageListHTML(thread, threadId = activeDmThreadId) {
  if (!thread) return '';
  const isGroup = isDirectMessageGroupThread(thread);
  const otherUid = isGroup ? '' : getDirectMessageOtherUid(thread);
  const myUid = currentUser?.uid || '';
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  /* Identify whether the LAST mine message has been seen by the recipient.
     1:1: the other party has read everything if they're no longer in unreadUids.
     Groups skip the indicator (multi-reader semantics need their own treatment). */
  const otherReadAll = !isGroup && otherUid && !(Array.isArray(thread.unreadUids) ? thread.unreadUids : []).includes(otherUid);
  let lastMineIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].fromUid === myUid) { lastMineIndex = i; break; }
  }
  /* v10.900: the time the recipient actually marked the thread read. Fall back to
     thread.updatedAtMs for legacy threads without the per-uid map. */
  const otherReadAtMs = (otherReadAll && otherUid)
    ? Number((thread.readAtMsByUid || {})[otherUid] || thread.updatedAtMs || 0)
    : 0;
  function formatDmReadReceiptTime(ms) {
    const n = Number(ms || 0);
    if (!n) return '';
    const d = new Date(n);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m}${ampm}`;
  }
  const DM_DIVIDER_GAP_MS = 30 * 60 * 1000;
  const DM_GROUPING_GAP_MS = 5 * 60 * 1000;
  return messages.length ? messages.map((message, idx) => {
    const ts = Number(message.createdAtMs || 0);
    const prev = idx > 0 ? messages[idx - 1] : null;
    const prevTs = prev ? Number(prev.createdAtMs || 0) : 0;
    const showDivider = !prev || (ts - prevTs > DM_DIVIDER_GAP_MS);
    const mine = message.fromUid === myUid;
    const sameSenderAsPrev = prev && prev.fromUid === message.fromUid && (ts - prevTs <= DM_GROUPING_GAP_MS);
    const showAvatar = !mine && (!sameSenderAsPrev || showDivider);
    const senderProfile = !mine
      ? getDirectMessageProfile(message.fromUid || '', thread.participants?.[message.fromUid] || {})
      : null;
    const senderAvatar = senderProfile ? getDirectMessageAvatar(senderProfile) : '';
    const payload = getDirectMessagePlainPayload(message);
    const isEmojiOnly = isDmV2EmojiOnly(payload.text) && !payload.imageData && !payload.shareMedia;
    const content = renderDirectMessagePayloadContent(payload, false);
    const dividerHtml = showDivider
      ? `<div class="dm-v2-day-divider">${escHtml(formatDmV2DayDivider(ts))}</div>`
      : '';
    const senderNameHtml = (isGroup && !mine && (!sameSenderAsPrev || showDivider) && senderProfile)
      ? `<span class="dm-v2-sender-name">${renderDisplayNameHTML(senderProfile, 'User')}</span>`
      : '';
    const readTimeLabel = formatDmReadReceiptTime(otherReadAtMs);
    const seenHtml = (mine && idx === lastMineIndex && otherReadAll && !isGroup)
      ? `<div class="dm-v2-seen">Read${readTimeLabel ? ' ' + escHtml(readTimeLabel) : ''}</div>`
      : '';
    const bubbleClass = `dm-v2-bubble${isEmojiOnly ? ' dm-v2-bubble-emoji' : ''}${sameSenderAsPrev && !showDivider ? ' dm-v2-bubble-grouped' : ''}`;
    const rowClass = `dm-v2-bubble-row ${mine ? 'mine' : 'theirs'}${sameSenderAsPrev && !showDivider ? ' grouped' : ''}`;
    const avatarHtml = showAvatar
      ? `<img class="dm-v2-bubble-avatar" src="${escAttr(senderAvatar)}" alt="" loading="lazy">`
      : (!mine ? '<span class="dm-v2-bubble-avatar dm-v2-bubble-avatar-spacer" aria-hidden="true"></span>' : '');
    return `${dividerHtml}<div class="${rowClass}">${avatarHtml}<div class="dm-v2-bubble-stack">${senderNameHtml}<div class="${bubbleClass}">${content}</div></div></div>${seenHtml}`;
  }).join('') : (dmHydratedThreadIds.has(threadId)
    /* genuinely empty (server-confirmed) → the real empty state */
    ? `<div class="dm-v2-empty">Chat accepted. Send the first message.</div>`
    /* messages not hydrated yet (e.g. opened from a notification before the
       dmThreads doc loaded) → show loading, NOT the empty state. v11.776 */
    : `<div class="dm-v2-loading"><span class="dm-v2-spinner" aria-hidden="true"></span></div>`);
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
  const subtitle = getDirectMessageThreadSubtitle(thread);
  const otherUid = isGroup ? '' : getDirectMessageOtherUid(thread);
  const myUid = currentUser?.uid || '';

  /* v11.781: the message-list BODY is built by buildDirectMessageListHTML so a
     hydrate/snapshot re-render of an already-open thread can patch ONLY
     #dm-message-list in place — never rebuilding the sliding .dm-v2-panel (the
     double-animation root cause). renderDirectMessagesView's patch branch reuses
     the very same builder, so the patched and full-rebuilt list are identical. */
  const messageHtml = buildDirectMessageListHTML(thread, threadId);

  /* Identity button — tapping the avatar/name area opens the profile
     (1:1) or the group-edit page (group). The 3-dot overflow opens a
     small action menu anchored to the button. */
  const identityClick = isGroup
    ? `openDirectMessageGroupEdit('${escAttr(thread.id)}')`
    : (otherUid ? `openDirectMessageHeaderProfile('${escAttr(otherUid)}')` : '');
  const otherBlocked = !!(otherUid && (
    (typeof window.isShelfdUserBlocked === 'function' && window.isShelfdUserBlocked(otherUid)) ||
    (window.shelfdBlockedUids && window.shelfdBlockedUids.has(String(otherUid)))
  ));
  const blockActionLabel = otherBlocked ? 'Unblock user' : 'Block';
  const blockActionClass = otherBlocked ? '' : 'dm-overflow-report';
  const overflowMenuItems = isGroup
    ? `<button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); openDirectMessageGroupEdit('${escAttr(thread.id)}')">Edit group</button>
       <button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); markDirectMessageThreadRead('${escAttr(thread.id)}')">Mark as read</button>`
    : `<button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); ${otherUid ? `openUserProfile('${escAttr(otherUid)}')` : 'showToast(\'No profile available\')'}">View profile</button>
       <button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); markDirectMessageThreadRead('${escAttr(thread.id)}')">Mark as read</button>
       ${otherUid ? `<button type="button" class="dm-overflow-report" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); if(typeof window.openReportSheet==='function') window.openReportSheet('dm_user','${escAttr(otherUid)}','${escAttr(thread.id)}','this user')">Report</button>` : ''}
       ${otherUid ? `<button type="button" class="${blockActionClass}" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); if(typeof window.openBlockUserModal==='function') window.openBlockUserModal('${escAttr(otherUid)}','${escAttr(title)}')">${blockActionLabel}</button>` : ''}`;

  const shouldEnter = consumeDirectMessageThreadOpenAnimation(threadId);
  const enterClass = shouldEnter ? ' dm-v2-panel-entering' : '';
  const enterStyle = shouldEnter ? ' style="transform: translate3d(100vw, 0, 0); transition: none; will-change: transform;"' : '';

  return `<div class="dm-v2-panel${enterClass}" data-dm-thread-id="${escAttr(thread.id)}"${enterStyle}>
    <div class="dm-v2-header">
      <button class="dm-v2-back" type="button" onclick="closeDirectMessageThread()" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="dm-v2-identity" type="button" ${identityClick ? `onclick="${identityClick}"` : ''}>
        <img class="dm-v2-identity-avatar" src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
        <span class="dm-v2-identity-text">
          <span class="dm-v2-identity-name">${escHtml(title)}</span>
          <span class="dm-v2-identity-handle">${escHtml(subtitle)}</span>
        </span>
      </button>
      <div class="dm-v2-overflow-wrap">
        <button class="dm-v2-overflow" type="button" onclick="toggleDmV2OverflowMenu('${escAttr(thread.id)}')" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
        <div class="dm-v2-overflow-menu" id="dm-v2-overflow-menu-${escAttr(thread.id)}" hidden>
          ${overflowMenuItems}
        </div>
      </div>
    </div>
    <div class="dm-v2-list" id="dm-message-list">
      ${messageHtml}
    </div>
    <div class="dm-v2-compose">
      <!-- v10.744: hidden file inputs — photo library, camera capture, any file -->
      <input id="dm-photo-input-${escAttr(thread.id)}" type="file" accept="image/*" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <input id="dm-camera-input-${escAttr(thread.id)}" type="file" accept="image/*" capture="environment" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <input id="dm-file-input-${escAttr(thread.id)}" type="file" accept="*/*" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <!-- + button with attachment menu -->
      <div class="dm-v2-plus-wrap">
        <button class="dm-v2-plus-btn" type="button" aria-label="Attach" onclick="toggleDmV2PlusMenu('${escAttr(thread.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <div class="dm-v2-plus-menu" id="dm-v2-plus-menu-${escAttr(thread.id)}" hidden>
          <button type="button" class="dm-v2-plus-menu-item" onclick="closeDmV2PlusMenu('${escAttr(thread.id)}'); document.getElementById('dm-camera-input-${escAttr(thread.id)}') && document.getElementById('dm-camera-input-${escAttr(thread.id)}').click()">
            <span class="dm-v2-plus-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5l-2 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5l-2-2z"/><circle cx="12" cy="13" r="4"/></svg>
            </span>
            <span>Camera</span>
          </button>
          <button type="button" class="dm-v2-plus-menu-item" onclick="closeDmV2PlusMenu('${escAttr(thread.id)}'); document.getElementById('dm-photo-input-${escAttr(thread.id)}') && document.getElementById('dm-photo-input-${escAttr(thread.id)}').click()">
            <span class="dm-v2-plus-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </span>
            <span>Photos</span>
          </button>
          <button type="button" class="dm-v2-plus-menu-item" onclick="closeDmV2PlusMenu('${escAttr(thread.id)}'); document.getElementById('dm-file-input-${escAttr(thread.id)}') && document.getElementById('dm-file-input-${escAttr(thread.id)}').click()">
            <span class="dm-v2-plus-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </span>
            <span>Files</span>
          </button>
        </div>
      </div>
      <!-- pill input with waveform voice button -->
      <div class="dm-v2-input-pill" onclick="focusDirectMessageComposerInput(event)">
        <input id="dm-message-input" class="dm-v2-input" type="text" placeholder="Message" autocomplete="off" oninput="this.closest('.dm-v2-compose')?.classList.toggle('has-text', !!this.value.trim())" onkeydown="if(event.key==='Enter'){sendDirectMessage('${escAttr(thread.id)}')}">
        <button class="dm-v2-pill-btn dm-v2-voice-btn" type="button" aria-label="Voice message" onclick="triggerDmV2VoiceNote('${escAttr(thread.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="4" y1="10" x2="4" y2="14"/><line x1="7" y1="7" x2="7" y2="17"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="13" y1="5" x2="13" y2="19"/><line x1="16" y1="8" x2="16" y2="16"/><line x1="19" y1="10" x2="19" y2="14"/>
          </svg>
        </button>
      </div>
      <button class="dm-v2-send-btn" type="button" onpointerdown="if(window.matchMedia && window.matchMedia('(max-width: 700px)').matches){event.preventDefault();}" onclick="sendDirectMessage('${escAttr(thread.id)}')" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 11.5L21 3l-8.5 18-2.5-8L3 11.5z"/></svg>
      </button>
    </div>
  </div>`;
}

/* v10.467: DM v2 helpers. Kept colocated with the renderer so the
   message-list HTML and the formatting/menu utilities live in one place. */

/* Date divider format — uppercase, contextual:
     • Same day  → "TODAY AT 3:42 PM"
     • Yesterday → "YESTERDAY AT 9:15 AM"
     • This week → "MON 5:30 AM"
     • Older     → "SEP 30 AT 6:50 AM" */
function formatDmV2DayDivider(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  const d = new Date(n);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  const msSinceMidnight = (now - new Date(now.getFullYear(), now.getMonth(), now.getDate())) + (Date.now() - now.getTime());
  const daysSince = Math.floor((Date.now() - n) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`.toUpperCase();
  if (isYesterday) return `Yesterday at ${time}`.toUpperCase();
  if (daysSince < 7) {
    const day = d.toLocaleDateString([], { weekday: 'short' });
    return `${day} ${time}`.toUpperCase();
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr} at ${time}`.toUpperCase();
}

/* Emoji-only detector — used to drop the bubble background on
   single-emoji or short emoji-string messages so they render large,
   matching the Instagram reference. */
function isDmV2EmojiOnly(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  if (s.length > 16) return false; // very short messages only
  try {
    return /^(?:\s|\p{Emoji_Presentation}|\p{Extended_Pictographic}|️|‍)+$/u.test(s);
  } catch (_) {
    /* Older engines without the \p Unicode property escape — fall back
       to a permissive surrogate-range check. */
    return /^[⌀-➿\uD83C-􏰀-\uDFFF\s]+$/.test(s);
  }
}

/* 3-dot overflow menu — open/close + outside-click dismiss. */
/* v10.815: Override the older emoji detector with a grapheme-aware version
   that handles iOS emoji sequences while rejecting normal text. */
isDmV2EmojiOnly = function(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  if (s.length > 48) return false;
  try {
    const compact = s.replace(/\s+/gu, '');
    const withoutKeycaps = compact.replace(/[0-9#*]\uFE0F?\u20E3/gu, '');
    if (!compact || /[A-Za-z0-9]/.test(withoutKeycaps)) return false;
    const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
    const segments = segmenter
      ? Array.from(segmenter.segment(compact), item => item.segment)
      : Array.from(compact);
    if (!segments.length || segments.length > 6) return false;
    return segments.every(segment => (
      /^[0-9#*]\uFE0F?\u20E3$/u.test(segment) ||
      /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]/u.test(segment)
    ));
  } catch (_) {
    const compact = s.replace(/\s+/g, '');
    const withoutKeycaps = compact.replace(/[0-9#*]\uFE0F?\u20E3/g, '');
    if (!compact || /[A-Za-z0-9]/.test(withoutKeycaps)) return false;
    return /(?:[\u2600-\u27BF]|\uD83C[\uDDE6-\uDDFF\uDF00-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDFFF])/.test(compact);
  }
};

window.openDirectMessagePhotoViewer = function(sourceImage) {
  const img = sourceImage && sourceImage.tagName === 'IMG'
    ? sourceImage
    : (sourceImage && sourceImage.querySelector ? sourceImage.querySelector('img') : null);
  const src = img?.currentSrc || img?.src || '';
  if (!src) return;
  const rect = img.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'dm-photo-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Photo preview');
  overlay.innerHTML = `
    <div class="dm-photo-viewer-backdrop"></div>
    <img class="dm-photo-viewer-image" src="${escAttr(src)}" alt="${escAttr(img.alt || 'Photo message')}" draggable="false">
    <button class="dm-photo-viewer-close" type="button" aria-label="Close photo preview">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  const viewerImage = overlay.querySelector('.dm-photo-viewer-image');
  const closeBtn = overlay.querySelector('.dm-photo-viewer-close');
  const start = {
    x: Math.max(0, rect.left || 0),
    y: Math.max(0, rect.top || 0),
    scaleX: Math.max(0.01, (rect.width || 1) / Math.max(1, window.innerWidth || 1)),
    scaleY: Math.max(0.01, (rect.height || 1) / Math.max(1, window.innerHeight || 1))
  };
  const startTransform = `translate3d(${start.x}px, ${start.y}px, 0) scale(${start.scaleX}, ${start.scaleY})`;
  const finishTransform = 'translate3d(0, 0, 0) scale(1, 1)';
  let closing = false;

  const close = () => {
    if (closing) return;
    closing = true;
    overlay.classList.add('is-closing');
    document.removeEventListener('keydown', onKeyDown);
    if (viewerImage && viewerImage.animate) {
      viewerImage.animate([
        { transform: finishTransform },
        { transform: startTransform }
      ], {
        duration: 260,
        easing: 'cubic-bezier(.32, 0, .67, 0)',
        fill: 'forwards'
      }).onfinish = () => overlay.remove();
    } else {
      overlay.remove();
    }
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  overlay.addEventListener('click', close);
  if (viewerImage) viewerImage.addEventListener('click', event => event.stopPropagation());
  if (closeBtn) closeBtn.addEventListener('click', event => { event.stopPropagation(); close(); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    if (viewerImage && viewerImage.animate) {
      viewerImage.animate([
        { transform: startTransform },
        { transform: finishTransform }
      ], {
        duration: 360,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both'
      });
    }
  });
};

window.toggleDmV2OverflowMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-overflow-menu-' + id);
  if (!menu) return;
  const willOpen = menu.hidden;
  /* Close any other open menus first. */
  document.querySelectorAll('.dm-v2-overflow-menu').forEach(el => { el.hidden = true; });
  menu.hidden = !willOpen;
  if (willOpen) {
    /* One-shot outside-click listener — closes the menu when the user
       taps anywhere else. Captures touch + click for iOS. */
    setTimeout(() => {
      const onDocTap = (event) => {
        if (menu.hidden) return;
        if (event.target && event.target.closest && event.target.closest('.dm-v2-overflow-wrap')) return;
        menu.hidden = true;
        document.removeEventListener('click', onDocTap, true);
        document.removeEventListener('touchstart', onDocTap, true);
      };
      document.addEventListener('click', onDocTap, true);
      document.addEventListener('touchstart', onDocTap, true);
    }, 0);
  }
};
window.closeDmV2OverflowMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-overflow-menu-' + id);
  if (menu) menu.hidden = true;
};

/* v10.744: + attachment menu — open/close + outside-click dismiss. */
function closeDmV2PlusMenuElement(menu) {
  if (!menu || menu.hidden) return;
  menu.classList.remove('is-open');
  window.setTimeout(() => {
    if (!menu.classList.contains('is-open')) menu.hidden = true;
  }, 620);
}
window.toggleDmV2PlusMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-plus-menu-' + id);
  if (!menu) return;
  const willOpen = menu.hidden;
  document.querySelectorAll('.dm-v2-plus-menu').forEach(el => {
    if (el !== menu) closeDmV2PlusMenuElement(el);
  });
  if (willOpen) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    setTimeout(() => {
      const onDocTap = (event) => {
        if (menu.hidden) return;
        if (event.target && event.target.closest && event.target.closest('.dm-v2-plus-wrap')) return;
        closeDmV2PlusMenuElement(menu);
        document.removeEventListener('click', onDocTap, true);
        document.removeEventListener('touchstart', onDocTap, true);
      };
      document.addEventListener('click', onDocTap, true);
      document.addEventListener('touchstart', onDocTap, true);
    }, 0);
  } else {
    closeDmV2PlusMenuElement(menu);
  }
};
window.closeDmV2PlusMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-plus-menu-' + id);
  if (menu) closeDmV2PlusMenuElement(menu);
};

/* v10.485: DM v2 inbox helpers — filter dropdown + inline search filter. */
window.toggleDmV2InboxFilter = function() {
  const menu = document.getElementById('dm-v2-inbox-filter-menu');
  if (!menu) return;
  const willOpen = menu.hidden;
  document.querySelectorAll('.dm-v2-inbox-filter-menu').forEach(el => { el.hidden = true; });
  menu.hidden = !willOpen;
  if (willOpen) {
    setTimeout(() => {
      const onDocTap = (event) => {
        if (menu.hidden) return;
        if (event.target && event.target.closest && event.target.closest('.dm-v2-inbox-filter-wrap')) return;
        menu.hidden = true;
        document.removeEventListener('click', onDocTap, true);
        document.removeEventListener('touchstart', onDocTap, true);
      };
      document.addEventListener('click', onDocTap, true);
      document.addEventListener('touchstart', onDocTap, true);
    }, 0);
  }
};
window.closeDmV2InboxFilter = function() {
  const menu = document.getElementById('dm-v2-inbox-filter-menu');
  if (menu) menu.hidden = true;
};
/* Inline filter — typing in the search pill hides chat rows that don't
   contain the query string. Resets when the query is cleared. */
window.filterDmV2InboxChats = function(query) {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('.dm-v2-inbox-list .dm-chat-swipe-item').forEach(item => {
    if (!q) {
      item.style.display = '';
      return;
    }
    const txt = (item.textContent || '').toLowerCase();
    item.style.display = txt.indexOf(q) !== -1 ? '' : 'none';
  });
};

/* Voice-note placeholder — Shelfd doesn't have voice messages yet.
   The icon exists in the composer (Instagram-parity) but tapping it
   surfaces a toast so the affordance doesn't read as broken. */
window.triggerDmV2VoiceNote = function(threadId) {
  if (typeof window.showToast === 'function') {
    window.showToast('Voice messages coming soon');
  }
};
window.focusDirectMessageComposerInput = function(event) {
  if (event?.target?.closest?.('button')) return;
  const input = document.getElementById('dm-message-input');
  if (!input) return;
  /* v10.782: just focus. visualViewport.resize handles the rest;
     no scroll juggling needed. */
  try { input.focus({ preventScroll: true }); }
  catch (_) { input.focus(); }
};
async function markDirectMessageThreadRead(threadId = '') {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !(thread.unreadUids || []).includes(currentUser.uid)) return;
  /* v10.900: stamp `readAtMsByUid[currentUser.uid] = Date.now()` so the
     other participant can render the "Read {time}" receipt under their
     last sent message. The legacy mirror at setDirectMessageThreadMirror
     is a no-op (per v10.771 comment), so this also adds the canonical
     write to `dmThreads/{threadId}` via writeSharedDmThread — without
     that write, the other participant's listener would never observe
     the read-state change cross-user. */
  const nowMs = Date.now();
  const nextReadAt = { ...(thread.readAtMsByUid || {}), [currentUser.uid]: nowMs };
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    unreadUids: (thread.unreadUids || []).filter(uid => uid !== currentUser.uid),
    readAtMsByUid: nextReadAt,
    updatedAtMs: nowMs
  });
  dmThreadMap[threadId] = nextThread;
  try {
    /* v11.776 ROOT-CAUSE FIX: a read-mark must update ONLY the read-state fields
       — NEVER the `messages` array. The old code did writeSharedDmThread(nextThread),
       i.e. set(WHOLE thread, {merge:true}); because `messages` is an array, merge
       REPLACES it. When a thread was opened from a push notification on a cold
       start, its local copy was a message-LESS inbox-cache STUB (09b caches
       inbox rows without message bodies), so this write wiped the sender's
       message on the server — the recipient saw an empty "Chat accepted" chat
       until they sent a reply (which re-wrote the array). Writing ONLY the read
       fields with merge leaves the messages array untouched on the server. */
    try {
      await db.collection('dmThreads').doc(threadId).set({
        unreadUids: (thread.unreadUids || []).filter(uid => uid !== currentUser.uid),
        readAtMsByUid: nextReadAt,
        updatedAtMs: nowMs
      }, { merge: true });
    }
    catch (err) { console.warn('Shared DM read-mark write failed:', err && err.message ? err.message : err); }
    /* Legacy per-user mirror (currently a no-op stub, kept for safety). */
    await setDirectMessageThreadMirror(currentUser.uid, nextThread);
    updateDirectMessagesBadge();
  } catch (error) {
    console.warn('Direct Message read marker failed:', error);
  }
}

/* v11.776: pull the canonical dmThreads/{id} doc the moment a thread is opened.
   The inbox CACHE seeds message-LESS stubs for instant cold-start paint, and the
   global listener can be ~seconds behind on a push-notification cold start — so
   without this, opening from a notification shows an empty chat until the listener
   catches up. This fetch hydrates the real messages immediately, marks the thread
   server-confirmed (so the loading state can give way to either messages or a true
   empty state), and re-renders the open thread. Messages merge by id (union), so
   it never drops an optimistic just-sent message. */
function ensureDirectMessageThreadHydrated(threadId = '') {
  const id = String(threadId || '').trim();
  if (!id || typeof db === 'undefined' || !db || !currentUser) return;
  db.collection('dmThreads').doc(id).get().then(snap => {
    if (snap && snap.exists) {
      const incoming = normalizeDirectMessageThread({ ...(snap.data() || {}), id: snap.id });
      if ((incoming.participantUids || []).includes(currentUser.uid)) {
        mergeDirectMessageThreadIntoState(incoming);
      }
    }
    /* Only let the loading state resolve to the EMPTY state on a fresh SERVER
       read. A `fromCache` read (offline persistence) may be the stale/empty copy
       — keep showing loading and let the global listener deliver the real data. */
    const fromCache = !!(snap && snap.metadata && snap.metadata.fromCache);
    if (!fromCache) dmHydratedThreadIds.add(id);
    if (activeDmThreadId === id && isDirectMessagesPageOpen()) {
      try { renderDirectMessagesView(); } catch (_) {}
    }
  }).catch(() => { /* leave to the global listener (it also marks hydrated) */ });
}

function openDirectMessageThread(threadId = '') {
  if (!threadId || !dmThreadMap[threadId]) return;
  /* v11.781 TRANSITION LOCK: ignore a duplicate open of the thread that is already
     open/opening. A rapid double-tap (or a notification re-fire for the visible
     chat) must NOT cancel + restart the in-flight slide — that interruption was a
     secondary way the open "animated twice". One tap = one open; if this thread's
     panel already exists, the tap is a clean no-op (the first slide finishes). */
  if (threadId === activeDmThreadId && !activeDmGroupEditThreadId) {
    const openPage = document.getElementById('direct-messages-page');
    const livePanel = openPage ? openPage.querySelector('.dm-v2-panel') : null;
    if (livePanel && livePanel.dataset.dmThreadId === threadId) return;
  }
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  activeMessagesSubTab = 'chats';
  const page = document.getElementById('direct-messages-page');
  beginDirectMessageThreadOpenAnimation(threadId, page);
  if (page) {
    page.classList.add('dm-nav-open-thread');   // chat slides in from the right over a static inbox underlay
  }
  activeDmThreadId = threadId;
  beginDirectMessageInitialBottomAnchor(threadId);
  renderDirectMessagesView();
  ensureDirectMessageThreadHydrated(threadId);   // v11.776: load real messages immediately (esp. from a notification cold start)
  markDirectMessageThreadRead(threadId);
  stabilizeDirectMessageInitialBottomAnchor();
  persistUiState();
}

/* v11.680: tap-back close. Slides the .dm-v2-panel off to the right over a STATIC
   inbox underlay — the EXACT same motion the edge-swipe engine produces (320ms
   cubic-bezier(0.22,1,0.36,1), 45px corners), so tap-back and swipe-back are
   visually identical, just like the news reader. No more --dm-thread-swipe-x CSS
   variable, no inbox parallax, no cascading !important transform rules. */
function closeDirectMessageThread(options = {}) {
  const animate = options !== false && options?.animate !== false;
  const page = document.getElementById('direct-messages-page');
  const panel = page ? page.querySelector('.dm-v2-panel') : null;
  if (animate && page && panel && activeDmThreadId) {
    cancelDirectMessageThreadOpenAnimation(page);
    resetDirectMessageKeyboardLift();
    renderDirectMessageSwipeInboxUnderlay(page);   // static inbox revealed behind
    page.classList.remove('dm-nav-open-thread');
    page.classList.add('dm-nav-finalizing-inbox');
    /* v11.785: tap-back slides the panel back off to the right — the exact REVERSE of the
       390ms WAAPI open slide (animateDirectMessagePanelOffscreen is already WAAPI). */
    animateDirectMessagePanelOffscreen(panel, () => finalizeDirectMessageThreadClose(page), DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS);
    return;
  }
  finalizeDirectMessageThreadClose(page);
}

/* Settle the page to the inbox after the chat panel has slid off (or instantly).
   Shared by tap-back, the edge-swipe engine (window.shelfdDmFinishSwipeBack), and
   programmatic closes. Renders the real inbox FIRST, then removes the transient
   underlay, so there is never a blank frame. */
function finalizeDirectMessageThreadClose(page = document.getElementById('direct-messages-page')) {
  cancelDirectMessageThreadOpenAnimation(page);
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  activeDmThreadId = '';
  resetDirectMessageKeyboardLift();
  renderDirectMessagesView();
  if (page) {
    page.classList.remove('dm-nav-open-thread', 'dm-nav-finalizing-inbox', 'dm-thread-swiping');
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
  }
  persistUiState();
}

/* v11.680: hooks the generic edge-swipe engine (31-edge-swipe-back.js) calls so the
   DM chat thread swipes back with the identical animation to the news reader. */
if (typeof window !== 'undefined') {
  window.shelfdDmRenderSwipeUnderlay = function () {
    const page = document.getElementById('direct-messages-page');
    if (page) {
      cancelDirectMessageThreadOpenAnimation(page);
      resetDirectMessageKeyboardLift();
      page.classList.remove('dm-nav-open-thread');
      page.classList.add('dm-thread-swiping');
      renderDirectMessageSwipeInboxUnderlay(page);
    }
  };
  window.shelfdDmFinishSwipeBack = function () {
    finalizeDirectMessageThreadClose(document.getElementById('direct-messages-page'));
  };
}

/* ────────────────────────────────────────────────────────────────────────
   v10.776 — Push-notification → DM thread deep-link router.
   ────────────────────────────────────────────────────────────────────────
   When a user taps a DM push notification (iOS APNs), the Capacitor
   pushNotificationActionPerformed handler in 33-push-notifications.js
   calls this function with the threadId pulled out of the notification
   payload. We open the DM inbox page then drill into the specific
   thread. Lives here (not in 33-push-notifications.js) because the
   thread-lookup needs `dmThreadMap`, which is declared `let` at the
   top of this file — it's not on window, so cross-file access requires
   a wrapper defined in the same scope.

   Cold-launch race: when a user taps a notification from the lock
   screen, the app boots fresh. Auth and dmThreads listener take
   ~300-600ms to settle (faster on warm cache). If we tried to open
   immediately, dmThreadMap[threadId] would still be empty and
   openDirectMessageThread would no-op (see line 2393 early-return).
   Solution: poll for up to 8 seconds at 200ms intervals, opening the
   moment the data lands. After the timeout, fall back to just opening
   the inbox so the user lands somewhere useful instead of staring at
   their default tab. */
function routePushNotificationToDmThread(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const start = Date.now();
  const MAX_WAIT_MS = 8000;
  const POLL_MS = 200;
  const attempt = () => {
    const authReady = !!(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
    const threadReady = !!(dmThreadMap && dmThreadMap[id]);
    if (authReady && threadReady) {
      /* v11.783/786: SINGLE ATOMIC OPEN — open the page WITHOUT its slide (no compound
         page+panel double-slide, no 140ms stagger) then drill into the thread so ONLY the
         chat panel slides (WAAPI-with-pixels, animates regardless of paint timing).
         activeDmThreadId reset first so the inbox renders clean underneath the sliding panel. */
      try {
        activeDmThreadId = '';
        if (typeof openDirectMessagesPage === 'function') openDirectMessagesPage(true);
        if (typeof openDirectMessageThread === 'function') openDirectMessageThread(id);
      } catch (e) { console.warn('[v11.786] DM notification open failed:', e); }
      return;
    }
    if (Date.now() - start < MAX_WAIT_MS) {
      setTimeout(attempt, POLL_MS);
      return;
    }
    /* Timed out waiting for data — at least drop the user on the
       DM inbox so the tap isn't a complete no-op. */
    if (authReady && typeof openDirectMessagesPage === 'function') {
      try { openDirectMessagesPage(); } catch (e) {}
    }
  };
  attempt();
}
if (typeof window !== 'undefined') {
  window.routePushNotificationToDmThread = routePushNotificationToDmThread;
}

function renderDirectMessagesInboxShell() {
  const requestCount = dmIncomingRequestIds.length;
  const body = activeMessagesSubTab === 'requests' ? renderDirectMessageRequests() : renderDirectMessageChats();
  const myProfile = (typeof userProfile === 'object' && userProfile) ? userProfile : {};
  const myAvatar = currentUser?.photoURL || myProfile.photo || myProfile.photoURL
    || `/default-avatar.svg#${encodeURIComponent(currentUser?.displayName || myProfile.name || 'Me')}&background=1e2028&color=a78bfa`;
  const filterLabel = activeMessagesSubTab === 'requests'
    ? (requestCount ? `Requests (${requestCount})` : 'Requests')
    : 'All';
  return `<div class="dm-v2-inbox">
    <div class="dm-v2-inbox-header">
      <button class="dm-v2-inbox-back" type="button" onclick="closeDirectMessagesPage()" aria-label="Close messages">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="dm-v2-inbox-title">Chat</h1>
      <div class="dm-v2-inbox-filter-wrap">
        <button class="dm-v2-inbox-filter" type="button" onclick="toggleDmV2InboxFilter()" aria-haspopup="true">
          <span>${escHtml(filterLabel)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="dm-v2-inbox-filter-menu" id="dm-v2-inbox-filter-menu" hidden>
          <button type="button" onclick="switchMessagesSubTab('chats');closeDmV2InboxFilter()">All chats</button>
          <button type="button" onclick="switchMessagesSubTab('requests');closeDmV2InboxFilter()">Requests${requestCount ? ` (${requestCount})` : ''}</button>
        </div>
      </div>
    </div>
    <div class="dm-v2-inbox-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/>
        <path d="m21 21-4.3-4.3"/>
      </svg>
      <input type="text" placeholder="Search" autocomplete="off" oninput="filterDmV2InboxChats(this.value)">
    </div>
    ${dmNewChatOpen ? renderDirectMessageComposerPanel() : ''}
    <div class="dm-v2-inbox-list">${body}</div>
    <button class="dm-v2-inbox-fab" type="button" onclick="openDirectMessageComposer('direct')" aria-label="New chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        <line x1="12" y1="9" x2="12" y2="14"/>
        <line x1="9.5" y1="11.5" x2="14.5" y2="11.5"/>
      </svg>
    </button>
  </div>`;
}

function renderDirectMessageSwipeInboxUnderlay(page = document.getElementById('direct-messages-page')) {
  if (!page || !currentUser) return null;
  page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
  const underlay = document.createElement('div');
  underlay.className = 'dm-thread-swipe-underlay';
  underlay.setAttribute('aria-hidden', 'true');
  underlay.innerHTML = renderDirectMessagesInboxShell();
  page.appendChild(underlay);
  return underlay;
}
/* v10.840: removed window exposure — the generic edge-swipe-back system
   no longer drives DM thread swipes. The custom system in this file
   calls renderDirectMessageSwipeInboxUnderlay directly. */

async function sendDirectMessage(threadId = '') {
  const input = document.getElementById('dm-message-input');
  const text = String(input?.value || '').trim();
  const thread = dmThreadMap[threadId];
  if (!text || !currentUser || !thread) return;
  /* v10.782: iMessage behavior — clear the input but DON'T blur. The
     keyboard stays up so the user can immediately type another message.
     They dismiss it themselves by swiping the message list down (see
     swipe-dismiss handler in initDirectMessageKeyboardLift). */
  if (input) input.value = '';
  const sent = await appendDirectMessageToThread(threadId, text, null);
  if (!sent && input) {
    /* Send failed — restore the text so the user can retry. */
    input.value = text;
    return;
  }
  /* One scroll-to-bottom (next frame, after the new message renders)
     so the user immediately sees what they sent. No chains, no settle
     times — the message list naturally stays at the bottom because
     it WAS at the bottom (user just typed and sent). */
  requestAnimationFrame(scrollDirectMessageListToBottom);
}

function renderDirectMessagesView() {
  const fullscreenShell = document.getElementById('dm-fullscreen-shell');
  if (!isDirectMessagesPageOpen() || !fullscreenShell) return;
  if (shouldDeferDirectMessageThreadOpenRender()) return;
  const shells = [fullscreenShell];
  /* v10.778: PRESERVE COMPOSER STATE across full-DOM re-renders.
     Every snapshot from the dmThreads listener triggers this function,
     which does `shell.innerHTML = html` further down — that wholesale
     swap destroys the live #dm-message-input element. If the user is
     mid-typing when a message from the other party arrives, their
     in-progress text is thrown away with the old DOM. Capture the
     uncommitted value + caret position + focus state here, restore
     after the swap. */
  const oldComposerInput = document.getElementById('dm-message-input');
  const composerPreserve = oldComposerInput ? {
    value: oldComposerInput.value || '',
    selStart: typeof oldComposerInput.selectionStart === 'number' ? oldComposerInput.selectionStart : null,
    selEnd: typeof oldComposerInput.selectionEnd === 'number' ? oldComposerInput.selectionEnd : null,
    hadFocus: document.activeElement === oldComposerInput
  } : null;
  /* v10.780: PRESERVE LIST SCROLL POSITION across re-renders. Without
     this, every snapshot makes the message list briefly flash to
     scrollTop=0 (the default for a freshly-rebuilt DOM) before the
     subsequent rAF scrolls it back to scrollHeight. When the local
     optimistic write AND the server confirmation both fire snapshots
     in quick succession, the user sees the list "scroll up" then
     "slowly settle back down" — exactly the bug they reported.
     Fix: capture whether the user was pinned to the bottom (or close
     to it), then in the post-swap path force scrollTop = scrollHeight
     SYNCHRONOUSLY (no rAF wait) so no intermediate frame ever shows
     the top of the list. */
  const oldList = document.getElementById('dm-message-list');
  const listPreserve = oldList ? {
    wasPinnedBottom: (oldList.scrollHeight - oldList.clientHeight - oldList.scrollTop) <= 40,
    prevScrollTop: oldList.scrollTop || 0
  } : null;
  let html = '';
  if (!currentUser) {
    html = `<div class="dm-empty-card"><strong>Sign in required</strong><span>Direct Messages will appear here.</span></div>`;
    shells.forEach(shell => { shell.innerHTML = html; });
    return;
  }
  updateDirectMessagesBadge();
  const requestCount = dmIncomingRequestIds.length;
  const unreadCount = getUnreadDirectMessageThreadCount();

  /* ──────────────────────────────────────────────────────────────────────────
     v11.781 DOUBLE-ANIMATION ROOT FIX — PATCH-IN-PLACE for an already-open thread.
     ──────────────────────────────────────────────────────────────────────────
     The chat slide-in is a transform tween on .dm-v2-panel. The bug: a re-render
     fired by message hydration (ensureDirectMessageThreadHydrated → .get().then),
     the dmThreads onSnapshot listener, or the read-marker write would reach the
     `shell.innerHTML = html` swap below WHILE the panel was still sliding — which
     DESTROYS+RECREATES the animating panel. Because consume() is one-shot, the
     rebuilt panel carries NO entering transform and paints instantly at x=0 → a
     position SNAP the user reads as the chat "opening twice" ~200-400ms in, exactly
     when messages appear. The old consumed/deferred/token guard only narrowed the
     race; it still leaks at the rAF-delay band and when a late finish() has nulled
     state mid-paint.
     FIX: when the active thread's panel ALREADY exists, update ONLY its
     #dm-message-list (and header identity) in place. The .dm-v2-panel element — and
     its in-flight slide — is never recreated, so NO re-render timing can restart or
     snap the animation. The FIRST open render has no panel yet (shell holds the
     inbox) → it falls through to the full build that slides the new panel in. Close
     (activeDmThreadId === ''), group-edit, and the inbox all fall through too. */
  if (activeDmThreadId && !activeDmGroupEditThreadId) {
    const existingPanel = fullscreenShell.querySelector('.dm-v2-panel');
    /* ──────────────────────────────────────────────────────────────────────────
       v11.783 STRUCTURAL INVARIANT — the panel for the ACTIVE thread, once mounted,
       is NEVER destroyed + rebuilt. If a .dm-v2-panel for activeDmThreadId already
       exists we patch ONLY its #dm-message-list + header IN PLACE and ALWAYS return,
       so NO re-render (the dmThreads onSnapshot listener, the ensureDirectMessageThread
       Hydrated .get() echo, the read-marker write echo, or the deferred render fired at
       slide-finish) can EVER reach the `shell.innerHTML = html` swap below and snap the
       sliding panel.

       Why this finally fixes the "opens twice / snaps 200-400ms in" that survived
       v11.781: the prior guard gated this early-return on `existingList && liveThread`
       being truthy. If either was transiently falsy (e.g. the active thread momentarily
       absent from dmThreadMap mid-merge, or the list not yet queryable) the render fell
       THROUGH to the full rebuild — and because consumeDirectMessageThreadOpenAnimation()
       is one-shot, the rebuilt panel carried no entering transform and painted at x=0 =
       the visible second animation. The return is now UNCONDITIONAL on the dataset match:
       the sliding element is preserved no matter what; if the data is mid-merge we just
       leave the current content untouched and a later render patches it. One open =
       exactly one panel build = exactly one slide, as a structural fact, not a timing race.
       (The `!activeDmGroupEditThreadId` guard keeps the group-edit page on the full build;
       close/inbox have activeDmThreadId === '' so they never enter this block.) */
    if (existingPanel && existingPanel.dataset.dmThreadId === activeDmThreadId) {
      const existingList = existingPanel.querySelector('#dm-message-list');
      const liveThread = dmThreadMap[activeDmThreadId];
      if (existingList && liveThread) {
        updateDirectMessagesTopbar();
        /* patch the panel header identity in place (profile may hydrate after open) */
        const liveProfile = getDirectMessageThreadProfile(liveThread);
        const headerName = existingPanel.querySelector('.dm-v2-identity-name');
        const headerHandle = existingPanel.querySelector('.dm-v2-identity-handle');
        const headerAvatar = existingPanel.querySelector('.dm-v2-identity-avatar');
        if (headerName) headerName.textContent = getDirectMessageThreadTitle(liveThread);
        if (headerHandle) headerHandle.textContent = getDirectMessageThreadSubtitle(liveThread);
        if (headerAvatar) headerAvatar.src = getDirectMessageAvatar(liveProfile);
        /* swap ONLY the message body — the live #dm-message-input + the sliding
           panel are untouched, so composer text/caret/focus survive automatically. */
        existingList.innerHTML = buildDirectMessageListHTML(liveThread, activeDmThreadId);
        const stillAnchoring = !!(dmInitialBottomAnchor && activeDmThreadId === dmInitialBottomAnchor.threadId);
        if (stillAnchoring) {
          anchorDirectMessageInitialOpenToBottom();
          stabilizeDirectMessageInitialBottomAnchor();
        } else if (!listPreserve || listPreserve.wasPinnedBottom) {
          existingList.scrollTop = existingList.scrollHeight;   // instant (scroll-behavior:auto) — no top-flash, no glide
          requestAnimationFrame(() => {
            const l = document.getElementById('dm-message-list');
            if (l) l.scrollTop = l.scrollHeight;
          });
        }
      }
      return;   // panel + its in-flight slide preserved — ALWAYS (the structural invariant)
    }
  }

  if (activeDmGroupEditThreadId) {
    html = renderDirectMessageGroupEditPage(activeDmGroupEditThreadId);
  } else if (activeDmThreadId) {
    html = renderDirectMessageThread(activeDmThreadId);
  } else {
    /* v10.485: Instagram-style inbox rebuild.
       Header: own avatar (left) + "Chat" title (center) + filter pill (right).
       Search pill below the header for filtering the chat list inline.
       Flat chat rows (avatar + name + last-message preview + timestamp).
       Floating lavender FAB bottom-right for starting a new chat.
       The All ▼ filter toggles between the existing chats / requests
       subtabs, preserving all existing functionality. */
    const body = activeMessagesSubTab === 'requests' ? renderDirectMessageRequests() : renderDirectMessageChats();
    const myProfile = (typeof userProfile === 'object' && userProfile) ? userProfile : {};
    const myAvatar = currentUser.photoURL || myProfile.photo || myProfile.photoURL
      || `/default-avatar.svg#${encodeURIComponent(currentUser.displayName || myProfile.name || 'Me')}&background=1e2028&color=a78bfa`;
    const filterLabel = activeMessagesSubTab === 'requests'
      ? (requestCount ? `Requests (${requestCount})` : 'Requests')
      : 'All';
    html = `<div class="dm-v2-inbox">
      <div class="dm-v2-inbox-header">
        <button class="dm-v2-inbox-back" type="button" onclick="closeDirectMessagesPage()" aria-label="Close messages">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 class="dm-v2-inbox-title">Chat</h1>
        <div class="dm-v2-inbox-filter-wrap">
          <button class="dm-v2-inbox-filter" type="button" onclick="toggleDmV2InboxFilter()" aria-haspopup="true">
            <span>${escHtml(filterLabel)}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="dm-v2-inbox-filter-menu" id="dm-v2-inbox-filter-menu" hidden>
            <button type="button" onclick="switchMessagesSubTab('chats');closeDmV2InboxFilter()">All chats</button>
            <button type="button" onclick="switchMessagesSubTab('requests');closeDmV2InboxFilter()">Requests${requestCount ? ` (${requestCount})` : ''}</button>
          </div>
        </div>
      </div>
      <div class="dm-v2-inbox-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <path d="m21 21-4.3-4.3"/>
        </svg>
        <input type="text" placeholder="Search" autocomplete="off" oninput="filterDmV2InboxChats(this.value)">
      </div>
      ${dmNewChatOpen ? renderDirectMessageComposerPanel() : ''}
      <div class="dm-v2-inbox-list">${body}</div>
      <button class="dm-v2-inbox-fab" type="button" onclick="openDirectMessageComposer('direct')" aria-label="New chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          <line x1="12" y1="9" x2="12" y2="14"/>
          <line x1="9.5" y1="11.5" x2="14.5" y2="11.5"/>
        </svg>
      </button>
    </div>`;
  }

  updateDirectMessagesTopbar();
  shells.forEach(shell => {
    shell.classList.toggle('dm-thread-active', !!activeDmThreadId || !!activeDmGroupEditThreadId);
    shell.classList.toggle('dm-group-edit-active', !!activeDmGroupEditThreadId);
    shell.innerHTML = html;
  });
  const shouldInitialAnchor = !!(dmInitialBottomAnchor && activeDmThreadId === dmInitialBottomAnchor.threadId);
  if (shouldInitialAnchor) {
    anchorDirectMessageInitialOpenToBottom();
  }
  /* v10.780: SYNCHRONOUSLY restore list scroll position immediately after
     innerHTML swap — before any paint frame can show the list at the
     top. Combined with the rAF scroll below, this eliminates the
     "scroll up then crawl down" flash on every snapshot re-render. */
  if (!shouldInitialAnchor && listPreserve && listPreserve.wasPinnedBottom) {
    document.querySelectorAll('#dm-message-list').forEach(list => {
      list.scrollTop = list.scrollHeight;
    });
  }
  /* v10.778: restore composer state captured before the innerHTML swap.
     Without this, an incoming message wipes any text the user was in the
     middle of typing — the old <input> element is replaced by a fresh
     empty one. We rebuild value, caret, and focus on the new input so
     typing continues seamlessly. Only restore if the user actually had
     text or focus; an empty input doesn't need the cycle. */
  if (composerPreserve && (composerPreserve.value || composerPreserve.hadFocus)) {
    const newComposerInput = document.getElementById('dm-message-input');
    if (newComposerInput) {
      if (composerPreserve.value) {
        newComposerInput.value = composerPreserve.value;
        const composeWrap = newComposerInput.closest('.dm-v2-compose');
        if (composeWrap) {
          composeWrap.classList.toggle('has-text', !!composerPreserve.value.trim());
        }
      }
      if (composerPreserve.hadFocus) {
        try { newComposerInput.focus({ preventScroll: true }); }
        catch (_) { try { newComposerInput.focus(); } catch (__) {} }
        if (composerPreserve.selStart !== null && composerPreserve.selEnd !== null) {
          try { newComposerInput.setSelectionRange(composerPreserve.selStart, composerPreserve.selEnd); }
          catch (_) {}
        }
      }
    }
  }
  if (dmGroupEditCropState?.sourceData) {
    primeDirectMessageGroupEditCropImage(dmGroupEditCropState.sourceData);
  }
  /* v10.782: simplified — one rAF to pin scroll-to-bottom. The
     listPreserve.wasPinnedBottom check (captured BEFORE the swap) +
     the sync scrollTop set immediately after innerHTML mean we never
     flash through scrollTop=0. The rAF handles the case where a
     newly-rendered image bumps scrollHeight after first paint. */
  if (shouldInitialAnchor) {
    stabilizeDirectMessageInitialBottomAnchor();
  } else if ((!listPreserve || listPreserve.wasPinnedBottom)
             && (DM_OPEN_BOTTOM_ANCHOR_ENABLED || !fullscreenShell.querySelector('.dm-v2-panel-entering'))) {
    /* v11.788 DIAGNOSTIC: while the open slide is in flight (an entering panel exists) and the
       bottom-anchor is disabled, skip the open-time scroll-to-bottom too, so NO scroll-forcing
       runs during the slide. New-message re-renders (no entering panel) still scroll normally. */
    requestAnimationFrame(() => {
      document.querySelectorAll('#dm-message-list').forEach(list => {
        list.scrollTop = list.scrollHeight;
      });
    });
  }
  startDirectMessageThreadOpenAnimation(fullscreenShell);
}


function openDirectMessageFromUser(uid = '') {
  if (!uid || uid === currentUser?.uid) return;
  const thread = getDirectMessageThreadWithUser(uid);
  if (thread) {
    /* v11.786: open the page instantly (inbox visible, no page-level slide) then drill into
       the thread — same synchronous shape as the inbox tap. The slide is now WAAPI-with-
       pixels (see startDirectMessageThreadOpenAnimation), which animates regardless of paint
       timing, so the earlier one-frame defer is no longer needed. activeDmThreadId reset
       first so the inbox renders clean underneath the sliding panel. */
    activeDmThreadId = '';
    openDirectMessagesPage(true);
    openDirectMessageThread(thread.id);
    return;
  }
  openDirectMessagesPage();
  if (isDirectMessageFriend(uid)) {
    openOrCreateDirectMessageThreadForUser(uid);
    return;
  }
  sendDirectMessageRequest(uid).then(() => {
    activeMessagesSubTab = 'requests';
    renderDirectMessagesView();
  });
}
