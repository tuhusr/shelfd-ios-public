/* =============================================================================
   My List status-tab horizontal swipe  (v11.397)
   File: assets/public/js/40-mylist-status-swipe.js

   Swipe left/right inside the card area of the My List / My Shelf page to move
   between the STATUS tabs of the CURRENT category (categories themselves are
   still changed only by tapping the category buttons). Order per category:
     games  → Playing · Backlog · Played · Wishlist   (watching·planned·watched·wishlist)
     anime  → Watching · Watchlist · Watched · Paused  (watching·planned·watched·paused)
     music  → Listened · Planned                       (watched·planned)
     movies → Watchlist · Watched · Paused             (planned·watched·paused)
     tv     → Watching · Watchlist · Watched · Paused  (watching·planned·watched·paused)

   Physics derive from the instagramPageSwipe / discover-hub preset, since tuned
   for the Shelf: finger-tracked 1:1 (no start jump), 360ms easeOutCubic
   (cubic-bezier(0.33,1,0.68,1)) settle, 0.3 width / 0.4 px·ms commit, edge
   resistance, single rAF transform write, compositor-only underline, plus a
   visible-card preview cap with top-poster decode/adoption (see below).

   TAP-SAFE (this is why the V300 status-swipe was removed): we only engage on a
   CLEAR horizontal intent (dx > dy*1.3 past 8px) and only call preventDefault
   AFTER engaging — so taps on cards / episode checks / status buttons / stars
   are never blocked, and a mostly-vertical drag scrolls the page normally.

   Current page = the live #cards-grid (translated). Incoming page = a transient
   fixed layer whose cards come from buildMyListCardsHTMLForTab(targetTab); on
   commit we switchTab() to render the real content and drop the layer.
   ========================================================================== */
(function () {
  'use strict';

  const INTENT_THRESHOLD = 8;         // px before deciding H vs V (= preset ENGAGE_PX)
  const INTENT_RATIO = 1.3;           // dx must exceed dy*ratio to engage (bias to vertical scroll)
  const COMMIT_DISTANCE_RATIO = 0.3;  // fraction of width to commit
  const COMMIT_VELOCITY = 0.4;        // px/ms fling that commits regardless
  const EDGE_RESIST = 0.32;           // rubber-band at the first/last tab
  const SETTLE_MS = 360;              // commit / snap-back length (v11.425: 450 → 360, snappier)
  /* v11.429: easeOutCubic (was easeOutQuint, which front-loaded ~97% of the
     motion and made the landing feel abrupt). Softer, more even deceleration so
     the page "falls into place"; no overshoot. Drives the page AND the underline. */
  const SETTLE_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
  const LEFT_EDGE_GUARD = 30;         // leave the left edge to the friend-shelf swipe-back

  let deciding = false, active = false;
  let startX = 0, startY = 0, lastX = 0, prevX = 0, lastT = 0, prevT = 0;
  let width = 1, dir = 0, engageOffset = 0;
  let currentPanel = null, incomingPanel = null, targetTab = null;
  let pendingDx = 0, rafId = 0;
  /* v11.424: the ONE in-flight settle. Identity-tracked so a late transitionend
     from a superseded swipe can be recognised as stale and ignored. */
  let currentSettle = null;
  /* v11.425/426: status underline ("sliding pill") drive state. Compositor-only:
     width is fixed at gesture start; every frame writes ONLY a transform. */
  let pillNode = null, pillFrom = null, pillTo = null;
  let pillBaseW = 0, pillDest = null, pillLastTf = '';
  let lastAppliedDx = NaN;   // redundant-frame guard for the page transform writes

  function statusOrder() {
    const map = (typeof SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION !== 'undefined')
      ? SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION : null;
    if (!map || typeof activeSection === 'undefined') return [];
    return map[activeSection] || map.shows || [];
  }
  function currentIndex() {
    return statusOrder().indexOf(typeof activeTab !== 'undefined' ? activeTab : '');
  }

  function overlayOpen() {
    return !!document.querySelector(
      '.discover-media-profile-overlay, .game-media-profile-overlay, .mylist-game-profile-page, ' +
      '.mylist-media-review-page, .profile-social-page-overlay, .card-comment-composer-overlay, ' +
      '.mylist-game-profile-highlight-modal, #feed-post-page.is-open'
    );
  }

  function swipeIsActive() {
    if (typeof getActiveMainTab !== 'function' || getActiveMainTab() !== 'mylist') return false;
    const view = document.getElementById('mylist-view');
    if (!view || view.style.display === 'none') return false;
    if (document.body.classList.contains('shelf-locked-private')) return false; // private shelf lock
    if (document.body.classList.contains('friend-shelf-swiping')) return false;
    if (document.body.classList.contains('friend-home-transitioning')) return false;
    if (overlayOpen()) return false;
    /* v11.401: a card's status-change popout is open — disable the status swipe
       so the horizontally-scrollable status tray (.game-status-options) can be
       scrolled / tapped without the swipe hijacking the gesture. */
    if (document.querySelector('.game-status-selector.expanded')) return false;
    /* v11.470: a card's star rating bubble (SRBB) is expanded — disable the status
       swipe ENTIRELY so scrubbing the stars left/right to set a rating is never
       hijacked by the horizontal page swipe. Stays disabled until the bubble is
       fully closed (the .is-expanded class is removed on tap-away and on the
       post-rating auto-collapse). Applies to every card on the Shelf / My List. */
    if (document.querySelector('.rating-bubble.is-expanded')) return false;
    const modal = document.getElementById('modal');
    if (modal && getComputedStyle(modal).display !== 'none') return false;
    if (statusOrder().length < 2) return false;
    return true;
  }

  const gridEl = () => document.getElementById('cards-grid');

  function cancelFrame() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function renderFrame() {
    rafId = 0;
    if (!active || !currentPanel) return;
    if (pendingDx === lastAppliedDx) return;   // skip a frame that would re-write identical transforms
    lastAppliedDx = pendingDx;
    applyDrag(pendingDx);
  }
  function scheduleFrame() { if (!rafId) rafId = requestAnimationFrame(renderFrame); }

  function clearPanelMotion(el) {
    if (!el) return;
    el.style.removeProperty('transform');
    el.style.removeProperty('transition');
    el.style.removeProperty('will-change');
  }

  /* Remove EVERY incoming layer except the one the live gesture currently owns.
     This is the recovery net for orphaned/ghost layers left by a prior race. */
  function sweepGhosts() {
    const nodes = document.querySelectorAll('.mylist-status-swipe-incoming');
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] !== incomingPanel) { try { nodes[i].remove(); } catch (e) {} }
    }
  }

  /* ---------------------------------------------------------------------------
     v11.425: status underline ("sliding pill") tracking.

     During a finger drag the underline interpolates 1:1 from the active status to
     the target; on settle it animates to its final spot IN SYNC with the page
     (same 360ms ease) instead of snapping after the page lands. It's the same
     .tab-sliding-pill the tap path uses (taps still spring as before). The
     window.__setMyListSwipePillLock(true) keeps render()'s updateSlidingPills from
     fighting the manual drive mid-gesture. */
  function setSwipePillLock(v) {
    try { if (typeof window.__setMyListSwipePillLock === 'function') window.__setMyListSwipePillLock(v); } catch (e) {}
  }
  function pillGeom(btn) {
    if (!btn) return null;
    const UH = 3, bw = btn.offsetWidth;
    const w = Math.round(bw * 0.70);
    return { x: btn.offsetLeft + Math.round((bw - w) / 2), y: btn.offsetTop + btn.offsetHeight - UH, w: w };
  }
  /* v11.426: COMPOSITOR-ONLY underline. Width is fixed to a base at gesture start;
     every frame writes ONLY a transform (translateX + scaleX) — never `width`,
     which forced a layout/reflow per frame and was the cause of the underline
     (and, via per-frame layout invalidation, the page) frame-skipping.
     transform-origin:0 0 makes scaleX grow from the left edge so the box is exact:
     rendered span = [x, x + baseW*scaleX]; we pick x and scaleX=w/baseW to match. */
  function applyPillGeom(g) {
    if (!pillNode || !g || pillBaseW <= 0) return;
    const s = g.w / pillBaseW;
    const tf = 'translate3d(' + (Math.round(g.x * 100) / 100) + 'px,' + g.y + 'px,0) scaleX(' + (Math.round(s * 1000) / 1000) + ')';
    if (tf === pillLastTf) return;                 // skip redundant style write (no churn when idle)
    pillLastTf = tf;
    pillNode.style.transform = tf;
  }
  function startPillDrive() {
    const tabs = document.querySelector('#mylist-view #mylist-toolbar .tabs');
    pillNode = tabs ? tabs.querySelector('.tab-sliding-pill') : null;
    pillFrom = pillNode ? pillGeom(tabs.querySelector('.tab-btn.active')) : null;
    pillTo = (pillNode && targetTab) ? pillGeom(tabs.querySelector('.tab-btn[data-tab="' + targetTab + '"]')) : null;
    if (!pillNode || !pillFrom || pillFrom.w <= 0) { pillNode = null; pillFrom = pillTo = null; return; }
    pillBaseW = pillFrom.w;
    pillDest = null;
    pillLastTf = '';
    setSwipePillLock(true);
    pillNode.classList.add('pill-init');           // CSS transition off → 1:1 tracking
    pillNode.style.transformOrigin = '0 0';
    pillNode.style.width = pillBaseW + 'px';       // width set ONCE; never re-written per frame
    applyPillGeom(pillFrom);                        // scaleX 1 baseline
  }
  function drivePill(progress) {
    if (!pillNode || !pillFrom || !pillTo) return;
    const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    applyPillGeom({
      x: pillFrom.x + (pillTo.x - pillFrom.x) * p,
      y: pillFrom.y,                                // same row → constant, no vertical work
      w: pillFrom.w + (pillTo.w - pillFrom.w) * p
    });
  }
  function settlePill(commit) {
    if (!pillNode) return;
    pillNode.classList.remove('pill-init');
    /* inline !important beats the stylesheet's !important spring → the underline
       rides the SAME 360ms TRANSFORM transition as the page (compositor-only;
       no width in the transition list anymore). */
    pillNode.style.setProperty('transition', 'transform ' + SETTLE_MS + 'ms ' + SETTLE_EASE, 'important');
    pillDest = commit ? (pillTo || pillFrom) : pillFrom;
    applyPillGeom(pillDest);
  }
  function releasePill() {
    if (pillNode) {
      const node = pillNode;
      /* normalise back to the tap-path format (plain width + translate, scaleX 1,
         default origin) at the final spot. Identical rendered box → no jump. Do it
         with the transition OFF so the origin/scale swap can't animate-glitch,
         then restore the CSS spring a couple of frames later for future taps. */
      node.style.setProperty('transition', 'none', 'important');
      node.classList.remove('pill-init');
      const g = pillDest || pillFrom;
      if (g) {
        node.style.width = g.w + 'px';
        node.style.removeProperty('transform-origin');
        node.style.transform = 'translate3d(' + g.x + 'px,' + g.y + 'px,0)';
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { try { node.style.removeProperty('transition'); } catch (e) {} });
      });
    }
    pillNode = null; pillFrom = null; pillTo = null; pillDest = null; pillBaseW = 0; pillLastTf = '';
    setSwipePillLock(false);
  }

  /* v11.427: how many cards the preview needs to fill the visible viewport (plus
     a 2-row buffer). Measured ONCE from the live grid at gesture start — before
     any transform writes — so the preview never builds the whole (possibly huge)
     status. Columns are counted by the first row's shared offsetTop (robust for
     grid OR flex); card height is sampled from the current grid's first card. */
  function visiblePreviewCount() {
    try {
      const grid = currentPanel;
      const kids = grid && grid.children;
      if (!kids || !kids.length) return 18;
      const top0 = kids[0].offsetTop;
      let cols = 0;
      for (let i = 0; i < kids.length; i++) { if (kids[i].offsetTop === top0) cols++; else break; }
      cols = Math.max(1, cols);
      const cardH = kids[0].getBoundingClientRect().height || 240;
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const rows = Math.ceil(vh / Math.max(110, cardH)) + 2;   // +2 buffer rows
      return Math.max(cols * rows, 12);
    } catch (e) { return 18; }
  }

  /* Build the incoming status page as a fixed layer that occupies the live
     grid's EXACT box (left/top/width). v11.402: previously the layer was full
     viewport width (left:0;right:0) while the real #cards-grid sits inside the
     padded stage — so the preview cards rendered wider + slightly offset (the
     "distorted" flash). Matching the grid's box makes the preview pixel-identical
     to the real cards, and the inner .grid mirrors the live grid's layout. */
  function buildIncoming(rect) {
    const layer = document.createElement('div');
    layer.className = 'mylist-status-swipe-incoming';
    /* v11.405: absolute (not fixed); top/left are corrected for the containing
       block after append (see below). */
    layer.style.cssText =
      'position:absolute;top:0;left:0;margin:0;overflow:hidden;z-index:5;' +
      'will-change:transform;transition:none;background:#0E0E0E;pointer-events:none;';
    /* v11.406: the layer is FULL viewport width (so a page fully clears the
       screen on commit — no padding-wide sliver of the old page left on the
       edge). The inner .grid keeps the real grid's width and is inset by
       rect.left so the cards still line up with the live grid. */
    const vw = window.innerWidth || document.documentElement.clientWidth || 390;
    layer.style.width = vw + 'px';
    const inner = document.createElement('div');
    inner.className = 'grid mylist-status-swipe-grid';
    inner.style.width = Math.round(rect.width) + 'px';
    inner.style.marginLeft = Math.round(rect.left) + 'px';
    inner.style.boxSizing = 'border-box';
    const cs = getComputedStyle(currentPanel);
    ['display', 'gridTemplateColumns', 'gap', 'rowGap', 'columnGap',
     'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
     'justifyContent', 'alignItems', 'justifyItems'].forEach(prop => {
      try { inner.style[prop] = cs[prop]; } catch (e) {}
    });
    /* v11.427: build ONLY the immediately-visible cards for the preview (not the
       whole status — an expanded Watched/Paused tab can hold 36+). This keeps the
       per-status preview build + image-decode work equal/light for every status
       pair, killing the status-specific hitch. The rest of the status is built by
       render() at commit and stays off-screen+lazy. */
    const previewCap = visiblePreviewCount();
    inner.innerHTML = (typeof buildMyListCardsHTMLForTab === 'function')
      ? buildMyListCardsHTMLForTab(targetTab, previewCap) : '';
    /* v11.402: the layer starts off-screen, so lazy images wouldn't load until
       they slide in — a blank→pop flash. Force ONLY the (now few) preview covers
       to decode up front. */
    /* v11.402/429: the layer starts off-screen, so lazy images wouldn't load
       until they slide in — a blank→pop flash. Force the (few, capped) preview
       covers to LOAD now, AND DECODE the top cards' posters off-screen so they're
       a ready bitmap at commit. `loading=eager` only LOADS; the decode otherwise
       happens on first paint — which is exactly why posters 3–4 could still flash
       even after the top two were stable. Decoding the top rows' posters
       guarantees the top four visible posters are stable the instant the page
       lands (covers 1-, 2-, and 3-column layouts with a buffer row). */
    const previewCards = inner.children;
    for (let c = 0; c < previewCards.length; c++) {
      const cardImgs = previewCards[c].querySelectorAll('img');
      for (let k = 0; k < cardImgs.length; k++) { try { cardImgs[k].loading = 'eager'; } catch (e) {} }
      const poster = cardImgs[0];
      if (c < 6 && poster && typeof poster.decode === 'function') {
        try { poster.decode().catch(function () {}); } catch (e) {}
      }
    }
    layer.appendChild(inner);
    /* v11.404/v11.405: append INSIDE #mylist-view so the ~156 `#mylist-view
       .card…` style rules apply (identical look). BUT #mylist-view (or an
       ancestor) carries a transform (the friend-shelf swipe-back layer), which
       makes an absolute/fixed child position relative to IT, not the viewport —
       that shifted the preview hundreds of px down. Fix: append at top:0/left:0,
       measure where that lands (the containing-block origin), then offset to the
       live grid's exact viewport box. Robust for whatever the block is. */
    (document.getElementById('mylist-view') || document.body).appendChild(layer);
    const at = layer.getBoundingClientRect();
    /* v11.406: the layer is full viewport width, so its left edge sits at
       viewport x=0 (corrected for whatever containing block #mylist-view's
       transform establishes). The inner grid carries the inset (marginLeft). */
    layer.style.left = Math.round(0 - at.left) + 'px';
    layer.style.top = Math.round(rect.top - at.top) + 'px';
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    layer.style.height = Math.round(Math.max(240, vh - rect.top + 80)) + 'px';
    return layer;
  }

  function beginGesture(firstDx) {
    /* v11.424: SUPERSEDE — instantly finish any in-flight settle (lands the prior
       swipe + cleans up) and sweep any orphaned layers, so the new gesture starts
       from a single, correct, clean state. This is what kills the stuck/ghost page
       on fast repeated swipes. */
    forceFinishSettle();
    sweepGhosts();
    const idx = currentIndex();
    if (idx < 0) return false;
    currentPanel = gridEl();
    if (!currentPanel) return false;
    clearPanelMotion(currentPanel);          // start from 0 with no leftover easing
    lastAppliedDx = NaN;                      // first frame of the new gesture always applies
    const rect = currentPanel.getBoundingClientRect();
    /* v11.406: page width = the VIEWPORT width (not the grid's narrower width).
       The grid is inset from the screen edges by the stage padding; translating
       it by only the grid width left a padding-wide sliver of the OLD page stuck
       on the screen edge after committing. Moving by the full viewport width
       guarantees the outgoing page clears the screen completely. The incoming
       preview is full-viewport-width too, with its inner grid inset to match the
       real grid, so the cards still line up exactly. */
    width = window.innerWidth || document.documentElement.clientWidth || Math.round(rect.width) || 1;

    dir = firstDx < 0 ? 1 : -1;             // finger left → next tab ; right → prev tab
    const targetIdx = idx + dir;
    document.body.classList.add('mylist-status-swiping');
    currentPanel.style.transition = 'none';
    currentPanel.style.willChange = 'transform';

    const order = statusOrder();
    if (targetIdx < 0 || targetIdx >= order.length) {
      targetTab = null;                     // at an end → rubber-band only
      incomingPanel = null;
      return true;
    }
    targetTab = order[targetIdx];
    incomingPanel = buildIncoming(rect);
    incomingPanel.style.transform = 'translate3d(' + (dir * width) + 'px,0,0)';
    startPillDrive();                       // v11.425: underline tracks from here
    return true;
  }

  function applyDrag(dx) {
    if (!targetTab || !incomingPanel) {
      currentPanel.style.transform = 'translate3d(' + (dx * EDGE_RESIST) + 'px,0,0)';
      return;
    }
    currentPanel.style.transform = 'translate3d(' + dx + 'px,0,0)';
    incomingPanel.style.transform = 'translate3d(' + (dir * width + dx) + 'px,0,0)';
    drivePill(Math.abs(dx) / width);        // v11.425: underline follows the finger 1:1
  }

  /* ---------------------------------------------------------------------------
     Transition state machine.

     Every completion path funnels through completeSettle(s). It is IDEMPOTENT
     (the per-settle `done` latch) and operates ONLY on the settle's OWN captured
     node refs (s.panel / s.incoming) — never the shared module vars — so a late
     transitionend or timeout from a SUPERSEDED swipe can't render the wrong tab
     or remove the new gesture's layer. Shared state + the swiping class are reset
     only when this settle is still the active one (currentSettle === s). A final
     sweepGhosts() guarantees no orphan layer can survive. */
  function completeSettle(s) {
    if (!s || s.done) return;
    s.done = true;
    if (s.kind === 'commit') {
      /* render the NEW page into #cards-grid while it's still off-screen and the
         preview still covers position 0 → flash-free swap, correct from frame 1.
         v11.428: pass the preview's visible-card count so the commit render builds
         ONLY those (a light, spike-free landing); the rest is appended after the
         settle, so no full-list build ever lands on the 360ms animation. */
      const previewGridForCap = s.incoming && s.incoming.querySelector('.mylist-status-swipe-grid');
      const visibleCap = previewGridForCap ? previewGridForCap.children.length : 0;
      try {
        if (typeof commitMyListStatusSwipeTab === 'function') commitMyListStatusSwipeTab(s.tab, visibleCap);
        else if (typeof switchTab === 'function') switchTab(s.tab);
      } catch (e) { console.warn('[mylist-swipe] commit failed:', e); }
      /* v11.425: TWITCH FIX. render() just rebuilt #cards-grid with FRESH lazy
         <img>s — created while the grid is off-screen, so they don't begin loading
         until the grid is revealed → the posters pop/flash black ("twitch"). The
         preview layer already holds the SAME cards with images eager-loaded and
         decoded, so we ADOPT those exact nodes into the live grid: no img reload,
         no loading-state reset, stable from the first revealed frame. */
      try {
        const grid = gridEl();
        const previewGrid = s.incoming && s.incoming.querySelector('.mylist-status-swipe-grid');
        if (grid && previewGrid && previewGrid.children.length) {
          /* v11.427: the preview now holds ONLY the immediately-visible cards. Swap
             the live grid's first N (fresh, lazy, off-screen) for the preview's N
             already-decoded nodes — visible posters never flash — and KEEP the
             grid's remaining cards (off-screen, lazy; they load on scroll). */
          const previewKids = Array.prototype.slice.call(previewGrid.children);
          const gridKids = Array.prototype.slice.call(grid.children);
          const lim = Math.min(previewKids.length, gridKids.length);
          for (let i = 0; i < lim; i++) grid.replaceChild(previewKids[i], gridKids[i]);
          for (let i = lim; i < previewKids.length; i++) grid.appendChild(previewKids[i]);
        }
      } catch (e) {}
    }
    if (s.panel) clearPanelMotion(s.panel);              // snap #cards-grid to 0, drop transition/will-change
    if (s.incoming) { try { s.incoming.remove(); } catch (e) {} }
    if (currentSettle === s) {
      currentSettle = null;
      if (incomingPanel === s.incoming) incomingPanel = null;
      if (currentPanel === s.panel) currentPanel = null;
      targetTab = null;
      document.body.classList.remove('mylist-status-swiping');
    }
    releasePill();                                       // v11.425: hand the underline back to the tap path
    sweepGhosts();
  }

  /* Complete any in-flight settle INSTANTLY (no animation) — used to supersede a
     previous swipe before a new one starts, so the prior swipe lands cleanly. */
  function forceFinishSettle() {
    if (currentSettle) completeSettle(currentSettle);
  }

  /* Safe recovery: tear down all swipe artefacts and return #cards-grid to a
     clean, untransformed state. Reachable as window.shelfdResetStatusSwipe and
     auto-run on visibility regain, so the Shelf can never stay visually broken. */
  function hardResetSwipe() {
    cancelFrame();
    deciding = false;
    active = false;
    if (currentSettle) { currentSettle.done = true; currentSettle = null; }
    currentPanel = null;
    targetTab = null;
    incomingPanel = null;                 // drop ref → sweep removes ALL layers
    sweepGhosts();
    const grid = gridEl();
    if (grid) clearPanelMotion(grid);
    document.body.classList.remove('mylist-status-swiping');
  }
  window.shelfdResetStatusSwipe = hardResetSwipe;

  function settle() {
    cancelFrame();
    const dx = (lastX - startX) - engageOffset;
    const dt = Math.max(1, lastT - prevT);
    const velocity = (lastX - prevX) / dt;
    const movingTowardTarget = (dir === 1 && velocity < 0) || (dir === -1 && velocity > 0);
    const commit = !!targetTab && !!incomingPanel && (
      Math.abs(dx) > width * COMMIT_DISTANCE_RATIO ||
      (Math.abs(velocity) > COMMIT_VELOCITY && movingTowardTarget)
    );
    const ease = 'transform ' + SETTLE_MS + 'ms ' + SETTLE_EASE;
    /* capture node refs + direction/width NOW so the finisher is immune to any
       later gesture reassigning the shared module vars. */
    const s = {
      done: false,
      kind: commit ? 'commit' : 'cancel',
      panel: currentPanel,
      incoming: incomingPanel,
      tab: targetTab
    };
    currentSettle = s;
    const dirLocal = dir, widthLocal = width;
    const finish = () => completeSettle(s);
    settlePill(commit);                      // v11.425: underline rides the page settle

    if (commit) {
      s.panel.style.transition = ease;
      s.incoming.style.transition = ease;
      s.panel.style.transform = 'translate3d(' + (-dirLocal * widthLocal) + 'px,0,0)';
      s.incoming.style.transform = 'translate3d(0,0,0)';
      s.incoming.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, SETTLE_MS + 80);
    } else {
      s.panel.style.transition = ease;
      s.panel.style.transform = 'translate3d(0,0,0)';
      if (s.incoming) {
        s.incoming.style.transition = ease;
        s.incoming.style.transform = 'translate3d(' + (dirLocal * widthLocal) + 'px,0,0)';
      }
      s.panel.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, SETTLE_MS + 80);
      /* if nothing actually moved (engage-then-lift), no transitionend will ever
         fire — finish on the next frame instead of hanging on the 530ms fallback. */
      if (Math.abs(dx) < 1) requestAnimationFrame(() => requestAnimationFrame(finish));
    }
  }

  function onTouchStart(e) {
    if (active || deciding) return;
    /* v11.424: recovery — when idle (no live gesture/settle), clear any residue
       a prior stuck swipe could have left: orphaned ghost layers, a lingering
       `mylist-status-swiping` class, or a leftover transform on #cards-grid. This
       means even a plain TAP on a category/status button recovers a stuck page on
       the next interaction (no app restart needed). */
    if (!currentSettle) {
      sweepGhosts();
      if (document.body.classList.contains('mylist-status-swiping')) {
        document.body.classList.remove('mylist-status-swiping');
        const grid = gridEl();
        if (grid) clearPanelMotion(grid);
      }
    }
    if (e.touches && e.touches.length > 1) return;
    if (!swipeIsActive()) return;
    const t = e.touches ? e.touches[0] : e;
    if (t.clientX <= LEFT_EDGE_GUARD) return;  // left edge belongs to the friend swipe-back
    // only engage when the touch begins inside the card stage / grid area
    const inStage = t.target && t.target.closest && t.target.closest('#mylist-stage, #cards-grid');
    if (!inStage) return;
    /* v11.401: never start a status swipe from inside a card's status-selector
       popout — its tray scrolls horizontally and must own the gesture. */
    if (t.target && t.target.closest && t.target.closest('.game-status-selector')) return;
    deciding = true;
    active = false;
    engageOffset = 0;
    startX = prevX = lastX = t.clientX;
    startY = t.clientY;
    prevT = lastT = (e.timeStamp || performance.now());
  }

  function onTouchMove(e) {
    if (!deciding && !active) return;
    if (e.touches && e.touches.length > 1) { cancelGesture(); return; }
    const t = e.touches ? e.touches[0] : e;
    const cx = t.clientX, cy = t.clientY;
    const now = (e.timeStamp || performance.now());

    if (deciding) {
      const dx = cx - startX;
      const dy = cy - startY;
      if (Math.abs(dx) < INTENT_THRESHOLD && Math.abs(dy) < INTENT_THRESHOLD) return;
      deciding = false;
      // engage horizontally ONLY when clearly horizontal — else let it scroll (tap-safe)
      if (Math.abs(dx) <= Math.abs(dy) * INTENT_RATIO) return;
      engageOffset = dx;                     // 1:1 from HERE → no start jump
      if (!beginGesture(dx)) return;
      active = true;
    }

    if (active) {
      e.preventDefault();                    // only now — never blocks taps/scroll
      prevX = lastX; prevT = lastT;
      lastX = cx; lastT = now;
      pendingDx = (cx - startX) - engageOffset;
      scheduleFrame();
    }
  }

  function onTouchEnd() {
    if (active) {
      active = false;
      deciding = false;
      if (currentPanel) settle();
    } else {
      deciding = false;
    }
  }

  function cancelGesture() {
    if (!active) { deciding = false; return; }
    active = false; deciding = false;
    cancelFrame();
    if (currentPanel) { lastX = startX; settle(); }
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', cancelGesture, { passive: true });

  /* v11.424: if the app is backgrounded mid-swipe (the WKWebView can drop a
     transitionend), recover to a clean state when it returns to the foreground. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !active && !deciding) {
      forceFinishSettle();
      sweepGhosts();
    }
  });
})();
