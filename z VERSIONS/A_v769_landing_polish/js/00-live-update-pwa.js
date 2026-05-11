// Shelfd split runtime guard v364-force-fresh.
// Direct chunk loads set this flag so compatibility /script.js never double-loads them.
window.__shelfdSplitScriptsLoading = true;
window.__shelfdSplitChunkVersion = '364-force-fresh';

// ScreenList deploy auto-refresh: browser + PWA clients show a clear update screen before reloading.
(function initScreenListDeployAutoRefresh() {
  const currentVersion = String(window.SCREENLIST_BUILD_VERSION || '').trim();
  if (!currentVersion || window.__screenListDeployAutoRefreshReady) return;
  window.__screenListDeployAutoRefreshReady = true;

  let checking = false;
  let reloading = false;
  let lastCheckAt = 0;
  let serviceWorkerRefreshBound = false;

  const MIN_CHECK_GAP_MS = 15000;
  const CHECK_INTERVAL_MS = 60000;
  const LIVE_UPDATE_SPLASH_KEY = 'screenlist-live-update-splash-v3';
  const LIVE_UPDATE_RELOAD_DELAY_MS = 3000;
  const LIVE_UPDATE_AFTER_LOAD_HOLD_MS = 700;
  const LIVE_UPDATE_APP_READY_TIMEOUT_MS = 10000;
  const LIVE_UPDATE_LOGO_SRC = '/live_update_splash_logo.png?v=362-pwa-edge-no-store';
  const LIVE_UPDATE_MESSAGE = 'the developer has just sent out a live update, please wait for refresh';
  /* v746: bumped key forces standalone PWAs to run the one-shot
     full-cache wipe + SW unregister + reload one more time on next
     launch. Combined with the SW CACHE bump in sw.js, this gives PWAs
     two independent paths to recover from stale state — whichever
     fires first wins. */
  const PWA_CACHE_RESET_KEY = 'shelfd-pwa-cache-reset-v746';

  function readVersionFromHtml(html) {
    const metaMatch = String(html || '').match(/<meta\s+name=["']screenlist-build-version["']\s+content=["']([^"']+)["']/i);
    if (metaMatch && metaMatch[1]) return metaMatch[1].trim();
    const scriptMatch = String(html || '').match(/SCREENLIST_BUILD_VERSION\s*=\s*["']([^"']+)["']/);
    return scriptMatch && scriptMatch[1] ? scriptMatch[1].trim() : '';
  }

  function ensureLiveUpdateSplashStyles() {
    if (document.getElementById('screenlist-live-update-inline-style')) return;
    const style = document.createElement('style');
    style.id = 'screenlist-live-update-inline-style';
    style.textContent = `
      #screenlist-live-update-splash {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        padding: max(28px, env(safe-area-inset-top, 0px)) 22px max(28px, env(safe-area-inset-bottom, 0px));
        background: radial-gradient(circle at 50% 30%, #5A466F 0%, rgba(90,70,111,0.0) 60%), linear-gradient(160deg, #1e1428 0%, #0E0E0E 60%, #0E0E0E 100%);
        color: #fff; opacity: 0; pointer-events: none;
        transform: translateZ(0); transition: opacity 220ms ease;
      }
      #screenlist-live-update-splash.show { opacity: 1; pointer-events: auto; }
      .screenlist-live-update-card {
        width: min(660px, 94vw); text-align: center;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
        transform: translateY(8px) scale(0.985); opacity: 0;
        transition: transform 260ms ease, opacity 260ms ease;
      }
      #screenlist-live-update-splash.show .screenlist-live-update-card { transform: translateY(0) scale(1); opacity: 1; }
      .screenlist-live-update-brand {
        width: min(540px, 88vw); height: auto; max-height: 190px; object-fit: contain;
        display: block; filter: drop-shadow(0 18px 36px rgba(124,58,237,0.28));
      }
      .screenlist-live-update-loader { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 22px; }
      .screenlist-live-update-loader span { width: 8px; height: 8px; border-radius: 999px; background: #a78bfa; box-shadow: 0 0 18px rgba(167,139,250,0.52); animation: screenlistLiveUpdateDot 820ms ease-in-out infinite; }
      .screenlist-live-update-loader span:nth-child(2) { animation-delay: 120ms; }
      .screenlist-live-update-loader span:nth-child(3) { animation-delay: 240ms; }
      .screenlist-live-update-copy { max-width: 310px; font: 800 14px/1.45 'DM Sans', system-ui, sans-serif; color: rgba(255,255,255,.92); }
      body.screenlist-live-update-active { overflow: hidden !important; }
      @keyframes screenlistLiveUpdateDot { 0%, 80%, 100% { transform: translateY(0) scale(.72); opacity: .38; } 38% { transform: translateY(-7px) scale(1); opacity: 1; } }
      @media (max-width: 600px) { .screenlist-live-update-brand { width: min(500px, 90vw); } .screenlist-live-update-copy { font-size: 13px; } }
      @media (prefers-reduced-motion: reduce) { #screenlist-live-update-splash, .screenlist-live-update-card { transition: none; } .screenlist-live-update-loader span { animation: none; opacity: .86; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getLiveUpdateSplash() {
    ensureLiveUpdateSplashStyles();
    let splash = document.getElementById('screenlist-live-update-splash');
    if (splash) return splash;
    splash = document.createElement('div');
    splash.id = 'screenlist-live-update-splash';
    splash.className = 'screenlist-live-update-splash';
    splash.setAttribute('role', 'status');
    splash.setAttribute('aria-live', 'polite');
    splash.innerHTML = `
      <div class="screenlist-live-update-card">
        <img class="screenlist-live-update-brand" src="${LIVE_UPDATE_LOGO_SRC}" alt="Shelfd" decoding="async" fetchpriority="high">
        <div class="screenlist-live-update-loader" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="screenlist-live-update-copy">${LIVE_UPDATE_MESSAGE}</div>
      </div>`;
    document.body.appendChild(splash);
    return splash;
  }

  function showLiveUpdateSplash() {
    if (!document.body) return;
    const splash = getLiveUpdateSplash();
    document.body.classList.add('screenlist-live-update-active');
    splash.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => splash.classList.add('show')));
    /* v760 SAFETY NET: hard guarantee the splash NEVER stays visible past
       5 seconds, regardless of whether `markScreenListAppReadyForSplash`
       ever fires or `waitForScreenListAppReadyThenHide`'s timeout works.
       If ANY downstream code throws and breaks the normal hide path, this
       still rescues the user from a stuck splash. Idempotent — calling
       hideLiveUpdateSplash twice is a no-op since it checks for the
       element's existence first. */
    try { clearTimeout(window.__shelfdSplashHardSafetyTimer); } catch (e) {}
    window.__shelfdSplashHardSafetyTimer = setTimeout(() => {
      try { hideLiveUpdateSplash(); } catch (e) {}
    }, 5000);
  }

  function hideLiveUpdateSplash() {
    /* v760: clear the hard safety timer if it's still scheduled — we're
       hiding now, no need for the safety net to fire later. */
    try { clearTimeout(window.__shelfdSplashHardSafetyTimer); } catch (e) {}
    const splash = document.getElementById('screenlist-live-update-splash');
    if (!splash) return;
    splash.classList.remove('show');
    /* v760: force pointer-events: none IMMEDIATELY so even if the fade-out
       transition stalls or the element fails to remove, it cannot block
       interactions with the app underneath. */
    splash.style.pointerEvents = 'none';
    document.body.classList.remove('screenlist-live-update-active');
    document.documentElement.classList.remove('screenlist-boot-hold');
    const bootHoldStyle = document.getElementById('screenlist-boot-hold-style');
    if (bootHoldStyle) bootHoldStyle.remove();
    setTimeout(() => {
      try { splash.remove(); } catch (e) {}
      /* v760: fallback — if .remove() failed, force display:none. */
      const stillThere = document.getElementById('screenlist-live-update-splash');
      if (stillThere) stillThere.style.display = 'none';
    }, 260);
  }

  function waitForScreenListAppReadyThenHide(startedAt, minHoldMs) {
    const hideAfterReady = () => {
      const elapsed = Date.now() - startedAt;
      const delay = Math.max(0, minHoldMs - elapsed);
      setTimeout(hideLiveUpdateSplash, delay);
    };
    if (window.__shelfdAppReady) {
      hideAfterReady();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('shelfd:app-ready', finish);
      hideAfterReady();
    };
    window.addEventListener('shelfd:app-ready', finish, { once: true });
    setTimeout(finish, LIVE_UPDATE_APP_READY_TIMEOUT_MS);
  }

  function finishReloadSplashIfNeeded() {
    let shouldShow = false;
    try {
      shouldShow = sessionStorage.getItem(LIVE_UPDATE_SPLASH_KEY) === '1'
        || sessionStorage.getItem('screenlist-live-update-splash-v2') === '1'
        || sessionStorage.getItem('screenlist-live-update-splash-v1') === '1';
      if (shouldShow) {
        sessionStorage.removeItem(LIVE_UPDATE_SPLASH_KEY);
        sessionStorage.removeItem('screenlist-live-update-splash-v2');
        sessionStorage.removeItem('screenlist-live-update-splash-v1');
      }
    } catch (error) {}
    if (!shouldShow) return;
    const run = () => {
      const startedAt = Date.now();
      showLiveUpdateSplash();
      waitForScreenListAppReadyThenHide(startedAt, LIVE_UPDATE_AFTER_LOAD_HOLD_MS);
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  function reloadAfterVisibleSplash() {
    try { sessionStorage.setItem(LIVE_UPDATE_SPLASH_KEY, '1'); } catch (error) {}
    const run = () => {
      showLiveUpdateSplash();
      setTimeout(() => window.location.reload(), LIVE_UPDATE_RELOAD_DELAY_MS);
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  async function checkForScreenListDeployUpdate(force) {
    if (checking || reloading) return;
    const now = Date.now();
    if (!force && now - lastCheckAt < MIN_CHECK_GAP_MS) return;
    lastCheckAt = now;
    checking = true;
    try {
      const res = await fetch('/index.html?screenlist_update_check=' + now, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' }
      });
      if (!res.ok) return;
      const nextVersion = readVersionFromHtml(await res.text());
      if (nextVersion && nextVersion !== currentVersion) {
        reloading = true;
        try { localStorage.setItem('screenlist-last-auto-refresh', String(now)); } catch (error) {}
        reloadAfterVisibleSplash();
      }
    } catch (error) {
      console.warn('ScreenList update check failed:', error);
    } finally {
      checking = false;
    }
  }

  async function forceRefreshServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;
      if (!serviceWorkerRefreshBound) {
        serviceWorkerRefreshBound = true;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return;
          reloading = true;
          reloadAfterVisibleSplash();
        });
      }
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      if (typeof registration.update === 'function') {
        await registration.update();
      }
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (error) {
      console.warn('Shelfd service worker refresh failed:', error);
    }
  }

  async function resetStandalonePwaCachesOnce() {
    const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone) return false;
    try {
      if (localStorage.getItem(PWA_CACHE_RESET_KEY) === '1') return false;
    } catch (error) {}
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister().catch(() => false)));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(key => /^shelfd-/i.test(String(key || '')))
            .map(key => caches.delete(key))
        );
      }
      try { localStorage.setItem(PWA_CACHE_RESET_KEY, '1'); } catch (error) {}
      return true;
    } catch (error) {
      console.warn('Shelfd standalone cache reset failed:', error);
      return false;
    }
  }

  function showStartupSplashIfNeeded() {
    if (!window.matchMedia || !window.matchMedia('(display-mode: standalone)').matches) return;
    try {
      if (sessionStorage.getItem(LIVE_UPDATE_SPLASH_KEY) === '1') return;
    } catch (error) {}
    const pageStartMs = Date.now();
    const run = () => {
      showLiveUpdateSplash();
      waitForScreenListAppReadyThenHide(pageStartMs, 1200);
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  async function startScreenListLiveUpdateRuntime() {
    const resetPerformed = await resetStandalonePwaCachesOnce();
    if (resetPerformed) {
      window.location.replace(window.location.pathname + window.location.search + window.location.hash);
      return;
    }
    finishReloadSplashIfNeeded();
    forceRefreshServiceWorker();
    showStartupSplashIfNeeded();
    window.checkScreenListDeployUpdate = () => checkForScreenListDeployUpdate(true);
    setInterval(() => checkForScreenListDeployUpdate(false), CHECK_INTERVAL_MS);
    window.addEventListener('load', () => {
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
    }, { once: true });
    window.addEventListener('focus', () => {
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
    });
    window.addEventListener('pageshow', () => {
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
    });
    window.addEventListener('online', () => {
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        forceRefreshServiceWorker();
        checkForScreenListDeployUpdate(true);
      }
    });
  }

  startScreenListLiveUpdateRuntime();
})();

// Double-tap zoom guard removed: the viewport already sets user-scalable=no + maximum-scale=1.0,
// which prevents zoom natively. The previous touchend preventDefault() was cancelling
// synthesized click events inside iOS PWA standalone (WKWebView), breaking tap interactions.
