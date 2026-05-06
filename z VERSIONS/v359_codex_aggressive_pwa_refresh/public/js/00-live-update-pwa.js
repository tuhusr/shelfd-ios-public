// Shelfd split runtime guard v302-splash-until-app-ready.
// Direct chunk loads set this flag so compatibility /script.js never double-loads them.
window.__shelfdSplitScriptsLoading = true;
window.__shelfdSplitChunkVersion = '359-aggressive-pwa-refresh';

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
  const LIVE_UPDATE_APP_READY_TIMEOUT_MS = 10000;
  const LIVE_UPDATE_LOGO_SRC = '/live_update_splash_logo.png?v=359-aggressive-pwa-refresh';
  const LIVE_UPDATE_MESSAGE = 'the developer has just sent out a live update, please wait for refresh';
  let serviceWorkerRefreshBound = false;

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
    document.documentElement.classList.remove('screenlist-boot-hold');
    const bootHoldStyle = document.getElementById('screenlist-boot-hold-style');
    if (bootHoldStyle) bootHoldStyle.remove();
    setTimeout(() => splash.remove(), 260);
  }

  function waitForScreenListAppReadyThenHide(startedAt = Date.now(), minHoldMs = LIVE_UPDATE_AFTER_LOAD_HOLD_MS) {
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
    } catch (e) {}
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

  function showStartupSplashIfNeeded() {
    if (!window.matchMedia || !window.matchMedia('(display-mode: standalone)').matches) return;
    try { if (sessionStorage.getItem(LIVE_UPDATE_SPLASH_KEY) === '1') return; } catch (e) {}
    const pageStartMs = Date.now();
    const run = () => {
      showLiveUpdateSplash();
      waitForScreenListAppReadyThenHide(pageStartMs, 1200);
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
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
})();


// Double-tap zoom guard removed: the viewport already sets user-scalable=no + maximum-scale=1.0,
// which prevents zoom natively. The previous touchend preventDefault() was cancelling
// synthesized click events inside iOS PWA standalone (WKWebView), breaking tap interactions.


// PWA reinstall notice — shown once to standalone users to prompt a one-time cache reset.
(function initPWAReinstallNotice() {
  const NOTICE_KEY = 'shelfd-pwa-reinstall-notice-v303';
  const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (!isStandalone) return;
  try { if (localStorage.getItem(NOTICE_KEY)) return; } catch (e) {}

  function injectNoticeStyles() {
    if (document.getElementById('shelfd-reinstall-notice-style')) return;
    const s = document.createElement('style');
    s.id = 'shelfd-reinstall-notice-style';
    s.textContent = `
      #shelfd-reinstall-backdrop {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(0,0,0,0.82);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: flex; align-items: center; justify-content: center;
        padding: max(24px, env(safe-area-inset-top, 0px)) 20px max(24px, env(safe-area-inset-bottom, 0px));
        opacity: 0; transition: opacity 260ms ease;
      }
      #shelfd-reinstall-backdrop.visible { opacity: 1; }
      #shelfd-reinstall-card {
        background: #0d0d0d;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 22px;
        padding: 32px 28px 28px;
        width: min(400px, 94vw);
        display: flex; flex-direction: column; align-items: center;
        gap: 0;
        transform: translateY(14px) scale(0.97);
        transition: transform 300ms cubic-bezier(0.22,1,0.36,1), opacity 300ms ease;
        opacity: 0;
        box-shadow: 0 24px 64px rgba(0,0,0,0.72), 0 0 0 0.5px rgba(255,255,255,0.06);
        text-align: center;
        font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
      }
      #shelfd-reinstall-backdrop.visible #shelfd-reinstall-card {
        transform: translateY(0) scale(1); opacity: 1;
      }
      #shelfd-reinstall-icon {
        width: 52px; height: 52px; border-radius: 14px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 20px; font-size: 24px;
        flex-shrink: 0;
      }
      #shelfd-reinstall-title {
        color: #fff;
        font-size: 17px; font-weight: 700; line-height: 1.3;
        margin-bottom: 12px; letter-spacing: -0.01em;
      }
      #shelfd-reinstall-body {
        color: rgba(255,255,255,0.62);
        font-size: 14px; line-height: 1.6; font-weight: 400;
        margin-bottom: 8px;
      }
      #shelfd-reinstall-steps {
        width: 100%; margin: 14px 0 24px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .shelfd-reinstall-step {
        display: flex; align-items: flex-start; gap: 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 12px; padding: 11px 14px; text-align: left;
      }
      .shelfd-reinstall-step-num {
        width: 22px; height: 22px; border-radius: 50%;
        background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.9);
        font-size: 12px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; margin-top: 1px;
      }
      .shelfd-reinstall-step-text {
        color: rgba(255,255,255,0.78); font-size: 13px; line-height: 1.5;
      }
      .shelfd-reinstall-step-text strong { color: #fff; font-weight: 600; }
      #shelfd-reinstall-note {
        color: rgba(255,255,255,0.36);
        font-size: 12px; line-height: 1.5;
        margin-bottom: 22px;
      }
      #shelfd-reinstall-btn {
        width: 100%; padding: 14px;
        background: #fff; color: #000;
        border: none; border-radius: 12px;
        font-family: 'DM Sans', system-ui, sans-serif;
        font-size: 15px; font-weight: 700;
        cursor: pointer; letter-spacing: -0.01em;
        transition: opacity 140ms ease, transform 140ms ease;
        -webkit-tap-highlight-color: transparent;
      }
      #shelfd-reinstall-btn:active { opacity: 0.82; transform: scale(0.98); }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function showNotice() {
    if (document.getElementById('shelfd-reinstall-backdrop')) return;
    injectNoticeStyles();

    const backdrop = document.createElement('div');
    backdrop.id = 'shelfd-reinstall-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'shelfd-reinstall-title');

    backdrop.innerHTML = `
      <div id="shelfd-reinstall-card">
        <div id="shelfd-reinstall-icon">⚡</div>
        <div id="shelfd-reinstall-title">Reinstall Required — One Time</div>
        <div id="shelfd-reinstall-body">
          A recent update changed how Shelfd stores files on your device.
          To get the latest version and fix any broken features, you'll need to
          remove and re-add the app — takes less than 30 seconds.
        </div>
        <div id="shelfd-reinstall-steps">
          <div class="shelfd-reinstall-step">
            <div class="shelfd-reinstall-step-num">1</div>
            <div class="shelfd-reinstall-step-text">
              <strong>Hold the app</strong> on your home screen and tap
              <strong>Remove App</strong>
            </div>
          </div>
          <div class="shelfd-reinstall-step">
            <div class="shelfd-reinstall-step-num">2</div>
            <div class="shelfd-reinstall-step-text">
              Open <strong>Safari</strong> and go to
              <strong>myscreenlist.com</strong>
            </div>
          </div>
          <div class="shelfd-reinstall-step">
            <div class="shelfd-reinstall-step-num">3</div>
            <div class="shelfd-reinstall-step-text">
              Tap the <strong>Share button</strong> and select
              <strong>Add to Home Screen</strong>
            </div>
          </div>
        </div>
        <div id="shelfd-reinstall-note">This is a one-time step. It won't happen again.</div>
        <button id="shelfd-reinstall-btn" type="button">Got it</button>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('visible')));

    // Dismiss
    document.getElementById('shelfd-reinstall-btn').addEventListener('click', function dismissNotice() {
      try { localStorage.setItem(NOTICE_KEY, '1'); } catch (e) {}
      backdrop.classList.remove('visible');
      setTimeout(() => { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 300);
    });
  }

  // Wait for app to be ready before showing
  function scheduleNotice() {
    const show = () => setTimeout(showNotice, 900);
    if (window.__shelfdAppReady) { show(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; window.removeEventListener('shelfd:app-ready', finish); show(); };
    window.addEventListener('shelfd:app-ready', finish, { once: true });
    setTimeout(finish, 8000);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', scheduleNotice, { once: true });
  } else {
    scheduleNotice();
  }
})();
