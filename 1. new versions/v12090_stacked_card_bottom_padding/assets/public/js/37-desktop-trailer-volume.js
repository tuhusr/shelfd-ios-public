/* =============================================================================
   Desktop FPMP trailer volume dropdown  (v11.319)
   File: assets/public/js/37-desktop-trailer-volume.js

   DESKTOP ONLY. On desktop, clicking the FPMP trailer volume button (the
   speaker, top-right) opens a small volume-slider dropdown so users can raise /
   lower the trailer volume, instead of the simple mute/unmute toggle.

   The phone / iOS app keeps its existing mute-toggle behaviour untouched: this
   is a capture-phase click interceptor gated to the desktop media query
   (min-width:701 + hover + fine pointer + NOT standalone). It blocks the inline
   onclick="toggleDiscoverHeroTrailerSound(...)" only on desktop and shows the
   dropdown instead. Volume is applied to the YouTube embed via the same
   postMessage IFrame-API commands the mute toggle already uses (enablejsapi=1).
   ========================================================================== */
(function () {
  'use strict';

  function isDesktopFpmp() {
    return window.matchMedia('(min-width: 701px) and (hover: hover) and (pointer: fine) and (not (display-mode: standalone))').matches;
  }

  function getTrailerIframe(btn) {
    const overlay = btn.closest('.discover-media-profile-overlay');
    return overlay && overlay.querySelector('[data-discover-trailer-preview-frame] iframe');
  }

  function postCommand(iframe, func, args) {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
    } catch (e) { /* no-op */ }
  }

  /* Reflect the volume on the button so the right built-in speaker glyph shows
     (muted vs unmuted) — CSS keys off data-sound-state. */
  function syncButtonState(btn, volume) {
    btn.dataset.volume = String(volume);
    btn.dataset.soundState = volume > 0 ? 'unmuted' : 'muted';
    btn.setAttribute('aria-pressed', volume > 0 ? 'true' : 'false');
    btn.setAttribute('aria-label', volume > 0 ? 'Trailer volume' : 'Unmute trailer audio');
  }

  function closeDropdown() {
    const dd = document.getElementById('desktop-trailer-volume-dd');
    if (dd) dd.remove();
    document.removeEventListener('mousedown', onOutsidePointer, true);
  }

  function onOutsidePointer(e) {
    const dd = document.getElementById('desktop-trailer-volume-dd');
    if (!dd) return;
    if (dd.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.discover-media-hero-preview-sound')) return;
    closeDropdown();
  }

  function openDropdown(btn) {
    if (document.getElementById('desktop-trailer-volume-dd')) { closeDropdown(); return; }
    const iframe = getTrailerIframe(btn);
    const current = Math.max(0, Math.min(100, Number(btn.dataset.volume || 0)));

    const dd = document.createElement('div');
    dd.id = 'desktop-trailer-volume-dd';
    dd.className = 'desktop-trailer-volume-dropdown';
    dd.innerHTML =
      '<span class="desktop-trailer-volume-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>' +
      '</span>' +
      '<input type="range" class="desktop-trailer-volume-slider" min="0" max="100" step="1" value="' + current + '" aria-label="Trailer volume">' +
      '<span class="desktop-trailer-volume-value" data-volume-value>' + current + '</span>';
    document.body.appendChild(dd);

    const rect = btn.getBoundingClientRect();
    dd.style.top = (rect.bottom + 10) + 'px';
    dd.style.left = (rect.left + rect.width / 2) + 'px';

    const slider = dd.querySelector('input');
    const valueLabel = dd.querySelector('[data-volume-value]');
    const apply = function (v) {
      v = Math.max(0, Math.min(100, Number(v) || 0));
      postCommand(iframe, v > 0 ? 'unMute' : 'mute');
      postCommand(iframe, 'setVolume', [v]);
      syncButtonState(btn, v);
      if (valueLabel) valueLabel.textContent = String(v);
    };
    slider.addEventListener('input', function () { apply(slider.value); });
    slider.addEventListener('click', function (e) { e.stopPropagation(); });

    setTimeout(function () {
      document.addEventListener('mousedown', onOutsidePointer, true);
      try { slider.focus(); } catch (e) {}
    }, 0);
  }

  /* Capture-phase interceptor: on desktop, take over the volume button click. */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.discover-media-hero-preview-sound');
    if (!btn) return;
    if (!isDesktopFpmp()) return;                 // mobile/iOS → leave the mute toggle alone
    if (!btn.closest('.discover-media-profile-overlay')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();                 // block the inline mute toggle
    openDropdown(btn);
  }, true);

  window.addEventListener('scroll', closeDropdown, true);
  window.addEventListener('resize', closeDropdown);
})();
