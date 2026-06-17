/* =============================================================================
   31-edge-swipe-back.js  (v10.388 — bump outgoing-page corners to 45px)
   ----------------------------------------------------------------------------
   iOS-style edge-swipe-from-left-to-go-back gesture.

   How it works:
     1. Listen for touchstart within 24px of the left screen edge.
     2. Track touchmove. If the touch becomes more vertical than horizontal,
        cancel (it's a regular scroll, not a swipe-back).
     3. Show a thin gradient indicator on the left edge that follows the
        finger's horizontal delta, so the gesture is discoverable.
     4. On touchend, if horizontal delta crossed the threshold (~80px) and
        was clearly a swipe (not a tap), find the most relevant "Back"
        button on the current view and click it.

   Back button discovery is generic — instead of enumerating every page's
   close handler, we look for any visible element with aria-label="Back",
   or any of the common back-button class names used across the app. The
   first visible match wins.

   Why this design:
     - Works on every page that already has a back button (no per-page wiring)
     - Pure web — no Capacitor native plugin needed
     - Doesn't fight iOS scrolling: vertical pan → no gesture, native scroll
     - Doesn't conflict with horizontal carousels: we only trigger when the
       gesture STARTS in the left 24px slice, where carousels rarely begin

   Doesn't run on desktop (touch-only) or when a modal input is focused.
   ========================================================================== */
(function() {
  'use strict';

  /* ---------- Config ---------- */
  const EDGE_DETECT_PX = 24;          // touchstart must begin within this many px of the left edge
  const TRIGGER_DELTA_PX = 80;        // horizontal swipe distance required to fire back
  const VERTICAL_CANCEL_PX = 14;      // if dy exceeds this without enough dx, treat as scroll
  const MAX_DURATION_MS = 800;        // give up if the gesture takes too long
  const INDICATOR_MAX_TRAVEL = 60;    // how far the indicator slides into view at max delta

  /* ---------- State ---------- */
  let startX = 0;
  let startY = 0;
  let startTs = 0;
  let lastX = 0;
  let active = false;
  let cancelled = false;
  let indicator = null;
  /* v10.383: drag-to-dismiss state */
  let dragSurface = null;
  let dragConfig = null;
  let dragPrevTransform = '';
  let dragPrevTransition = '';
  let dragPrevWillChange = '';
  /* v10.384: scroll-lock state for the outgoing page during a drag. We
     freeze the page's scroll container so touch input can't scroll it
     while the surface is following the finger horizontally. */
  let dragScrollEl = null;
  let dragScrollPrevOverflow = '';
  let dragScrollPrevTouchAction = '';
  let dragScrollPrevOverscroll = '';
  let dragScrollTop = 0;
  let dragSurfacePrevTouchAction = '';
  let dragPreventScrollHandler = null;
  /* v10.385: corner-radius state. While the surface is being dragged out,
     it gets 15px rounded corners (and overflow:hidden so internal content
     is clipped to the new shape). On snap-back we restore the originals. */
  let dragSurfacePrevBorderRadius = '';
  let dragSurfacePrevOverflow = '';
  /* v10.838: save previous inline animation value so the snap-back path
     can restore it. We clear `animation` to `none` on activate to defeat
     animation-fill-mode that would otherwise override our transition. */
  let dragSurfacePrevAnimation = '';
  /* v10.839: REMOVED needsHorizontalCommit / pendingDragSurface /
     pendingDragConfig — anywhereHorizontal was reverted because it
     caused false-positive tap registrations on the inbox underneath. */
  /* v10.837: tracks whether the config.onDragStart() hook has fired for
     this gesture. Fires exactly once, the first frame the surface visibly
     translates — perfect moment to render any underlay so it's revealed
     in sync with the chat sliding out. */
  let dragStartHookFired = false;

  function isTouchDevice() {
    return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  }
  if (!isTouchDevice()) return;

  /* ---------- Don't run while keyboard is up or a form input is focused.
     iOS gets confused if we steal a touch that was meant for an input. ---------- */
  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /* ---------- Back button discovery ----------
     We try a battery of common back-button selectors used across Shelfd's
     pages. First visible + clickable match wins. Order matters: more
     specific selectors first so we don't accidentally click a sub-page's
     back when a top-level page is showing. */
  const BACK_SELECTORS = [
    /* Friend profile (the cyan→back-mode pill) */
    '.header-import-btn.header-import-btn--back-mode',
    /* Friend list floating chevron */
    'body.viewing-other-user .friend-list-floating-back-btn',
    /* Profile / settings */
    '.profile-back-btn',
    /* Auth pages */
    '.shelfd-auth-back',
    /* Discovery / media pages */
    '.discover-media-back',
    /* Comments */
    '.comments-page-back',
    /* Patch notes */
    '.screenlist-patch-notes-back',
    /* Activity stack */
    '.screenlist-stacked-activity-back',
    /* Filmography / cast */
    '.filmography-page-back',
    '.media-cast-page-back',
    /* v10.383: My List → Episodes full-page details */
    '.mylist-episode-page-back',
    /* v10.386: My List → Full Page Media Review */
    '.mylist-media-review-back',
    /* v11.604: News → in-app article reader */
    '.news-reader-back',
    /* v11.680: DM CHAT thread — now driven by THIS generic drag engine, identical
       to the news reader (the .dm-v2-panel is a fixed full-screen overlay). See the
       DRAGGABLE_OVERLAYS entry below. The old custom --dm-thread-swipe-x system has
       been deleted. */
    '.dm-v2-back',
    /* Generic */
    '[aria-label="Back" i]',
    '[aria-label="Go back" i]',
    '[aria-label="Close" i]'
  ];

  /* v10.383: Some pages support DRAG-to-dismiss in addition to tap-back.
     When the active back target's overlay is one of these, the gesture
     translates the page itself horizontally under the finger (page stays
     at 100% opacity, reveals the page underneath). On release past the
     threshold, the page is animated off-screen and dismissed; otherwise
     it snaps back to 0,0.

     Each entry maps the visible back-button selector → a function that
     resolves the draggable surface element. */
  const DRAGGABLE_OVERLAYS = [
    {
      backSelector: '.mylist-episode-page-back',
      scrollSelector: '.mylist-episode-page-scroll',
      getSurface() {
        const overlay = document.getElementById('mylist-episode-page-overlay');
        if (!overlay) return null;
        if (!overlay.classList.contains('is-open')) return null;
        if (overlay.classList.contains('is-closing')) return null;
        return overlay.querySelector('.mylist-episode-page-surface') || null;
      },
      dismiss() {
        try { if (typeof window.closeMyListEpisodePage === 'function') window.closeMyListEpisodePage(); } catch (_) {}
      }
    },
    /* v10.386: Full Page Media Review. The dragged element here IS the
       overlay itself (.mylist-media-review-page) — there's no separate
       inner surface. The scrollable child is .mylist-media-review-content.
       The page's "actions sheet" is a modal layer on top of the page; when
       it's open we skip the drag so the swipe doesn't dismiss the page
       underneath the sheet. */
    {
      backSelector: '.mylist-media-review-back',
      scrollSelector: '.mylist-media-review-content',
      getSurface() {
        const page = document.getElementById('mylist-media-review-page');
        if (!page) return null;
        if (!page.classList.contains('is-open')) return null;
        if (page.classList.contains('actions-open')) return null;
        return page;
      },
      dismiss() {
        try { if (typeof window.closeFullPageMediaReview === 'function') window.closeFullPageMediaReview(); } catch (_) {}
      }
    },
    /* v11.604: In-app News reader. Same shape as the Full Page Media Review —
       the dragged element IS the overlay (#news-reader); its scrollable child
       is .news-reader-content. */
    {
      backSelector: '.news-reader-back',
      scrollSelector: '.news-reader-content',
      getSurface() {
        const page = document.getElementById('news-reader');
        if (!page) return null;
        if (!page.classList.contains('is-open')) return null;
        return page;
      },
      dismiss() {
        try { if (typeof window.closeNewsReaderOverlay === 'function') window.closeNewsReaderOverlay(); } catch (_) {}
      }
    },
    /* v11.680: DM CHAT thread. Mirrors the in-app news reader EXACTLY — the dragged
       element IS the fixed full-screen .dm-v2-panel overlay; behind it sits the inbox
       underlay (rendered on drag-start), revealed as the panel slides off. No
       dismissAnimationMs → the default 320ms cubic-bezier(0.22,1,0.36,1) commit and
       220ms snap-back, byte-identical to the reader. dismiss() settles the page to
       the inbox. The old custom --dm-thread-swipe-x swipe system has been deleted. */
    {
      backSelector: '.dm-v2-back',
      scrollSelector: '#dm-message-list',
      getSurface() {
        const page = document.getElementById('direct-messages-page');
        if (!page || !page.classList.contains('open')) return null;
        return page.querySelector('.dm-v2-panel') || null;
      },
      onDragStart() {
        try { if (typeof window.shelfdDmRenderSwipeUnderlay === 'function') window.shelfdDmRenderSwipeUnderlay(); } catch (_) {}
      },
      useWebAnimation: true,
      dismiss() {
        try { if (typeof window.shelfdDmFinishSwipeBack === 'function') window.shelfdDmFinishSwipeBack(); } catch (_) {}
      }
    }
  ];

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled) return false;
    if (el.offsetParent === null) {
      /* offsetParent === null means display:none somewhere in the chain,
         OR the element has position: fixed (which CAN be visible). Check
         the latter via bounding rect. */
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    }
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    if (cs.opacity === '0') return false;
    return true;
  }

  function findBackTarget() {
    for (const selector of BACK_SELECTORS) {
      try {
        const candidates = document.querySelectorAll(selector);
        /* v10.487: iterate in REVERSE order so when multiple overlays
           share a selector (e.g. media profile + actor profile both have
           `.discover-media-back`), the LAST-in-DOM match wins. Stacked
           overlays are typically appended later, so the last match is
           the topmost overlay — the one whose back button the user
           actually wants to fire. Previously we returned the first
           match (the underneath page), so swiping the actor profile
           would dismiss the media profile and reveal the discover
           page two levels down instead of just one. */
        for (let i = candidates.length - 1; i >= 0; i--) {
          const candidate = candidates[i];
          if (isElementVisible(candidate)) return candidate;
        }
      } catch (_) {}
    }
    return null;
  }

  /* v10.383: If the currently-visible back target matches a draggable
     overlay config, return that config (with a live surface element);
     otherwise null.

     v10.486: After the explicit configs are checked, fall back to a
     GENERIC drag detection so EVERY back-buttoned page automatically
     gets the same drag-to-dismiss animation that the Full Page Review
     uses. The fallback walks up from the visible back button to find
     the outermost large positioned ancestor (the "page" overlay), and
     dismisses by clicking the back button after the slide-off
     animation completes. */
  function findDraggableForCurrentBack() {
    for (const config of DRAGGABLE_OVERLAYS) {
      try {
        const btn = document.querySelector(config.backSelector);
        if (!btn || !isElementVisible(btn)) continue;
        const surface = config.getSurface && config.getSurface();
        if (surface && surface.isConnected) return { config, surface };
      } catch (_) {}
    }
    /* Generic fallback — find any visible back button and try to wrap
       its enclosing page overlay as the drag surface. */
    const backBtn = findBackTarget();
    if (!backBtn) return null;
    const surface = findGenericPageSurface(backBtn);
    if (!surface) return null;
    const scrollEl = findGenericScrollContainer(surface);
    return {
      surface,
      config: {
        /* Pass the element directly — no per-page selector needed. */
        scrollEl,
        dismiss() {
          try { backBtn.click(); } catch (_) {}
        }
      }
    };
  }

  /* v10.486: Generic page-surface detector.
     Climbs from the back button up the DOM tree looking for the
     INNERMOST (closest to back button) `position: fixed` or
     `position: absolute` ancestor that covers most of the viewport.
     v10.487: Was returning OUTERMOST, which broke nested cases — e.g.
     clicking an actor poster on a media profile opens the actor
     overlay ON TOP of the media profile. Both are page-sized fixed
     containers. Outermost returned the media profile (underneath);
     innermost returns the actor overlay (on top), which is the one
     the user actually wants to swipe off. */
  function findGenericPageSurface(backButton) {
    if (!backButton) return null;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vw || !vh) return null;
    let el = backButton.parentElement;
    let depthGuard = 0;
    while (el && el !== document.body && el.nodeType === 1 && depthGuard < 30) {
      depthGuard += 1;
      try {
        const cs = window.getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'absolute') {
          const rect = el.getBoundingClientRect();
          /* "Page-like": at least 70% of viewport width AND 50% of
             viewport height. Filters out small popovers / sub-panels. */
          if (rect.width >= vw * 0.70 && rect.height >= vh * 0.50) {
            return el;  /* INNERMOST match — return immediately. */
          }
        }
      } catch (_) {}
      el = el.parentElement;
    }
    return null;
  }

  /* v10.486: Generic scroll-container detector.
     BFS through the surface's descendants looking for the first
     scrollable child (overflow-y: auto/scroll AND content overflows).
     Used to scroll-lock the right element during the drag. */
  function findGenericScrollContainer(surface) {
    if (!surface) return null;
    const queue = [];
    for (const child of surface.children) queue.push(child);
    let breadthGuard = 0;
    while (queue.length && breadthGuard < 200) {
      breadthGuard += 1;
      const el = queue.shift();
      try {
        const cs = window.getComputedStyle(el);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
            && el.scrollHeight > el.clientHeight + 4) {
          return el;
        }
      } catch (_) {}
      for (const child of el.children) queue.push(child);
    }
    return null;
  }

  function fireBack() {
    const target = findBackTarget();
    if (target) {
      try { target.click(); return true; } catch (_) {}
    }
    return false;
  }

  function getSurfaceTranslateTransform(surface) {
    if (!surface) return 'translate3d(0, 0, 0)';
    const inline = String(surface.style.transform || '').trim();
    if (inline && inline !== 'none') return inline;
    try {
      const computed = window.getComputedStyle(surface).transform;
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

  function animateDragSurfaceTransform(surface, toTransform, ms, easing, done) {
    if (!surface || typeof surface.animate !== 'function') return false;
    const fromTransform = getSurfaceTranslateTransform(surface);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { if (animation && animation.playState !== 'finished') animation.cancel(); } catch (_) {}
      if (surface && surface.isConnected) {
        surface.style.transition = 'none';
        surface.style.transform = toTransform;
        surface.style.opacity = '1';
      }
      try { if (typeof done === 'function') done(); } catch (_) {}
    };
    let animation;
    try {
      surface.style.transition = 'none';
      surface.style.transform = fromTransform;
      surface.style.opacity = '1';
      animation = surface.animate([
        { transform: fromTransform, opacity: 1 },
        { transform: toTransform, opacity: 1 }
      ], {
        duration: ms,
        easing,
        fill: 'forwards'
      });
      animation.onfinish = finish;
      window.setTimeout(finish, ms + 90);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ---------- Indicator ---------- */
  function ensureIndicator() {
    if (indicator) return indicator;
    indicator = document.createElement('div');
    indicator.className = 'shelfd-edge-swipe-indicator';
    document.body.appendChild(indicator);
    return indicator;
  }

  function updateIndicator(dx) {
    const ind = ensureIndicator();
    /* Slide the indicator from -100% (off-screen) toward 0 as dx grows.
       At dx >= INDICATOR_MAX_TRAVEL the indicator is fully on-screen. */
    const progress = Math.max(0, Math.min(1, dx / INDICATOR_MAX_TRAVEL));
    const translatePx = -100 + (progress * 100);
    ind.style.transform = `translateX(${translatePx}%)`;
    if (!ind.classList.contains('is-active')) ind.classList.add('is-active');
    ind.classList.remove('is-snapping-back');
  }

  function snapIndicatorBack() {
    if (!indicator) return;
    indicator.classList.add('is-snapping-back');
    indicator.classList.remove('is-active');
    indicator.style.transform = 'translateX(-100%)';
  }

  /* ---------- Gesture lifecycle ---------- */
  /* v10.272: when the touch starts inside a horizontal swipe-snap carousel
     (e.g. the stacked-activity carousel), let the carousel own the gesture.
     32-stack-carousel.js marks the active carousel via data-stack-carousel-active. */
  function isTouchInsideCarousel(event) {
    let el = event.target;
    while (el && el !== document.body && el.nodeType === 1) {
      if (el.classList && (el.classList.contains('sl-activity-stack-carousel') || el.hasAttribute('data-stack-carousel'))) {
        return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  function isTouchInsideMediaProfile(event) {
    return !!(event.target && event.target.closest
      && event.target.closest('.discover-media-profile-overlay, .game-media-profile-overlay'));
  }

  /* v10.837: extracted into its own function so it can run lazily for
     anywhere-horizontal mode. Sets up the inline styles / scroll-lock /
     preventDefault listener that turn an element into a dragged surface. */
  function activateDragSurface(surface, config) {
    if (!surface) return;
    dragSurface = surface;
    dragConfig = config || {};
    dragPrevTransform = dragSurface.style.transform || '';
    dragPrevTransition = dragSurface.style.transition || '';
    dragPrevWillChange = dragSurface.style.willChange || '';
    /* v10.838: explicitly clear any inherited CSS animation on the surface.
       The DM v2 panel ships with `animation: dmThreadEnterFromRight 600ms
       cubic-bezier both` from the .dm-nav-open-thread class — animation-
       fill-mode: both clamps the panel to the keyframe's final transform
       AT A HIGHER CSS CASCADE LEVEL THAN INLINE STYLES. That means our
       inline transition+transform for the dismiss never fires, the panel
       sits still, the timeout finalizes, DOM is replaced — looks like an
       instant close. Setting `animation: none` inline kills the animation
       styles so our inline transition can drive the dismiss properly. */
    dragSurfacePrevAnimation = dragSurface.style.animation || '';
    dragSurface.style.animation = 'none';
    dragSurface.style.transition = 'none';
    dragSurface.style.willChange = 'transform';
    /* v10.384: Lock the outgoing page so it can't scroll while the
       surface is being dragged. */
    dragSurfacePrevTouchAction = dragSurface.style.touchAction || '';
    dragSurface.style.touchAction = 'none';
    /* v10.385/v10.388: rounded corners during the slide-out. */
    dragSurfacePrevBorderRadius = dragSurface.style.borderRadius || '';
    dragSurfacePrevOverflow = dragSurface.style.overflow || '';
    dragSurface.style.borderRadius = '45px';
    dragSurface.style.overflow = 'hidden';
    /* v10.386/v10.486: scroll-container lock. */
    const scrollSelector = dragConfig.scrollSelector;
    const scrollEl = dragConfig.scrollEl
      || (scrollSelector ? dragSurface.querySelector(scrollSelector) : null);
    if (scrollEl) {
      dragScrollEl = scrollEl;
      dragScrollTop = scrollEl.scrollTop;
      dragScrollPrevOverflow = scrollEl.style.overflow || '';
      dragScrollPrevTouchAction = scrollEl.style.touchAction || '';
      dragScrollPrevOverscroll = scrollEl.style.overscrollBehavior || '';
      scrollEl.style.overflow = 'hidden';
      scrollEl.style.touchAction = 'none';
      scrollEl.style.overscrollBehavior = 'none';
      scrollEl.scrollTop = dragScrollTop;
    }
    dragPreventScrollHandler = function (e) {
      if (dragSurface && e.cancelable) e.preventDefault();
    };
    window.addEventListener('touchmove', dragPreventScrollHandler, { passive: false });
  }

  /* v10.839: REMOVED findAnywhereHorizontalDraggable and the anywhere-
     horizontal touchstart/touchmove branches. Page-wide swipe caused
     false-positive tap registrations on the inbox cards behind the chat
     panel. Reverted to edge-only swipe (touchstart within 24px of the
     left edge). The DM thread config still has onDragStart and
     dismissAnimationMs: 600 — those work fine with edge mode. */

  function onTouchStart(event) {
    if (event.touches.length !== 1) return;          // multi-touch → not our gesture
    if (isInputFocused()) return;
    /* v11360: the friend's shelf page (viewing someone else's My List) has its
       own dedicated, finger-tracking swipe-back handler in 16-friends-requests.js
       (bindFriendShelfSwipeBack). Bail out here so the generic engine never
       shows its thin purple indicator line over that page. */
    if (document.body.classList.contains('viewing-other-user')) return;
    /* v11.586: the full-page user profile (#profile-page) has its OWN finger-
       tracking swipe-back (bindProfilePageSwipeBack in 15-profile-settings.js,
       bound on open). Bail so the generic engine doesn't RACE it with a second
       transform + click-back path — same reasoning as the friend-shelf guard
       above and the media-profile guard below. Without this both handlers fire:
       the swipe is janky AND the page is left in a stuck state so it won't
       re-open. */
    if (document.body.classList.contains('profile-active')) return;
    /* v11.926: the DM group details ("edit group chat") overlay has its OWN
       finger-tracking swipe-back (bindDirectMessageGroupDetailsSwipeBack in
       09-direct-messages.js) that slides the page off and closes back to the
       chat THREAD. Bail here so the generic engine doesn't RACE it — otherwise
       the engine grabs the still-mounted .dm-v2-panel underneath the overlay as
       its drag surface, renders the inbox underlay, and settles to the INBOX
       (the page revealed should be the thread, not the inbox). Same dual-handler
       fix as the friend-shelf / profile / media-profile guards above. */
    const dmGroupDetailsOverlay = document.getElementById('dm-group-details-overlay');
    if (dmGroupDetailsOverlay && dmGroupDetailsOverlay.classList.contains('is-open')) return;
    /* v11.680: the DM CHAT thread is now driven by THIS engine (the .dm-v2-panel
       overlay, exactly like the news reader). The DM INBOX still owns its own
       page-close swipe in 09-direct-messages.js, so bail ONLY when the DM page is
       open in INBOX mode (no .dm-v2-panel present). A thread open → let the engine
       drive the chat→inbox swipe. */
    const dmPage = document.getElementById('direct-messages-page');
    if (dmPage && dmPage.classList.contains('open')) {
      if (!dmPage.querySelector('.dm-v2-panel')) return;
    } else if (document.body.classList.contains('dm-fullscreen-open')) {
      return;
    }
    const touch = event.touches[0];
    if (touch.clientX > EDGE_DETECT_PX) return;       // not at left edge
    /* v10.272: don't fight horizontal swipe carousels. */
    if (isTouchInsideCarousel(event)) return;
    /* Media profile overlays have their own direct-manipulation swipe-back
       handler in 11-discovery-media-games-profiles.js. Let that handler own
       the drag so the page tracks the user's finger instead of the generic
       edge handler racing it with a second transform/click-back path. */
    if (isTouchInsideMediaProfile(event)) return;
    /* v11.199: don't arm on a tap that starts on an interactive control.
       Back buttons / links / inputs near the left edge (e.g. the Episode &
       Season Details back button at left:16px, whose left half overlaps the
       24px edge-detect zone) were getting their tap swallowed: the gesture
       armed, applied touch-action:none + a preventDefault touchmove listener,
       and the button's onclick never fired — so the user had to tap several
       times before one landed right of the edge zone. Letting the control
       own its own tap fixes the delay without changing swipe feel (a real
       swipe still works — it just starts the drag from the first move, and
       the control's click won't fire because the finger travels). Mirrors the
       interactive-target guard the media-profile gesture already uses. */
    const interactiveStart = event.target && event.target.closest
      ? event.target.closest('button, a, input, textarea, select, [role="button"]')
      : null;
    if (interactiveStart && !interactiveStart.closest('.dm-v2-back')) return;
    /* If no back target exists at all on this page, don't even start. */
    if (!findBackTarget()) return;

    startX = touch.clientX;
    startY = touch.clientY;
    lastX = touch.clientX;
    startTs = Date.now();
    active = true;
    cancelled = false;
    dragStartHookFired = false;

    /* v10.383: If a draggable overlay is showing, grab its surface and
       prepare it for direct-manipulation drag. */
    const draggable = findDraggableForCurrentBack();
    if (draggable) {
      activateDragSurface(draggable.surface, draggable.config);
    } else {
      dragSurface = null;
      dragConfig = null;
    }
  }

  function onTouchMove(event) {
    if (!active) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = Math.abs(touch.clientY - startY);

    /* Tight vertical-cancel threshold so diagonally-down swipes don't
       accidentally trigger back. */
    if (dy > VERTICAL_CANCEL_PX && dy > Math.abs(dx)) {
      active = false;
      cancelled = true;
      snapIndicatorBack();
      releaseDragSurface(true);
      return;
    }

    if (dragSurface) {
      /* v10.383: drag the page itself. Clamp at 0 so the surface never
         travels leftward past its resting position. Opacity stays at 1 —
         the underlying page is revealed by the surface moving. */
      const tx = Math.max(0, dx);
      dragSurface.style.transform = `translate3d(${tx}px, 0, 0)`;
      dragSurface.style.opacity = '1';
      /* v10.837: fire onDragStart() the first frame we actually move the
         surface. Perfect timing for the page to render any underlay (e.g.
         the DM inbox) so it's revealed in sync with the chat sliding. */
      if (!dragStartHookFired && tx > 0) {
        dragStartHookFired = true;
        try { dragConfig && dragConfig.onDragStart && dragConfig.onDragStart(); } catch (_) {}
      }
    } else if (dx > 6) {
      updateIndicator(dx);
    }
    lastX = touch.clientX;
  }

  function onTouchEnd(event) {
    if (!active && !cancelled && !dragSurface) return;
    const dx = lastX - startX;
    const duration = Date.now() - startTs;
    active = false;

    if (cancelled || duration > MAX_DURATION_MS) {
      snapIndicatorBack();
      releaseDragSurface(true);
      cancelled = false;
      return;
    }
    if (dragSurface) {
      finishDragSurface(dx);
      snapIndicatorBack();
      return;
    }
    if (dx >= TRIGGER_DELTA_PX) {
      /* Fire back, then hide the indicator. */
      fireBack();
    }
    snapIndicatorBack();
  }

  function onTouchCancel() {
    active = false;
    cancelled = false;
    snapIndicatorBack();
    releaseDragSurface(true);
  }

  /* v10.383: Drag-surface lifecycle helpers.

     finishDragSurface(dx):
       Called on touchend with a live drag. If dx ≥ TRIGGER_DELTA_PX,
       animate the surface off-screen to the right (still 100% opacity),
       then invoke the overlay's dismiss handler so its normal cleanup
       (scroll restore, state teardown) runs. Otherwise, snap the surface
       back to translate3d(0,0,0).

     releaseDragSurface(restoreInlineStyles):
       Hard-reset the inline transform / transition / will-change we set
       on touchstart. Used when the gesture is cancelled before any
       meaningful movement so the surface is left exactly as we found it. */
  function finishDragSurface(dx) {
    const surface = dragSurface;
    const config = dragConfig;
    const savedPrevTransition = dragPrevTransition;
    const savedPrevTransform = dragPrevTransform;
    const savedPrevWillChange = dragPrevWillChange;
    const savedSurfaceTouchAction = dragSurfacePrevTouchAction;
    const savedSurfaceBorderRadius = dragSurfacePrevBorderRadius;
    const savedSurfaceOverflow = dragSurfacePrevOverflow;
    const savedSurfaceAnimation = dragSurfacePrevAnimation;
    const scrollEl = dragScrollEl;
    const scrollPrevOverflow = dragScrollPrevOverflow;
    const scrollPrevTouchAction = dragScrollPrevTouchAction;
    const scrollPrevOverscroll = dragScrollPrevOverscroll;
    const savedScrollTop = dragScrollTop;
    detachDragPreventScroll();
    clearDragScrollLockState();
    dragSurface = null;
    dragConfig = null;
    if (!surface) return;

    if (dx >= TRIGGER_DELTA_PX) {
      /* v10.838: per-config animation duration. Some pages need a more
         gradual release feel than the generic 320ms (e.g. DM thread which
         was previously animated via a 600ms inbox-slide-in tap-back —
         users built muscle memory for that pace). Falls back to 320ms. */
      const ms = (config && typeof config.dismissAnimationMs === 'number')
        ? config.dismissAnimationMs : 320;
      const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
      const offscreenX = Math.max(window.innerWidth || 390, surface.getBoundingClientRect().width || 0) + 48;
      const toTransform = `translate3d(${offscreenX}px, 0, 0)`;
      const finishDismiss = () => {
        try { config && config.dismiss && config.dismiss(); } catch (_) {}
      };
      if (config && config.useWebAnimation
          && animateDragSurfaceTransform(surface, toTransform, ms, easing, finishDismiss)) {
        return;
      }
      const motion = `${ms}ms ${easing}`;
      surface.style.transition = `transform ${motion}`;
      /* v10.838: force a reflow so the browser commits the new transition
         BEFORE the transform change is processed. Without this, both
         style writes can batch into a single computed-style update and
         the browser sees the transform change with no prior "old" state —
         no transition fires, the panel just jumps. */
      void surface.offsetWidth;
      surface.style.transform = toTransform;
      surface.style.opacity = '1';
      window.setTimeout(finishDismiss, ms);
    } else {
      surface.style.transition = 'transform 220ms cubic-bezier(0.33, 1, 0.68, 1)';
      surface.style.transform = 'translate3d(0, 0, 0)';
      surface.style.opacity = '';
      window.setTimeout(() => {
        if (!surface.isConnected) return;
        surface.style.transition = savedPrevTransition;
        surface.style.transform = savedPrevTransform;
        surface.style.willChange = savedPrevWillChange;
        surface.style.touchAction = savedSurfaceTouchAction;
        surface.style.borderRadius = savedSurfaceBorderRadius;
        surface.style.overflow = savedSurfaceOverflow;
        /* v10.838: restore inline animation we cleared on activate. */
        surface.style.animation = savedSurfaceAnimation;
        if (scrollEl && scrollEl.isConnected) {
          scrollEl.style.overflow = scrollPrevOverflow;
          scrollEl.style.touchAction = scrollPrevTouchAction;
          scrollEl.style.overscrollBehavior = scrollPrevOverscroll;
          scrollEl.scrollTop = savedScrollTop;
        }
      }, 240);
    }
  }

  function releaseDragSurface(restoreInlineStyles) {
    const surface = dragSurface;
    const scrollEl = dragScrollEl;
    const savedPrevTransition = dragPrevTransition;
    const savedPrevTransform = dragPrevTransform;
    const savedPrevWillChange = dragPrevWillChange;
    const savedSurfaceTouchAction = dragSurfacePrevTouchAction;
    const savedSurfaceBorderRadius = dragSurfacePrevBorderRadius;
    const savedSurfaceOverflow = dragSurfacePrevOverflow;
    const savedSurfaceAnimation = dragSurfacePrevAnimation;
    const scrollPrevOverflow = dragScrollPrevOverflow;
    const scrollPrevTouchAction = dragScrollPrevTouchAction;
    const scrollPrevOverscroll = dragScrollPrevOverscroll;
    const savedScrollTop = dragScrollTop;
    detachDragPreventScroll();
    clearDragScrollLockState();
    dragSurface = null;
    dragConfig = null;
    if (!surface) return;
    /* v11.849: ALWAYS lift the scroll-lock (overflow / touch-action / overscroll)
       on both the surface and its scroll child — even on a dismiss
       (restoreInlineStyles === false), which previously returned early and skipped
       this entirely. A "dismissed" page may be REUSED rather than removed (hidden
       then reopened), and leaving it overflow:hidden silently freezes its scrolling
       forever. Restoring these on a truly-removed node is a harmless no-op. */
    if (surface.isConnected) {
      surface.style.overflow = savedSurfaceOverflow;
      surface.style.touchAction = savedSurfaceTouchAction;
    }
    if (scrollEl && scrollEl.isConnected) {
      scrollEl.style.overflow = scrollPrevOverflow;
      scrollEl.style.touchAction = scrollPrevTouchAction;
      scrollEl.style.overscrollBehavior = scrollPrevOverscroll;
      scrollEl.scrollTop = savedScrollTop;
    }
    if (!restoreInlineStyles || !surface.isConnected) return;
    surface.style.transition = savedPrevTransition;
    surface.style.transform = savedPrevTransform;
    surface.style.willChange = savedPrevWillChange;
    surface.style.touchAction = savedSurfaceTouchAction;
    surface.style.borderRadius = savedSurfaceBorderRadius;
    surface.style.overflow = savedSurfaceOverflow;
    /* v10.838: restore inline animation we cleared on activate. */
    surface.style.animation = savedSurfaceAnimation;
    if (scrollEl && scrollEl.isConnected) {
      scrollEl.style.overflow = scrollPrevOverflow;
      scrollEl.style.touchAction = scrollPrevTouchAction;
      scrollEl.style.overscrollBehavior = scrollPrevOverscroll;
      scrollEl.scrollTop = savedScrollTop;
    }
  }

  /* v10.384: helpers for the scroll-lock state introduced this version. */
  function detachDragPreventScroll() {
    if (dragPreventScrollHandler) {
      try { window.removeEventListener('touchmove', dragPreventScrollHandler, { passive: false }); } catch (_) {}
      dragPreventScrollHandler = null;
    }
  }
  function clearDragScrollLockState() {
    dragScrollEl = null;
    dragScrollPrevOverflow = '';
    dragScrollPrevTouchAction = '';
    dragScrollPrevOverscroll = '';
    dragScrollTop = 0;
    dragSurfacePrevTouchAction = '';
    dragSurfacePrevBorderRadius = '';
    dragSurfacePrevOverflow = '';
    dragSurfacePrevAnimation = '';
  }

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchCancel, { passive: true });

  /* Expose for debugging / manual testing */
  window.__shelfdEdgeSwipe = { findBackTarget, fireBack };
})();
