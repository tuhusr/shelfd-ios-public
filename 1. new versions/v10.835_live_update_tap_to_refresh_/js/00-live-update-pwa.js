// Shelfd split runtime guard v364-force-fresh.
// Direct chunk loads set this flag so compatibility /script.js never double-loads them.
window.__shelfdSplitScriptsLoading = true;
window.__shelfdSplitChunkVersion = '364-force-fresh';

// ScreenList deploy notice: browser + PWA clients are told to reopen without forcing a refresh.
(function initScreenListDeployAutoRefresh() {
  const currentVersion = String(window.SCREENLIST_BUILD_VERSION || '').trim();
  if (!currentVersion || window.__screenListDeployAutoRefreshReady) return;
  window.__screenListDeployAutoRefreshReady = true;

  let checking = false;
  let updateNoticeShown = false;
  let lastCheckAt = 0;
  let serviceWorkerRefreshBound = false;
  let deferredNoticeScheduled = false;

  const MIN_CHECK_GAP_MS = 15000;
  const CHECK_INTERVAL_MS = 60000;
  const LIVE_UPDATE_SPLASH_KEY = 'screenlist-live-update-splash-v3';
  const LIVE_UPDATE_AFTER_LOAD_HOLD_MS = 700;
  const LIVE_UPDATE_APP_READY_TIMEOUT_MS = 10000;
  const LIVE_UPDATE_NOTICE_VISIBLE_MS = 6000;
  const LIVE_UPDATE_LOGO_SRC = '/live_update_splash_logo.png?v=362-pwa-edge-no-store';
  /* v746: bumped key forces standalone PWAs to run the one-shot
     full-cache wipe + SW unregister + reload one more time on next
     launch. Combined with the SW CACHE bump in sw.js, this gives PWAs
     two independent paths to recover from stale state — whichever
     fires first wins. */
  const PWA_CACHE_RESET_KEY = 'shelfd-pwa-cache-reset-v746';

  function isCriticalOverlayOpen() {
    return !!(
      document.body?.classList.contains('movie-rating-duel-open')
      || document.body?.classList.contains('mylist-settings-open')
    );
  }

  function scheduleDeferredUpdateNotice(nextVersion = '') {
    if (deferredNoticeScheduled) return;
    deferredNoticeScheduled = true;
    setTimeout(() => {
      deferredNoticeScheduled = false;
      if (document.hidden) return;
      showLiveUpdateNotice(nextVersion);
    }, 1200);
  }

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
      .screenlist-live-update-slogan {
        margin-top: 5px;
        color: rgba(255,255,255,1);
        font-family: 'Sohne', 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.25;
        letter-spacing: 0;
      }
      .screenlist-live-update-loader { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 22px; }
      .screenlist-live-update-loader span { width: 8px; height: 8px; border-radius: 999px; background: #a78bfa; box-shadow: 0 0 18px rgba(167,139,250,0.52); animation: screenlistLiveUpdateDot 820ms ease-in-out infinite; }
      .screenlist-live-update-loader span:nth-child(2) { animation-delay: 120ms; }
      .screenlist-live-update-loader span:nth-child(3) { animation-delay: 240ms; }
      body.screenlist-live-update-active { overflow: hidden !important; }
      @keyframes screenlistLiveUpdateDot { 0%, 80%, 100% { transform: translateY(0) scale(.72); opacity: .38; } 38% { transform: translateY(-7px) scale(1); opacity: 1; } }
      @media (max-width: 600px) { .screenlist-live-update-brand { width: min(500px, 90vw); } }
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
        <div class="screenlist-live-update-slogan">Your trackers, favorite tracker</div>
        <div class="screenlist-live-update-loader" aria-hidden="true"><span></span><span></span><span></span></div>
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

  /* v10.506: Capacitor iOS cold-launch splash. The inline boot-hold script
     in index.html sets `window.__shelfdNeedsColdLaunchSplash = true` when
     it detects the WebView is running inside Capacitor native. Without this
     path, the boot-hold would just leave a blank black background between
     the iOS native LaunchScreen dismiss and full JS hydration (which can
     take a few seconds because Firebase auth + Firestore reads + the
     hydration of `body.main-tab-mylist` + `#mylist-profile-controls` +
     `render()` all need to complete first). Instead, we render the same
     branded Shelfd splash (logo + lavender pulsing loader) that the live-
     update flow uses, providing seamless visual continuity from the iOS
     native splash → web splash → hydrated shelf. The wait-and-hide cycle
     reuses the existing `waitForScreenListAppReadyThenHide` which already
     listens for the `shelfd:app-ready` event fired from every auth-
     resolution path in 17-comments-auth-init.js. */
  function finishColdLaunchSplashIfNeeded() {
    if (!window.__shelfdNeedsColdLaunchSplash) return;
    /* Don't re-show if a live-update splash already ran for this boot. */
    if (document.body && document.body.classList.contains('screenlist-live-update-active')) return;
    const run = () => {
      const startedAt = Date.now();
      showLiveUpdateSplash();
      waitForScreenListAppReadyThenHide(startedAt, LIVE_UPDATE_AFTER_LOAD_HOLD_MS);
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  function ensureLiveUpdateNoticeStyles() {
    if (document.getElementById('screenlist-live-update-notice-style')) return;
    const style = document.createElement('style');
    style.id = 'screenlist-live-update-notice-style';
    style.textContent = `
      #screenlist-live-update-notice {
        position: fixed;
        z-index: 2147483647;
        top: max(10px, env(safe-area-inset-top, 0px));
        left: 50%;
        width: min(92vw, 430px);
        min-height: 42px;
        padding: 10px 16px;
        border: 1px solid rgba(187,247,208,0.34);
        border-radius: 999px;
        background: rgba(22,163,74,0.60);
        -webkit-backdrop-filter: blur(18px) saturate(150%);
        backdrop-filter: blur(18px) saturate(150%);
        box-shadow: 0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.22);
        color: #ffffff;
        font-family: 'Sohne', 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 15px;
        font-weight: 300;
        line-height: 1.28;
        letter-spacing: 0;
        text-align: center;
        pointer-events: none;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
        opacity: 0;
        --screenlist-live-update-notice-y: 0px;
        transform: translate3d(-50%, calc(-100% - max(24px, env(safe-area-inset-top, 0px))), 0) scale(0.98);
        transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease;
      }
      #screenlist-live-update-notice.is-open {
        opacity: 1;
        pointer-events: auto;
        transform: translate3d(-50%, var(--screenlist-live-update-notice-y), 0) scale(1);
      }
      #screenlist-live-update-notice.is-dragging {
        transition: none;
      }
      #screenlist-live-update-notice.is-closing {
        opacity: 0;
        pointer-events: none;
        transform: translate3d(-50%, calc(-100% - max(24px, env(safe-area-inset-top, 0px))), 0) scale(0.98);
      }
      @media (prefers-reduced-motion: reduce) {
        #screenlist-live-update-notice { transition: none; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeLiveUpdateNotice(notice) {
    const el = notice || document.getElementById('screenlist-live-update-notice');
    if (!el) return;
    try { clearTimeout(window.__screenListLiveUpdateNoticeTimer); } catch (error) {}
    el.classList.remove('is-open', 'is-dragging');
    el.classList.add('is-closing');
    el.style.removeProperty('--screenlist-live-update-notice-y');
    setTimeout(() => {
      try {
        el.classList.remove('is-closing');
        el.remove();
      } catch (error) {}
    }, 280);
  }

  function bindLiveUpdateNoticeDismiss(notice) {
    if (!notice || notice.dataset.dismissReady === 'true') return;
    notice.dataset.dismissReady = 'true';
    let pointerId = null;
    let startY = 0;
    let dragging = false;

    const endDrag = (event) => {
      if (pointerId !== null && event?.pointerId !== pointerId) return;
      const currentY = Number(notice.dataset.dragY || '0') || 0;
      pointerId = null;
      dragging = false;
      notice.classList.remove('is-dragging');
      notice.releasePointerCapture?.(event?.pointerId);
      delete notice.dataset.dragY;
      if (currentY <= -34) {
        closeLiveUpdateNotice(notice);
        return;
      }
      notice.style.setProperty('--screenlist-live-update-notice-y', '0px');
    };

    notice.addEventListener('pointerdown', (event) => {
      if (event.button && event.button !== 0) return;
      pointerId = event.pointerId;
      startY = event.clientY || 0;
      dragging = true;
      notice.classList.add('is-dragging');
      notice.setPointerCapture?.(pointerId);
    });
    notice.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const dy = Math.min(0, Math.round((event.clientY || 0) - startY));
      notice.dataset.dragY = String(dy);
      notice.style.setProperty('--screenlist-live-update-notice-y', `${dy}px`);
    });
    notice.addEventListener('pointerup', endDrag);
    notice.addEventListener('pointercancel', endDrag);
  }

  function showLiveUpdateNotice(nextVersion = '') {
    updateNoticeShown = true;
    const run = () => {
      ensureLiveUpdateNoticeStyles();
      let notice = document.getElementById('screenlist-live-update-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'screenlist-live-update-notice';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        document.body.appendChild(notice);
      }
      bindLiveUpdateNoticeDismiss(notice);
      notice.textContent = 'A live update was deployed. Reopen the app to apply changes.';
      notice.dataset.nextVersion = String(nextVersion || '');
      notice.classList.remove('is-closing', 'is-dragging');
      notice.style.setProperty('--screenlist-live-update-notice-y', '0px');
      requestAnimationFrame(() => notice.classList.add('is-open'));
      try { clearTimeout(window.__screenListLiveUpdateNoticeTimer); } catch (error) {}
      window.__screenListLiveUpdateNoticeTimer = setTimeout(() => closeLiveUpdateNotice(notice), LIVE_UPDATE_NOTICE_VISIBLE_MS);
      try { localStorage.setItem('screenlist-last-live-update-notice', String(Date.now())); } catch (error) {}
    };
    if (document.body) run();
    else window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  async function checkForScreenListDeployUpdate(force) {
    if (checking || updateNoticeShown) return;
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
        showLiveUpdateNotice(nextVersion);
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
          if (updateNoticeShown) return;
          scheduleDeferredUpdateNotice();
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
    /* v10.981: disabled the old standalone cache-reset reload path.
       Open sessions must keep running so users can finish edits and Firestore
       writes. The active update path now only shows the reopen-app notice. */
    return false;
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
    await resetStandalonePwaCachesOnce();
    finishReloadSplashIfNeeded();
    /* v10.506: fire the Capacitor cold-launch splash AFTER the live-update
       splash check so a live-update reload (sessionStorage flag set) takes
       precedence and we don't double-show. The function itself is a no-op
       unless `window.__shelfdNeedsColdLaunchSplash` was set by the inline
       boot-hold script in index.html (i.e. only on Capacitor native). */
    finishColdLaunchSplashIfNeeded();
    /* v10.696: COLD-BOOT SELF-CHECK THROTTLE. Previously fired immediately
       on boot, competing with Firebase SDK download + Firestore hydration
       for main-thread and network bandwidth during the most important
       seconds of the launch. Defer 3s so first paint wins the race. The
       `load` event listener below also auto-fires once initial resources
       finish loading — both paths converge after hydration. */
    setTimeout(() => { forceRefreshServiceWorker(); }, 3000);
    showStartupSplashIfNeeded();
    window.checkScreenListDeployUpdate = () => checkForScreenListDeployUpdate(true);
    setInterval(() => checkForScreenListDeployUpdate(false), CHECK_INTERVAL_MS);
    window.addEventListener('load', () => {
      /* v10.696: also delay 1.5s so this fires AFTER fast-paint hydration
         even on very fast cold launches where `load` arrives quickly. */
      setTimeout(() => {
        forceRefreshServiceWorker();
        checkForScreenListDeployUpdate(true);
      }, 1500);
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
