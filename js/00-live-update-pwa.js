// Shelfd split runtime guard v283-discovery-search-results-polish.
// Direct chunk loads set this flag so compatibility /script.js never double-loads them.
window.__shelfdSplitScriptsLoading = true;
window.__shelfdSplitChunkVersion = '283-discovery-search-results-polish';

// ScreenList deploy auto-refresh: all browser + PWA clients show a clear update screen before reloading.
(function initScreenListDeployAutoRefresh() {
  const currentVersion = String(window.SCREENLIST_BUILD_VERSION || '').trim();
  if (!currentVersion || window.__screenListDeployAutoRefreshReady) return;
  window.__screenListDeployAutoRefreshReady = true;

  let checking = false;
  let reloading = false;
  let lastCheckAt = 0;
  const MIN_CHECK_GAP_MS = 15000;
  const CHECK_INTERVAL_MS = 60000;
  const LIVE_UPDATE_SPLASH_KEY = 'screenlist-live-update-splash-v3';
  const LIVE_UPDATE_RELOAD_DELAY_MS = 3000;
  const LIVE_UPDATE_AFTER_LOAD_HOLD_MS = 700;
  const LIVE_UPDATE_LOGO_SRC = '/live_update_splash_logo.png?v=283-discovery-search-results-polish';
  const LIVE_UPDATE_MESSAGE = 'the developer has just sent out a live update, please wait for refresh';

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
        background: radial-gradient(circle at 50% 24%, rgba(124,58,237,0.28), transparent 34%), #000;
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
  }

  function hideLiveUpdateSplash() {
    const splash = document.getElementById('screenlist-live-update-splash');
    if (!splash) return;
    splash.classList.remove('show');
    document.body.classList.remove('screenlist-live-update-active');
    setTimeout(() => splash.remove(), 260);
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
    } catch (e) {}
    if (!shouldShow) return;
    const run = () => {
      showLiveUpdateSplash();
      const hide = () => setTimeout(hideLiveUpdateSplash, LIVE_UPDATE_AFTER_LOAD_HOLD_MS);
      if (document.readyState === 'complete') hide();
      else window.addEventListener('load', hide, { once: true });
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  function reloadAfterVisibleSplash() {
    try { sessionStorage.setItem(LIVE_UPDATE_SPLASH_KEY, '1'); } catch (e) {}
    const run = () => {
      showLiveUpdateSplash();
      setTimeout(() => window.location.reload(), LIVE_UPDATE_RELOAD_DELAY_MS);
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  async function checkForScreenListDeployUpdate(force = false) {
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
        try { localStorage.setItem('screenlist-last-auto-refresh', String(now)); } catch (e) {}
        reloadAfterVisibleSplash();
      }
    } catch (error) {
      console.warn('ScreenList update check failed:', error);
    } finally {
      checking = false;
    }
  }

  function showStartupSplashIfNeeded() {
    if (!window.matchMedia || !window.matchMedia('(display-mode: standalone)').matches) return;
    try { if (sessionStorage.getItem(LIVE_UPDATE_SPLASH_KEY) === '1') return; } catch (e) {}
    const pageStartMs = Date.now();
    const run = () => {
      showLiveUpdateSplash();
      const hideAfter = Math.max(0, 1200 - (Date.now() - pageStartMs));
      const hide = () => setTimeout(hideLiveUpdateSplash, hideAfter);
      if (document.readyState === 'complete') hide();
      else window.addEventListener('load', hide, { once: true });
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  finishReloadSplashIfNeeded();
  showStartupSplashIfNeeded();
  window.checkScreenListDeployUpdate = () => checkForScreenListDeployUpdate(true);
  setInterval(() => checkForScreenListDeployUpdate(false), CHECK_INTERVAL_MS);
  window.addEventListener('load', () => checkForScreenListDeployUpdate(true), { once: true });
  window.addEventListener('focus', () => checkForScreenListDeployUpdate(true));
  window.addEventListener('pageshow', () => checkForScreenListDeployUpdate(true));
  window.addEventListener('online', () => checkForScreenListDeployUpdate(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForScreenListDeployUpdate(true);
  });
})();


// Mobile: block accidental double-tap zoom while preserving normal scrolling/tapping.
(function initScreenListMobileZoomGuard() {
  if (window.__screenListMobileZoomGuardReady) return;
  window.__screenListMobileZoomGuardReady = true;
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
})();
