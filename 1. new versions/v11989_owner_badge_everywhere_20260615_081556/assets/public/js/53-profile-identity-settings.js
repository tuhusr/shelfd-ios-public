/*
   53-profile-identity-settings.js
   Extracted from 15-profile-settings.js to keep surface ownership explicit.
*/

/* ════════════════════════════════════════════════════════════════════════
   v10.765 — USERNAME (@handle) + DISPLAY NAME edit flows for the
   Profile Settings page.
   ════════════════════════════════════════════════════════════════════════
   Data model (already established at signup, see 19c-auth-flow-setup.js):
     usernameHandle       — the @handle, case-preserved
     usernameHandleLower  — lowercase for uniqueness lookups
     name + customName    — the display name (rendered in friend rows etc.)
     nameLower            — lowercase mirror
   New field added by this module:
     usernameLastChangedAtMs — Date.now() at the moment of change.
                                The Firestore rule on users/{uid} reads
                                this to enforce the 14-day cooldown
                                server-side. Tamper-proof.

   On username change we:
     1. Validate (USERNAME_RE: 1-30, letters/digits/periods/underscores)
     2. Check 14-day cooldown client-side (UX) — server rule enforces too
     3. CREATE the new usernames/{newLower} doc (rule blocks if taken)
     4. UPDATE users/{uid} with new handle + usernameLastChangedAtMs
        (rule blocks if within cooldown window)
     5. DELETE old usernames/{oldLower} doc (rule allows self-delete)
     If step 4 fails, we roll back the new-username claim from step 3.
     Step 5 is best-effort: if it fails, the new handle is live anyway.
   ════════════════════════════════════════════════════════════════════════ */

const PROFILE_USERNAME_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
/* v10.988: universal username rule across signup + profile edit — min
   1, max 30, letters/numbers/periods/underscores only. */
const PROFILE_USERNAME_RE = /^[a-z0-9._]{1,30}$/;
function sanitizeProfileUsernameInput(value = '') {
  return String(value || '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 30);
}
function validateProfileUsernameModeration(value) {
  const moderator = window.ShelfdUsernameModeration;
  if (!moderator || typeof moderator.validateUsernameContent !== 'function') return { allowed: true };
  return moderator.validateUsernameContent(value);
}
function profileUsernameModerationMessage() {
  return window.ShelfdUsernameModeration?.message || 'This username is not allowed. Please choose another one.';
}

function getProfileUsernameLastChangedMs() {
  if (!userProfile) return 0;
  const raw = userProfile.usernameLastChangedAtMs
    || userProfile.usernameLastChangedAt
    || 0;
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw.toMillis === 'function') {
    try { return raw.toMillis(); } catch (_) { return 0; }
  }
  return 0;
}

function getProfileUsernameCooldownRemainingMs() {
  const last = getProfileUsernameLastChangedMs();
  if (!last) return 0;
  return Math.max(0, last + PROFILE_USERNAME_COOLDOWN_MS - Date.now());
}

function formatProfileCooldownDays(ms) {
  if (!ms) return '';
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? '1 day' : `${days} days`;
}

function renderProfileSettingsIdentityCards() {
  /* Populate the @handle + display-name cards with current values from
     userProfile, and lock the Edit button if we're inside the cooldown. */
  const handleDisplay = document.getElementById('profile-settings-handle-display');
  const handleEditBtn = document.getElementById('profile-settings-handle-edit-btn');
  const nameDisplay = document.getElementById('profile-settings-displayname-display');
  const handle = String(
    userProfile?.usernameHandle
    || userProfile?.userHandle
    || userProfile?.username
    || ''
  ).trim();
  const displayName = String(
    userProfile?.customName
    || userProfile?.name
    || ''
  ).trim();
  if (handleDisplay) handleDisplay.textContent = handle ? '@' + handle : '@—';
  if (nameDisplay) nameDisplay.textContent = displayName || '—';
  /* v10.775: button always says "Edit" regardless of cooldown state.
     The cooldown surfaces as an inline red message under the username
     when the user actually taps Edit (see openUsernameHandleEdit). */
  if (handleEditBtn) {
    handleEditBtn.classList.remove('is-locked');
    handleEditBtn.disabled = false;
    handleEditBtn.textContent = 'Edit';
    handleEditBtn.removeAttribute('aria-label');
  }
  /* Hide the locked message on re-render so it doesn't linger after the
     user navigates away and back. */
  const lockedMsgEl = document.getElementById('profile-settings-handle-locked-msg');
  if (lockedMsgEl) lockedMsgEl.hidden = true;
}
window.renderProfileSettingsIdentityCards = renderProfileSettingsIdentityCards;

function setProfileEditError(errorEl, message) {
  if (!errorEl) return;
  if (message) {
    errorEl.textContent = String(message);
    errorEl.hidden = false;
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }
}

/* ── Username @handle edit flow ── */

window.openUsernameHandleEdit = function() {
  /* v10.775: cooldown gate now surfaces as an INLINE red message under
     the @username row rather than a toast at the bottom of the screen.
     Tap Edit during the 14-day lock → message appears, edit form stays
     closed. Tap Edit after cooldown elapses → message hidden, edit form
     opens normally. Server rule still rejects the write either way if
     somehow bypassed. */
  const lockedMsg = document.getElementById('profile-settings-handle-locked-msg');
  const remaining = getProfileUsernameCooldownRemainingMs();
  if (remaining > 0) {
    if (lockedMsg) {
      lockedMsg.textContent = 'Locked, you recently changed your username';
      lockedMsg.hidden = false;
    }
    return;
  }
  if (lockedMsg) lockedMsg.hidden = true;
  const row = document.getElementById('profile-settings-handle-row');
  const edit = document.getElementById('profile-settings-handle-edit');
  const input = document.getElementById('profile-settings-handle-input');
  if (!row || !edit || !input) return;
  row.hidden = true;
  edit.hidden = false;
  input.value = sanitizeProfileUsernameInput(userProfile?.usernameHandle || '');
  if (!input.__shelfdUsernameRuleBound) {
    input.__shelfdUsernameRuleBound = true;
    input.addEventListener('input', () => {
      const cleaned = sanitizeProfileUsernameInput(input.value);
      if (input.value !== cleaned) input.value = cleaned;
    });
  }
  setProfileEditError(document.getElementById('profile-settings-handle-edit-error'), '');
  setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
};

window.cancelUsernameHandleEdit = function() {
  const row = document.getElementById('profile-settings-handle-row');
  const edit = document.getElementById('profile-settings-handle-edit');
  if (row) row.hidden = false;
  if (edit) edit.hidden = true;
  setProfileEditError(document.getElementById('profile-settings-handle-edit-error'), '');
};

window.saveUsernameHandleChange = async function() {
  const input = document.getElementById('profile-settings-handle-input');
  const saveBtn = document.getElementById('profile-settings-handle-save-btn');
  const errorEl = document.getElementById('profile-settings-handle-edit-error');
  if (!input || !currentUser || typeof firebase === 'undefined') return;
  const newHandle = sanitizeProfileUsernameInput(input.value || '');
  if (input.value !== newHandle) input.value = newHandle;
  const oldHandle = String(userProfile?.usernameHandle || '').trim();
  const oldHandleLower = oldHandle.toLowerCase();
  const newHandleLower = newHandle.toLowerCase();
  /* Empty / unchanged / invalid format guards before we touch Firestore. */
  if (!PROFILE_USERNAME_RE.test(newHandle)) {
    setProfileEditError(errorEl, 'Username must be 1-30 characters and can only use letters, numbers, periods, and underscores.');
    return;
  }
  if (!validateProfileUsernameModeration(newHandle).allowed) {
    setProfileEditError(errorEl, profileUsernameModerationMessage());
    return;
  }
  if (newHandleLower === oldHandleLower) {
    window.cancelUsernameHandleEdit();
    return;
  }
  /* Re-check cooldown right before save (in case the user opened edit
     somehow and time hasn't actually elapsed). */
  const remaining = getProfileUsernameCooldownRemainingMs();
  if (remaining > 0) {
    setProfileEditError(errorEl, 'You must wait ' + formatProfileCooldownDays(remaining) + ' until you can edit your username again.');
    return;
  }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  setProfileEditError(errorEl, '');
  const db = firebase.firestore();
  const newUsernameRef = db.collection('usernames').doc(newHandleLower);
  const userRef = db.collection('users').doc(currentUser.uid);
  const now = Date.now();
  /* Step 1 — claim the new username (rule blocks if taken). */
  try {
    await newUsernameRef.set({
      uid: currentUser.uid,
      username: newHandle,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    /* permission-denied here almost always means "taken". Disambiguate
       by re-fetching. */
    console.error('[v10.767] username step 1 (claim new) failed:', e?.code, e?.message, e);
    let taken = false;
    try {
      const probe = await newUsernameRef.get();
      taken = probe.exists && probe.data()?.uid !== currentUser.uid;
    } catch (_) {}
    setProfileEditError(errorEl, taken
      ? 'That username is already taken.'
      : ('Could not reserve username (' + (e?.code || 'unknown') + '). Try again.'));
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    return;
  }
  /* Step 2 — update user doc with new handle + cooldown timestamp.
     If the rule rejects (cooldown still active server-side), roll back
     the username claim from step 1 so the new handle isn't orphaned.
     v10.767: log the full error to console so we can diagnose if a
     "save failed" report turns out to be a rules / network / quota
     issue rather than the cooldown.
     v10.768: cooldown stamp now uses serverTimestamp() (resolved
     server-side) instead of client Date.now(). Eliminates the previous
     ±5s clock-drift failure mode where the server's request.time would
     be a few seconds off from the client's clock and the rule check
     `usernameLastChangedAtMs >= request.time - 5s` would reject the
     write. We ALSO write usernameLastChangedAtMs (number) as a
     convenience for client-side cooldown display, but the SERVER rule
     trusts only the Timestamp field. */
  /* v10.769: defensive guard — if the compat SDK didn't expose
     FieldValue.serverTimestamp() for any reason (SDK load order,
     WKWebView quirk, etc), the sentinel would be undefined and Firestore
     would throw invalid-argument with a confusing message. Catch it
     here so the user sees a clearer hint instead. */
  const serverTs = firebase.firestore.FieldValue && firebase.firestore.FieldValue.serverTimestamp
    ? firebase.firestore.FieldValue.serverTimestamp()
    : null;
  if (!serverTs) {
    console.error('[v10.769] FieldValue.serverTimestamp() unavailable on this runtime');
    setProfileEditError(errorEl, 'Could not save the username change. Firestore SDK is missing serverTimestamp — reload the app and try again.');
    try { await newUsernameRef.delete(); } catch (_) {}
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    return;
  }
  try {
    await userRef.set({
      usernameHandle: newHandle,
      usernameHandleLower: newHandleLower,
      usernameLastChangedAt: serverTs,
      usernameLastChangedAtMs: now,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error('[v10.770] username step 2 (user doc update) failed:', e?.code, e?.message, e);
    /* v10.770: 1 MiB document-size rescue. Firestore caps user docs at
       1,048,576 bytes; once you cross it the SDK throws invalid-argument
       BEFORE the request leaves the device, so the rules never run and
       even a tiny 5-field username patch is refused. Same situation the
       v620 favorites-save rescue solves — re-use that pattern here.
       Strategy: pull the full doc, log per-field byte sizes so we know
       what's bloating it, shrink every oversized base64 data URL,
       apply the username patch on top (fresh sentinels — never put
       sentinels through shrinkDataUrlsDeep), and overwrite with
       merge:false. The new username claim from step 1 stays valid. */
    const msg = String(e?.message || '').toLowerCase();
    const isSizeError = !!(e && (
      msg.includes('1048576') ||
      msg.includes('maximum allowed size') ||
      (e.code === 'invalid-argument' && msg.includes('size'))
    ));
    if (isSizeError) {
      try {
        if (typeof showToast === 'function') {
          try { showToast('Cleaning up oversized profile data…', { durationMs: 2400 }); } catch (_) {}
        }
        const snap = await userRef.get();
        const existing = snap.exists ? snap.data() : {};
        /* Diagnostic: per-top-level-field byte sizes, sorted desc.
           Helps us see WHICH field is the bloat culprit (typically
           customPhoto, showcaseFavorites, or pinnedFavorites). */
        try {
          const sizes = Object.entries(existing).map(([k, v]) => {
            let bytes = 0;
            try { bytes = JSON.stringify(v).length; } catch (_) { bytes = -1; }
            return { key: k, bytes };
          }).sort((a, b) => b.bytes - a.bytes);
          const total = sizes.reduce((s, x) => s + Math.max(0, x.bytes), 0);
          console.warn('[v10.770] user doc bloat audit — total bytes ≈', total);
          console.table(sizes);
        } catch (auditErr) {
          console.warn('[v10.770] bloat audit failed:', auditErr);
        }
        const cleaned = await shrinkDataUrlsDeep(existing);
        /* v10.771: NUKE LEGACY DM MIRROR FIELDS. These are the actual
           bloat source on heavy accounts — the data-URL shrink (v10.770)
           only touches base64 strings, but `directMessageThreadMap`
           holds full structured message arrays for every DM thread,
           which can hit MBs by itself.
           Safe to delete because v10.739 moved DMs to the canonical
           `dmThreads/{threadId}` collection. Real-time delivery,
           inbox rendering, message history — all read from there now.
           These legacy fields are just historical mirror cruft from
           before the migration. Wiping them by omission (set with
           merge:false) shrinks the user doc dramatically and lets the
           1 MiB-limited username write fit. */
        const KNOWN_BLOAT_FIELDS = [
          'directMessageThreadMap',           // legacy DM message-history mirror
          'directMessageThreads',             // legacy DM thread-ID list
          'directMessageIncomingRequestMap',  // legacy DM request payloads (with optional images)
          'directMessageOutgoingRequestMap',
          'directMessageIncomingRequests',
          'directMessageOutgoingRequests'
        ];
        let removedBytes = 0;
        for (const field of KNOWN_BLOAT_FIELDS) {
          if (cleaned[field] !== undefined) {
            try { removedBytes += JSON.stringify(cleaned[field]).length; } catch (_) {}
            delete cleaned[field];
            console.warn('[v10.771] removed bloat field from user doc:', field);
          }
        }
        if (removedBytes > 0) {
          console.warn('[v10.771] freed ≈', removedBytes, 'bytes from legacy DM mirror fields');
        }
        const merged = Object.assign({}, cleaned, {
          usernameHandle: newHandle,
          usernameHandleLower: newHandleLower,
          usernameLastChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
          usernameLastChangedAtMs: now,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        try {
          const afterBytes = JSON.stringify(merged).length;
          console.warn('[v10.771] post-cleanup merged doc bytes ≈', afterBytes);
        } catch (_) {}
        await userRef.set(merged, { merge: false });
        /* Rescue succeeded — fall through to step 3 below. */
      } catch (rescueErr) {
        console.error('[v10.770] username size-rescue failed:', rescueErr?.code, rescueErr?.message, rescueErr);
        try { await newUsernameRef.delete(); } catch (_) {}
        setProfileEditError(errorEl, 'Could not save the username change. Your profile doc is over the 1 MiB Firestore cap and the auto-cleanup didn\'t free enough space. Remove a profile favorite or shrink your profile photo and try again.');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        return;
      }
    } else {
      try { await newUsernameRef.delete(); } catch (_) {}
      let detail;
      if (e?.code === 'permission-denied') {
        detail = 'Permission denied — likely the 14-day cooldown is still active server-side, or the new Firestore rules haven\'t been deployed yet.';
      } else if (e?.code === 'unavailable' || e?.code === 'failed-precondition') {
        detail = 'Network or persistence issue. Try again in a moment.';
      } else if (e?.code) {
        detail = 'Error code: ' + e.code + (e.message ? ' — ' + String(e.message).slice(0, 200) : '');
      } else {
        detail = 'Try again.';
      }
      setProfileEditError(errorEl, 'Could not save the username change. ' + detail);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      return;
    }
  }
  /* Step 3 — release the OLD username (best-effort). If this fails the
     new handle is still live; we just leave the old one orphaned. The
     rule should allow self-delete (allow delete: if isSignedIn() &&
     request.auth.uid == resource.data.uid). */
  if (oldHandleLower && oldHandleLower !== newHandleLower) {
    try {
      await db.collection('usernames').doc(oldHandleLower).delete();
    } catch (e) {
      console.warn('[v10.765] could not release old username (rule may need allow-delete-self):', e?.code || e?.message);
    }
  }
  /* Mirror locally so the UI reflects immediately without waiting for
     the next onSnapshot from friendsDataListener.
     v10.773: also defensively initialize a userProfile object if it
     was null/undefined (rare but possible during cold-start race
     conditions). Without this, the save would succeed in Firestore
     but the local display would stay stuck on "@—". */
  if (!userProfile) userProfile = normalizeUserProfile({ uid: currentUser?.uid });
  userProfile.usernameHandle = newHandle;
  userProfile.usernameHandleLower = newHandleLower;
  userProfile.usernameLastChangedAtMs = now;
  /* v10.766: clearer in-place success feedback so the user immediately
     sees their save took effect. Save button flips to a green "Saved ✓"
     for 900ms, then we close the edit form (display row now reflects
     the new value). Toast fires alongside as a secondary signal at the
     bottom of the screen.
     v10.773: ALSO write the new @handle straight to the display element
     here. Belt-and-suspenders against any state where renderProfileSettingsIdentityCards
     might read a stale userProfile (e.g. if a snapshot fires mid-save
     and overwrites our mirror). The truth is what just got saved. */
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Saved ✓';
    saveBtn.classList.add('is-saved');
  }
  const handleDisplayEl = document.getElementById('profile-settings-handle-display');
  if (handleDisplayEl) handleDisplayEl.textContent = '@' + newHandle;
  renderProfileSettingsIdentityCards();
  if (typeof showToast === 'function') {
    try { showToast('Username updated'); } catch (_) {}
  }
  setTimeout(() => {
    if (saveBtn) {
      saveBtn.textContent = 'Save';
      saveBtn.classList.remove('is-saved');
    }
    window.cancelUsernameHandleEdit();
  }, 900);
};

/* ── Display name edit flow ── */

window.openDisplayNameEdit = function() {
  const row = document.getElementById('profile-settings-displayname-row');
  const edit = document.getElementById('profile-settings-displayname-edit');
  const input = document.getElementById('profile-settings-displayname-input');
  if (!row || !edit || !input) return;
  row.hidden = true;
  edit.hidden = false;
  input.value = String(userProfile?.customName || userProfile?.name || '').trim();
  setProfileEditError(document.getElementById('profile-settings-displayname-edit-error'), '');
  setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
};

window.cancelDisplayNameEdit = function() {
  const row = document.getElementById('profile-settings-displayname-row');
  const edit = document.getElementById('profile-settings-displayname-edit');
  if (row) row.hidden = false;
  if (edit) edit.hidden = true;
  setProfileEditError(document.getElementById('profile-settings-displayname-edit-error'), '');
};

window.saveDisplayNameChange = async function() {
  const input = document.getElementById('profile-settings-displayname-input');
  const saveBtn = document.getElementById('profile-settings-displayname-save-btn');
  const errorEl = document.getElementById('profile-settings-displayname-edit-error');
  if (!input || !currentUser || typeof firebase === 'undefined') return;
  const newName = String(input.value || '').trim();
  if (!newName) {
    setProfileEditError(errorEl, 'Display name cannot be empty.');
    return;
  }
  if (newName.length > 64) {
    setProfileEditError(errorEl, 'Display name must be 64 characters or fewer.');
    return;
  }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  setProfileEditError(errorEl, '');
  try {
    await firebase.firestore().collection('users').doc(currentUser.uid).set({
      name: newName,
      nameLower: newName.toLowerCase(),
      customName: newName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    setProfileEditError(errorEl, 'Could not save. ' + (e?.code === 'permission-denied' ? 'Permission denied.' : 'Try again.'));
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    return;
  }
  /* v10.773: defensive userProfile init + direct display element write,
     same pattern as the username save above (see comments there). */
  if (!userProfile) userProfile = normalizeUserProfile({ uid: currentUser?.uid });
  userProfile.name = newName;
  userProfile.customName = newName;
  userProfile.nameLower = newName.toLowerCase();
  /* v10.766: same inline "Saved ✓" feedback as the username flow. */
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Saved ✓';
    saveBtn.classList.add('is-saved');
  }
  const displayNameEl = document.getElementById('profile-settings-displayname-display');
  if (displayNameEl) displayNameEl.textContent = newName;
  renderProfileSettingsIdentityCards();
  if (typeof showToast === 'function') {
    try { showToast('Display name updated'); } catch (_) {}
  }
  setTimeout(() => {
    if (saveBtn) {
      saveBtn.textContent = 'Save';
      saveBtn.classList.remove('is-saved');
    }
    window.cancelDisplayNameEdit();
  }, 900);
};
