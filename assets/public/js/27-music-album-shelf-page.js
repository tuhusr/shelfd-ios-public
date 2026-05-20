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
    }, 320);
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
     favorites in the shelf page. */
  function computeFavoriteRatio(item) {
    const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
    const total = tracks.length;
    if (total === 0) return { count: 0, total: 0, percent: 0 };
    let count = 0;
    for (let i = 0; i < total; i++) if (isTrackFavorited(item, i, tracks[i])) count++;
    return { count, total, percent: Math.round((count / total) * 100) };
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
    return tracks.map((t, idx) => {
      const title = escHtml(t.title || 'Untitled');
      return `
        <li class="mylist-album-shelf-track" data-album-track-index="${idx}">
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

  function formatTrackRatingLabel(rating) {
    if (!(rating > 0)) return '';
    const display = rating / 2;
    return Number.isInteger(display) ? String(display) : display.toFixed(1);
  }

  /* v10.397: emit the collapsed view (toggle) + the expanded 5-star
     widget. Container is `.mylist-album-shelf-track-rate`; CSS toggles
     the `.is-expanded` class to swap views and run the slide-out
     animation. The expanded widget reuses the `.music-rating` class
     family so all the existing color / hover / lit styling applies. */
  function buildTrackRatingWidgetHtml(item, idx, track, readOnly) {
    const rating = getTrackRating(item, idx, track);
    const itemId = String(item.id || '');
    const display = formatTrackRatingLabel(rating);
    const valueHtml = display ? `<span class="mylist-album-shelf-track-rate-value">${display} / 5</span>` : '';
    const toggleLabel = display
      ? `Rated ${display} out of 5 — tap to change`
      : 'Rate this track';
    const toggleDisabledAttrs = readOnly ? ' disabled aria-disabled="true"' : '';
    const toggleHandler = readOnly
      ? ''
      : ` onclick="event.stopPropagation();onMylistAlbumTrackRateExpand(this)"`;
    const expandedHtml = readOnly
      ? ''
      : `<div class="mylist-album-shelf-track-rate-expanded" aria-hidden="true">${buildTrackRatingStarsMarkup(itemId, idx, rating)}</div>`;
    return `
      <div class="mylist-album-shelf-track-rate${rating > 0 ? ' is-rated' : ''}" data-track-rate data-track-idx="${idx}" data-item-id="${itemId}">
        <button type="button" class="mylist-album-shelf-track-rate-toggle${rating > 0 ? ' is-rated' : ''}" aria-label="${toggleLabel}"${toggleDisabledAttrs}${toggleHandler}>
          <span class="mylist-album-shelf-track-rate-star" aria-hidden="true">★</span>
          ${valueHtml}
        </button>
        ${expandedHtml}
      </div>
    `;
  }

  /* v10.397: per-track 5-star markup. Same visual shape as the shared
     buildMusicRatingMarkup (10 half-step buttons via text-indent trick)
     but the inline onclick targets a track-scoped handler, since the
     global rate() function only routes to overall/season/episode. */
  function buildTrackRatingStarsMarkup(itemId, idx, rating) {
    const size = 22;
    const halfWidth = Math.max(1, Math.round(size / 2));
    const cleanRating = Number(rating || 0);
    const escId = String(itemId).replace(/'/g, "\\'");
    const styleAttr = `style="--music-star-size:${size}px;--music-half-width:${halfWidth}px;"`;
    let html = `<div class="music-rating" ${styleAttr} data-item-id="${escId}__track${idx}" data-prefix="track:${idx}" data-section="music">`;
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      const leftLit = leftVal <= cleanRating ? ' lit' : '';
      const rightLit = rightVal <= cleanRating ? ' lit' : '';
      html += `<button type="button" class="music-rating-half music-rating-half-left${leftLit}" data-star="${leftVal}" onclick="event.stopPropagation();onMylistAlbumTrackRate('${escId}',${idx},${leftVal})">★</button>`;
      html += `<button type="button" class="music-rating-half music-rating-half-right${rightLit}" data-star="${rightVal}" onclick="event.stopPropagation();onMylistAlbumTrackRate('${escId}',${idx},${rightVal})">★</button>`;
    }
    html += `</div>`;
    return html;
  }

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
    if (typeof window !== 'undefined' && typeof window.persistOwnListDataImmediate === 'function') {
      window.persistOwnListDataImmediate().catch(err => {
        console.warn('[track-rating] immediate save failed, fell back to debounced:', err);
        callGlobalFn('save');
      });
    } else {
      callGlobalFn('save');
    }
  }

  /* v10.397: window-exposed handlers — wired from inline onclick on the
     collapsed toggle (Expand) and the expanded stars (Rate). The
     expand-on-tap UX is intentional: keeps the row compact when not in
     use, and the leftward slide makes the rating affordance obvious. */
  window.onMylistAlbumTrackRateExpand = function(btn) {
    if (!btn || btn.disabled) return;
    const widget = btn.closest('.mylist-album-shelf-track-rate');
    if (!widget) return;
    /* Collapse any other open track-rating widget first so only one is
       expanded at a time — keeps the layout from getting noisy. */
    document.querySelectorAll('.mylist-album-shelf-track-rate.is-expanded').forEach(w => {
      if (w !== widget) w.classList.remove('is-expanded');
    });
    widget.classList.add('is-expanded');
  };

  window.onMylistAlbumTrackRate = function(itemId, idx, score) {
    const widget = document.querySelector(
      `.mylist-album-shelf-track-rate[data-item-id="${CSS.escape(String(itemId))}"][data-track-idx="${idx}"]`
    );
    if (!widget) return;
    const live = getLiveMusicItem(itemId);
    if (!live) return;
    const trackRef = Array.isArray(live.tracks) ? live.tracks[idx] : null;
    const prev = getTrackRating(live, idx, trackRef);
    const requested = Number(score) || 0;
    /* Tap on the existing rating value = clear the rating (matches the
       same toggle-off behavior `rate()` has for the overall rating). */
    const newScore = prev === requested ? 0 : requested;
    commitTrackRating(itemId, idx, newScore, trackRef);

    /* Repaint lit state IN-PLACE on the open expanded widget so the
       star-pop animation has the right targets to play on, then collapse
       and swap to the fresh collapsed view ~600ms later. */
    const halves = widget.querySelectorAll('.music-rating-half');
    const litTargets = [];
    halves.forEach((b, i) => {
      const shouldLit = (i + 1) <= newScore;
      b.classList.toggle('lit', shouldLit);
      if (shouldLit) litTargets.push(b);
    });
    const stagger = 50;
    litTargets.forEach((star, i) => {
      star.classList.remove('star-pop');
      void star.offsetWidth;
      setTimeout(() => star.classList.add('star-pop'), i * stagger);
      setTimeout(() => star.classList.remove('star-pop'), i * stagger + 500);
    });

    setTimeout(() => {
      const liveAgain = getLiveMusicItem(itemId);
      if (!liveAgain) {
        widget.classList.remove('is-expanded');
        return;
      }
      const fresh = buildTrackRatingWidgetHtml(liveAgain, idx, liveAgain.tracks?.[idx], false);
      const tmp = document.createElement('div');
      tmp.innerHTML = fresh;
      const replacement = tmp.firstElementChild;
      if (replacement) widget.replaceWith(replacement);
      else widget.classList.remove('is-expanded');
    }, 600);
  };

  /* Outside-click closes any expanded track rating without committing. */
  if (typeof window !== 'undefined' && !window.__shelfdAlbumTrackRateOutsideBound) {
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || target.nodeType !== 1) return;
      if (target.closest && target.closest('.mylist-album-shelf-track-rate.is-expanded')) return;
      document.querySelectorAll('.mylist-album-shelf-track-rate.is-expanded').forEach(w => {
        w.classList.remove('is-expanded');
      });
    }, true);
    window.__shelfdAlbumTrackRateOutsideBound = true;
  }

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
  function renderAlbumRatingHtml(item) {
    const itemId = item?.id || '';
    const rating = Number(item?.rating || 0);
    const interactive = !window.viewingUser;
    const ratio = computeFavoriteRatio(item);
    const ratingMarkup = typeof window.buildMusicRatingMarkup === 'function'
      ? window.buildMusicRatingMarkup(rating, itemId, 'overall', 28, interactive)
      : `<div class="music-rating" data-item-id="${itemId}" data-prefix="overall" data-section="music"></div>`;
    return `
      <section class="mylist-album-shelf-rating" data-album-rating>
        <div class="mylist-album-shelf-rating-label">Your rating</div>
        ${ratingMarkup}
        <div class="mylist-album-shelf-fav-ratio" data-album-fav-ratio>
          <span data-album-fav-ratio-text>${ratio.total === 0 ? '—' : `${ratio.percent}%`}</span>
        </div>
      </section>
    `;
  }
  /* v10.255: refresh the favorite ratio readout from live data. Called after
     every favorite toggle so the percentage stays in sync. */
  function refreshFavoriteRatio(overlay, itemId) {
    const txt = overlay.querySelector('[data-album-fav-ratio-text]');
    if (!txt) return;
    const live = getLiveMusicItem(itemId);
    if (!live) return;
    const ratio = computeFavoriteRatio(live);
    txt.textContent = ratio.total === 0 ? '—' : `${ratio.percent}%`;
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
    const url = new URL(`/album/${encodeURIComponent(ownerUid)}/${encodeURIComponent(albumKey)}`, window.location.origin);
    const title = String(item.title || '').trim();
    const artist = String(item.artist || '').trim();
    const cover = getAlbumCover(item);
    if (title) url.searchParams.set('title', title);
    if (artist) url.searchParams.set('artist', artist);
    if (/^https?:\/\//i.test(cover)) url.searchParams.set('poster', cover);
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
          </div>
          ${readOnly ? '' : renderAlbumRatingHtml(item)}
          <section class="mylist-album-shelf-tracks">
            <div class="mylist-album-shelf-tracks-heading">Tracks</div>
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
