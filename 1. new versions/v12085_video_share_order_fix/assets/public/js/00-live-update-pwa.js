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
  let activeUpdateNoticeVersion = '';
  let dismissedUpdateNoticeVersion = '';
  let lastCheckAt = 0;
  let serviceWorkerRefreshBound = false;
  let deferredNoticeScheduled = false;
  /* v11.699: RESUME AUTO-UPDATE. The in-session update NOTICE stays disabled
     (showLiveUpdateNotice early-returns), but a deploy must still actually reach
     the running app — on iOS the app icon RESUMES the suspended WKWebView (no
     reload), so a user kept running stale JS forever and never saw new code
     (root cause of "deployed the video-source-mix fix but the live app never
     changed"). Now: when the app returns to the foreground after being
     BACKGROUNDED and a newer build is live, we seamlessly reload to fetch the
     new assets — but ONLY on a safe screen (no focused input / open composer),
     so an unsaved draft is never lost. Active foreground use is untouched. */
  let appHiddenAt = 0;

  const MIN_CHECK_GAP_MS = 15000;
  const CHECK_INTERVAL_MS = 60000;
  const LIVE_UPDATE_MIN_BG_MS = 2500;        // ignore quick blurs (perm sheet) — only reload after a real background
  const LIVE_UPDATE_APPLIED_KEY = 'screenlist-live-update-applied-version';   // session guard: reload once per new version
  const LIVE_UPDATE_SPLASH_KEY = 'screenlist-live-update-splash-v3';
  const LIVE_UPDATE_AFTER_LOAD_HOLD_MS = 700;
  const LIVE_UPDATE_APP_READY_TIMEOUT_MS = 10000;
  const LIVE_UPDATE_NOTICE_VISIBLE_MS = 3300;
  /* v11.235: new square app-icon logo (dark rounded square + gold star). */
  const LIVE_UPDATE_LOGO_SRC = '/splash_logo_icon.svg?v=11235';
  const CREATOR_DEV_PREVIEW_UID = 'KihPpiqSsFMpn5Tee4xZWFWapg62';
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

  function normalizeUpdateNoticeVersion(nextVersion = '') {
    return String(nextVersion || '').trim();
  }

  function resolveLiveUpdateUid() {
    try {
      if (window.currentUser && window.currentUser.uid) return String(window.currentUser.uid).trim();
    } catch (_) {}
    try {
      if (window.__shelfdUser && window.__shelfdUser.uid) return String(window.__shelfdUser.uid).trim();
    } catch (_) {}
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) {
        return String(firebase.auth().currentUser.uid).trim();
      }
    } catch (_) {}
    return '';
  }

  function isCreatorDevPreviewAccount() {
    return resolveLiveUpdateUid() === CREATOR_DEV_PREVIEW_UID;
  }

  function isDevPreviewBuild(version = '') {
    return String(version || '').toLowerCase().includes('_dev_');
  }

  function shouldSurfaceUpdateNotice(nextVersion = '') {
    const effectiveVersion = normalizeUpdateNoticeVersion(nextVersion) || currentVersion;
    if (!effectiveVersion) return true;
    if (!isDevPreviewBuild(effectiveVersion)) return true;
    return isCreatorDevPreviewAccount();
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
      /* v11.235: logo is now a SQUARE app icon, not a wide wordmark. Size it
         as a centered icon tile with rounded corners and a soft lavender glow. */
      .screenlist-live-update-brand {
        width: min(132px, 34vw); height: auto; aspect-ratio: 1 / 1; object-fit: contain;
        display: block; border-radius: 26px;
        filter: drop-shadow(0 20px 44px rgba(124,58,237,0.34));
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
      /* v11.258: splash loader is now a SHELF of books — books pop up onto a
         shelf plank one after another, looping. Replaces the 3 bouncing dots. */
      .screenlist-live-update-loader { position: relative; display: inline-flex; align-items: flex-end; justify-content: center; gap: 5px; height: 30px; padding: 0 4px 6px; }
      .screenlist-live-update-loader span { width: 7px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #c4b5fd, #8b5cf6); box-shadow: 0 0 14px rgba(167,139,250,0.45); transform: translateY(9px) scaleY(0.4); transform-origin: bottom center; opacity: 0; animation: screenlistShelfBook 1.5s cubic-bezier(0.34,1.56,0.64,1) infinite; }
      .screenlist-live-update-loader span:nth-child(1) { height: 22px; animation-delay: 0s; }
      .screenlist-live-update-loader span:nth-child(2) { height: 28px; animation-delay: 0.12s; background: linear-gradient(180deg, #ddd0ff, #a78bfa); }
      .screenlist-live-update-loader span:nth-child(3) { height: 18px; animation-delay: 0.24s; }
      .screenlist-live-update-loader span:nth-child(4) { height: 26px; animation-delay: 0.36s; background: linear-gradient(180deg, #ddd0ff, #a78bfa); }
      .screenlist-live-update-loader span:nth-child(5) { height: 20px; animation-delay: 0.48s; }
      .screenlist-live-update-loader::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.28); box-shadow: 0 0 10px rgba(167,139,250,0.4); }
      body.screenlist-live-update-active { overflow: hidden !important; }
      @keyframes screenlistShelfBook { 0% { transform: translateY(9px) scaleY(0.4); opacity: 0; } 18% { transform: translateY(0) scaleY(1); opacity: 1; } 72% { transform: translateY(0) scaleY(1); opacity: 1; } 90%, 100% { transform: translateY(9px) scaleY(0.4); opacity: 0; } }
      @media (max-width: 600px) { .screenlist-live-update-brand { width: min(120px, 32vw); } }
      @media (prefers-reduced-motion: reduce) { #screenlist-live-update-splash, .screenlist-live-update-card { transition: none; } .screenlist-live-update-loader span { animation-duration: 3s; } }
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
        <div class="screenlist-live-update-loader" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
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
        cursor: pointer;
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
    const closedVersion = normalizeUpdateNoticeVersion(el.dataset.nextVersion || '');
    if (closedVersion) dismissedUpdateNoticeVersion = closedVersion;
    if (closedVersion && activeUpdateNoticeVersion === closedVersion) activeUpdateNoticeVersion = '';
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

  /* v10.835: tap-to-refresh.
     When the user taps the green live-update notice, we force the auto-update
     so they don't have to close + reopen the app:
       1. Mark the splash session-storage flag so finishReloadSplashIfNeeded()
          plays the live-update splash immediately after the reload completes
          (continuity — same animation as a SW-controlled refresh).
       2. Tell any waiting service worker to skipWaiting so the new build
          activates right now. sw.js already listens for SKIP_WAITING.
       3. location.reload() — in the Capacitor WKWebView this re-fetches
          https://myscreenlist.com/ from Cloudflare, which already has the
          new assets live. Same effect as closing/reopening the native app
          but in one tap, no quitting required. */
  function triggerLiveUpdateNow() {
    dismissedUpdateNoticeVersion = '';
    activeUpdateNoticeVersion = '';
    try { sessionStorage.setItem(LIVE_UPDATE_SPLASH_KEY, '1'); } catch (error) {}
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          try {
            if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch (error) {}
        }).catch(() => {});
      }
    } catch (error) {}
    /* Tiny delay so SKIP_WAITING has a frame to fire before we navigate. */
    setTimeout(() => {
      try { window.location.reload(); }
      catch (error) {
        try { window.location.href = window.location.href; } catch (e2) {}
      }
    }, 60);
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
      /* v10.835: drag UP past 34px → dismiss the pill. */
      if (currentY <= -34) {
        closeLiveUpdateNotice(notice);
        return;
      }
      /* v10.835: barely moved → treat as a TAP and force the refresh. */
      if (Math.abs(currentY) < 6) {
        closeLiveUpdateNotice(notice);
        triggerLiveUpdateNow();
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
    /* v11.200: the green "A live update is ready" drop-down pill is DISABLED.
       Per product decision, an update that goes live while a user is in the
       app does nothing — no banner, no prompt. The only way to launch the new
       build is to fully close and reopen the app (the cold-launch reopen path
       in finishColdLaunchSplashIfNeeded / the SW picking up the new assets on
       next boot is unchanged). This early return is the single kill-switch:
       every caller (deploy-version check + SW controllerchange) routes through
       here, so neutralizing it removes the notice everywhere without ripping
       out the surrounding update-check machinery. To restore, delete this
       block. */
    return;
    /* eslint-disable no-unreachable */
    const normalizedNextVersion = normalizeUpdateNoticeVersion(nextVersion);
    if (!shouldSurfaceUpdateNotice(normalizedNextVersion)) return;
    if (normalizedNextVersion && normalizedNextVersion === currentVersion) return;
    if (normalizedNextVersion && normalizedNextVersion === dismissedUpdateNoticeVersion) return;
    if (normalizedNextVersion) activeUpdateNoticeVersion = normalizedNextVersion;
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
      notice.textContent = 'A live update is ready — tap to refresh now.';
      notice.dataset.nextVersion = normalizedNextVersion;
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
    if (checking) return;
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
      if (!nextVersion || nextVersion === currentVersion) return;
      if (!shouldSurfaceUpdateNotice(nextVersion)) return;
      if (nextVersion === dismissedUpdateNoticeVersion) return;
      const openNoticeVersion = normalizeUpdateNoticeVersion(document.getElementById('screenlist-live-update-notice')?.dataset?.nextVersion || '');
      if (openNoticeVersion && openNoticeVersion === nextVersion) return;
      if (nextVersion && nextVersion !== currentVersion) {
        showLiveUpdateNotice(nextVersion);
      }
    } catch (error) {
      console.warn('ScreenList update check failed:', error);
    } finally {
      checking = false;
    }
  }

  /* v11.699: don't auto-reload out from under an unsaved draft or a critical
     flow. Bail if any editable element is focused, or a known composer / modal /
     critical overlay is open. Conservative by design — a missed reload just
     happens on the NEXT clean resume; a wrong reload would lose user input. */
  function isLiveUpdateReloadUnsafe() {
    try {
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName || ''))) return true;
    } catch (_) {}
    if (isCriticalOverlayOpen()) return true;
    try {
      const b = document.body;
      if (b && b.classList && (
        b.classList.contains('dm-fullscreen-open')
        || b.classList.contains('review-composer-open')
        || b.classList.contains('comment-composer-open')
        || b.classList.contains('shelfd-modal-open')
        || b.classList.contains('movie-rating-duel-open')
      )) return true;
    } catch (_) {}
    return false;
  }

  /* v11.699: seamlessly reload to the new build (continuity splash on the way
     back via LIVE_UPDATE_SPLASH_KEY). Guarded so it fires at most once per new
     version per session — no reload loops. */
  function applyLiveUpdateReload(nextVersion) {
    const v = normalizeUpdateNoticeVersion(nextVersion);
    if (!v || v === currentVersion) return;
    let already = '';
    try { already = sessionStorage.getItem(LIVE_UPDATE_APPLIED_KEY) || ''; } catch (_) {}
    if (already === v) return;
    try { sessionStorage.setItem(LIVE_UPDATE_APPLIED_KEY, v); } catch (_) {}
    try { sessionStorage.setItem(LIVE_UPDATE_SPLASH_KEY, '1'); } catch (_) {}
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          try { if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
        }).catch(() => {});
      }
    } catch (_) {}
    setTimeout(() => {
      try { window.location.reload(); }
      catch (e) { try { window.location.href = window.location.href; } catch (e2) {} }
    }, 40);
  }

  /* v11.699: RESUME path — formerly reloaded the running app when it returned
     from the background and a newer build was live.
     v12.036: DISABLED. Reloading on background→foreground resume blew away the
     user's exact spot in the app (scroll position, half-watched video, open
     sheet) whenever a deploy happened to land while they were app-switching.
     Updates must now ONLY apply on a true COLD START — the user fully closes the
     app (swipe-quit) and reopens it, which destroys + recreates the WKWebView
     and naturally fetches the new assets from Cloudflare. A backgrounded-then-
     resumed session keeps running its current build untouched. This function is
     kept as a no-op so its three call sites (visibilitychange / Capacitor
     appStateChange / persisted pageshow) stay wired but never reload. */
  async function checkAndMaybeAutoReloadOnResume() {
    return;
  }

  async function forceRefreshServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;
      if (!serviceWorkerRefreshBound) {
        serviceWorkerRefreshBound = true;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          const notice = document.getElementById('screenlist-live-update-notice');
          if (notice && notice.classList.contains('is-open')) return;
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
    window.addEventListener('pageshow', (event) => {
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
      /* v11.699: a persisted pageshow == bfcache restore == resume → load latest. */
      if (event && event.persisted) checkAndMaybeAutoReloadOnResume();
    });
    window.addEventListener('online', () => {
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { appHiddenAt = Date.now(); return; }
      forceRefreshServiceWorker();
      checkForScreenListDeployUpdate(true);
      /* v11.699: on RESUME after a real background gap, seamlessly load the
         latest build (draft-safe inside). Quick blurs (a permission sheet) fall
         under the gap and are ignored. */
      const bgGap = appHiddenAt ? (Date.now() - appHiddenAt) : 0;
      if (bgGap >= LIVE_UPDATE_MIN_BG_MS) checkAndMaybeAutoReloadOnResume();
    });
    /* v11.699: Capacitor native foreground/background — the most reliable signal
       inside the iOS WKWebView (visibilitychange can be flaky on resume). Mirrors
       the appStateChange listener already used by 33-push-notifications.js. */
    try {
      const Cap = window.Capacitor;
      const App = Cap && Cap.Plugins && Cap.Plugins.App;
      if (App && typeof App.addListener === 'function') {
        App.addListener('appStateChange', (appState) => {
          if (appState && appState.isActive) {
            const bgGap = appHiddenAt ? (Date.now() - appHiddenAt) : LIVE_UPDATE_MIN_BG_MS;
            forceRefreshServiceWorker();
            checkForScreenListDeployUpdate(true);
            if (bgGap >= LIVE_UPDATE_MIN_BG_MS) checkAndMaybeAutoReloadOnResume();
          } else {
            appHiddenAt = Date.now();
          }
        });
      }
    } catch (_) {}
  }

  startScreenListLiveUpdateRuntime();
})();

// Double-tap zoom guard removed: the viewport already sets user-scalable=no + maximum-scale=1.0,
// which prevents zoom natively. The previous touchend preventDefault() was cancelling
// synthesized click events inside iOS PWA standalone (WKWebView), breaking tap interactions.
