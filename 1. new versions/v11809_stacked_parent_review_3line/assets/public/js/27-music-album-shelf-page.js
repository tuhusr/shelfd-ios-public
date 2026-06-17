/* =========================================================================
   v10.245: My-List Album Shelf Page.
   ------------------------------------------------------------------------
   Triggered by tapping "Tracklist" on a music card in My Lists. Full-screen
   slide-in-from-right overlay that surfaces the album as a hero (cover
   centered, title + artist underneath) and the complete track list below.
   Each track row has a collapsed star on its right — tapping it pops out
   the full 10-star Shelfd rating row to the LEFT (hover preview, lit-state,
   star-pop animation, touch scrub), all reusing the same `.star-btn` class
   so behavior matches every other rating surface in the app.
   Gestures: back-arrow top-left + edge swipe-right-to-dismiss.

   Per-track ratings persist into `item.trackRatings[trackIndex]` on the
   library item and route through the standard save() flow.
   ========================================================================= */

(function initMyListAlbumShelfPageModule() {
  const OVERLAY_ID = 'mylist-album-shelf-page';
  const PUBLIC_ALBUM_SHARE_COLLECTION = 'publicAlbumShares';
  let albumFavoriteCacheUid = '';
  let albumFavoriteLoadPromise = null;
  let sharedAlbumRouteOpening = false;
  let sharedAlbumRouteActive = false;

  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function formatReleaseDateLong(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    const year = parts[0], month = parts[1], day = parts[2];
    if (year && month && day) {
      try {
        const d = new Date(`${year}-${month}-${day}T12:00:00`);
        if (!isNaN(d.getTime())) {
          return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
        }
      } catch (_) {}
    }
    if (year && month) return `${year}-${month}`;
    return year || '';
  }

  function readGlobal(name) {
    try {
      // eslint-disable-next-line no-new-func
      return new Function('try { return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined; } catch (_) { return undefined; }')();
    } catch (_) { return undefined; }
  }

  function getCurrentUser() {
    return readGlobal('currentUser') || (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null);
  }

  function getFirestoreDb() {
    return readGlobal('db') || (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
  }

  function sanitizeAlbumKey(value) {
    const cleaned = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
    return cleaned || 'album';
  }

  function getAlbumStableKey(item = {}) {
    const deezer = String(item.deezerId || item.albumDeezerId || '').trim();
    if (deezer) return sanitizeAlbumKey('deezer-' + deezer);
    const mbid = String(item.mbid || item.musicBrainzId || '').trim();
    if (mbid) return sanitizeAlbumKey('mbid-' + mbid);
    const id = String(item.id || item.albumId || '').trim();
    if (id) return sanitizeAlbumKey('id-' + id);
    return sanitizeAlbumKey('title-' + [item.title, item.artist, item.releaseDate || item.year].filter(Boolean).join('-'));
  }

  function getAlbumShareDocId(ownerUid, albumKey) {
    return sanitizeAlbumKey(ownerUid) + '__' + sanitizeAlbumKey(albumKey);
  }

  function getAlbumOwnerUid(options = {}) {
    const user = getCurrentUser();
    return String(options.ownerUid || user?.uid || '').trim();
  }

  function getAlbumCover(item = {}) {
    return String(item.cover || item.image || item.poster || item.albumCover || '').trim();
  }

  function getAlbumTrackSnapshot(item = {}) {
    const tracks = Array.isArray(item.tracks) ? item.tracks : [];
    return tracks.map((track, idx) => ({
      id: String(track?.deezerId || track?.id || '').trim(),
      deezerId: String(track?.deezerId || track?.id || '').trim(),
      number: Number(track?.number || idx + 1) || (idx + 1),
      title: String(track?.title || 'Untitled').trim(),
      duration: Number(track?.duration || track?.durationMs || track?.length || 0) || 0,
      length: Number(track?.length || track?.durationMs || track?.duration || 0) || 0,
      explicit: !!track?.explicit
    }));
  }

  function buildPublicAlbumSnapshot(item = {}, ownerUid = '', albumKey = getAlbumStableKey(item)) {
    return {
      type: 'album',
      ownerUid,
      albumKey,
      id: String(item.id || '').trim(),
      albumId: String(item.albumId || item.id || '').trim(),
      deezerId: String(item.deezerId || item.albumDeezerId || '').trim(),
      mbid: String(item.mbid || item.musicBrainzId || '').trim(),
      title: String(item.title || 'Untitled').trim(),
      artist: String(item.artist || '').trim(),
      cover: getAlbumCover(item),
      year: String(item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '') || '').trim(),
      genre: String(item.genre || '').trim(),
      releaseDate: String(item.releaseDate || '').trim(),
      label: String(item.label || '').trim(),
      tracks: getAlbumTrackSnapshot(item),
      updatedAt: (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.serverTimestamp)
        ? firebase.firestore.FieldValue.serverTimestamp()
        : Date.now()
    };
  }

  function normalizePublicAlbumItem(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || raw.albumId || raw.albumKey || '').trim() || getAlbumStableKey(raw),
      albumId: String(raw.albumId || raw.id || '').trim(),
      deezerId: String(raw.deezerId || '').trim(),
      mbid: String(raw.mbid || '').trim(),
      title: String(raw.title || 'Untitled').trim(),
      artist: String(raw.artist || '').trim(),
      cover: getAlbumCover(raw),
      year: String(raw.year || '').trim(),
      genre: String(raw.genre || '').trim(),
      releaseDate: String(raw.releaseDate || '').trim(),
      label: String(raw.label || '').trim(),
      tracks: getAlbumTrackSnapshot(raw)
    };
  }

  async function ensureFavoriteAlbumsLoaded(force = false) {
    const user = getCurrentUser();
    const uid = String(user?.uid || '').trim();
    if (!uid) {
      window.shelfdFavoriteAlbums = {};
      albumFavoriteCacheUid = '';
      return {};
    }
    if (!window.shelfdFavoriteAlbums || typeof window.shelfdFavoriteAlbums !== 'object') {
      window.shelfdFavoriteAlbums = {};
    }
    if (!force && albumFavoriteCacheUid === uid) return window.shelfdFavoriteAlbums;
    if (albumFavoriteLoadPromise) return albumFavoriteLoadPromise;
    albumFavoriteLoadPromise = (async () => {
      try {
        const dbRef = getFirestoreDb();
        if (!dbRef) return window.shelfdFavoriteAlbums || {};
        const snap = await dbRef.collection('users').doc(uid).get();
        const doc = snap.exists ? (snap.data() || {}) : {};
        window.shelfdFavoriteAlbums = (doc.favoriteAlbums && typeof doc.favoriteAlbums === 'object') ? { ...doc.favoriteAlbums } : {};
        albumFavoriteCacheUid = uid;
        return window.shelfdFavoriteAlbums;
      } catch (e) {
        console.warn('Loading favoriteAlbums failed:', e);
        return window.shelfdFavoriteAlbums || {};
      } finally {
        albumFavoriteLoadPromise = null;
      }
    })();
    return albumFavoriteLoadPromise;
  }

  function buildFavoriteAlbumPayload(item = {}) {
    const user = getCurrentUser();
    const key = getAlbumStableKey(item);
    const now = Date.now();
    return {
      type: 'album',
      id: key,
      albumKey: key,
      albumId: String(item.albumId || item.id || '').trim(),
      deezerId: String(item.deezerId || item.albumDeezerId || '').trim(),
      mbid: String(item.mbid || item.musicBrainzId || '').trim(),
      title: String(item.title || 'Untitled').trim(),
      artist: String(item.artist || '').trim(),
      cover: getAlbumCover(item),
      userUid: String(user?.uid || '').trim(),
      uid: String(user?.uid || '').trim(),
      savedAt: now,
      favoritedAt: now
    };
  }

  function isAlbumFavorited(item = {}) {
    const key = getAlbumStableKey(item);
    const map = window.shelfdFavoriteAlbums && typeof window.shelfdFavoriteAlbums === 'object' ? window.shelfdFavoriteAlbums : {};
    return !!map[key];
  }

  async function toggleAlbumFavorite(item = {}) {
    const user = getCurrentUser();
    const dbRef = getFirestoreDb();
    if (!user?.uid || !dbRef) {
      callGlobalFn('showToast', 'Sign in to favorite albums');
      return false;
    }
    const map = await ensureFavoriteAlbumsLoaded();
    const key = getAlbumStableKey(item);
    const nextFav = !map[key];
    if (nextFav) map[key] = buildFavoriteAlbumPayload(item);
    else delete map[key];
    window.shelfdFavoriteAlbums = { ...map };
    const fieldPath = `favoriteAlbums.${key}`;
    try {
      const update = nextFav
        ? { [fieldPath]: map[key] }
        : { [fieldPath]: firebase.firestore.FieldValue.delete() };
      await dbRef.collection('users').doc(user.uid).update(update);
    } catch (e) {
      try {
        const merge = nextFav
          ? { favoriteAlbums: { [key]: map[key] } }
          : { favoriteAlbums: { [key]: firebase.firestore.FieldValue.delete() } };
        await dbRef.collection('users').doc(user.uid).set(merge, { merge: true });
      } catch (err) {
        console.warn('Album favorite toggle failed:', err);
        await ensureFavoriteAlbumsLoaded(true);
        callGlobalFn('showToast', 'Could not update album favorite');
      }
    }
    return nextFav;
  }

  function heartIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-7.5-4.35-9.6-9.05C.9 8.55 2.65 5 6.2 5c2.05 0 3.5 1.15 4.3 2.35C11.3 6.15 12.75 5 14.8 5c3.55 0 5.3 3.55 3.8 6.95C19.5 16.65 12 21 12 21Z"/></svg>';
  }

  function shareIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V3"/><path d="m7 8 5-5 5 5"/></svg>';
  }

  /* v10.258: pull release_date + label from Deezer for items that don't have
     them stored (legacy adds before label was persisted). Updates the footer
     facts in-place and saves so subsequent opens are instant. */
  async function backfillReleaseAndLabel(overlay, itemId) {
    const live = getLiveMusicItem(itemId);
    if (!live || !live.deezerId) return;
    if (live.releaseDate && live.label) return; // already complete
    try {
      const res = await fetch(`/api/deezer/album/${encodeURIComponent(live.deezerId)}`);
      if (!res.ok) return;
      const d = await res.json().catch(() => null);
      if (!d || d.error) return;
      const after = getLiveMusicItem(itemId);
      if (!after) return;
      let changed = false;
      if (!after.releaseDate && d.release_date) { after.releaseDate = d.release_date; changed = true; }
      if (!after.label && d.label) { after.label = String(d.label).trim(); changed = true; }
      if (changed) callGlobalFn('save');
      const releaseEl = overlay.querySelector('[data-fact-release-date] dd');
      const labelEl = overlay.querySelector('[data-fact-label] dd');
      if (releaseEl) releaseEl.textContent = after.releaseDate ? formatReleaseDateLong(after.releaseDate) : (after.year || '—');
      if (labelEl) labelEl.textContent = after.label || '—';
    } catch (_) {}
  }

  function formatTrackLength(ms) {
    const n = Number(ms || 0);
    if (!n || !isFinite(n)) return '';
    const total = Math.round(n / 1000);
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  /* Resolve the library `data` object — same trampoline trick used by the
     album profile module, since `data` is script-scoped, not on window. */
  /* v10.292: reverted v10.288 — resolveLibraryData now ALWAYS returns the
     user's own data. The v10.288 attempt to also return friendViewData when
     viewing a friend leaked across navigation states and caused
     getLiveMusicItem (used by commitRating) to mutate the wrong object.
     The result: rating an album on your OWN MyList silently failed because
     the rating was set on stale friendViewData while save() bailed out
     early due to a still-truthy viewingUser check.
     Viewer-side tracklist visibility is now handled by findMusicItem
     below, which tries friendViewData first as a READ-ONLY lookup but
     never overrides the canonical data for write paths. */
  function resolveLibraryData() {
    try {
      // eslint-disable-next-line no-new-func
      const live = new Function('try { return typeof data !== "undefined" ? data : null; } catch (_) { return null; }')();
      if (live && typeof live === 'object') return live;
    } catch (_) {}
    if (typeof window !== 'undefined') {
      if (window.data && typeof window.data === 'object') return window.data;
      if (window.shelfdData && typeof window.shelfdData === 'object') return window.shelfdData;
    }
    return null;
  }

  /* v10.292: read-only lookup for friend's library data. Used only by
     findMusicItem to support viewer-side tracklist rendering. Never
     returned from resolveLibraryData so save paths can't accidentally
     mutate a friend's data structure. */
  function resolveFriendLibraryData() {
    try {
      // eslint-disable-next-line no-new-func
      const liveViewing = new Function('try { return typeof viewingUser !== "undefined" ? viewingUser : null; } catch (_) { return null; }')();
      // eslint-disable-next-line no-new-func
      const liveFriendData = new Function('try { return typeof friendViewData !== "undefined" ? friendViewData : null; } catch (_) { return null; }')();
      if (liveViewing && liveFriendData && typeof liveFriendData === 'object' && Array.isArray(liveFriendData.music)) {
        return liveFriendData;
      }
    } catch (_) {}
    return null;
  }
  function callGlobalFn(name, ...args) {
    if (typeof window !== 'undefined' && typeof window[name] === 'function') {
      try { return window[name](...args); } catch (e) { console.warn(name + ' threw:', e); return undefined; }
    }
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('a', 'try { return typeof ' + name + ' === "function" ? ' + name + '.apply(null, a) : undefined; } catch (e) { return undefined; }');
      return fn(args);
    } catch (_) { return undefined; }
  }

  function closeMyListAlbumPage(opts = {}) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      document.body.classList.remove('mylist-album-shelf-open');
      return;
    }
    const wasSharedRoute = overlay.dataset.sharedAlbumRoute === 'true';
    if (opts.instant) {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('mylist-album-shelf-open');
      if (wasSharedRoute) finishSharedAlbumRouteAfterClose();
      return;
    }
    overlay.classList.remove('is-open');
    setTimeout(() => {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('mylist-album-shelf-open');
      if (wasSharedRoute) finishSharedAlbumRouteAfterClose();
    }, 450);
  }
  window.closeMyListAlbumPage = closeMyListAlbumPage;

  function findMusicItemRecord(itemId) {
    /* v10.292: try friend's data first when viewing someone else's MyList
       (so viewers can OPEN the tracklist). Fall back to own data, which is
       the canonical source for any write paths (rating, fav-track stars).
       resolveLibraryData() always returns own data — separate by design. */
    const friendData = resolveFriendLibraryData();
    if (friendData && Array.isArray(friendData.music)) {
      const fromFriend = friendData.music.find(it => String(it?.id || '') === String(itemId));
      if (fromFriend) return { item: fromFriend, readOnly: true, source: 'friend', ownerUid: String(readGlobal('viewingUser')?.uid || '') };
    }
    const data = resolveLibraryData();
    if (!data || !Array.isArray(data.music)) return null;
    const own = data.music.find(it => String(it?.id || '') === String(itemId)) || null;
    return own ? { item: own, readOnly: false, source: 'own', ownerUid: String(getCurrentUser()?.uid || '') } : null;
  }

  function findMusicItem(itemId) {
    return findMusicItemRecord(itemId)?.item || null;
  }

  /* v10.330: stable per-track key. Array-index keying (the v10.253 model)
     loses favorites if the tracks array ever changes order or length on
     reload — pick the strongest stable identifier available, then
     normalized number+title, then idx as the last resort so legacy
     entries still resolve. */
  function getStableTrackKey(track, idx) {
    if (!track || typeof track !== 'object') return `idx:${idx}`;
    const dzId = String(track.deezerId || track.id || '').trim();
    if (dzId) return `dz:${dzId}`;
    const num = String(track.number || (idx + 1)).trim();
    const title = String(track.title || '').trim().toLowerCase();
    if (title) return `t:${num}::${title}`;
    return `idx:${idx}`;
  }

  /* v10.253: track rows now use a simple FAVORITE star (boolean) instead of
     a 10-star rating. Single tap toggles "this is one of my favorites on the
     album" on/off. Backward compat: any legacy item.trackRatings[i] > 0 is
     treated as favorited so users don't lose pre-existing data.
     v10.330: prefer the stable trackFavoritesByKey map so favorites survive
     tracklist re-orders / re-hydrations. Falls back to the legacy
     trackFavorites array, then to trackRatings — both old shapes still
     load correctly from existing Firestore docs. */
  function isTrackFavorited(item, idx, track = null) {
    const byKey = item && typeof item.trackFavoritesByKey === 'object' && item.trackFavoritesByKey !== null
      ? item.trackFavoritesByKey
      : null;
    if (byKey) {
      const trackRef = track || (Array.isArray(item?.tracks) ? item.tracks[idx] : null);
      const key = getStableTrackKey(trackRef, idx);
      if (byKey[key] === true) return true;
      if (byKey[key] === false) return false;
    }
    const favs = Array.isArray(item?.trackFavorites) ? item.trackFavorites : [];
    if (favs[idx] === true) return true;
    if (favs[idx] === false) return false;
    /* Legacy fallback: trackRatings of 1+ counts as favorited. */
    const ratings = Array.isArray(item?.trackRatings) ? item.trackRatings : [];
    return Number(ratings[idx] || 0) > 0;
  }
  /* v10.255: how many tracks on the album the user has favorited and what
     percentage that represents. Both numbers update live as they tap
     favorites in the shelf page.
     v10.417: kept for backward-compat callers but the album rating
     section now displays an AVERAGE TRACK RATING instead — see
     computeAverageTrackRating below. The percent display was replaced
     because the per-track UI shifted from boolean-favorite to 0–10
     rating, so an average is the meaningful aggregate now. */
  function computeFavoriteRatio(item) {
    const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
    const total = tracks.length;
    if (total === 0) return { count: 0, total: 0, percent: 0 };
    let count = 0;
    for (let i = 0; i < total; i++) if (isTrackFavorited(item, i, tracks[i])) count++;
    return { count, total, percent: Math.round((count / total) * 100) };
  }

  /* v10.417: average of the user's per-track ratings on this album.
     Unrated tracks (rating === 0) are excluded so they don't drag the
     mean toward zero — the average reflects "how the user rated the
     songs they've rated." Returns the internal 0–10 score (matching
     how individual track ratings are stored). The render layer
     converts to 5-star display when the music scale preference is
     'five' so the label honors the user's chosen scale. */
  function computeAverageTrackRating(item) {
    const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
    const total = tracks.length;
    if (total === 0) return { rated: 0, total: 0, average: 0 };
    let sum = 0;
    let rated = 0;
    for (let i = 0; i < total; i++) {
      const r = Number(getTrackRating(item, i, tracks[i]) || 0);
      if (r > 0) { sum += r; rated++; }
    }
    if (rated === 0) return { rated: 0, total, average: 0 };
    return { rated, total, average: sum / rated };
  }

  /* v10.417: format the average for display. Internal storage is 0–10.
     When the music scale is 'five' (half-step mode) we show divided/2
     with a single decimal, e.g. 9.0 / 5; otherwise we show the raw 0–10
     value with one decimal, e.g. 9.0. Integers render as "9" (no
     trailing .0) for the common all-same-rating case the user called
     out ("if they were all a ten, then the average would be a ten"). */
  function formatAverageTrackRating(internalAvg) {
    if (!(internalAvg > 0)) return '—';
    const display = isMusicHalfStep() ? internalAvg / 2 : internalAvg;
    if (Number.isInteger(display)) return String(display);
    return display.toFixed(1);
  }
  /* v10.397: track rows aligned left with the "Tracks" heading (no
     visible number column) and the right-hand toggle replaced with a
     per-track 5-star rating widget. Default state shows a single star
     icon + "X.X / 5" (or just "★" if unrated). Tapping the toggle slides
     the 5-star widget out to the LEFT; tapping a star commits the
     rating, plays the standard star-pop animation, then collapses back
     to the toggle with the new value. */
  function renderTracksHtml(item, options = {}) {
    const readOnly = !!options.readOnly;
    const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
    if (!tracks.length) {
      return '<li class="mylist-album-shelf-track-empty">No tracks listed for this album.</li>';
    }
    /* v10.440: track number column re-introduced per spec. Track index
       renders 1-based to the LEFT of the title (number → title →
       rating widget). The track-num element existed in the DOM
       before but was hidden via CSS `display: none !important` —
       both the JS markup and the CSS hide rule are flipped on now.
       Number falls back to `idx + 1` when no explicit `number`
       field exists on the track object. */
    return tracks.map((t, idx) => {
      const title = escHtml(t.title || 'Untitled');
      const trackNum = Number(t?.number) || (idx + 1);
      return `
        <li class="mylist-album-shelf-track" data-album-track-index="${idx}">
          <span class="mylist-album-shelf-track-num">${trackNum}</span>
          <span class="mylist-album-shelf-track-title">${title}</span>
          ${buildTrackRatingWidgetHtml(item, idx, t, readOnly)}
        </li>
      `;
    }).join('');
  }

  /* v10.397: read the user's 5-star rating for a single track. Storage
     is parallel to commitTrackFavorite's dual shape:
       primary  → item.trackRatingsByKey[stableKey]  (survives reorder)
       fallback → item.trackRatings[idx]             (legacy + 10-star pre-v10.253 data)
     Stored as 0–10 int (same scale as the album-level + title-card
     ratings), displayed as 0.5 increments / 5. */
  function getTrackRating(item, idx, track = null) {
    if (!item) return 0;
    const trackRef = track || (Array.isArray(item.tracks) ? item.tracks[idx] : null);
    if (item.trackRatingsByKey && typeof item.trackRatingsByKey === 'object') {
      const key = getStableTrackKey(trackRef, idx);
      if (Object.prototype.hasOwnProperty.call(item.trackRatingsByKey, key)) {
        const v = Number(item.trackRatingsByKey[key] || 0);
        if (v >= 0 && v <= 10) return v;
      }
    }
    if (Array.isArray(item.trackRatings)) {
      const v = Number(item.trackRatings[idx] || 0);
      if (v >= 0 && v <= 10) return v;
    }
    return 0;
  }

  /* v10.407: track-level rating label respects the music scale
     preference. 10-star ('ten') shows the integer (e.g. "7"); 5-star
     ('five') shows half-step (e.g. "3.5"). */
  function isMusicHalfStep() {
    const fn = typeof window !== 'undefined' && window.isFivePointRatingSection;
    return typeof fn === 'function' ? !!fn('music') : false;
  }
  function formatTrackRatingLabel(rating) {
    if (!(rating > 0)) return '';
    if (isMusicHalfStep()) {
      const display = rating / 2;
      return Number.isInteger(display) ? String(display) : display.toFixed(1);
    }
    return String(rating);
  }
  function getTrackRatingScaleDenominator() {
    return isMusicHalfStep() ? 5 : 10;
  }

  /* v11.040: per-track rating now uses the EXACT same UX as the TV
     episode rating inside the season drop-down — a single champagne-gold
     star button on the right of each track row. Tapping it opens the
     slot-based `.ep-rating-popup` star widget (tap a star or scrub to
     rate), identical to each episode row. Replaces the old slide-out
     `.music-rating` toggle. Commit still flows through commitTrackRating
     so storage (trackRatingsByKey + legacy trackRatings) and the
     average-rating readout are unchanged. */
  /* v11.100/v11.101: per-track 5-star rating is disabled in favor of a simple
     favorite toggle. A single star on the right of each track row — muted when
     not favorited, champagne-gold (.has-rating) when favorited. Single tap
     flips the favorite via the existing commitTrackFavorite storage. Reuses the
     same `.ep-rating-btn`/`.track-rating-btn` styling the episode rows use. */
  function buildTrackRatingWidgetHtml(item, idx, track, readOnly) {
    const itemId = String(item.id || '');
    const escId = itemId.replace(/'/g, "\\'");
    const fav = isTrackFavorited(item, idx, track);
    const cls = `ep-rating-btn track-rating-btn track-fav-btn${fav ? ' has-rating' : ''}`;
    const label = fav ? 'Favorited — tap to remove' : 'Favorite this song';
    if (readOnly) {
      return `<span class="${cls}" style="cursor:default;" aria-label="${label}">&#9733;</span>`;
    }
    return `<button type="button" class="${cls}" data-item-id="${escHtml(itemId)}" data-track-idx="${idx}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${label}" onclick="event.stopPropagation();toggleAlbumShelfTrackFavorite('${escId}',${idx},this)">&#9733;</button>`;
  }

  window.toggleAlbumShelfTrackFavorite = function(itemId, idx, btn) {
    try {
      const live = getLiveMusicItem(itemId);
      const track = live && Array.isArray(live.tracks) ? live.tracks[idx] : null;
      const next = !isTrackFavorited(live || {}, idx, track);
      commitTrackFavorite(itemId, idx, next, track);
      if (btn) {
        btn.classList.toggle('has-rating', next);
        btn.setAttribute('aria-pressed', next ? 'true' : 'false');
        btn.setAttribute('aria-label', next ? 'Favorited — tap to remove' : 'Favorite this song');
      }
    } catch (e) {
      console.warn('track favorite toggle failed:', e);
    }
  };

  /* v11.040: build the slot-based star widget for the track rating
     popup — byte-for-byte the SAME markup family the episode rating
     popup uses (`.ep-rating-popup-stars` + `.ep-rating-star-slot/-base/
     -fill/-hit`). Reuses the episode scrub handlers
     (`epRatingStarsTouchStart/Move`, generic) and commits on tap/scrub
     through `rateTrackPopup`. 5-star half-step or 10-star integer per
     the music scale preference, matching how each episode renders. */
  function buildTrackRatingPopupStars(rating, escId, idx) {
    const halfStep = isMusicHalfStep();
    const stepCount = halfStep ? 5 : 10;
    const cur = Number(rating || 0);
    let html = `<div class="ep-rating-popup-stars" data-section="music" data-step-count="${stepCount}" role="slider" aria-valuemin="0" aria-valuemax="${stepCount === 5 ? 5 : 10}" aria-valuenow="${stepCount === 5 ? cur / 2 : cur}" ontouchstart="epRatingStarsTouchStart(event)" ontouchmove="epRatingStarsTouchMove(event)" ontouchend="trackRatingStarsTouchEnd(event)" ontouchcancel="trackRatingStarsTouchEnd(event)">`;
    if (halfStep) {
      for (let star = 1; star <= 5; star++) {
        const leftVal = star * 2 - 1;
        const rightVal = star * 2;
        let pct = 0;
        if (cur >= rightVal) pct = 100;
        else if (cur >= leftVal) pct = 50;
        html += `<span class="ep-rating-star-slot" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
          + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
          + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`
          + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-left" data-ep-rating-star="${leftVal}" aria-label="Rate ${(leftVal/2).toFixed(1).replace(/\.0$/,'')} of 5" onclick="event.stopPropagation();rateTrackPopup('${escId}',${idx},${leftVal})"></button>`
          + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-right" data-ep-rating-star="${rightVal}" aria-label="Rate ${(rightVal/2).toFixed(1).replace(/\.0$/,'')} of 5" onclick="event.stopPropagation();rateTrackPopup('${escId}',${idx},${rightVal})"></button>`
          + `</span>`;
      }
    } else {
      for (let star = 1; star <= 10; star++) {
        const pct = cur >= star ? 100 : 0;
        html += `<span class="ep-rating-star-slot ep-rating-star-slot-ten" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
          + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
          + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`
          + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-full" data-ep-rating-star="${star}" aria-label="Rate ${star} of 10" onclick="event.stopPropagation();rateTrackPopup('${escId}',${idx},${star})"></button>`
          + `</span>`;
      }
    }
    if (cur > 0) {
      html += `<span class="ep-rating-popup-label">${formatTrackRatingLabel(cur)}</span>`;
    }
    html += `</div>`;
    return html;
  }

  /* v11.040: scrub commit for the track rating popup. Start/Move are the
     SAME generic episode handlers (epRatingStarsTouchStart/Move) wired
     in the markup above — they only touch `--ep-star-fill` + the scrub
     cache, no episode coupling. This end-handler reads the popup the
     `.ep-rating-popup-stars` row belongs to and commits via
     rateTrackPopup. */
  window.trackRatingStarsTouchEnd = function(e) {
    const row = e.currentTarget;
    const wasScrubbing = row.dataset.scrubbing === 'true';
    delete row._epScrubCache;
    if (!wasScrubbing) return;
    row.dataset.scrubbing = 'false';
    const val = parseInt(row.dataset.scrubVal || '0', 10);
    row.dataset.scrubVal = '0';
    /* v11.041: val 0 is allowed — releasing at 0 clears the track rating. */
    if (e.cancelable) e.preventDefault();
    const popup = row.closest('.track-rating-popup');
    if (!popup) return;
    rateTrackPopup(popup.dataset.itemId, parseInt(popup.dataset.trackIdx || '0', 10), val);
  };

  /* v10.397: commit the per-track rating to BOTH the stable-key map and
     the legacy index array. Immediate firestore write when available so
     a quick app-close doesn't lose the rating to the 500ms debounce. */
  function commitTrackRating(itemId, trackIdx, score, track = null) {
    const live = getLiveMusicItem(itemId);
    if (!live) return;
    const trackRef = track || (Array.isArray(live.tracks) ? live.tracks[trackIdx] : null);
    const key = getStableTrackKey(trackRef, trackIdx);
    const clean = Math.max(0, Math.min(10, Number(score) || 0));
    if (!live.trackRatingsByKey || typeof live.trackRatingsByKey !== 'object') {
      live.trackRatingsByKey = {};
    }
    live.trackRatingsByKey[key] = clean;
    if (!Array.isArray(live.trackRatings)) live.trackRatings = [];
    live.trackRatings[trackIdx] = clean;
    callGlobalFn('markOwnItemLastEdited', live, 'music');
    /* v10.417: keep the "Avg rating" readout below the album-level
       widget in sync with the freshly committed per-track score. The
       refresh function tolerates a null overlay (it walks the document
       itself), so we don't need to scope the lookup to a specific
       shelf-overlay node. */
    try { refreshFavoriteRatio(null, itemId); } catch (e) { /* non-fatal */ }
    if (typeof window !== 'undefined' && typeof window.persistOwnListDataImmediate === 'function') {
      window.persistOwnListDataImmediate().catch(err => {
        console.warn('[track-rating] immediate save failed, fell back to debounced:', err);
        callGlobalFn('save');
      });
    } else {
      callGlobalFn('save');
    }
  }

  /* v11.040: open the episode-style rating popup for a track. Mirrors
     `openEpRating` in 06 — builds an `.ep-rating-popup` appended to the
     track row, positioned to the right (the shared CSS handles the
     absolute placement + slide), then closes on the next outside click.
     A star tap / scrub commits through rateTrackPopup. */
  window.openTrackRatingPopup = function(itemId, idx, btn) {
    closeTrackRatingPopup();
    const row = btn && btn.closest ? btn.closest('.mylist-album-shelf-track') : null;
    if (!row) return;
    const live = getLiveMusicItem(itemId);
    const trackRef = live && Array.isArray(live.tracks) ? live.tracks[idx] : null;
    const rating = live ? getTrackRating(live, idx, trackRef) : 0;
    const escId = String(itemId).replace(/'/g, "\\'");
    const popup = document.createElement('div');
    popup.className = 'ep-rating-popup track-rating-popup';
    popup.dataset.itemId = String(itemId);
    popup.dataset.trackIdx = String(idx);
    let html = buildTrackRatingPopupStars(rating, escId, idx);
    /* Clear (✕) affordance, same as the episode popup. */
    if (rating > 0) {
      html += `<button type="button" class="track-rating-popup-clear" style="background:none;border:none;color:#7a6f99;font-size:11px;cursor:pointer;margin-left:4px;" onclick="event.stopPropagation();rateTrackPopup('${escId}',${idx},0)">✕</button>`;
    }
    popup.innerHTML = html;
    row.appendChild(popup);
    /* Defer the outside-click binding one tick so the click that opened
       the popup doesn't immediately close it. */
    setTimeout(() => document.addEventListener('click', closeTrackRatingPopup, { once: true }), 10);
  };

  window.closeTrackRatingPopup = function() {
    document.querySelectorAll('.track-rating-popup').forEach(p => p.remove());
  };

  /* v11.040: commit a track rating from the popup (tap or scrub), then
     close the popup and refresh the row's star button in place — the
     same toggle-off-on-repeat behaviour the overall/episode ratings use.
     Persistence is unchanged (commitTrackRating → trackRatingsByKey +
     legacy array + immediate save + avg-rating refresh). */
  window.rateTrackPopup = function(itemId, idx, score) {
    const live = getLiveMusicItem(itemId);
    if (!live) { closeTrackRatingPopup(); return; }
    const trackRef = Array.isArray(live.tracks) ? live.tracks[idx] : null;
    const prev = getTrackRating(live, idx, trackRef);
    const requested = Number(score) || 0;
    const newScore = prev === requested ? 0 : requested;
    commitTrackRating(itemId, idx, newScore, trackRef);
    closeTrackRatingPopup();
    const btn = document.querySelector(
      `.track-rating-btn[data-item-id="${CSS.escape(String(itemId))}"][data-track-idx="${idx}"]`
    );
    if (btn) {
      const label = formatTrackRatingLabel(newScore);
      btn.classList.toggle('has-rating', newScore > 0);
      btn.innerHTML = `&#9733;${newScore > 0 ? ` ${label}` : ''}`;
      /* Confirmation pop on the star — mirrors the episode rating button. */
      if (newScore > 0 && typeof btn.animate === 'function') {
        requestAnimationFrame(() => {
          try {
            btn.animate([
              { transform: 'scale(1)', filter: 'none' },
              { transform: 'scale(1.3)', filter: 'drop-shadow(0 0 9px rgba(230,199,102,0.85))', offset: 0.4 },
              { transform: 'scale(1)', filter: 'none' }
            ], { duration: 460, easing: 'ease-out' });
          } catch (_) { /* non-fatal */ }
        });
      }
    }
  };

  /* v10.250: ALWAYS resolve the live item by id before reading or writing
     trackRatings. The base `data` is reassigned to a clone after every
     save() call, so any captured item reference becomes orphaned after the
     first commit. Re-finding by id walks the current data.music every time
     to keep mutations sticking. */
  function getLiveMusicItem(itemId) {
    const data = resolveLibraryData();
    if (!data || !Array.isArray(data.music)) return null;
    return data.music.find(it => String(it?.id || '') === String(itemId)) || null;
  }
  /* v10.253: per-track favorite toggle (boolean) replaces the 10-star rating.
     Single tap sets/clears `item.trackFavorites[idx]`. Legacy trackRatings
     entries are preserved but ignored for new writes.
     v10.330: write the favorite under a STABLE per-track key into
     `live.trackFavoritesByKey` so it survives any tracklist re-ordering.
     Also mirror to the legacy `trackFavorites[idx]` array so any other
     reader of the old shape stays correct. Use the immediate (non-debounced)
     save path so an iOS app-close less than 500ms after a tap can't kill
     the Firestore write — the previous code relied on `callGlobalFn('save')`
     which queues a 500ms debounce. */
  function commitTrackFavorite(itemId, trackIdx, isFav, track = null) {
    const live = getLiveMusicItem(itemId);
    if (!live) return;
    const trackRef = track || (Array.isArray(live.tracks) ? live.tracks[trackIdx] : null);
    const key = getStableTrackKey(trackRef, trackIdx);
    if (!live.trackFavoritesByKey || typeof live.trackFavoritesByKey !== 'object') {
      live.trackFavoritesByKey = {};
    }
    live.trackFavoritesByKey[key] = !!isFav;
    if (!Array.isArray(live.trackFavorites)) live.trackFavorites = [];
    live.trackFavorites[trackIdx] = !!isFav;
    callGlobalFn('markOwnItemLastEdited', live, 'music');
    /* Force the Firestore write immediately. If persistOwnListDataImmediate
       is unavailable for any reason (older bundle, error), fall back to the
       debounced save. */
    if (typeof window !== 'undefined' && typeof window.persistOwnListDataImmediate === 'function') {
      window.persistOwnListDataImmediate().catch(err => {
        console.warn('[track-fav] immediate save failed, fell back to debounced:', err);
        callGlobalFn('save');
      });
    } else {
      callGlobalFn('save');
    }
  }

  /* v10.397: previously this attached a click listener to each
     `.mylist-album-shelf-track-fav` favorite button. The v10.397
     redesign replaces that toggle with a 5-star rating widget whose
     expand-toggle + per-star-click handlers are inlined via
     onMylistAlbumTrackRateExpand / onMylistAlbumTrackRate on the
     rendered markup, so this attachment pass is no longer needed.
     Kept as a no-op so the existing call site below (overlay setup
     in showAlbumShelfOverlay) stays valid. */
  function attachTrackRatingHandlers(_overlay, _item) {
    /* intentionally empty — see comment above */
  }

  /* v10.253 / v10.396: album-level rating widget between the hero and
     the tracklist. v10.396 swaps the old 10-star `.star-btn` markup for
     the new `.music-rating` widget (5 stars, half-step granularity)
     shared with the My List title card. Both surfaces read/write the
     same `item.rating` int (0–10 internal, displayed as 0.5/5), so
     editing in either place keeps both in sync. The widget's inline
     handlers route through `rate(itemId,'overall',score)` which fires
     the standard `updateOverallRatingUI` re-render — that selector now
     matches `.music-rating[data-item-id][data-prefix="overall"]`, so
     this widget AND the title card behind the overlay both repaint
     from a single click. */
  /* v10.435: album rating section redesigned into a 3-COLUMN layout:
       [Number of ratings]   [Your rating]   [Average rating]
       [count]               [★ N bubble]    [★ 4.6]
     - Center column uses the same `rating-bubble` pattern as the
       MyList title cards (collapsed = single star glyph + the user's
       numeric rating; tap to expand into the full 5/10-star widget
       with scrub-to-rate). Reuses `window.buildRatingBubbleMarkup`
       from 06-mylists-render-episodes-ratings.js so the toggle /
       rate handlers are already wired and identical to the title
       card surface.
     - Left + Right columns are community aggregates. The actual
       cross-user aggregation isn't built yet (would require a
       Firestore aggregation pipeline / cloud function); for now
       `getCommunityRatingDataForAlbum` returns the user's own
       rating as a 1-person sample so the UI demonstrates real data.
       When the backend aggregation lands, swap that function's
       implementation — the UI doesn't change. */
  /* v10.448: community-ratings aggregation collection. Each doc is
     keyed by the album's stable key (deezer-{id} / mbid-{id} / id-{id}
     / title-{...}) and stores `{ ratings: { [uid]: rating } }` plus
     light metadata. Writes happen on every album-rating commit; reads
     happen when the album shelf page opens AND whenever a rating
     commits (real-time refresh). */
  const COMMUNITY_RATINGS_COLLECTION = 'albumRatings';

  /* In-memory 5-min cache to avoid hammering Firestore when the
     same album is reopened repeatedly. Keyed by albumKey. */
  const albumCommunityRatingCache = {};
  const ALBUM_COMMUNITY_RATING_TTL_MS = 5 * 60 * 1000;

  function getCommunityRatingDataForAlbum(item) {
    /* v10.448: synchronous read returns whatever's cached locally —
       either the in-memory community fetch result OR the user's own
       rating as a 1-person sample if no community data has been
       fetched yet. The async `fetchAndPatchAlbumCommunityRating`
       below pulls the real cross-user data and patches the DOM
       once it arrives. */
    const albumKey = getAlbumStableKey(item);
    const cached = albumCommunityRatingCache[albumKey];
    if (cached && cached.data?.ratings) {
      const values = Object.values(cached.data.ratings).map(Number).filter(n => n > 0);
      if (values.length) {
        const sum = values.reduce((a, b) => a + b, 0);
        return { count: values.length, average: sum / values.length };
      }
    }
    /* Fallback: just the current user's rating as a 1-person sample
       so the UI isn't empty on first paint. */
    const rating = Number(item?.rating || 0);
    if (rating > 0) return { count: 1, average: rating };
    return { count: 0, average: 0 };
  }

  /* v10.448: write the current user's rating to the per-album
     community-aggregation doc. Each user's UID is a key under
     `ratings.{uid}` so Firestore-merge writes only touch the
     caller's entry and never overwrite anyone else's. Removing
     the rating (rating === 0) deletes the field entirely instead
     of zeroing it, so the community average isn't dragged down. */
  async function persistAlbumRatingToCommunityDoc(item, rating) {
    const user = getCurrentUser();
    const dbRef = getFirestoreDb();
    if (!user?.uid || !dbRef || !item) return;
    const albumKey = getAlbumStableKey(item);
    if (!albumKey) return;
    const cleanRating = Math.max(0, Math.min(10, Number(rating) || 0));
    try {
      const docRef = dbRef.collection(COMMUNITY_RATINGS_COLLECTION).doc(albumKey);
      const sentinel = (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.serverTimestamp)
        ? firebase.firestore.FieldValue.serverTimestamp()
        : Date.now();
      if (cleanRating > 0) {
        await docRef.set({
          albumKey,
          title: String(item.title || '').trim(),
          artist: String(item.artist || '').trim(),
          cover: getAlbumCover(item),
          ratings: { [user.uid]: cleanRating },
          updatedAt: sentinel
        }, { merge: true });
      } else if (firebase?.firestore?.FieldValue?.delete) {
        /* User cleared their rating — drop their key from the map. */
        await docRef.set({
          ratings: { [user.uid]: firebase.firestore.FieldValue.delete() },
          updatedAt: sentinel
        }, { merge: true });
      }
      /* Invalidate the local cache so the next fetch sees the fresh data. */
      delete albumCommunityRatingCache[albumKey];
    } catch (e) {
      console.warn('[v10.448] persistAlbumRatingToCommunityDoc failed:', e);
    }
  }
  window.persistAlbumRatingToCommunityDoc = persistAlbumRatingToCommunityDoc;

  /* v10.448: fetch the community-ratings doc for this album and
     patch the count + avg readouts in the open album shelf page.
     5-min cache prevents repeat reads on the same session.
     Called automatically by `renderAlbumRatingHtml` after the
     section markup mounts, AND by the rate-commit hook when a
     user changes their rating.
     v10.449: when the community doc returns 0 ratings (rules
     blocked the write, doc doesn't exist yet, or no users have
     touched this album since v10.448 deployed), fall back to
     showing the CURRENT user's rating as a 1-person sample
     instead of blank/zero. Cleaner than dropping to "0 / —"
     when the user clearly has a rating locally.
     v10.449: also takes an optional `localRating` so the caller
     can pass the user's locally-known rating (covering races
     where the community-doc write hadn't landed before the
     read). */
  async function fetchAndPatchAlbumCommunityRating(item, options = {}) {
    const dbRef = getFirestoreDb();
    if (!dbRef || !item) return;
    const albumKey = getAlbumStableKey(item);
    if (!albumKey) return;
    const cached = albumCommunityRatingCache[albumKey];
    let data;
    if (cached && (Date.now() - cached.ts) < ALBUM_COMMUNITY_RATING_TTL_MS && !options.force) {
      data = cached.data;
    } else {
      try {
        const snap = await dbRef.collection(COMMUNITY_RATINGS_COLLECTION).doc(albumKey).get();
        data = snap.exists ? (snap.data() || {}) : {};
        albumCommunityRatingCache[albumKey] = { ts: Date.now(), data };
      } catch (e) {
        console.warn('[v10.449] fetchAndPatchAlbumCommunityRating failed:', e);
        return;
      }
    }
    const ratings = (data && data.ratings) || {};
    const values = Object.values(ratings).map(Number).filter(n => n > 0);
    /* v10.449: if community is empty AND the local user has a
       rating, render the local sample as 1 user. Avoids the "0 /
       —" blank-looking state when a rules / network blip swallowed
       the persist. */
    const localRating = Number(item?.rating || options.localRating || 0);
    let displayCount = values.length;
    let displayAvg = 0;
    if (values.length) {
      const sum = values.reduce((a, b) => a + b, 0);
      displayAvg = sum / values.length;
    } else if (localRating > 0) {
      displayCount = 1;
      displayAvg = localRating;
    }
    const root = document;
    const countEl = root.querySelector('[data-album-rating-count]');
    if (countEl) countEl.textContent = formatAlbumRatingCount(displayCount);
    const avgRoot = root.querySelector('[data-album-rating-avg]');
    if (avgRoot) {
      const avgNum = avgRoot.querySelector('.mylist-album-shelf-rating-avg-num');
      if (avgNum) avgNum.textContent = displayAvg > 0
        ? formatAlbumCommunityAverage(displayAvg)
        : '—';
    }
  }
  window.fetchAndPatchAlbumCommunityRating = fetchAndPatchAlbumCommunityRating;

  /* v10.449: one-shot per-session migration that writes EVERY rated
     music album in the current user's library to the community
     collection. Triggered on the first album-page open of the
     session so that browsing one album backfills ALL of the user's
     prior ratings — not just the one currently open. Each user that
     does this organically seeds the community docs with their data;
     once enough users have run this, every album's aggregate count
     reflects the true cross-user vote total.
     Skips silently if already migrated this session, if not signed
     in, or if the music list is empty. Writes are fire-and-forget
     and tolerate Firestore errors so the album page stays
     responsive even mid-migration. */
  let _albumRatingsMigratedThisSession = false;
  async function migrateAllMyMusicRatingsOnce() {
    if (_albumRatingsMigratedThisSession) return;
    _albumRatingsMigratedThisSession = true;
    const user = getCurrentUser();
    if (!user?.uid) return;
    const liveData = (typeof window !== 'undefined') ? window.data : null;
    if (!liveData || !Array.isArray(liveData.music)) return;
    const writes = [];
    for (const album of liveData.music) {
      const rating = Number(album?.rating || 0);
      if (rating > 0) writes.push(persistAlbumRatingToCommunityDoc(album, rating));
    }
    if (!writes.length) return;
    try {
      await Promise.all(writes);
    } catch (_) { /* per-write failures are caught individually */ }
  }
  window.migrateAllMyMusicRatingsOnce = migrateAllMyMusicRatingsOnce;

  /* v10.450: friend-backfill — when the current user opens an album
     page, scan every FRIEND's music section in Firestore for the
     same album and write their rating to the community-ratings doc
     on their behalf. Friends' watchlists are already publicly
     readable per the existing security rules, so this just
     materializes the ratings that are already accessible into the
     aggregate collection. Without this, a user only sees community
     ratings from people who have personally opened the app with
     v10.449+; with this, one user opening an album backfills the
     entire friends graph's ratings for that album immediately.
     The data being written is sourced directly from each friend's
     own watchlist, so it cannot be faked — the writer can only
     replicate what's already there.
     Requires Firestore rules that allow cross-UID writes on
     albumRatings (any signed-in user, not just the rating owner).
     The v10.450 rules update opens this up. */
  function readBareGlobalFriends() {
    try {
      return new Function('try { return typeof friends !== "undefined" && Array.isArray(friends) ? friends.slice() : []; } catch (_) { return []; }')() || [];
    } catch (_) { return []; }
  }

  function parseWatchlistSectionItems(raw) {
    if (!raw || typeof raw !== 'object') return [];
    /* v10.387 schema: items live in `{ data: JSON.stringify(array) }`. */
    if (typeof raw.data === 'string') {
      try { return JSON.parse(raw.data) || []; } catch (_) { return []; }
    }
    /* Legacy fallback shapes — defensive only. */
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.music)) return raw.music;
    return [];
  }

  let _friendBackfillCacheByAlbum = {};
  async function backfillCommunityRatingsFromFriends(item, options = {}) {
    const dbRef = getFirestoreDb();
    if (!dbRef || !item) return;
    const albumKey = getAlbumStableKey(item);
    if (!albumKey) return;
    /* One backfill per album per session — re-opens shouldn't
       re-scan every friend's subdoc. */
    if (_friendBackfillCacheByAlbum[albumKey] && !options.force) return;
    _friendBackfillCacheByAlbum[albumKey] = true;
    const currentUid = getCurrentUser()?.uid || '';
    const friendsList = readBareGlobalFriends();
    if (!friendsList.length) return;
    const writes = [];
    for (const friendUid of friendsList) {
      if (!friendUid || friendUid === currentUid) continue;
      writes.push((async () => {
        try {
          const snap = await dbRef.collection('watchlist').doc(friendUid)
            .collection('sections').doc('music').get();
          if (!snap.exists) return;
          const items = parseWatchlistSectionItems(snap.data());
          const match = items.find(it => getAlbumStableKey(it) === albumKey);
          if (!match) return;
          const rating = Math.max(0, Math.min(10, Number(match.rating || 0)));
          if (rating <= 0) return;
          /* Write under the friend's UID, NOT the caller's. The
             v10.450 rules update allows cross-UID writes on
             albumRatings. */
          const sentinel = (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.serverTimestamp)
            ? firebase.firestore.FieldValue.serverTimestamp()
            : Date.now();
          await dbRef.collection(COMMUNITY_RATINGS_COLLECTION).doc(albumKey).set({
            albumKey,
            title: String(item.title || '').trim(),
            artist: String(item.artist || '').trim(),
            cover: getAlbumCover(item),
            ratings: { [friendUid]: rating },
            updatedAt: sentinel
          }, { merge: true });
        } catch (e) {
          console.warn('[v10.450] friend backfill failed for', friendUid, e);
        }
      })());
    }
    if (writes.length) {
      try { await Promise.all(writes); } catch (_) {}
      /* Invalidate the local fetch cache so the next read picks up
         the freshly-backfilled friend data. */
      delete albumCommunityRatingCache[albumKey];
    }
  }
  window.backfillCommunityRatingsFromFriends = backfillCommunityRatingsFromFriends;

  /* Format the rating-count value: 0–1099 renders as an integer
     ("0", "47", "1099"), 1100+ renders as a compacted "X.Yk"
     string ("1.1k", "12.4k", "187.5k"). The 1100 threshold per
     spec — keeps three-digit counts visually consistent before
     compaction kicks in. */
  function formatAlbumRatingCount(n) {
    const count = Math.max(0, Number(n) || 0);
    if (count < 1100) return String(Math.round(count));
    const k = count / 1000;
    /* Round to 1 decimal, drop trailing .0 for cleaner reading
       at integer-k values like "10k" vs "10.0k". */
    const rounded = Math.round(k * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + 'k';
  }

  /* Format the community average for display. Honors the user's
     music scale preference — half-step mode shows on /5 (divided
     by 2, e.g. internal 9.2 → "4.6"); 10-star mode shows on /10
     (e.g. "9.2"). Always one decimal. Returns "—" for no data. */
  function formatAlbumCommunityAverage(score) {
    if (!(score > 0)) return '—';
    const display = isMusicHalfStep() ? score / 2 : score;
    return display.toFixed(1);
  }

  function renderAlbumRatingHtml(item) {
    const itemId = item?.id || '';
    const community = getCommunityRatingDataForAlbum(item);
    const countLabel = formatAlbumRatingCount(community.count);
    const avgLabel = formatAlbumCommunityAverage(community.average);
    /* v10.448 / v10.449: schedule the async backfill + community-data
       fetch after the markup mounts. Ordered steps with awaits to
       prevent races where the fetch reads a stale (empty) doc
       BEFORE the write lands. Steps:
       1) `migrateAllMyMusicRatingsOnce()` — first album-page open of
          the session triggers a bulk-write of EVERY rated album in
          the user's library to the community collection. This
          backfills past ratings made before v10.448 deployed, not
          just the currently-open album. Cheap fire-and-forget;
          short-circuits on subsequent opens.
       2) Per-album persist — writes the CURRENT album's rating
          explicitly (covers cases where the user just opened a new
          album with a rating, or rated it from elsewhere).
       3) Fetch + patch — pulls the live community doc and updates
          the count + avg in the DOM. Forced (cache invalidated)
          so the freshly-written data is read back.
       v10.449: awaits the writes BEFORE the fetch so the fetch sees
       the writes' effect. Without awaits, the fetch could land
       before the create/update completed and return zeros. */
    setTimeout(async () => {
      try {
        const live = getLiveMusicItem(itemId) || item;
        const liveRating = Number(live?.rating || 0);
        if (getCurrentUser()) {
          /* Step 1 — one-shot session migration of ALL the user's
             other rated albums. Most of the work happens here on
             the first open; subsequent opens short-circuit. */
          await migrateAllMyMusicRatingsOnce();
          /* Step 2 — write the current album's rating (idempotent
             even if migration already covered it). */
          if (liveRating > 0) {
            await persistAlbumRatingToCommunityDoc(live, liveRating);
          }
          /* v10.450 Step 3 — friend backfill. Scan every FRIEND's
             public music section for the same album and write their
             rating into the community doc on their behalf. Sourced
             from each friend's own watchlist so we can't fake
             ratings — we replicate data already accessible. */
          await backfillCommunityRatingsFromFriends(live);
        }
        /* Step 4 — fetch + patch with the now-populated doc. */
        await fetchAndPatchAlbumCommunityRating(live, { force: true });
      } catch (_) { /* non-fatal */ }
    }, 0);
    /* Center column: rating bubble. Falls back to the legacy
       always-expanded widget if the bubble builder isn't loaded
       (e.g. file load order edge case during a hot reload). */
    /* v10.508: album-shelf header explicitly frames this column as
       "Your rating ⭐ X/5". Pass { outOfFive: true } so the rating
       bubble's collapsed chip shows the value normalized to a 5-point
       scale with the "/5" suffix (works for both 10-star and half-step
       music scales). The interactive expand / scrub / commit behavior
       is unchanged — only the chip text changes. */
    /* v11.107: show the FULL, always-visible star rating (no collapse/expand
       bubble) — the same `music-rating` widget the write-a-review / log composer
       uses, so it reads as a clear 5-star (half-step) on the five-point music
       scale. Falls back to the bubble only if the full builder is unavailable. */
    const yourRatingMarkup = typeof window.buildMusicRatingMarkup === 'function'
      ? window.buildMusicRatingMarkup(Number(item?.rating || 0), itemId, 'overall', 28, !window.viewingUser)
      : (typeof window.buildRatingBubbleMarkup === 'function'
          ? window.buildRatingBubbleMarkup(item, 'music', { outOfFive: true })
          : `<div class="music-rating" data-item-id="${itemId}" data-prefix="overall" data-section="music"></div>`);
    /* v11.098: the "Total ratings" + "Average rating" community-aggregate
       columns are removed. They were Shelfd social aggregates (you + friends),
       which are near-empty for music, and no music API we hold (Spotify needs a
       key we don't have; Apple Music + YouTube don't expose album ratings) can
       supply a real rating/popularity to replace them. Only "Your rating"
       remains, centered via the base single-column layout. */
    return `
      <section class="mylist-album-shelf-rating" data-album-rating>
        <div class="mylist-album-shelf-rating-col mylist-album-shelf-rating-col--your">
          <div class="mylist-album-shelf-rating-label">Your rating</div>
          ${yourRatingMarkup}
        </div>
      </section>
    `;
  }
  /* v10.255: refresh the favorite ratio readout from live data. Called
     after every favorite toggle so the percentage stays in sync.
     v10.417: refreshed the per-track AVERAGE RATING readout.
     v10.435: now refreshes BOTH the new community-count and
     community-average displays (the 3-column header) AND the inner
     `rating-bubble` collapsed value if it's mounted. Same single
     entry point so the per-track commit, the bubble commit, and any
     future community-data refresh all funnel through one re-render.
     The legacy `[data-album-fav-ratio-text]` hook is kept for any
     stale markup left over from a hot-reload mid-session. */
  function refreshFavoriteRatio(overlay, itemId) {
    const root = overlay || document;
    const live = getLiveMusicItem(itemId);
    if (!live) return;
    const community = getCommunityRatingDataForAlbum(live);
    /* Refresh the count column. */
    const countEl = root.querySelector('[data-album-rating-count]');
    if (countEl) countEl.textContent = formatAlbumRatingCount(community.count);
    /* Refresh the average-rating column (number portion only —
       the star glyph is a sibling span and stays put). */
    const avgRoot = root.querySelector('[data-album-rating-avg]');
    if (avgRoot) {
      const avgNum = avgRoot.querySelector('.mylist-album-shelf-rating-avg-num');
      if (avgNum) avgNum.textContent = formatAlbumCommunityAverage(community.average);
    }
    /* Back-compat path for any legacy "Avg rating" inline readout
       that might still be present (e.g. during a stale-cache
       transition window before the new shell renders). */
    const legacyTxt = root.querySelector('[data-album-fav-ratio-text]');
    if (legacyTxt) {
      const avg = computeAverageTrackRating(live);
      legacyTxt.textContent = formatAverageTrackRating(avg.average);
    }
  }
  /* v10.396: previously this function added click / mouseenter /
     mouseleave / touchmove / touchend listeners to the legacy
     `.star-btn` 10-star widget. The new `.music-rating` widget shipped
     in v10.395 has all of those handlers inlined on the buttons (via
     buildMusicRatingMarkup → onclick / onmouseenter / onmouseleave /
     ontouchstart / ontouchmove / ontouchend), so this attachment pass
     is no longer needed. Kept as a no-op so the existing call site
     remains valid; future album-widget hookups (e.g. instrumenting
     analytics) can hang off this seam without re-introducing
     listeners that would now double up with the inline ones. */
  function attachAlbumRatingHandlers(_overlay, _itemId) {
    /* intentionally empty — see comment above */
  }

  /* v10.256: walk the track list and async-enrich any track whose displayed
     title still lacks a feature marker. Pulls each missing track's
     contributors via `/api/deezer/track/{id}`, builds a "(feat. X, Y)"
     suffix from contributors that aren't the primary artist, mutates the
     track in-place, and triggers a save. Updates the visible title in the
     DOM as each enrichment lands. Throttled to 3 in-flight requests so we
     don't hit Deezer's 50/5s ceiling on huge albums. */
  async function enrichTrackFeatures(overlay, itemId) {
    const startItem = getLiveMusicItem(itemId);
    if (!startItem || !Array.isArray(startItem.tracks)) return;
    const primaryArtistNorm = String(startItem.artist || '').toLowerCase().trim();

    /* v10.256: backfill missing per-track Deezer ids by re-fetching the album
       and matching by track_position. Only runs for legacy items saved before
       deezerId was persisted per track. */
    const missingTrackIds = startItem.tracks.some(t => t && !t.deezerId);
    if (missingTrackIds && startItem.deezerId && !startItem.__trackIdsBackfilled) {
      try {
        const res = await fetch(`/api/deezer/album/${encodeURIComponent(startItem.deezerId)}`);
        if (res.ok) {
          const d = await res.json().catch(() => null);
          const remoteTracks = Array.isArray(d?.tracks?.data) ? d.tracks.data : [];
          const live = getLiveMusicItem(itemId);
          if (live && Array.isArray(live.tracks)) {
            live.tracks.forEach((t, idx) => {
              if (!t || t.deezerId) return;
              const match = remoteTracks.find(r => Number(r.track_position) === Number(t.number || idx + 1))
                || remoteTracks[idx];
              if (match?.id) t.deezerId = String(match.id);
            });
            live.__trackIdsBackfilled = true;
            callGlobalFn('save');
          }
        }
      } catch (_) {}
    }

    /* Re-read after potential backfill. */
    const refreshed = getLiveMusicItem(itemId);
    if (!refreshed || !Array.isArray(refreshed.tracks)) return;
    /* Build the work list against the live item, but snapshot it so we
       have a stable iteration target. */
    const needs = [];
    refreshed.tracks.forEach((t, idx) => {
      if (!t || !t.deezerId) return;
      const hasFeat = /feat\.?|featuring|\bft\.?\b/i.test(String(t.title || ''));
      if (hasFeat || t.hasFeatures === true) return;
      if (t.featuresChecked === true) return;
      needs.push({ idx, deezerId: String(t.deezerId) });
    });
    if (needs.length === 0) return;

    const CONCURRENCY = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < needs.length) {
        const job = needs[cursor++];
        try {
          const res = await fetch(`/api/deezer/track/${encodeURIComponent(job.deezerId)}`);
          if (!res.ok) continue;
          const d = await res.json().catch(() => null);
          if (!d) continue;
          const contributors = Array.isArray(d.contributors) ? d.contributors : [];
          const extras = contributors
            .map(c => String(c?.name || '').trim())
            .filter(n => n && n.toLowerCase() !== primaryArtistNorm);
          /* Apply mutation against the LIVE item (post-save data may have
             swapped underneath us). */
          const live = getLiveMusicItem(itemId);
          if (!live || !Array.isArray(live.tracks) || !live.tracks[job.idx]) continue;
          const track = live.tracks[job.idx];
          track.featuresChecked = true;
          if (extras.length > 0) {
            const base = String(track.title || '').trim();
            track.title = `${base} (feat. ${extras.join(', ')})`;
            track.hasFeatures = true;
            /* Live-patch the visible title in the DOM. */
            const row = overlay.querySelector(`.mylist-album-shelf-track[data-album-track-index="${job.idx}"]`);
            const titleEl = row ? row.querySelector('.mylist-album-shelf-track-title') : null;
            if (titleEl) titleEl.textContent = track.title;
          }
        } catch (_) {}
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, needs.length); i++) workers.push(worker());
    await Promise.all(workers);
    /* One save at the end captures every mutation in a single Firestore
       write rather than firing per-track. */
    callGlobalFn('save');
    const live = getLiveMusicItem(itemId);
    if (live) callGlobalFn('markOwnItemLastEdited', live, 'music');
  }

  function attachSwipeBackHandlers(overlay) {
    const shell = overlay.querySelector('.mylist-album-shelf-shell');
    if (!shell) return;
    let active = false, startX = 0, startY = 0, curX = 0, lastX = 0, lastT = 0, velocity = 0, rafId = 0, pointerId = null;
    function onDown(e) {
      if (e.touches && e.touches.length !== 1) return;
      const pt = e.touches?.[0] || e;
      const rect = overlay.getBoundingClientRect();
      /* Only start swipe near the left edge so users can still tap track
         rows / stars in the rest of the page. */
      if (pt.clientX - rect.left > 32) return;
      active = true; startX = pt.clientX; startY = pt.clientY; curX = 0;
      lastX = pt.clientX; lastT = performance.now(); velocity = 0;
      pointerId = e.pointerId ?? null;
    }
    function onMove(e) {
      if (!active) return;
      const pt = e.touches?.[0] || e;
      if (pointerId !== null && e.pointerId !== undefined && e.pointerId !== pointerId) return;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx) * 1.3) { active = false; return; }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      velocity = (pt.clientX - lastX) / Math.max(1, now - lastT);
      lastX = pt.clientX; lastT = now; curX = dx;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (shell && active) {
            shell.style.transition = 'none';
            shell.style.transform = `translateX(${curX}px)`;
          }
        });
      }
    }
    function onUp() {
      if (!active) return;
      active = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      const shouldClose = curX > 110 || (curX > 32 && velocity > 0.55);
      if (shell) {
        if (shouldClose) {
          shell.style.transition = 'transform 0.30s cubic-bezier(0.22, 1, 0.36, 1)';
          shell.style.transform = 'translateX(100%)';
          setTimeout(() => closeMyListAlbumPage({ instant: true }), 290);
        } else {
          shell.style.transition = 'transform 0.26s cubic-bezier(0.22, 1, 0.36, 1)';
          shell.style.transform = 'translateX(0)';
          setTimeout(() => { shell.style.transition = ''; shell.style.transform = ''; }, 270);
        }
      }
    }
    overlay.addEventListener('pointerdown', onDown, { passive: true });
    overlay.addEventListener('pointermove', onMove, { passive: false });
    overlay.addEventListener('pointerup', onUp, { passive: true });
    overlay.addEventListener('pointercancel', onUp, { passive: true });
    overlay.addEventListener('touchstart', onDown, { passive: true });
    overlay.addEventListener('touchmove', onMove, { passive: false });
    overlay.addEventListener('touchend', onUp, { passive: true });
    overlay.addEventListener('touchcancel', onUp, { passive: true });
  }

  function parseScreenListAlbumRoute(urlLike = window.location) {
    const pathname = typeof urlLike === 'string' ? new URL(urlLike, window.location.origin).pathname : urlLike.pathname;
    const hash = typeof urlLike === 'string' ? new URL(urlLike, window.location.origin).hash : (urlLike.hash || '');
    const pathMatch = String(pathname || '').match(/^\/album\/([^/?#]+)\/([^/?#]+)/i);
    const hashMatch = String(hash || '').match(/^#album\/([^/?#]+)\/([^/?#]+)/i);
    const match = pathMatch || hashMatch;
    if (!match) return null;
    return {
      ownerUid: decodeURIComponent(match[1] || '').trim(),
      albumKey: decodeURIComponent(match[2] || '').trim()
    };
  }

  function prepareSharedAlbumRouteView() {
    if (typeof window.prepareSharedMediaRouteView === 'function') {
      window.prepareSharedMediaRouteView();
      return;
    }
    const login = document.getElementById('login-screen');
    const app = document.getElementById('app-container');
    if (login) login.style.display = 'none';
    if (app) app.style.display = 'block';
  }

  async function loadPublicAlbumShare(ownerUid, albumKey) {
    const dbRef = getFirestoreDb();
    if (!dbRef || !ownerUid || !albumKey) return null;
    const docId = getAlbumShareDocId(ownerUid, albumKey);
    const snap = await dbRef.collection(PUBLIC_ALBUM_SHARE_COLLECTION).doc(docId).get();
    if (!snap.exists) return null;
    return normalizePublicAlbumItem(snap.data() || {});
  }

  async function openSharedAlbumRoute(route = parseScreenListAlbumRoute()) {
    if (!route?.ownerUid || !route?.albumKey || sharedAlbumRouteOpening) return false;
    sharedAlbumRouteOpening = true;
    sharedAlbumRouteActive = false;
    prepareSharedAlbumRouteView();
    try {
      const item = await loadPublicAlbumShare(route.ownerUid, route.albumKey);
      if (!item) throw new Error('Shared album not found');
      openAlbumShelfPage(item, {
        readOnly: true,
        ownerUid: route.ownerUid,
        albumKey: route.albumKey,
        sharedRoute: true
      });
      sharedAlbumRouteActive = true;
      return true;
    } catch (e) {
      console.error('Shared album route failed:', e);
      callGlobalFn('showToast', 'Could not open shared album');
      if (!getCurrentUser() && typeof window.showLandingPage === 'function') window.showLandingPage();
      return false;
    } finally {
      sharedAlbumRouteOpening = false;
    }
  }

  function finishSharedAlbumRouteAfterClose() {
    if (!sharedAlbumRouteActive) return;
    sharedAlbumRouteActive = false;
    if (window.location.pathname.startsWith('/album/') || window.location.hash.startsWith('#album/')) {
      try { history.replaceState(null, '', window.location.origin + '/'); } catch (_) {}
    }
    if (!getCurrentUser() && typeof window.showLandingPage === 'function') window.showLandingPage();
  }

  function buildAlbumShareUrl(item = {}, options = {}) {
    const ownerUid = getAlbumOwnerUid(options);
    const albumKey = options.albumKey || getAlbumStableKey(item);
    const shareOrigin = window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com';
    const url = new URL(`/album/${encodeURIComponent(ownerUid)}/${encodeURIComponent(albumKey)}`, shareOrigin);
    const title = String(item.title || '').trim();
    const artist = String(item.artist || '').trim();
    const cover = getAlbumCover(item);
    if (title) url.searchParams.set('title', title);
    if (artist) url.searchParams.set('artist', artist);
    if (/^https?:\/\//i.test(cover)) url.searchParams.set('poster', cover);
    /* v11.073: enrich the link-preview card so the OG image mirrors the in-app
       full-page album details — year + the sharer's @username, rating, avatar.
       v11.073 fixes:
         • username/avatar read the BARE `userProfile` global (a `let` binding
           that is NOT on window — the v11.072 `window.userProfile` read was
           always null, so the handle was dropped and the avatar fell back to
           the Google photoURL).
         • cover: also pass deezerId so the worker can pull a reliable cover
           straight from Deezer (the stored cover wasn't an http URL the worker
           could fetch).
       v11.074: avatar removed from the card per spec — the bottom row is just
       the @username + rating pill (the in-app photo is base64 and can't reach
       the worker, so no avatar param is sent). */
    const year = String(item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '')).trim();
    if (year) url.searchParams.set('year', year);
    const ratingRaw = Number(item.rating || 0);
    if (ratingRaw > 0) url.searchParams.set('rating', String(ratingRaw / 2));
    const deezerId = String(item.deezerId || item.albumDeezerId || '').replace(/[^0-9]/g, '');
    if (deezerId) url.searchParams.set('deezerId', deezerId);
    const profile = (typeof userProfile !== 'undefined' && userProfile) ? userProfile
      : ((typeof window !== 'undefined' && window.userProfile) ? window.userProfile : null);
    const handle = String((profile && (profile.usernameHandle || profile.usernameHandleLower)) || '').trim().replace(/^@+/, '');
    if (handle) url.searchParams.set('username', handle);
    return url.toString();
  }

  async function ensurePublicAlbumShare(item = {}, options = {}) {
    const user = getCurrentUser();
    const dbRef = getFirestoreDb();
    const ownerUid = getAlbumOwnerUid(options);
    const albumKey = options.albumKey || getAlbumStableKey(item);
    if (!user?.uid || user.uid !== ownerUid || !dbRef) return false;
    const docId = getAlbumShareDocId(ownerUid, albumKey);
    const payload = buildPublicAlbumSnapshot(item, ownerUid, albumKey);
    await dbRef.collection(PUBLIC_ALBUM_SHARE_COLLECTION).doc(docId).set(payload, { merge: true });
    return true;
  }

  async function copyTextToClipboard(text = '') {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    const input = document.createElement('input');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    input.remove();
    return copied;
  }

  async function shareAlbum(item = {}, options = {}) {
    const shareUrl = buildAlbumShareUrl(item, options);
    let prepared = false;
    try { prepared = await ensurePublicAlbumShare(item, options); }
    catch (e) { console.warn('Public album share snapshot failed:', e); }
    const title = String(item.title || 'Album').trim();
    const artist = String(item.artist || '').trim();
    const shareData = {
      title: artist ? `${title} by ${artist} on Shelfd` : `${title} on Shelfd`,
      text: artist ? `Check out ${title} by ${artist} on Shelfd.` : `Check out ${title} on Shelfd.`,
      url: shareUrl
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        callGlobalFn('showToast', prepared ? 'Album share opened' : 'Album link opened');
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const copied = await copyTextToClipboard(shareUrl);
    callGlobalFn('showToast', copied ? (prepared ? 'Album link copied' : 'Album link copied') : 'Could not copy album link');
  }

  function updateAlbumFavoriteButton(btn, item = {}) {
    if (!btn) return;
    const isFav = isAlbumFavorited(item);
    btn.classList.toggle('is-favorited', isFav);
    btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    btn.setAttribute('aria-label', isFav ? 'Unfavorite album' : 'Favorite album');
  }

  function renderAlbumTopbarActions(item = {}, options = {}) {
    const readOnly = !!options.readOnly;
    const fav = !readOnly && getCurrentUser()
      ? `<button type="button" class="music-artist-profile-fav mylist-album-shelf-fav${isAlbumFavorited(item) ? ' is-favorited' : ''}" data-album-shelf-fav aria-pressed="${isAlbumFavorited(item) ? 'true' : 'false'}" aria-label="${isAlbumFavorited(item) ? 'Unfavorite album' : 'Favorite album'}">${heartIconSvg()}</button>`
      : '';
    return `
      <div class="mylist-album-shelf-actions">
        <button type="button" class="mylist-album-shelf-action mylist-album-shelf-share" data-album-shelf-share aria-label="Share album">${shareIconSvg()}</button>
        ${fav}
      </div>
    `;
  }

  function attachAlbumActionHandlers(overlay, item = {}, options = {}) {
    const actionOptions = {
      ...options,
      ownerUid: getAlbumOwnerUid(options),
      albumKey: options.albumKey || getAlbumStableKey(item)
    };
    const shareBtn = overlay.querySelector('[data-album-shelf-share]');
    if (shareBtn) shareBtn.addEventListener('click', e => {
      e.stopPropagation();
      shareAlbum(item, actionOptions);
    });

    const favBtn = overlay.querySelector('[data-album-shelf-fav]');
    if (favBtn) {
      ensureFavoriteAlbumsLoaded().then(() => updateAlbumFavoriteButton(favBtn, item));
      favBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await toggleAlbumFavorite(item);
        updateAlbumFavoriteButton(favBtn, item);
        const svg = favBtn.querySelector('svg');
        if (svg) {
          svg.style.transform = 'scale(1.25)';
          setTimeout(() => { svg.style.transform = ''; }, 180);
        }
      });
    }
  }

  /* v11.097: open the EXACT album in the native Apple Music / Spotify app
     (prefers the app URI, falls back to the website if the app isn't installed).
     Mirrors the music media-profile behavior in 26-music-album-profile.js. */
  function openAlbumShelfExternalMusic(appUri, webUrl) {
    const app = String(appUri || '');
    const web = String(webUrl || '');
    const primary = app || web;
    if (!primary) return;
    let switched = false;
    const onHide = () => { switched = true; };
    document.addEventListener('visibilitychange', onHide, { once: true });
    window.addEventListener('pagehide', onHide, { once: true });
    try { window.open(primary, '_system'); } catch (_) { try { window.location.href = primary; } catch (__) {} }
    if (web && web !== primary) {
      setTimeout(() => {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onHide);
        if (!switched && document.visibilityState === 'visible') {
          try { window.open(web, '_blank', 'noopener'); } catch (_) { try { window.location.href = web; } catch (__) {} }
        }
      }, 1400);
    }
  }

  function wireAlbumShelfExport(anchor, appUri, webUrl) {
    if (!anchor) return;
    anchor.setAttribute('href', webUrl || appUri || '#');
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAlbumShelfExternalMusic(appUri, webUrl);
    });
  }

  /* Resolve + reveal the Apple Music / Spotify links for the album shelf page,
     using the album's Deezer id (and artist/title fallback the worker resolves). */
  function loadAlbumShelfExportLinks(overlay, item, artist, title, readOnly) {
    const wrap = overlay && overlay.querySelector('[data-album-exports]');
    if (!wrap) return;
    const appleA = wrap.querySelector('[data-export-apple]');
    const spotifyA = wrap.querySelector('[data-export-spotify]');
    const live = (!readOnly && typeof getLiveMusicItem === 'function') ? getLiveMusicItem(item.id) : null;
    const deezerId = String((live && (live.deezerId || live.albumDeezerId)) || item.deezerId || item.albumDeezerId || '').replace(/[^0-9]/g, '');
    const params = new URLSearchParams();
    if (deezerId) params.set('deezerId', deezerId);
    if (artist) params.set('artist', artist);
    if (title) params.set('title', title);
    if (![...params.keys()].length) return;
    fetch(`/api/music-links?${params.toString()}`)
      .then(r => (r && r.ok) ? r.json() : null)
      .then(data => {
        if (!data || !data.ok || !overlay.isConnected) return;
        let any = false;
        if (data.appleMusic && appleA) { wireAlbumShelfExport(appleA, data.appleMusic.app, data.appleMusic.web); appleA.hidden = false; any = true; }
        if (data.spotify && spotifyA) { wireAlbumShelfExport(spotifyA, data.spotify.app, data.spotify.web); spotifyA.hidden = false; any = true; }
        if (any) wrap.hidden = false;
      })
      .catch(() => {});
  }

  function openAlbumShelfPage(item, options = {}) {
    if (!item) {
      callGlobalFn('showToast', 'Album not found in your library');
      return;
    }
    closeMyListAlbumPage({ instant: true });

    const readOnly = !!options.readOnly;
    const ownerUid = getAlbumOwnerUid(options);
    const albumKey = options.albumKey || getAlbumStableKey(item);
    const title = item.title || 'Untitled';
    const artist = item.artist || '';
    const cover = item.cover || '';
    const year = item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '');
    const genre = String(item.genre || '').trim();

    const overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.className = `mylist-album-shelf-page${readOnly ? ' is-read-only' : ''}`;
    overlay.dataset.albumKey = albumKey;
    overlay.dataset.ownerUid = ownerUid;
    if (options.sharedRoute) overlay.dataset.sharedAlbumRoute = 'true';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${title} tracklist`);
    overlay.innerHTML = `
      <div class="mylist-album-shelf-shell">
        <header class="mylist-album-shelf-topbar">
          <button type="button" class="mylist-album-shelf-back" data-album-shelf-back aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="mylist-album-shelf-title-bar">Album</span>
          ${renderAlbumTopbarActions(item, { ...options, readOnly, ownerUid, albumKey })}
        </header>
        <main class="mylist-album-shelf-content">
          <div class="mylist-album-shelf-hero">
            <div class="mylist-album-shelf-cover${cover ? '' : ' no-img'}" ${cover ? `style="background-image:url('${escAttr(cover)}')"` : ''}>
              ${cover ? '' : '<span aria-hidden="true">🎵</span>'}
            </div>
            <h1 class="mylist-album-shelf-album-title">${escHtml(title)}</h1>
            ${artist ? `<button type="button" class="mylist-album-shelf-album-artist" data-album-shelf-artist>${escHtml(artist)}</button>` : ''}
            ${(year || genre) ? `<div class="mylist-album-shelf-album-meta">${[year, genre].filter(Boolean).map(escHtml).join(' &middot; ')}</div>` : ''}
            <!-- v11.097: Apple Music / Spotify export links — same as the music
                 media profile (resolved via /api/music-links), open the EXACT
                 album in the native app. Hidden until they resolve. Reuses the
                 global .music-album-profile-export* styling. -->
            <div class="music-album-profile-exports" data-album-exports hidden>
              <a class="music-album-profile-export music-album-profile-export-apple" data-export-apple href="#" rel="noopener" hidden>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 17.6a2.6 2.6 0 1 1-1.7-2.44V6.1l9.4-1.9v8.9a2.6 2.6 0 1 1-1.7-2.44V6.06L9 7.2v10.4z"/></svg>
                <span>Apple Music</span>
              </a>
              <a class="music-album-profile-export music-album-profile-export-spotify" data-export-spotify href="#" rel="noopener" hidden>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.59 14.43a.62.62 0 0 1-.86.21c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.57.21.85Zm1.23-2.73a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.56 11.23 1.33.37.22.49.7.26 1.07Zm.11-2.85C14.82 8.95 9.4 8.77 6.3 9.71a.93.93 0 1 1-.54-1.78c3.56-1.08 9.54-.87 13 1.19a.93.93 0 1 1-.96 1.6Z"/></svg>
                <span>Spotify</span>
              </a>
            </div>
          </div>
          ${readOnly ? '' : renderAlbumRatingHtml(item)}
          <section class="mylist-album-shelf-tracks">
            <ol class="mylist-album-shelf-track-list" data-album-track-list>
              ${renderTracksHtml(item, { readOnly })}
            </ol>
          </section>
          <footer class="mylist-album-shelf-album-footer" data-album-footer>
            <div class="mylist-album-shelf-footer-fact" data-fact-release-date>
              <dt>Released</dt>
              <dd>${item.releaseDate ? escHtml(formatReleaseDateLong(item.releaseDate)) : (item.year ? escHtml(item.year) : '—')}</dd>
            </div>
            <div class="mylist-album-shelf-footer-fact" data-fact-label>
              <dt>Label</dt>
              <dd>${item.label ? escHtml(item.label) : '—'}</dd>
            </div>
          </footer>
        </main>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('mylist-album-shelf-open');
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));

    const backBtn = overlay.querySelector('[data-album-shelf-back]');
    if (backBtn) backBtn.addEventListener('click', () => closeMyListAlbumPage());
    attachAlbumActionHandlers(overlay, item, { ...options, readOnly, ownerUid, albumKey });

    /* v11.097: resolve + reveal Apple Music / Spotify export links. */
    loadAlbumShelfExportLinks(overlay, item, artist, title, readOnly);

    /* v10.257: tap the artist name → open the Music Artist Profile page.
       Uses the stored artistDeezerId when present; otherwise searches Deezer
       for the artist by name and opens the top match. */
    const artistBtn = overlay.querySelector('[data-album-shelf-artist]');
    if (artistBtn) {
      artistBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (typeof window.openMusicArtistProfile !== 'function') return;
        const live = readOnly ? null : getLiveMusicItem(item.id);
        const known = String(live?.artistDeezerId || '').trim();
        if (known) {
          try {
            window.openMusicArtistProfile({
              id: known,
              deezerId: known,
              title: live?.artist || artist
            });
            return;
          } catch (_) {}
        }
        /* Fallback: search artists by name. */
        try {
          const res = await fetch(`/api/deezer/search/artist?q=${encodeURIComponent(artist)}&limit=1`);
          if (!res.ok) return;
          const d = await res.json().catch(() => null);
          const hit = Array.isArray(d?.data) ? d.data[0] : null;
          if (!hit) {
            callGlobalFn('showToast', 'Artist not found');
            return;
          }
          /* Persist the discovered id so subsequent taps skip the lookup. */
          if (live) { live.artistDeezerId = String(hit.id); callGlobalFn('save'); }
          window.openMusicArtistProfile({
            id: String(hit.id),
            deezerId: String(hit.id),
            title: hit.name
          });
        } catch (err) { console.warn('artist-name tap failed:', err); }
      });
    }

    if (!readOnly) {
      attachTrackRatingHandlers(overlay, item);
      attachAlbumRatingHandlers(overlay, item.id);
    }
    attachSwipeBackHandlers(overlay);

    /* v10.256: async enrichment — for any track that doesn't already show a
       feature ("feat." / "ft." / "featuring") AND has a Deezer track id,
       fetch the full track to pull `contributors` and append the feature
       string to the title. Updates persist via save() so future opens skip
       this enrichment. */
    if (!readOnly) {
      enrichTrackFeatures(overlay, item.id);
      backfillReleaseAndLabel(overlay, item.id);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        closeMyListAlbumPage();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);
  }

  window.openMyListAlbumPage = function(itemId) {
    const record = findMusicItemRecord(itemId);
    if (!record?.item) {
      callGlobalFn('showToast', 'Album not found in your library');
      return;
    }
    openAlbumShelfPage(record.item, {
      readOnly: !!record.readOnly,
      ownerUid: record.ownerUid,
      albumKey: getAlbumStableKey(record.item)
    });
  };

  window.parseScreenListAlbumRoute = parseScreenListAlbumRoute;
  window.openSharedAlbumRoute = openSharedAlbumRoute;
  window.finishSharedAlbumRouteAfterClose = finishSharedAlbumRouteAfterClose;
  window.shelfdLoadFavoriteAlbums = ensureFavoriteAlbumsLoaded;
  window.shelfdIsFavoriteAlbum = isAlbumFavorited;
  window.shelfdToggleFavoriteAlbum = toggleAlbumFavorite;

  function bootSharedAlbumRoute() {
    const route = parseScreenListAlbumRoute();
    if (!route) return;
    openSharedAlbumRoute(route);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSharedAlbumRoute, { once: true });
  } else {
    setTimeout(bootSharedAlbumRoute, 0);
  }
  window.addEventListener('popstate', bootSharedAlbumRoute);
})();
