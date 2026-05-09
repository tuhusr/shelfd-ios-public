// Main nav
function normalizeMainNavTab(tab) {
  return tab === 'games-discover' ? 'discover' : tab;
}

function normalizeDiscoveryHub(hub) {
  /* v571: 'movies' hub merged into 'tv' (now labeled "Movies & TV"). Any
     persisted 'movies' state from before is folded back to 'tv'. */
  if (hub === 'movies' || hub === 'movie') return 'tv';
  if (hub === 'anime') return 'anime';
  if (hub === 'gaming' || hub === 'games') return 'gaming';
  return 'tv';
}

function isMediaDiscoveryHub(hub = activeDiscoveryHub) {
  const normalizedHub = normalizeDiscoveryHub(hub);
  return normalizedHub === 'tv' || normalizedHub === 'movies';
}

function syncDiscoverMediaTabSections() {
  const mediaTab = normalizeDiscoveryHub(activeDiscoveryHub);
  document.querySelectorAll('.discover-media-tab-section').forEach(section => {
    const visible = isMediaDiscoveryHub(mediaTab) && section.dataset.discoveryTab === mediaTab;
    section.style.display = visible ? '' : 'none';
  });
}

function syncDiscoveryHubButtons() {
  document.querySelectorAll('.discover-hub-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.discoveryHub === activeDiscoveryHub);
  });
  syncDiscoverMediaTabSections();
}

let discoveryHubTransitionToken = 0;
const DISCOVERY_HUB_JUMP_MS = 90;
const DISCOVERY_HUB_ORDER = ['tv', 'movies', 'anime', 'gaming'];

function getDiscoveryHubPanel(hub) {
  const normalizedHub = normalizeDiscoveryHub(hub);
  if (normalizedHub === 'anime') return document.getElementById('anime-discover-view');
  if (normalizedHub === 'gaming') return document.getElementById('games-discover-view');
  return document.getElementById('discover-view');
}

function getDiscoveryHubPanels() {
  return [document.getElementById('discover-view'), document.getElementById('anime-discover-view'), document.getElementById('games-discover-view')].filter(Boolean);
}

function clearDiscoveryHubTransitionClasses(panel) {
  if (!panel) return;
  panel.classList.remove('discover-hub-transitioning', 'discover-hub-enter', 'discover-hub-exit');
  panel.style.removeProperty('--discover-hub-enter-x');
  panel.style.removeProperty('--discover-hub-exit-x');
  panel.style.opacity = '';
  panel.style.transform = '';
  panel.style.filter = '';
  panel.style.transition = '';
}

function transitionDiscoveryHub(previousHub, nextHub) {
  const token = ++discoveryHubTransitionToken;
  const nextPanel = getDiscoveryHubPanel(nextHub);
  if (!nextPanel) return;

  runScreenListFrameLockedJump(() => {
    if (token !== discoveryHubTransitionToken) return;
    getDiscoveryHubPanels().forEach(panel => {
      clearDiscoveryHubTransitionClasses(panel);
      panel.style.display = panel === nextPanel ? 'block' : 'none';
    });
  }, () => token !== discoveryHubTransitionToken, DISCOVERY_HUB_JUMP_MS);
}

function loadActiveDiscoveryHub(force = false) {
  initDiscoverCategoryTitleLinks();
  syncDiscoveryHubButtons();
  if (activeDiscoveryHub === 'gaming') return loadGamesDiscover(force);
  if (activeDiscoveryHub === 'anime') return loadAnimeDiscover(force);
  return loadDiscover(force);
}

(function initDiscoverAutoRefreshTimer() {
  if (window.__screenListDiscoverAutoRefreshReady) return;
  window.__screenListDiscoverAutoRefreshReady = true;
  window.setInterval(() => {
    if (document.hidden || getActiveMainTab() !== 'discover') return;
    loadActiveDiscoveryHub(true);
  }, DISCOVER_CACHE_TTL_MS);
})();

function switchDiscoveryHub(hub) {
  const previousHub = activeDiscoveryHub;
  const nextHub = normalizeDiscoveryHub(hub);
  if (previousHub === nextHub) {
    loadActiveDiscoveryHub();
    return;
  }
  activeDiscoveryHub = nextHub;
  syncDiscoveryHubButtons();
  if (getActiveMainTab() === 'discover') {
    const previousPanel = getDiscoveryHubPanel(previousHub);
    const nextPanel = getDiscoveryHubPanel(nextHub);
    if (previousPanel === nextPanel) {
      getDiscoveryHubPanels().forEach(panel => {
        clearDiscoveryHubTransitionClasses(panel);
        panel.style.display = panel === nextPanel ? 'block' : 'none';
      });
    } else {
      transitionDiscoveryHub(previousHub, nextHub);
    }
    loadActiveDiscoveryHub();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  persistUiState();
}

function getMainNavPanels(tab) {
  if (tab === 'mylist') return [document.getElementById('mylist-header'), document.getElementById('mylist-view')];
  if (tab === 'community') return [document.getElementById('community-view')];
  if (tab === 'discover') return [document.getElementById('discover-view'), document.getElementById('anime-discover-view'), document.getElementById('games-discover-view')];
  if (tab === 'profile') return [document.getElementById('profile-page')];
  if (tab === 'import') return [document.getElementById('import-view')];
  return [];
}

function getMainNavButtonMap() {
  return {
    mylist: [document.getElementById('nav-mylist'), document.getElementById('mobile-nav-mylist')],
    community: [document.getElementById('nav-community'), document.getElementById('mobile-nav-community')],
    discover: [document.getElementById('nav-discover'), document.getElementById('mobile-nav-discover')]
  };
}

function syncMainNavButtons(activeTab) {
  const friendsListMode = document.body.classList.contains('shelfd-friends-list-mode');
  const buttonMap = getMainNavButtonMap();
  Object.entries(buttonMap).forEach(([tab, buttons]) => {
    buttons.forEach(btn => {
      if (!btn) return;
      // v574: when on community tab in friends-list mode, the Activity bottom
      // nav button (mobile-nav-community) must NOT be marked active — the
      // Friends button is. Otherwise both light up which makes the tabs feel
      // confused.
      const shouldBeActive = (tab === activeTab) && !(tab === 'community' && friendsListMode);
      btn.classList.toggle('active', shouldBeActive);
    });
  });
  document.body.classList.toggle('main-tab-mylist', activeTab === 'mylist');
  document.body.classList.toggle('main-tab-community', activeTab === 'community');
  document.body.classList.toggle('main-tab-discover', activeTab === 'discover');
  // v528: Friends bottom-nav active state — kept in sync manually since
  // it shares #community-view with the Activity bottom-nav button.
  // Default: clear it. goToFriendsList() re-applies after switching.
  if (activeTab !== 'community') {
    document.body.classList.remove('shelfd-friends-list-mode');
    const friendsBtn = document.getElementById('mobile-nav-friendslist');
    if (friendsBtn) friendsBtn.classList.remove('active');
  } else if (friendsListMode) {
    // v574: when re-syncing in friends-list mode, ensure the Friends button
    // (not Activity) is the highlighted one.
    const friendsBtn = document.getElementById('mobile-nav-friendslist');
    if (friendsBtn) friendsBtn.classList.add('active');
  }
  syncDesktopMyListNavPlacement(activeTab);
}

function isDesktopBrowserMyListLayout() {
  return window.matchMedia('(min-width: 701px)').matches &&
    window.matchMedia('(hover: hover)').matches &&
    window.matchMedia('(pointer: fine)').matches &&
    !window.matchMedia('(display-mode: standalone)').matches;
}

function syncDesktopMyListNavPlacement(activeTab = getActiveMainTab()) {
  const nav = document.querySelector('.header .main-nav, #mylist-view .main-nav');
  const headerTop = document.querySelector('.header .header-top');
  const profileControls = document.getElementById('mylist-profile-controls');
  if (!nav || !headerTop || !profileControls) return;

  if (activeTab === 'mylist' && isDesktopBrowserMyListLayout()) {
    if (nav.parentElement !== profileControls.parentElement || nav.previousElementSibling !== profileControls) {
      profileControls.insertAdjacentElement('afterend', nav);
    }
  } else if (nav.parentElement !== headerTop.parentElement || nav.previousElementSibling !== headerTop) {
    headerTop.insertAdjacentElement('afterend', nav);
  }
}

function setBottomNavVisibility(isVisible) {
  const mobileNav = document.getElementById('mobile-bottom-nav');
  if (!mobileNav) return;
  mobileNav.style.display = isVisible ? 'flex' : 'none';
}

function resetPanelStyles(elements) {
  elements.forEach(el => {
    if (!el) return;
    el.style.opacity = '';
    el.style.transform = '';
    el.style.filter = '';
    el.style.willChange = '';
    el.style.backfaceVisibility = '';
    el.style.transformOrigin = '';
    el.style.transition = '';
    el.style.pointerEvents = '';
    el.classList.remove('discover-hub-transitioning', 'discover-hub-enter', 'discover-hub-exit');
  });
}

function setMainNavVisibility(tab) {
  const normalizedTab = normalizeMainNavTab(tab);
  const myListView = document.getElementById('mylist-view');
  const myListHeader = document.getElementById('mylist-header');
  const communityView = document.getElementById('community-view');
  const discoverView = document.getElementById('discover-view');
  const animeDiscoverView = document.getElementById('anime-discover-view');
  const gamesDiscoverView = document.getElementById('games-discover-view');
  const profilePage = document.getElementById('profile-page');
  const importView = document.getElementById('import-view');
  const steamSyncView = document.getElementById('steam-sync-view');
  resetPanelStyles([myListView, myListHeader, communityView, discoverView, animeDiscoverView, gamesDiscoverView, profilePage, importView, steamSyncView]);
  if (myListView) myListView.style.display = normalizedTab === 'mylist' ? 'block' : 'none';
  if (myListHeader) myListHeader.style.display = normalizedTab === 'mylist' ? 'block' : 'none';
  if (communityView) communityView.style.display = normalizedTab === 'community' ? 'block' : 'none';
  if (discoverView) discoverView.style.display = normalizedTab === 'discover' && isMediaDiscoveryHub() ? 'block' : 'none';
  if (animeDiscoverView) animeDiscoverView.style.display = normalizedTab === 'discover' && activeDiscoveryHub === 'anime' ? 'block' : 'none';
  if (gamesDiscoverView) gamesDiscoverView.style.display = normalizedTab === 'discover' && activeDiscoveryHub === 'gaming' ? 'block' : 'none';
  syncDiscoverMediaTabSections();
  if (profilePage) profilePage.style.display = normalizedTab === 'profile' ? 'block' : 'none';
  if (importView) importView.style.display = normalizedTab === 'import' ? 'block' : 'none';
  if (steamSyncView) steamSyncView.style.display = normalizedTab === 'steam-sync' ? 'block' : 'none';
  syncDiscoveryHubButtons();
  syncDesktopMyListNavPlacement(normalizedTab);
}

function getActiveMainTab() {
  const navDiscover = document.getElementById('nav-discover');
  const navCommunity = document.getElementById('nav-community');
  if (navDiscover?.classList.contains('active')) return 'discover';
  if (navCommunity?.classList.contains('active')) return 'community';
  return 'mylist';
}

function persistUiState() {
  try {
    const activityOpen = !!document.getElementById('activity-page')?.classList.contains('active');
    const state = {
      mainTab: getActiveMainTab(),
      discoveryHub: activeDiscoveryHub,
      activeSection,
      activeTab,
      activeFriendsTab,
      activeRequestsSubTab,
      activeActivitySubTab,
      activeMessagesSubTab,
      activeDmThreadId,
      viewingUser: viewingUser ? { uid: viewingUser.uid, name: viewingUser.name, photo: viewingUser.photo || '' } : null,
      activityOpen,
      activityPageFilterUid,
      commentsViewState: commentsViewState ? { ...commentsViewState } : null
    };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('UI state persist failed:', e);
  }
}

function readUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('UI state read failed:', e);
    return null;
  }
}

async function restoreUiState() {
  const state = readUiState();
  if (!state) return;
  activeDiscoveryHub = normalizeDiscoveryHub(state.discoveryHub || (state.mainTab === 'games-discover' ? 'gaming' : 'tv'));

  if (state.activeSection && ['shows', 'movies', 'anime', 'games', 'manga', 'books'].includes(state.activeSection)) {
    activeSection = state.activeSection;
  }
  if (state.activeTab && ['watching', 'planned', 'watched', 'paused', 'live'].includes(state.activeTab)) {
    activeTab = normalizeVisibleMyListStatusTab(state.activeTab, activeSection);
  }
  if (state.activeFriendsTab && ['friends', 'find', 'requests', 'activity'].includes(state.activeFriendsTab)) {
    activeFriendsTab = state.activeFriendsTab;
  } else if (state.activeFriendsTab === 'messages') {
    activeFriendsTab = 'activity';
  }
  if (state.activeRequestsSubTab === 'friends') {
    activeRequestsSubTab = 'friends';
  }
  if (state.activeActivitySubTab && ['feed', 'friendWatch', 'sharedWatch'].includes(state.activeActivitySubTab)) {
    activeActivitySubTab = state.activeActivitySubTab;
  }
  if (state.activeMessagesSubTab && ['chats', 'requests'].includes(state.activeMessagesSubTab)) {
    activeMessagesSubTab = state.activeMessagesSubTab;
  }
  if (state.activeDmThreadId) activeDmThreadId = state.activeDmThreadId;

  const mainTab = ['mylist', 'community', 'discover', 'games-discover'].includes(state.mainTab)
    ? normalizeMainNavTab(state.mainTab)
    : 'mylist';
  const navMyList = document.getElementById('nav-mylist');
  const navCommunity = document.getElementById('nav-community');
  const navDiscover = document.getElementById('nav-discover');
  if (navMyList) navMyList.classList.toggle('active', mainTab === 'mylist');
  if (navCommunity) navCommunity.classList.toggle('active', mainTab === 'community');
  if (navDiscover) navDiscover.classList.toggle('active', mainTab === 'discover');

  render();
  setMainNavVisibility(mainTab);

  if (state.viewingUser?.uid && currentUser && state.viewingUser.uid !== currentUser.uid) {
    await viewUserList(state.viewingUser.uid, state.viewingUser.name || 'Friend', state.viewingUser.photo || '');
  } else {
    if (mainTab === 'community') {
      loadCommunity();
      switchFriendsTab(activeFriendsTab || 'activity');
      loadFriendActivity();
    }
    if (mainTab === 'discover') loadActiveDiscoveryHub();
  }

  if (state.activityOpen && mainTab === 'community') {
    openActivityPage(state.activityPageFilterUid || null);
  }

  if (state.commentsViewState?.type === 'item' && state.commentsViewState.itemId) {
    openCommentsPage(state.commentsViewState.itemId, null);
  } else if (state.commentsViewState?.type === 'activity' && state.commentsViewState.mediaKey) {
    openCommentsPageForActivity(
      state.commentsViewState.mediaKey,
      state.commentsViewState.title || 'Comments',
      state.commentsViewState.cover || '',
      state.commentsViewState.commentId || ''
    );
  }
}

const MAIN_NAV_TRANSITION_ORDER = ['discover', 'community', 'mylist'];
const MAIN_NAV_MOBILE_LOCKED_FPS = 120;
const MAIN_NAV_MOBILE_FRAME_MS = 1000 / MAIN_NAV_MOBILE_LOCKED_FPS;
const MAIN_NAV_MOBILE_TOTAL_MS = 210;
const MAIN_NAV_MOBILE_SWAP_AT_MS = 72;

function getMainNavTransitionDelta(fromTab = 'mylist', toTab = 'mylist') {
  const fromIndex = MAIN_NAV_TRANSITION_ORDER.indexOf(normalizeMainNavTab(fromTab));
  const toIndex = MAIN_NAV_TRANSITION_ORDER.indexOf(normalizeMainNavTab(toTab));
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return 0;
  return toIndex - fromIndex;
}

function getMainNavTransitionDirection(fromTab = 'mylist', toTab = 'mylist') {
  const delta = getMainNavTransitionDelta(fromTab, toTab);
  return delta === 0 ? 1 : Math.sign(delta);
}

function getMainNavTransitionDistance(fromTab = 'mylist', toTab = 'mylist', isMobile = false) {
  if (!isMobile) return 18;
  const delta = Math.abs(getMainNavTransitionDelta(fromTab, toTab));
  return delta > 1 ? 34 : 28;
}

function getMainNavTransitionFrames(phase = 'enter', direction = 1, distance = 18, isMobile = false) {
  if (isMobile) {
    const x = Math.max(18, Number(distance) || 28) * Math.sign(direction || 1);
    if (phase === 'exit') {
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        { opacity: 0.001, transform: `translate3d(${-x}px, 0, 0) scale(0.996)` }
      ];
    }
    return [
      { opacity: 0.001, transform: `translate3d(${x}px, 0, 0) scale(0.996)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
    ];
  }

  if (phase === 'exit') {
    return [
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      { opacity: 0, transform: 'translate3d(0, 12px, 0) scale(0.992)' }
    ];
  }
  return [
    { opacity: 0, transform: 'translate3d(0, -12px, 0) scale(0.992)' },
    { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
  ];
}

function getMainNavTransitionOptions(phase = 'enter', isMobile = false) {
  const mobileOptions = {
    duration: phase === 'exit'
      ? MAIN_NAV_MOBILE_SWAP_AT_MS
      : MAIN_NAV_MOBILE_TOTAL_MS - MAIN_NAV_MOBILE_SWAP_AT_MS,
    easing: 'linear',
    frameLocked: true,
    targetFps: MAIN_NAV_MOBILE_LOCKED_FPS
  };
  const desktopOptions = phase === 'exit'
    ? { duration: 130, easing: 'cubic-bezier(0.4, 0, 1, 1)' }
    : { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
  return { ...(isMobile ? mobileOptions : desktopOptions), fill: 'both' };
}

function getVisibleMainNavPanels(elements) {
  return elements.filter(el => el && getComputedStyle(el).display !== 'none');
}

function prepareMainNavTransitionElements(elements) {
  elements.forEach(el => {
    if (!el) return;
    el.style.willChange = 'opacity, transform';
    el.style.backfaceVisibility = 'hidden';
    el.style.transformOrigin = 'center top';
    el.style.pointerEvents = 'none';
  });
}

function clampMainNavProgress(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeMainNavOut(t) {
  t = clampMainNavProgress(t);
  return t * t * t;
}

function easeMainNavIn(t) {
  t = clampMainNavProgress(t);
  return 1 - Math.pow(1 - t, 4);
}

function mixMainNavValue(from, to, t) {
  return from + (to - from) * t;
}

function applyMainNavMobileFrame(elements, phase = 'enter', progress = 1, direction = 1, distance = 28) {
  const eased = phase === 'exit' ? easeMainNavOut(progress) : easeMainNavIn(progress);
  const signedDistance = Math.max(18, Number(distance) || 28) * Math.sign(direction || 1);
  const opacity = phase === 'exit'
    ? mixMainNavValue(1, 0.001, eased)
    : mixMainNavValue(0.001, 1, eased);
  const x = phase === 'exit'
    ? mixMainNavValue(0, -signedDistance, eased)
    : mixMainNavValue(signedDistance, 0, eased);
  const scale = phase === 'exit'
    ? mixMainNavValue(1, 0.996, eased)
    : mixMainNavValue(0.996, 1, eased);
  const transform = `translate3d(${x.toFixed(3)}px, 0, 0) scale(${scale.toFixed(5)})`;
  elements.forEach(el => {
    if (!el) return;
    el.style.opacity = opacity.toFixed(4);
    el.style.transform = transform;
    el.style.filter = '';
  });
}

function animateMainNavPanels(elements, keyframes, options) {
  const visible = getVisibleMainNavPanels(elements);
  if (visible.length === 0) return Promise.resolve();
  prepareMainNavTransitionElements(visible);
  if (options?.frameLocked) return animateMainNavPanelsFrameLocked(visible, keyframes, options);
  if (!Element.prototype.animate) return Promise.resolve();
  return Promise.all(visible.map(el => {
    const animation = el.animate(keyframes, { ...options, composite: 'replace' });
    const timeout = new Promise(resolve => setTimeout(resolve, (options.duration || 0) + 120));
    return Promise.race([animation.finished.catch(() => {}), timeout])
      .catch(() => {})
      .finally(() => {
        try { animation.cancel(); } catch(e) {}
        resetPanelStyles([el]);
      });
  }));
}

function animateMainNavPanelsFrameLocked(elements, keyframes, options = {}) {
  const duration = Math.max(1, Number(options.duration) || 1);
  const targetFps = Math.max(1, Number(options.targetFps) || MAIN_NAV_MOBILE_LOCKED_FPS);
  const frameMs = 1000 / targetFps;
  const phase = keyframes?.[0]?.opacity > keyframes?.[1]?.opacity ? 'exit' : 'enter';
  return new Promise(resolve => {
    const start = performance.now();
    let lastFrame = -1;
    function tick(now) {
      const elapsed = Math.max(0, now - start);
      const frame = Math.min(Math.ceil(duration / frameMs), Math.floor(elapsed / frameMs));
      if (frame !== lastFrame) {
        lastFrame = frame;
        applyMainNavMobileFrame(elements, phase, elapsed / duration);
      }
      if (elapsed < duration) {
        requestAnimationFrame(tick);
      } else {
        applyMainNavMobileFrame(elements, phase, 1);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

async function animateMainNav120HzTabSwap(fromTab = 'mylist', toTab = 'mylist', revealNextPanel = () => {}) {
  const outgoing = getVisibleMainNavPanels(getMainNavPanels(fromTab));
  prepareMainNavTransitionElements(outgoing);
  document.body.classList.add('main-nav-switching');

  const direction = getMainNavTransitionDirection(fromTab, toTab);
  const distance = getMainNavTransitionDistance(fromTab, toTab, true);

  return new Promise(resolve => {
    const start = performance.now();
    const totalMs = MAIN_NAV_MOBILE_TOTAL_MS;
    const swapAtMs = MAIN_NAV_MOBILE_SWAP_AT_MS;
    let incoming = [];
    let swapped = false;
    let lastFrame = -1;

    const doReveal = () => {
      if (swapped) return;
      swapped = true;
      try {
        const revealResult = revealNextPanel();
        if (revealResult && typeof revealResult.catch === 'function') {
          revealResult.catch(error => console.error('Main nav reveal failed:', error));
        }
      } catch (error) {
        console.error('Main nav reveal failed:', error);
      }
      incoming = getVisibleMainNavPanels(getMainNavPanels(toTab));
      prepareMainNavTransitionElements(incoming);
      applyMainNavMobileFrame(incoming, 'enter', 0, direction, distance);
    };

    function tick(now) {
      const elapsed = Math.min(totalMs, Math.max(0, now - start));
      const frame = Math.floor(elapsed / MAIN_NAV_MOBILE_FRAME_MS);
      if (frame !== lastFrame) {
        lastFrame = frame;
        if (elapsed <= swapAtMs) {
          applyMainNavMobileFrame(outgoing, 'exit', elapsed / swapAtMs, direction, distance);
        } else {
          doReveal();
          applyMainNavMobileFrame(incoming, 'enter', (elapsed - swapAtMs) / (totalMs - swapAtMs), direction, distance);
        }
      }

      if (elapsed < totalMs) {
        requestAnimationFrame(tick);
      } else {
        doReveal();
        applyMainNavMobileFrame(incoming, 'enter', 1, direction, distance);
        resetPanelStyles([...outgoing, ...incoming]);
        document.body.classList.remove('main-nav-switching');
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}

function isMobileMainNavTransitionLayout() {
  return window.matchMedia && window.matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)').matches;
}

const MAIN_NAV_DOCK_SWIPE_ORDER = MAIN_NAV_TRANSITION_ORDER;
let mainNavDockSwipeBound = false;
let mainNavDockSwipeStartX = 0;
let mainNavDockSwipeStartY = 0;
let mainNavDockSwipeTracking = false;

function getAdjacentDockSwipeTab(direction) {
  const current = getActiveMainTab();
  const index = MAIN_NAV_DOCK_SWIPE_ORDER.indexOf(current);
  if (index === -1) return '';
  return MAIN_NAV_DOCK_SWIPE_ORDER[index + direction] || '';
}

function bindMobileBottomDockSwipe() {
  if (mainNavDockSwipeBound) return;
  const dock = document.getElementById('mobile-bottom-nav');
  if (!dock) return;
  mainNavDockSwipeBound = true;
  dock.addEventListener('touchstart', (event) => {
    if (!isMobileMainNavTransitionLayout() || mainNavSwitching || document.body.classList.contains('profile-active')) return;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    mainNavDockSwipeStartX = touch.clientX;
    mainNavDockSwipeStartY = touch.clientY;
    mainNavDockSwipeTracking = true;
  }, { passive: true });
  dock.addEventListener('touchmove', (event) => {
    if (!mainNavDockSwipeTracking) return;
    const touch = event.touches[0];
    const dx = touch.clientX - mainNavDockSwipeStartX;
    const dy = touch.clientY - mainNavDockSwipeStartY;
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.1) {
      mainNavDockSwipeTracking = false;
    }
  }, { passive: true });
  dock.addEventListener('touchend', (event) => {
    if (!mainNavDockSwipeTracking) return;
    mainNavDockSwipeTracking = false;
    if (mainNavSwitching || document.body.classList.contains('profile-active')) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - mainNavDockSwipeStartX;
    const dy = touch.clientY - mainNavDockSwipeStartY;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    const nextTab = getAdjacentDockSwipeTab(dx < 0 ? 1 : -1);
    if (nextTab) switchMainNav(nextTab);
  }, { passive: true });
  dock.addEventListener('touchcancel', () => {
    mainNavDockSwipeTracking = false;
  }, { passive: true });
}

async function switchMainNav(tab) {
  if (tab === 'games-discover') {
    activeDiscoveryHub = 'gaming';
  }
  const normalizedTab = normalizeMainNavTab(tab);
  if (isDirectMessagesPageOpen()) closeDirectMessagesPage(true);
  const currentTab = getActiveMainTab();
  if (mainNavSwitching) return;
  if (viewingUser) {
    await backToMyList(normalizedTab);
    return;
  }
  if (normalizedTab === currentTab) {
    if (normalizedTab === 'discover') {
      setMainNavVisibility('discover');
      loadActiveDiscoveryHub();
      persistUiState();
    } else if (normalizedTab === 'community') {
      openFriendsActivityDefault();
      persistUiState();
    }
    return;
  }

  syncMainNavButtons(normalizedTab);
  setBottomNavVisibility(normalizedTab !== 'profile');
  /* v574: respect shelfd-friends-list-mode so goToFriendsList → switchMainNav
     route lands on the friends inner tab instead of the activity feed.
     Previously the deferred hydrateCommunity below would fire after
     goToFriendsList completed and re-force 'activity', overriding the
     user's actual intent. */
  if (normalizedTab === 'community') {
    if (document.body.classList.contains('shelfd-friends-list-mode')) {
      activeFriendsTab = 'friends';
    } else {
      activeFriendsTab = 'activity';
      activeActivitySubTab = 'feed';
    }
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobileMainNav = isMobileMainNavTransitionLayout();
  const transitionDirection = getMainNavTransitionDirection(currentTab, normalizedTab);
  const transitionDistance = getMainNavTransitionDistance(currentTab, normalizedTab, isMobileMainNav);
  mainNavSwitching = true;
  try {
    const revealNextMainNavPanel = async () => {
      setMainNavVisibility(normalizedTab);
      if (normalizedTab === 'community') {
        const friendsListMode = document.body.classList.contains('shelfd-friends-list-mode');
        if (friendsListMode) {
          activeFriendsTab = 'friends';
        } else {
          activeFriendsTab = 'activity';
          activeActivitySubTab = 'feed';
        }
        const hydrateCommunity = () => {
          // v574: only force activity feed when NOT in friends-list mode.
          // loadCommunity(false) respects activeFriendsTab as set above.
          loadCommunity(!friendsListMode);
          if (friendsListMode && typeof switchFriendsTab === 'function') {
            switchFriendsTab('friends');
          }
        };
        if (isMobileMainNav) {
          setTimeout(() => requestAnimationFrame(hydrateCommunity), MAIN_NAV_MOBILE_TOTAL_MS + 36);
        } else {
          requestAnimationFrame(hydrateCommunity);
        }
      }
      if (normalizedTab === 'discover') loadActiveDiscoveryHub();
      if (normalizedTab === 'mylist' && viewingUser) await backToMyList();
    };

    if (!prefersReducedMotion && isMobileMainNav) {
      await animateMainNav120HzTabSwap(currentTab, normalizedTab, revealNextMainNavPanel);
    } else {
      if (!prefersReducedMotion) {
        await animateMainNavPanels(
          getMainNavPanels(currentTab),
          getMainNavTransitionFrames('exit', transitionDirection, transitionDistance, isMobileMainNav),
          getMainNavTransitionOptions('exit', isMobileMainNav)
        );
      }

      await revealNextMainNavPanel();

      if (!prefersReducedMotion) {
        await animateMainNavPanels(
          getMainNavPanels(normalizedTab),
          getMainNavTransitionFrames('enter', transitionDirection, transitionDistance, isMobileMainNav),
          getMainNavTransitionOptions('enter', isMobileMainNav)
        );
        resetPanelStyles(getMainNavPanels(normalizedTab));
      }
    }
  } catch(e) {
    console.error("Main nav switch failed:", e);
    setMainNavVisibility(normalizedTab);
    if (normalizedTab === 'community') {
      const friendsListMode = document.body.classList.contains('shelfd-friends-list-mode');
      if (friendsListMode) {
        activeFriendsTab = 'friends';
        loadCommunity(false);
        if (typeof switchFriendsTab === 'function') switchFriendsTab('friends');
      } else {
        activeFriendsTab = 'activity';
        activeActivitySubTab = 'feed';
        loadCommunity(true);
        loadFriendActivity();
      }
    }
    if (normalizedTab === 'discover') loadActiveDiscoveryHub();
    if (normalizedTab === 'mylist' && viewingUser) await backToMyList();
  } finally {
    document.body.classList.remove('main-nav-switching');
    mainNavSwitching = false;
    persistUiState();
  }
}

/* v528: 4th bottom nav tab "Friends" — navigates to community-view but
   auto-switches to the friends inner tab.
   v574: set the body class BEFORE switchMainNav so the deferred
   hydrateCommunity inside switchMainNav (which fires AFTER this function
   resolves) sees friends-list mode and routes to the friends sub-tab
   instead of forcing the activity feed. */
async function goToFriendsList() {
  if (mainNavSwitching) return;
  // Apply intent immediately so syncMainNavButtons / switchMainNav both
  // see we want friends mode.
  document.body.classList.add('shelfd-friends-list-mode');
  activeFriendsTab = 'friends';
  document.querySelectorAll('.mobile-bottom-nav .main-nav-btn').forEach(btn => btn.classList.remove('active'));
  const friendsBtn = document.getElementById('mobile-nav-friendslist');
  if (friendsBtn) friendsBtn.classList.add('active');

  const onCommunity = getActiveMainTab() === 'community';
  if (!onCommunity) {
    await switchMainNav('community');
  }
  // Ensure intent survives anything switchMainNav did.
  document.body.classList.add('shelfd-friends-list-mode');
  activeFriendsTab = 'friends';
  if (typeof switchFriendsTab === 'function') {
    switchFriendsTab('friends');
  }
  // Re-assert button active states after any sync inside switchMainNav.
  document.querySelectorAll('.mobile-bottom-nav .main-nav-btn').forEach(btn => btn.classList.remove('active'));
  const friendsBtnAgain = document.getElementById('mobile-nav-friendslist');
  if (friendsBtnAgain) friendsBtnAgain.classList.add('active');
  if (typeof persistUiState === 'function') persistUiState();
}

/* v549/574: Activity bottom-nav handler — clears friends-list-mode BEFORE
   switchMainNav so the deferred hydrate inside it correctly forces the
   activity feed. */
async function goToActivityFeed() {
  if (mainNavSwitching) return;
  document.body.classList.remove('shelfd-friends-list-mode');
  activeFriendsTab = 'activity';
  document.querySelectorAll('.mobile-bottom-nav .main-nav-btn').forEach(btn => btn.classList.remove('active'));
  const activityBtn = document.getElementById('mobile-nav-community');
  if (activityBtn) activityBtn.classList.add('active');

  const onCommunity = getActiveMainTab() === 'community';
  if (!onCommunity) {
    await switchMainNav('community');
  } else if (typeof switchFriendsTab === 'function') {
    switchFriendsTab('activity');
  }
  // Re-assert intent after switchMainNav settles.
  document.body.classList.remove('shelfd-friends-list-mode');
  if (onCommunity && typeof switchFriendsTab === 'function') switchFriendsTab('activity');
  document.querySelectorAll('.mobile-bottom-nav .main-nav-btn').forEach(btn => btn.classList.remove('active'));
  const activityBtnAgain = document.getElementById('mobile-nav-community');
  if (activityBtnAgain) activityBtnAgain.classList.add('active');
  if (typeof persistUiState === 'function') persistUiState();
}

/* v625: Search page — full-page slide-up, GPU-composited for 120Hz. */
let shelfdSearchPageOpen = false;

function openSearchPage() {
  if (shelfdSearchPageOpen) return;
  shelfdSearchPageOpen = true;
  const page = document.getElementById('shelfd-search-page');
  const searchBtn = document.getElementById('mobile-nav-search');
  if (!page) return;
  /* Sync active state on the search button */
  document.querySelectorAll('.mobile-bottom-nav .main-nav-btn').forEach(b => b.classList.remove('active'));
  if (searchBtn) { searchBtn.classList.add('active'); searchBtn.setAttribute('aria-pressed', 'true'); }
  page.setAttribute('aria-hidden', 'false');
  /* Two rAFs: first commits paint, second triggers the CSS transition
     so the browser can schedule it on a 120Hz cadence. */
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('is-open')));
}

function closeSearchPage() {
  if (!shelfdSearchPageOpen) return;
  shelfdSearchPageOpen = false;
  const page = document.getElementById('shelfd-search-page');
  const searchBtn = document.getElementById('mobile-nav-search');
  if (page) {
    page.classList.remove('is-open');
    page.setAttribute('aria-hidden', 'true');
  }
  if (searchBtn) { searchBtn.classList.remove('active'); searchBtn.setAttribute('aria-pressed', 'false'); }
  /* Restore whichever main nav tab was active */
  const activeTab = typeof getActiveMainTab === 'function' ? getActiveMainTab() : '';
  if (activeTab && typeof syncMainNavButtons === 'function') syncMainNavButtons(activeTab);
}

window.openSearchPage = openSearchPage;
window.closeSearchPage = closeSearchPage;

(function initDesktopMyListNavPlacement() {
  const sync = () => syncDesktopMyListNavPlacement(getActiveMainTab());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, { once: true });
  } else {
    sync();
  }
  window.addEventListener('resize', sync, { passive: true });
})();
