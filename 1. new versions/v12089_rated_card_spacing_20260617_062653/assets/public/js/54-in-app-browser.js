/* =============================================================================
   54-in-app-browser.js  (v12.029)
   In-app browser for external links on the Capacitor iOS build.

   PROBLEM: tapping an external http(s) link (news article "View original",
   Instagram / App Store links, an <a href="https://…"> in shared content, etc.)
   on the native WKWebView either KICKS the user out to external Safari or — for
   a default-target link — tries to navigate the whole app webview away. Either
   way the user leaves Shelfd. We want those links to open in an in-app
   SFSafariViewController sheet (the @capacitor/browser plugin) so the user
   stays inside Shelfd, exactly like the way Google sign-in keeps them in-app.

   WHAT THIS DOES (native only — web behaviour is left 100% untouched):
     1. window.openInAppBrowser(url, opts) — the canonical opener. On native with
        the @capacitor/browser plugin present → Browser.open({ url }). Otherwise
        → window.open(url, '_blank') (graceful fallback = unchanged behaviour).
     2. A capture-phase document click listener routes EXTERNAL <a> clicks (any
        target, incl. plain default-target links that would otherwise blow away
        the app webview) through openInAppBrowser.
     3. window.open is wrapped so explicit window.open(url,'_blank') call-sites
        (news reader "continue reading" / shelfdOpenNewsArticle, music web
        fallback, etc.) also stay in-app. '_system' opens — deliberate OS / app
        deep-links (Apple Music music://, Spotify spotify:) — are passed straight
        through and NEVER intercepted. Same-origin URLs (the SPA's own routes)
        are passed through too.
     A short re-entrancy guard de-dupes the same URL when both the anchor
     interceptor AND the window.open wrapper fire for one tap, so only one sheet
     opens.

   NATIVE DEPENDENCY (iOS Xcode repo — shelfd-ios-public, NOT this repo):
     `npm install @capacitor/browser` then `npx cap sync`. Until that plugin
     ships in the native shell, openInAppBrowser falls back to window.open — i.e.
     behaviour on native is UNCHANGED (still external Safari) and there is zero
     web regression. The moment the plugin exists, links automatically open
     in-app with no further web changes needed.
   ========================================================================== */
(function () {
  'use strict';

  var SELF_ORIGIN = '';
  try { SELF_ORIGIN = window.location.origin || ''; } catch (_) {}

  function isNativePlatform() {
    try {
      var Cap = window.Capacitor;
      if (Cap && typeof Cap.isNativePlatform === 'function') return Cap.isNativePlatform();
      /* fallback signal injected by the native shell's user-agent (matches the
         detection used by 19e-google-native-signin.js). */
      return /\bShelfdNativeNoInset\b/.test(navigator.userAgent || '');
    } catch (_) { return false; }
  }

  function getBrowserPlugin() {
    try {
      var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
      var b = plugins.Browser;
      if (b && typeof b.open === 'function') return b;
    } catch (_) {}
    return null;
  }

  /* Capture the ONE real window.open before we wrap it, so the fallback path and
     the '_system' / same-origin pass-through always hit the genuine native one. */
  var nativeWindowOpen = (typeof window.open === 'function') ? window.open.bind(window) : null;

  function rawOpen(url, target, features) {
    try {
      if (nativeWindowOpen) return nativeWindowOpen(url, target || '_blank', features || 'noopener');
    } catch (_) {}
    try { window.location.href = url; } catch (__) {}
    return null;
  }

  /* ---- re-entrancy guard: one tap, one sheet ---- */
  var lastOpenUrl = '';
  var lastOpenAt = 0;
  function isDuplicateOpen(url) {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (url === lastOpenUrl && (now - lastOpenAt) < 700) return true;
    lastOpenUrl = url;
    lastOpenAt = now;
    return false;
  }

  /* ---- public opener ---- */
  function openInAppBrowser(url, opts) {
    var clean = String(url || '').trim();
    if (!clean) return;
    if (isDuplicateOpen(clean)) return;
    if (isNativePlatform()) {
      var plugin = getBrowserPlugin();
      if (plugin) {
        try {
          plugin.open({
            url: clean,
            presentationStyle: (opts && opts.presentationStyle) || 'popover',
            toolbarColor: (opts && opts.toolbarColor) || '#0c0b10'
          });
          return;
        } catch (_) { /* fall through to OS open */ }
      }
    }
    /* web, or native without the plugin → unchanged behaviour */
    rawOpen(clean, '_blank', 'noopener');
  }
  window.openInAppBrowser = openInAppBrowser;
  window.shelfdOpenInAppBrowser = openInAppBrowser;   /* discoverable alias */

  /* ---- is this an external web link we should take over? ---- */
  function isInterceptableHttpUrl(rawHref) {
    var href = String(rawHref || '').trim();
    if (!href) return false;
    /* only http(s). Leave mailto:, tel:, sms:, custom deep-link schemes,
       javascript:, blob:, data:, and bare #hash links completely alone. */
    if (!/^https?:\/\//i.test(href)) return false;
    var u;
    try { u = new URL(href, SELF_ORIGIN || undefined); } catch (_) { return false; }
    /* same-origin = the app's own SPA navigation → never intercept. */
    if (SELF_ORIGIN && u.origin === SELF_ORIGIN) return false;
    return true;
  }

  /* ---- global anchor interceptor ---- */
  function findAnchor(node) {
    while (node && node !== document) {
      if (node.tagName === 'A' && typeof node.getAttribute === 'function') return node;
      node = node.parentNode;
    }
    return null;
  }

  function onDocumentClick(ev) {
    if (ev.defaultPrevented) return;
    if (ev.button != null && ev.button !== 0) return;                 /* left-click only */
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; /* let modified clicks behave normally */
    var a = findAnchor(ev.target);
    if (!a) return;
    if (a.hasAttribute('download')) return;                           /* downloads: leave to OS */
    if (a.getAttribute('data-no-inapp-browser') != null) return;      /* explicit per-link opt-out */
    var href = a.getAttribute('href') || a.href || '';
    if (!isInterceptableHttpUrl(href)) return;
    /* prevent the default Safari-kick / webview navigation, then open in-app.
       We do NOT stopPropagation: any app-level handler still runs, and if it
       also opens the URL via window.open the re-entrancy guard de-dupes it. */
    ev.preventDefault();
    openInAppBrowser(a.href || href);
  }

  function install() {
    if (!isNativePlatform()) return;            /* web: keep normal link / tab behaviour */
    if (window.__shelfdInAppBrowserInstalled) return;
    window.__shelfdInAppBrowserInstalled = true;

    /* capture phase so we run before app handlers / default navigation. */
    document.addEventListener('click', onDocumentClick, true);

    /* wrap window.open so explicit _blank external opens stay in-app too. */
    window.open = function (url, target, features) {
      try {
        var t = String(target || '');
        /* '_system' = deliberate OS/app deep-link (Apple Music, Spotify) → pass
           through untouched. Same-origin / non-http → pass through. */
        if (t !== '_system' && isInterceptableHttpUrl(url)) {
          openInAppBrowser(String(url));
          return null;
        }
      } catch (_) {}
      return rawOpen(url, target, features);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
