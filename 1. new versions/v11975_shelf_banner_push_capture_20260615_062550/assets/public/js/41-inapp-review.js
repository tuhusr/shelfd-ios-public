/* =============================================================================
   In-app review prompt  (v11.421)
   File: assets/public/js/41-inapp-review.js

   Fires Apple's native SKStoreReviewController rating sheet at a positive moment,
   via the Capacitor plugin @capacitor-community/in-app-review.

   NATIVE SETUP (one-time, in the Capacitor / Xcode project — shelfd-ios-public):
       npm install @capacitor-community/in-app-review
       npx cap sync ios
       # then bump build, archive, upload in Xcode
   Until that ships, this file is a SAFE NO-OP everywhere (web + the current app
   build) — nothing renders, nothing breaks.

   WHAT APPLE ALLOWS (baked into the gating below):
     • iOS shows the sheet AT MOST ~3×/365 days per device, and the SYSTEM decides
       whether to actually display it — we request, we never force.
     • Never on launch / first session / after an error / mid-task. We only ask
       after a rewarding action (a 4–5★ rating, or finishing a title) and we wait
       for a calm screen first.
     • We track per-USER (Firestore) so someone we've already asked is never asked
       again — the closest achievable to "don't re-ask someone who already rated"
       (Apple deliberately never tells us whether a user actually submitted one).

   TUNE FREQUENCY: edit CONFIG below.
     - maxPromptsPerUser : 1  → ask each user once, ever (raise to 2–3 for more
                                coverage, since iOS silently suppresses some calls)
     - minDaysSinceInstall / minPositiveSignals / cooldownDays : how soon / often.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- tunable knobs ---------------- */
  const CONFIG = {
    appVersion: '1',            // recorded for info; no longer a hard gate
    minDaysSinceInstall: 2,     // never ask brand-new installs
    minPositiveSignals: 1,      // # of good moments before the first ask
    maxPromptsPerUser: 5,       // RE-ASK: keep asking non-raters up to this many times
    cooldownDays: 45,           // ...spaced at least this many days apart
    calmWaitMs: 6000,           // wait up to this long for a calm screen before showing
    postSignalDelayMs: 1200     // settle delay after the positive action
  };
  /* NOTE: we re-ask until either maxPromptsPerUser is hit OR the user is flagged
     `reviewDone` — set by markRated()/optOut() when the user rates through a
     control we own ("Rate Shelfd" button) or taps "I already rated". Apple's
     native sheet never reports whether a user actually submitted a rating, so
     a user-driven signal is the only reliable way to stop re-asking raters. */

  const LS_KEY = 'shelfd_review_v1';
  const DAY = 86400000;

  function isNativeIOS() {
    try {
      const C = window.Capacitor;
      return !!(C && C.isNativePlatform && C.isNativePlatform()
        && C.getPlatform && C.getPlatform() === 'ios');
    } catch (_) { return false; }
  }
  function plugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.InAppReview) || null; }
    catch (_) { return null; }
  }

  function loadLS() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) { return {}; } }
  function saveLS(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {} }

  const boot = loadLS();
  if (!boot.installedAt) { boot.installedAt = Date.now(); saveLS(boot); }

  /* ---- per-USER record (Firestore) so a user already asked on one device is
     not asked again on another. Cached locally; falls back to LS-only if signed
     out or Firestore is unavailable. ---- */
  let userRec = null;          // { promptCount, lastPromptedAt, promptedVersion }
  let userRecUid = '';
  function uid() { try { return (window.currentUser && window.currentUser.uid) || ''; } catch (_) { return ''; } }
  function userDoc() {
    try {
      const u = uid();
      return (u && typeof db !== 'undefined' && db) ? db.collection('users').doc(u) : null;
    } catch (_) { return null; }
  }
  async function loadUserRec() {
    const u = uid();
    if (!u) { userRec = null; userRecUid = ''; return; }
    if (userRecUid === u && userRec) return;
    const doc = userDoc();
    if (!doc) return;
    try {
      const snap = await doc.get();
      const d = snap.exists ? (snap.data() || {}) : {};
      userRec = {
        promptCount: Number(d.reviewPromptCount || 0),
        lastPromptedAt: Number(d.reviewPromptedAtMs || 0),
        promptedVersion: String(d.reviewPromptedVersion || ''),
        reviewDone: d.reviewDone === true
      };
      userRecUid = u;
    } catch (_) {}
  }

  function timesPrompted() {
    return Math.max(Number(loadLS().promptCount || 0), userRec ? Number(userRec.promptCount || 0) : 0);
  }
  function lastPromptedAt() {
    return Math.max(Number(loadLS().lastPromptedAt || 0), userRec ? Number(userRec.lastPromptedAt || 0) : 0);
  }
  function isReviewDone() {
    return loadLS().reviewDone === true || !!(userRec && userRec.reviewDone === true);
  }

  function addSignal(n) {
    const s = loadLS();
    s.positiveSignals = Number(s.positiveSignals || 0) + (n || 1);
    saveLS(s);
  }

  function baseEligible() {
    if (!isNativeIOS() || !plugin()) return false;
    if (isReviewDone()) return false;                                // user rated / opted out → never again
    const s = loadLS();
    if ((Date.now() - Number(s.installedAt || Date.now())) < CONFIG.minDaysSinceInstall * DAY) return false;
    if (Number(s.positiveSignals || 0) < CONFIG.minPositiveSignals) return false;
    if (timesPrompted() >= CONFIG.maxPromptsPerUser) return false;   // exhausted re-asks
    const last = lastPromptedAt();
    if (last && (Date.now() - last) < CONFIG.cooldownDays * DAY) return false;  // still in cooldown → re-ask later
    return true;
  }

  /* A "calm" screen = no full-page composer/overlay/modal in the way. */
  function overlayOpen() {
    try {
      if (document.body && document.body.classList.contains('shelf-log-composer-open')) return true;
      if (document.querySelector(
        '.discover-media-profile-overlay, .game-media-profile-overlay, ' +
        '.discover-universal-search-overlay, .discover-friends-modal-overlay, ' +
        '#shelf-log-saving-overlay'
      )) return true;
      const review = document.getElementById('mylist-media-review-page');
      if (review && getComputedStyle(review).display !== 'none') return true;
      const modal = document.getElementById('modal');
      if (modal && getComputedStyle(modal).display !== 'none') return true;
      return false;
    } catch (_) { return false; }
  }
  function waitForCalm(maxMs) {
    return new Promise(resolve => {
      const start = Date.now();
      const tick = () => {
        if (!overlayOpen()) return resolve(true);
        if (Date.now() - start >= maxMs) return resolve(false);
        setTimeout(tick, 400);
      };
      tick();
    });
  }

  function recordPrompted() {
    const now = Date.now();
    const s = loadLS();
    s.promptCount = Number(s.promptCount || 0) + 1;
    s.lastPromptedAt = now;
    s.promptedVersion = CONFIG.appVersion;
    saveLS(s);
    const doc = userDoc();
    if (doc) {
      try {
        doc.set({
          reviewPromptCount: (userRec ? Number(userRec.promptCount || 0) : 0) + 1,
          reviewPromptedAtMs: now,
          reviewPromptedVersion: CONFIG.appVersion
        }, { merge: true });
      } catch (_) {}
    }
    if (userRec) {
      userRec.promptCount = Number(userRec.promptCount || 0) + 1;
      userRec.lastPromptedAt = now;
      userRec.promptedVersion = CONFIG.appVersion;
    }
  }

  /* ---------------- Pre-prompt sheet (Option B) ----------------
     We ask in our OWN UI first, then only send happy users to Apple's sheet:
       • "Love it"         → fire the native sheet AND markRated() (sent to rate → don't re-ask)
       • "Not yet"         → DON'T touch the App Store (protects the average); re-ask after cooldown
       • "I already rated" → markRated(), never ask again
     Showing this sheet counts as one ask (cooldown + maxPromptsPerUser still apply). */
  let prePromptEl = null;
  function ensurePrePromptStyles() {
    if (document.getElementById('shelfd-review-styles')) return;
    const css =
'.shelfd-review-overlay{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(0,0,0,0);opacity:0;pointer-events:none;transition:opacity .28s ease,background .28s ease;font-family:\'Sohne\',\'DM Sans\',sans-serif;letter-spacing:.03em;}' +
'.shelfd-review-overlay.open{background:rgba(0,0,0,.72);opacity:1;pointer-events:auto;}' +
'.shelfd-review-card{width:min(90vw,340px);background:#161616;border:1px solid rgba(255,255,255,.10);border-radius:22px;box-shadow:0 24px 60px rgba(0,0,0,.6);padding:26px 22px 16px;text-align:center;transform:translateY(16px) scale(.96);opacity:0;transition:transform .34s cubic-bezier(.22,1,.36,1),opacity .24s ease;}' +
'.shelfd-review-overlay.open .shelfd-review-card{transform:none;opacity:1;}' +
'.shelfd-review-star{font-size:34px;color:#E6C766;line-height:1;margin-bottom:12px;}' +
'.shelfd-review-title{color:#fff;font-size:19px;font-weight:600;letter-spacing:.01em;line-height:1.2;}' +
'.shelfd-review-sub{color:rgba(255,255,255,.6);font-size:13px;font-weight:400;line-height:1.42;margin-top:8px;}' +
'.shelfd-review-actions{display:flex;flex-direction:column;gap:9px;margin-top:20px;}' +
'.shelfd-review-btn{appearance:none;-webkit-appearance:none;border:0;border-radius:999px;cursor:pointer;font-family:\'Sohne\',\'DM Sans\',sans-serif;font-size:15px;font-weight:600;letter-spacing:.02em;padding:13px 18px;transition:filter .15s ease,transform .1s ease;}' +
'.shelfd-review-btn:active{transform:scale(.98);}' +
'.shelfd-review-btn-primary{background:#7c3aed;color:#fff;}' +
'.shelfd-review-btn-primary:active{filter:brightness(1.08);}' +
'.shelfd-review-btn-ghost{background:rgba(255,255,255,.06);color:#e8e3f3;border:1px solid rgba(255,255,255,.10);}' +
'.shelfd-review-already{appearance:none;-webkit-appearance:none;border:0;background:transparent;cursor:pointer;color:rgba(255,255,255,.45);font-family:\'Sohne\',\'DM Sans\',sans-serif;font-size:12px;font-weight:400;letter-spacing:.03em;margin-top:14px;text-decoration:underline;text-underline-offset:3px;padding:6px;}';
    const style = document.createElement('style');
    style.id = 'shelfd-review-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }
  function closePrePrompt() {
    const el = prePromptEl;
    prePromptEl = null;
    if (!el) return;
    el.classList.remove('open');
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 320);
  }
  function showReviewPrePrompt() {
    ensurePrePromptStyles();
    closePrePrompt();
    const ov = document.createElement('div');
    ov.className = 'shelfd-review-overlay';
    ov.innerHTML =
      '<div class="shelfd-review-card" role="dialog" aria-modal="true" aria-label="Enjoying Shelfd?">' +
        '<div class="shelfd-review-star" aria-hidden="true">★</div>' +
        '<div class="shelfd-review-title">Enjoying Shelfd?</div>' +
        '<div class="shelfd-review-sub">A quick App Store rating helps other people discover it.</div>' +
        '<div class="shelfd-review-actions">' +
          '<button class="shelfd-review-btn shelfd-review-btn-primary" type="button" data-action="love">Love it</button>' +
          '<button class="shelfd-review-btn shelfd-review-btn-ghost" type="button" data-action="notyet">Not yet</button>' +
        '</div>' +
        '<button class="shelfd-review-already" type="button" data-action="rated">I already rated</button>' +
      '</div>';
    ov.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) { if (e.target === ov) closePrePrompt(); return; }   // tap-outside = dismiss (= "not yet")
      const action = btn.getAttribute('data-action');
      if (action === 'love') {
        markRated();                                  // tapped "Love it" → sent to rate → don't re-ask
        const p = plugin();
        if (p) { try { p.requestReview(); } catch (_) {} }
        closePrePrompt();
      } else if (action === 'rated') {
        markRated();                                  // self-declared they rated → never again
        closePrePrompt();
      } else {
        closePrePrompt();                             // "Not yet" → cooldown applies, re-ask later
      }
    });
    document.body.appendChild(ov);
    prePromptEl = ov;
    requestAnimationFrame(function () { ov.classList.add('open'); });
  }

  let inFlight = false;
  /* Call at a positive moment. opts.ratingProbe (optional): a fn returning the
     item's CURRENT rating — used by the completion trigger to SKIP asking if the
     user ended up rating it low (1–3★). */
  async function maybeRequestReview(opts = {}) {
    addSignal(1);                         // every positive moment counts toward eligibility
    if (inFlight) return false;
    if (!isNativeIOS() || !plugin()) return false;   // web / pre-plugin = no-op
    inFlight = true;
    try {
      await loadUserRec();
      if (!baseEligible()) return false;
      await new Promise(r => setTimeout(r, CONFIG.postSignalDelayMs));
      if (!(await waitForCalm(CONFIG.calmWaitMs))) return false;
      if (typeof opts.ratingProbe === 'function') {
        const r = Number(opts.ratingProbe() || 0);
        if (r >= 1 && r < 4) return false;            // don't ask after a low rating
      }
      if (!baseEligible()) return false;              // re-check after the wait
      recordPrompted();                                // showing the pre-prompt counts as one ask
      showReviewPrePrompt();                           // our gate first → only happy users reach Apple's sheet
      return true;
    } catch (_) { return false; }
    finally { inFlight = false; }
  }

  /* Permanently stop auto-asking this user. Call when they rate via a control we
     own (a "Rate Shelfd" button → App Store) or tap "I already rated". Persists
     to localStorage AND the user's Firestore doc so it holds across devices. */
  function markRated() {
    const s = loadLS();
    s.reviewDone = true;
    saveLS(s);
    if (userRec) userRec.reviewDone = true;
    const doc = userDoc();
    if (doc) { try { doc.set({ reviewDone: true, reviewDoneAtMs: Date.now() }, { merge: true }); } catch (_) {} }
  }

  window.shelfdReview = {
    maybeRequestReview,
    markRated,                 // user rated through our control / "I already rated"
    optOut: markRated,         // alias — "don't ask me again"
    config: CONFIG,
    isNativeIOS,
    available: function () { return isNativeIOS() && !!plugin(); },
    /* console helpers for testing (ignore all gating): */
    _debugPreprompt: function () { showReviewPrePrompt(); },          // preview the "Enjoying Shelfd?" sheet anywhere
    _debugForce: async function () { const p = plugin(); if (p) { try { await p.requestReview(); } catch (e) {} } }
  };
})();
