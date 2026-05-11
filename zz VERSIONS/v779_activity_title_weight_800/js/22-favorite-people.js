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

    /* Persist with a dot-path update — preserves the rest of the map. */
    try {
      const fieldPath = `favoritePeople.${id}`;
      const update = wasFav
        ? { [fieldPath]: firebase.firestore.FieldValue.delete() }
        : { [fieldPath]: map[id] };
      await db.collection('users').doc(currentUser.uid).update(update);
      return true;
    } catch (e) {
      /* update() fails if the doc doesn't exist yet — fall back to set+merge. */
      try {
        const merge = wasFav
          ? { favoritePeople: { [id]: firebase.firestore.FieldValue.delete() } }
          : { favoritePeople: { [id]: map[id] } };
        await db.collection('users').doc(currentUser.uid).set(merge, { merge: true });
        return true;
      } catch (e2) {
        console.error('Failed to save favoritePerson toggle, reverting local state:', e2);
        /* Revert optimistic state on hard failure. */
        if (wasFav) {
          map[id] = personData; /* restore */
        } else {
          delete map[id];
        }
        window.shelfdFavoritePeople = map;
        window.dispatchEvent(new CustomEvent('shelfd:fav-person-changed', {
          detail: { id, isFavorite: wasFav }
        }));
        if (typeof showToast === 'function') showToast('Could not save favorite');
        return false;
      }
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
