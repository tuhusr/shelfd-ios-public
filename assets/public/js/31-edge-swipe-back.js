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
        for (const candidate of candidates) {
          if (isElementVisible(candidate)) return candidate;
        }
      } catch (_) {}
    }
    return null;
  }

  /* v10.383: If the currently-visible back target matches a draggable
     overlay config, return that config (with a live surface element);
     otherwise null. */
  function findDraggableForCurrentBack() {
    for (const config of DRAGGABLE_OVERLAYS) {
      try {
        const btn = document.querySelector(config.backSelector);
        if (!btn || !isElementVisible(btn)) continue;
        const surface = config.getSurface && config.getSurface();
        if (surface && surface.isConnected) return { config, surface };
      } catch (_) {}
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

  function onTouchStart(event) {
    if (event.touches.length !== 1) return;          // multi-touch → not our gesture
    if (isInputFocused()) return;
    const touch = event.touches[0];
    if (touch.clientX > EDGE_DETECT_PX) return;       // not at left edge
    /* v10.272: don't fight horizontal swipe carousels. If the touch began
       inside one, let it own the gesture entirely. */
    if (isTouchInsideCarousel(event)) return;
    /* If no back target exists at all on this page, don't even start. Avoids
       false-positive gestures on the root landing screen. */
    if (!findBackTarget()) return;
    startX = touch.clientX;
    startY = touch.clientY;
    lastX = touch.clientX;
    startTs = Date.now();
    active = true;
    cancelled = false;

    /* v10.383: If a draggable overlay is showing (e.g. the My List episode
       page), grab its surface and prepare it for direct-manipulation drag.
       The surface follows the finger horizontally; the indicator stays
       hidden because the moving page itself is the visual feedback. */
    const draggable = findDraggableForCurrentBack();
    if (draggable) {
      dragSurface = draggable.surface;
      dragConfig = draggable.config;
      dragPrevTransform = dragSurface.style.transform || '';
      dragPrevTransition = dragSurface.style.transition || '';
      dragPrevWillChange = dragSurface.style.willChange || '';
      dragSurface.style.transition = 'none';
      dragSurface.style.willChange = 'transform';

      /* v10.384: Lock the outgoing page so it can't scroll while the
         surface is being dragged. Three layers of defense:
           1) freeze the scroll container's overflow + touch-action and
              preserve its current scrollTop so nothing visually jumps,
           2) set touch-action: none on the surface itself so the browser
              never tries to interpret the move as a native pan,
           3) attach a non-passive touchmove listener that preventDefault's
              every move while the drag is live, killing any momentum
              scroll that might already be in flight. */
      dragSurfacePrevTouchAction = dragSurface.style.touchAction || '';
      dragSurface.style.touchAction = 'none';
      /* v10.385: round the outgoing page's corners while it's being
         swiped out. v10.388: bumped to 45px per spec; overflow:hidden so
         internal content (poster, episode rows) is clipped to the rounded
         shape. */
      dragSurfacePrevBorderRadius = dragSurface.style.borderRadius || '';
      dragSurfacePrevOverflow = dragSurface.style.overflow || '';
      dragSurface.style.borderRadius = '45px';
      dragSurface.style.overflow = 'hidden';
      /* v10.386: scroll element is selected per draggable-overlay config so
         every page can name its own scroll container. */
      const scrollSelector = dragConfig && dragConfig.scrollSelector;
      const scrollEl = scrollSelector ? dragSurface.querySelector(scrollSelector) : null;
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

    /* Cancel if it's becoming a vertical scroll. We use a tight threshold
       so that diagonally-down swipes don't accidentally trigger back. */
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
         the underlying My List page is revealed by the surface moving. */
      const tx = Math.max(0, dx);
      dragSurface.style.transform = `translate3d(${tx}px, 0, 0)`;
      dragSurface.style.opacity = '1';
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
