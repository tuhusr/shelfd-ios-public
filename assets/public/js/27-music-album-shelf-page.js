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
    if (opts.instant) {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('mylist-album-shelf-open');
      return;
    }
    overlay.classList.remove('is-open');
    setTimeout(() => {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('mylist-album-shelf-open');
    }, 320);
  }
  window.closeMyListAlbumPage = closeMyListAlbumPage;

  function findMusicItem(itemId) {
    /* v10.292: try friend's data first when viewing someone else's MyList
       (so viewers can OPEN the tracklist). Fall back to own data, which is
       the canonical source for any write paths (rating, fav-track stars).
       resolveLibraryData() always returns own data — separate by design. */
    const friendData = resolveFriendLibraryData();
    if (friendData && Array.isArray(friendData.music)) {
      const fromFriend = friendData.music.find(it => String(it?.id || '') === String(itemId));
      if (fromFriend) return fromFriend;
    }
    const data = resolveLibraryData();
    if (!data || !Array.isArray(data.music)) return null;
    return data.music.find(it => String(it?.id || '') === String(itemId)) || null;
  }

  /* v10.253: track rows now use a simple FAVORITE star (boolean) instead of
     a 10-star rating. Single tap toggles "this is one of my favorites on the
     album" on/off. Backward compat: any legacy item.trackRatings[i] > 0 is
     treated as favorited so users don't lose pre-existing data. */
  function isTrackFavorited(item, idx) {
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
    for (let i = 0; i < total; i++) if (isTrackFavorited(item, i)) count++;
    return { count, total, percent: Math.round((count / total) * 100) };
  }
  function renderTracksHtml(item) {
    const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
    if (!tracks.length) {
      return '<li class="mylist-album-shelf-track-empty">No tracks listed for this album.</li>';
    }
    return tracks.map((t, idx) => {
      const num = String(t.number || idx + 1);
      const title = escHtml(t.title || 'Untitled');
      const fav = isTrackFavorited(item, idx);
      return `
        <li class="mylist-album-shelf-track" data-album-track-index="${idx}">
          <span class="mylist-album-shelf-track-num">${escHtml(num)}</span>
          <span class="mylist-album-shelf-track-title">${title}</span>
          <button type="button" class="mylist-album-shelf-track-fav${fav ? ' is-fav' : ''}" data-album-track-fav aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'Remove from favorites' : 'Mark as favorite'}">
            <span class="star-btn${fav ? ' lit' : ''}" aria-hidden="true">&#9733;</span>
          </button>
        </li>
      `;
    }).join('');
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
     entries are preserved but ignored for new writes. */
  function commitTrackFavorite(itemId, trackIdx, isFav) {
    const live = getLiveMusicItem(itemId);
    if (!live) return;
    if (!Array.isArray(live.trackFavorites)) live.trackFavorites = [];
    live.trackFavorites[trackIdx] = !!isFav;
    callGlobalFn('save');
    callGlobalFn('markOwnItemLastEdited', live, 'music');
  }

  function attachTrackRatingHandlers(overlay, item) {
    const itemId = item.id;
    overlay.querySelectorAll('.mylist-album-shelf-track').forEach(row => {
      const idx = Number(row.getAttribute('data-album-track-index') || '0');
      const favBtn = row.querySelector('[data-album-track-fav]');
      if (!favBtn) return;
      favBtn.addEventListener('click', e => {
        e.stopPropagation();
        const live = getLiveMusicItem(itemId);
        if (!live) return;
        const next = !isTrackFavorited(live, idx);
        commitTrackFavorite(itemId, idx, next);
        favBtn.classList.toggle('is-fav', next);
        favBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
        favBtn.setAttribute('aria-label', next ? 'Remove from favorites' : 'Mark as favorite');
        const starInner = favBtn.querySelector('.star-btn');
        if (starInner) {
          starInner.classList.toggle('lit', next);
          /* Star-pop animation — same keyframe used everywhere else. */
          starInner.classList.remove('star-pop');
          void starInner.offsetWidth;
          starInner.classList.add('star-pop');
          setTimeout(() => starInner.classList.remove('star-pop'), 460);
        }
        /* v10.255: keep the favorite-ratio readout in sync after every toggle. */
        refreshFavoriteRatio(overlay, itemId);
      });
    });
  }

  /* v10.253: album-level 10-star rating widget that sits between the hero
     and the tracklist. Mirrors the existing Shelfd rating pattern (`.stars
     .star-btn`, hover preview, click, `.lit` color, star-pop). Edits commit
     to `item.rating` and ride the same save() pipeline as everything else,
     so the rating shows up on the my-list title card, the activity card,
     the FPReview, etc. */
  function renderAlbumRatingHtml(item) {
    const rating = Number(item?.rating || 0);
    const stars = [];
    for (let s = 1; s <= 10; s++) {
      stars.push(`<button type="button" class="star-btn${s <= rating ? ' lit' : ''}" data-album-rating-star="${s}" aria-label="Rate ${s} of 10">&#9733;</button>`);
    }
    const ratio = computeFavoriteRatio(item);
    return `
      <section class="mylist-album-shelf-rating" data-album-rating>
        <div class="mylist-album-shelf-rating-label">Your rating</div>
        <div class="stars mylist-album-shelf-rating-stars" style="--star-size:26px;" data-album-rating-stars>${stars.join('')}</div>
        <div class="mylist-album-shelf-fav-ratio" data-album-fav-ratio>
          <span class="mylist-album-shelf-fav-ratio-icon" aria-hidden="true">&#9733;</span>
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
  function attachAlbumRatingHandlers(overlay, itemId) {
    const ratingZone = overlay.querySelector('[data-album-rating]');
    if (!ratingZone) return;
    const starsHost = ratingZone.querySelector('[data-album-rating-stars]');
    if (!starsHost) return;
    const starBtns = Array.from(starsHost.querySelectorAll('.star-btn'));
    const currentRating = () => {
      const live = getLiveMusicItem(itemId);
      return Number(live?.rating || 0);
    };
    function previewStars(value) {
      starBtns.forEach((b, i) => b.classList.toggle('lit', (i + 1) <= value));
    }
    function commitRating(value) {
      const live = getLiveMusicItem(itemId);
      if (!live) return;
      live.rating = Number(value || 0);
      callGlobalFn('save');
      callGlobalFn('markOwnItemLastEdited', live, 'music');
      previewStars(value);
    }
    starBtns.forEach((btn, i) => {
      const v = i + 1;
      btn.addEventListener('mouseenter', () => previewStars(v));
      btn.addEventListener('mouseleave', () => previewStars(currentRating()));
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const newVal = currentRating() === v ? 0 : v;
        commitRating(newVal);
        btn.classList.remove('star-pop');
        void btn.offsetWidth;
        btn.classList.add('star-pop');
        setTimeout(() => btn.classList.remove('star-pop'), 460);
      });
    });
    /* Touch scrub across the row to set a rating. */
    starsHost.addEventListener('touchmove', e => {
      const touch = e.touches?.[0];
      if (!touch) return;
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el && el.dataset && el.dataset.albumRatingStar) {
        const v = Number(el.dataset.albumRatingStar) || 0;
        previewStars(v);
        ratingZone.dataset.scrubValue = String(v);
        e.preventDefault?.();
      }
    }, { passive: false });
    starsHost.addEventListener('touchend', () => {
      const v = Number(ratingZone.dataset.scrubValue || '0');
      if (v > 0) commitRating(v);
      ratingZone.dataset.scrubValue = '';
    }, { passive: true });
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

  window.openMyListAlbumPage = function(itemId) {
    const item = findMusicItem(itemId);
    if (!item) {
      callGlobalFn('showToast', 'Album not found in your library');
      return;
    }
    closeMyListAlbumPage({ instant: true });

    const title = item.title || 'Untitled';
    const artist = item.artist || '';
    const cover = item.cover || '';
    const year = item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '');
    const genre = String(item.genre || '').trim();

    const overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.className = 'mylist-album-shelf-page';
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
          <span class="mylist-album-shelf-topbar-spacer" aria-hidden="true"></span>
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
          ${renderAlbumRatingHtml(item)}
          <section class="mylist-album-shelf-tracks">
            <div class="mylist-album-shelf-tracks-heading">Tracks</div>
            <ol class="mylist-album-shelf-track-list" data-album-track-list>
              ${renderTracksHtml(item)}
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

    /* v10.257: tap the artist name → open the Music Artist Profile page.
       Uses the stored artistDeezerId when present; otherwise searches Deezer
       for the artist by name and opens the top match. */
    const artistBtn = overlay.querySelector('[data-album-shelf-artist]');
    if (artistBtn) {
      artistBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (typeof window.openMusicArtistProfile !== 'function') return;
        const live = getLiveMusicItem(item.id);
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

    attachTrackRatingHandlers(overlay, item);
    attachAlbumRatingHandlers(overlay, item.id);
    attachSwipeBackHandlers(overlay);

    /* v10.256: async enrichment — for any track that doesn't already show a
       feature ("feat." / "ft." / "featuring") AND has a Deezer track id,
       fetch the full track to pull `contributors` and append the feature
       string to the title. Updates persist via save() so future opens skip
       this enrichment. */
    enrichTrackFeatures(overlay, item.id);
    backfillReleaseAndLabel(overlay, item.id);

    function onKey(e) {
      if (e.key === 'Escape') {
        closeMyListAlbumPage();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);
  };
})();
