/* =============================================================================
   32-stack-carousel.js  (v10.272 — initial)
   ----------------------------------------------------------------------------
   Powers the horizontal swipe-snap carousel that replaces the inline vertical
   list inside expanded stacked-activity cards.

   What this file does:
     1. Watches the document for new `.sl-activity-stack-carousel` containers
        (they're created dynamically by 10-activity-feed.js whenever a stacked
        activity card is rendered).
     2. For each carousel, attaches a scroll listener that updates the dot
        indicator below the carousel to match the currently-snapped page.
     3. Sets `data-stack-carousel-active="true"` on the carousel root while
        a touch is happening inside it, so 31-edge-swipe-back.js can detect
        the touch originated inside a horizontal carousel and skip its own
        back-gesture logic (avoiding the conflict where the user's intended
        carousel-swipe also triggers a navigation-back).

   Why a MutationObserver vs. delegation:
     The carousels are recreated whenever the activity feed re-renders. We
     don't want to attach (or leak) listeners per-render. Instead we observe
     the DOM and bind once when a new carousel appears, then unbind on
     remove via the WeakSet of already-bound elements.

   Performance notes:
     - Scroll listener is passive + rAF-throttled so it never blocks paint.
     - Dot updates use class toggles (no re-layout, no DOM creation per scroll).
     - No CSS transitions during scroll — only on snap completion via
       requestAnimationFrame debouncing.
   ========================================================================== */
(function() {
  'use strict';

  /* Track which carousel elements we've already wired up so re-renders
     don't double-attach listeners. WeakSet auto-clears when DOM nodes
     are garbage collected. */
  const wired = new WeakSet();

  function getDotsForCarousel(carousel) {
    const activityId = carousel.getAttribute('data-stack-carousel');
    if (!activityId) return null;
    /* Dots live as a sibling of the carousel inside the same inline-list. */
    const wrap = carousel.closest('.sl-activity-stack-inline-list');
    if (!wrap) return null;
    return wrap.querySelector(`[data-stack-dots="${CSS.escape(activityId)}"]`);
  }

  function updateActiveDot(carousel) {
    const dots = getDotsForCarousel(carousel);
    if (!dots) return;
    const dotEls = dots.querySelectorAll('.sl-activity-stack-carousel-dot');
    if (!dotEls.length) return;
    /* Determine which page is most visible. Each item is full-width, so we
       can just divide scrollLeft by the carousel's clientWidth and round. */
    const width = carousel.clientWidth || 1;
    const raw = carousel.scrollLeft / width;
    const index = Math.max(0, Math.min(dotEls.length - 1, Math.round(raw)));
    dotEls.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === index);
    });
  }

  /* rAF-throttle the scroll handler so we update at most once per frame. */
  function rafThrottle(fn) {
    let scheduled = false;
    let lastArgs = null;
    return function throttled(...args) {
      lastArgs = args;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        try { fn.apply(null, lastArgs); } catch (_) {}
      });
    };
  }

  function bindCarousel(carousel) {
    if (!carousel || wired.has(carousel)) return;
    wired.add(carousel);

    const onScroll = rafThrottle(() => updateActiveDot(carousel));
    carousel.addEventListener('scroll', onScroll, { passive: true });

    /* While the user is actively touching inside this carousel, mark it
       so 31-edge-swipe-back.js can bail out and let the carousel own
       the gesture. */
    const onTouchStart = () => carousel.setAttribute('data-stack-carousel-active', 'true');
    const onTouchEnd = () => carousel.removeAttribute('data-stack-carousel-active');
    carousel.addEventListener('touchstart', onTouchStart, { passive: true });
    carousel.addEventListener('touchend', onTouchEnd, { passive: true });
    carousel.addEventListener('touchcancel', onTouchEnd, { passive: true });

    /* Initial pass — sync dots to scroll position 0. */
    updateActiveDot(carousel);
  }

  /* On first paint, bind everything already in the DOM. */
  function bindAll() {
    const carousels = document.querySelectorAll('.sl-activity-stack-carousel');
    carousels.forEach(bindCarousel);
  }

  /* Watch for new carousels added later (the feed re-renders frequently). */
  function startObserver() {
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (!m.addedNodes || !m.addedNodes.length) continue;
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('.sl-activity-stack-carousel')) {
            bindCarousel(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('.sl-activity-stack-carousel').forEach(bindCarousel);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    bindAll();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* Expose for debugging */
  window.__shelfdStackCarousel = { bindAll, updateActiveDot, bindCarousel };
})();
