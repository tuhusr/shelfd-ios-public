/* =============================================================================
   19d-apple-signin.js  (v10.554)
   Sign in with Apple — Capacitor iOS only.
   Uses @capacitor-community/apple-sign-in plugin to get an Apple identity
   token, then signs into Firebase via OAuthProvider credential.

   Only shown on Capacitor iOS (ShelfdNativeNoInset UA marker). Hidden on
   web since Apple only permits SIWA on Apple platforms.

   IMPORTANT: Before this works you must enable Apple as a sign-in provider
   in Firebase Console → Authentication → Sign-in method → Apple.
   ========================================================================== */
(function() {
  'use strict';

  /* Detect Capacitor iOS — same check used in 33-push-notifications.js */
  function isCapacitorIOS() {
    try {
      const Cap = window.Capacitor;
      if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) {
        return typeof Cap.getPlatform === 'function' && Cap.getPlatform() === 'ios';
      }
      return /\bShelfdNativeNoInset\b/.test(navigator.userAgent || '');
    } catch (_) { return false; }
  }

  /* Show the Apple button only on Capacitor iOS */
  function initAppleSignInButton() {
    const btn = document.getElementById('shelfd-apple-signin-btn');
    if (!btn) return;
    if (isCapacitorIOS()) {
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  }

  /* v10.560: Generate a cryptographically secure random nonce.
     Apple requires the SHA256 hash of this nonce in the auth request,
     and Firebase requires the raw (un-hashed) nonce to validate the
     identity token. Without this, Firebase rejects the token. */
  function generateRawNonce(length) {
    length = length || 32;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._';
    const random  = new Uint8Array(length);
    (window.crypto || window.msCrypto).getRandomValues(random);
    let result = '';
    for (let i = 0; i < length; i++) result += charset[random[i] % charset.length];
    return result;
  }

  async function sha256Hex(message) {
    const msgBuffer  = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const APPLE_NATIVE_PLUGIN_NAMES = [
    'AppleSignIn',
    'SignInWithApple',
    'AppleSignInPlugin',
    'ShelfdAppleSignIn',
    'NativeAppleSignIn'
  ];
  const APPLE_NATIVE_METHOD_NAMES = ['authorize', 'signIn', 'login'];

  function getAvailableNativePluginNames() {
    try { return Object.keys(window.Capacitor?.Plugins || {}); }
    catch (_) { return []; }
  }

  function findNativeApplePlugin() {
    const plugins = window.Capacitor?.Plugins || {};
    for (const name of APPLE_NATIVE_PLUGIN_NAMES) {
      const plugin = plugins[name] || window[name];
      if (!plugin) continue;
      const method = APPLE_NATIVE_METHOD_NAMES.find(methodName => typeof plugin[methodName] === 'function');
      if (method) return { plugin, name, method };
    }
    return null;
  }

  async function waitForNativeApplePlugin(timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = findNativeApplePlugin();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return findNativeApplePlugin();
  }

  /* Main sign-in flow */
  async function signInWithApple() {
    const btn = document.getElementById('shelfd-apple-signin-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
      /* Get the plugin — our custom native plugin is registered as "AppleSignIn" */
      const native = await waitForNativeApplePlugin();
      if (!native) {
        console.error('[appleSignIn] Apple native plugin not found', {
          expected: APPLE_NATIVE_PLUGIN_NAMES,
          available: getAvailableNativePluginNames()
        });
        throw new Error('AppleSignIn plugin not available');
      }

      /* v10.560: nonce dance for Firebase Sign in with Apple */
      const rawNonce    = generateRawNonce();
      const hashedNonce = await sha256Hex(rawNonce);

      const result = await native.plugin[native.method]({
        clientId:    'com.myshelfd.app',
        redirectURI: 'https://myshelfd.com',
        scopes:      'email name',
        nonce:       hashedNonce,
        state:       Math.random().toString(36).substring(2, 10)
      });

      const response = result && result.response ? result.response : result;
      const identityToken = response.identityToken || response.id_token;

      if (!identityToken) {
        throw new Error('No identity token returned from Apple');
      }

      /* Build Firebase credential with the RAW nonce so Firebase can
         validate it against the SHA256 inside the identity token. */
      const provider = new firebase.auth.OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken:  identityToken,
        rawNonce: rawNonce
      });

      const userCred = await firebase.auth().signInWithCredential(credential);

      /* Apple only sends name on the FIRST authorization — save it if present */
      const givenName  = response.givenName  || response.given_name  || '';
      const familyName = response.familyName || response.family_name || '';
      const fullName   = [givenName, familyName].filter(Boolean).join(' ').trim();

      if (fullName && userCred.user && !userCred.user.displayName) {
        try {
          await userCred.user.updateProfile({ displayName: fullName });
        } catch (_) {}
      }

      /* Firebase onAuthStateChanged will handle the rest — no manual redirect */

    } catch (err) {
      /* Code 1001 = user cancelled — silent */
      const cancelled = err?.code === '1001'
        || String(err?.message || '').toLowerCase().includes('cancel')
        || String(err?.message || '').toLowerCase().includes('dismissed');

      if (!cancelled) {
        console.error('[appleSignIn]', err);
        /* v10.560: surface the actual error so we can diagnose on TestFlight */
        const detail = err?.message || err?.code || String(err) || 'unknown';
        if (typeof showToast === 'function') {
          showToast('Apple sign-in error: ' + detail, { durationMs: 6000 });
        }
      }
    } finally {
      const b = document.getElementById('shelfd-apple-signin-btn');
      if (b) {
        b.disabled = false;
        b.innerHTML = `<svg width="14" height="18" viewBox="0 0 384 512" aria-hidden="true" style="flex-shrink:0" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg> Sign in with Apple`;
      }
    }
  }

  window.signInWithApple = signInWithApple;

  /* Init on DOM ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAppleSignInButton);
  } else {
    initAppleSignInButton();
  }
  /* Also re-check after a short delay in case Capacitor initialises late */
  setTimeout(initAppleSignInButton, 800);

})();
