/* =============================================================================
   29-favorite-artists.js  (v10.258)
   User-favorited music artists. Mirrors 22-favorite-people but keyed by Deezer
   artist ID instead of TMDB person ID, and stored under a separate Firestore
   field so the two collections never collide.

   - Stored on the user doc as a map keyed by Deezer artist ID:
        favoriteArtists: {
          "27": {
            id: 27,
            name: "Daft Punk",
            picture: "https://...",
            addedAt: 1715200000000
          }
        }
   - Loaded once on auth-ready into window.shelfdFavoriteArtists for sync access
     (so the artist profile heart can render filled-vs-outline without an async
     hop on first paint).
   - Toggle = optimistic local update + Firestore dot-path write.
   ========================================================================== */
(function() {
  'use strict';

  if (!window.shelfdFavoriteArtists) window.shelfdFavoriteArtists = {};

  function getMap() {
    return window.shelfdFavoriteArtists || {};
  }

  function isFavoriteArtist(id) {
    if (id == null || id === '') return false;
    return !!getMap()[String(id)];
  }
  function getFavoriteArtist(id) {
    if (id == null || id === '') return null;
    return getMap()[String(id)] || null;
  }

  async function loadFavoriteArtists() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof db === 'undefined' || !db) return;
    try {
      const snap = await db.collection('users').doc(currentUser.uid).get();
      const data = snap.exists ? (snap.data() || {}) : {};
      const map = (data.favoriteArtists && typeof data.favoriteArtists === 'object')
        ? data.favoriteArtists : {};
      window.shelfdFavoriteArtists = map;
      window.dispatchEvent(new CustomEvent('shelfd:fav-artists-loaded'));
    } catch (e) {
      console.warn('Loading favoriteArtists failed:', e);
    }
  }

  function clearFavoriteArtistsLocal() {
    window.shelfdFavoriteArtists = {};
    window.dispatchEvent(new CustomEvent('shelfd:fav-artists-loaded'));
  }

  async function toggleFavoriteArtist(artistData) {
    if (typeof currentUser === 'undefined' || !currentUser) {
      if (typeof showToast === 'function') showToast('Sign in to favorite artists');
      return false;
    }
    if (typeof db === 'undefined' || !db) return false;
    const id = String(artistData?.id || '').trim();
    if (!id) return false;

    const map = getMap();
    const wasFav = !!map[id];
    /* Optimistic local update — heart fills/empties instantly. */
    if (wasFav) {
      delete map[id];
    } else {
      map[id] = {
        id: Number(artistData.id) || artistData.id,
        name: String(artistData.name || '').trim(),
        picture: String(artistData.picture || '').trim(),
        addedAt: Date.now()
      };
    }
    window.shelfdFavoriteArtists = map;
    window.dispatchEvent(new CustomEvent('shelfd:fav-artist-changed', {
      detail: { id, isFavorite: !wasFav }
    }));

    try {
      const fieldPath = `favoriteArtists.${id}`;
      const update = wasFav
        ? { [fieldPath]: firebase.firestore.FieldValue.delete() }
        : { [fieldPath]: map[id] };
      await db.collection('users').doc(currentUser.uid).update(update);
      return true;
    } catch (e) {
      try {
        const merge = wasFav
          ? { favoriteArtists: { [id]: firebase.firestore.FieldValue.delete() } }
          : { favoriteArtists: { [id]: map[id] } };
        await db.collection('users').doc(currentUser.uid).set(merge, { merge: true });
        return true;
      } catch (e2) {
        console.error('Failed to save favoriteArtist toggle, reverting:', e2);
        if (wasFav) { map[id] = artistData; } else { delete map[id]; }
        window.shelfdFavoriteArtists = map;
        window.dispatchEvent(new CustomEvent('shelfd:fav-artist-changed', {
          detail: { id, isFavorite: wasFav }
        }));
        return false;
      }
    }
  }

  /* Auto-load on auth-ready. Use the same hook 22-favorite-people uses. */
  function bootIfReady() {
    if (typeof currentUser !== 'undefined' && currentUser) loadFavoriteArtists();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootIfReady, { once: true });
  } else {
    bootIfReady();
  }
  window.addEventListener('shelfd:auth-ready', bootIfReady);
  window.addEventListener('shelfd:auth-cleared', clearFavoriteArtistsLocal);

  /* Public API */
  window.shelfdIsFavoriteArtist = isFavoriteArtist;
  window.shelfdGetFavoriteArtist = getFavoriteArtist;
  window.shelfdToggleFavoriteArtist = toggleFavoriteArtist;
  window.shelfdLoadFavoriteArtists = loadFavoriteArtists;
  window.shelfdClearFavoriteArtistsLocal = clearFavoriteArtistsLocal;
})();
