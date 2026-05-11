/* =============================================================================
   19-gis-signin.js  (v634)
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
     - Patches window.signIn() so any other entry-point that calls signIn()
       (e.g. preview mode's CTA) also routes through GIS One Tap.
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
    /* v747: render at GIS's max native width (400px). The previous wrapper
       transform: scale(1.18) was removed because it blurred the iframe's
       pixel-perfect rendering on Retina displays. 400px native is a
       proper primary-CTA size on its own. */
    return 400;
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
        /* v636: auto_select=true → returning users with a recent Google
           credential get instantly signed in by the One Tap prompt with a
           single tap (or zero taps if FedCM is happy). First-time users
           still see the visible GIS button. */
        auto_select: true,
        cancel_on_tap_outside: false,
        itp_support: true,           /* Safari ITP support */
        use_fedcm_for_prompt: true,  /* iOS 17+ / Chrome FedCM */
        ux_mode: 'popup'             /* never redirect — keeps us in the PWA */
      });
      gisInitialized = true;
    } catch (err) {
      console.error('GIS initialize failed:', err);
    }
  }

  /* ---------- v636: Auto One Tap on login screen + visibility recovery ---------- */
  let oneTapAttempted = false;
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

  function tryOneTap(opts = {}) {
    if (!gisInitialized) return;
    if (!window.google?.accounts?.id) return;
    if (isFirebaseSignedIn()) return;
    /* GIS will only show the prompt if the user has a recent Google session
       in this browser. If not, the prompt is silently skipped — no visible
       interruption. */
    try {
      google.accounts.id.prompt(notification => {
        if (!notification) return;
        /* If One Tap was suppressed by FedCM / cookies / no session, that's
           fine — the visible GIS button is still there. We track it for
           debugging. */
        const skipped = (notification.isNotDisplayed?.() || notification.isSkippedMoment?.());
        if (skipped && opts.onSkip) opts.onSkip(notification);
      });
      oneTapAttempted = true;
    } catch (e) {
      console.warn('[GIS] prompt failed:', e);
    }
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
      Verified in another app? Tap inside the Google popup to refresh.
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
      signInAttemptStartedAt = 0;
      return;
    }
    if (!isLoginScreenVisible()) return;

    /* v636: Recovery path. If the user was mid-sign-in and switched to
       Gmail/Authenticator/etc to do 2FA, returning to the PWA tickles GIS
       so its iframe wakes up and re-checks Google's backend. We also
       re-prompt One Tap as a belt-and-suspenders nudge. */
    const stalled = signInAttemptStartedAt && (Date.now() - signInAttemptStartedAt > 6000);

    /* Re-prompt to wake any frozen polling */
    setTimeout(() => {
      if (!isFirebaseSignedIn() && isLoginScreenVisible()) {
        tryOneTap();
      }
    }, 350);

    /* If they've been at it for >6s and still aren't signed in, surface a
       hint so the "Resend code" / "tap the popup" trick is discoverable. */
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

  /* ---------- Patch signIn() to route through GIS One Tap when possible ---------- */
  function patchSignIn() {
    if (typeof window === 'undefined') return;
    const original = window.signIn;
    if (typeof original !== 'function' || original.__gisPatched) return;
    const wrapped = function() {
      if (gisInitialized && window.google?.accounts?.id) {
        try {
          /* Mark a sign-in attempt has started so visibility recovery has a
             timestamp to compare against. */
          trackPossibleSignInStart();
          /* Show the One Tap card. If user has signed in to Google already
             on this browser, this offers a one-tap completion. If not, we
             still rely on the visible GIS button. */
          google.accounts.id.prompt(notification => {
            /* If One Tap can't show (FedCM declined, no Google session, etc.),
               fall back to the legacy popup/redirect flow so user isn't stuck. */
            if (notification && (notification.isNotDisplayed?.() || notification.isSkippedMoment?.())) {
              try { original.apply(window, arguments); } catch (_) {}
            }
          });
          return;
        } catch (e) {
          console.warn('GIS prompt failed, falling back:', e);
        }
      }
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

  /* ---------- Bootstrap ---------- */
  function start() {
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
        /* v636: Auto-attempt One Tap on first load. If the user has a recent
           Google session in this browser, they get a "Continue as [name]"
           card within ~1s and a single tap signs them in. If they don't,
           the visible GIS button is still there — no interruption. */
        setTimeout(() => {
          if (isLoginScreenVisible()) tryOneTap();
        }, 600);
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

    /* v636: visibility-change recovery + blur tracking */
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    /* Also listen to onAuthStateChanged so we can dismiss the hint instantly
       when sign-in completes through ANY path (GIS, popup, redirect). */
    if (window.firebase?.auth) {
      try {
        firebase.auth().onAuthStateChanged(user => {
          if (user) {
            hideSignInHint();
            signInAttemptStartedAt = 0;
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
