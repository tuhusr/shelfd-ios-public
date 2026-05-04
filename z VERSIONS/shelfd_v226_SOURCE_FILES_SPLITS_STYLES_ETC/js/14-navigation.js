// Main nav
function normalizeMainNavTab(tab) {
  return tab === 'games-discover' ? 'discover' : tab;
}

function normalizeDiscoveryHub(hub) {
  if (hub === 'movies' || hub === 'movie') return 'movies';
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
  const buttonMap = getMainNavButtonMap();
  Object.entries(buttonMap).forEach(([tab, buttons]) => {
    buttons.forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('active', tab === activeTab);
    });
  });
  document.body.classList.toggle('main-tab-mylist', activeTab === 'mylist');
  document.body.classList.toggle('main-tab-community', activeTab === 'community');
  document.body.classList.toggle('main-tab-discover', activeTab === 'discover');
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
  resetPanelStyles([myListView, myListHeader, communityView, discoverView, animeDiscoverView, gamesDiscoverView, profilePage, importView]);
  if (myListView) myListView.style.display = normalizedTab === 'mylist' ? 'block' : 'none';
  if (myListHeader) myListHeader.style.display = normalizedTab === 'mylist' ? 'block' : 'none';
  if (communityView) communityView.style.display = normalizedTab === 'community' ? 'block' : 'none';
  if (discoverView) discoverView.style.display = normalizedTab === 'discover' && isMediaDiscoveryHub() ? 'block' : 'none';
  if (animeDiscoverView) animeDiscoverView.style.display = normalizedTab === 'discover' && activeDiscoveryHub === 'anime' ? 'block' : 'none';
  if (gamesDiscoverView) gamesDiscoverView.style.display = normalizedTab === 'discover' && activeDiscoveryHub === 'gaming' ? 'block' : 'none';
  syncDiscoverMediaTabSections();
  if (profilePage) profilePage.style.display = normalizedTab === 'profile' ? 'block' : 'none';
  if (importView) importView.style.display = normalizedTab === 'import' ? 'block' : 'none';
  syncDiscoveryHubButtons();
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
const MAIN_NAV_MOBILE_TOTAL_MS = 300;
const MAIN_NAV_MOBILE_SWAP_AT_MS = 154;

function getMainNavTransitionDelta(fromTab = 'mylist', toTab = 'mylist') {
  const fromIndex = MAIN_NAV_TRANSITION_ORDER.indexOf(normalizeMainNavTab(fromTab));
  const toIndex = MAIN_NAV_TRANSITION_ORDER.indexOf(normalizeMainNavTab(toTab));
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return 0;
  return toIndex - fromIndex;
}

function getMainNavTransitionDirection() {
  // All main bottom-nav tab swaps intentionally share one visual path.
  // This keeps Discovery ⇄ Friends ⇄ My Lists perfectly consistent.
  return 1;
}

function getMainNavTransitionDistance(fromTab = 'mylist', toTab = 'mylist', isMobile = false) {
  return isMobile ? 22 : 18;
}

function getMainNavTransitionFrames(phase = 'enter', direction = 1, distance = 18, isMobile = false) {
  if (isMobile) {
    if (phase === 'exit') {
      return [
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px) brightness(1)' },
        { opacity: 0.08, transform: 'translate3d(0, 22px, 0) scale(0.985)', filter: 'blur(7px) brightness(0.82)' }
      ];
    }
    return [
      { opacity: 0.08, transform: 'translate3d(0, -22px, 0) scale(0.985)', filter: 'blur(7px) brightness(0.86)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px) brightness(1)' }
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
    el.style.willChange = 'opacity, transform, filter';
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

function applyMainNavMobileFrame(elements, phase = 'enter', progress = 1) {
  const eased = phase === 'exit' ? easeMainNavOut(progress) : easeMainNavIn(progress);
  const opacity = phase === 'exit'
    ? mixMainNavValue(1, 0.08, eased)
    : mixMainNavValue(0.08, 1, eased);
  const y = phase === 'exit'
    ? mixMainNavValue(0, 22, eased)
    : mixMainNavValue(-22, 0, eased);
  const scale = phase === 'exit'
    ? mixMainNavValue(1, 0.985, eased)
    : mixMainNavValue(0.985, 1, eased);
  const blur = phase === 'exit'
    ? mixMainNavValue(0, 7, eased)
    : mixMainNavValue(7, 0, eased);
  const brightness = phase === 'exit'
    ? mixMainNavValue(1, 0.82, eased)
    : mixMainNavValue(0.86, 1, eased);
  const transform = `translate3d(0, ${y.toFixed(3)}px, 0) scale(${scale.toFixed(5)})`;
  const filter = `blur(${blur.toFixed(3)}px) brightness(${brightness.toFixed(4)})`;
  elements.forEach(el => {
    if (!el) return;
    el.style.opacity = opacity.toFixed(4);
    el.style.transform = transform;
    el.style.filter = filter;
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
      applyMainNavMobileFrame(incoming, 'enter', 0);
    };

    function tick(now) {
      const elapsed = Math.min(totalMs, Math.max(0, now - start));
      const frame = Math.floor(elapsed / MAIN_NAV_MOBILE_FRAME_MS);
      if (frame !== lastFrame) {
        lastFrame = frame;
        if (elapsed <= swapAtMs) {
          applyMainNavMobileFrame(outgoing, 'exit', elapsed / swapAtMs);
        } else {
          doReveal();
          applyMainNavMobileFrame(incoming, 'enter', (elapsed - swapAtMs) / (totalMs - swapAtMs));
        }
      }

      if (elapsed < totalMs) {
        requestAnimationFrame(tick);
      } else {
        doReveal();
        applyMainNavMobileFrame(incoming, 'enter', 1);
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
  if (normalizedTab === 'discover') loadActiveDiscoveryHub();
  if (normalizedTab === 'community') {
    activeFriendsTab = 'activity';
    activeActivitySubTab = 'feed';
    loadFriendActivity();
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
        activeFriendsTab = 'activity';
        activeActivitySubTab = 'feed';
        loadCommunity(true);
        loadFriendActivity();
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
      activeFriendsTab = 'activity';
      activeActivitySubTab = 'feed';
      loadCommunity(true);
      loadFriendActivity();
    }
    if (normalizedTab === 'discover') loadActiveDiscoveryHub();
    if (normalizedTab === 'mylist' && viewingUser) await backToMyList();
  } finally {
    document.body.classList.remove('main-nav-switching');
    mainNavSwitching = false;
    persistUiState();
  }
}
