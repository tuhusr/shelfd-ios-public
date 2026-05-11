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
    setupNick: false, setupPhoto: false, setupFinish: false
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
     reveals Sign In underneath without re-triggering any state. */
  function openPanel(id) {
    const el = $(id);
    if (!el) return false;
    el.setAttribute('aria-hidden', 'false');
    /* rAF so the transform transition kicks in cleanly from translateY(100%) */
    requestAnimationFrame(() => el.classList.add('is-open'));
    document.body.classList.add('shelfd-auth-page-open');
    document.body.style.overflow = 'hidden';
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
      document.body.style.overflow = '';
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

  /* ───────── Username live hint ───────── */
  function bindUsernameHint() {
    const field = $('shelfd-signup-username');
    const hint = $('shelfd-signup-username-hint');
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
      which === 'signin'      ? 'shelfd-signin-submit' :
      which === 'reset'       ? 'shelfd-reset-submit' :
      which === 'signup'      ? 'shelfd-signup-submit' :
      which === 'setupNick'   ? 'shelfd-setup-nickname-next' :
      which === 'setupPhoto'  ? 'shelfd-setup-photo-next' :
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
    ['shelfd-signup-username','shelfd-signup-email','shelfd-signup-password','shelfd-signup-confirm'].forEach(id => {
      const el = $(id); if (el) el.value = '';
    });
    /* Reset username hint */
    const hint = $('shelfd-signup-username-hint');
    if (hint) { hint.textContent = 'Letters, numbers, and underscores only.'; hint.dataset.kind = ''; }
    /* Reset password visibility */
    ['shelfd-signup-password','shelfd-signup-confirm'].forEach(id => {
      const el = $(id); if (el) el.type = 'password';
    });
    openPanel('shelfd-signup-page');
    setTimeout(() => { try { $('shelfd-signup-username').focus(); } catch(_){} }, 80);
  }
  function closeShelfdSignUpPage() { closePanel('shelfd-signup-page'); }

  async function isUsernameTaken(username) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return false;
    const key = String(username || '').trim().toLowerCase();
    if (!key) return false;
    try {
      const snap = await firebase.firestore().collection('usernames').doc(key).get();
      return !!snap.exists;
    } catch (e) {
      console.warn('[shelfd-auth] username availability check failed:', e);
      return false;
    }
  }

  async function handleSignupSubmit(e) {
    e.preventDefault();
    if (busy.signup) return;
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) {
      setBanner($('shelfd-signup-error'), 'Sign-up service is loading — try again in a moment.', 'error');
      return;
    }
    const username = String($('shelfd-signup-username').value || '').trim();
    const email = String($('shelfd-signup-email').value || '').trim();
    const password = String($('shelfd-signup-password').value || '');
    const confirm = String($('shelfd-signup-confirm').value || '');

    if (!isValidUsername(username)) {
      setBanner($('shelfd-signup-error'), 'Username must be 6–20 chars: letters, numbers, underscore only. No spaces or special characters.', 'error');
      return;
    }
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
    try {
      const taken = await isUsernameTaken(username);
      if (taken) {
        setBanner($('shelfd-signup-error'), 'That username is taken. Try another.', 'error');
        setBusy('signup', false);
        return;
      }
      /* Tell 17's auth state listener: signup is in progress, leave routing
         to us. Cleared on error here, on auth-page close, and on setup finish. */
      window.__shelfdSignupInProgress = true;

      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = cred && cred.user;
      if (!user) throw new Error('No user returned from Firebase');

      /* Best-effort: set displayName on the Auth user. The nickname step will
         overwrite this with the user's chosen display name. */
      try { await user.updateProfile({ displayName: username }); } catch (_) {}

      const usernameLower = username.toLowerCase();
      const emailLower = email.toLowerCase();
      const db = firebase.firestore();

      /* Reserve username doc + create user doc with onboardingComplete:false.
         Both writes commit together via batch. */
      const batch = db.batch();
      batch.set(db.collection('usernames').doc(usernameLower), {
        email: email,
        uid: user.uid,
        usernameDisplay: username,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.set(db.collection('users').doc(user.uid), {
        uid: user.uid,
        emailLower: emailLower,
        accountEmailLower: emailLower,
        usernameHandle: username,
        usernameHandleLower: usernameLower,
        onboardingComplete: false,
        onboardingStep: 1,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await batch.commit();

      /* Now bring the user doc up to full schema (themeMode, ratingPrefs,
         pinnedFavorites, etc.) and bump the registered-user counter.
         This is exactly what saveUserProfile does for Google sign-ins; we
         just need to call it explicitly because 17's listener was suppressed
         by __shelfdSignupInProgress. */
      try {
        if (typeof window.saveUserProfile === 'function') {
          await window.saveUserProfile(user);
        } else if (typeof saveUserProfile === 'function') {
          await saveUserProfile(user);
        }
      } catch (e) {
        console.warn('[shelfd-auth] saveUserProfile during signup failed (non-fatal):', e);
      }

      /* Open setup flow at step 1 with the username pre-filled as a sensible
         nickname default (user can change). */
      openShelfdSetupPage(1, { nicknameDefault: username });
      setTimeout(() => closeShelfdSignUpPage(), POST_SUCCESS_CLOSE_MS);
    } catch (err) {
      console.warn('[shelfd-auth] sign-up failed:', err && err.code, err);
      window.__shelfdSignupInProgress = false;
      setBanner($('shelfd-signup-error'), mapAuthError(err, 'Could not create account. Try again.'), 'error');
    } finally {
      setBusy('signup', false);
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     SETUP FLOW (3 steps)
     ════════════════════════════════════════════════════════════════════════ */
  function openShelfdSetupPage(step = 1, opts = {}) {
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

    setBanner($('shelfd-setup-nickname-error'), '');
    setBanner($('shelfd-setup-photo-error'), '');

    /* Pre-fill nickname when arriving from signup (or from existing user doc on resume) */
    const nickField = $('shelfd-setup-nickname');
    if (nickField) {
      if (opts.nicknameDefault && !nickField.value) {
        nickField.value = opts.nicknameDefault;
      } else if (!nickField.value && firebase && firebase.auth) {
        const u = firebase.auth().currentUser;
        const fallback = (u && (u.displayName || '')) || '';
        if (fallback) nickField.value = fallback;
      }
    }

    setSetupStep(step);
    openPanel('shelfd-setup-page');
    if (step === 1) {
      setTimeout(() => { try { $('shelfd-setup-nickname').focus(); } catch(_){} }, 80);
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

  /* ── Step 1 — Nickname ── */
  async function shelfdSetupNicknameNext() {
    if (busy.setupNick) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setBanner($('shelfd-setup-nickname-error'), 'Service is loading — try again in a moment.', 'error');
      return;
    }
    const user = firebase.auth().currentUser;
    if (!user) {
      setBanner($('shelfd-setup-nickname-error'), 'You are signed out. Please sign in again.', 'error');
      return;
    }
    const nickname = String($('shelfd-setup-nickname').value || '').trim();
    if (!nickname || nickname.length > NICKNAME_MAX) {
      setBanner($('shelfd-setup-nickname-error'), 'Please enter a nickname (1–' + NICKNAME_MAX + ' characters).', 'error');
      return;
    }
    setBusy('setupNick', true);
    setBanner($('shelfd-setup-nickname-error'), '');
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(user.uid).set({
        name: nickname,
        nameLower: nickname.toLowerCase(),
        customName: nickname,
        onboardingStep: 2,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      try { await user.updateProfile({ displayName: nickname }); } catch (_) {}
      try {
        if (window.userProfile) window.userProfile.name = nickname;
        if (typeof window.applyProfile === 'function') window.applyProfile();
      } catch (_) {}
      setSetupStep(2);
    } catch (err) {
      console.warn('[shelfd-auth] save nickname failed:', err);
      setBanner($('shelfd-setup-nickname-error'), 'Could not save. Try again.', 'error');
    } finally {
      setBusy('setupNick', false);
    }
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
     AUTH-STATE GATE
     Called by 17-comments-auth-init.js right before render() / route to
     My Lists. If the user is mid-onboarding, this returns true and opens
     the setup flow at the saved step; the caller skips its render.
     ════════════════════════════════════════════════════════════════════════ */
  async function authOnboardingGate(user) {
    if (!user) return false;
    if (typeof firebase === 'undefined' || !firebase.firestore) return false;
    try {
      const snap = await firebase.firestore().collection('users').doc(user.uid).get();
      if (!snap.exists) return false; /* Brand new account, saveUserProfile creates doc; no gate. */
      const data = snap.data() || {};
      if (data.onboardingComplete === false) {
        const step = (data.onboardingStep === 2 || data.onboardingStep === 3) ? data.onboardingStep : 1;
        const opts = {};
        if (data.usernameHandle && !data.customName) opts.nicknameDefault = data.usernameHandle;
        openShelfdSetupPage(step, opts);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[shelfd-auth] onboarding gate failed:', err);
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
  window.shelfdSetupNicknameNext = shelfdSetupNicknameNext;
  window.shelfdSetupSavePhoto = shelfdSetupSavePhoto;
  window.shelfdSetupSkipPhoto = shelfdSetupSkipPhoto;
  window.shelfdSetupFinish = shelfdSetupFinish;
})();
