// Shelfd source split v420-activity-feed-inline-stack-expand-collapse: compatibility script loader.
// New index.html loads /js chunks directly; this keeps older cached pages functional if they request /script.js.
// The direct chunks set __shelfdSplitScriptsLoading/Loaded so this loader cannot double-load them.
(function loadShelfdSplitScripts() {
  if (window.__shelfdSplitScriptsLoading || window.__shelfdSplitScriptsLoaded) return;
  window.__shelfdSplitScriptsLoading = true;
  var files = ['/js/00-live-update-pwa.js?v=362-pwa-edge-no-store', '/js/01-firebase-login-state.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/02-messages-e2ee.js?v=280-dm-plaintext-aptos-composer', '/js/03-watch-together.js?v=294-watch-together-modal-search', '/js/04-shared-utils-data.js?v=608-light-mode-disabled', '/js/05-app-state-preview-routes.js?v=402-game-played-user-rating-default', '/js/06-mylists-render-episodes-ratings.js?v=415-game-cover-web-results-picker-fix', '/js/07-add-shelf-import-search.js?v=368-sort-direction-last-edited', '/js/08-discovery-state.js?v=379-friends-discovery-performance-cogwheel-divider', '/js/09-direct-messages.js?v=280-dm-plaintext-aptos-composer', '/js/10-activity-feed.js?v=420-activity-feed-inline-stack-expand-collapse', '/js/11-discovery-media-games-profiles.js?v=413-game-cover-fallback-google-picker-layout-fix', '/js/12-patch-notes.js?v=420-activity-feed-inline-stack-expand-collapse', '/js/13-discover-add-imports.js?v=382-myanimelist-desktop-helper', '/js/14-navigation.js?v=439-windows-desktop-mylist-layout-fix', '/js/15-profile-settings.js?v=613_profile_sheet_final_cascade', '/js/16-friends-requests.js?v=404-shared-watch-copy-underline', '/js/17-comments-auth-init.js?v=375-global-igdb-game-cover-override'];
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
