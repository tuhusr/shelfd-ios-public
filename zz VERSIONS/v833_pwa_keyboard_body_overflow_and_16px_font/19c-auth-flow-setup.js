/* =============================================================================
   19c-auth-flow-setup.js — v804
   ─────────────────────────────────────────────────────────────────────────────
   New full-page auth + onboarding flow for Shelfd.

     Sign In       → #shelfd-signin-page
     Reset Pwd     → #shelfd-reset-page    (opens from Sign In)
     Create Acct   → #shelfd-signup-page
     Setup         → #shelfd-setup-page    (3 steps: nickname → photo → welcome)

   Replaces the landing-page email-auth UX. The old #login-email-page tabbed
   panel still ships in HTML for safety but is no longer wired to any
   landing-page button.

   User-doc fields written by this flow (collection: users/{uid}):
     uid, emailLower, accountEmailLower
     usernameHandle (original case), usernameHandleLower (case-insensitive)
     name (= nickname), nameLower, customName
     photo (base64 data URI), customPhoto
     onboardingComplete : boolean
     onboardingStep    : 1 | 2 | 3 (only while !onboardingComplete; deleted on finish)
     createdAt, updatedAt (server timestamps)

   Username uniqueness uses the existing usernames/{usernameLower} doc-id
   collection (already wired in 19b). Same Firestore rule applies.

   Routing gate:
     window.__shelfdSignupInProgress     — set true while this file owns the
                                          post-auth flow (signup → setup);
                                          17-comments-auth-init.js skips its
                                          render/route while this is true.
     window.__shelfdAuthOnboardingGate(user) — returns true if the user has
                                          not yet finished setup (e.g. refresh
                                          mid-onboarding); 17 then skips
                                          render and lets this file open
                                          the setup flow at the saved step.
   ============================================================================= */
(function() {
  'use strict';

  /* ───────── Constants ───────── */
  const USERNAME_RE = /^[a-zA-Z0-9_]{6,20}$/;
  const MIN_PASSWORD_LEN = 8;
  const NICKNAME_MAX = 40;
  const POST_SUCCESS_CLOSE_MS = 220;

  /* ───────── State ───────── */
  const busy = {
    signin: false, reset: false, signup: false,
    verifyContinue: false, verifyResend: false,
    setupUsername: false, setupPhoto: false, setupFinish: false
  };
  let setupChosenPhotoBase64 = '';
  const OPEN_PANEL_STACK = [];

  /* ───────── DOM helpers ───────── */
  const $ = (id) => document.getElementById(id);
  function setBanner(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    if (text) {
      el.hidden = false;
      el.dataset.kind = kind || '';
    } else {
      el.hidden = true;
      el.dataset.kind = '';
    }
  }

  /* ───────── Validation ───────── */
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }
  function isValidUsername(value) {
    return USERNAME_RE.test(String(value || '').trim());
  }

  /* ───────── Friendly Firebase error mapping ───────── */
  function mapAuthError(err, fallback) {
    /* v815: Firestore quota errors can surface through this path too. */
    if (typeof isResourceExhausted === 'function' && isResourceExhausted(err)) {
      return 'Signup is temporarily busy. Please try again in a few minutes.';
    }
    const code = err && err.code;
    switch (code) {
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a few minutes and try again.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
        return "That email and password don't match an account.";
      case 'auth/email-already-in-use':
        return 'An account already exists for that email. Try signing in instead.';
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/weak-password':
        return 'Password too weak. Use at least ' + MIN_PASSWORD_LEN + ' characters with letters and numbers.';
      case 'auth/operation-not-allowed':
        return 'Email sign-up is not enabled.';
      default:
        return fallback || 'Something went wrong. Try again.';
    }
  }

  /* ───────── Slide-up panel open/close ─────────
     Stack-based so that opening Reset over Sign In and then closing Reset
     reveals Sign In underneath without re-triggering any state.

     v833: stopped applying `overflow: hidden` to <body> when a panel
     opens. iOS WKWebView in installed PWA standalone mode silently
     refuses to raise the soft keyboard for inputs that live inside a
     `position: fixed` child when the document body is scroll-locked
     via `overflow: hidden`. The panel itself is fixed + inset:0 so
     the underlying landing screen can't scroll behind it anyway — the
     body lock was just a belt that strangled the keyboard. */
  function openPanel(id) {
    const el = $(id);
    if (!el) return false;
    el.setAttribute('aria-hidden', 'false');
    /* rAF so the transform transition kicks in cleanly from translateY(100%) */
    requestAnimationFrame(() => el.classList.add('is-open'));
    document.body.classList.add('shelfd-auth-page-open');
    if (!OPEN_PANEL_STACK.includes(id)) OPEN_PANEL_STACK.push(id);
    return true;
  }
  function closePanel(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    const idx = OPEN_PANEL_STACK.indexOf(id);
    if (idx >= 0) OPEN_PANEL_STACK.splice(idx, 1);
    if (!OPEN_PANEL_STACK.length) {
      document.body.classList.remove('shelfd-auth-page-open');
    }
  }
  function closeAllPanels() {
    OPEN_PANEL_STACK.slice().forEach(closePanel);
  }

  /* ───────── Eye toggles ───────── */
  function bindEyeToggles() {
    document.querySelectorAll('.shelfd-auth-eye').forEach(btn => {
      if (btn.__shelfdBound) return;
      btn.__shelfdBound = true;
      btn.addEventListener('click', () => {
        const id = btn.dataset.pwfield;
        const input = id ? $(id) : null;
        if (!input) return;
        const on = btn.querySelector('.shelfd-auth-eye-on');
        const off = btn.querySelector('.shelfd-auth-eye-off');
        if (input.type === 'password') {
          input.type = 'text';
          if (on) on.hidden = true;
          if (off) off.hidden = false;
        } else {
          input.type = 'password';
          if (on) on.hidden = false;
          if (off) off.hidden = true;
        }
      });
    });
  }

  /* ───────── Username live hint (v816: setup step 1 field) ─────────
     Pure local format check — letters/numbers/underscores, 6–20 chars.
     NO Firestore call on keystroke. Reservation happens once on submit. */
  function bindUsernameHint() {
    const field = $('shelfd-setup-username');
    const hint = $('shelfd-setup-username-hint');
    if (!field || !hint || field.__shelfdHintBound) return;
    field.__shelfdHintBound = true;
    field.addEventListener('input', () => {
      const v = field.value.trim();
      if (!v) {
        hint.textContent = 'Letters, numbers, and underscores only.';
        hint.dataset.kind = '';
      } else if (!isValidUsername(v)) {
        hint.textContent = 'Username must be 6–20 chars: letters, numbers, underscore only.';
        hint.dataset.kind = 'error';
      } else {
        hint.textContent = 'Looks good.';
        hint.dataset.kind = 'ok';
      }
    });
  }

  /* ───────── Per-form busy state ─────────
     Prevents double-submit + swaps button label to "…" while pending. */
  function setBusy(which, state) {
    busy[which] = !!state;
    const submitId =
      which === 'signin'         ? 'shelfd-signin-submit' :
      which === 'reset'          ? 'shelfd-reset-submit' :
      which === 'signup'         ? 'shelfd-signup-submit' :
      which === 'verifyContinue' ? 'shelfd-verify-continue' :
      which === 'verifyResend'   ? 'shelfd-verify-resend' :
      which === 'setupUsername'  ? 'shelfd-setup-username-next' :
      which === 'setupPhoto'     ? 'shelfd-setup-photo-next' :
                                   null;
    const btn = submitId ? $(submitId) : null;
    if (!btn) return;
    btn.disabled = !!state;
    if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;
    btn.textContent = state ? '…' : btn.dataset.originalLabel;
  }

  /* ════════════════════════════════════════════════════════════════════════
     SIGN IN
     ════════════════════════════════════════════════════════════════════════ */
  function openShelfdSignInPage() {
    setBanner($('shelfd-signin-error'), '');
    if ($('shelfd-signin-email')) $('shelfd-signin-email').value = '';
    if ($('shelfd-signin-password')) $('shelfd-signin-password').value = '';
    /* Reset any password-visibility toggles to hidden */
    const pw = $('shelfd-signin-password');
    if (pw) pw.type = 'password';
    openPanel('shelfd-signin-page');
    setTimeout(() => { try { $('shelfd-signin-email').focus(); } catch(_){} }, 80);
  }
  function closeShelfdSignInPage() { closePanel('shelfd-signin-page'); }

  async function handleSigninSubmit(e) {
    e.preventDefault();
    if (busy.signin) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setBanner($('shelfd-signin-error'), 'Sign-in service is loading — try again in a moment.', 'error');
      return;
    }
    const email = String($('shelfd-signin-email').value || '').trim();
    const password = String($('shelfd-signin-password').value || '');
    if (!isValidEmail(email)) {
      setBanner($('shelfd-signin-error'), 'Please enter a valid email address.', 'error');
      return;
    }
    if (!password) {
      setBanner($('shelfd-signin-error'), 'Please enter your password.', 'error');
      return;
    }
    setBusy('signin', true);
    setBanner($('shelfd-signin-error'), '');
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      /* onAuthStateChanged in 17-comments-auth-init.js handles routing.
         Slide the panel down after a short tick so the shell-swap doesn't
         fight the slide-down animation. */
      setTimeout(() => closeShelfdSignInPage(), POST_SUCCESS_CLOSE_MS);
    } catch (err) {
      console.warn('[shelfd-auth] sign-in failed:', err && err.code);
      setBanner($('shelfd-signin-error'), mapAuthError(err, 'Could not sign in. Try again.'), 'error');
    } finally {
      setBusy('signin', false);
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     RESET PASSWORD
     ════════════════════════════════════════════════════════════════════════ */
  function openShelfdResetPage() {
    setBanner($('shelfd-reset-error'), '');
    setBanner($('shelfd-reset-message'), '');
    /* Pre-fill from the sign-in field if it's email-shaped */
    const reset = $('shelfd-reset-email');
    const signin = $('shelfd-signin-email');
    if (reset && !reset.value && signin && isValidEmail(signin.value)) {
      reset.value = signin.value.trim();
    }
    openPanel('shelfd-reset-page');
    setTimeout(() => { try { $('shelfd-reset-email').focus(); } catch(_){} }, 80);
  }
  /* Closing reset reveals the Sign In panel underneath (which stayed open). */
  function closeShelfdResetPage() { closePanel('shelfd-reset-page'); }

  async function handleResetSubmit(e) {
    e.preventDefault();
    if (busy.reset) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setBanner($('shelfd-reset-error'), 'Reset service is loading — try again in a moment.', 'error');
      return;
    }
    const email = String($('shelfd-reset-email').value || '').trim();
    if (!isValidEmail(email)) {
      setBanner($('shelfd-reset-error'), 'Please enter a valid email address.', 'error');
      return;
    }
    setBusy('reset', true);
    setBanner($('shelfd-reset-error'), '');
    setBanner($('shelfd-reset-message'), '');
    try {
      await firebase.auth().sendPasswordResetEmail(email);
    } catch (err) {
      console.warn('[shelfd-auth] reset send result:', err && err.code);
      const code = err && err.code;
      if (code === 'auth/network-request-failed') {
        setBanner($('shelfd-reset-error'), 'Network error. Check your connection and try again.', 'error');
        setBusy('reset', false); return;
      }
      if (code === 'auth/too-many-requests') {
        setBanner($('shelfd-reset-error'), 'Too many requests. Try again in a few minutes.', 'error');
        setBusy('reset', false); return;
      }
      /* Otherwise fall through to the generic confirmation — no enumeration. */
    }
    setBanner(
      $('shelfd-reset-message'),
      'If an account exists for that email, we sent a reset link. Check your inbox (and spam).',
      'success'
    );
    setBusy('reset', false);
  }

  /* ════════════════════════════════════════════════════════════════════════
     CREATE ACCOUNT
     ════════════════════════════════════════════════════════════════════════ */
  function openShelfdSignUpPage() {
    setBanner($('shelfd-signup-error'), '');
    /* v816: username removed from the initial form; clear only email + pw. */
    ['shelfd-signup-email','shelfd-signup-password','shelfd-signup-confirm'].forEach(id => {
      const el = $(id); if (el) el.value = '';
    });
    /* Reset password visibility */
    ['shelfd-signup-password','shelfd-signup-confirm'].forEach(id => {
      const el = $(id); if (el) el.type = 'password';
    });
    openPanel('shelfd-signup-page');
    setTimeout(() => { try { $('shelfd-signup-email').focus(); } catch(_){} }, 80);
  }
  function closeShelfdSignUpPage() { closePanel('shelfd-signup-page'); }

  /* v805: do NOT pre-check username uniqueness before auth.
     The unauthenticated read on usernames/{key} hits Firestore rules first
     and (if denied) silently returned "not taken" — which let signup proceed
     and orphaned the Auth account when the post-auth batch then also got
     denied. Uniqueness is now enforced inside a post-auth transaction; the
     "already exists" check happens with the user's own credentials. */

  /* Map specific Firestore errors to friendly messages. Firestore SDK throws
     with err.code === 'permission-denied' on rule rejection. */
  function isPermissionDenied(err) {
    if (!err) return false;
    if (err.code === 'permission-denied') return true;
    if (err.code === 'PERMISSION_DENIED') return true;
    /* compat SDK occasionally formats as 'firestore/permission-denied' */
    if (typeof err.code === 'string' && /permission[-_]denied/i.test(err.code)) return true;
    if (typeof err.message === 'string' && /Missing or insufficient permissions/i.test(err.message)) return true;
    return false;
  }

  /* v815: Firestore quota / rate-limit detection.
     resource-exhausted (gRPC status 8) is thrown when the project hits its
     daily Spark-tier quota OR when a single document is being written too
     fast (sustained ~1 write/sec/doc cap). We surface a clean "try again"
     message and skip any further Firestore writes (including cleanup) so
     we don't deepen the quota hole — Auth cleanup still runs because it
     uses a separate Identity Toolkit quota. */
  function isResourceExhausted(err) {
    if (!err) return false;
    if (err.code === 'resource-exhausted') return true;
    if (err.code === 'RESOURCE_EXHAUSTED') return true;
    if (typeof err.code === 'string' && /resource[-_]exhausted/i.test(err.code)) return true;
    if (typeof err.message === 'string' && /(resource.exhausted|quota.exceeded|too.many)/i.test(err.message)) return true;
    return false;
  }
  function quotaUserMessage() {
    return 'Signup is temporarily busy. Please try again in a few minutes.';
  }

  /* ─── Required rules (printed verbatim into the dev console on any
         permission-denied during signup) ────────────────────────────── */
  const REQUIRED_RULES_SNIPPET =
    "match /users/{uid} {\n" +
    "  allow read: if isSignedIn() || isCreatorPreviewUid(uid);\n" +
    "  allow write: if isSignedIn() && request.auth.uid == uid;\n" +
    "}\n" +
    "match /usernames/{usernameLower} {\n" +
    "  // v805: minimal public-safe handle index.\n" +
    "  allow read: if isSignedIn();\n" +
    "  allow create: if isSignedIn()\n" +
    "                && request.auth.uid == request.resource.data.uid\n" +
    "                && request.resource.data.keys().hasOnly(['uid', 'username', 'createdAt']);\n" +
    "  // Usernames are permanent — never let anyone overwrite or delete them.\n" +
    "  allow update, delete: if false;\n" +
    "}\n" +
    "match /meta/{docId} {\n" +
    "  // v805: registered-user counter; public read for the landing-page stat.\n" +
    "  allow read: if true;\n" +
    "  allow write: if isSignedIn();\n" +
    "}\n";

  function logRuleHint(failingPath, operation) {
    console.error(
      '[shelfd-auth] PERMISSION DENIED\n' +
      '  Path:      `' + failingPath + '`\n' +
      '  Operation: ' + operation + '\n' +
      '  Firebase Console → Firestore Database → Rules tab. Paste these rules\n' +
      '  alongside your existing matches inside `match /databases/{database}/documents`:\n\n' +
      REQUIRED_RULES_SNIPPET
    );
  }

  /* Cleanly roll back a partially-completed signup so we don't leave the
     account in a half-built state. Best-effort: each step is wrapped in
     its own try/catch and never throws. */
  async function cleanupSignupOrphan(createdUser, userRef, userDocCreated) {
    if (userDocCreated && userRef) {
      try { await userRef.delete(); }
      catch (e) { console.warn('[shelfd-auth] cleanup: users/{uid} delete failed:', e && e.code, e && e.message); }
    }
    if (createdUser) {
      try { await createdUser.delete(); }
      catch (e) { console.warn('[shelfd-auth] cleanup: Auth user delete failed:', e && e.code, e && e.message); }
    }
  }

  /* v816 — Continue URL Firebase redirects to after the user clicks the
     verification link in their email. The domain (myscreenlist.com) must
     be added to Firebase Console → Authentication → Settings →
     Authorized domains for this to work. */
  const SHELFD_VERIFY_CONTINUE_URL = 'https://myscreenlist.com/auth/verify';

  function getVerificationActionCodeSettings() {
    return {
      url: SHELFD_VERIFY_CONTINUE_URL,
      handleCodeInApp: false
    };
  }

  /* v816 — Email-only Create Account.
     The username field has been removed from this screen. Signup now
     just creates the Firebase Auth account and sends the verification
     email. Username reservation + user-doc creation are deferred to
     setup step 1 (which only opens after emailVerified === true), so
     Firestore is not touched at all during initial signup. */
  async function handleSignupSubmit(e) {
    e.preventDefault();
    if (busy.signup) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setBanner($('shelfd-signup-error'), 'Sign-up service is loading — try again in a moment.', 'error');
      return;
    }
    const email = String($('shelfd-signup-email').value || '').trim();
    const password = String($('shelfd-signup-password').value || '');
    const confirm = String($('shelfd-signup-confirm').value || '');

    if (!isValidEmail(email)) {
      setBanner($('shelfd-signup-error'), 'Please enter a valid email address.', 'error');
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      setBanner($('shelfd-signup-error'), 'Password must be at least ' + MIN_PASSWORD_LEN + ' characters.', 'error');
      return;
    }
    if (password !== confirm) {
      setBanner($('shelfd-signup-error'), "Passwords don't match.", 'error');
      return;
    }

    setBusy('signup', true);
    setBanner($('shelfd-signup-error'), '');

    let createdUser = null;
    let signupFlagOwned = false;

    try {
      /* Suppress 17's normal auth-state routing while the signup handler
         is still in flight. Cleared at the end so the auth-state listener
         can then route the now-unverified user to the verify screen. */
      window.__shelfdSignupInProgress = true;
      signupFlagOwned = true;

      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      createdUser = cred && cred.user;
      if (!createdUser) throw new Error('No user returned from Firebase');

      /* Send verification email with continue URL back to /auth/verify.
         Errors here are non-fatal — the user lands on the verify page
         and can tap "Resend verification email" if the first send fails. */
      try {
        await createdUser.sendEmailVerification(getVerificationActionCodeSettings());
      } catch (sendErr) {
        console.warn('[shelfd-auth] initial sendEmailVerification failed (will retry on resend):', sendErr && sendErr.code, sendErr);
      }

      /* Stash the email so the verify page can display it. */
      try { window.__shelfdPendingVerifyEmail = email; } catch (_) {}

      /* Hand off to the verify screen. The flag is cleared inside open()
         so the auth-state listener (which fired in parallel) re-runs its
         gate and lands the user here too if anything raced. */
      openShelfdVerifyPage({ email: email });
      setTimeout(() => closeShelfdSignUpPage(), POST_SUCCESS_CLOSE_MS);
    } catch (err) {
      console.warn('[shelfd-auth] sign-up failed:', err && err.code, err);
      if (signupFlagOwned) window.__shelfdSignupInProgress = false;

      if (isResourceExhausted(err)) {
        setBanner($('shelfd-signup-error'), quotaUserMessage(), 'error');
      } else if (err && err.code === 'auth/email-already-in-use') {
        setBanner($('shelfd-signup-error'), 'An account already exists with this email. Try signing in.', 'error');
      } else {
        setBanner($('shelfd-signup-error'), mapAuthError(err, 'Could not create account. Try again.'), 'error');
      }
    } finally {
      setBusy('signup', false);
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     v816 — VERIFY EMAIL PAGE
     ════════════════════════════════════════════════════════════════════════ */
  function openShelfdVerifyPage(opts) {
    const settings = opts || {};
    const emailDisplay = $('shelfd-verify-email-display');
    if (emailDisplay) {
      const e =
        settings.email ||
        (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.email) ||
        '';
      emailDisplay.textContent = e || 'your inbox';
    }
    setBanner($('shelfd-verify-error'), '');
    setBanner($('shelfd-verify-message'), '');
    /* Free the auth-state listener so subsequent gates can route, then
       open the panel. */
    window.__shelfdSignupInProgress = false;
    /* Hide login + app shell so the verify panel owns the screen. */
    const appContainer = document.getElementById('app-container');
    const loginScreen = document.getElementById('login-screen');
    if (appContainer) appContainer.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'none';
    openPanel('shelfd-verify-page');
  }
  function closeShelfdVerifyPage() { closePanel('shelfd-verify-page'); }
  function handleShelfdVerifyBack() {
    /* Back from verify screen = sign out (the only reasonable escape for
       an unverified account — otherwise we'd just send them right back). */
    closeShelfdVerifyPage();
    try { if (typeof firebase !== 'undefined' && firebase.auth) firebase.auth().signOut(); } catch (_) {}
    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.style.display = 'none';
    if (loginScreen) loginScreen.style.display = '';
  }

  async function handleShelfdResendVerification() {
    if (busy.verifyResend) return;
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const user = firebase.auth().currentUser;
    if (!user) {
      setBanner($('shelfd-verify-error'), 'You are signed out. Please sign in or create an account again.', 'error');
      return;
    }
    setBusy('verifyResend', true);
    setBanner($('shelfd-verify-error'), '');
    setBanner($('shelfd-verify-message'), '');
    try {
      await user.sendEmailVerification(getVerificationActionCodeSettings());
      setBanner($('shelfd-verify-message'), 'Verification email sent. Check your inbox and spam folder.', 'success');
    } catch (err) {
      console.warn('[shelfd-auth] resend verification failed:', err && err.code, err);
      if (err && err.code === 'auth/too-many-requests') {
        setBanner($('shelfd-verify-error'), 'Too many resend attempts. Try again in a few minutes.', 'error');
      } else if (err && err.code === 'auth/network-request-failed') {
        setBanner($('shelfd-verify-error'), 'Network error. Check your connection and try again.', 'error');
      } else {
        setBanner($('shelfd-verify-error'), 'Could not send verification email. Try again in a moment.', 'error');
      }
    } finally {
      setBusy('verifyResend', false);
    }
  }

  async function handleShelfdVerifyContinue() {
    if (busy.verifyContinue) return;
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const user = firebase.auth().currentUser;
    if (!user) {
      setBanner($('shelfd-verify-error'), 'You are signed out. Please sign in or create an account again.', 'error');
      return;
    }
    setBusy('verifyContinue', true);
    setBanner($('shelfd-verify-error'), '');
    setBanner($('shelfd-verify-message'), '');
    try {
      /* Reload the user from Firebase so emailVerified reflects whatever
         happened server-side after the user clicked the email link. */
      await user.reload();
      const fresh = firebase.auth().currentUser;
      if (fresh && fresh.emailVerified) {
        /* Verified — close the verify page and open setup step 1 (username).
           No user doc / username reservation has happened yet; both are
           written when the user submits the username step. */
        closeShelfdVerifyPage();
        openShelfdSetupPage(1, {});
      } else {
        setBanner($('shelfd-verify-error'), 'Please verify your email first. Open the link we sent you, then come back.', 'error');
      }
    } catch (err) {
      console.warn('[shelfd-auth] verify reload failed:', err && err.code, err);
      if (isResourceExhausted(err)) {
        setBanner($('shelfd-verify-error'), 'Service is busy. Try again in a few minutes.', 'error');
      } else {
        setBanner($('shelfd-verify-error'), 'Could not check verification. Try again in a moment.', 'error');
      }
    } finally {
      setBusy('verifyContinue', false);
    }
  }

  /* v816 — Return-from-verification-link auto-detect.
     When the user clicks the Firebase verification link in their email,
     Firebase verifies server-side and then redirects to our continue URL
     (/auth/verify). On that path, auto-reload the current user and route
     them straight into setup if emailVerified is now true. Works in both
     mobile Safari and PWA. */
  async function handleVerificationReturn() {
    try {
      const path = (window.location && window.location.pathname) || '';
      if (path !== '/auth/verify') return;
      if (typeof firebase === 'undefined' || !firebase.auth) return;
      const user = firebase.auth().currentUser;
      if (!user) {
        /* Not signed in on this device — just route to landing so they
           can sign in; their email is verified server-side now. */
        try { window.history.replaceState({}, '', '/'); } catch (_) {}
        return;
      }
      try { await user.reload(); } catch (_) {}
      const fresh = firebase.auth().currentUser;
      /* Clean up the URL so refreshing doesn't keep re-triggering this. */
      try { window.history.replaceState({}, '', '/'); } catch (_) {}
      if (fresh && fresh.emailVerified) {
        closeShelfdVerifyPage();
        openShelfdSetupPage(1, {});
      }
    } catch (e) {
      console.warn('[shelfd-auth] handleVerificationReturn failed:', e);
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     SETUP FLOW (3 steps)
     ════════════════════════════════════════════════════════════════════════ */
  function openShelfdSetupPage(step = 1, opts = {}) {
    const settings = opts || {};
    /* Take over the screen — hide the landing screen and the app shell so
       the only thing visible is the setup overlay. Both are restored when
       setup finishes (or on browser refresh, since the panel is in the
       fixed-position layer). */
    const appContainer = document.getElementById('app-container');
    const loginScreen = document.getElementById('login-screen');
    if (appContainer) appContainer.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'none';

    const root = $('shelfd-setup-page');
    if (!root) return;

    /* Reset chosen photo on each open (we re-read from user doc if needed) */
    setupChosenPhotoBase64 = '';
    const preview = $('shelfd-setup-photo-preview');
    if (preview) preview.innerHTML = '<span class="shelfd-setup-photo-placeholder">Tap to choose</span>';
    const photoNext = $('shelfd-setup-photo-next');
    if (photoNext) photoNext.disabled = true;

    /* v816: step 1 is now USERNAME, not nickname. */
    setBanner($('shelfd-setup-username-error'), '');
    setBanner($('shelfd-setup-photo-error'), '');
    const usernameHint = $('shelfd-setup-username-hint');
    if (usernameHint) { usernameHint.textContent = 'Letters, numbers, and underscores only.'; usernameHint.dataset.kind = ''; }
    const usernameField = $('shelfd-setup-username');
    if (usernameField && settings.usernameDefault && !usernameField.value) {
      usernameField.value = settings.usernameDefault;
    }

    setSetupStep(step);
    openPanel('shelfd-setup-page');
    if (step === 1) {
      setTimeout(() => { try { $('shelfd-setup-username').focus(); } catch(_){} }, 80);
    }
  }

  function setSetupStep(step) {
    const root = $('shelfd-setup-page');
    if (!root) return;
    const n = step === 2 ? 2 : step === 3 ? 3 : 1;
    root.setAttribute('data-step', String(n));
    root.querySelectorAll('[data-setup-step]').forEach(el => {
      el.hidden = Number(el.dataset.setupStep) !== n;
    });
  }

  function closeShelfdSetupPage(opts) {
    const settings = opts || {};
    closePanel('shelfd-setup-page');
    if (settings.routeToApp) {
      const appContainer = document.getElementById('app-container');
      const loginScreen = document.getElementById('login-screen');
      if (loginScreen) loginScreen.style.display = 'none';
      if (appContainer) appContainer.style.display = 'block';
      /* Resume the normal post-auth render path */
      try {
        if (typeof setDefaultMyListsWatchingView === 'function') setDefaultMyListsWatchingView();
        if (typeof render === 'function') render();
      } catch (e) {
        console.warn('[shelfd-auth] post-setup render failed:', e);
      }
    }
  }

  /* ── Step 1 — Username (v816) ──
     Reserves usernames/{usernameLower} AND creates the initial users/{uid}
     doc with onboardingComplete:false / onboardingStep:2 / themeMode:'true-dark'.
     This is the *first* Firestore write of the entire signup flow — all
     prior steps (Create Account + email verification) are pure Auth API
     calls, which keeps Firestore quota usage low and the resource-exhausted
     surface small. */
  async function handleShelfdUsernameSetupNext() {
    if (busy.setupUsername) return;
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) {
      setBanner($('shelfd-setup-username-error'), 'Service is loading — try again in a moment.', 'error');
      return;
    }
    const user = firebase.auth().currentUser;
    if (!user) {
      setBanner($('shelfd-setup-username-error'), 'You are signed out. Please sign in again.', 'error');
      return;
    }
    /* Defense in depth — username step should only be reachable after
       email verification, but double-check here. */
    if (!user.emailVerified) {
      setBanner($('shelfd-setup-username-error'), 'Please verify your email first.', 'error');
      try { closeShelfdSetupPage(); } catch (_) {}
      openShelfdVerifyPage({ email: user.email });
      return;
    }

    const username = String($('shelfd-setup-username').value || '').trim();
    if (!isValidUsername(username)) {
      setBanner($('shelfd-setup-username-error'), 'Username must be 6–20 chars: letters, numbers, underscore only. No spaces or special characters.', 'error');
      return;
    }

    setBusy('setupUsername', true);
    setBanner($('shelfd-setup-username-error'), '');
    const usernameLower = username.toLowerCase();
    const emailLower = String((user.email || '')).toLowerCase();
    const db = firebase.firestore();
    const usernameRef = db.collection('usernames').doc(usernameLower);
    const userRef = db.collection('users').doc(user.uid);

    /* ── 1. Reserve username — single CREATE-or-fail write. Same approach
            as v815: rule enforces uniqueness via "create vs update"
            semantics (allow create, update/delete: if false). */
    try {
      await usernameRef.set({
        uid: user.uid,
        username: username,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (uErr) {
      if (isResourceExhausted(uErr)) {
        console.error('[shelfd-auth] resource-exhausted on username reservation', uErr);
        setBusy('setupUsername', false);
        setBanner($('shelfd-setup-username-error'), quotaUserMessage(), 'error');
        return;
      }
      if (isPermissionDenied(uErr)) {
        /* Disambiguate: doc exists (taken) vs rule misconfigured. */
        let alreadyExists = false;
        try {
          const snap = await usernameRef.get();
          alreadyExists = !!snap.exists;
        } catch (probeErr) {
          if (isResourceExhausted(probeErr)) {
            setBusy('setupUsername', false);
            setBanner($('shelfd-setup-username-error'), quotaUserMessage(), 'error');
            return;
          }
        }
        if (alreadyExists) {
          setBusy('setupUsername', false);
          setBanner($('shelfd-setup-username-error'), 'Username is already taken.', 'error');
          return;
        }
        console.error('[shelfd-auth] usernames reservation FAILED (rule issue)', uErr);
        logRuleHint('usernames/' + usernameLower, 'CREATE (set)');
        setBusy('setupUsername', false);
        setBanner($('shelfd-setup-username-error'),
          "Couldn't reserve your username — database rules are blocking the `usernames` collection. See console for the exact rule the admin needs to paste.",
          'error');
        return;
      }
      console.error('[shelfd-auth] usernames reservation FAILED', uErr);
      setBusy('setupUsername', false);
      setBanner($('shelfd-setup-username-error'),
        'Could not reserve your username. Please try again. (code: ' + ((uErr && uErr.code) || 'unknown') + ')',
        'error');
      return;
    }

    /* ── 2. Create the initial user/profile doc. We arrive here only when
            username reservation succeeded, so the usernameHandle field on
            this doc is guaranteed to correspond to a real reservation. */
    try {
      await userRef.set({
        uid: user.uid,
        emailLower: emailLower,
        accountEmailLower: emailLower,
        usernameHandle: username,
        usernameHandleLower: usernameLower,
        name: username,
        nameLower: usernameLower,
        customName: username,
        /* v813 — body.true-dark-mode → modern Shelfd UI. */
        themeMode: 'true-dark',
        onboardingComplete: false,
        onboardingStep: 2,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (userErr) {
      console.error('[shelfd-auth] users/{uid} write FAILED after username reservation', userErr);
      setBusy('setupUsername', false);
      if (isResourceExhausted(userErr)) {
        setBanner($('shelfd-setup-username-error'), quotaUserMessage(), 'error');
        return;
      }
      if (isPermissionDenied(userErr)) {
        logRuleHint('users/' + user.uid, 'WRITE (set with merge)');
        setBanner($('shelfd-setup-username-error'),
          "Couldn't save your profile — database rules are blocking writes to `users/{uid}`. See console for the exact rule the admin needs to paste.",
          'error');
        return;
      }
      setBanner($('shelfd-setup-username-error'),
        'Could not save your profile. Please try again. (code: ' + ((userErr && userErr.code) || 'unknown') + ')',
        'error');
      return;
    }

    /* Best-effort: set displayName on the Auth user + in-memory profile. */
    try { await user.updateProfile({ displayName: username }); } catch (_) {}
    try {
      if (window.userProfile) {
        window.userProfile.name = username;
        window.userProfile.usernameHandle = username;
      }
      if (typeof window.applyProfile === 'function') window.applyProfile();
    } catch (_) {}

    setBusy('setupUsername', false);
    setSetupStep(2);
  }

  /* ── Step 2 — Photo ──
     Same pattern as handleProfileUpload in 15-profile-settings.js: read the
     file with FileReader, decode into <img>, draw center-cropped square at
     256×256 onto canvas, base64-encode as JPEG q=0.78. Store as a data URI
     in the user doc (same as the rest of the app). */
  function bindSetupPhotoInput() {
    const input = $('shelfd-setup-photo-input');
    const preview = $('shelfd-setup-photo-preview');
    if (!input || input.__shelfdBound) return;
    input.__shelfdBound = true;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setBanner($('shelfd-setup-photo-error'), '');
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            const min = Math.min(img.width, img.height);
            const sx = (img.width - min) / 2;
            const sy = (img.height - min) / 2;
            ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
            setupChosenPhotoBase64 = canvas.toDataURL('image/jpeg', 0.78);
            if (preview) preview.innerHTML = '<img alt="Preview" src="' + setupChosenPhotoBase64 + '">';
            const next = $('shelfd-setup-photo-next');
            if (next) next.disabled = false;
          } catch (err) {
            console.warn('[shelfd-auth] photo decode failed:', err);
            setBanner($('shelfd-setup-photo-error'), "Couldn't process that image. Try a different file.", 'error');
          }
        };
        img.onerror = () => {
          setBanner($('shelfd-setup-photo-error'), "Couldn't read that image. Try a different file.", 'error');
        };
        img.src = e.target.result;
      };
      reader.onerror = () => {
        setBanner($('shelfd-setup-photo-error'), "Couldn't read that file.", 'error');
      };
      reader.readAsDataURL(file);
    });
    /* Tap on preview also opens the picker */
    if (preview && !preview.__shelfdBound) {
      preview.__shelfdBound = true;
      preview.addEventListener('click', () => input.click());
      preview.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); }
      });
    }
  }

  async function shelfdSetupSavePhoto() {
    if (busy.setupPhoto) return;
    if (!setupChosenPhotoBase64) { setSetupStep(3); return; }
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const user = firebase.auth().currentUser;
    if (!user) {
      setBanner($('shelfd-setup-photo-error'), 'You are signed out. Please sign in again.', 'error');
      return;
    }
    setBusy('setupPhoto', true);
    setBanner($('shelfd-setup-photo-error'), '');
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(user.uid).set({
        photo: setupChosenPhotoBase64,
        customPhoto: setupChosenPhotoBase64,
        onboardingStep: 3,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      try {
        if (window.userProfile) window.userProfile.photo = setupChosenPhotoBase64;
        if (typeof window.applyProfile === 'function') window.applyProfile();
      } catch (_) {}
      setSetupStep(3);
    } catch (err) {
      console.warn('[shelfd-auth] save photo failed:', err);
      setBanner($('shelfd-setup-photo-error'), 'Could not save. Try again.', 'error');
    } finally {
      setBusy('setupPhoto', false);
    }
  }

  async function shelfdSetupSkipPhoto() {
    if (busy.setupPhoto) return;
    if (typeof firebase === 'undefined' || !firebase.auth) { setSetupStep(3); return; }
    const user = firebase.auth().currentUser;
    if (!user) { setSetupStep(3); return; }
    setBusy('setupPhoto', true);
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(user.uid).set({
        onboardingStep: 3,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.warn('[shelfd-auth] skip photo step failed:', err);
    } finally {
      setBusy('setupPhoto', false);
      setSetupStep(3);
    }
  }

  /* ── Step 3 — Welcome / finish ── */
  async function shelfdSetupFinish() {
    if (busy.setupFinish) return;
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const user = firebase.auth().currentUser;
    if (!user) return;
    busy.setupFinish = true;
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(user.uid).set({
        onboardingComplete: true,
        onboardingStep: firebase.firestore.FieldValue.delete(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.warn('[shelfd-auth] finish setup failed:', err);
      /* Don't trap the user — proceed to the app even if the flag write
         glitched; we'll write it again next time saveUserProfile runs. */
    } finally {
      busy.setupFinish = false;
      window.__shelfdSignupInProgress = false;
      closeShelfdSetupPage({ routeToApp: true });
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     AUTH-STATE GATE (v816)
     Called by 17-comments-auth-init.js right before render() / route to
     My Lists. If the user is mid-onboarding OR unverified, this returns
     true and opens the appropriate screen; the caller skips its render.

     v816 routing matrix:
       email/password user, !emailVerified  → verify page
       email/password user, emailVerified, no user doc → setup step 1 (username)
       any user, onboardingComplete === false → setup at saved step
       Google user, no user doc → return false (saveUserProfile creates doc)
       any user, onboardingComplete === true (or missing) → return false → My Lists
     ════════════════════════════════════════════════════════════════════════ */
  function isEmailPasswordUser(user) {
    try {
      const providers = (user && user.providerData) || [];
      return providers.some(p => p && p.providerId === 'password');
    } catch (_) { return false; }
  }

  async function authOnboardingGate(user) {
    if (!user) return false;
    /* v816: email/password users must verify before anything else. Google
       users come back with emailVerified=true and skip this gate. */
    if (isEmailPasswordUser(user) && !user.emailVerified) {
      openShelfdVerifyPage({ email: user.email });
      return true;
    }
    if (typeof firebase === 'undefined' || !firebase.firestore) return false;
    try {
      const snap = await firebase.firestore().collection('users').doc(user.uid).get();
      const data = snap.exists ? (snap.data() || {}) : null;

      /* v816: brand-new verified email/password user with no Firestore
         doc yet → push them to setup step 1 (username) so the username
         reservation + initial user-doc write happen there. Google users
         hit this branch the first time too, but they don't have anything
         to set up — we let saveUserProfile create their doc as usual and
         then continue to My Lists, so only gate email/password users. */
      if (!data) {
        if (isEmailPasswordUser(user)) {
          openShelfdSetupPage(1, {});
          return true;
        }
        return false;
      }

      if (data.onboardingComplete === false) {
        const step = (data.onboardingStep === 2 || data.onboardingStep === 3) ? data.onboardingStep : 1;
        openShelfdSetupPage(step, {});
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[shelfd-auth] onboarding gate failed:', err);
      /* On gate failure (e.g. transient Firestore error), let the normal
         flow continue rather than soft-locking the user out. */
      return false;
    }
  }
  window.__shelfdAuthOnboardingGate = authOnboardingGate;

  /* ════════════════════════════════════════════════════════════════════════
     Bootstrap
     ════════════════════════════════════════════════════════════════════════ */
  function start() {
    bindEyeToggles();
    bindUsernameHint();
    bindSetupPhotoInput();
    const sf = $('shelfd-signin-form');
    if (sf && !sf.__shelfdBound) { sf.__shelfdBound = true; sf.addEventListener('submit', handleSigninSubmit); }
    const rf = $('shelfd-reset-form');
    if (rf && !rf.__shelfdBound) { rf.__shelfdBound = true; rf.addEventListener('submit', handleResetSubmit); }
    const cf = $('shelfd-signup-form');
    if (cf && !cf.__shelfdBound) { cf.__shelfdBound = true; cf.addEventListener('submit', handleSignupSubmit); }
    /* v816: if the user just landed on /auth/verify from the Firebase
       verification link, auto-reload + advance once Firebase Auth has
       finished restoring the current user. */
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged(() => { handleVerificationReturn(); });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* ════════════════════════════════════════════════════════════════════════
     Public API (inline onclick handlers in index.html call into these)
     ════════════════════════════════════════════════════════════════════════ */
  window.openShelfdSignInPage = openShelfdSignInPage;
  window.closeShelfdSignInPage = closeShelfdSignInPage;
  window.openShelfdResetPage = openShelfdResetPage;
  window.closeShelfdResetPage = closeShelfdResetPage;
  window.openShelfdSignUpPage = openShelfdSignUpPage;
  window.closeShelfdSignUpPage = closeShelfdSignUpPage;
  window.openShelfdSetupPage = openShelfdSetupPage;
  /* v816: verification page + new username step handlers */
  window.openShelfdVerifyPage = openShelfdVerifyPage;
  window.closeShelfdVerifyPage = closeShelfdVerifyPage;
  window.handleShelfdVerifyBack = handleShelfdVerifyBack;
  window.handleShelfdVerifyContinue = handleShelfdVerifyContinue;
  window.handleShelfdResendVerification = handleShelfdResendVerification;
  window.handleShelfdUsernameSetupNext = handleShelfdUsernameSetupNext;
  /* Back-compat shim — old code/tests still calling the nickname handler
     get routed to the new username submit. */
  window.shelfdSetupNicknameNext = handleShelfdUsernameSetupNext;
  window.shelfdSetupSavePhoto = shelfdSetupSavePhoto;
  window.shelfdSetupSkipPhoto = shelfdSetupSkipPhoto;
  window.shelfdSetupFinish = shelfdSetupFinish;
})();
