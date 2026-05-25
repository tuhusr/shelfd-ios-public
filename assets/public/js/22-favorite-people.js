/* =============================================================================
   22-favorite-people.js  (v730)
   User-favorited actors / actresses / directors.

   - Stored on the user doc as a map keyed by TMDB person ID:
        favoritePeople: {
          "12345": {
            id: 12345,
            name: "Tom Hanks",
            profile_path: "/abc.jpg",
            role: "actor",       // 'actor' | 'director' (extensible)
            addedAt: 1715200000000
          }
        }
   - Loaded once on auth-ready into window.shelfdFavoritePeople for sync access
     (so the cast-card render can decide filled-vs-outline without an async hop).
   - Toggle = optimistic local update + Firestore dot-path update (so partial
     failures don't blow away the whole map).
   - Click delegation: any element with class `cast-fav-btn` and a
     `data-person-id` attribute will toggle on click. Stops propagation so the
     parent person-card click (which opens the person profile) doesn't fire.
   ========================================================================== */
(function() {
  'use strict';

  if (!window.shelfdFavoritePeople) window.shelfdFavoritePeople = {};

  function getMap() {
    return window.shelfdFavoritePeople || {};
  }

  function isFavoritePerson(id) {
    if (id == null || id === '') return false;
    return !!getMap()[String(id)];
  }

  function getFavoritePerson(id) {
    if (id == null || id === '') return null;
    return getMap()[String(id)] || null;
  }

  async function loadFavoritePeople() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof db === 'undefined' || !db) return;
    try {
      const snap = await db.collection('users').doc(currentUser.uid).get();
      const data = snap.exists ? (snap.data() || {}) : {};
      const map = (data.favoritePeople && typeof data.favoritePeople === 'object')
        ? data.favoritePeople : {};
      window.shelfdFavoritePeople = map;
      window.dispatchEvent(new CustomEvent('shelfd:fav-people-loaded'));
    } catch (e) {
      console.warn('Loading favoritePeople failed:', e);
    }
  }

  function clearFavoritePeopleLocal() {
    window.shelfdFavoritePeople = {};
    window.dispatchEvent(new CustomEvent('shelfd:fav-people-loaded'));
  }

  async function toggleFavoritePerson(personData) {
    if (typeof currentUser === 'undefined' || !currentUser) {
      if (typeof showToast === 'function') showToast('Sign in to favorite people');
      return false;
    }
    if (typeof db === 'undefined' || !db) return false;

    const id = String(personData?.id || '').trim();
    if (!id) return false;

    const map = getMap();
    const wasFav = !!map[id];

    /* Optimistic local update so the heart fills/empties instantly. */
    if (wasFav) {
      delete map[id];
    } else {
      map[id] = {
        id: Number(personData.id) || personData.id,
        name: String(personData.name || '').trim(),
        profile_path: String(personData.profile_path || '').trim(),
        role: String(personData.role || 'actor').trim(),
        addedAt: Date.now()
      };
    }
    window.shelfdFavoritePeople = map;
    window.dispatchEvent(new CustomEvent('shelfd:fav-person-changed', {
      detail: { id, isFavorite: !wasFav }
    }));

    /* v10.730: simplified persistence — use set+merge ALWAYS so the
       first-time-favorite case (no `favoritePeople` map exists on the
       user doc yet) doesn't go through a failing update() pre-call.
       Also DO NOT revert local state on transient Firestore error —
       Firebase's offline persistence will queue the write and replay it
       when the connection restores, AND we want the heart to stay
       filled visually even on a flaky network. Previously the revert
       caused the documented "heart fills then disappears shortly"
       bug whenever a write took too long or hit a transient error. */
    try {
      const payload = wasFav
        ? { favoritePeople: { [id]: firebase.firestore.FieldValue.delete() } }
        : { favoritePeople: { [id]: map[id] } };
      await db.collection('users').doc(currentUser.uid).set(payload, { merge: true });
      return true;
    } catch (e) {
      console.warn('[v10.730] favoritePerson save deferred — local state retained:', e?.code || e?.message || e);
      /* Surface a soft toast but KEEP the optimistic local update.
         Firestore offline queue will retry; no revert. */
      if (typeof showToast === 'function') showToast('Saved locally — will sync when online');
      return false;
    }
  }

  /* Re-sync the .is-favorite class on every rendered heart in the DOM.
     Cheap (querySelectorAll + class toggle) so safe to call on any state
     change. */
  function refreshFavoritePersonHearts() {
    document.querySelectorAll('.cast-fav-btn[data-person-id]').forEach(btn => {
      const id = btn.getAttribute('data-person-id');
      btn.classList.toggle('is-favorite', isFavoritePerson(id));
      btn.setAttribute('aria-pressed', isFavoritePerson(id) ? 'true' : 'false');
    });
  }

  window.addEventListener('shelfd:fav-people-loaded', refreshFavoritePersonHearts);
  window.addEventListener('shelfd:fav-person-changed', refreshFavoritePersonHearts);

  /* Capture-phase delegation so the heart click WINS over the parent
     cast-card's onclick (which would navigate to the person profile). */
  document.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('.cast-fav-btn[data-person-id]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const personData = {
      id: btn.getAttribute('data-person-id'),
      name: btn.getAttribute('data-person-name') || '',
      profile_path: btn.getAttribute('data-person-photo') || '',
      role: btn.getAttribute('data-person-role') || 'actor'
    };
    /* Tap pulse for haptic-ish feedback. */
    btn.classList.add('cast-fav-btn--tapped');
    setTimeout(() => btn.classList.remove('cast-fav-btn--tapped'), 220);
    toggleFavoritePerson(personData);
  }, true);

  /* Public API */
  window.shelfdLoadFavoritePeople = loadFavoritePeople;
  window.shelfdClearFavoritePeopleLocal = clearFavoritePeopleLocal;
  window.shelfdToggleFavoritePerson = toggleFavoritePerson;
  window.shelfdIsFavoritePerson = isFavoritePerson;
  window.shelfdGetFavoritePerson = getFavoritePerson;
  window.shelfdRefreshFavoritePersonHearts = refreshFavoritePersonHearts;
})();
