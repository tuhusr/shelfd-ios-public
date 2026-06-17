/*
  50-yt-alert-notice.js
  v11.969 — TEMPORARY universal "known issue" notice for the global YouTube video
  outage (the embedded-player "Sign in to confirm you're not a bot" wall).

  A small RED circular alert button is pinned exactly where the (now-disabled)
  creator dev-hammer FAB used to sit — position:fixed, right:8px,
  bottom: safe-area + 78px (see 33-push-notifications.js). It is shown to EVERYONE
  (not creator-gated) and stays present WHENEVER the mobile bottom nav is present
  (its visibility is kept in sync with #mobile-bottom-nav, so it hides on the same
  full-screen surfaces the nav hides on: DM, media/game profiles, filmography, etc.).

  Tapping it opens a simple modal that tells users the YouTube issue is known and
  being fixed. The bottom nav itself is NOT modified in any way.

  REMOVE WHEN YOUTUBE PLAYBACK IS RESTORED: delete this file, its <script> tag in
  index.html, and the v11.969 version bump.
*/
(function () {
  'use strict';

  var FAB_ID = 'shelfd-yt-notice-fab';
  var MODAL_ID = 'shelfd-yt-notice-modal';
  var STYLE_ID = 'shelfd-yt-notice-styles';
  var MESSAGE = "I am aware of the current issue globally with the YouTube videos. Fixes are on the way. Hang tight.";

  /* exclamation glyph (NO emoji — CSS/SVG per house rule); inherits currentColor */
  var ALERT_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7.4v5.4" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="16.7" r="1.35" fill="currentColor"/></svg>';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = ''
      /* red alert FAB — same anchor as the old dev hammer (right:8px, bottom: safe-area + 78px) */
      + '#' + FAB_ID + '{position:fixed;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 78px);width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,120,124,0.55);background:#e5484d;color:#fff;display:none;align-items:center;justify-content:center;z-index:1400;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent;box-shadow:0 4px 14px rgba(229,72,77,0.45);animation:shelfdYtNoticePulse 2.4s ease-in-out infinite;}'
      + '#' + FAB_ID + ' svg{width:18px;height:18px;display:block;}'
      + '#' + FAB_ID + ':active{transform:scale(0.92);}'
      + '@keyframes shelfdYtNoticePulse{0%{box-shadow:0 4px 14px rgba(229,72,77,0.45),0 0 0 0 rgba(229,72,77,0.42);}70%{box-shadow:0 4px 14px rgba(229,72,77,0.45),0 0 0 9px rgba(229,72,77,0);}100%{box-shadow:0 4px 14px rgba(229,72,77,0.45),0 0 0 0 rgba(229,72,77,0);}}'
      + '@media (prefers-reduced-motion: reduce){#' + FAB_ID + '{animation:none;}}'
      /* modal */
      + '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.62);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity 220ms ease;}'
      + '#' + MODAL_ID + '.is-open{opacity:1;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-card{width:min(340px,100%);background:#141414;border:1px solid rgba(255,255,255,0.10);border-radius:20px;padding:24px 22px 18px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.55);transform:translateY(10px) scale(0.97);transition:transform 280ms cubic-bezier(0.22,1,0.36,1);letter-spacing:-0.03em;}'
      + '#' + MODAL_ID + '.is-open .shelfd-yt-notice-card{transform:none;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-icon{width:46px;height:46px;border-radius:50%;background:rgba(229,72,77,0.14);border:1px solid rgba(229,72,77,0.40);color:#e5484d;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-icon svg{width:24px;height:24px;display:block;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-title{font:600 17px/1.2 Sohne,"DM Sans",sans-serif;color:#fff;margin:0 0 8px;letter-spacing:-0.03em;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-body{font:400 14px/1.5 Sohne,"DM Sans",sans-serif;color:rgba(255,255,255,0.74);margin:0 0 18px;letter-spacing:-0.03em;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-ok{appearance:none;-webkit-appearance:none;border:0;width:100%;padding:12px 16px;border-radius:12px;background:rgba(139,92,246,0.18);color:#c4b5fd;font:600 14px/1 Sohne,"DM Sans",sans-serif;letter-spacing:-0.03em;cursor:pointer;-webkit-tap-highlight-color:transparent;}'
      + '#' + MODAL_ID + ' .shelfd-yt-notice-ok:active{transform:scale(0.98);background:rgba(139,92,246,0.26);}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function openModal() {
    var m = document.getElementById(MODAL_ID);
    if (!m) return;
    m.style.display = 'flex';
    void m.offsetWidth;            // reflow so the open transition runs
    m.classList.add('is-open');
  }
  function closeModal() {
    var m = document.getElementById(MODAL_ID);
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { if (m && !m.classList.contains('is-open')) m.style.display = 'none'; }, 240);
  }

  function build() {
    if (!document.body) { setTimeout(build, 150); return; }
    injectStyles();

    if (!document.getElementById(FAB_ID)) {
      var fab = document.createElement('button');
      fab.id = FAB_ID;
      fab.type = 'button';
      fab.setAttribute('aria-label', 'Known issue with YouTube videos');
      fab.innerHTML = ALERT_SVG;
      fab.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openModal(); });
      document.body.appendChild(fab);
    }

    if (!document.getElementById(MODAL_ID)) {
      var modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Known issue');
      modal.innerHTML =
        '<div class="shelfd-yt-notice-card" role="document">'
        + '<div class="shelfd-yt-notice-icon">' + ALERT_SVG + '</div>'
        + '<h2 class="shelfd-yt-notice-title">Heads up</h2>'
        + '<p class="shelfd-yt-notice-body"></p>'
        + '<button type="button" class="shelfd-yt-notice-ok">Got it</button>'
        + '</div>';
      modal.querySelector('.shelfd-yt-notice-body').textContent = MESSAGE;
      modal.addEventListener('click', function (e) {
        var hitOk = e.target && e.target.closest && e.target.closest('.shelfd-yt-notice-ok');
        if (e.target === modal || hitOk) { e.preventDefault(); closeModal(); }
      });
      document.body.appendChild(modal);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    }

    syncVisibility();
    wireVisibilitySync();
  }

  /* Keep the FAB visible ONLY while the bottom nav is visible — mirror the nav's
     effective display so the alert hides on the same full-screen surfaces. */
  function syncVisibility() {
    var fab = document.getElementById(FAB_ID);
    if (!fab) return;
    var nav = document.getElementById('mobile-bottom-nav');
    var visible = false;
    if (nav) {
      try {
        var cs = getComputedStyle(nav);
        visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.01;
      } catch (e) { visible = true; }
    }
    fab.style.display = visible ? 'inline-flex' : 'none';
  }

  var _wired = false;
  function wireVisibilitySync() {
    if (_wired) return;
    _wired = true;
    try {
      var mo = new MutationObserver(function () { syncVisibility(); });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      var nav = document.getElementById('mobile-bottom-nav');
      if (nav) mo.observe(nav, { attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) {}
    setInterval(syncVisibility, 1000);                 // safety net for ancestor / media-query driven hides
    window.addEventListener('resize', syncVisibility);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
