/* =============================================================================
   19b-email-password-auth.js  (v749)
   ────────────────────────────────────────────────────────────────────────────
   Email + password sign-in / sign-up for Shelfd.

   v749 simplification: stripped display-name field, ToS checkbox, forgot-
   password link, and the entire reset form per UX request. The form is
   now a 2-field sign-in (email + password) and a 3-field sign-up (email
   + password + confirm). If a user forgets their password they will need
   to ask the developer to reset it manually via Firebase Console — no
   self-service reset until reinstated.

   Security choices that remain:
     - Min password length 12, must include letter + digit (gate AND
       strength meter).
     - Generic sign-in error: never reveal whether the email exists or
       whether the password was wrong (account enumeration defense).
     - Email verification email sent automatically on sign-up.
     - Show / Hide password toggle so users can verify what they typed.
     - Display name comes from the email's local-part (before @) on
       sign-up so the rest of the app has something to render. Users can
       edit it later in profile settings.
   ========================================================================== */
(function() {
  'use strict';

  /* ---------- Constants ---------- */
  const MIN_PASSWORD_LEN = 12;
  /* Generic message used for ALL sign-in failures so we don't leak which
     emails exist. */
  const GENERIC_SIGNIN_ERROR = "That email and password don't match an account.";

  /* ---------- State ---------- */
  let currentMode = 'signin';      /* 'signin' | 'signup' */
  let busy = false;

  /* ---------- DOM helpers ---------- */
  const $ = (id) => document.getElementById(id);
  function showEl(el) { if (el) el.hidden = false; }
  function hideEl(el) { if (el) el.hidden = true; }
  function setMessage(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.dataset.kind = kind || '';
  }

  /* ---------- Validation ---------- */
  function isValidEmail(value) {
    /* RFC-ish but pragmatic. Firebase will do its own validation server-side. */
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }
  function passwordStrength(pw) {
    /* Returns { score: 0..4, label }
       - 0 empty
       - 1 weak (< MIN_PASSWORD_LEN, or missing letter + digit)
       - 2 fair (>= MIN_PASSWORD_LEN, has letter + digit)
       - 3 good (>= 14 chars OR mixed-case + digit + symbol)
       - 4 strong (>= 16 chars + mixed-case + digit + symbol) */
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

  /* ---------- Mode toggling (signin <-> signup) ---------- */
  function setMode(mode) {
    currentMode = mode === 'signup' ? 'signup' : 'signin';
    document.querySelectorAll('.login-email-tab').forEach(btn => {
      const active = btn.dataset.mode === currentMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    /* Show/hide fields whose data-show matches the active mode (or is absent
       which means 'always show'). */
    const form = $('login-email-form');
    if (form) {
      form.querySelectorAll('[data-show]').forEach(el => {
        const want = el.dataset.show;
        if (want === currentMode) showEl(el);
        else hideEl(el);
      });
    }
    /* Submit button + password autocomplete + placeholder change with mode */
    const submit = $('login-email-submit');
    if (submit) submit.textContent = currentMode === 'signup' ? 'Create account' : 'Sign in';
    const pwField = $('login-email-password');
    if (pwField) {
      pwField.autocomplete = currentMode === 'signup' ? 'new-password' : 'current-password';
      pwField.placeholder = currentMode === 'signup'
        ? 'At least ' + MIN_PASSWORD_LEN + ' characters, with a number'
        : 'Your password';
    }
    /* Clear messages when switching modes */
    setMessage($('login-email-error'), '');
    setMessage($('login-email-message'), '');
    /* Update strength bar visibility */
    updateStrengthMeter();
  }

  /* ---------- Show/hide password toggle ---------- */
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

  /* ---------- Strength meter ---------- */
  function updateStrengthMeter() {
    const pwField = $('login-email-password');
    const fill = $('login-email-strength-fill');
    const label = $('login-email-strength-label');
    if (!pwField || !fill || !label) return;
    if (currentMode !== 'signup') {
      const wrap = fill.closest('.login-email-strength');
      if (wrap) hideEl(wrap);
      return;
    }
    const wrap = fill.closest('.login-email-strength');
    if (wrap) showEl(wrap);
    const result = passwordStrength(pwField.value);
    const pct = (result.score / 4) * 100;
    fill.style.width = pct + '%';
    fill.dataset.score = String(result.score);
    label.textContent = pwField.value
      ? (result.label || 'Password strength')
      : 'Password strength';
  }

  /* ---------- Reveal panel ---------- */
  function bindToggleReveal() {
    const toggle = $('login-email-toggle');
    const panel = $('login-email-panel');
    if (!toggle || !panel || toggle.__shelfdBound) return;
    toggle.__shelfdBound = true;
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (next) {
        panel.hidden = false;
        requestAnimationFrame(() => {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      } else {
        panel.hidden = true;
      }
    });
  }

  /* ---------- Tabs ---------- */
  function bindTabs() {
    document.querySelectorAll('.login-email-tab').forEach(btn => {
      if (btn.__shelfdBound) return;
      btn.__shelfdBound = true;
      btn.addEventListener('click', () => setMode(btn.dataset.mode || 'signin'));
    });
  }

  /* ---------- Submit handler ---------- */
  async function handleMainSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setMessage($('login-email-error'), 'Sign-in service is loading — try again in a moment.', 'error');
      return;
    }
    const email = String(($('login-email-input') ? $('login-email-input').value : '')).trim();
    const password = ($('login-email-password') ? $('login-email-password').value : '') || '';

    if (!isValidEmail(email)) {
      setMessage($('login-email-error'), 'Please enter a valid email address.', 'error');
      return;
    }
    if (!password) {
      setMessage($('login-email-error'), 'Please enter your password.', 'error');
      return;
    }

    if (currentMode === 'signup') return runSignUp(email, password);
    return runSignIn(email, password);
  }

  async function runSignIn(email, password) {
    setBusy(true, 'Signing in…');
    setMessage($('login-email-error'), '');
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      collapsePanelOnSuccess();
    } catch (err) {
      console.warn('[email-auth] sign-in failed:', err && err.code);
      const code = err && err.code;
      if (code === 'auth/too-many-requests') {
        setMessage($('login-email-error'),
          'Too many failed attempts. Wait a few minutes and try again.',
          'error');
      } else if (code === 'auth/network-request-failed') {
        setMessage($('login-email-error'),
          'Network error. Check your connection and try again.',
          'error');
      } else if (code === 'auth/user-disabled') {
        setMessage($('login-email-error'),
          'This account has been disabled.',
          'error');
      } else {
        /* SECURITY: never differentiate "no such email" vs "wrong password" */
        setMessage($('login-email-error'), GENERIC_SIGNIN_ERROR, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function runSignUp(email, password) {
    const confirm = ($('login-email-confirm') ? $('login-email-confirm').value : '') || '';

    if (password.length < MIN_PASSWORD_LEN) {
      setMessage($('login-email-error'),
        'Password must be at least ' + MIN_PASSWORD_LEN + ' characters.',
        'error');
      return;
    }
    if (!meetsPasswordPolicy(password)) {
      setMessage($('login-email-error'),
        'Password needs at least one letter and one number.',
        'error');
      return;
    }
    if (password !== confirm) {
      setMessage($('login-email-error'), "Passwords don't match.", 'error');
      return;
    }

    setBusy(true, 'Creating account…');
    setMessage($('login-email-error'), '');
    try {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      /* v749: derive a default display name from the email local-part so
         the rest of the app has something to render until the user edits
         it in profile settings. */
      try {
        if (cred && cred.user && !cred.user.displayName) {
          const fallbackName = String(email.split('@')[0] || '').slice(0, 40);
          if (fallbackName) await cred.user.updateProfile({ displayName: fallbackName });
        }
      } catch (e) {
        console.warn('[email-auth] updateProfile failed (non-fatal):', e);
      }
      try {
        if (cred && cred.user) await cred.user.sendEmailVerification();
      } catch (e) {
        console.warn('[email-auth] sendEmailVerification failed (non-fatal):', e);
      }
      setMessage($('login-email-message'),
        'Account created. We sent a verification link to ' + email + '.',
        'success');
      collapsePanelOnSuccess();
    } catch (err) {
      console.warn('[email-auth] sign-up failed:', err && err.code);
      const code = err && err.code;
      if (code === 'auth/email-already-in-use') {
        setMessage($('login-email-error'),
          'An account already exists for this email. Try signing in instead.',
          'error');
      } else if (code === 'auth/invalid-email') {
        setMessage($('login-email-error'), 'That email address looks invalid.', 'error');
      } else if (code === 'auth/weak-password') {
        setMessage($('login-email-error'),
          'Password too weak. Use at least ' + MIN_PASSWORD_LEN + ' characters with letters and numbers.',
          'error');
      } else if (code === 'auth/network-request-failed') {
        setMessage($('login-email-error'),
          'Network error. Check your connection and try again.',
          'error');
      } else if (code === 'auth/operation-not-allowed') {
        setMessage($('login-email-error'),
          'Email sign-up is not enabled. Contact the developer.',
          'error');
      } else {
        setMessage($('login-email-error'),
          'Could not create account. Try again in a moment.',
          'error');
      }
    } finally {
      setBusy(false);
    }
  }

  function setBusy(state, label) {
    busy = !!state;
    const submit = $('login-email-submit');
    if (!submit) return;
    submit.disabled = busy;
    if (busy) {
      if (!submit.dataset.originalLabel) submit.dataset.originalLabel = submit.textContent;
      if (label) submit.textContent = label;
    } else {
      if (submit.dataset.originalLabel) submit.textContent = submit.dataset.originalLabel;
    }
  }

  function collapsePanelOnSuccess() {
    setTimeout(() => {
      const panel = $('login-email-panel');
      const toggle = $('login-email-toggle');
      if (panel) panel.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }, 600);
  }

  /* ---------- Bootstrap ---------- */
  function start() {
    if (!$('login-email-section')) return;
    bindToggleReveal();
    bindTabs();
    bindShowPasswordToggles();
    const form = $('login-email-form');
    if (form && !form.__shelfdBound) {
      form.__shelfdBound = true;
      form.addEventListener('submit', handleMainSubmit);
    }
    const pwField = $('login-email-password');
    if (pwField && !pwField.__shelfdStrengthBound) {
      pwField.__shelfdStrengthBound = true;
      pwField.addEventListener('input', updateStrengthMeter);
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
    passwordStrength
  };
})();
