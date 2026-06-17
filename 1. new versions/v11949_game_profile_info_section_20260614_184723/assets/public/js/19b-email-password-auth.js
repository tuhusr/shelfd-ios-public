/* =============================================================================
   19b-email-password-auth.js  (v751 — full rebuild)
   ────────────────────────────────────────────────────────────────────────────
   Three independent forms:
     SIGN IN    — Username-or-email + password (+ reset link)
     CREATE     — Username + email + password + confirm
     RESET      — Email only (reachable via the "Reset password" link)

   Username login architecture
   ─────────────────────────────────────────────────────────────────────
   Firebase Auth only knows email+password. To support username login
   we maintain a Firestore collection `usernames/{usernameLowercase}`
   whose docs hold `{ email, uid, createdAt }`.
     - Sign in: if input contains '@' → treat as email and try directly.
       Otherwise look up usernames/{input.toLowerCase()}, read the email,
       sign in with that.
     - Create: validate the username, check the doc doesn't exist yet,
       create the Firebase Auth user, then write the username doc.
       (NOT a transaction yet — race window is microseconds and rules
       enforce non-existence on the create.)

   Required Firestore rule (you must paste this into Console):
     match /usernames/{username} {
       allow read: if true;
       allow create: if request.auth != null
                     && request.auth.uid == request.resource.data.uid;
       allow update, delete: if false;
     }

   Security choices
   ─────────────────────────────────────────────────────────────────────
   - Generic sign-in error (no enumeration): `auth/user-not-found`,
     `auth/wrong-password`, `auth/invalid-credential`, AND missing
     username doc all map to the same message.
   - Generic reset confirmation: even when Firebase says
     `auth/user-not-found`, we surface the success message.
   - Min password length 12, must contain a letter and a digit.
   - Username regex: ^[a-z0-9._]{1,30}$. User input is normalized lowercase
     for the doc id). Display name on the user is the original case.
   - Email-verification email is sent on signup. Firestore writes that
     require `request.auth.token.email_verified == true` will be added
     in a separate session.

   Things this DOES NOT do (queued for later sessions):
     - Cloudflare Worker that rate-limits username->email lookups.
     - App Check / reCAPTCHA Enterprise.
     - Account deletion.
   ========================================================================== */
(function() {
  'use strict';

  /* ---------- Constants ---------- */
  const MIN_PASSWORD_LEN = 12;
  /* v10.988: universal username rule — 1-30 characters, only
     letters/numbers/periods/underscores. */
  const USERNAME_RE = /^[a-z0-9._]{1,30}$/;
  const SHELFD_VERIFY_CONTINUE_URL = 'https://myshelfd.com/auth/verify?source=email';
  const GENERIC_SIGNIN_ERROR = "That username/email and password don't match an account.";
  const GENERIC_RESET_CONFIRM = 'If an account exists for that email, we sent a reset link. Check your inbox (and spam).';

  /* ---------- State ---------- */
  let currentMode = 'signin';     /* 'signin' | 'signup' */
  let inResetView = false;
  let busy = { signin: false, signup: false, reset: false };

  /* ---------- DOM helpers ---------- */
  const $ = (id) => document.getElementById(id);
  function showEl(el) { if (el) { el.hidden = false; el.style.removeProperty('display'); } }
  function hideEl(el) { if (el) { el.hidden = true; el.style.display = 'none'; } }
  function setMessage(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    if (text) showEl(el); else hideEl(el);
    el.dataset.kind = kind || '';
  }

  /* ---------- Validation ---------- */
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }
  function looksLikeEmail(value) {
    return String(value || '').includes('@');
  }
  function isValidUsername(value) {
    /* Universal rule is the regex alone — min 1, max 30, only
       letters/numbers/periods/underscores. */
    const clean = String(value || '').trim();
    return USERNAME_RE.test(clean);
  }
  function sanitizeUsernameInput(value) {
    return String(value || '')
      .replace(/^@+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9._]/g, '')
      .slice(0, 30);
  }
  function validateUsernameModeration(value) {
    const moderator = window.ShelfdUsernameModeration;
    if (!moderator || typeof moderator.validateUsernameContent !== 'function') return { allowed: true };
    return moderator.validateUsernameContent(value);
  }
  function usernameModerationMessage() {
    return window.ShelfdUsernameModeration?.message || 'This username is not allowed. Please choose another one.';
  }
  function passwordStrength(pw) {
    const s = String(pw || '');
    if (!s) return { score: 0, label: '' };
    const len = s.length;
    const hasLower = /[a-z]/.test(s);
    const hasUpper = /[A-Z]/.test(s);
    const hasDigit = /\d/.test(s);
    const hasSymbol = /[^A-Za-z0-9]/.test(s);
    if (len < MIN_PASSWORD_LEN || !hasDigit || (!hasLower && !hasUpper)) {
      return { score: 1, label: 'Too weak' };
    }
    if (len >= 16 && hasLower && hasUpper && hasDigit && hasSymbol) {
      return { score: 4, label: 'Strong' };
    }
    if (len >= 14 || (hasLower && hasUpper && hasDigit && hasSymbol)) {
      return { score: 3, label: 'Good' };
    }
    return { score: 2, label: 'Fair' };
  }
  function meetsPasswordPolicy(pw) {
    return passwordStrength(pw).score >= 2;
  }

  function getVerificationActionCodeSettings() {
    return {
      url: SHELFD_VERIFY_CONTINUE_URL,
      handleCodeInApp: false
    };
  }

  /* ---------- Mode toggle (signin <-> signup) ---------- */
  function setMode(mode) {
    currentMode = mode === 'signup' ? 'signup' : 'signin';
    if (inResetView) returnFromResetView();
    document.querySelectorAll('.login-email-tab').forEach(btn => {
      const active = btn.dataset.mode === currentMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    /* Three independent forms — show only the active one. */
    const signinForm = $('login-email-signin-form');
    const signupForm = $('login-email-signup-form');
    if (currentMode === 'signup') {
      hideEl(signinForm);
      showEl(signupForm);
    } else {
      showEl(signinForm);
      hideEl(signupForm);
    }
    /* Update page title to reflect mode */
    const title = $('login-email-page-title');
    if (title) title.textContent = currentMode === 'signup' ? 'Create your account' : 'Welcome back';
    /* Clear any stale messages on tab switch */
    setMessage($('login-email-signin-error'), '');
    setMessage($('login-email-signin-message'), '');
    setMessage($('login-email-signup-error'), '');
    setMessage($('login-email-signup-message'), '');
  }

  /* ---------- Show / hide password toggle ---------- */
  function bindShowPasswordToggles() {
    document.querySelectorAll('.login-email-show-toggle').forEach(btn => {
      if (btn.__shelfdBound) return;
      btn.__shelfdBound = true;
      btn.addEventListener('click', () => {
        const id = btn.dataset.pwfield;
        const input = id ? document.getElementById(id) : null;
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'Hide';
        } else {
          input.type = 'password';
          btn.textContent = 'Show';
        }
      });
    });
  }

  /* ---------- Strength meter (signup only) ---------- */
  function updateStrengthMeter() {
    const pwField = $('login-email-signup-password');
    const fill = $('login-email-signup-strength-fill');
    const label = $('login-email-signup-strength-label');
    if (!pwField || !fill || !label) return;
    const result = passwordStrength(pwField.value);
    const pct = (result.score / 4) * 100;
    fill.style.width = pct + '%';
    fill.dataset.score = String(result.score);
    label.textContent = pwField.value
      ? (result.label || 'Password strength')
      : 'Password strength';
  }

  /* ---------- Username live hint ---------- */
  function updateUsernameHint() {
    const field = $('login-email-signup-username');
    const hint = $('login-email-username-hint');
    if (!field || !hint) return;
    const cleaned = sanitizeUsernameInput(field.value);
    if (field.value !== cleaned) field.value = cleaned;
    const v = cleaned.trim();
    if (!v) {
      hint.textContent = 'Must be 1-30 characters. Letters, numbers, periods, and underscores only.';
      hint.dataset.kind = '';
    } else if (!isValidUsername(v)) {
      hint.dataset.kind = 'error';
      hint.textContent = 'Username must be 1-30 characters and can only use letters, numbers, periods, and underscores.';
    } else if (!validateUsernameModeration(v).allowed) {
      hint.dataset.kind = 'error';
      hint.textContent = usernameModerationMessage();
    } else {
      hint.textContent = 'Looks good.';
      hint.dataset.kind = 'ok';
    }
  }

  /* ---------- Fullscreen page open / close ---------- */
  function openLoginEmailPage(mode) {
    const page = $('login-email-page');
    if (!page) return;
    /* Same scroll-restore pattern as openLoginTermsPage — store y so closing
       returns to where the user was on the landing page. */
    const scrollY = window.scrollY || window.pageYOffset || 0;
    page.dataset.returnScrollY = String(scrollY);
    page.style.display = 'block';
    document.body.style.overflow = 'hidden';
    page.scrollTop = 0;
    /* Reset view always cancelled on open. */
    if (inResetView) returnFromResetView();
    /* Open directly to whichever tab the button specified. */
    setMode(mode === 'signup' ? 'signup' : 'signin');
    /* Auto-focus the first field for the active mode. */
    setTimeout(() => {
      const first = mode === 'signup'
        ? $('login-email-signup-username')
        : $('login-email-signin-id');
      if (first) try { first.focus(); } catch (_) {}
    }, 60);
  }
  function closeLoginEmailPage() {
    /* Smart back: if user is in the reset view, "Back" returns them to
       sign-in instead of closing the page. */
    if (inResetView) {
      returnFromResetView();
      return;
    }
    const page = $('login-email-page');
    if (!page) return;
    const scrollY = Number(page.dataset.returnScrollY || 0);
    page.style.display = 'none';
    document.body.style.overflow = '';
    /* Clear any leftover error / message text so it doesn't flash on next open */
    setMessage($('login-email-signin-error'), '');
    setMessage($('login-email-signup-error'), '');
    setMessage($('login-email-reset-error'), '');
    setMessage($('login-email-signin-message'), '');
    setMessage($('login-email-signup-message'), '');
    setMessage($('login-email-reset-message'), '');
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    });
  }
  /* Expose for inline onclick handlers in index.html */
  window.openLoginEmailPage = openLoginEmailPage;
  window.closeLoginEmailPage = closeLoginEmailPage;

  /* ---------- Tabs ---------- */
  function bindTabs() {
    document.querySelectorAll('.login-email-tab').forEach(btn => {
      if (btn.__shelfdBound) return;
      btn.__shelfdBound = true;
      btn.addEventListener('click', () => setMode(btn.dataset.mode || 'signin'));
    });
  }

  /* ---------- Reset view swap ----------
     Reset view is its own clean screen — tabs hidden, title swapped to
     "Reset password", only the email + submit visible. The Back button
     at the top of the page becomes context-aware (returns to sign-in
     instead of closing). */
  function enterResetView() {
    inResetView = true;
    hideEl($('login-email-signin-form'));
    hideEl($('login-email-signup-form'));
    hideEl($('login-email-tabs-host'));   /* hide Sign in / Create tabs */
    showEl($('login-email-reset-form'));
    const title = $('login-email-page-title');
    if (title) title.textContent = 'Reset password';
    setMessage($('login-email-reset-error'), '');
    setMessage($('login-email-reset-message'), '');
    /* Pre-fill if the sign-in field has an email-shaped value */
    const signinField = $('login-email-signin-id');
    const reset = $('login-email-reset-input');
    if (signinField && reset && !reset.value) {
      const v = signinField.value || '';
      if (looksLikeEmail(v)) reset.value = v;
    }
    /* Auto-focus the email field for instant typing */
    setTimeout(() => {
      if (reset) try { reset.focus(); } catch (_) {}
    }, 40);
  }
  function returnFromResetView() {
    inResetView = false;
    hideEl($('login-email-reset-form'));
    showEl($('login-email-tabs-host'));
    /* Restore the form for whichever tab is currently active, plus the
       title that goes with it. */
    if (currentMode === 'signup') {
      showEl($('login-email-signup-form'));
    } else {
      showEl($('login-email-signin-form'));
    }
    const title = $('login-email-page-title');
    if (title) title.textContent = currentMode === 'signup' ? 'Create your account' : 'Welcome back';
    setMessage($('login-email-reset-error'), '');
    setMessage($('login-email-reset-message'), '');
  }

  function bindForgotLinks() {
    document.querySelectorAll('[data-action="forgot"]').forEach(btn => {
      if (btn.__shelfdBound) return;
      btn.__shelfdBound = true;
      btn.addEventListener('click', enterResetView);
    });
    document.querySelectorAll('[data-action="cancel-reset"]').forEach(btn => {
      if (btn.__shelfdBound) return;
      btn.__shelfdBound = true;
      btn.addEventListener('click', returnFromResetView);
    });
  }

  /* ---------- Username -> email lookup ---------- */
  async function lookupEmailForUsername(username) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return null;
    const key = String(username || '').trim().toLowerCase();
    if (!key) return null;
    try {
      const snap = await firebase.firestore().collection('usernames').doc(key).get();
      if (!snap.exists) return null;
      const email = snap.get('email');
      return typeof email === 'string' ? email : null;
    } catch (e) {
      console.warn('[email-auth] username lookup failed:', e);
      return null;
    }
  }
  async function isUsernameTaken(username) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return false;
    const key = String(username || '').trim().toLowerCase();
    if (!key) return false;
    try {
      const snap = await firebase.firestore().collection('usernames').doc(key).get();
      return !!snap.exists;
    } catch (e) {
      console.warn('[email-auth] username availability check failed:', e);
      return false;
    }
  }

  /* ---------- Submit handlers ---------- */
  async function handleSigninSubmit(event) {
    event.preventDefault();
    if (busy.signin) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setMessage($('login-email-signin-error'), 'Sign-in service is loading — try again in a moment.', 'error');
      return;
    }
    const id = String(($('login-email-signin-id') ? $('login-email-signin-id').value : '')).trim();
    const password = ($('login-email-signin-password') ? $('login-email-signin-password').value : '') || '';
    if (!id) {
      setMessage($('login-email-signin-error'), 'Please enter your username or email.', 'error');
      return;
    }
    if (!password) {
      setMessage($('login-email-signin-error'), 'Please enter your password.', 'error');
      return;
    }

    setBusy('signin', true, 'Signing in…');
    setMessage($('login-email-signin-error'), '');
    try {
      let email = id;
      if (!looksLikeEmail(id)) {
        /* Username path — look up the email. */
        const found = await lookupEmailForUsername(id);
        if (!found) {
          /* SECURITY: don't differentiate "no such username" from "wrong
             password". Same generic message either way. */
          setMessage($('login-email-signin-error'), GENERIC_SIGNIN_ERROR, 'error');
          setBusy('signin', false);
          return;
        }
        email = found;
      }
      await firebase.auth().signInWithEmailAndPassword(email, password);
      collapsePanelOnSuccess();
    } catch (err) {
      console.warn('[email-auth] sign-in failed:', err && err.code);
      const code = err && err.code;
      if (code === 'auth/too-many-requests') {
        setMessage($('login-email-signin-error'),
          'Too many failed attempts. Wait a few minutes and try again.',
          'error');
      } else if (code === 'auth/network-request-failed') {
        setMessage($('login-email-signin-error'),
          'Network error. Check your connection and try again.',
          'error');
      } else if (code === 'auth/user-disabled') {
        setMessage($('login-email-signin-error'),
          'This account has been disabled.',
          'error');
      } else {
        setMessage($('login-email-signin-error'), GENERIC_SIGNIN_ERROR, 'error');
      }
    } finally {
      setBusy('signin', false);
    }
  }

  async function handleSignupSubmit(event) {
    event.preventDefault();
    if (busy.signup) return;
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) {
      setMessage($('login-email-signup-error'), 'Sign-up service is loading — try again in a moment.', 'error');
      return;
    }
    const usernameField = $('login-email-signup-username');
    const username = sanitizeUsernameInput(usernameField ? usernameField.value : '');
    if (usernameField && usernameField.value !== username) usernameField.value = username;
    const email = String(($('login-email-signup-email') ? $('login-email-signup-email').value : '')).trim();
    const password = ($('login-email-signup-password') ? $('login-email-signup-password').value : '') || '';
    const confirm = ($('login-email-signup-confirm') ? $('login-email-signup-confirm').value : '') || '';
    if (!isValidUsername(username)) {
      setMessage($('login-email-signup-error'),
        'Username must be 1-30 characters and can only use letters, numbers, periods, and underscores.',
        'error');
      return;
    }
    if (!validateUsernameModeration(username).allowed) {
      setMessage($('login-email-signup-error'), usernameModerationMessage(), 'error');
      return;
    }

    /* Hard validation gates BEFORE we hit Firebase quota. */
    if (!isValidEmail(email)) {
      setMessage($('login-email-signup-error'), 'Please enter a valid email address.', 'error');
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      setMessage($('login-email-signup-error'),
        'Password must be at least ' + MIN_PASSWORD_LEN + ' characters.',
        'error');
      return;
    }
    if (!meetsPasswordPolicy(password)) {
      setMessage($('login-email-signup-error'),
        'Password needs at least one letter and one number.',
        'error');
      return;
    }
    if (password !== confirm) {
      setMessage($('login-email-signup-error'), "Passwords don't match.", 'error');
      return;
    }

    setBusy('signup', true, 'Creating account…');
    setMessage($('login-email-signup-error'), '');
    try {
      /* Check username availability first. There's a tiny race window
         between this check and the doc write below, but the Firestore
         rule will reject duplicate creates so worst case is one user
         sees an error and tries again. */
      const taken = await isUsernameTaken(username);
      if (taken) {
        setMessage($('login-email-signup-error'),
          'That username is taken. Try another.',
          'error');
        setBusy('signup', false);
        return;
      }

      try {
        if (typeof window.resetShelfdActiveAccountState === 'function') {
          window.resetShelfdActiveAccountState('pre-legacy-email-signup', '');
        }
      } catch (resetErr) {
        console.warn('[email-auth] pre-signup state reset failed:', resetErr);
      }

      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = cred && cred.user;
      if (!user) throw new Error('No user returned from Firebase');
      console.info('[email-auth] createUserWithEmailAndPassword complete', {
        createdUid: user.uid,
        authCurrentUid: firebase.auth().currentUser?.uid || '',
        email: user.email || email
      });
      window.__shelfdAuthUidDebug = {
        stage: 'legacyCreateUserWithEmailAndPassword',
        createdUid: user.uid,
        authCurrentUid: firebase.auth().currentUser?.uid || '',
        email: user.email || email,
        at: new Date().toISOString()
      };

      /* Set displayName on the Firebase user (original case preserved). */
      try { await user.updateProfile({ displayName: username }); }
      catch (e) { console.warn('[email-auth] updateProfile failed (non-fatal):', e); }

      /* Write the username -> email mapping doc.
         Doc id is lowercased for case-insensitive lookup. */
      try {
        await firebase.firestore()
          .collection('usernames')
          .doc(username.toLowerCase())
          .set({
            email: email,
            uid: user.uid,
            usernameDisplay: username,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
      } catch (e) {
        console.error('[email-auth] usernames doc write failed:', e);
        /* Username doc didn't write but the auth account exists. Surface
           a recoverable message — they can still sign in by email. */
        setMessage($('login-email-signup-error'),
          'Account created but we could not reserve your username. You can still sign in with your email; please contact support to claim the username.',
          'error');
      }

      try { await user.sendEmailVerification(getVerificationActionCodeSettings()); }
      catch (e) { console.warn('[email-auth] sendEmailVerification failed (non-fatal):', e); }

      setMessage($('login-email-signup-message'),
        'Account created. We sent a verification link to ' + email + '.',
        'success');
      collapsePanelOnSuccess();
    } catch (err) {
      console.warn('[email-auth] sign-up failed:', err && err.code);
      const code = err && err.code;
      if (code === 'auth/email-already-in-use') {
        setMessage($('login-email-signup-error'),
          'An account already exists for this email. Try signing in instead.',
          'error');
      } else if (code === 'auth/invalid-email') {
        setMessage($('login-email-signup-error'), 'That email address looks invalid.', 'error');
      } else if (code === 'auth/weak-password') {
        setMessage($('login-email-signup-error'),
          'Password too weak. Use at least ' + MIN_PASSWORD_LEN + ' characters with letters and numbers.',
          'error');
      } else if (code === 'auth/network-request-failed') {
        setMessage($('login-email-signup-error'),
          'Network error. Check your connection and try again.',
          'error');
      } else if (code === 'auth/operation-not-allowed') {
        setMessage($('login-email-signup-error'),
          'Email sign-up is not enabled. Contact the developer.',
          'error');
      } else {
        setMessage($('login-email-signup-error'),
          'Could not create account. Try again in a moment.',
          'error');
      }
    } finally {
      setBusy('signup', false);
    }
  }

  async function handleResetSubmit(event) {
    event.preventDefault();
    if (busy.reset) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setMessage($('login-email-reset-error'), 'Reset service is loading — try again in a moment.', 'error');
      return;
    }
    const email = String(($('login-email-reset-input') ? $('login-email-reset-input').value : '')).trim();
    if (!isValidEmail(email)) {
      setMessage($('login-email-reset-error'), 'Please enter a valid email address.', 'error');
      return;
    }
    setBusy('reset', true, 'Sending…');
    setMessage($('login-email-reset-error'), '');
    setMessage($('login-email-reset-message'), '');
    try {
      await firebase.auth().sendPasswordResetEmail(email);
    } catch (err) {
      /* Generic confirmation regardless of code (except network/rate-limit). */
      console.warn('[email-auth] reset send result:', err && err.code);
      if (err && err.code === 'auth/network-request-failed') {
        setMessage($('login-email-reset-error'),
          'Network error. Check your connection and try again.',
          'error');
        setBusy('reset', false);
        return;
      }
      if (err && err.code === 'auth/too-many-requests') {
        setMessage($('login-email-reset-error'),
          'Too many requests. Try again in a few minutes.',
          'error');
        setBusy('reset', false);
        return;
      }
    }
    setMessage($('login-email-reset-message'), GENERIC_RESET_CONFIRM, 'success');
    setBusy('reset', false);
  }

  /* ---------- Busy state per-form ---------- */
  function setBusy(which, state, label) {
    busy[which] = !!state;
    const id = which === 'signin' ? 'login-email-signin-submit'
            : which === 'signup' ? 'login-email-signup-submit'
            : 'login-email-reset-submit';
    const submit = $(id);
    if (!submit) return;
    submit.disabled = !!state;
    if (state) {
      if (!submit.dataset.originalLabel) submit.dataset.originalLabel = submit.textContent;
      if (label) submit.textContent = label;
    } else {
      if (submit.dataset.originalLabel) submit.textContent = submit.dataset.originalLabel;
    }
  }

  function collapsePanelOnSuccess() {
    /* v752: close the fullscreen overlay so the user lands on the
       authenticated app shell that onAuthStateChanged already swapped in. */
    setTimeout(() => {
      const page = $('login-email-page');
      if (page) {
        page.style.display = 'none';
        document.body.style.overflow = '';
      }
    }, 600);
  }

  /* ---------- Bootstrap ---------- */
  function start() {
    /* v752: gate is now the new fullscreen overlay page, not the inline
       section that used to live on the landing. */
    if (!$('login-email-page')) return;
    bindTabs();
    bindShowPasswordToggles();
    bindForgotLinks();

    const signinForm = $('login-email-signin-form');
    if (signinForm && !signinForm.__shelfdBound) {
      signinForm.__shelfdBound = true;
      signinForm.addEventListener('submit', handleSigninSubmit);
    }
    const signupForm = $('login-email-signup-form');
    if (signupForm && !signupForm.__shelfdBound) {
      signupForm.__shelfdBound = true;
      signupForm.addEventListener('submit', handleSignupSubmit);
    }
    const resetForm = $('login-email-reset-form');
    if (resetForm && !resetForm.__shelfdBound) {
      resetForm.__shelfdBound = true;
      resetForm.addEventListener('submit', handleResetSubmit);
    }

    const pwField = $('login-email-signup-password');
    if (pwField && !pwField.__shelfdStrengthBound) {
      pwField.__shelfdStrengthBound = true;
      pwField.addEventListener('input', updateStrengthMeter);
    }
    const usernameField = $('login-email-signup-username');
    if (usernameField && !usernameField.__shelfdHintBound) {
      usernameField.__shelfdHintBound = true;
      usernameField.addEventListener('input', updateUsernameHint);
    }

    setMode('signin');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.__shelfdEmailAuth = {
    setMode,
    enterResetView,
    returnFromResetView,
    passwordStrength,
    isValidUsername,
    lookupEmailForUsername,
    isUsernameTaken
  };
})();
