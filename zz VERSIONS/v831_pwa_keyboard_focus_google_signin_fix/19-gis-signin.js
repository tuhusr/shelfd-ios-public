/* =============================================================================
   19-gis-signin.js  (v831 — no-auto-one-tap + resume hardening)
   Google Identity Services (GIS) sign-in for Shelfd.

   Why this exists:
     iOS PWA standalone mode + Firebase Auth `signInWithRedirect` is
     fundamentally broken — the redirect navigates to Google in Safari, which
     completes the auth in Safari's storage partition. The PWA standalone
     window has its own storage and never sees the credential.

   How GIS fixes it:
     GIS is Google's modern Sign-In With Google library. It opens the OAuth
     flow inside an iframe (or via FedCM on iOS 17+ / Chrome). No top-level
     redirect, no leaving the PWA window. The library returns a Google ID
     token (JWT) directly to the page. We hand that to Firebase via
     `signInWithCredential` — instant, in-PWA, persistent auth.

   Integration:
     - Renders the official Google button into #gis-signin-target.
     - Hides the legacy <button class="gis-legacy-btn"> when GIS is active.
     - If client ID is not configured (still placeholder), falls back to
       the legacy button which uses the existing signIn() flow.
     - window.signIn() is NOT routed through One Tap any longer — the
       visible Shelfd Google button is the only entry-point.

   v831 changes:
     - Removed the automatic Google "Continue with …" bottom prompt
       (google.accounts.id.prompt) on page load and on visibility return.
       Google auth now starts ONLY when the user taps the Shelfd Google
       Sign-In button.
     - auto_select: false (no silent credential return on revisit).
     - cancel_on_tap_outside: true so any stray prompt is dismissible.
     - On pageshow / visibilitychange we no longer re-prompt One Tap;
       instead we just nudge Firebase Auth (`currentUser.reload()`) so
       a sign-in that completed in another tab / after 2FA bounces back
       through onAuthStateChanged immediately.
     - The "stalled" hint after 6s still appears, but its copy no longer
       refers to "the Google popup" — it just tells the user to tap the
       Google button again.
   ========================================================================== */
(function() {
  'use strict';

  /* ---------- Helpers ---------- */
  function isClientIdConfigured() {
    const id = (typeof window !== 'undefined' && window.GOOGLE_OAUTH_WEB_CLIENT_ID) || '';
    return typeof id === 'string'
      && id.endsWith('.apps.googleusercontent.com')
      && !id.includes('PASTE_YOUR_CLIENT_ID_HERE')
      && !id.includes('REPLACE');
  }

  function isStandalonePWA() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
    } catch (_) {}
    return false;
  }

  function getButtonWidth() {
    /* v765: reverted to v763's 360px (matches the .landing-profile-cta
       width above). v762 safety net stays in place. */
    return 360;
  }

  /* ---------- Credential handler ---------- */
  function handleCredentialResponse(response) {
    if (!response || !response.credential) {
      console.warn('GIS credential response empty.');
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.auth) {
      console.error('GIS sign-in: firebase.auth is not available.');
      return;
    }
    const idToken = response.credential;
    let credential;
    try {
      credential = firebase.auth.GoogleAuthProvider.credential(idToken);
    } catch (e) {
      console.error('GIS credential build failed:', e);
      return;
    }
    /* v636: credential arrived → kill any "stalled" hint and tracking */
    hideSignInHint();
    signInAttemptStartedAt = 0;
    /* Show a brief in-page indicator that we're completing sign-in */
    showSigningInOverlay();
    firebase.auth().signInWithCredential(credential)
      .then(() => {
        /* onAuthStateChanged in 17-comments-auth-init.js will swap the UI
           into the app shell. We just hide the overlay if it's still up. */
        hideSigningInOverlay();
      })
      .catch(err => {
        hideSigningInOverlay();
        console.error('GIS sign-in (signInWithCredential) failed:', err);
        if (typeof showToast === 'function') {
          showToast('Sign in failed. ' + (err && err.message ? err.message : 'Try again.'));
        } else {
          alert('Sign in failed. ' + (err && err.message ? err.message : 'Try again.'));
        }
      });
  }

  function showSigningInOverlay() {
    if (document.getElementById('gis-signin-overlay')) return;
    const el = document.createElement('div');
    el.id = 'gis-signin-overlay';
    el.className = 'gis-signin-overlay';
    el.innerHTML = '<div class="gis-signin-spinner" aria-hidden="true"></div><span>Signing in&hellip;</span>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
  }
  function hideSigningInOverlay() {
    const el = document.getElementById('gis-signin-overlay');
    if (!el) return;
    el.classList.remove('is-visible');
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 220);
  }

  /* ---------- GIS init + button render ---------- */
  let gisInitialized = false;
  let gisButtonRendered = false;

  function initGisLibrary() {
    if (gisInitialized) return;
    if (!isClientIdConfigured()) return;
    if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
    try {
      google.accounts.id.initialize({
        client_id: window.GOOGLE_OAUTH_WEB_CLIENT_ID,
        callback: handleCredentialResponse,
        /* v831: auto_select disabled. We do NOT want returning users to
           get silently signed in OR see an automatic "Continue with …"
           bottom sheet. Sign-in starts only when the user taps the
           Shelfd Google button rendered below. */
        auto_select: false,
        cancel_on_tap_outside: true,
        itp_support: true,           /* Safari ITP support */
        use_fedcm_for_prompt: true,  /* iOS 17+ / Chrome FedCM */
        ux_mode: 'popup'             /* never redirect — keeps us in the PWA */
      });
      gisInitialized = true;
    } catch (err) {
      console.error('GIS initialize failed:', err);
    }
  }

  /* ---------- v831: Visibility recovery (no auto One Tap) ----------
     We track when the user appears to have started a sign-in attempt
     (window.blur is a strong signal — happens when Google's popup /
     2FA opens). On returning to the page, we (a) nudge Firebase Auth
     to re-pull `currentUser` so a completed sign-in surfaces, and
     (b) after 6s of no progress, show a soft hint asking the user
     to tap the Google button again. We NEVER auto-show One Tap. */
  let signInAttemptStartedAt = 0;
  let hintShown = false;

  function isLoginScreenVisible() {
    const el = document.getElementById('login-screen');
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function isFirebaseSignedIn() {
    try {
      return !!(window.firebase && firebase.auth && firebase.auth().currentUser);
    } catch (_) { return false; }
  }

  /* Force Firebase Auth to re-evaluate its current user. Useful after the
     user returns from a 2FA tab/app — onAuthStateChanged fires again if
     anything has changed server-side. Never throws. */
  function refreshFirebaseAuthState() {
    try {
      if (!(window.firebase && firebase.auth)) return;
      const user = firebase.auth().currentUser;
      if (user && typeof user.reload === 'function') {
        user.reload().catch(() => {});
      }
    } catch (_) {}
  }

  function showSignInHint() {
    if (hintShown) return;
    const target = document.getElementById('gis-signin-target');
    if (!target || !target.parentElement) return;
    const hint = document.createElement('div');
    hint.id = 'gis-signin-hint';
    hint.className = 'gis-signin-hint';
    hint.innerHTML = `
      <span class="gis-signin-hint-dot" aria-hidden="true"></span>
      Finished verifying? Tap the Google button again to continue.
    `;
    target.parentElement.insertBefore(hint, target.nextSibling);
    hintShown = true;
  }
  function hideSignInHint() {
    const el = document.getElementById('gis-signin-hint');
    if (el) el.remove();
    hintShown = false;
  }

  /* The GIS button is in a Google iframe, so we can't directly observe a click.
     But window blur is a strong signal that the user just opened the Google
     popup (or switched apps for 2FA). We use that to start a stopwatch. */
  function trackPossibleSignInStart() {
    if (signInAttemptStartedAt) return;
    if (isFirebaseSignedIn()) return;
    if (!isLoginScreenVisible()) return;
    signInAttemptStartedAt = Date.now();
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!gisInitialized) return;
    if (isFirebaseSignedIn()) {
      hideSignInHint();
      hideSigningInOverlay();
      signInAttemptStartedAt = 0;
      return;
    }
    if (!isLoginScreenVisible()) return;

    /* Nudge Firebase Auth to re-check its state — a 2FA completion in
       another tab/app may have arrived while we were hidden, but the
       onAuthStateChanged listener won't fire again without a poke. */
    refreshFirebaseAuthState();
    /* Belt-and-suspenders: poll Firebase once more after a short delay
       so a late-arriving token has a chance to land. */
    setTimeout(refreshFirebaseAuthState, 800);

    /* If they've been at it for >6s and still aren't signed in, surface
       the hint so the "tap the Google button again" trick is obvious. */
    const stalled = signInAttemptStartedAt && (Date.now() - signInAttemptStartedAt > 6000);
    if (stalled) showSignInHint();
  }

  function onWindowBlur() {
    /* Window losing focus is the closest signal we have to "user opened the
       Google popup or switched to Gmail for 2FA". */
    trackPossibleSignInStart();
  }

  function renderGisButton() {
    if (gisButtonRendered) return;
    if (!gisInitialized) return;
    const target = document.getElementById('gis-signin-target');
    if (!target) return;
    /* v747: Use Google's two canonical recognizable themes —
       filled_blue (the iconic blue users instantly recognize) for dark
       mode, and outline (clean white-on-light) for light mode.
       filled_black was rare and read as a knockoff. */
    const lightMode = document.body.classList.contains('light-mode');
    try {
      google.accounts.id.renderButton(target, {
        type: 'standard',
        shape: 'pill',
        theme: lightMode ? 'outline' : 'filled_blue',
        text: 'continue_with',
        size: 'large',
        logo_alignment: 'left',
        width: getButtonWidth()
      });
      gisButtonRendered = true;
      /* Hide legacy fallback now that GIS is live */
      document.querySelectorAll('.gis-legacy-btn').forEach(b => b.classList.add('gis-replaced'));
      document.body.classList.add('gis-active');
    } catch (err) {
      console.error('GIS renderButton failed:', err);
    }
  }

  /* ---------- v831: Do NOT auto-show One Tap from window.signIn ----------
     The legacy signIn() in 17-comments-auth-init.js still drives the Firebase
     popup/redirect flow for desktop browsers and as a fallback. We only
     wrap it to start the sign-in stopwatch so visibility recovery knows
     a sign-in is in flight. No prompt() call, no automatic bottom sheet. */
  function patchSignIn() {
    if (typeof window === 'undefined') return;
    const original = window.signIn;
    if (typeof original !== 'function' || original.__gisPatched) return;
    const wrapped = function() {
      try { trackPossibleSignInStart(); } catch (_) {}
      return original.apply(window, arguments);
    };
    wrapped.__gisPatched = true;
    window.signIn = wrapped;
  }

  /* ---------- Re-render the button on resize / theme change ---------- */
  let lastRenderedWidth = 0;
  function maybeRerenderOnResize() {
    if (!gisButtonRendered) return;
    const target = document.getElementById('gis-signin-target');
    if (!target) return;
    const w = getButtonWidth();
    if (Math.abs(w - lastRenderedWidth) < 16) return;
    lastRenderedWidth = w;
    target.innerHTML = '';
    gisButtonRendered = false;
    renderGisButton();
  }

  /* v762: SAFETY — guarantee a visible sign-in button no matter what.
     If GIS hasn't successfully rendered (or rendered an empty iframe)
     within 3 seconds, force-show the legacy "Sign in with Google" button
     and remove the .gis-active body class so its hide rule no longer
     applies. This catches:
       - GIS script failed to load (network blocked / Google CDN issue)
       - GIS rendered but iframe is 0-height
       - GIS reported success but visually empty
     User always has a working way to sign in. */
  function ensureLegacyFallbackVisible() {
    const target = document.getElementById('gis-signin-target');
    /* If GIS DID render an iframe successfully and it has visible size,
       leave things alone. Otherwise, force the legacy button visible. */
    const iframe = target ? target.querySelector('iframe') : null;
    const renderedOk = !!(iframe && iframe.offsetHeight > 0);
    if (renderedOk) return;
    document.body.classList.remove('gis-active');
    document.querySelectorAll('.gis-legacy-btn').forEach(btn => {
      btn.classList.remove('gis-replaced');
      btn.style.display = 'flex';
    });
  }

  /* ---------- Bootstrap ---------- */
  function start() {
    /* v762: schedule the legacy-button safety check unconditionally so
       it fires regardless of whether GIS init succeeds. */
    setTimeout(ensureLegacyFallbackVisible, 3000);

    if (!isClientIdConfigured()) {
      /* Leave legacy button visible. Add a console hint for the developer. */
      console.warn('[GIS] window.GOOGLE_OAUTH_WEB_CLIENT_ID is not set. Paste your OAuth Web Client ID in js/01-firebase-login-state.js to enable PWA-friendly sign-in.');
      return;
    }
    /* Wait for the gsi/client script to attach. It's loaded async in <head>. */
    let tries = 0;
    const tick = () => {
      if (window.google?.accounts?.id) {
        initGisLibrary();
        renderGisButton();
        patchSignIn();
        /* v831: NO automatic One Tap. The Google bottom prompt is gone.
           Sign-in starts only when the user taps the rendered Google
           button or the Shelfd legacy fallback button. */
        return;
      }
      if (++tries < 60) setTimeout(tick, 100);
      else console.error('[GIS] gsi/client failed to load after 6s.');
    };
    tick();

    window.addEventListener('resize', () => {
      clearTimeout(maybeRerenderOnResize._t);
      maybeRerenderOnResize._t = setTimeout(maybeRerenderOnResize, 180);
    }, { passive: true });

    /* v831: visibility/pageshow/focus recovery — no One Tap prompts.
       Returning to the PWA after 2FA simply triggers a Firebase Auth
       state re-check; if Google's iframe completed the credential
       hand-off while we were hidden, onAuthStateChanged will fire and
       the auth listener in 17-comments-auth-init.js routes into the app. */
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    window.addEventListener('pageshow', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    /* Also listen to onAuthStateChanged so we can dismiss the hint instantly
       when sign-in completes through ANY path (GIS, popup, redirect). */
    if (window.firebase?.auth) {
      try {
        firebase.auth().onAuthStateChanged(user => {
          if (user) {
            hideSignInHint();
            hideSigningInOverlay();
            signInAttemptStartedAt = 0;
            /* v831: clear any in-flight sign-in flag set by legacy flows
               so a subsequent sign-out + sign-in isn't blocked. */
            try { window.googleSignInInProgress = false; } catch (_) {}
          }
        });
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* Expose internals for debugging */
  window.__shelfdGis = {
    isConfigured: isClientIdConfigured,
    isStandalonePWA,
    init: initGisLibrary,
    render: renderGisButton,
    handle: handleCredentialResponse
  };
})();
