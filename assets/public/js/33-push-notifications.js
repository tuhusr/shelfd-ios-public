/* =============================================================================
   33-push-notifications.js  (v10.275 — initial)
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
    /* Expose a stub so the rest of the app can call isPushAvailable() safely. */
    window.__shelfdPush = { isCapacitorIOS, available: false };
    return;
  }

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
      await fetch('/api/push/register', {
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
    } catch (e) {
      console.warn('[push] /api/push/register failed (will retry next session):', e && e.message ? e.message : e);
    }
  }

  /* ---------- Listeners (bound once) ---------- */
  function bindPushListeners(Push) {
    if (listenersBound) return;
    listenersBound = true;

    Push.addListener('registration', async (event) => {
      try {
        const token = String((event && event.value) || '').trim();
        if (!token) return;
        if (token === lastTokenSeen) return;
        lastTokenSeen = token;
        const uid = (window.currentUser && window.currentUser.uid)
          || (window.firebase && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid)
          || '';
        if (!uid) return;
        await postRegisterToWorker(uid, token);
      } catch (e) {
        console.warn('[push] registration handler failed:', e);
      }
    });

    Push.addListener('registrationError', (err) => {
      console.warn('[push] registrationError:', err && err.error ? err.error : err);
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
    if (isRegistering) return;
    isRegistering = true;
    try {
      const Push = getPlugin();
      if (!Push) {
        console.warn('[push] PushNotifications plugin not available on window.Capacitor.Plugins');
        return;
      }
      const uid = (window.currentUser && window.currentUser.uid) || '';
      if (!uid) return;
      if (registeredUid === uid && lastTokenSeen) return; /* already done this session */

      /* Permission check / prompt */
      const status = await Push.checkPermissions();
      let receive = status && status.receive;
      if (receive === 'prompt' || receive === 'prompt-with-rationale' || !receive) {
        const ask = await Push.requestPermissions();
        receive = ask && ask.receive;
      }
      if (receive !== 'granted') {
        console.info('[push] permission =', receive);
        return;
      }

      bindPushListeners(Push);
      /* register() asks iOS to talk to APNs; the OS will fire the
         "registration" listener with the device token if it succeeds. */
      await Push.register();
      registeredUid = uid;
    } catch (e) {
      console.warn('[push] requestAndRegister failed:', e && e.message ? e.message : e);
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

  /* Expose for debugging — open Safari Web Inspector and call these. */
  window.__shelfdPush = {
    isCapacitorIOS,
    requestAndRegister,
    getPlugin,
    available: true
  };
})();
