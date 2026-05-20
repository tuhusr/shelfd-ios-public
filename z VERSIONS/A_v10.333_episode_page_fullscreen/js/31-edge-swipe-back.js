/* =============================================================================
   31-edge-swipe-back.js  (v10.266 — initial)
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
    /* Generic */
    '[aria-label="Back" i]',
    '[aria-label="Go back" i]',
    '[aria-label="Close" i]'
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
      return;
    }

    if (dx > 6) {
      updateIndicator(dx);
    }
    lastX = touch.clientX;
  }

  function onTouchEnd(event) {
    if (!active && !cancelled) return;
    const dx = lastX - startX;
    const duration = Date.now() - startTs;
    active = false;

    if (cancelled || duration > MAX_DURATION_MS) {
      snapIndicatorBack();
      cancelled = false;
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
  }

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchCancel, { passive: true });

  /* Expose for debugging / manual testing */
  window.__shelfdEdgeSwipe = { findBackTarget, fireBack };
})();
