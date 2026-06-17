(function initShelfdPortraitOrientationLock() {
  const PORTRAIT_LOCK = 'portrait';

  function getShelfdViewportSize() {
    const vv = window.visualViewport;
    return {
      width: Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0),
      height: Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0)
    };
  }

  function isPhoneLandscapeViewport(size = getShelfdViewportSize()) {
    const { width, height } = size;
    const coarse = !window.matchMedia || window.matchMedia('(pointer: coarse)').matches;
    return coarse && width > height && Math.min(width, height) <= 620;
  }

  function syncPortraitLockState() {
    const size = getShelfdViewportSize();
    const locked = isPhoneLandscapeViewport(size);
    const root = document.documentElement;
    root.classList.toggle('shelfd-phone-landscape-lock', locked);
    if (locked) {
      root.style.setProperty('--shelfd-lock-viewport-w', `${size.width}px`);
      root.style.setProperty('--shelfd-lock-viewport-h', `${size.height}px`);
      root.style.setProperty('--shelfd-lock-portrait-w', `${size.height}px`);
      root.style.setProperty('--shelfd-lock-portrait-h', `${size.width}px`);
      document.body?.classList?.add('shelfd-phone-landscape-lock-active');
    } else {
      root.style.removeProperty('--shelfd-lock-viewport-w');
      root.style.removeProperty('--shelfd-lock-viewport-h');
      root.style.removeProperty('--shelfd-lock-portrait-w');
      root.style.removeProperty('--shelfd-lock-portrait-h');
      document.body?.classList?.remove('shelfd-phone-landscape-lock-active');
    }
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
    requestAnimationFrame(syncPortraitLockState);
    window.setTimeout(syncPortraitLockState, 250);
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
