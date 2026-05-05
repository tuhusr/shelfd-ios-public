// Shelfd source split v346-import-page-header-cleanup: compatibility script loader.
// New index.html loads /js chunks directly; this keeps older cached pages functional if they request /script.js.
// The direct chunks set __shelfdSplitScriptsLoading/Loaded so this loader cannot double-load them.
(function loadShelfdSplitScripts() {
  if (window.__shelfdSplitScriptsLoading || window.__shelfdSplitScriptsLoaded) return;
  window.__shelfdSplitScriptsLoading = true;
  var files = ['/js/00-live-update-pwa.js?v=303-pwa-reinstall-notice', '/js/01-firebase-login-state.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/02-messages-e2ee.js?v=280-dm-plaintext-aptos-composer', '/js/03-watch-together.js?v=294-watch-together-modal-search', '/js/04-shared-utils-data.js?v=310-game-save-id-fix', '/js/05-app-state-preview-routes.js?v=305-game-sort-modal-redesign', '/js/06-mylists-render-episodes-ratings.js?v=318-game-comments-inline', '/js/07-add-shelf-import-search.js?v=344-steam-connect-cache-bust-fix', '/js/08-discovery-state.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/09-direct-messages.js?v=280-dm-plaintext-aptos-composer', '/js/10-activity-feed.js?v=279-full-post-floating-reply-composer', '/js/11-discovery-media-games-profiles.js?v=309-igdb-discover-covers', '/js/12-patch-notes.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/13-discover-add-imports.js?v=346-import-page-header-cleanup', '/js/14-navigation.js?v=345-steam-sync-review-page', '/js/15-profile-settings.js?v=344-steam-connect-cache-bust-fix', '/js/16-friends-requests.js?v=267-friends-load-helper-fix', '/js/17-comments-auth-init.js?v=302-splash-until-app-ready'];
  function loadNext(index) {
    if (index >= files.length) {
      window.__shelfdSplitScriptsLoaded = true;
      window.__shelfdSplitScriptsLoading = false;
      return;
    }
    var s = document.createElement('script');
    s.src = files[index];
    s.async = false;
    s.onload = function () { loadNext(index + 1); };
    s.onerror = function () {
      window.__shelfdSplitScriptsLoading = false;
      console.error('Shelfd split script failed to load:', files[index]);
    };
    document.head.appendChild(s);
  }
  loadNext(0);
})();
