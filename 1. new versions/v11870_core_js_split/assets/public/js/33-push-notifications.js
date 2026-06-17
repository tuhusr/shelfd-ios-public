/* =============================================================================
   33-push-notifications.js  (v10.318 — verbose diagnostics)
   ----------------------------------------------------------------------------
   Wires Capacitor's @capacitor/push-notifications plugin into Shelfd's
   notification system.

   On iOS TestFlight / App Store builds:
     1. After Firebase auth resolves, ask the OS for notification permission
     2. Register with APNs — the OS returns a device token
     3. POST the token to /api/push/register (Cloudflare Worker stores it in KV)
     4. Listen for incoming pushes:
          - foreground: show a non-intrusive toast (notifications already
            land in the Notifications tab via the existing pipeline)
          - tap: deep-link to the activity / friend page the push points at

   On regular web / non-iOS: this file no-ops. Web push (VAPID) is a
   separate channel — coming later.

   Why the registration is per-session, idempotent, and fire-and-forget:
     - Apple may rotate the token at any time. Re-registering on every
       sign-in catches rotations naturally.
     - The Worker dedupes by token, so multiple registers from the same
       device are safe.
     - We never block the app on push setup — every failure path is logged
       and silently ignored.
   ========================================================================== */
(function() {
  'use strict';

  /* v10.318 — every step logs with this prefix so attaching the device to
     Safari Web Inspector instantly shows where the chain breaks. */
  const LOG = (...args) => { try { console.log('[push]', ...args); } catch (_) {} };
  const WARN = (...args) => { try { console.warn('[push]', ...args); } catch (_) {} };

  /* ---------- Capacitor iOS detection ---------- */
  function isLikelyShelfdNativeIOS() {
    try {
      const ua = String(navigator.userAgent || '');
      return /\bShelfdNativeNoInset\b/.test(ua) && /\b(iPhone|iPad|iPod)\b/i.test(ua);
    } catch (_) { return false; }
  }

  function isCapacitorIOS() {
    try {
      const Cap = window.Capacitor;
      if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) {
        const platform = typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : '';
        return platform === 'ios';
      }
      /* v10.541: the native shell appends this UA marker before the
         Capacitor JS bridge is always visible. Treat it as native iOS so
         the push bootstrap does not take the permanent browser no-op path. */
      return isLikelyShelfdNativeIOS();
    } catch (_) { return false; }
  }
  if (!isCapacitorIOS()) {
    LOG('not Capacitor iOS — push is web-only (not implemented yet); exiting');
    /* Expose stubs that still hit the server so a desktop browser can also
       run /api/push/diagnose against the logged-in uid for debugging. */
    window.__shelfdPush = {
      isCapacitorIOS,
      available: false,
      diagnose: async function() {
        const uid = (window.currentUser && window.currentUser.uid) || '';
        const r = await fetch('/api/push/diagnose?uid=' + encodeURIComponent(uid), { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        console.log('[push] diagnose →', j);
        return j;
      },
      test: async function() {
        const uid = (window.currentUser && window.currentUser.uid) || '';
        if (!uid) { console.warn('[push] test: no uid'); return; }
        const r = await fetch('/api/push/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid })
        });
        const j = await r.json().catch(() => ({}));
        console.log('[push] test →', j);
        return j;
      }
    };
    return;
  }
  LOG('Capacitor iOS detected — push pipeline starting');

  function getPlugin() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null;
    } catch (_) { return null; }
  }

  /* ---------- State ---------- */
  let registeredUid = '';
  let lastTokenSeen = '';
  let listenersBound = false;
  let isRegistering = false;
  let pluginMissingRetryCount = 0;
  let pluginMissingRetryTimer = null;
  /* v10.460: stash for tokens that arrived BEFORE the user signed in.
     APNs can deliver the token at any time after register() — if it
     lands while we still have no uid, we can't POST it to KV yet.
     Save it here and replay the POST as soon as the next auth state
     change brings a uid. */
  let pendingTokenAwaitingUid = '';

  function schedulePluginAvailabilityRetry(reason) {
    if (!isCapacitorIOS() || lastTokenSeen) return;
    if (pluginMissingRetryCount >= 18) {
      WARN('PushNotifications plugin still unavailable after retries; native shell may need npx cap sync ios / re-archive. lastReason=' + String(reason || 'unknown'));
      return;
    }
    if (pluginMissingRetryTimer) return;
    pluginMissingRetryCount += 1;
    const delay = Math.min(6000, 500 + pluginMissingRetryCount * 350);
    LOG('scheduling push plugin availability retry #' + pluginMissingRetryCount + ' in ' + delay + 'ms; reason=' + String(reason || 'unknown'));
    pluginMissingRetryTimer = setTimeout(() => {
      pluginMissingRetryTimer = null;
      requestAndRegister();
    }, delay);
  }

  /* ---------- Token persistence to the Worker / KV ---------- */
  async function postRegisterToWorker(uid, token) {
    try {
      LOG('POST /api/push/register uid=' + String(uid).slice(0, 6) + '… tokenTail=' + String(token).slice(-6));
      const r = await fetch('/api/push/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          uid: String(uid || '').trim(),
          token: String(token || '').trim(),
          platform: 'ios',
          appBundleId: 'com.myshelfd.app',
          registeredAtMs: Date.now()
        }),
        cache: 'no-store'
      });
      const j = await r.json().catch(() => ({}));
      LOG('register response status=' + r.status, j);
    } catch (e) {
      WARN('/api/push/register failed (will retry next session):', e && e.message ? e.message : e);
    }
  }

  /* ---------- Listeners (bound once) ---------- */
  function bindPushListeners(Push) {
    if (listenersBound) return;
    listenersBound = true;
    LOG('binding plugin listeners');

    Push.addListener('registration', async (event) => {
      try {
        const token = String((event && event.value) || '').trim();
        LOG('registration event fired tokenLen=' + token.length + ' tokenTail=' + token.slice(-6));
        if (!token) { WARN('empty token from registration event'); return; }
        if (token === lastTokenSeen) { LOG('token unchanged from last seen, skipping POST'); return; }
        lastTokenSeen = token;
        const uid = resolveCurrentUid();
        if (!uid) {
          /* v10.460: stash the token so we can POST it the moment a
             uid lands. Without this, a token arriving pre-auth was
             effectively dropped — `lastTokenSeen` got set so future
             duplicate registration events were skipped, but the POST
             never replayed. */
          pendingTokenAwaitingUid = token;
          WARN('no uid available yet — token cached in pendingTokenAwaitingUid, will replay POST on next auth event');
          return;
        }
        await postRegisterToWorker(uid, token);
      } catch (e) {
        WARN('registration handler failed:', e);
      }
    });

    Push.addListener('registrationError', (err) => {
      WARN('registrationError — APNs refused to issue a token. err=', err && err.error ? err.error : err);
      WARN('  most common causes: (1) "Push Notifications" capability not added in Xcode, (2) aps-environment missing from App.entitlements, (3) provisioning profile does not include push entitlement, (4) running in iOS Simulator (APNs requires a real device)');
    });

    Push.addListener('pushNotificationReceived', (notification) => {
      /* The app is already foreground when this fires. The in-app
         Notifications tab is the canonical place to see notifications,
         so we don't pop a separate modal — just refresh the badge so the
         "you have unread" indicator updates immediately. */
      try {
        if (typeof window.updateShelfdNotificationsUnreadBadge === 'function') {
          window.updateShelfdNotificationsUnreadBadge();
        }
      } catch (_) {}
    });

    Push.addListener('pushNotificationActionPerformed', (action) => {
      /* User tapped a notification while the app was closed/backgrounded.
         Route to the right page based on the notification type/payload.
         v10.776: added explicit DM routing. Previously the handler only
         knew about activity notifications (likes/comments/friend requests)
         and would silently no-op for DM notifications — openActivityNotificationTarget
         looks up the notification in /notifications/{uid}/items/{id},
         but DM notifications are PUSH-ONLY and don't have a Firestore
         row, so the lookup returned null and nothing happened.
         Now DM taps explicitly route to openDirectMessageThread via the
         helper in 09-direct-messages.js (which handles the cold-launch
         race where dmThreadMap isn't yet populated). */
      try {
        const data = (action && action.notification && action.notification.data) || {};
        const type = String(data.type || '').trim();
        const notificationId = String(data.notificationId || '').trim();

        /* v10.776: DM routing — opens DM inbox + deep-links to the thread.
           Match by either explicit type or the notificationId prefix
           ("direct_message:{threadId}:{messageId}") used by the DM send
           path in 11-discovery-media-games-profiles.js. */
        if (type === 'direct_message' || notificationId.indexOf('direct_message:') === 0) {
          let threadId = String(data.threadId || '').trim();
          if (!threadId && notificationId.indexOf('direct_message:') === 0) {
            const parts = notificationId.split(':');
            threadId = (parts[1] || '').trim();
          }
          if (threadId && typeof window.routePushNotificationToDmThread === 'function') {
            window.routePushNotificationToDmThread(threadId);
            return;
          }
        }

        /* v10.895: shared Watch Together request routing. The push data
           already carries `type` + `watchTogetherGroupId`, so we can
           open Friends → Activity → Requests → Watch Together directly
           without first round-tripping to Firestore for the notification
           doc (which `openActivityNotificationTarget` would otherwise do).
           This makes the cold-launch tap reliable even when auth /
           Firestore aren't fully hydrated yet — `routeWatchTogetherNotificationTarget`
           internally retries after 420ms to cover late hydration. */
        if (type === 'shared_watch_request') {
          const groupId = String(data.watchTogetherGroupId || data.targetActivityId || '').trim();
          if (typeof window.routeWatchTogetherNotificationTarget === 'function') {
            try {
              window.routeWatchTogetherNotificationTarget(groupId);
              return;
            } catch (e) {
              console.warn('[push] shared_watch_request route failed:', e && e.message ? e.message : e);
            }
          }
        }

        /* Activity-notification routing (likes, comments, friend events). */
        if (notificationId && typeof window.openActivityNotificationTarget === 'function') {
          window.openActivityNotificationTarget(notificationId);
          return;
        }
        const targetId = String(data.targetActivityId || '').trim();
        if (targetId) {
          if (typeof window.openFeedPostPage === 'function' && data.targetKind === 'feed') {
            window.openFeedPostPage(targetId);
          } else if (typeof window.openActivityReplyPage === 'function') {
            window.openActivityReplyPage(targetId);
          }
        }
      } catch (e) {
        console.warn('[push] action handler failed:', e);
      }
    });
  }

  /* ---------- Main: request permission + register ---------- */
  async function requestAndRegister() {
    if (isRegistering) { LOG('requestAndRegister: already in flight, skipping'); return; }
    isRegistering = true;
    try {
      const Push = getPlugin();
      if (!Push) {
        WARN('PushNotifications plugin NOT available on window.Capacitor.Plugins — @capacitor/push-notifications is not installed in the native shell, or `npx cap sync ios` was not run after install');
        schedulePluginAvailabilityRetry('plugin-missing');
        return;
      }
      pluginMissingRetryCount = 0;
      LOG('PushNotifications plugin present');
      const uid = resolveCurrentUid();
      /* v10.460: previously this early-returned when uid was missing,
         which meant `bindPushListeners()` never ran and `Push.register()`
         was never called. Result: cold-start (before sign-in) left the
         app permanently unregistered with APNs even after the user
         signed in, because the early-return short-circuited every
         path. Fix: bind listeners + ask iOS for permission + call
         register() regardless of uid. The only thing the uid actually
         gates is the POST to /api/push/register, which the registration
         listener handles separately (caching to `pendingTokenAwaitingUid`
         if uid still isn't there when the token lands). */
      if (uid && registeredUid === uid && lastTokenSeen) {
        LOG('already registered for this uid this session, skipping');
        return;
      }

      /* Bind listeners FIRST — before any call to checkPermissions /
         requestPermissions / register. Otherwise the registration
         event can fire before the listener is attached and the token
         lands in nobody's handler. */
      bindPushListeners(Push);

      /* Permission check / prompt */
      const status = await Push.checkPermissions();
      LOG('checkPermissions →', status);
      let receive = status && status.receive;
      if (receive === 'prompt' || receive === 'prompt-with-rationale' || !receive) {
        LOG('requesting permissions from iOS…');
        const ask = await Push.requestPermissions();
        LOG('requestPermissions →', ask);
        receive = ask && ask.receive;
      }
      if (receive !== 'granted') {
        WARN('permission not granted, receive=' + receive + ' — user must enable in iOS Settings → Shelfd → Notifications. iOS will NOT prompt again if previously denied.');
        return;
      }

      /* register() asks iOS to talk to APNs; the OS will fire the
         "registration" listener with the device token if it succeeds. */
      LOG('calling Push.register() — waiting for APNs token via registration listener…');
      await Push.register();
      LOG('Push.register() returned. If you do not see a "registration event fired" log within a few seconds, APNs did not return a token. Likely native-side problem (capability/entitlement/AppDelegate).');
      if (uid) registeredUid = uid;
    } catch (e) {
      WARN('requestAndRegister failed:', e && e.message ? e.message : e);
    } finally {
      isRegistering = false;
    }
  }

  /* ---------- Boot ---------- */
  /* v10.583: Redesigned boot strategy.
     Root cause of notifications not working for new users:
     The cold-start 400ms fire was asking for push permission on the
     LANDING PAGE before the user had signed in. Users dismissed the
     iOS prompt (bad timing = low grant rate). Worse, if they DID grant
     it, the token arrived with no uid → got cached → the pending-replay
     path was brittle and often failed, leaving KV with no token.

     New strategy:
     1. REMOVE the cold-start 400ms trigger entirely.
     2. ONLY ask for push permission AFTER the user is signed in
        (onAuthStateChanged with a real uid). This ensures:
          a) Better UX — prompt appears after the user is engaged
          b) uid is always available when the token arrives — no
             pending-token caching or replay needed
          c) Token goes directly to KV via postRegisterToWorker(uid, token)
     3. Keep the foreground-retry (appStateChange) as belt-and-suspenders.
     4. On auth: call requestAndRegister() immediately (no delay) so the
        iOS dialog fires right after sign-in while the user is active. */
  function start() {
    const wireAuthHook = () => {
      if (typeof firebase === 'undefined' || !firebase.auth) {
        setTimeout(wireAuthHook, 600);
        return;
      }
      firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
          registeredUid = '';
          pendingTokenAwaitingUid = '';
          return;
        }
        /* User is signed in — request push permission and register.
           This fires for EVERY signed-in user on every app launch
           (onAuthStateChanged restores persistent sessions). For
           existing users who never got the prompt: shows it now.
           For users who already granted but token not in KV: calls
           Push.register() silently and posts the token. */
        LOG('auth resolved uid=' + String(user.uid).slice(0, 6) + '… — triggering push registration');
        /* Small delay so the app UI settles before the iOS dialog. */
        setTimeout(requestAndRegister, 800);
      });
    };
    wireAuthHook();

    /* v10.584: one-time force-enable for existing signed-in users who
       were on the old broken flow. On first launch after this deploy,
       we trigger requestAndRegister() as soon as Firebase is available
       and a user is already authenticated — without waiting for a fresh
       sign-in event. The 'shelfd_push_v1' flag prevents this from
       re-running on every subsequent launch (onAuthStateChanged handles
       that). This covers users who have been using the app for weeks
       and never got the prompt. */
    const alreadyBootstrapped = (function() {
      try { return localStorage.getItem('shelfd_push_v1') === '1'; } catch(_) { return false; }
    })();
    if (!alreadyBootstrapped) {
      try { localStorage.setItem('shelfd_push_v1', '1'); } catch(_) {}
      const forceInitialPrompt = () => {
        if (typeof firebase === 'undefined' || !firebase.auth) {
          setTimeout(forceInitialPrompt, 800);
          return;
        }
        const existingUser = firebase.auth().currentUser;
        if (existingUser) {
          LOG('v10.584 one-time force: existing user ' + String(existingUser.uid).slice(0,6) + '… — triggering push registration');
          setTimeout(requestAndRegister, 1200);
        }
      };
      setTimeout(forceInitialPrompt, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* v10.460: ALSO retry on Capacitor's `App.appStateChange` (already
     wired earlier in this file) AND on document `visibilitychange`
     for web/PWA. Belt-and-suspenders against the cold-start race. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !lastTokenSeen) {
      setTimeout(requestAndRegister, 400);
    }
  });

  /* v10.454: auto-retry on app foreground. When the user re-enters the
     app after backgrounding (e.g. after they granted permission in iOS
     Settings, or after iOS quietly issued a fresh token), Capacitor's
     `App` plugin fires `appStateChange` with `isActive: true`. We hook
     that and re-run `requestAndRegister()` so a previously-failed
     setup recovers automatically without the user having to do
     anything. Tolerates missing App plugin (older Capacitor shells)
     by no-op'ing. */
  function bindAppForegroundRetry() {
    try {
      const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App || typeof App.addListener !== 'function') {
        LOG('App plugin not available — foreground-retry hook skipped');
        return;
      }
      App.addListener('appStateChange', (event) => {
        if (event && event.isActive) {
          LOG('app foregrounded — retrying push setup');
          setTimeout(requestAndRegister, 600);
        }
      });
      LOG('appStateChange foreground-retry listener bound');
    } catch (e) {
      WARN('bindAppForegroundRetry failed:', e);
    }
  }
  bindAppForegroundRetry();

  /* v10.454: comprehensive native-side diagnostic. Runs Push.checkPermissions
     and probes the plugin surface to give a single, copy-pasteable report
     the user can dump into Safari Web Inspector. Catches the EXACT failure
     mode causing "Notifications" not to appear in iOS Settings — almost
     always one of:
       (a) `Push` plugin missing → @capacitor/push-notifications wasn't
           pod-installed in the native shell (`npx cap sync ios` skipped)
       (b) checkPermissions returns `denied` before any prompt → the
           `aps-environment` entitlement is missing from App.entitlements
           OR the Push Notifications capability isn't enabled in Xcode
       (c) requestPermissions throws "no valid aps-environment..." → same
           root cause as (b), surfaces during the actual prompt call
     The report is also returned so the user can read it without
     dev tools. */
  /* v10.462: centralized uid resolver. Checks multiple sources because
     `window.currentUser` may not be populated even when Firebase auth
     has resolved — the Shelfd auth chain sets it on a different tick
     than the Firebase SDK's own `currentUser` property. */
  function resolveCurrentUid() {
    try {
      if (window.currentUser && window.currentUser.uid) return String(window.currentUser.uid);
    } catch (_) {}
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) {
        return String(firebase.auth().currentUser.uid);
      }
    } catch (_) {}
    try {
      /* Some Shelfd code paths stash the user on window.__shelfdUser. */
      if (window.__shelfdUser && window.__shelfdUser.uid) return String(window.__shelfdUser.uid);
    } catch (_) {}
    return '';
  }

  async function nativeDiagnostic() {
    const report = {
      isCapacitorIOS: false,
      platform: '',
      capacitorPresent: false,
      pluginPresent: false,
      bundleIdConfig: 'com.myshelfd.app',
      currentUid: '',
      currentUidSource: '',
      checkPermissions: null,
      requestPermissionsAttempted: false,
      requestPermissions: null,
      registerAttempted: false,
      registerError: null,
      listenersBound,
      lastTokenTail: String(lastTokenSeen).slice(-6) || '(none)',
      pendingTokenAwaitingUidTail: String(pendingTokenAwaitingUid).slice(-6) || '(none)',
      probableIssue: '',
      fix: ''
    };
    try {
      report.capacitorPresent = !!window.Capacitor;
      if (window.Capacitor) {
        report.platform = typeof window.Capacitor.getPlatform === 'function' ? window.Capacitor.getPlatform() : '';
        report.isCapacitorIOS = isCapacitorIOS();
      }
      const Push = getPlugin();
      report.pluginPresent = !!Push;
      /* v10.462: try every known uid source so we can surface where
         it's coming from (or confirm it's truly absent). */
      if (window.currentUser && window.currentUser.uid) {
        report.currentUid = String(window.currentUser.uid);
        report.currentUidSource = 'window.currentUser';
      } else if (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) {
        report.currentUid = String(firebase.auth().currentUser.uid);
        report.currentUidSource = 'firebase.auth().currentUser';
      } else if (window.__shelfdUser && window.__shelfdUser.uid) {
        report.currentUid = String(window.__shelfdUser.uid);
        report.currentUidSource = 'window.__shelfdUser';
      } else {
        report.currentUidSource = '(none — not signed in OR auth hadn\'t resolved at diagnostic time)';
      }
      if (!Push) {
        report.probableIssue = 'PushNotifications plugin missing from native shell.';
        report.fix = 'Run `npm install @capacitor/push-notifications` then `npx cap sync ios` on Mac. Re-archive in Xcode.';
      } else {
        try { report.checkPermissions = await Push.checkPermissions(); }
        catch (e) { report.checkPermissions = { error: String(e && e.message || e) }; }
        /* If permission is `prompt`, fire the request so we can see the
           native prompt-or-deny outcome. If it's already `denied`,
           don't re-request — iOS won't show the prompt again, the user
           must enable it in Settings. */
        const receive = report.checkPermissions && report.checkPermissions.receive;
        if (receive === 'prompt' || receive === 'prompt-with-rationale' || !receive) {
          report.requestPermissionsAttempted = true;
          try { report.requestPermissions = await Push.requestPermissions(); }
          catch (e) { report.requestPermissions = { error: String(e && e.message || e) }; }
        }
        const granted = (report.requestPermissions && report.requestPermissions.receive === 'granted')
          || (receive === 'granted');
        if (granted && !lastTokenSeen) {
          /* Permission OK but no token yet — try to register. The
             error here is the smoking gun for missing entitlement.
             v10.460: MUST bind listeners FIRST. Without binding, the
             registration event fires into the void and lastTokenSeen
             stays empty — which previously caused the diagnostic to
             report "Permission granted but APNs never returned a
             token. Native-side hook likely broken" when the actual
             problem was the JS-side listener binding being skipped. */
          if (!listenersBound) {
            try { bindPushListeners(Push); }
            catch (e) { WARN('bindPushListeners during diagnostic failed:', e); }
          }
          report.registerAttempted = true;
          try { await Push.register(); }
          catch (e) { report.registerError = String(e && e.message || e); }
          /* Give the registration event a moment to fire so the
             returned `lastTokenTail` field reflects the freshly-
             arrived token if it did land. */
          await new Promise(r => setTimeout(r, 800));
          report.lastTokenTail = String(lastTokenSeen).slice(-6) || '(none)';
          report.listenersBound = listenersBound;
        }
        /* Decide the probable issue based on observed state. */
        if (receive === 'denied' && !report.requestPermissionsAttempted) {
          report.probableIssue = 'iOS has denied the app — the OS dialog was either dismissed previously, OR the `aps-environment` entitlement is missing so iOS treats the app as not push-capable.';
          report.fix = 'Open the iOS project in Xcode (App.xcworkspace), select the App target → Signing & Capabilities → click "+ Capability" → add "Push Notifications". This creates App.entitlements with `aps-environment = development`. Re-archive and upload to TestFlight. After installing the new build, iOS Settings → Shelfd should show "Notifications".';
        } else if (report.registerError && /aps-environment/i.test(report.registerError)) {
          report.probableIssue = 'APNs register failed: missing aps-environment entitlement.';
          report.fix = 'In Xcode, add the "Push Notifications" capability to the App target. This adds `aps-environment` to the entitlements file. Re-archive + upload to TestFlight.';
        } else if (lastTokenSeen) {
          report.probableIssue = '(none — token present and registered)';
          report.fix = '(no fix needed; if pushes still aren\'t arriving on the device, check Worker /api/push/diagnose for server-side issues)';
        } else if (granted) {
          report.probableIssue = 'Permission granted but APNs never returned a token. Native-side hook likely broken.';
          report.fix = 'Verify AppDelegate.swift forwards `didRegisterForRemoteNotificationsWithDeviceToken` to NotificationCenter via `Messaging.messaging().apnsToken = deviceToken` OR the Capacitor handler. Confirm Push Notifications capability is enabled.';
        }
      }
    } catch (e) {
      report.probableIssue = 'Diagnostic itself threw: ' + String(e && e.message || e);
    }
    console.log('[push] nativeDiagnostic →', report);
    return report;
  }

  /* Expose for debugging — open Safari Web Inspector and call these.
     v10.318 — adds diagnose() + test() that hit the new Worker endpoints.
     v10.454 — adds nativeDiagnostic() that probes the iOS plugin surface
     and gives a one-call report with probable cause + fix. */
  window.__shelfdPush = {
    isCapacitorIOS,
    requestAndRegister,
    getPlugin,
    available: true,
    state: () => ({ registeredUid, lastTokenTail: String(lastTokenSeen).slice(-6), listenersBound, isRegistering, pluginMissingRetryCount }),
    nativeDiagnostic,
    diagnose: async function() {
      const uid = resolveCurrentUid();
      const r = await fetch('/api/push/diagnose?uid=' + encodeURIComponent(uid), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      console.log('[push] diagnose →', j);
      return j;
    },
    test: async function() {
      const uid = resolveCurrentUid();
      if (!uid) { WARN('test: no uid'); return; }
      const r = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid })
      });
      const j = await r.json().catch(() => ({}));
      console.log('[push] test →', j);
      return j;
    },
    /* v10.454: one-call full sweep — runs nativeDiagnostic + server
       diagnose + state, returns a combined report. Use this when
       investigating why pushes aren't arriving. */
    fullReport: async function() {
      const native = await nativeDiagnostic();
      const uid = resolveCurrentUid();
      let server = null;
      try {
        const r = await fetch('/api/push/diagnose?uid=' + encodeURIComponent(uid), { cache: 'no-store' });
        server = await r.json().catch(() => ({}));
      } catch (e) { server = { error: String(e && e.message || e) }; }
      const report = { timestamp: new Date().toISOString(), native, server, state: { registeredUid, lastTokenTail: String(lastTokenSeen).slice(-6) || '(none)' } };
      console.log('[push] FULL REPORT →', JSON.stringify(report, null, 2));
      return report;
    }
  };
  LOG('debug helpers ready: window.__shelfdPush.fullReport() / .nativeDiagnostic() / .diagnose() / .test() / .state() / .requestAndRegister()');

  const PUSH_DEBUG_PANEL_SECTION_KEY = 'shelfd-push-debug-panel-section';
  const PUSH_DEBUG_FONT_EXAMPLES_STATE_KEY = 'shelfd-push-font-examples-state';
  const PUSH_DEBUG_FONT_WEIGHT_OPTIONS = [200, 300, 400, 500, 600, 700, 800, 900];
  const PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS = {
    text: 'House of the Dragon',
    html: 'House of the Dragon',
    fontSize: 32,
    fontWeight: 600,
    letterSpacing: 0.03,
    lineHeight: 1.05
  };

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function formatFontExampleNumber(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toFixed(decimals).replace(/\.?0+$/, '');
  }

  function snapFontWeightOption(value, fallback) {
    const numericValue = Number(value);
    const fallbackValue = Number(fallback);
    const safeFallback = PUSH_DEBUG_FONT_WEIGHT_OPTIONS.includes(fallbackValue) ? fallbackValue : 600;
    if (!Number.isFinite(numericValue)) return safeFallback;
    let best = PUSH_DEBUG_FONT_WEIGHT_OPTIONS[0];
    let bestDistance = Math.abs(numericValue - best);
    for (let i = 1; i < PUSH_DEBUG_FONT_WEIGHT_OPTIONS.length; i++) {
      const option = PUSH_DEBUG_FONT_WEIGHT_OPTIONS[i];
      const distance = Math.abs(numericValue - option);
      if (distance < bestDistance) {
        best = option;
        bestDistance = distance;
      }
    }
    return best;
  }

  function escapeFontExamplesHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderFontExamplesPlainTextHtml(text) {
    const normalized = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const escaped = escapeFontExamplesHtml(normalized);
    return escaped.replace(/\n/g, '<br>') || escapeFontExamplesHtml(PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS.text);
  }

  function extractFontExamplesPlainText(html, fallbackText) {
    const fallback = String(fallbackText == null ? '' : fallbackText);
    try {
      const temp = document.createElement('div');
      temp.innerHTML = String(html || '');
      const text = String(temp.innerText || temp.textContent || '').replace(/\r\n?/g, '\n').slice(0, 5000);
      return text || fallback || PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS.text;
    } catch (_) {
      return fallback || PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS.text;
    }
  }

  function sanitizeFontExamplesHtml(rawHtml, fallbackText) {
    const fallback = String(fallbackText == null ? '' : fallbackText);
    if (!rawHtml) return renderFontExamplesPlainTextHtml(fallback || PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS.text);
    try {
      const template = document.createElement('template');
      template.innerHTML = String(rawHtml);
      const output = document.createElement('div');
      const appendNode = (parent, node) => {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          parent.appendChild(document.createTextNode(node.textContent || ''));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = String(node.tagName || '').toUpperCase();
        if (tag === 'BR') {
          parent.appendChild(document.createElement('br'));
          return;
        }
        if (tag === 'DIV' || tag === 'P') {
          const block = document.createElement('div');
          const align = String(node.style?.textAlign || node.getAttribute?.('align') || '').trim().toLowerCase();
          if (align === 'left' || align === 'center' || align === 'right') block.style.textAlign = align;
          Array.from(node.childNodes || []).forEach(child => appendNode(block, child));
          if (!block.childNodes.length) block.appendChild(document.createElement('br'));
          parent.appendChild(block);
          return;
        }
        if (tag === 'SPAN') {
          const span = document.createElement('span');
          const size = clampNumber(parseFloat(String(node.style?.fontSize || '')), 8, 72, null);
          if (Number.isFinite(size)) span.style.fontSize = formatFontExampleNumber(size, 2) + 'px';
          const weight = snapFontWeightOption(node.style?.fontWeight, null);
          if (PUSH_DEBUG_FONT_WEIGHT_OPTIONS.includes(weight)) span.style.fontWeight = String(weight);
          const align = String(node.style?.textAlign || node.getAttribute?.('align') || '').trim().toLowerCase();
          if (align === 'left' || align === 'center' || align === 'right') span.style.textAlign = align;
          Array.from(node.childNodes || []).forEach(child => appendNode(span, child));
          if (span.childNodes.length) parent.appendChild(span);
          return;
        }
        Array.from(node.childNodes || []).forEach(child => appendNode(parent, child));
      };
      Array.from(template.content.childNodes || []).forEach(child => appendNode(output, child));
      const html = String(output.innerHTML || '').slice(0, 12000);
      return html || renderFontExamplesPlainTextHtml(fallback || PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS.text);
    } catch (_) {
      return renderFontExamplesPlainTextHtml(fallback || PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS.text);
    }
  }

  function readStoredPushDebugPanelSection() {
    try {
      const stored = String(localStorage.getItem(PUSH_DEBUG_PANEL_SECTION_KEY) || '').trim();
      if (stored === 'diagnostic' || stored === 'font-examples') return stored;
    } catch (_) {}
    return 'font-examples';
  }

  function writeStoredPushDebugPanelSection(section) {
    try { localStorage.setItem(PUSH_DEBUG_PANEL_SECTION_KEY, section); } catch (_) {}
  }

  function sanitizeFontExamplesState(raw) {
    const defaults = PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS;
    const next = raw && typeof raw === 'object' ? raw : {};
    const rawText = String(next.text == null ? defaults.text : next.text).slice(0, 5000) || defaults.text;
    const html = sanitizeFontExamplesHtml(next.html, rawText);
    return {
      text: extractFontExamplesPlainText(html, rawText),
      html,
      fontSize: clampNumber(next.fontSize, 8, 72, defaults.fontSize),
      fontWeight: snapFontWeightOption(next.fontWeight, defaults.fontWeight),
      letterSpacing: clampNumber(next.letterSpacing, -0.08, 0.2, defaults.letterSpacing),
      lineHeight: clampNumber(next.lineHeight, 0.7, 2.4, defaults.lineHeight)
    };
  }

  function readStoredFontExamplesState() {
    try {
      const raw = localStorage.getItem(PUSH_DEBUG_FONT_EXAMPLES_STATE_KEY);
      if (!raw) return sanitizeFontExamplesState(PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS);
      return sanitizeFontExamplesState(JSON.parse(raw));
    } catch (_) {
      return sanitizeFontExamplesState(PUSH_DEBUG_FONT_EXAMPLES_DEFAULTS);
    }
  }

  function writeStoredFontExamplesState(state) {
    try {
      localStorage.setItem(
        PUSH_DEBUG_FONT_EXAMPLES_STATE_KEY,
        JSON.stringify(sanitizeFontExamplesState(state))
      );
    } catch (_) {}
  }

  /* v10.458: in-app diagnostic UI — visit `#push-debug` (any path) to
     render a full-screen overlay with the fullReport() output and a
     Copy button. Lets the user grab the diagnostic on the device
     itself without needing Safari Web Inspector / a connected Mac.
     Auto-fires on hash match; safe to retrigger (rebuilds the
     overlay from scratch). Also exposes
     `window.__shelfdPush.openDebugPanel()` so the panel can be
     opened from anywhere (e.g. via a hidden long-press hook). */
  function buildPushDebugOverlay(reportText) {
    const existing = document.getElementById('shelfd-push-debug-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'shelfd-push-debug-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(0,0,0,0.94)', 'color:#f0e9ff',
      'display:flex', 'flex-direction:column',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
      'font-size:11px', 'line-height:1.35',
      '-webkit-user-select:text', 'user-select:text',
      'padding:env(safe-area-inset-top,20px) 14px env(safe-area-inset-bottom,20px)'
    ].join(';');
    overlay.innerHTML = ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 4px 10px;flex:0 0 auto;">'
      +   '<strong style="font-size:14px;color:#E6C766;font-family:Sohne,DM Sans,sans-serif;">Shelfd Push Diagnostic</strong>'
      +   '<div style="display:flex;gap:8px;">'
      +     '<button data-shelfd-push-debug-force-register style="background:rgba(167,139,250,0.20);border:1px solid rgba(167,139,250,0.50);color:#c4b5fd;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Force Reg</button>'
      +     '<button data-shelfd-push-debug-send style="background:rgba(34,211,153,0.18);border:1px solid rgba(34,211,153,0.45);color:#34d399;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Test Send</button>'
      +     '<button data-shelfd-push-debug-copy style="background:rgba(230,199,102,0.16);border:1px solid rgba(230,199,102,0.42);color:#E6C766;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Copy</button>'
      +     '<button data-shelfd-push-debug-refresh style="background:rgba(196,181,253,0.16);border:1px solid rgba(196,181,253,0.42);color:#c4b5fd;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Refresh</button>'
      +     '<button data-shelfd-push-debug-close style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22);color:#fff;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Close</button>'
      +   '</div>'
      + '</div>'
      + '<pre data-shelfd-push-debug-body style="flex:1 1 auto;overflow:auto;background:rgba(8,8,14,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin:0;white-space:pre-wrap;word-break:break-word;-webkit-overflow-scrolling:touch;"></pre>'
      + '<div data-shelfd-push-debug-status style="font-size:10px;color:rgba(232,222,255,0.6);padding:8px 4px 0;flex:0 0 auto;text-align:center;font-family:Sohne,DM Sans,sans-serif;">Tap Refresh to re-run · Tap Copy to grab JSON · Tap Close to dismiss</div>';
    document.body.appendChild(overlay);
    const body = overlay.querySelector('[data-shelfd-push-debug-body]');
    const status = overlay.querySelector('[data-shelfd-push-debug-status]');
    if (body) body.textContent = reportText || 'Running diagnostic…';
    overlay.querySelector('[data-shelfd-push-debug-close]').addEventListener('click', () => {
      overlay.remove();
      try {
        if (typeof window.history?.replaceState === 'function') {
          const u = new URL(window.location.href);
          if (u.hash === '#push-debug') {
            u.hash = '';
            window.history.replaceState(null, '', u.toString());
          }
        }
      } catch (_) {}
    });
    overlay.querySelector('[data-shelfd-push-debug-refresh]').addEventListener('click', async () => {
      if (body) body.textContent = 'Running diagnostic…';
      const fresh = await window.__shelfdPush.fullReport().catch(e => ({ error: String(e && e.message || e) }));
      if (body) body.textContent = JSON.stringify(fresh, null, 2);
      if (status) status.textContent = 'Updated ' + new Date().toLocaleTimeString();
    });
    overlay.querySelector('[data-shelfd-push-debug-force-register]').addEventListener('click', async () => {
      /* v10.462: grab uid from ANY source, grab the token from
         lastTokenSeen / pendingTokenAwaitingUid, and POST manually.
         Bypasses the auth-state hook for when it didn't fire for
         whatever reason. */
      const uid = resolveCurrentUid();
      const token = String(lastTokenSeen || pendingTokenAwaitingUid || '').trim();
      if (!uid) {
        if (status) status.textContent = '⚠ No uid found in any source — sign in first';
        return;
      }
      if (!token) {
        if (status) status.textContent = '⚠ No token cached yet — close panel + tap bell again to re-register first';
        return;
      }
      if (status) status.textContent = 'Force-registering token… uid=' + uid.slice(0, 6) + '… tokenTail=' + token.slice(-6);
      try {
        await postRegisterToWorker(uid, token);
        registeredUid = uid;
        pendingTokenAwaitingUid = '';
        if (status) status.textContent = '✓ Token POSTed to worker — tap Refresh to confirm tokenCount went from 0 → 1';
      } catch (e) {
        if (status) status.textContent = '✗ Force register failed: ' + (e && e.message || e);
      }
    });
    overlay.querySelector('[data-shelfd-push-debug-send]').addEventListener('click', async () => {
      const uid = resolveCurrentUid();
      if (!uid) {
        if (status) status.textContent = '⚠ Sign in first — no uid to send to';
        return;
      }
      if (status) status.textContent = 'Sending test push…';
      try {
        const r = await fetch('/api/push/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid })
        });
        const j = await r.json().catch(() => ({}));
        const body = overlay.querySelector('[data-shelfd-push-debug-body]');
        if (body) body.textContent = JSON.stringify({ testSendResponse: j, sentAt: new Date().toISOString() }, null, 2);
        if (status) status.textContent = (j && j.delivered) ? ('✓ APNs accepted — ' + j.delivered + ' push(es) sent · check notification banner') : ('Send response (delivered=' + (j && j.delivered || 0) + ') — see body');
      } catch (e) {
        if (status) status.textContent = '✗ Test send failed: ' + (e && e.message || e);
      }
    });
    overlay.querySelector('[data-shelfd-push-debug-copy]').addEventListener('click', async () => {
      const text = body ? body.textContent : '';
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          if (status) status.textContent = '✓ Copied to clipboard — paste anywhere';
          return;
        }
      } catch (_) {}
      /* Fallback: select the <pre> content so user can long-press → Copy. */
      try {
        const range = document.createRange();
        range.selectNodeContents(body);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        if (status) status.textContent = 'Selected — long-press → Copy';
      } catch (_) {
        if (status) status.textContent = 'Copy failed — long-press the JSON manually';
      }
    });
  }

  async function openDebugPanel() {
    LOG('opening in-app debug panel');
    buildPushDebugOverlay(null);
    try {
      const report = await window.__shelfdPush.fullReport();
      const body = document.querySelector('#shelfd-push-debug-overlay [data-shelfd-push-debug-body]');
      const status = document.querySelector('#shelfd-push-debug-overlay [data-shelfd-push-debug-status]');
      if (body) body.textContent = JSON.stringify(report, null, 2);
      if (status) status.textContent = 'Generated ' + new Date().toLocaleTimeString() + ' · Tap Copy to share';
    } catch (e) {
      const body = document.querySelector('#shelfd-push-debug-overlay [data-shelfd-push-debug-body]');
      if (body) body.textContent = 'Diagnostic threw: ' + (e && e.message || e);
    }
  }
  window.__shelfdPush.openDebugPanel = openDebugPanel;

  function buildPushDebugOverlay(reportText, initialSection) {
    const existing = document.getElementById('shelfd-push-debug-overlay');
    if (existing) existing.remove();
    const fontExamplesState = readStoredFontExamplesState();
    const overlay = document.createElement('div');
    overlay.id = 'shelfd-push-debug-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.dataset.diagnosticStatus = reportText
      ? 'Diagnostic ready. Tap Copy to share.'
      : 'Running diagnostic...';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(0,0,0,0.94)', 'color:#f0e9ff',
      'display:flex', 'flex-direction:column',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
      'font-size:11px', 'line-height:1.35',
      '-webkit-user-select:text', 'user-select:text',
      'padding:env(safe-area-inset-top,20px) 14px env(safe-area-inset-bottom,20px)'
    ].join(';');
    overlay.innerHTML = ''
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 4px 10px;flex:0 0 auto;">'
      +   '<div style="min-width:0;">'
      +     '<strong style="display:block;font-size:14px;color:#E6C766;font-family:Sohne,DM Sans,sans-serif;">Shelfd Dev Tools</strong>'
      +     '<div data-shelfd-push-debug-subtitle style="padding-top:4px;font:500 11px/1.35 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.58);">Creator-only panel from the bell</div>'
      +   '</div>'
      +   '<button data-shelfd-push-debug-close style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22);color:#fff;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;flex:0 0 auto;">Close</button>'
      + '</div>'
      + '<div style="display:flex;gap:8px;padding:0 4px 12px;flex:0 0 auto;">'
      +   '<button data-shelfd-push-debug-tab="font-examples" style="flex:1 1 0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.76);border-radius:10px;padding:11px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Font Examples</button>'
      +   '<button data-shelfd-push-debug-tab="diagnostic" style="flex:1 1 0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.76);border-radius:10px;padding:11px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Push Diagnostic</button>'
      + '</div>'
      + '<div data-shelfd-push-debug-controls style="display:flex;gap:8px;flex-wrap:wrap;padding:0 4px 12px;flex:0 0 auto;">'
      +   '<button data-shelfd-push-debug-force-register style="background:rgba(167,139,250,0.20);border:1px solid rgba(167,139,250,0.50);color:#c4b5fd;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Force Reg</button>'
      +   '<button data-shelfd-push-debug-send style="background:rgba(34,211,153,0.18);border:1px solid rgba(34,211,153,0.45);color:#34d399;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Test Send</button>'
      +   '<button data-shelfd-push-debug-copy style="background:rgba(230,199,102,0.16);border:1px solid rgba(230,199,102,0.42);color:#E6C766;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Copy</button>'
      +   '<button data-shelfd-push-debug-refresh style="background:rgba(196,181,253,0.16);border:1px solid rgba(196,181,253,0.42);color:#c4b5fd;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Refresh</button>'
      +   '<button data-shelfd-nonpro-toggle style="background:rgba(230,199,102,0.16);border:1px solid rgba(230,199,102,0.42);color:#E6C766;border-radius:8px;padding:8px 12px;font:600 12px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Non-Pro View: Off</button>'
      + '</div>'
      + '<div style="flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:12px;">'
      +   '<pre data-shelfd-push-debug-body style="flex:1 1 auto;overflow:auto;background:rgba(8,8,14,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin:0;white-space:pre-wrap;word-break:break-word;-webkit-overflow-scrolling:touch;"></pre>'
      +   '<div data-shelfd-font-examples-panel style="display:none;flex:1 1 auto;overflow:auto;background:rgba(8,8,14,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;-webkit-overflow-scrolling:touch;">'
      +     '<div style="display:flex;flex-direction:column;gap:14px;">'
      +       '<div style="padding:12px 12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">'
      +         '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:10px;">'
      +           '<strong style="font:600 12px/1 Sohne,DM Sans,sans-serif;color:#fff;">Font Examples</strong>'
      +           '<span style="font:500 10px/1 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.5);">Highlight text to size, weight, or align just that selection</span>'
      +         '</div>'
      +         '<div style="display:flex;gap:8px;padding-bottom:10px;">'
      +           '<button data-shelfd-font-align="left" type="button" style="flex:1 1 0;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 11px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Align Left</button>'
      +           '<button data-shelfd-font-align="center" type="button" style="flex:1 1 0;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 11px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Center</button>'
      +           '<button data-shelfd-font-align="right" type="button" style="flex:1 1 0;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 11px/1 Sohne,DM Sans,sans-serif;-webkit-tap-highlight-color:transparent;">Align Right</button>'
      +         '</div>'
      +         '<div data-shelfd-font-examples-preview contenteditable="true" spellcheck="false" style="min-height:116px;padding:0;margin:0;color:#ffffff;white-space:pre-wrap;outline:none;word-break:break-word;font-family:Sohne,DM Sans,sans-serif;"></div>'
      +       '</div>'
      +       '<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px;">'
      +         '<label style="display:flex;flex-direction:column;gap:8px;">'
      +           '<span style="font:600 11px/1 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.86);">Font Size (px)</span>'
      +           '<div style="display:flex;align-items:center;gap:10px;">'
      +             '<input data-shelfd-font-size-range type="range" min="8" max="72" step="0.5" value="' + String(fontExamplesState.fontSize) + '" style="flex:1 1 auto;">'
      +             '<input data-shelfd-font-size-input type="number" min="8" max="72" step="0.5" value="' + String(fontExamplesState.fontSize) + '" inputmode="decimal" style="width:76px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 12px/1 Sohne,DM Sans,sans-serif;">'
      +           '</div>'
      +         '</label>'
      +         '<label style="display:flex;flex-direction:column;gap:8px;">'
      +           '<span style="font:600 11px/1 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.86);">Font Weight</span>'
      +           '<div style="display:flex;align-items:center;gap:10px;">'
      +             '<input data-shelfd-font-weight-range type="range" min="200" max="900" step="100" value="' + String(fontExamplesState.fontWeight) + '" style="flex:1 1 auto;">'
      +             '<input data-shelfd-font-weight-input type="number" min="200" max="900" step="100" value="' + String(fontExamplesState.fontWeight) + '" inputmode="numeric" style="width:76px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 12px/1 Sohne,DM Sans,sans-serif;">'
      +           '</div>'
      +         '</label>'
      +         '<label style="display:flex;flex-direction:column;gap:8px;">'
      +           '<span style="font:600 11px/1 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.86);">Letter Spacing (em)</span>'
      +           '<div style="display:flex;align-items:center;gap:10px;">'
      +             '<input data-shelfd-letter-spacing-range type="range" min="-0.08" max="0.2" step="0.005" value="' + String(fontExamplesState.letterSpacing) + '" style="flex:1 1 auto;">'
      +             '<input data-shelfd-letter-spacing-input type="number" min="-0.08" max="0.2" step="0.005" value="' + String(fontExamplesState.letterSpacing) + '" inputmode="decimal" style="width:76px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 12px/1 Sohne,DM Sans,sans-serif;">'
      +           '</div>'
      +         '</label>'
      +         '<label style="display:flex;flex-direction:column;gap:8px;">'
      +           '<span style="font:600 11px/1 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.86);">Line Height</span>'
      +           '<div style="display:flex;align-items:center;gap:10px;">'
      +             '<input data-shelfd-line-height-range type="range" min="0.7" max="2.4" step="0.05" value="' + String(fontExamplesState.lineHeight) + '" style="flex:1 1 auto;">'
      +             '<input data-shelfd-line-height-input type="number" min="0.7" max="2.4" step="0.05" value="' + String(fontExamplesState.lineHeight) + '" inputmode="decimal" style="width:76px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:9px 10px;font:500 12px/1 Sohne,DM Sans,sans-serif;">'
      +           '</div>'
      +         '</label>'
      +       '</div>'
      +       '<div style="padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">'
      +         '<div style="font:600 11px/1 Sohne,DM Sans,sans-serif;color:rgba(255,255,255,0.78);padding-bottom:8px;">Current CSS</div>'
      +         '<code data-shelfd-font-examples-css style="display:block;white-space:pre-wrap;word-break:break-word;font:500 11px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#dcd3f5;"></code>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div data-shelfd-push-debug-status style="font-size:10px;color:rgba(232,222,255,0.6);padding:8px 4px 0;flex:0 0 auto;text-align:center;font-family:Sohne,DM Sans,sans-serif;">Edit the preview directly, or highlight text and use Font Size, Font Weight, or Align controls on just that selection.</div>';
    document.body.appendChild(overlay);
    const body = overlay.querySelector('[data-shelfd-push-debug-body]');
    const subtitle = overlay.querySelector('[data-shelfd-push-debug-subtitle]');
    const status = overlay.querySelector('[data-shelfd-push-debug-status]');
    const controls = overlay.querySelector('[data-shelfd-push-debug-controls]');
    const fontExamplesPanel = overlay.querySelector('[data-shelfd-font-examples-panel]');
    const preview = overlay.querySelector('[data-shelfd-font-examples-preview]');
    const cssSummary = overlay.querySelector('[data-shelfd-font-examples-css]');
    const tabButtons = Array.from(overlay.querySelectorAll('[data-shelfd-push-debug-tab]'));
    const fontAlignButtons = Array.from(overlay.querySelectorAll('[data-shelfd-font-align]'));
    const fontSizeRange = overlay.querySelector('[data-shelfd-font-size-range]');
    const fontSizeInput = overlay.querySelector('[data-shelfd-font-size-input]');
    const fontWeightRange = overlay.querySelector('[data-shelfd-font-weight-range]');
    const fontWeightInput = overlay.querySelector('[data-shelfd-font-weight-input]');
    const letterSpacingRange = overlay.querySelector('[data-shelfd-letter-spacing-range]');
    const letterSpacingInput = overlay.querySelector('[data-shelfd-letter-spacing-input]');
    const lineHeightRange = overlay.querySelector('[data-shelfd-line-height-range]');
    const lineHeightInput = overlay.querySelector('[data-shelfd-line-height-input]');
    let fontSizeControlValue = fontExamplesState.fontSize;
    let fontWeightControlValue = fontExamplesState.fontWeight;
    let savedPreviewSelectionRange = null;
    let activeSection = (initialSection === 'diagnostic' || initialSection === 'font-examples')
      ? initialSection
      : readStoredPushDebugPanelSection();

    function setStatusText(message, section) {
      if (!status) return;
      if (section && activeSection !== section) return;
      status.textContent = message;
    }

    function syncFontSizeControls() {
      if (fontSizeRange) fontSizeRange.value = String(fontSizeControlValue);
      if (fontSizeInput) fontSizeInput.value = formatFontExampleNumber(fontSizeControlValue, 2);
    }

    function syncFontWeightControls() {
      if (fontWeightRange) fontWeightRange.value = String(fontWeightControlValue);
      if (fontWeightInput) fontWeightInput.value = String(fontWeightControlValue);
    }

    function isPreviewNode(node) {
      const base = node && node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
      return !!(preview && base && (base === preview || preview.contains(base)));
    }

    function getPreviewSelectionRange() {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      if (range.collapsed) return null;
      if (!isPreviewNode(selection.anchorNode) || !isPreviewNode(selection.focusNode)) return null;
      return range;
    }

    function getPreviewSelectionFontSize(range) {
      const target = range && range.startContainer
        ? (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer)
        : preview;
      try {
        const size = parseFloat(String(window.getComputedStyle(target || preview).fontSize || ''));
        return Number.isFinite(size) ? clampNumber(size, 8, 72, fontExamplesState.fontSize) : null;
      } catch (_) {
        return null;
      }
    }

    function getPreviewSelectionFontWeight(range) {
      const target = range && range.startContainer
        ? (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer)
        : preview;
      try {
        const weight = snapFontWeightOption(window.getComputedStyle(target || preview).fontWeight, null);
        return PUSH_DEBUG_FONT_WEIGHT_OPTIONS.includes(weight) ? weight : null;
      } catch (_) {
        return null;
      }
    }

    function rememberPreviewSelectionRange() {
      const range = getPreviewSelectionRange();
      if (!range) return false;
      savedPreviewSelectionRange = range.cloneRange();
      const selectionSize = getPreviewSelectionFontSize(range);
      if (Number.isFinite(selectionSize)) {
        fontSizeControlValue = selectionSize;
        syncFontSizeControls();
      }
      const selectionWeight = getPreviewSelectionFontWeight(range);
      if (PUSH_DEBUG_FONT_WEIGHT_OPTIONS.includes(selectionWeight)) {
        fontWeightControlValue = selectionWeight;
        syncFontWeightControls();
      }
      return true;
    }

    function restoreSavedPreviewSelectionRange() {
      if (!savedPreviewSelectionRange || !preview) return null;
      const anchor = savedPreviewSelectionRange.startContainer;
      if (!isPreviewNode(anchor)) return null;
      try {
        const selection = window.getSelection();
        const range = savedPreviewSelectionRange.cloneRange();
        selection.removeAllRanges();
        selection.addRange(range);
        return range;
      } catch (_) {
        return null;
      }
    }

    function serializePreviewMarkup() {
      const html = sanitizeFontExamplesHtml(preview ? preview.innerHTML : '', fontExamplesState.text);
      const text = extractFontExamplesPlainText(html, fontExamplesState.text).slice(0, 5000);
      return { html, text };
    }

    function persistPreviewMarkup() {
      const serialized = serializePreviewMarkup();
      fontExamplesState.html = serialized.html;
      fontExamplesState.text = serialized.text;
      writeStoredFontExamplesState(fontExamplesState);
      return serialized;
    }

    function applyFontSizeToSelection(sizePx) {
      const liveRange = getPreviewSelectionRange() || restoreSavedPreviewSelectionRange();
      if (!liveRange || liveRange.collapsed) return false;
      const fragment = liveRange.extractContents();
      const markedAttr = 'data-shelfd-font-examples-selected-size';
      const textNodes = [];
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return String(node.textContent || '').length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((textNode) => {
        const parent = textNode.parentNode;
        if (!parent) return;
        const span = document.createElement('span');
        span.style.fontSize = formatFontExampleNumber(sizePx, 2) + 'px';
        span.setAttribute(markedAttr, '1');
        span.textContent = textNode.textContent || '';
        parent.replaceChild(span, textNode);
      });
      liveRange.insertNode(fragment);
      preview.normalize();
      const appliedNodes = Array.from(preview.querySelectorAll('span[' + markedAttr + '="1"]'));
      if (!appliedNodes.length) return false;
      const nextRange = document.createRange();
      nextRange.setStartBefore(appliedNodes[0]);
      nextRange.setEndAfter(appliedNodes[appliedNodes.length - 1]);
      appliedNodes.forEach(node => node.removeAttribute(markedAttr));
      try {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(nextRange);
        savedPreviewSelectionRange = nextRange.cloneRange();
      } catch (_) {
        savedPreviewSelectionRange = nextRange.cloneRange();
      }
      persistPreviewMarkup();
      return true;
    }

    function handleFontSizeControlChange(value) {
      const nextSize = clampNumber(value, 8, 72, fontExamplesState.fontSize);
      fontSizeControlValue = nextSize;
      syncFontSizeControls();
      if (applyFontSizeToSelection(nextSize)) {
        setStatusText('Selected text font size set to ' + formatFontExampleNumber(nextSize, 2) + 'px.', 'font-examples');
        return;
      }
      applyFontExamplesPatch({ fontSize: nextSize });
    }

    function applyFontWeightToSelection(weightValue) {
      const nextWeight = snapFontWeightOption(weightValue, fontExamplesState.fontWeight);
      if (!PUSH_DEBUG_FONT_WEIGHT_OPTIONS.includes(nextWeight)) return false;
      const liveRange = getPreviewSelectionRange() || restoreSavedPreviewSelectionRange();
      if (!liveRange || liveRange.collapsed) return false;
      const fragment = liveRange.extractContents();
      const markedAttr = 'data-shelfd-font-examples-selected-weight';
      const textNodes = [];
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return String(node.textContent || '').length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((textNode) => {
        const parent = textNode.parentNode;
        if (!parent) return;
        const span = document.createElement('span');
        span.style.fontWeight = String(nextWeight);
        span.setAttribute(markedAttr, '1');
        span.textContent = textNode.textContent || '';
        parent.replaceChild(span, textNode);
      });
      liveRange.insertNode(fragment);
      preview.normalize();
      const appliedNodes = Array.from(preview.querySelectorAll('span[' + markedAttr + '="1"]'));
      if (!appliedNodes.length) return false;
      const nextRange = document.createRange();
      nextRange.setStartBefore(appliedNodes[0]);
      nextRange.setEndAfter(appliedNodes[appliedNodes.length - 1]);
      appliedNodes.forEach(node => node.removeAttribute(markedAttr));
      try {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(nextRange);
        savedPreviewSelectionRange = nextRange.cloneRange();
      } catch (_) {
        savedPreviewSelectionRange = nextRange.cloneRange();
      }
      persistPreviewMarkup();
      return true;
    }

    function handleFontWeightControlChange(value) {
      const nextWeight = snapFontWeightOption(value, fontExamplesState.fontWeight);
      fontWeightControlValue = nextWeight;
      syncFontWeightControls();
      if (applyFontWeightToSelection(nextWeight)) {
        setStatusText('Selected text font weight set to ' + String(nextWeight) + '.', 'font-examples');
        return;
      }
      applyFontExamplesPatch({ fontWeight: nextWeight });
    }

    function applySelectionAlignment(alignment) {
      const nextAlign = String(alignment || '').trim().toLowerCase();
      if (nextAlign !== 'left' && nextAlign !== 'center' && nextAlign !== 'right') return false;
      const liveRange = getPreviewSelectionRange() || restoreSavedPreviewSelectionRange();
      if (!liveRange || liveRange.collapsed) return false;
      const fragment = liveRange.extractContents();
      const wrapper = document.createElement('div');
      wrapper.style.textAlign = nextAlign;
      wrapper.setAttribute('data-shelfd-font-examples-selected-align', '1');
      if (fragment.childNodes.length) {
        wrapper.appendChild(fragment);
      } else {
        wrapper.appendChild(document.createElement('br'));
      }
      liveRange.insertNode(wrapper);
      preview.normalize();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(wrapper);
      try {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(nextRange);
        savedPreviewSelectionRange = nextRange.cloneRange();
      } catch (_) {
        savedPreviewSelectionRange = nextRange.cloneRange();
      }
      wrapper.removeAttribute('data-shelfd-font-examples-selected-align');
      persistPreviewMarkup();
      return true;
    }

    function renderFontExamples() {
      const nextHtml = sanitizeFontExamplesHtml(fontExamplesState.html, fontExamplesState.text);
      if (preview && preview.innerHTML !== nextHtml) preview.innerHTML = nextHtml;
      if (preview) {
        preview.style.fontFamily = 'Sohne,DM Sans,sans-serif';
        preview.style.fontSize = formatFontExampleNumber(fontExamplesState.fontSize, 2) + 'px';
        preview.style.fontWeight = String(fontExamplesState.fontWeight);
        preview.style.letterSpacing = formatFontExampleNumber(fontExamplesState.letterSpacing, 3) + 'em';
        preview.style.lineHeight = formatFontExampleNumber(fontExamplesState.lineHeight, 2);
      }
      fontExamplesState.html = nextHtml;
      fontExamplesState.text = extractFontExamplesPlainText(nextHtml, fontExamplesState.text).slice(0, 5000);
      if (!savedPreviewSelectionRange) fontSizeControlValue = fontExamplesState.fontSize;
      if (!savedPreviewSelectionRange) fontWeightControlValue = fontExamplesState.fontWeight;
      syncFontSizeControls();
      syncFontWeightControls();
      if (letterSpacingRange) letterSpacingRange.value = String(fontExamplesState.letterSpacing);
      if (letterSpacingInput) letterSpacingInput.value = formatFontExampleNumber(fontExamplesState.letterSpacing, 3);
      if (lineHeightRange) lineHeightRange.value = String(fontExamplesState.lineHeight);
      if (lineHeightInput) lineHeightInput.value = formatFontExampleNumber(fontExamplesState.lineHeight, 2);
      if (cssSummary) {
        cssSummary.textContent =
          'font-size: ' + formatFontExampleNumber(fontExamplesState.fontSize, 2) + 'px;\n'
          + 'font-weight: ' + String(fontExamplesState.fontWeight) + ';\n'
          + 'letter-spacing: ' + formatFontExampleNumber(fontExamplesState.letterSpacing, 3) + 'em;\n'
          + 'line-height: ' + formatFontExampleNumber(fontExamplesState.lineHeight, 2) + ';';
      }
    }

    function applyFontExamplesPatch(patch) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'text')) {
        fontExamplesState.text = String(patch.text == null ? '' : patch.text).slice(0, 5000);
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'html')) {
        fontExamplesState.html = sanitizeFontExamplesHtml(patch.html, fontExamplesState.text);
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'fontSize')) {
        fontExamplesState.fontSize = clampNumber(patch.fontSize, 8, 72, fontExamplesState.fontSize);
        if (!savedPreviewSelectionRange) fontSizeControlValue = fontExamplesState.fontSize;
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'fontWeight')) {
        fontExamplesState.fontWeight = snapFontWeightOption(patch.fontWeight, fontExamplesState.fontWeight);
        if (!savedPreviewSelectionRange) fontWeightControlValue = fontExamplesState.fontWeight;
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'letterSpacing')) {
        fontExamplesState.letterSpacing = clampNumber(patch.letterSpacing, -0.08, 0.2, fontExamplesState.letterSpacing);
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'lineHeight')) {
        fontExamplesState.lineHeight = clampNumber(patch.lineHeight, 0.7, 2.4, fontExamplesState.lineHeight);
      }
      if (!Object.prototype.hasOwnProperty.call(patch || {}, 'html')) {
        fontExamplesState.html = sanitizeFontExamplesHtml(fontExamplesState.html, fontExamplesState.text);
      }
      renderFontExamples();
      writeStoredFontExamplesState(fontExamplesState);
    }

    function setActiveSection(section) {
      activeSection = section === 'diagnostic' ? 'diagnostic' : 'font-examples';
      overlay.dataset.activeSection = activeSection;
      writeStoredPushDebugPanelSection(activeSection);
      const showDiagnostic = activeSection === 'diagnostic';
      if (body) body.style.display = showDiagnostic ? 'block' : 'none';
      if (fontExamplesPanel) fontExamplesPanel.style.display = showDiagnostic ? 'none' : 'block';
      if (controls) controls.style.display = showDiagnostic ? 'flex' : 'none';
      if (subtitle) {
        subtitle.textContent = showDiagnostic
          ? 'Push delivery diagnostic and creator tools'
          : 'Font Examples workspace for on-device typography testing';
      }
      tabButtons.forEach((button) => {
        const isActive = button.getAttribute('data-shelfd-push-debug-tab') === activeSection;
        button.style.background = isActive ? 'rgba(230,199,102,0.16)' : 'rgba(255,255,255,0.06)';
        button.style.borderColor = isActive ? 'rgba(230,199,102,0.42)' : 'rgba(255,255,255,0.14)';
        button.style.color = isActive ? '#E6C766' : 'rgba(255,255,255,0.76)';
      });
      if (showDiagnostic) {
        setStatusText(overlay.dataset.diagnosticStatus || 'Diagnostic ready. Tap Copy to share.', 'diagnostic');
      } else {
        setStatusText('Edit the preview directly, or highlight text and use Font Size, Font Weight, or Align controls on just that selection.', 'font-examples');
      }
    }

    if (body) body.textContent = reportText || 'Running diagnostic...';
    renderFontExamples();
    setActiveSection(activeSection);
    overlay.querySelector('[data-shelfd-push-debug-close]').addEventListener('click', () => {
      overlay.remove();
      try {
        if (typeof window.history?.replaceState === 'function') {
          const u = new URL(window.location.href);
          if (u.hash === '#push-debug') {
            u.hash = '';
            window.history.replaceState(null, '', u.toString());
          }
        }
      } catch (_) {}
    });
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setActiveSection(button.getAttribute('data-shelfd-push-debug-tab'));
      });
    });
    fontAlignButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const align = button.getAttribute('data-shelfd-font-align');
        if (applySelectionAlignment(align)) {
          setStatusText('Selected text aligned ' + align + '.', 'font-examples');
          return;
        }
        setStatusText('Highlight text in the preview first, then tap an alignment button.', 'font-examples');
      });
    });
    if (preview) {
      const syncSelection = () => { rememberPreviewSelectionRange(); };
      preview.addEventListener('input', () => {
        const serialized = serializePreviewMarkup();
        savedPreviewSelectionRange = null;
        applyFontExamplesPatch({ text: serialized.text, html: serialized.html });
      });
      preview.addEventListener('mouseup', () => { setTimeout(syncSelection, 0); });
      preview.addEventListener('keyup', () => { setTimeout(syncSelection, 0); });
      preview.addEventListener('touchend', () => { setTimeout(syncSelection, 0); });
      document.addEventListener('selectionchange', syncSelection);
      overlay.querySelector('[data-shelfd-push-debug-close]').addEventListener('click', () => {
        document.removeEventListener('selectionchange', syncSelection);
      }, { once: true });
    }
    if (fontSizeRange) fontSizeRange.addEventListener('input', () => handleFontSizeControlChange(fontSizeRange.value));
    if (fontSizeInput) fontSizeInput.addEventListener('input', () => handleFontSizeControlChange(fontSizeInput.value));
    if (fontWeightRange) fontWeightRange.addEventListener('input', () => handleFontWeightControlChange(fontWeightRange.value));
    if (fontWeightInput) fontWeightInput.addEventListener('input', () => handleFontWeightControlChange(fontWeightInput.value));
    if (letterSpacingRange) letterSpacingRange.addEventListener('input', () => applyFontExamplesPatch({ letterSpacing: letterSpacingRange.value }));
    if (letterSpacingInput) letterSpacingInput.addEventListener('input', () => applyFontExamplesPatch({ letterSpacing: letterSpacingInput.value }));
    if (lineHeightRange) lineHeightRange.addEventListener('input', () => applyFontExamplesPatch({ lineHeight: lineHeightRange.value }));
    if (lineHeightInput) lineHeightInput.addEventListener('input', () => applyFontExamplesPatch({ lineHeight: lineHeightInput.value }));
    overlay.querySelector('[data-shelfd-push-debug-refresh]').addEventListener('click', async () => {
      overlay.dataset.diagnosticStatus = 'Running diagnostic...';
      setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      if (body) body.textContent = 'Running diagnostic...';
      const fresh = await window.__shelfdPush.fullReport().catch(e => ({ error: String(e && e.message || e) }));
      if (body) body.textContent = JSON.stringify(fresh, null, 2);
      overlay.dataset.diagnosticStatus = 'Updated ' + new Date().toLocaleTimeString();
      setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
    });
    /* v11.245: "Non-Pro View" toggle — lets the creator/dev simulate what a
       non-Pro member sees (Pro-locked filters show their lock glyphs) app-wide.
       Sets body.shelfd-simulate-nonpro + window.__shelfdSimulateNonPro, which
       isShelfdProMember() honors. Persisted to localStorage so it survives
       reload. Re-renders the current list so locks appear immediately. */
    (function () {
      const nonProBtn = overlay.querySelector('[data-shelfd-nonpro-toggle]');
      if (!nonProBtn) return;
      const syncNonProBtnLabel = () => {
        const on = document.body.classList.contains('shelfd-simulate-nonpro');
        nonProBtn.textContent = 'Non-Pro View: ' + (on ? 'On' : 'Off');
        nonProBtn.style.background = on ? 'rgba(230,199,102,0.32)' : 'rgba(230,199,102,0.16)';
      };
      syncNonProBtnLabel();
      nonProBtn.addEventListener('click', () => {
        const on = !document.body.classList.contains('shelfd-simulate-nonpro');
        document.body.classList.toggle('shelfd-simulate-nonpro', on);
        window.__shelfdSimulateNonPro = on;
        try { localStorage.setItem('shelfd:simulate-nonpro', on ? '1' : '0'); } catch (_) {}
        syncNonProBtnLabel();
        try { if (navigator && navigator.vibrate) navigator.vibrate(10); } catch (_) {}
        /* re-render the active list so Pro locks update live */
        try { if (typeof render === 'function') render(); } catch (_) {}
      });
    })();
    overlay.querySelector('[data-shelfd-push-debug-force-register]').addEventListener('click', async () => {
      const uid = resolveCurrentUid();
      const token = String(lastTokenSeen || pendingTokenAwaitingUid || '').trim();
      if (!uid) {
        overlay.dataset.diagnosticStatus = 'No uid found in any source - sign in first';
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
        return;
      }
      if (!token) {
        overlay.dataset.diagnosticStatus = 'No token cached yet - close panel and tap the bell again to re-register first';
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
        return;
      }
      overlay.dataset.diagnosticStatus = 'Force-registering token... uid=' + uid.slice(0, 6) + '... tokenTail=' + token.slice(-6);
      setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      try {
        await postRegisterToWorker(uid, token);
        registeredUid = uid;
        pendingTokenAwaitingUid = '';
        overlay.dataset.diagnosticStatus = 'Token POSTed to worker - tap Refresh to confirm tokenCount went from 0 to 1';
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      } catch (e) {
        overlay.dataset.diagnosticStatus = 'Force register failed: ' + (e && e.message || e);
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      }
    });
    overlay.querySelector('[data-shelfd-push-debug-send]').addEventListener('click', async () => {
      const uid = resolveCurrentUid();
      if (!uid) {
        overlay.dataset.diagnosticStatus = 'Sign in first - no uid to send to';
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
        return;
      }
      overlay.dataset.diagnosticStatus = 'Sending test push...';
      setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      try {
        const r = await fetch('/api/push/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid })
        });
        const j = await r.json().catch(() => ({}));
        const panelBody = overlay.querySelector('[data-shelfd-push-debug-body]');
        if (panelBody) panelBody.textContent = JSON.stringify({ testSendResponse: j, sentAt: new Date().toISOString() }, null, 2);
        overlay.dataset.diagnosticStatus = (j && j.delivered)
          ? ('APNs accepted - ' + j.delivered + ' push(es) sent. Check notification banner.')
          : ('Send response (delivered=' + (j && j.delivered || 0) + ') - see body');
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      } catch (e) {
        overlay.dataset.diagnosticStatus = 'Test send failed: ' + (e && e.message || e);
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      }
    });
    overlay.querySelector('[data-shelfd-push-debug-copy]').addEventListener('click', async () => {
      const text = body ? body.textContent : '';
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          overlay.dataset.diagnosticStatus = 'Copied to clipboard - paste anywhere';
          setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
          return;
        }
      } catch (_) {}
      try {
        const range = document.createRange();
        range.selectNodeContents(body);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        overlay.dataset.diagnosticStatus = 'Selected - long-press and copy';
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      } catch (_) {
        overlay.dataset.diagnosticStatus = 'Copy failed - long-press the JSON manually';
        setStatusText(overlay.dataset.diagnosticStatus, 'diagnostic');
      }
    });
    return overlay;
  }

  async function openDebugPanel(initialSection) {
    LOG('opening in-app debug panel');
    const overlay = buildPushDebugOverlay(null, initialSection);
    try {
      const report = await window.__shelfdPush.fullReport();
      const body = overlay && overlay.querySelector('[data-shelfd-push-debug-body]');
      if (body) body.textContent = JSON.stringify(report, null, 2);
      if (overlay) {
        overlay.dataset.diagnosticStatus = 'Generated ' + new Date().toLocaleTimeString() + '. Tap Copy to share.';
        if (overlay.dataset.activeSection === 'diagnostic') {
          const status = overlay.querySelector('[data-shelfd-push-debug-status]');
          if (status) status.textContent = overlay.dataset.diagnosticStatus;
        }
      }
    } catch (e) {
      const body = overlay && overlay.querySelector('[data-shelfd-push-debug-body]');
      if (body) body.textContent = 'Diagnostic threw: ' + (e && e.message || e);
      if (overlay) {
        overlay.dataset.diagnosticStatus = 'Diagnostic threw: ' + (e && e.message || e);
        if (overlay.dataset.activeSection === 'diagnostic') {
          const status = overlay.querySelector('[data-shelfd-push-debug-status]');
          if (status) status.textContent = overlay.dataset.diagnosticStatus;
        }
      }
    }
  }
  window.__shelfdPush.openDebugPanel = openDebugPanel;

  /* Auto-open the panel when the URL hash matches. Works on iPhone
     (just type the URL into the in-app browser address bar) AND on
     PWA / web. */
  function maybeAutoOpenFromHash() {
    try {
      const h = String(window.location.hash || '').toLowerCase();
      if (h === '#push-debug' || h === '#shelfd-push-debug' || h === '#pushdebug') {
        setTimeout(() => openDebugPanel('diagnostic'), 250);
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoOpenFromHash, { once: true });
  } else {
    maybeAutoOpenFromHash();
  }
  window.addEventListener('hashchange', maybeAutoOpenFromHash);

  /* v10.459: in-app trigger that doesn't require an address bar —
     TestFlight builds run inside the Capacitor wrapper with no URL
     bar exposed, so visiting `#push-debug` isn't reachable from the
     iPhone alone. Workaround: 5 quick taps anywhere on the Shelfd
     wordmark/logo opens the debug panel. The logo is always visible
     in the app's header, so it's a reachable gesture without
     polluting the UI. Tap count resets after 1.5s of inactivity
     between taps. Idempotent — multiple triggers just re-open the
     panel with a fresh diagnostic. */
  let _pushDebugTapCount = 0;
  let _pushDebugTapTimer = null;
  function registerPushDebugLogoGesture() {
    /* Match any of the logo / wordmark elements present in the
       Shelfd header. Multiple selectors because the markup has
       evolved across versions. */
    const selectors = [
      '#shelfd-logo',
      '.shelfd-logo',
      '.mylist-logo',
      '.shelfd-wordmark',
      '[data-shelfd-logo]',
      '.app-logo'
    ];
    /* Use event delegation on document so we catch the logo no
       matter when it mounts (some routes lazy-render the header). */
    document.addEventListener('click', (event) => {
      try {
        const target = event.target;
        if (!target || target.nodeType !== 1) return;
        const matches = selectors.some(sel => {
          try { return target.closest && target.closest(sel); }
          catch (_) { return false; }
        });
        if (!matches) return;
        _pushDebugTapCount += 1;
        clearTimeout(_pushDebugTapTimer);
        _pushDebugTapTimer = setTimeout(() => { _pushDebugTapCount = 0; }, 1500);
        if (_pushDebugTapCount >= 5) {
          _pushDebugTapCount = 0;
          clearTimeout(_pushDebugTapTimer);
          openDebugPanel('diagnostic');
        }
      } catch (_) {}
    }, true);
  }
  registerPushDebugLogoGesture();

  /* Also expose a global function the user can invoke from anywhere
     — e.g. by pasting `__shelfdPushDebug()` into any text input the
     app routes (none today, but a future-proof entry point). */
  window.__shelfdPushDebug = () => openDebugPanel('diagnostic');

  /* v10.459: visible-but-subtle FLOATING DEBUG BUTTON. The 5-tap-on-
     logo gesture is the primary entry, but if the logo selectors
     don't match (header markup varies by section / page), a static
     floating button guarantees access. Tiny 32px dot tucked in the
     bottom-right safe area so it doesn't compete with any of the
     app's chrome. Visible only on Capacitor iOS — production web
     users never see it. Remove once the push pipeline is verified
     working.
     v10.463: scoped to creator-only. The bell is now gated on the
     current uid matching the project owner's uid — every other
     signed-in user sees nothing. Implementation: the FAB DOM node
     is always attached so it can flip visible the moment auth
     resolves to the creator, but its `display` starts at `none`
     and is only flipped to `inline-flex` once `resolveCurrentUid()`
     returns the creator uid. A small recurring check covers the
     case where auth resolves after first paint (Capacitor cold-
     start can take a few hundred ms for the auth state to populate). */
  const PUSH_DEBUG_CREATOR_UID = 'KihPpiqSsFMpn5Tee4xZWFWapg62';
  const PUSH_DEBUG_FLOATING_FAB_ENABLED = false;
  function injectFloatingPushDebugButton() {
    if (!PUSH_DEBUG_FLOATING_FAB_ENABLED) return;
    /* Wait for body so we can attach. */
    const tryInject = () => {
      if (!document.body) {
        setTimeout(tryInject, 200);
        return;
      }
      if (document.getElementById('shelfd-push-debug-fab')) return;
      const fab = document.createElement('button');
      fab.id = 'shelfd-push-debug-fab';
      fab.type = 'button';
      fab.setAttribute('aria-label', 'Creator dev tools');
      fab.textContent = '\uD83D\uDD28';
      fab.style.cssText = [
        'position:fixed',
        'right:8px',
        'bottom:calc(env(safe-area-inset-bottom,0px) + 78px)',
        'width:34px',
        'height:34px',
        'border-radius:50%',
        'border:1px solid rgba(230,199,102,0.42)',
        'background:rgba(15,15,15,0.82)',
        'color:#E6C766',
        'font-size:16px',
        'line-height:1',
        'display:none',
        'align-items:center',
        'justify-content:center',
        'z-index:2147483646',
        'cursor:pointer',
        '-webkit-tap-highlight-color:transparent',
        'box-shadow:0 4px 12px rgba(0,0,0,0.45)',
        'padding:0'
      ].join(';');
      fab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDebugPanel('font-examples');
      });
      document.body.appendChild(fab);
      /* v10.463: poll for auth resolution. The bell stays display:none
         until we can confirm the signed-in user is the creator. Once
         confirmed it stays visible for the rest of the session; if
         the user signs out, it goes back to hidden. */
      const updateVisibility = () => {
        const uid = resolveCurrentUid();
        if (uid === PUSH_DEBUG_CREATOR_UID) {
          fab.style.display = 'inline-flex';
        } else {
          fab.style.display = 'none';
        }
      };
      updateVisibility();
      /* Hook firebase auth changes when ready so the bell flips
         visible the instant the creator signs in (and hides on
         sign-out). Also poll for ~10s after load to catch any
         async-late auth resolution that the firebase callback
         hadn't yet wired by the time of injection. */
      const wireAuth = () => {
        if (typeof firebase === 'undefined' || !firebase.auth) {
          setTimeout(wireAuth, 400);
          return;
        }
        try { firebase.auth().onAuthStateChanged(updateVisibility); } catch (_) {}
      };
      wireAuth();
      let pollCount = 0;
      const pollTimer = setInterval(() => {
        updateVisibility();
        pollCount++;
        if (pollCount > 25 || resolveCurrentUid() === PUSH_DEBUG_CREATOR_UID) {
          /* Stop polling after ~10s — by then the auth-state hook
             owns the visibility flips. */
          clearInterval(pollTimer);
        }
      }, 400);
      LOG('floating push-debug FAB injected — creator-only (uid ' + PUSH_DEBUG_CREATOR_UID.slice(0, 8) + '…)');
    };
    tryInject();
  }
  injectFloatingPushDebugButton();
})();
