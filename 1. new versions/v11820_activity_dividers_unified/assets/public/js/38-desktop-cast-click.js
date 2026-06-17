/* =============================================================================
   Desktop cast-card → actor profile click guarantee  (v11.334)
   File: assets/public/js/38-desktop-cast-click.js

   DESKTOP ONLY. On desktop, clicking a cast card in the FPMP "Cast" row was
   not opening the actor/actress full-page profile. The card is a <button> with
   an inline bubble-phase onclick="handleDiscoverCastCardClick(...)"; on desktop
   that bubble click was being swallowed before it reached the handler, so the
   profile never opened ("absolutely nothing happens").

   Fix: a CAPTURE-PHASE listener on document — capture runs from the top of the
   tree downward, BEFORE any bubble-phase handler and before anything lower in
   the tree can stopPropagation() it. When a cast card is clicked on desktop we
   take over: stop the (broken) inline path and call openDiscoverPersonProfile
   directly, wrapped in try/catch so a thrown helper can never silently abort
   the open.

   The phone / iOS app is untouched: everything is gated to the desktop media
   query (min-width:701 + hover + fine pointer + NOT standalone), exactly like
   the rest of the desktop-only FPMP work.
   ========================================================================== */
(function () {
  'use strict';

  function isDesktopFpmp() {
    return window.matchMedia('(min-width: 701px) and (hover: hover) and (pointer: fine) and (not (display-mode: standalone))').matches;
  }

  document.addEventListener('click', function (e) {
    if (!isDesktopFpmp()) return;                       // mobile / iOS → leave native path alone

    const card = e.target.closest && e.target.closest('.discover-media-cast-card');
    if (!card) return;
    if (!card.closest('.discover-media-profile-overlay')) return;   // only inside an FPMP
    if (e.target.closest('.cast-fav-btn')) return;      // heart toggle → not a profile open

    // Character cards (anime) use a different handler — don't hijack those.
    if (card.classList.contains('discover-media-character-card')) return;

    const personId = card.dataset.personId;
    if (!personId) return;

    // Take over: block the broken inline onclick + any swallower, then open
    // the actor profile ourselves from the earliest possible point.
    e.preventDefault();
    e.stopImmediatePropagation();

    try {
      if (typeof window.openDiscoverPersonProfile === 'function') {
        window.openDiscoverPersonProfile(e, Number(personId) || personId);
      } else if (typeof window.handleDiscoverCastCardClick === 'function') {
        window.handleDiscoverCastCardClick(e, Number(personId) || personId);
      }
    } catch (err) {
      console.error('[shelfd] desktop cast-card open failed:', err);
    }
  }, true);
})();
