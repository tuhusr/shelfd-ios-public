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
      panel.style.transform = 'translate3d(0, 0, 0)';
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
      panel.style.transform = 'translate3d(0, 0, 0)';
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
  const runOpenSlide = () => {
    if (!panel.isConnected || dmThreadOpenAnimationState?.token !== token) { finish(); return; }
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
  };

  /* Two frames: commit the off-screen start before the 390ms right-to-left slide begins. */
  requestAnimationFrame(() => requestAnimationFrame(runOpenSlide));
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
