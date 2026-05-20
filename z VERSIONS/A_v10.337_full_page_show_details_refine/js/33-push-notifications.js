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
  function isCapacitorIOS() {
    try {
      const Cap = window.Capacitor;
      if (!Cap) return false;
      if (typeof Cap.isNativePlatform !== 'function') return false;
      if (!Cap.isNativePlatform()) return false;
      const platform = typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : '';
      return platform === 'ios';
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
        const uid = (window.currentUser && window.currentUser.uid)
          || (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid)
          || '';
        if (!uid) { WARN('no uid available yet — token cached, will retry next auth event'); return; }
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
        return;
      }
      LOG('PushNotifications plugin present');
      const uid = (window.currentUser && window.currentUser.uid) || '';
      if (!uid) { LOG('no uid yet, waiting for auth'); return; }
      if (registeredUid === uid && lastTokenSeen) {
        LOG('already registered for this uid this session, skipping');
        return;
      }

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

      bindPushListeners(Push);
      /* register() asks iOS to talk to APNs; the OS will fire the
         "registration" listener with the device token if it succeeds. */
      LOG('calling Push.register() — waiting for APNs token via registration listener…');
      await Push.register();
      LOG('Push.register() returned. If you do not see a "registration event fired" log within a few seconds, APNs did not return a token. Likely native-side problem (capability/entitlement/AppDelegate).');
      registeredUid = uid;
    } catch (e) {
      WARN('requestAndRegister failed:', e && e.message ? e.message : e);
    } finally {
      isRegistering = false;
    }
  }

  /* ---------- Boot ---------- */
  function start() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
      /* Firebase isn't ready yet — try again shortly. */
      setTimeout(start, 600);
      return;
    }
    firebase.auth().onAuthStateChanged((user) => {
      if (!user) {
        /* User signed out — leave any cached token in place; iOS keeps the
           APNs registration regardless. Next sign-in will re-register. */
        registeredUid = '';
        return;
      }
      /* Defer a moment so the auth listeners + initial render don't fight
         the permission prompt. */
      setTimeout(requestAndRegister, 1500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* Expose for debugging — open Safari Web Inspector and call these.
     v10.318 — adds diagnose() + test() that hit the new Worker endpoints. */
  window.__shelfdPush = {
    isCapacitorIOS,
    requestAndRegister,
    getPlugin,
    available: true,
    state: () => ({ registeredUid, lastTokenTail: String(lastTokenSeen).slice(-6), listenersBound, isRegistering }),
    diagnose: async function() {
      const uid = (window.currentUser && window.currentUser.uid) || '';
      const r = await fetch('/api/push/diagnose?uid=' + encodeURIComponent(uid), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      console.log('[push] diagnose →', j);
      return j;
    },
    test: async function() {
      const uid = (window.currentUser && window.currentUser.uid) || '';
      if (!uid) { WARN('test: no uid'); return; }
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
  LOG('debug helpers ready: window.__shelfdPush.diagnose() / .test() / .state() / .requestAndRegister()');
})();
