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
  /* v10.837: anywhere-horizontal mode state.
     When a registered overlay has `anywhereHorizontal: true`, the gesture
     can start ANYWHERE on the page (not just within the EDGE_DETECT_PX
     strip). In that case we defer applying inline-style mutations to the
     drag surface until the user has committed to a horizontal motion
     (dx >= 14 AND dx > |dy| * 1.18). Until then we hold a reference to
     the candidate surface/config in `pending*`, and let vertical scroll
     through untouched. If vertical dominates first (|dy| > 18 AND |dy| >
     |dx| * 1.05) we cancel — the user wanted to scroll, not navigate back. */
  let needsHorizontalCommit = false;
  let pendingDragSurface = null;
  let pendingDragConfig = null;
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
    /* v10.836: DM v2 thread page — handled by an explicit
       DRAGGABLE_OVERLAYS entry below so dismiss can call
       closeDirectMessageThread({ fromGenericSwipe: true }) and skip the
       panel-transform animation that would otherwise fight the inline
       transform from this drag. Selector still listed here as a fallback
       so findBackTarget() can locate it for the gesture-start gate. */
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
    /* v10.836/v10.837: DM v2 thread page.
       - .dm-v2-panel is position: fixed; top: 0; bottom: var(--dm-keyboard-
         bottom) — drags cleanly under finger via inline transform.
       - `anywhereHorizontal: true` (v10.837): the gesture starts anywhere
         on the page, not just within EDGE_DETECT_PX. The horizontal-commit
         logic in onTouchMove keeps vertical message-list scrolling intact
         until the user clearly intends a horizontal swipe.
       - `onDragStart` (v10.837): renders the inbox underlay at the precise
         moment the chat starts translating. The underlay sits at z-index
         4890 (the chat panel is 4900) so the inbox is revealed in sync
         with the chat sliding right — no "dark void" frame.
       - Dismiss calls closeDirectMessageThread with `fromGenericSwipe:
         true` so the inbox slide-in animation plays but the panel-
         transform classes (with !important) don't fight the inline
         transform that just animated to 100vw.
       - .dm-v2-list scrollable child is locked during the drag so
         vertical scroll doesn't bleed through once committed. */
    {
      backSelector: '.dm-v2-back',
      scrollSelector: '.dm-v2-list',
      anywhereHorizontal: true,
      getSurface() {
        const panel = document.querySelector('.dm-v2-panel');
        return (panel && panel.isConnected) ? panel : null;
      },
      onDragStart() {
        try {
          if (typeof window.renderDirectMessageSwipeInboxUnderlay === 'function') {
            const page = document.getElementById('direct-messages-page');
            window.renderDirectMessageSwipeInboxUnderlay(page);
          }
        } catch (_) {}
      },
      dismiss() {
        try {
          if (typeof window.closeDirectMessageThread === 'function') {
            window.closeDirectMessageThread({ animate: true, fromGenericSwipe: true });
          }
        } catch (_) {}
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

  /* v10.837: scan DRAGGABLE_OVERLAYS for any entry with anywhereHorizontal
     that currently has a visible surface. Used when touchstart begins
     OUTSIDE the EDGE_DETECT_PX strip — only valid if such an overlay is
     active. Returns { surface, config } or null. */
  function findAnywhereHorizontalDraggable() {
    for (const config of DRAGGABLE_OVERLAYS) {
      if (!config.anywhereHorizontal) continue;
      try {
        const btn = document.querySelector(config.backSelector);
        if (!btn || !isElementVisible(btn)) continue;
        const surface = config.getSurface && config.getSurface();
        if (surface && surface.isConnected) return { config, surface };
      } catch (_) {}
    }
    return null;
  }

  function onTouchStart(event) {
    if (event.touches.length !== 1) return;          // multi-touch → not our gesture
    if (isInputFocused()) return;
    const touch = event.touches[0];
    const isEdgeStart = touch.clientX <= EDGE_DETECT_PX;
    /* v10.272: don't fight horizontal swipe carousels. */
    if (isTouchInsideCarousel(event)) return;

    /* v10.837: anywhere-horizontal mode. If the touch is NOT at the edge,
       check if any overlay registered with `anywhereHorizontal: true` is
       currently showing. If yes, allow the gesture to start anywhere but
       defer surface activation until horizontal motion is committed (so
       vertical scroll inside the page works normally up until then). */
    let anywhereDraggable = null;
    if (!isEdgeStart) {
      anywhereDraggable = findAnywhereHorizontalDraggable();
      if (!anywhereDraggable) return;       // not edge AND no anywhere overlay
    } else {
      /* Edge mode: if no back target exists on this page at all, bail. */
      if (!findBackTarget()) return;
    }

    startX = touch.clientX;
    startY = touch.clientY;
    lastX = touch.clientX;
    startTs = Date.now();
    active = true;
    cancelled = false;
    dragStartHookFired = false;

    if (isEdgeStart) {
      /* Edge mode — set up the surface immediately. Original behavior. */
      const draggable = findDraggableForCurrentBack();
      if (draggable) {
        activateDragSurface(draggable.surface, draggable.config);
      } else {
        dragSurface = null;
        dragConfig = null;
      }
    } else {
      /* Anywhere mode — hold the surface reference but DON'T mutate inline
         styles yet. Vertical scroll must still work until we know this is
         a horizontal swipe. */
      pendingDragSurface = anywhereDraggable.surface;
      pendingDragConfig = anywhereDraggable.config;
      needsHorizontalCommit = true;
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

    /* v10.837: anywhere-horizontal mode — must commit to a direction
       before we manipulate any styles or steal the gesture. */
    if (needsHorizontalCommit) {
      /* Vertical wins: let the page scroll normally, abort our gesture. */
      if (dy > 18 && dy > Math.abs(dx) * 1.05) {
        active = false;
        cancelled = true;
        needsHorizontalCommit = false;
        pendingDragSurface = null;
        pendingDragConfig = null;
        return;
      }
      /* Horizontal commit: dx must be both substantial AND clearly
         dominant over the vertical component. 14px / 1.18 ratio matches
         the iMessage/Twitter feel — far enough to mean intent, but tight
         enough that tiny rightward jitters during a vertical scroll
         don't accidentally engage. */
      if (dx >= 14 && dx > dy * 1.18) {
        needsHorizontalCommit = false;
        activateDragSurface(pendingDragSurface, pendingDragConfig);
        pendingDragSurface = null;
        pendingDragConfig = null;
        /* fall through to the drag logic below — the surface is now live. */
      } else {
        /* Still ambiguous — wait without touching the surface or scroll. */
        lastX = touch.clientX;
        return;
      }
    }

    /* Edge-mode vertical cancel (legacy behavior — fires only when the
       gesture started at the edge so we never activated the anywhere
       commit path). Tight threshold to avoid diagonal false-positives. */
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
    /* v10.837: never-committed anywhere-mode → just tear down state. */
    if (needsHorizontalCommit) {
      needsHorizontalCommit = false;
      pendingDragSurface = null;
      pendingDragConfig = null;
    }

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
    /* v10.837: clear anywhere-mode pending state. */
    needsHorizontalCommit = false;
    pendingDragSurface = null;
    pendingDragConfig = null;
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
      const motion = '320ms cubic-bezier(0.22, 1, 0.36, 1)';
      surface.style.transition = `transform ${motion}`;
      surface.style.transform = 'translate3d(100vw, 0, 0)';
      surface.style.opacity = '1';
      window.setTimeout(() => {
        try { config && config.dismiss && config.dismiss(); } catch (_) {}
      }, 320);
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
    const scrollPrevOverflow = dragScrollPrevOverflow;
    const scrollPrevTouchAction = dragScrollPrevTouchAction;
    const scrollPrevOverscroll = dragScrollPrevOverscroll;
    const savedScrollTop = dragScrollTop;
    detachDragPreventScroll();
    clearDragScrollLockState();
    dragSurface = null;
    dragConfig = null;
    if (!surface || !restoreInlineStyles) return;
    if (!surface.isConnected) return;
    surface.style.transition = savedPrevTransition;
    surface.style.transform = savedPrevTransform;
    surface.style.willChange = savedPrevWillChange;
    surface.style.touchAction = savedSurfaceTouchAction;
    surface.style.borderRadius = savedSurfaceBorderRadius;
    surface.style.overflow = savedSurfaceOverflow;
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
  }

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchCancel, { passive: true });

  /* Expose for debugging / manual testing */
  window.__shelfdEdgeSwipe = { findBackTarget, fireBack };
})();
