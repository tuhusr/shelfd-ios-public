/* =============================================================================
   30-add-password-provider.js  (v10.264 — initial)
   ----------------------------------------------------------------------------
   Why this exists:
     The iOS TestFlight wrap can't complete the Google Sign-In flow inside
     WKWebView (Google's JS detects the embedded webview UA and redirects
     OAuth to Safari, which lands the credential in Safari's storage — not
     the app's). Email/password sign-in works fine in WKWebView.

     Rather than migrate the user's data from their Google UID to a new
     email/password UID (high risk, irreversible mistakes), we LINK an
     email/password provider to the existing Google account. Same UID,
     two ways to sign in. All Firestore data stays put.

   What this does:
     - On profile settings page, detects when currentUser is signed in via
       Google ONLY (no password provider linked yet).
     - Injects a "Add email + password sign-in" card.
     - Clicking opens a modal: email (pre-filled from current account),
       new password, confirm password.
     - Submit calls `currentUser.linkWithCredential(EmailAuthProvider.credential(...))`
       to attach the password provider to the SAME UID.
     - If the password provider is already linked, the card disappears.

   Reuses validation policy from 19b-email-password-auth.js:
     - MIN_PASSWORD_LEN = 12, must contain letter + digit.
   ========================================================================== */
(function() {
  'use strict';

  const MIN_PASSWORD_LEN = 12;

  /* ---------- Provider detection ---------- */
  function userHasPasswordProvider(user) {
    if (!user || !Array.isArray(user.providerData)) return false;
    return user.providerData.some(p => p && p.providerId === 'password');
  }
  function userHasGoogleProvider(user) {
    if (!user || !Array.isArray(user.providerData)) return false;
    return user.providerData.some(p => p && p.providerId === 'google.com');
  }
  function userCanLinkPassword(user) {
    if (!user) return false;
    if (!user.email) return false;
    if (userHasPasswordProvider(user)) return false;
    /* App Review guideline 4: Apple-authenticated users must not be asked
       to create a password after using Sign in with Apple. This migration
       prompt is only for legacy Google accounts without password sign-in. */
    return userHasGoogleProvider(user);
  }

  /* ---------- Password policy (mirrors 19b) ---------- */
  function meetsPasswordPolicy(pw) {
    const s = String(pw || '');
    if (s.length < MIN_PASSWORD_LEN) return false;
    const hasDigit = /\d/.test(s);
    const hasLetter = /[a-zA-Z]/.test(s);
    return hasDigit && hasLetter;
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, opts = {}, children = []) {
    const e = document.createElement(tag);
    if (opts.id) e.id = opts.id;
    if (opts.className) e.className = opts.className;
    if (opts.text) e.textContent = opts.text;
    if (opts.html) e.innerHTML = opts.html;
    if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (opts.style) Object.assign(e.style, opts.style);
    children.forEach(c => { if (c) e.appendChild(c); });
    return e;
  }

  /* ---------- Card injection ---------- */
  const CARD_ID = 'shelfd-add-password-card';
  let cardInjected = false;

  function ensureCardInjected() {
    if (cardInjected) return;
    const user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    if (!userCanLinkPassword(user)) return;

    const settingsPage = document.getElementById('profile-settings-page');
    if (!settingsPage) return;
    /* Only inject when the settings page is actually visible — otherwise the
       card would briefly flash on the underlying profile page. */
    const cs = getComputedStyle(settingsPage);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;

    if (document.getElementById(CARD_ID)) {
      cardInjected = true;
      return;
    }

    const card = buildCard(user);
    /* Try to place it at the top of the settings content. Fallback to the
       end of the settings page if we can't find a content container. */
    const target = settingsPage.querySelector('.profile-settings-content')
                || settingsPage.querySelector('.settings-content')
                || settingsPage.querySelector('.profile-settings-inner')
                || settingsPage;
    if (target.firstChild) target.insertBefore(card, target.firstChild);
    else target.appendChild(card);

    cardInjected = true;
  }

  function buildCard(user) {
    const email = String(user.email || '').trim();
    const card = el('div', {
      id: CARD_ID,
      className: 'shelfd-add-password-card',
      style: {
        margin: '14px 16px',
        padding: '16px 18px',
        background: '#17171b',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        color: '#f4f4f6',
        fontFamily: 'inherit',
        position: 'relative',
        zIndex: '2'
      }
    });

    const title = el('div', {
      text: 'Add email + password sign-in',
      style: {
        fontSize: '15px',
        fontWeight: '700',
        marginBottom: '4px',
        letterSpacing: '0.01em'
      }
    });

    const subtitle = el('div', {
      text: 'Adds a second way to sign in to the same account — useful when Google Sign-In is unavailable (like inside the iOS app). Same data, same profile.',
      style: {
        fontSize: '13px',
        lineHeight: '1.42',
        color: 'rgba(244,244,246,0.66)',
        marginBottom: '12px'
      }
    });

    const emailLine = el('div', {
      html: 'For email: <strong>' + escapeHtml(email) + '</strong>',
      style: {
        fontSize: '13px',
        color: 'rgba(244,244,246,0.85)',
        marginBottom: '14px'
      }
    });

    const btn = el('button', {
      text: 'Set a password',
      attrs: { type: 'button' },
      style: {
        background: '#f4f4f6',
        color: '#17171b',
        border: 'none',
        borderRadius: '999px',
        padding: '10px 18px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer'
      }
    });
    btn.addEventListener('click', openLinkModal);

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(emailLine);
    card.appendChild(btn);
    return card;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function removeCardIfPresent() {
    const existing = document.getElementById(CARD_ID);
    if (existing && existing.parentElement) {
      existing.parentElement.removeChild(existing);
    }
    cardInjected = false;
  }

  /* ---------- Modal ---------- */
  const MODAL_ID = 'shelfd-add-password-modal';

  function openLinkModal() {
    const user = firebase.auth().currentUser;
    if (!userCanLinkPassword(user)) {
      removeCardIfPresent();
      return;
    }
    closeLinkModal();

    const email = String(user.email || '').trim();

    const overlay = el('div', {
      id: MODAL_ID,
      style: {
        position: 'fixed', inset: '0',
        background: 'rgba(0,0,0,0.62)',
        zIndex: '999999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLinkModal(); });

    const sheet = el('div', {
      style: {
        width: '100%',
        maxWidth: '420px',
        background: '#17171b',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '20px 22px 22px',
        color: '#f4f4f6',
        fontFamily: 'inherit',
        boxShadow: '0 18px 60px rgba(0,0,0,0.55)'
      }
    });

    const heading = el('div', {
      text: 'Set a password to keep your account',
      style: {
        fontSize: '17px', fontWeight: '700', marginBottom: '6px', lineHeight: '1.28'
      }
    });
    /* v10.279: refreshed copy. The Google Sign-In button is being removed at
       public launch, so existing Google users need to set a password now
       so they can keep using the same account afterward. All their data,
       friends, and activity stay attached to the same UID. */
    const subhead = el('div', {
      html: 'The <strong>Sign in with Google</strong> button will be removed when Shelfd launches publicly. Setting a password right now keeps your account, your shelf, your friends, and everything else — you\'ll just sign in with your email + this password going forward.<br><br>If you have questions, message <strong>King Kooom</strong> in the app for help.',
      style: {
        fontSize: '13px', lineHeight: '1.48',
        color: 'rgba(244,244,246,0.72)', marginBottom: '16px'
      }
    });

    const emailLabel = el('div', {
      text: 'Email',
      style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(244,244,246,0.58)', marginBottom: '4px' }
    });
    const emailField = el('input', {
      attrs: { type: 'email', value: email, autocomplete: 'email', readonly: 'readonly' },
      style: {
        width: '100%', padding: '10px 12px',
        background: '#0e0e12',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '10px',
        color: '#f4f4f6',
        fontSize: '14px',
        marginBottom: '14px',
        opacity: '0.85'
      }
    });

    const pwLabel = el('div', {
      text: 'New password',
      style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(244,244,246,0.58)', marginBottom: '4px' }
    });
    const pwField = el('input', {
      attrs: { type: 'password', autocomplete: 'new-password', placeholder: 'At least 12 chars, letters + numbers' },
      style: {
        width: '100%', padding: '10px 12px',
        background: '#0e0e12',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '10px',
        color: '#f4f4f6',
        fontSize: '14px',
        marginBottom: '12px'
      }
    });

    const confirmLabel = el('div', {
      text: 'Confirm password',
      style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(244,244,246,0.58)', marginBottom: '4px' }
    });
    const confirmField = el('input', {
      attrs: { type: 'password', autocomplete: 'new-password', placeholder: 'Re-enter password' },
      style: {
        width: '100%', padding: '10px 12px',
        background: '#0e0e12',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '10px',
        color: '#f4f4f6',
        fontSize: '14px',
        marginBottom: '14px'
      }
    });

    const msg = el('div', {
      style: {
        fontSize: '13px',
        minHeight: '18px',
        marginBottom: '14px',
        lineHeight: '1.4',
        color: '#ff9d9d'
      }
    });

    const row = el('div', {
      style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' }
    });
    const cancelBtn = el('button', {
      text: 'Cancel',
      attrs: { type: 'button' },
      style: {
        background: 'transparent',
        color: 'rgba(244,244,246,0.78)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: '999px',
        padding: '9px 16px',
        fontSize: '14px',
        cursor: 'pointer'
      }
    });
    cancelBtn.addEventListener('click', closeLinkModal);

    const submitBtn = el('button', {
      text: 'Set password',
      attrs: { type: 'button' },
      style: {
        background: '#f4f4f6',
        color: '#17171b',
        border: 'none',
        borderRadius: '999px',
        padding: '9px 18px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer'
      }
    });

    let busy = false;
    async function doSubmit() {
      if (busy) return;
      msg.textContent = '';
      msg.style.color = '#ff9d9d';

      const pw = String(pwField.value || '');
      const confirm = String(confirmField.value || '');
      if (pw.length < MIN_PASSWORD_LEN) {
        msg.textContent = 'Password must be at least ' + MIN_PASSWORD_LEN + ' characters.';
        return;
      }
      if (!meetsPasswordPolicy(pw)) {
        msg.textContent = 'Password needs at least one letter and one number.';
        return;
      }
      if (pw !== confirm) {
        msg.textContent = "Passwords don't match.";
        return;
      }
      if (typeof firebase === 'undefined' || !firebase.auth) {
        msg.textContent = 'Auth service not ready. Try again in a moment.';
        return;
      }
      const u = firebase.auth().currentUser;
      if (!u) {
        msg.textContent = 'You must be signed in.';
        return;
      }
      if (!u.email) {
        msg.textContent = 'Your account has no email on file.';
        return;
      }
      busy = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Linking…';
      try {
        const credential = firebase.auth.EmailAuthProvider.credential(u.email, pw);
        await u.linkWithCredential(credential);
        /* Success — also update the user doc so future lookups have the
           email indexed. Best-effort, never blocks success. */
        try {
          if (firebase.firestore) {
            const lower = String(u.email).trim().toLowerCase();
            await firebase.firestore().collection('users').doc(u.uid).set({
              emailLower: lower,
              hasPasswordProvider: true,
              passwordProviderLinkedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
        } catch (e) {
          console.warn('[add-password] emailLower mirror failed (non-fatal):', e);
        }
        msg.style.color = '#a3e9b3';
        msg.textContent = 'Done! You can now sign in with this email and password.';
        submitBtn.textContent = 'Linked';
        setTimeout(() => {
          closeLinkModal();
          removeCardIfPresent();
        }, 1400);
      } catch (err) {
        console.warn('[add-password] linkWithCredential failed:', err && err.code, err);
        const code = err && err.code;
        if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          msg.textContent = 'That email is already associated with another account. Sign out of that account first, or contact support.';
        } else if (code === 'auth/provider-already-linked') {
          msg.textContent = 'A password is already set on this account.';
          removeCardIfPresent();
        } else if (code === 'auth/requires-recent-login') {
          msg.textContent = 'For security, sign out and sign back in with Google, then try again.';
        } else if (code === 'auth/weak-password') {
          msg.textContent = 'Password too weak. Use a stronger one.';
        } else if (code === 'auth/network-request-failed') {
          msg.textContent = 'Network error. Check your connection and try again.';
        } else {
          msg.textContent = 'Could not set password. ' + (err && err.message ? err.message : 'Try again.');
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Set password';
      } finally {
        busy = false;
      }
    }
    submitBtn.addEventListener('click', doSubmit);
    pwField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    confirmField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });

    row.appendChild(cancelBtn);
    row.appendChild(submitBtn);

    sheet.appendChild(heading);
    sheet.appendChild(subhead);
    sheet.appendChild(emailLabel);
    sheet.appendChild(emailField);
    sheet.appendChild(pwLabel);
    sheet.appendChild(pwField);
    sheet.appendChild(confirmLabel);
    sheet.appendChild(confirmField);
    sheet.appendChild(msg);
    sheet.appendChild(row);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    setTimeout(() => { try { pwField.focus(); } catch (_) {} }, 60);
  }

  function closeLinkModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing && existing.parentElement) existing.parentElement.removeChild(existing);
  }

  /* ---------- Auto-open the modal once per session for Google-only users ----------
     v10.279: existing Google users need to set a password before the public
     launch (when Google Sign-In is removed). Rather than relying on them to
     find the Settings card, the modal pops up automatically the first time
     they open the app per session. Once they actually set the password,
     `userCanLinkPassword` returns false and this never fires again. If they
     dismiss without setting, it re-appears next session — by design,
     because the migration is non-optional. */
  const AUTO_OPEN_SESSION_KEY = 'shelfd-add-password-auto-opened-this-session';
  let autoOpenTimer = null;

  function maybeAutoOpenModal() {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const u = firebase.auth().currentUser;
    if (!u) return;
    if (!userCanLinkPassword(u)) return;
    /* Already opened this session? Respect that — don't re-pop. */
    try {
      if (sessionStorage.getItem(AUTO_OPEN_SESSION_KEY) === '1') return;
    } catch (_) {}
    /* Don't fight with an already-open modal. */
    if (document.getElementById(MODAL_ID)) return;
    try { sessionStorage.setItem(AUTO_OPEN_SESSION_KEY, '1'); } catch (_) {}
    openLinkModal();
  }

  function scheduleAutoOpenModal(delayMs) {
    if (autoOpenTimer) { try { clearTimeout(autoOpenTimer); } catch (_) {} }
    autoOpenTimer = setTimeout(maybeAutoOpenModal, Math.max(0, delayMs || 0));
  }

  /* ---------- Observe profile settings page visibility ---------- */
  function setupObserver() {
    const tick = () => {
      try { ensureCardInjected(); } catch (e) { /* swallow */ }
    };
    /* MutationObserver fires when the settings page is shown/hidden and when
       its inner content rerenders. Cheaper than polling. */
    const obs = new MutationObserver(() => tick());
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    /* Also tick on auth state change — covers the case where the user signs
       in/out while the page is open. */
    if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        firebase.auth().onAuthStateChanged(() => {
          /* If user is null or now has password provider, remove the card. */
          const u = firebase.auth().currentUser;
          if (!userCanLinkPassword(u)) removeCardIfPresent();
          tick();
          /* v10.279: when a Google user signs in, schedule the auto-open
             modal. Slight delay so the landing UI has a moment to settle
             before the modal lands on top of it. */
          if (userCanLinkPassword(u)) scheduleAutoOpenModal(1800);
        });
      } catch (e) {}
    }
    /* Initial tick after a short delay to catch already-open settings page. */
    setTimeout(tick, 400);
    setTimeout(tick, 1200);
    /* Also auto-open the modal if the user is already signed in when the
       page loads (e.g. returning user, page reload). The 1.8s delay matches
       the auth-state path. */
    scheduleAutoOpenModal(2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObserver, { once: true });
  } else {
    setupObserver();
  }

  /* Expose for debugging / manual trigger from console */
  window.__shelfdAddPasswordProvider = {
    openLinkModal,
    ensureCardInjected,
    removeCardIfPresent,
    maybeAutoOpenModal,
    resetAutoOpenSession: () => {
      try { sessionStorage.removeItem(AUTO_OPEN_SESSION_KEY); } catch (_) {}
    },
    userCanLinkPassword: () => userCanLinkPassword(firebase.auth().currentUser)
  };
})();
