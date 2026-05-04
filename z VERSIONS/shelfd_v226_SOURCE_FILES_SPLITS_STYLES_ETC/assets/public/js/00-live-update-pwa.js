// ScreenList deploy auto-refresh: from this version forward, live clients check for a newer deployed index and reload automatically.
(function initScreenListDeployAutoRefresh() {
  const currentVersion = String(window.SCREENLIST_BUILD_VERSION || '').trim();
  if (!currentVersion || window.__screenListDeployAutoRefreshReady) return;
  window.__screenListDeployAutoRefreshReady = true;

  let checking = false;
  let reloading = false;
  let lastCheckAt = 0;
  const MIN_CHECK_GAP_MS = 15000;
  const CHECK_INTERVAL_MS = 60000;

  function readVersionFromHtml(html) {
    const metaMatch = String(html || '').match(/<meta\s+name=["']screenlist-build-version["']\s+content=["']([^"']+)["']/i);
    if (metaMatch && metaMatch[1]) return metaMatch[1].trim();
    const scriptMatch = String(html || '').match(/SCREENLIST_BUILD_VERSION\s*=\s*["']([^"']+)["']/);
    return scriptMatch && scriptMatch[1] ? scriptMatch[1].trim() : '';
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
        window.location.reload();
      }
    } catch (error) {
      console.warn('ScreenList update check failed:', error);
    } finally {
      checking = false;
    }
  }

  window.checkScreenListDeployUpdate = () => checkForScreenListDeployUpdate(true);
  setInterval(() => checkForScreenListDeployUpdate(false), CHECK_INTERVAL_MS);
  window.addEventListener('focus', () => checkForScreenListDeployUpdate(true));
  window.addEventListener('pageshow', () => checkForScreenListDeployUpdate(true));
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
