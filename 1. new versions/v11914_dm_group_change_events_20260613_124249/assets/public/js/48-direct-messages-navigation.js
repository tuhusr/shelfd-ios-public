/*
   48-direct-messages-navigation.js
   Extracted from 09-direct-messages.js to keep surface ownership explicit.
*/

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

/* v11.878: the "open the thread at the most recent message" anchor was REBUILT in the
   stage engine — pinDmThreadListToBottomInstant + beginDmThreadBottomAnchor (called from
   mountDmThread) + the media re-pin in patchDmThreadMessages. The old dmInitialBottomAnchor
   family and its DM_OPEN_BOTTOM_ANCHOR_ENABLED diagnostic flag were deleted so nothing
   shadows the live anchor. scrollDirectMessageListToBottom (above) stays — sendDirectMessage
   still calls it. */

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
  if (dmThreadNav.state === 'opening' || dmThreadNav.state === 'closing') return;   /* v11.878 */
  const lift = isDirectMessagesMobileViewport() ? getDirectMessageKeyboardBottom() : 0;
  /* v11.880 — a keyboard OPEN/CLOSE resizes the position:fixed panel via --dm-keyboard-bottom,
     which grows/shrinks the message list. Without re-anchoring, the list keeps its keyboard-open
     scrollTop and the newest message drifts off the bottom when the keyboard closes (the reported
     "shifts up"). On a lift CHANGE, freeze the bottom-lock at its pre-transition value (so the
     resize-driven scrolls below can't flip it) and schedule a final settle-pin. */
  if (lift !== dmKeyboardLastLift) {
    dmKeyboardLastLift = lift;
    dmKeyboardSettling = true;
    if (dmKeyboardSettleTimer) window.clearTimeout(dmKeyboardSettleTimer);
    dmKeyboardSettleTimer = window.setTimeout(() => {
      dmKeyboardSettling = false;
      dmKeyboardSettleTimer = 0;
      /* keyboard fully settled — one last instant pin if still locked, then the scroll tracker
         resumes reading the user's own scrolls. */
      if (dmThreadBottomLocked) {
        pinDmThreadListToBottomInstant(getDmThreadPanel());
        requestAnimationFrame(() => { if (dmThreadBottomLocked) pinDmThreadListToBottomInstant(getDmThreadPanel()); });
      }
    }, 280);
  }
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
  /* keep the latest message glued to the bottom as the list resizes (keyboard open AND close).
     Instant (scroll-behavior:auto), transform-free — no smooth glide to fight the iOS keyboard
     animation. ONLY when bottom-locked, so a user who scrolled up to read history is never yanked. */
  if (dmThreadBottomLocked) pinDmThreadListToBottomInstant(getDmThreadPanel());
}

function resetDirectMessageKeyboardLift() {
  const page = document.getElementById('direct-messages-page');
  if (!page) return;
  page.classList.remove('dm-keyboard-active');
  page.style.setProperty('--dm-keyboard-bottom', '0px');
  page.style.setProperty('--vv-offset-top', '0px');
  /* v11.880: clear the keyboard-transition bookkeeping so the next thread starts clean. */
  dmKeyboardLastLift = 0;
  dmKeyboardSettling = false;
  if (dmKeyboardSettleTimer) { window.clearTimeout(dmKeyboardSettleTimer); dmKeyboardSettleTimer = 0; }
}

/* v11.880 — BOTTOM-LOCK helpers. The lock tracks whether the chat is pinned to the newest
   message; it's set by the user's own scrolling (tracker below), on open, and on send. */
function isDmThreadListAtBottom(list) {
  if (!list) return false;
  return (list.scrollHeight - list.clientHeight - list.scrollTop) <= DM_BOTTOM_LOCK_THRESHOLD_PX;
}
function setDmThreadBottomLocked(locked) { dmThreadBottomLocked = !!locked; }
function bindDmThreadBottomLockTracker(panel) {
  const list = panel ? panel.querySelector('#dm-message-list') : document.getElementById('dm-message-list');
  if (!list || list.__dmBottomLockBound) return;
  list.__dmBottomLockBound = true;
  list.addEventListener('scroll', () => {
    /* ignore programmatic/resize-driven scrolls while the keyboard is mid-transition so the
       open/close resize can't flip the lock — only the user's own scrolling sets it. */
    if (!dmKeyboardSettling) dmThreadBottomLocked = isDmThreadListAtBottom(list);
    /* v11.882: extend the render window as the user scrolls toward the top (load older). */
    maybeGrowDmThreadWindow(list);
  }, { passive: true });
}

/* v11.882 — extend the render window when the user scrolls near the top, preserving their exact
   reading position. The window only grows (older messages are NEVER hidden), so messages can't
   disappear; worst case it renders everything (the pre-v11.882 behaviour). The black-screen fix is
   the compositing change in css/18 + the at-rest transform clear — this just bounds the DOM. */
function maybeGrowDmThreadWindow(list) {
  if (!list || list.scrollTop > DM_LOAD_OLDER_PX || dmThreadWindowStart <= 0) return;
  const id = activeDmThreadId;
  const thread = dmThreadMap[id];
  const panel = getDmThreadPanel();
  if (!thread || !Array.isArray(thread.messages) || !panel || panel.dataset.dmThreadId !== id) return;
  /* anchor on the message row at the top of the viewport so the reading position is preserved
     exactly when older messages are prepended (robust to media that grows on decode). */
  let anchorIdx = null, anchorOffset = 0;
  const rows = list.querySelectorAll('[data-dm-i]');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.offsetTop + r.offsetHeight >= list.scrollTop) { anchorIdx = r.getAttribute('data-dm-i'); anchorOffset = r.offsetTop - list.scrollTop; break; }
  }
  dmThreadWindowStart = Math.max(0, dmThreadWindowStart - DM_RENDER_CHUNK);
  const html = buildDirectMessageListHTML(thread, id);
  list.innerHTML = html;
  panel.__dmListSig = html;
  const restore = () => {
    if (anchorIdx === null) return;
    const a = list.querySelector('[data-dm-i="' + anchorIdx + '"]');
    if (a) list.scrollTop = Math.max(0, a.offsetTop - anchorOffset);
  };
  void list.offsetHeight;
  restore();
  /* keep the anchor put as the freshly-prepended media decodes (its height was 0 at restore). */
  [40, 140, 300].forEach(d => window.setTimeout(restore, d));
  list.querySelectorAll('img, video').forEach(m => {
    if (m.complete || m.readyState >= 2) return;
    try { m.addEventListener('load', restore, { once: true }); } catch (_) {}
  });
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
const DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS = 390;   // chat open slide-in / back-button slide-out

/* ════════════════════════════════════════════════════════════════════════
   v11.878 — CHAT-THREAD NAVIGATION, REBUILT.
   ════════════════════════════════════════════════════════════════════════
   The chat panel (.dm-v2-panel) now lives in its OWN persistent stage,
   #dm-thread-stage — a direct child of #direct-messages-page, OUTSIDE the
   inbox shell (#dm-fullscreen-shell). renderDirectMessagesView() rebuilds the
   INBOX in the shell; it NEVER rebuilds the panel. A Firestore snapshot, a
   thread hydration, or a read-marker write therefore PATCHES the message list
   inside the already-mounted panel and can NEVER destroy/replay the sliding
   element. That physical separation is what finally makes "one tap = one
   slide" a structural fact instead of a timing race.

   ONE state machine, ONE open path, ONE slide:
     dmThreadNav.state: 'closed' | 'opening' | 'open' | 'closing'
   Every open/close stamps a fresh token; a stale animation/timer callback that
   fires after a newer transition started is a no-op (token mismatch). */
let dmThreadNav = { state: 'closed', threadId: '', token: 0 };
let dmThreadNavToken = 0;
let dmThreadSlideAnimation = null;
let dmThreadSlideTimer = 0;
let dmThreadBottomAnchorToken = 0;
let dmSwipeBackToken = 0;

/* v11.880 — BOTTOM-LOCK: is the chat currently pinned to the latest message? Drives the
   keyboard-hide re-anchor so dismissing the iOS keyboard after a send keeps the newest message
   at the bottom, while NOT yanking a user who deliberately scrolled up to read history. */
const DM_BOTTOM_LOCK_THRESHOLD_PX = 120;
let dmThreadBottomLocked = true;
let dmKeyboardSettling = false;
let dmKeyboardSettleTimer = 0;
let dmKeyboardLastLift = 0;

/* v11.882 — RENDER WINDOW: only the latest slice of a long thread is in the DOM at once (keeps the
   node count + paint area bounded for fast open). dmThreadWindowStart is the absolute index of the
   OLDEST rendered message; it only ever DECREASES as the user scrolls up (older messages are never
   hidden), and being an absolute index means appended new messages never shift a scrolled-up
   reader's view. The black-screen fix is the compositing change above — this is the perf bound. */
const DM_RENDER_INITIAL = 60;
const DM_RENDER_CHUNK = 60;
const DM_LOAD_OLDER_PX = 800;   // grow the window when the user scrolls within this of the top
let dmThreadWindowStart = 0;

/* ════════════════════════════════════════════════════════════════════════
   v11.878 — STAGE ENGINE. The chat panel is mounted into #dm-thread-stage and
   patched in place; it is never rebuilt by a data render. Open = build once +
   slide once. Close = slide off + unmount. Data = patch the message list only.
   ════════════════════════════════════════════════════════════════════════ */
function ensureDmThreadStage() {
  const page = document.getElementById('direct-messages-page');
  if (!page) return null;
  let stage = document.getElementById('dm-thread-stage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'dm-thread-stage';
    stage.className = 'dm-thread-stage';
    /* appended as the last child of #direct-messages-page so the fixed panel sits in
       the SAME stacking context the inbox underlay uses (its z-index keeps it on top). */
    page.appendChild(stage);
  }
  return stage;
}
function getDmThreadPanel() {
  const stage = document.getElementById('dm-thread-stage');
  return stage ? stage.querySelector('.dm-v2-panel') : null;
}
function showDmThreadStage() {
  const stage = ensureDmThreadStage();
  if (stage) stage.style.display = '';
}
function hideDmThreadStage() {
  const stage = document.getElementById('dm-thread-stage');
  if (stage) stage.style.display = 'none';
}
function cancelDmThreadSlide() {
  try { if (dmThreadSlideAnimation && dmThreadSlideAnimation.cancel) dmThreadSlideAnimation.cancel(); } catch (_) {}
  dmThreadSlideAnimation = null;
  if (dmThreadSlideTimer) { window.clearTimeout(dmThreadSlideTimer); dmThreadSlideTimer = 0; }
}
function unmountDmThread() {
  cancelDmThreadSlide();
  const stage = document.getElementById('dm-thread-stage');
  if (stage) { stage.innerHTML = ''; stage.style.display = 'none'; }
  dmThreadNav = { state: 'closed', threadId: '', token: dmThreadNavToken };
}

/* Back-compat shim — legacy call sites (the dead inbox-parallax swipe path,
   closeDirectMessagesPage, the swipe hooks) still call this name. It just cancels
   any in-flight slide and clears the transient transition classes. */
function cancelDirectMessageThreadOpenAnimation(page = document.getElementById('direct-messages-page')) {
  cancelDmThreadSlide();
  if (page) page.classList.remove('dm-nav-open-thread', 'dm-nav-finalizing-inbox', 'dm-thread-swiping');
}

/* ---- latest-message positioning ----------------------------------------- */
/* Pin the message list to the newest message INSTANTLY — no smooth glide, no
   visible scroll-from-the-middle. */
function pinDmThreadListToBottomInstant(panel) {
  const list = panel ? panel.querySelector('#dm-message-list') : document.getElementById('dm-message-list');
  if (!list) return;
  const prev = list.style.scrollBehavior;
  list.style.scrollBehavior = 'auto';
  void list.offsetHeight;                       // force layout so scrollHeight is valid on a fresh panel
  list.scrollTop = list.scrollHeight;
  if (prev) list.style.scrollBehavior = prev; else list.style.removeProperty('scroll-behavior');
}
/* Bounded re-pin: hold the list at the newest message across the open window and
   as media (images/video) load and change bubble heights. Token-guarded so a close
   or a newer open silently cancels it — it never fights a later scroll. */
function beginDmThreadBottomAnchor(threadId) {
  const id = String(threadId || '').trim();
  const token = ++dmThreadBottomAnchorToken;
  const pin = () => {
    if (dmThreadBottomAnchorToken !== token || activeDmThreadId !== id) return;
    const panel = getDmThreadPanel();
    if (!panel || panel.dataset.dmThreadId !== id) return;
    pinDmThreadListToBottomInstant(panel);
  };
  pin();
  requestAnimationFrame(() => { pin(); requestAnimationFrame(pin); });
  [40, 120, 260, DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS + 120].forEach(d => window.setTimeout(pin, d));
  requestAnimationFrame(() => {
    if (dmThreadBottomAnchorToken !== token) return;
    const panel = getDmThreadPanel();
    const list = panel ? panel.querySelector('#dm-message-list') : null;
    if (!list) return;
    list.querySelectorAll('img, video').forEach(m => {
      if (m.complete || m.readyState >= 2) return;
      try { m.addEventListener('load', pin, { once: true }); } catch (_) {}
      try { m.addEventListener('loadedmetadata', pin, { once: true }); } catch (_) {}
    });
  });
}

/* ---- mount + slide ------------------------------------------------------ */
/* Build the chat panel into the stage ONCE, pin to the newest message, then either
   slide it in (animate) or place it at rest (instant: UI-state restore / returning
   from group-edit). */
function mountDmThread(threadId, options = {}) {
  const id = String(threadId || '').trim();
  if (!id || !dmThreadMap[id]) return null;
  const stage = ensureDmThreadStage();
  if (!stage) return null;
  stage.style.display = '';
  /* v11.882: open with only the latest window of messages in the DOM (fast open, bounded paint).
     Older messages load as the user scrolls up. Set BEFORE building the panel — buildDirectMessage
     ListHTML reads dmThreadWindowStart. */
  const dmAllLen = (dmThreadMap[id] && Array.isArray(dmThreadMap[id].messages)) ? dmThreadMap[id].messages.length : 0;
  dmThreadWindowStart = Math.max(0, dmAllLen - DM_RENDER_INITIAL);
  stage.innerHTML = renderDirectMessageThread(id);     // pure panel HTML — no entering/consume dance
  const panel = stage.querySelector('.dm-v2-panel');
  if (!panel) return null;
  /* v11.879: seed the message-list signature so the FIRST hydration echo (the
     ensureDirectMessageThreadHydrated .get() that returns the same messages) is a no-op in
     patchDmThreadMessages — the media is never recreated, so it can't flash on open. */
  try { panel.__dmListSig = buildDirectMessageListHTML(dmThreadMap[id], id); } catch (_) {}
  pinDmThreadListToBottomInstant(panel);               // newest message visible BEFORE the slide starts
  beginDmThreadBottomAnchor(id);
  setDmThreadBottomLocked(true);                        // v11.880: a freshly-opened thread lands at the latest message
  bindDmThreadBottomLockTracker(panel);                // track the user's own scrolling from here on
  if (options.animate) {
    slideDmThreadIn(panel, options.token || dmThreadNav.token);
  } else {
    panel.style.transition = 'none';
    panel.style.transform = '';          // v11.882: no lingering GPU-layer transform at rest
    panel.style.webkitTransform = '';
    panel.style.willChange = '';
    panel.style.backfaceVisibility = '';
    panel.style.webkitBackfaceVisibility = '';
    dmThreadNav = { state: 'open', threadId: id, token: dmThreadNav.token };
    try { updateDirectMessageKeyboardLift(); } catch (_) {}
  }
  return panel;
}

/* The 390ms slide-in. WKWebView-safe: a brand-new, never-painted fixed element
   silently no-ops element.animate()/CSS transitions, so we pin it off-screen RIGHT
   in PIXELS (WKWebView mis-interpolates vw in WAAPI), force a painted off-screen
   frame, then start the transition on the SECOND rAF once it has actually painted.
   Transform-only → composited → 120fps-ready. Token-guarded end. */
function slideDmThreadIn(panel, token) {
  if (!panel) return;
  cancelDmThreadSlide();
  const threadId = panel.dataset.dmThreadId || activeDmThreadId;
  dmThreadNav = { state: 'opening', threadId, token };
  const duration = DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS;   // 390ms
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const offRightPx = (window.innerWidth || document.documentElement.clientWidth || 390) + 48;
  panel.style.willChange = 'transform';
  panel.style.backfaceVisibility = 'hidden';
  panel.style.webkitBackfaceVisibility = 'hidden';
  panel.style.transition = 'none';
  panel.style.webkitTransition = 'none';
  const startT = 'translate3d(' + offRightPx + 'px, 0, 0)';
  panel.style.transform = startT;
  panel.style.webkitTransform = startT;
  void panel.offsetWidth;                                     // paint the off-screen frame

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (dmThreadSlideTimer) { window.clearTimeout(dmThreadSlideTimer); dmThreadSlideTimer = 0; }
    /* the panel now fully covers the screen — drop the transient inbox-behind layer
       (the shell inbox is the resting back-layer revealed on close/swipe). */
    const page = document.getElementById('direct-messages-page');
    if (page) page.querySelectorAll('.dm-thread-swipe-underlay').forEach(n => n.remove());
    if (panel.isConnected) {
      panel.style.transition = 'none';
      panel.style.webkitTransition = 'none';
      /* v11.882: CLEAR the transform/backface at rest (don't leave translate3d(0,0,0)). A lingering
         transform keeps the panel — and its tall scrollable message list — promoted to a GPU layer,
         which feeds the scroll-up texture-limit BLACK screen on long threads. Visually identical (it
         was a 0 translate); the panel is just no longer a persistent compositing layer. */
      panel.style.transform = '';
      panel.style.webkitTransform = '';
      panel.style.willChange = '';
      panel.style.backfaceVisibility = '';
      panel.style.webkitBackfaceVisibility = '';
    }
    if (dmThreadNav.token === token) {
      dmThreadNav = { state: 'open', threadId, token };
      try { updateDirectMessageKeyboardLift(); } catch (_) {}
    }
  };
  const run = () => {
    if (!panel.isConnected || dmThreadNav.token !== token) { finish(); return; }
    try {
      panel.addEventListener('transitionend', (e) => { if (!e || e.target === panel) finish(); }, { once: true });
    } catch (_) {}
    const tr = 'transform ' + duration + 'ms ' + easing + ', -webkit-transform ' + duration + 'ms ' + easing;
    panel.style.transition = tr;
    panel.style.webkitTransition = tr;
    panel.style.transform = 'translate3d(0, 0, 0)';
    panel.style.webkitTransform = 'translate3d(0, 0, 0)';
    dmThreadSlideTimer = window.setTimeout(finish, duration + 120);
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
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
  /* v11.883: stop iOS's native scroll-to-input pan while in DM (keeps the chat header pinned when
     the keyboard opens). Scoped: restored on close. No-op without @capacitor/keyboard. */
  try { if (typeof dmSetKeyboardScrollDisabled === 'function') dmSetKeyboardScrollDisabled(true); } catch (_) {}
  /* v11.884: hide the iOS up/down/Done input-accessory bar so the Shelfd composer sits directly
     above the predictive-text row (the bar shortens the keyboard area; --dm-keyboard-bottom then
     seats the composer right on top of the keyboard). Scoped: restored on close. */
  try { if (typeof dmSetKeyboardAccessoryBarVisible === 'function') dmSetKeyboardAccessoryBarVisible(false); } catch (_) {}
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
  try { if (typeof closeDirectMessageGroupInfoEdit === 'function') closeDirectMessageGroupInfoEdit(true); } catch (_) {}
  try { if (typeof closeDirectMessageGroupDetails === 'function') closeDirectMessageGroupDetails(true); } catch (_) {}
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  /* v11.883: restore native scroll-to-input for the rest of the app (it was disabled on open). */
  try { if (typeof dmSetKeyboardScrollDisabled === 'function') dmSetKeyboardScrollDisabled(false); } catch (_) {}
  /* v11.884: restore the input-accessory bar for the rest of the app (DM hid it). */
  try { if (typeof dmSetKeyboardAccessoryBarVisible === 'function') dmSetKeyboardAccessoryBarVisible(true); } catch (_) {}
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
  unmountDmThread();                 // v11.878: remove the chat panel from its stage
  activeDmThreadId = '';
  try {
    if (typeof clearDirectMessageActiveThreadState === 'function') {
      clearDirectMessageActiveThreadState('dm-page-close');
    } else if (window.__shelfdClearActiveDmThreadState) {
      window.__shelfdClearActiveDmThreadState('dm-page-close');
    }
  } catch (_) {}
  dmThreadNav = { state: 'closed', threadId: '', token: dmThreadNavToken };
  page.classList.remove('open', 'dm-thread-open', 'dm-nav-open-thread', 'dm-nav-finalizing-inbox', 'dm-thread-swiping');
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
