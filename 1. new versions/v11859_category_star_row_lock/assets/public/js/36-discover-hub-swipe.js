/* =============================================================================
   Discover hub horizontal swipe  (v11.382 — physics aligned to instagramPageSwipe / js/39)
   File: assets/public/js/36-discover-hub-swipe.js

   Finger-tracking book-style swipe to move between the Discovery hubs in their
   on-screen order:  Movies → TV → Anime → Games → Music.

     • Drag finger RIGHT  → previous hub (toward Movies). On Movies → nothing.
     • Drag finger LEFT   → next hub     (toward Music).  On Music  → nothing.

   The content tracks the finger 1:1; on release the gesture either completes
   (past a distance OR velocity threshold) or snaps back. Coexists with the
   page's vertical scroll via horizontal-intent detection — a mostly-vertical
   drag is ignored and scrolls the page normally.

   The 5 hubs map to 4 DOM panels (movies + tv share #discover-view, toggled by
   data-discovery-tab). For a movies↔tv swipe the incoming page can't be the
   same live node, so a lightweight styled clone is used for the transition and
   removed on release.

   Relies on globals from 14-navigation.js / 11-discovery-…:
     DISCOVERY_HUB_ORDER-equivalent order below, normalizeDiscoveryHub,
     activeDiscoveryHub, getDiscoveryHubPanel, getDiscoveryHubPanels,
     syncDiscoveryHubButtons, loadActiveDiscoveryHub, persistUiState,
     getActiveMainTab.
   ========================================================================== */
(function () {
  'use strict';

  const ORDER = ['movies', 'tv', 'anime', 'gaming', 'music'];

  // Tuning knobs (px / ratios / ms). The engage / commit thresholds still match
  // instagramPageSwipe (js/39), but the release SETTLE was intentionally softened
  // in v11.518 (gentler curve + longer) per request — so the discovery settle is
  // deliberately MORE GRADUAL than the followers/following/mutual pager.
  const INTENT_THRESHOLD = 8;         // px of travel before we decide H vs V (= preset ENGAGE_PX)
  const INTENT_RATIO = 1.3;           // dx must exceed dy*ratio to engage H (bias toward vertical scroll)
  const COMMIT_DISTANCE_RATIO = 0.3;  // fraction of viewport width to commit
  const COMMIT_VELOCITY = 0.4;        // px/ms fling that commits regardless
  const EDGE_RESIST = 0.32;           // rubber-band factor at the two ends
  /* v11.518: the incoming page was "snapping" into place. The old easing was
     easeOutQuint cubic-bezier(0.22,1,0.36,1) — it covers ~90% of the distance in
     the first third of the time then crawls, which reads as a fast snap + nudge.
     Swapped to easeOutQuad (a gentle, even deceleration) and lengthened the
     duration 390 → 520ms so the page glides in smoothly and gradually instead. */
  const SETTLE_MS = 520;              // commit / snap-back length (v11.518: 390 → 520, gentler)
  const SETTLE_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'; // easeOutQuad — gentle, gradual glide

  // Gesture state.
  let deciding = false;   // touch down, direction not yet determined
  let active = false;     // horizontal gesture engaged
  let startX = 0, startY = 0;
  let lastX = 0, prevX = 0, lastT = 0, prevT = 0;
  let width = 1;
  let dir = 0;            // +1 = next (finger left), -1 = previous (finger right)
  let currentPanel = null;
  let incomingPanel = null;
  let incomingIsClone = false;
  let staticToggle = null; // v11.413: fixed clone of the category bar, kept static while panels slide
  let targetHub = null;   // null when at an end (rubber-band only)
  let pendingDx = 0;      // latest finger delta awaiting the next frame
  let engageOffset = 0;   // dx when H-intent engaged → 1:1 tracking from there (no start jump)
  let rafId = 0;          // requestAnimationFrame handle (0 = idle)

  function cancelFrame() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  /* v11.304: one transform write per display refresh. touchmove can fire more
     often than the screen repaints (and off-vsync), so writing transform on
     every event causes redundant style work + frame-pacing jitter. Coalescing
     to a single rAF-driven write keeps the slide locked to the 120Hz cadence. */
  function renderFrame() {
    rafId = 0;
    if (!active || !currentPanel) return;
    applyDrag(pendingDx);
  }
  function scheduleFrame() {
    if (!rafId) rafId = requestAnimationFrame(renderFrame);
  }

  function overlayOpen() {
    return !!document.querySelector(
      '.discover-media-profile-overlay, .game-media-profile-overlay, ' +
      '.discover-category-full-overlay, .discover-universal-search-overlay, ' +
      '.discover-friends-modal-overlay'
    );
  }

  function discoverIsActive() {
    if (typeof getActiveMainTab !== 'function' || getActiveMainTab() !== 'discover') return false;
    if (overlayOpen()) return false;
    const modal = document.getElementById('modal');
    if (modal && getComputedStyle(modal).display !== 'none') return false;
    return true;
  }

  function currentHubIndex() {
    return ORDER.indexOf(normalizeDiscoveryHub(activeDiscoveryHub));
  }

  /* Mirror of syncDiscoverMediaTabSections() but applied to a detached clone,
     forcing it to show the movies OR tv sections of the target hub. */
  function applyMediaTabToClone(root, hub) {
    const isMedia = hub === 'movies' || hub === 'tv';
    root.querySelectorAll('.discover-media-tab-section').forEach(section => {
      const visible = isMedia && (!section.dataset.discoveryTab || section.dataset.discoveryTab === hub);
      section.style.display = visible ? '' : 'none';
      Array.from(section.children).forEach(child => {
        if (!child.matches || !child.matches('.discover-section[data-discovery-tab]')) return;
        child.style.display = child.dataset.discoveryTab === hub ? '' : 'none';
      });
    });
    root.querySelectorAll('.discover-hub-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.discoveryHub === hub);
    });
  }

  function styleIncomingLayer(el, topPx) {
    el.style.position = 'fixed';
    el.style.top = topPx + 'px';
    el.style.left = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.margin = '0';
    el.style.overflow = 'hidden';
    el.style.zIndex = '5';
    el.style.willChange = 'transform';
    el.style.transition = 'none';
    el.style.display = 'block';
    el.style.pointerEvents = 'none';
  }

  function clearLayerStyles(el) {
    if (!el) return;
    ['position', 'top', 'left', 'right', 'bottom', 'margin', 'overflow',
     'zIndex', 'willChange', 'transition', 'transform', 'pointerEvents']
      .forEach(prop => el.style.removeProperty(prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase())));
  }

  function clearPanelMotion(el) {
    if (!el) return;
    el.style.removeProperty('transform');
    el.style.removeProperty('transition');
    el.style.removeProperty('will-change');
  }

  function teardownIncoming() {
    if (!incomingPanel) return;
    if (incomingIsClone) {
      incomingPanel.remove();
    } else {
      clearLayerStyles(incomingPanel);
      incomingPanel.style.display = 'none';
    }
    incomingPanel = null;
    incomingIsClone = false;
  }

  /* v11.413: the category bar (.discover-hub-toggle) lives INSIDE each panel, so
     translating the panel slid the bar with it. To keep it visually STATIC we
     snapshot a fixed clone of the current bar onto document.body — above the
     sliding panels (z-index 6), pinned at the live bar's exact spot — and hide
     the real in-panel bars for the duration of the gesture. The clone's look is
     frozen from the live bar's COMPUTED styles, because the real styling is
     scoped to #discover-view / #anime-discover-view / … which a body-level clone
     wouldn't otherwise inherit (the panels are opaque, so the bar can't just be
     a transparent overlay). On settle the clone is removed and the real bars are
     restored; the active-tab highlight swaps once, on landing. */
  function hubToggleOf(panel) {
    return panel ? panel.querySelector('.discover-hub-toggle') : null;
  }
  function hideHubToggle(panel) {
    const tg = hubToggleOf(panel);
    if (tg) tg.style.visibility = 'hidden';
  }
  function buildStaticToggleClone(panel) {
    if (staticToggle) { staticToggle.remove(); staticToggle = null; }
    const src = hubToggleOf(panel);
    if (!src) return null;
    const rect = src.getBoundingClientRect();
    const clone = src.cloneNode(true);
    /* v11.521 — COMPLETE LONGHAND MIRROR (replaces the v11.519/v11.520 curated copies).
       The clone lives on document.body, OUTSIDE the #discover-view scope, so none of
       the bar's scoped CSS (css/12 grid + button font/padding) reaches it. The earlier
       fix hand-copied a CURATED list of properties — but that kept drifting, most
       recently because the tab `padding` never copied: WebKit's getComputedStyle
       returns '' for the `padding` SHORTHAND, so the clone fell back to the base
       7px/16px padding and the tabs RE-SPACED during the swipe. Any other shorthand
       in a hand list is the same trap. Fix: mirror EVERY resolved property — the
       getComputedStyle iterator yields only LONGHANDS, so there are no shorthand
       gaps and nothing left to miss. Mirror the bar + each button, then re-apply only
       the fixed-overlay positioning. css/20 still owns colour + active underline
       (state-aware via .active, !important, so it wins over the mirrored inline). */
    const mirrorComputedStyle = (fromEl, toEl) => {
      const fcs = window.getComputedStyle(fromEl);
      for (let i = 0; i < fcs.length; i++) {
        const prop = fcs[i];
        toEl.style.setProperty(prop, fcs.getPropertyValue(prop));
      }
    };
    mirrorComputedStyle(src, clone);
    const srcBtns = src.querySelectorAll('.discover-hub-btn');
    const cloneBtns = clone.querySelectorAll('.discover-hub-btn');
    for (let i = 0; i < cloneBtns.length && i < srcBtns.length; i++) {
      mirrorComputedStyle(srcBtns[i], cloneBtns[i]);
    }
    /* Fixed-overlay positioning — applied AFTER the mirror so it overrides the
       mirrored static-flow values (later inline write wins). */
    clone.setAttribute('data-discover-hub-static-toggle', '1');
    clone.style.position = 'fixed';
    clone.style.top = Math.round(rect.top) + 'px';
    clone.style.left = Math.round(rect.left) + 'px';
    clone.style.width = Math.round(rect.width) + 'px';
    clone.style.margin = '0';
    clone.style.zIndex = '6';
    clone.style.pointerEvents = 'none';
    clone.style.transition = 'none';
    clone.style.transform = 'none';
    /* v11.522: the clone is position:fixed → its OWN GPU-composited layer. With a
       TRANSPARENT backing, WebKit rasterises its text against transparency, which on
       iOS reads as a faint WEIGHT/size bump vs the in-flow real bar (whose text is
       painted onto the opaque panel) — the tabs looked like they bolded mid-swipe then
       snapped back on landing. Back the clone with the SAME opaque colour that sits
       behind the real bar (nearest opaque ancestor, read live — no hardcode) so its
       composited text rasterises identically. Inline !important so it beats css/20's
       `background: transparent !important`; the buttons stay transparent over it. */
    let bgNode = src.parentElement, opaqueBg = '';
    while (bgNode) {
      const c = window.getComputedStyle(bgNode).backgroundColor || '';
      const m = c.match(/^rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s));
        const alpha = parts.length >= 4 ? parts[3] : 1;
        if (alpha >= 0.99) { opaqueBg = c; break; }
      }
      bgNode = bgNode.parentElement;
    }
    if (opaqueBg) clone.style.setProperty('background-color', opaqueBg, 'important');
    document.body.appendChild(clone);
    void clone.offsetHeight;   // rasterise the clone's layer NOW (at engage), not mid-slide
    return clone;
  }
  function setStaticToggleActiveHub(hub) {
    if (!staticToggle) return;
    staticToggle.querySelectorAll('.discover-hub-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.discoveryHub === hub);
    });
  }
  function removeStaticToggle() {
    if (staticToggle) { staticToggle.remove(); staticToggle = null; }
    if (typeof getDiscoveryHubPanels === 'function') {
      getDiscoveryHubPanels().forEach(p => {
        const tg = hubToggleOf(p);
        if (tg) tg.style.removeProperty('visibility');
      });
    }
  }

  function beginGesture(firstDx) {
    width = window.innerWidth || document.documentElement.clientWidth || 1;
    const idx = currentHubIndex();
    if (idx < 0) return false;
    currentPanel = getDiscoveryHubPanel(ORDER[idx]);
    if (!currentPanel) return false;

    dir = firstDx < 0 ? 1 : -1;            // finger left → next ; finger right → prev
    const targetIdx = idx + dir;

    /* v11.517: read ALL geometry FIRST (single layout flush), THEN do every DOM
       write. Previously the panel rect was read AFTER class-add / will-change /
       clone-append, so the engage frame thrashed layout (read → write → read)
       and hitched at the very moment the swipe started. Grouping the reads ahead
       of the writes collapses it to one flush. The reads are position-invariant
       to the writes that follow (the swiping class only sets overflow-x/backface,
       will-change has no geometry), so the measured top is identical. */
    const rect = currentPanel.getBoundingClientRect();
    const topPx = Math.max(0, Math.round(rect.top));

    // v11.413: pin the category bar (clone on body) + hide the sliding original.
    staticToggle = buildStaticToggleClone(currentPanel);
    hideHubToggle(currentPanel);
    document.body.classList.add('discover-hub-swiping');
    currentPanel.style.transition = 'none';
    currentPanel.style.willChange = 'transform';

    if (targetIdx < 0 || targetIdx >= ORDER.length) {
      targetHub = null;                    // at an end → rubber-band only
      incomingPanel = null;
      return true;
    }
    targetHub = ORDER[targetIdx];
    const targetPanel = getDiscoveryHubPanel(targetHub);

    if (targetPanel === currentPanel) {
      // movies ↔ tv : same node → transient styled clone for the incoming page.
      const clone = currentPanel.cloneNode(true);
      clone.setAttribute('data-discover-hub-swipe-clone', '1');
      applyMediaTabToClone(clone, targetHub);
      document.body.appendChild(clone);
      incomingPanel = clone;
      incomingIsClone = true;
    } else {
      incomingPanel = targetPanel;
      incomingIsClone = false;
      /* v11.413 fix: anime→TV is the only non-clone swipe that enters the
         shared movies/TV panel (#discover-view). The incoming panel was left on
         its STALE sub-tab (usually Movies), so the wrong sections slid in and it
         snapped to TV only on arrival. Switch the real incoming panel to the
         target sub-tab now so the correct TV sections slide in from the start. */
      if (targetHub === 'movies' || targetHub === 'tv') {
        applyMediaTabToClone(incomingPanel, targetHub);
      }
    }
    styleIncomingLayer(incomingPanel, topPx);
    hideHubToggle(incomingPanel);   // v11.413: the static clone is the only visible bar
    incomingPanel.style.transform = 'translate3d(' + (dir * width) + 'px,0,0)';
    /* v11.517: flush the incoming layer's layout ONCE now, at engage, so the
       first finger-tracked frame is a pure composite. Without this the freshly
       display:block'd panel (or the movies↔tv full clone) lays out lazily on the
       opening frame(s) of the slide → a stutter right as it starts moving. The
       offsetHeight read forces that layout into this single engage instant. */
    void incomingPanel.offsetHeight;
    // Warm the destination hub's data so it isn't all placeholders on arrival.
    try { if (typeof scheduleDiscoverHubPrewarm === 'function') scheduleDiscoverHubPrewarm(activeDiscoveryHub); } catch (e) {}
    return true;
  }

  function applyDrag(dx) {
    if (!targetHub) {
      // Rubber-band resistance at the first/last hub.
      currentPanel.style.transform = 'translate3d(' + (dx * EDGE_RESIST) + 'px,0,0)';
      return;
    }
    currentPanel.style.transform = 'translate3d(' + dx + 'px,0,0)';
    incomingPanel.style.transform = 'translate3d(' + (dir * width + dx) + 'px,0,0)';
  }

  function finalizeCommit() {
    // Adopt the target hub WITHOUT the default jump animation (we already slid).
    const hub = targetHub;
    teardownIncoming();
    clearPanelMotion(currentPanel);
    document.body.classList.remove('discover-hub-swiping');
    currentPanel = null;
    targetHub = null;

    activeDiscoveryHub = normalizeDiscoveryHub(hub);
    if (typeof syncDiscoveryHubButtons === 'function') syncDiscoveryHubButtons();
    const nextPanel = getDiscoveryHubPanel(activeDiscoveryHub);
    getDiscoveryHubPanels().forEach(p => { p.style.display = (p === nextPanel) ? 'block' : 'none'; });
    /* v11.414: drop the pinned clone + reveal the real (now target-active) bar
       IMMEDIATELY — BEFORE the potentially heavy/throwing data load. Previously
       removeStaticToggle ran last, so if loadActiveDiscoveryHub was slow or threw
       the clone (frozen on the OLD active tab) lingered on screen for seconds. */
    removeStaticToggle();
    window.scrollTo({ top: 0, behavior: 'auto' });
    /* v11.517: the next panel is already on screen with the correct sub-tab
       (syncDiscoveryHubButtons above already ran syncDiscoverMediaTabSections),
       so defer the heavier hub data refresh + UI-state persist until AFTER the
       landing frame paints. Running them synchronously at transitionend blocked
       the main thread the instant the slide settled → a visible hitch on landing.
       A one-frame-late refresh of the already-populated panel is invisible. */
    requestAnimationFrame(() => {
      try { if (typeof loadActiveDiscoveryHub === 'function') loadActiveDiscoveryHub(); } catch (e) {}
      try { if (typeof persistUiState === 'function') persistUiState(); } catch (e) {}
    });
  }

  function settle() {
    cancelFrame();                  // stop per-frame drag writes before the CSS transition
    const dx = (lastX - startX) - engageOffset; // displacement measured from the engage point
    const dt = Math.max(1, lastT - prevT);
    const velocity = (lastX - prevX) / dt; // px/ms, sign = direction
    const movingTowardTarget = (dir === 1 && velocity < 0) || (dir === -1 && velocity > 0);
    const commit = !!targetHub && (
      Math.abs(dx) > width * COMMIT_DISTANCE_RATIO ||
      (Math.abs(velocity) > COMMIT_VELOCITY && movingTowardTarget)
    );

    const ease = 'transform ' + SETTLE_MS + 'ms ' + SETTLE_EASE;

    if (commit) {
      // v11.414: flip the pinned bar's underline to the TARGET hub now, so during
      // the settle slide the static category bar already reads the incoming page.
      setStaticToggleActiveHub(targetHub);
      currentPanel.style.transition = ease;
      incomingPanel.style.transition = ease;
      currentPanel.style.transform = 'translate3d(' + (-dir * width) + 'px,0,0)';
      incomingPanel.style.transform = 'translate3d(0,0,0)';
      let done = false;
      const finish = () => { if (done) return; done = true; finalizeCommit(); };
      incomingPanel.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, SETTLE_MS + 80);
    } else {
      // Snap back to the current hub.
      currentPanel.style.transition = ease;
      currentPanel.style.transform = 'translate3d(0,0,0)';
      if (incomingPanel) {
        incomingPanel.style.transition = ease;
        incomingPanel.style.transform = 'translate3d(' + (dir * width) + 'px,0,0)';
      }
      const panelRef = currentPanel;
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        teardownIncoming();
        clearPanelMotion(panelRef);
        document.body.classList.remove('discover-hub-swiping');
        currentPanel = null;
        targetHub = null;
        // v11.413: drop the pinned bar clone + reveal the real bars (snap-back).
        removeStaticToggle();
      };
      panelRef.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, SETTLE_MS + 80);
    }
  }

  function resetGestureFlags() {
    deciding = false;
    active = false;
  }

  function onTouchStart(e) {
    if (active || deciding) return;
    if (e.touches && e.touches.length > 1) return;
    if (!discoverIsActive()) return;
    const t = e.touches ? e.touches[0] : e;
    // Only engage if the touch began inside a discover panel.
    const panel = t.target && t.target.closest && t.target.closest(
      '#discover-view, #anime-discover-view, #games-discover-view, #music-discover-view'
    );
    if (!panel) return;
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
      // Engage horizontally ONLY when clearly horizontal (dx > dy*ratio); a mostly
      // vertical drag falls through to the page's native scroll — same bias as the preset.
      if (Math.abs(dx) <= Math.abs(dy) * INTENT_RATIO) return;
      engageOffset = dx;             // start 1:1 from HERE so the page doesn't jump on engage
      if (!beginGesture(dx)) return;
      active = true;
    }

    if (active) {
      e.preventDefault();           // stop the page from vertically scrolling
      prevX = lastX; prevT = lastT;
      lastX = cx; lastT = now;
      pendingDx = (cx - startX) - engageOffset; // 1:1 from the engage point; applied per frame
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
    if (currentPanel) {
      lastX = startX; // force snap-back path
      settle();
    }
  }

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', cancelGesture, { passive: true });
})();
