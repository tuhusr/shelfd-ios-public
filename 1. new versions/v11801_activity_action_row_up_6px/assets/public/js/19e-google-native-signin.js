/* =============================================================================
   19e-google-native-signin.js  (v10.565)
   Native Google Sign-In for Capacitor iOS.

   On Capacitor iOS:
     - Skips GIS (which opens Safari for OAuth — violates guideline 4.0)
     - Uses the native GoogleSignIn-iOS SDK via a custom Capacitor plugin
     - Returns an ID token + access token to JS
     - Signs into Firebase with GoogleAuthProvider credential

   On web / non-iOS:
     - No-ops. GIS (19-gis-signin.js) handles Google sign-in as normal.

   Xcode requirements (one-time setup on Mac):
     1. GoogleSignInPlugin.swift + GoogleSignInPlugin.m added to App target
     2. Info.plist: add key "GIDClientID" with your iOS OAuth 2.0 Client ID
        (from Google Cloud Console → APIs & Services → Credentials → iOS client)
     3. Info.plist: add URL scheme for the reversed client ID
        e.g. com.googleusercontent.apps.YOUR_IOS_CLIENT_ID
   ========================================================================== */
(function() {
  'use strict';

  function isCapacitorIOS() {
    try {
      const Cap = window.Capacitor;
      if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) {
        return typeof Cap.getPlatform === 'function' && Cap.getPlatform() === 'ios';
      }
      return /\bShelfdNativeNoInset\b/.test(navigator.userAgent || '');
    } catch (_) { return false; }
  }

  if (!isCapacitorIOS()) return; /* web / Android — GIS handles it */

  /* On Capacitor iOS — hide GIS target and prevent GIS from rendering
     its button (which would trigger the Safari OAuth flow). Instead we
     keep the legacy button visible and wire it to the native plugin. */
  function setupNativeGoogleButton() {
    /* Stop GIS from hiding our button */
    const gisTarget = document.getElementById('gis-signin-target');
    if (gisTarget) gisTarget.style.display = 'none';

    /* Make sure the legacy button is visible and not suppressed by GIS */
    document.querySelectorAll('.gis-legacy-btn').forEach(btn => {
      btn.style.display = '';
      btn.classList.remove('gis-replaced');
    });

    /* Remove the gis-active class if GIS already ran */
    document.body.classList.remove('gis-active');
  }

  const GOOGLE_NATIVE_PLUGIN_NAMES = [
    'GoogleSignIn',
    'GoogleSignInPlugin',
    'ShelfdGoogleSignIn',
    'NativeGoogleSignIn',
    'GoogleAuth'
  ];
  const GOOGLE_NATIVE_METHOD_NAMES = ['signIn', 'login', 'authorize'];

  function getAvailableNativePluginNames() {
    try { return Object.keys(window.Capacitor?.Plugins || {}); }
    catch (_) { return []; }
  }

  function findNativeGooglePlugin() {
    const plugins = window.Capacitor?.Plugins || {};
    for (const name of GOOGLE_NATIVE_PLUGIN_NAMES) {
      const plugin = plugins[name] || window[name];
      if (!plugin) continue;
      const method = GOOGLE_NATIVE_METHOD_NAMES.find(methodName => typeof plugin[methodName] === 'function');
      if (method) return { plugin, name, method };
    }
    return null;
  }

  async function waitForNativeGooglePlugin(timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = findNativeGooglePlugin();
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return findNativeGooglePlugin();
  }

  function getGoogleIdToken(result = {}) {
    return result.idToken
      || result.id_token
      || result.authentication?.idToken
      || result.response?.idToken
      || '';
  }

  function getGoogleAccessToken(result = {}) {
    return result.accessToken
      || result.access_token
      || result.authentication?.accessToken
      || result.response?.accessToken
      || null;
  }

  /* v10.565: Override window.signIn() so any call-site (legacy button,
     preview mode CTA, etc.) routes through the native plugin on iOS. */
  window.signIn = async function() {
    const native = await waitForNativeGooglePlugin();

    if (!native) {
      /* Plugin not available — show clear error */
      if (typeof showToast === 'function') {
        showToast('Google sign-in error: native plugin not available', { durationMs: 5000 });
      }
      console.error('[googleNativeSignIn] Google native plugin not found', {
        expected: GOOGLE_NATIVE_PLUGIN_NAMES,
        available: getAvailableNativePluginNames()
      });
      return;
    }

    try {
      const result = await native.plugin[native.method]();
      const idToken = getGoogleIdToken(result);
      const accessToken = getGoogleAccessToken(result);

      if (!idToken) {
        throw new Error('No ID token returned from Google');
      }

      /* Build Firebase credential from the native Google tokens */
      const credential = firebase.auth.GoogleAuthProvider.credential(
        idToken,
        accessToken
      );

      await firebase.auth().signInWithCredential(credential);

      /* Firebase onAuthStateChanged handles the rest */

    } catch (err) {
      const cancelled = err?.code === '1001'
        || String(err?.message || '').toLowerCase().includes('cancel')
        || String(err?.message || '').toLowerCase().includes('dismissed');

      if (!cancelled) {
        console.error('[googleNativeSignIn]', err);
        if (typeof showToast === 'function') {
          showToast('Google sign-in error: ' + (err?.message || 'Please try again.'), { durationMs: 5000 });
        }
      }
    }
  };

  /* Run setup as soon as DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNativeGoogleButton);
  } else {
    setupNativeGoogleButton();
  }
  /* Also re-run after a short delay in case GIS fires late */
  setTimeout(setupNativeGoogleButton, 500);
  setTimeout(setupNativeGoogleButton, 1500);

})();
