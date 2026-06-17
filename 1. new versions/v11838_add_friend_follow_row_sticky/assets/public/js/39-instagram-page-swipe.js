/* =============================================================================
   39-instagram-page-swipe.js
   -----------------------------------------------------------------------------
   instagramPageSwipe — the SINGLE SOURCE OF TRUTH for Instagram-style horizontal
   page-to-page swipe animations in Shelfd. Use this for ANY new horizontal
   page-stack / tab-pager going forward. Do not re-implement per page.

   WHERE IT LIVES
     assets/public/js/39-instagram-page-swipe.js
     Global: window.attachInstagramPageSwipe(container, options)
     (also window.instagramPageSwipe = { name, duration, easing, attach }).

   HOW TO APPLY TO A NEW PAGE STACK
     1. Markup — a fixed-width "viewport" with overflow:hidden, holding a flex
        "track" of N full-width pages laid side by side; each page is
        `flex: 0 0 100%` and scrolls vertically on its own:
          <div class="my-pager">                 <!-- container (gesture target) -->
            <div class="my-track">               <!-- track (translates) -->
              <div class="my-page">…</div>       <!-- flex:0 0 100%; overflow-y:auto -->
              <div class="my-page">…</div>
              <div class="my-page">…</div>
            </div>
          </div>
     2. Attach:
          const ctrl = attachInstagramPageSwipe(pagerEl, {
            track: trackEl,
            pageCount: 3,
            getIndex: () => currentIndex,
            onIndexChange: (i) => { currentIndex = i; updateTabs(i); },
            duration: 450,                 // optional (default 360)
            lockTarget: overlayEl,         // where the active-swipe class lands
          });
        Navigate programmatically (e.g. tab taps): ctrl.goTo(index, true).
        Cleanup when the page is destroyed: ctrl.destroy().
     3. CSS — lock vertical scroll ONLY while swiping (the preset toggles the
        `activeClass` on `lockTarget` for the duration of an active swipe):
          .my-overlay.horizontal-swipe-active .my-page { overflow: hidden; touch-action: pan-x; }

   TIMING / EASING
     - Drag: finger-tracked 1:1, NO css transition, rAF transform writes only.
     - Release settle (complete or snap-back): `duration` ms (default 360),
       easing cubic-bezier(.22, 1, .36, 1). Completes when the drag passes
       ~30% of the page width OR has enough horizontal velocity; else snaps back.
     - Slight resistance at the first / last page.

   VERTICAL SCROLL
     Disabled ONLY during an active horizontal swipe (after horizontal intent is
     confirmed) and re-enabled the instant the gesture ends or is cancelled.
     Normal vertical scrolling is untouched when not swiping. Taps / buttons /
     inputs / links / media cards are never blocked (preventDefault only fires
     once a horizontal swipe is engaged; text inputs are ignored entirely).

   PERFORMANCE
     translate3d only (never left/right/margin/width/layout); only the single
     `track` layer (active + adjacent page) moves; `will-change: transform` is set
     inline only while dragging/settling and removed afterwards; no blur / filter
     / shadow is animated. Smooth on iOS Capacitor at 60fps and 120Hz.

   OPTIONS
     track            (Element, required)  the element that translates for paging
     pageCount        (number|fn)          page count (default: track child count)
     getIndex         (fn → number)        current page index (default 0)
     onIndexChange    (fn(index))          called when the active page changes
     canGoNext        (fn(index)→bool)     default index < pageCount-1
     canGoPrevious    (fn(index)→bool)     default index > 0
     duration         (number ms)          default 360
     easing           (string)             default cubic-bezier(.22,1,.36,1)
     getWidth         (fn → number)        default container.clientWidth
     activeClass      (string)             default 'horizontal-swipe-active'
     lockTarget       (Element)            element the activeClass lands on
                                           (default: container)
     scrollContainers (Element[]|fn)       optional: also inline-lock these while
                                           swiping (for pages with no scoped CSS)
     edgeCloseElement (Element)            optional: swiping "previous" past the
                                           first page finger-tracks + slides THIS
                                           element off, then calls onEdgeClose
     onEdgeClose      (fn)                 called when an edge-close completes
     enabled          (bool)               default true

   RETURNS { goTo(index, animate), setEnabled(bool), destroy() }
   ============================================================================= */
(function () {
  'use strict';

  const DEFAULT_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const DEFAULT_DURATION = 360;
  const ENGAGE_PX = 8;          // horizontal intent threshold
  const RESIST = 0.32;          // edge resistance factor

  function attachInstagramPageSwipe(container, options) {
    options = options || {};
    const track = options.track;
    const NOOP = { goTo() {}, setEnabled() {}, destroy() {} };
    if (!container || !track) return NOOP;

    const easing = options.easing || DEFAULT_EASE;
    const duration = Number(options.duration) > 0 ? Number(options.duration) : DEFAULT_DURATION;
    const activeClass = options.activeClass || 'horizontal-swipe-active';
    const lockTarget = options.lockTarget || container;
    const edgeEl = options.edgeCloseElement || null;

    const pageCount = () => {
      const n = typeof options.pageCount === 'function' ? options.pageCount() : options.pageCount;
      return Math.max(1, Number(n) || track.children.length || 1);
    };
    const getIndex = () => {
      const i = typeof options.getIndex === 'function' ? Number(options.getIndex()) : 0;
      return Math.max(0, Math.min(pageCount() - 1, isNaN(i) ? 0 : i));
    };
    const getWidth = () => {
      if (typeof options.getWidth === 'function') return options.getWidth() || container.clientWidth || window.innerWidth || 390;
      return container.clientWidth || window.innerWidth || 390;
    };
    const canNext = (i) => (typeof options.canGoNext === 'function') ? !!options.canGoNext(i) : i < pageCount() - 1;
    const canPrev = (i) => (typeof options.canGoPrevious === 'function') ? !!options.canGoPrevious(i) : i > 0;

    let enabled = options.enabled !== false;
    let width = 0, index = 0, base = 0;
    let startX = 0, startY = 0, lastX = 0, lastTime = 0, velocityX = 0, engageOffset = 0;
    let armed = false, engaged = false, mode = '', activePointerId = null;
    let rafId = 0, pending = 0, movingEl = null;

    const lockScroll = (lock) => {
      let els = options.scrollContainers;
      if (typeof els === 'function') els = els();
      if (!els) return;
      if (!Array.isArray(els)) els = [els];
      els.forEach(el => { if (el) { el.style.overflow = lock ? 'hidden' : ''; el.style.touchAction = lock ? 'pan-x' : ''; } });
    };
    const startLock = () => { lockTarget.classList.add(activeClass); lockScroll(true); };
    const endLock = () => { lockTarget.classList.remove(activeClass); lockScroll(false); };

    /* per-frame: ONLY a composited transform write — no transition, no layout. */
    const renderFrame = () => { rafId = 0; if (movingEl) movingEl.style.transform = `translate3d(${pending}px, 0, 0)`; };
    const requestFrame = () => { if (!rafId) rafId = requestAnimationFrame(renderFrame); };
    const clearFrame = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

    const settle = (el, px, after) => {
      el.style.transition = `transform ${duration}ms ${easing}`;
      el.style.transform = `translate3d(${px}px, 0, 0)`;
      window.setTimeout(after, duration + 20);
    };
    const dropLayers = () => { track.style.willChange = ''; if (edgeEl) edgeEl.style.willChange = ''; };

    const positionTrack = (i, animate) => {
      const w = getWidth();
      const px = -Math.max(0, Math.min(pageCount() - 1, i)) * w;
      if (animate) {
        track.style.willChange = 'transform';
        settle(track, px, () => { track.style.transition = ''; dropLayers(); });
      } else {
        track.style.transition = 'none';
        track.style.transform = `translate3d(${px}px, 0, 0)`;
      }
    };

    const onDown = (event) => {
      if (!enabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const fc = event.target && event.target.closest
        ? event.target.closest('input, textarea, select, [contenteditable="true"]') : null;
      if (fc) return;
      width = getWidth();
      index = getIndex();
      base = -index * width;
      startX = event.clientX; startY = event.clientY; lastX = startX;
      lastTime = performance.now(); velocityX = 0; engageOffset = 0;
      armed = true; engaged = false; mode = ''; movingEl = null;
      activePointerId = event.pointerId != null ? event.pointerId : null;
    };
    const onMove = (event) => {
      if (!armed) return;
      if (activePointerId !== null && event.pointerId !== undefined && event.pointerId !== activePointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      velocityX = (event.clientX - lastX) / dt;
      lastX = event.clientX; lastTime = now;
      if (!engaged) {
        if (Math.abs(dx) > ENGAGE_PX && Math.abs(dx) > Math.abs(dy) * 1.3) {
          engaged = true;
          engageOffset = dx;                 // track 1:1 from HERE → no start jump
          /* dragging "previous" (right) at a page with no previous + an edge-close
             element → close-swipe; otherwise normal page swipe. */
          const wantPrev = dx > 0;
          mode = (wantPrev && !canPrev(index) && edgeEl) ? 'close' : 'page';
          movingEl = (mode === 'close') ? edgeEl : track;
          startLock();
          track.style.transition = 'none';
          if (edgeEl) edgeEl.style.transition = 'none';
          track.style.willChange = 'transform';
          if (edgeEl) edgeEl.style.willChange = 'transform';
          try { container.setPointerCapture && container.setPointerCapture(event.pointerId); } catch (e) {}
        } else if (Math.abs(dy) > Math.abs(dx)) {
          armed = false; return;             // vertical → native scroll
        } else {
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      const local = dx - engageOffset;       // raw 1:1 finger delta from engage
      if (mode === 'close') {
        pending = Math.max(0, Math.min(width, local));
      } else {
        let t = base + local;
        const min = -(pageCount() - 1) * width, max = 0;
        if (t > max) t = max + (t - max) * RESIST;        // resistance past first
        else if (t < min) t = min + (t - min) * RESIST;   // resistance past last
        pending = t;
      }
      requestFrame();
    };
    const onUp = (event) => {
      if (!armed && !engaged) return;
      const endX = (event && typeof event.clientX === 'number') ? event.clientX : startX;
      const local = (endX - startX) - engageOffset;
      const wasEngaged = engaged;
      const m = mode;
      armed = false; engaged = false; mode = '';
      endLock();
      try { if (activePointerId !== null) container.releasePointerCapture && container.releasePointerCapture(activePointerId); } catch (e) {}
      activePointerId = null;
      clearFrame();
      if (!wasEngaged) { dropLayers(); return; }
      if (m === 'close' && edgeEl) {
        const shouldClose = local >= width * 0.32 || (local > 60 && velocityX > 0.35);
        if (shouldClose) settle(edgeEl, width, () => { if (typeof options.onEdgeClose === 'function') options.onEdgeClose(); });
        else settle(edgeEl, 0, () => { edgeEl.style.transition = ''; edgeEl.style.transform = ''; dropLayers(); });
        return;
      }
      let target = index;
      const passed = Math.abs(local) > width * 0.3 || Math.abs(velocityX) > 0.4;
      if (passed) {
        if (local < 0 && canNext(index)) target = index + 1;
        else if (local > 0 && canPrev(index)) target = index - 1;
      }
      if (target !== index && typeof options.onIndexChange === 'function') options.onIndexChange(target);
      settle(track, -target * width, () => { track.style.transition = ''; dropLayers(); });
    };
    const onCancel = () => {
      clearFrame();
      endLock();
      if (engaged) {
        if (mode === 'close' && edgeEl) settle(edgeEl, 0, () => { edgeEl.style.transition = ''; edgeEl.style.transform = ''; dropLayers(); });
        else settle(track, -getIndex() * width, () => { track.style.transition = ''; dropLayers(); });
      } else {
        dropLayers();
      }
      armed = false; engaged = false; mode = ''; activePointerId = null;
    };

    container.addEventListener('pointerdown', onDown, { passive: true });
    container.addEventListener('pointermove', onMove, { passive: false });
    container.addEventListener('pointerup', onUp, { passive: true });
    container.addEventListener('pointercancel', onCancel, { passive: true });

    /* place the track on the current page immediately (no animation) */
    positionTrack(getIndex(), false);

    return {
      goTo(i, animate) {
        const target = Math.max(0, Math.min(pageCount() - 1, Number(i) || 0));
        if (typeof options.onIndexChange === 'function') options.onIndexChange(target);
        positionTrack(target, !!animate);
      },
      setEnabled(v) { enabled = v !== false; },
      destroy() {
        clearFrame();
        endLock();
        dropLayers();
        container.removeEventListener('pointerdown', onDown, { passive: true });
        container.removeEventListener('pointermove', onMove, { passive: false });
        container.removeEventListener('pointerup', onUp, { passive: true });
        container.removeEventListener('pointercancel', onCancel, { passive: true });
      }
    };
  }

  window.attachInstagramPageSwipe = attachInstagramPageSwipe;
  window.instagramPageSwipe = {
    name: 'instagramPageSwipe',
    duration: DEFAULT_DURATION,
    easing: DEFAULT_EASE,
    attach: attachInstagramPageSwipe
  };
})();
