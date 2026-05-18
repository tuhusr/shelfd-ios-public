(function initShelfdPortraitOrientationLock() {
  const PORTRAIT_LOCK = 'portrait';

  function isPhoneLandscapeViewport() {
    const vv = window.visualViewport;
    const width = Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0);
    const height = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const coarse = !window.matchMedia || window.matchMedia('(pointer: coarse)').matches;
    return coarse && width > height && Math.min(width, height) <= 560;
  }

  function syncPortraitLockState() {
    document.documentElement.classList.toggle('shelfd-phone-landscape-lock', isPhoneLandscapeViewport());
  }

  function requestNativePortraitLock() {
    const orientation = window.screen?.orientation;
    if (!orientation || typeof orientation.lock !== 'function') return;
    try {
      const result = orientation.lock(PORTRAIT_LOCK);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (error) {
      /* Browser denied orientation locking; CSS fallback still preserves portrait layout. */
    }
  }

  function syncAndLock() {
    syncPortraitLockState();
    requestNativePortraitLock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAndLock, { once: true });
  } else {
    syncAndLock();
  }

  window.addEventListener('resize', syncPortraitLockState, { passive: true });
  window.addEventListener('orientationchange', syncAndLock, { passive: true });
  window.visualViewport?.addEventListener?.('resize', syncPortraitLockState, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAndLock();
  });
  document.addEventListener('pointerdown', requestNativePortraitLock, { passive: true });
})();
