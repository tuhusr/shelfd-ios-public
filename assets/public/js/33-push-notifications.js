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
         Use the payload's notificationId (or target hints) to route to the
         right page. We piggy-back on the existing openActivityNotificationTarget
         helper so behavior matches an in-app tap on the same notification row. */
      try {
        const data = (action && action.notification && action.notification.data) || {};
        const notificationId = String(data.notificationId || '').trim();
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

  /* Auto-open the panel when the URL hash matches. Works on iPhone
     (just type the URL into the in-app browser address bar) AND on
     PWA / web. */
  function maybeAutoOpenFromHash() {
    try {
      const h = String(window.location.hash || '').toLowerCase();
      if (h === '#push-debug' || h === '#shelfd-push-debug' || h === '#pushdebug') {
        setTimeout(openDebugPanel, 250);
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
          openDebugPanel();
        }
      } catch (_) {}
    }, true);
  }
  registerPushDebugLogoGesture();

  /* Also expose a global function the user can invoke from anywhere
     — e.g. by pasting `__shelfdPushDebug()` into any text input the
     app routes (none today, but a future-proof entry point). */
  window.__shelfdPushDebug = openDebugPanel;

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
  function injectFloatingPushDebugButton() {
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
      fab.setAttribute('aria-label', 'Push notification diagnostic');
      fab.textContent = '🔔';
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
        openDebugPanel();
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
