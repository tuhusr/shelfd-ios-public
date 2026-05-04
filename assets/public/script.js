// Shelfd source split v299-completion-post-prompt: compatibility script loader.
// New index.html loads /js chunks directly; this keeps older cached pages functional if they request /script.js.
// The direct chunks set __shelfdSplitScriptsLoading/Loaded so this loader cannot double-load them.
(function loadShelfdSplitScripts() {
  if (window.__shelfdSplitScriptsLoading || window.__shelfdSplitScriptsLoaded) return;
  window.__shelfdSplitScriptsLoading = true;
  var files = ['/js/00-live-update-pwa.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/01-firebase-login-state.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/02-messages-e2ee.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/03-watch-together.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/04-shared-utils-data.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/05-app-state-preview-routes.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/06-mylists-render-episodes-ratings.js?v=299-completion-post-prompt', '/js/07-add-shelf-import-search.js?v=299-completion-post-prompt', '/js/08-discovery-state.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/09-direct-messages.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/10-activity-feed.js?v=299-completion-post-prompt', '/js/11-discovery-media-games-profiles.js?v=299-completion-post-prompt', '/js/12-patch-notes.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/13-discover-add-imports.js?v=299-completion-post-prompt', '/js/14-navigation.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/15-profile-settings.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/16-friends-requests.js?v=292-activity-card-smaller-text-halfstar-fix', '/js/17-comments-auth-init.js?v=292-activity-card-smaller-text-halfstar-fix'];
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
