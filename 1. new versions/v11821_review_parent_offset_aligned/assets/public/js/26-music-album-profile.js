/* =========================================================================
   v10.233 / v10.234: Music Album Profile page.
   ------------------------------------------------------------------------
   Slides in from the right when a user taps an album in the universal search.
   v10.234 adds:
     - Release date, genre, runtime, and full track list (fetched on open)
     - Fixed Add to Shelf bug: was reading `window.data` which is undefined
       (script-scoped `let data` in 04-shared-utils-data.js never lands on
       window). Now resolves the live `data` via a getter that walks each
       known global pattern.
     - Album cover sits flat (border-radius: 0) per spec.
   ========================================================================= */

(function initMusicAlbumProfileModule() {
  const OVERLAY_ID = 'music-album-profile-page';

  function escAttrLocal(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtmlLocal(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* v10.234: resolve the user's library `data` object. The base script
     declares it as `let data = ...;` at top-level, which makes it
     script-scoped (accessible to subsequent classic scripts as a bare
     reference) but does NOT land on `window`. We try the bare ref first
     via Function ctor (catches the script-scoped binding even from inside
     this IIFE), then fall back to a few common globals. */
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

  function closeMusicAlbumProfile(opts = {}) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      document.body.classList.remove('music-album-profile-open');
      return;
    }
    if (opts.instant) {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('music-album-profile-open');
      return;
    }
    overlay.classList.remove('is-open');
    setTimeout(() => {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('music-album-profile-open');
    }, 320);
  }
  window.closeMusicAlbumProfile = closeMusicAlbumProfile;

  /* v10.251: shelf-membership lookup. Returns the existing my-list music
     entry if the user already has this album in their library, otherwise
     null. Matches by deezerId first, then mbid, then title+artist key. */
  function findExistingShelfItem(album) {
    const data = resolveLibraryData();
    if (!data || !Array.isArray(data.music)) return null;
    const dz = String(album?.deezerId || '').trim();
    const mb = String(album?.mbid || '').trim();
    const titleKey = `${album?.title || ''}::${album?.artist || ''}`.toLowerCase();
    return data.music.find(it => {
      const itDz = String(it?.deezerId || '').trim();
      if (dz && itDz && itDz === dz) return true;
      const itMb = String(it?.mbid || '').trim();
      if (mb && itMb && itMb === mb) return true;
      return `${it?.title || ''}::${it?.artist || ''}`.toLowerCase() === titleKey;
    }) || null;
  }

  function addAlbumToShelf(album, status = 'watched') {
    const data = resolveLibraryData();
    if (!data) {
      callGlobalFn('showToast', 'Sign in to save albums to your shelf');
      return false;
    }
    if (!Array.isArray(data.music)) data.music = [];
    const mbid = String(album.mbid || album.id || '').trim();
    const deezerId = String(album.deezerId || '').trim();
    const titleKey = `${album.title || ''}::${album.artist || ''}`.toLowerCase();
    const already = data.music.some(it => {
      const itDz = String(it?.deezerId || '').trim();
      if (deezerId && itDz && itDz === deezerId) return true;
      const itKey = String(it?.mbid || it?.id || '').trim();
      if (mbid && itKey && itKey === mbid) return true;
      return `${it?.title || ''}::${it?.artist || ''}`.toLowerCase() === titleKey;
    });
    if (already) {
      callGlobalFn('showToast', 'Already in your Music shelf');
      return false;
    }
    const nowIso = new Date().toISOString();
    const newItem = {
      id: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : ('music-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
      mbid,
      deezerId: String(album.deezerId || ''),
      title: album.title || '',
      artist: album.artist || '',
      artistDeezerId: String(album.artistDeezerId || ''),
      year: album.year || '',
      releaseDate: album.releaseDate || '',
      genre: album.genre || '',
      label: String(album.label || '').trim(),
      runtimeMs: Number(album.runtimeMs || 0),
      tracks: Array.isArray(album.tracks) ? album.tracks : [],
      cover: album.poster || album.cover || '',
      /* v10.258: status is now a parameter — "watched" = Listened, "planned" = Planned. */
      status: status === 'planned' ? 'planned' : 'watched',
      librarySection: 'music',
      mediaCategory: 'music',
      rating: 0,
      dateAdded: nowIso,
      createdAt: nowIso,
      lastEditedAt: nowIso
    };
    data.music.unshift(newItem);
    callGlobalFn('save');
    callGlobalFn('markOwnItemLastEdited', newItem, 'music');
    callGlobalFn('showToast', `Added "${album.title || ''}" to your Music shelf`);
    return true;
  }

  /* v10.248: Deezer is now the primary metadata source. Real cover art,
     proper tracklist with durations + features already in the title strings,
     genre via /album/{id}.genres.data, release_date in ISO format. */
  async function hydrateAlbumDetailsFromDeezer(deezerId) {
    if (!deezerId) return null;
    try {
      const res = await fetch(`/api/deezer/album/${encodeURIComponent(deezerId)}`);
      if (!res.ok) return null;
      const d = await res.json().catch(() => null);
      if (!d || d.error) return null;
      const tracks = Array.isArray(d.tracks?.data) ? d.tracks.data : [];
      const genres = Array.isArray(d.genres?.data) ? d.genres.data.map(g => g.name).filter(Boolean) : [];
      const runtimeMs = tracks.reduce((sum, t) => sum + Number(t.duration || 0) * 1000, 0);
      /* v10.256: build the displayed track title with feature attribution.
         Deezer puts features in `title_version` (e.g. "(feat. Pusha T)") for
         most tracks. If the title already contains a "feat" marker, leave
         it alone. Track also carries its Deezer id so we can later async-
         fetch contributors for tracks that have features baked into neither
         `title` nor `title_version`. */
      function composeTrackTitle(t) {
        const base = String(t.title || 'Untitled').trim();
        const version = String(t.title_version || '').trim();
        if (!version) return base;
        if (/feat\.?|featuring/i.test(base)) return base;
        // Avoid double-appending when title_short + title already include the version.
        if (base.toLowerCase().endsWith(version.toLowerCase())) return base;
        return `${base} ${version}`.trim();
      }
      return {
        title: d.title || '',
        artist: d.artist?.name || '',
        artistDeezerId: String(d.artist?.id || ''),
        releaseDate: d.release_date || '',
        primaryType: 'Album',
        genre: genres[0] || '',
        label: String(d.label || '').trim(),
        runtimeMs,
        tracks: tracks.map((t, i) => ({
          number: t.track_position || (i + 1),
          title: composeTrackTitle(t),
          length: Number(t.duration || 0) * 1000,
          deezerId: String(t.id || ''),
          hasFeatures: /feat\.?|featuring/i.test(composeTrackTitle(t))
        })),
        cover: d.cover_xl || d.cover_big || d.cover_medium || '',
        deezerId: String(d.id || deezerId)
      };
    } catch (e) {
      console.warn('hydrateAlbumDetailsFromDeezer failed:', e);
      return null;
    }
  }
  /* v10.234: fetch release-group metadata + first release tracklist so the
     profile shows release date, genre, runtime, and the full track list. */
  async function hydrateAlbumDetails(mbid) {
    if (!mbid) return null;
    try {
      const rgUrl = `/api/musicbrainz/release-group/${encodeURIComponent(mbid)}?inc=releases+genres+tags+artists&fmt=json`;
      const rgRes = await fetch(rgUrl);
      if (!rgRes.ok) return null;
      const rg = await rgRes.json().catch(() => null);
      if (!rg) return null;

      const credits = Array.isArray(rg['artist-credit']) ? rg['artist-credit'] : [];
      const artist = credits
        .map(c => (c?.name || c?.artist?.name || '') + (c?.joinphrase || ''))
        .join('')
        .trim();
      const releaseDate = String(rg['first-release-date'] || '').trim();
      const primaryType = String(rg['primary-type'] || '').trim();
      const genres = Array.isArray(rg.genres) ? rg.genres.map(g => g.name).filter(Boolean) : [];
      const tags = Array.isArray(rg.tags) ? rg.tags.map(t => t.name).filter(Boolean) : [];
      const genre = (genres[0] || tags[0] || '').replace(/\b\w/g, c => c.toUpperCase());

      /* Pick the earliest official release with a matching first-release-date
         (or just the first release returned) and fetch its tracklist.
         v10.244: also `inc=artist-credits` so each track exposes its own
         artist-credit chain (needed for "feat." artists). Without this, MB
         only returns the release's primary artist and feature artists are
         invisible. */
      const releases = Array.isArray(rg.releases) ? rg.releases : [];
      let chosen = releases.find(r => r.date === releaseDate) || releases[0] || null;
      let tracks = [];
      let runtimeMs = 0;
      const primaryArtistNorm = String(artist || '').toLowerCase().trim();
      if (chosen?.id) {
        try {
          const relUrl = `/api/musicbrainz/release/${encodeURIComponent(chosen.id)}?inc=recordings+artist-credits&fmt=json`;
          const relRes = await fetch(relUrl);
          if (relRes.ok) {
            const rel = await relRes.json().catch(() => null);
            const media = Array.isArray(rel?.media) ? rel.media : [];
            media.forEach(m => {
              const trackArr = Array.isArray(m?.tracks) ? m.tracks : [];
              trackArr.forEach(t => {
                const len = Number(t?.length || t?.recording?.length || 0);
                runtimeMs += len;
                /* Compose the track-level artist string from MB's artist-credit
                   array (preferring the track over the underlying recording).
                   Each credit entry can carry a `joinphrase` (e.g. " feat. ",
                   " & ", ", "), which we concatenate to recreate the original
                   credit line exactly as MB editors entered it. */
                const trackCredits = Array.isArray(t['artist-credit']) ? t['artist-credit']
                  : Array.isArray(t.recording?.['artist-credit']) ? t.recording['artist-credit']
                  : [];
                const trackArtistStr = trackCredits
                  .map(c => (c?.name || c?.artist?.name || '') + (c?.joinphrase || ''))
                  .join('')
                  .trim();
                let titleStr = t.title || t.recording?.title || 'Untitled';
                /* If the track's artist-credit differs from the album's
                   primary artist (i.e. has features), append the surplus
                   artists as "(feat. X, Y)" — but only when the title
                   doesn't already include a feature marker (avoids the
                   "Title (feat. X) (feat. X)" duplication that happens
                   when MB editors bake "feat." into the title itself). */
                if (trackArtistStr && primaryArtistNorm) {
                  const trackArtistNorm = trackArtistStr.toLowerCase();
                  const hasFeatureMarker = /\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(titleStr);
                  const isDifferentArtist = trackArtistNorm !== primaryArtistNorm
                    && !primaryArtistNorm.includes(trackArtistNorm)
                    && !trackArtistNorm.includes(primaryArtistNorm);
                  if ((isDifferentArtist || trackArtistNorm.includes('feat')) && !hasFeatureMarker) {
                    /* Pull every extra credit name beyond the album's primary
                       artist for the (feat. …) tail. */
                    const extraNames = trackCredits
                      .map(c => String(c?.name || c?.artist?.name || '').trim())
                      .filter(n => n && n.toLowerCase() !== primaryArtistNorm);
                    if (extraNames.length) {
                      titleStr += ' (feat. ' + extraNames.join(', ') + ')';
                    }
                  }
                }
                tracks.push({
                  number: t.number || tracks.length + 1,
                  title: titleStr,
                  length: len,
                  trackArtist: trackArtistStr
                });
              });
            });
          }
        } catch (_) {}
      }

      return {
        title: rg.title || '',
        artist,
        releaseDate,
        primaryType,
        genre,
        runtimeMs,
        tracks
      };
    } catch (e) {
      console.warn('hydrateAlbumDetails failed:', e);
      return null;
    }
  }

  function formatTrackLength(ms) {
    const n = Number(ms || 0);
    if (!n || !isFinite(n)) return '';
    const total = Math.round(n / 1000);
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  function formatRuntime(ms) {
    const n = Number(ms || 0);
    if (!n || !isFinite(n)) return '';
    const total = Math.round(n / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  function formatReleaseDate(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
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

  /* v11.067: open an external music service. Prefers the native app URI
     (music:// or spotify:) so the EXACT album opens inside the app rather than
     a website. If the app isn't installed (the page stays visible), fall back
     to the web link. window.open(..,'_system') hands the URL to the OS in the
     Capacitor iOS build. */
  function openMusicServiceTarget(appUri, webUrl) {
    const app = String(appUri || '');
    const web = String(webUrl || '');
    const primary = app || web;
    if (!primary) return;
    let switched = false;
    const onHide = () => { switched = true; };
    document.addEventListener('visibilitychange', onHide, { once: true });
    window.addEventListener('pagehide', onHide, { once: true });
    try {
      window.open(primary, '_system');
    } catch (_) {
      try { window.location.href = primary; } catch (__) {}
    }
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

  function wireMusicExport(anchor, appUri, webUrl) {
    if (!anchor) return;
    anchor.setAttribute('href', webUrl || appUri || '#');
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMusicServiceTarget(appUri, webUrl);
    });
  }

  window.openMusicAlbumProfile = function(album) {
    if (!album) return;
    closeMusicAlbumProfile({ instant: true });

    const title = album.title || 'Untitled Album';
    const artist = album.artist || 'Unknown Artist';
    const year = album.year || '';
    const poster = album.poster || album.cover || '';
    const mbid = album.mbid || album.id || '';

    const overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.className = 'music-album-profile-page';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${title} by ${artist}`);

    overlay.innerHTML = `
      <div class="music-album-profile-shell">
        <header class="music-album-profile-topbar">
          <button type="button" class="music-album-profile-back" data-music-profile-back aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="music-album-profile-title">Album</span>
          <span class="music-album-profile-topbar-spacer" aria-hidden="true"></span>
        </header>
        <main class="music-album-profile-content">
          <div class="music-album-profile-hero">
            <div class="music-album-profile-cover${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttrLocal(poster)}')"` : ''}>
              ${poster ? '' : '<span aria-hidden="true">🎵</span>'}
            </div>
            <div class="music-album-profile-meta">
              <h1 class="music-album-profile-album-title" data-album-title>${escHtmlLocal(title)}</h1>
              <div class="music-album-profile-artist" data-album-artist>${escHtmlLocal(artist)}</div>
              <!-- v10.701: facts re-ordered left-to-right Genre → Runtime → Release date.
                   CSS forces a single horizontal row (3 explicit columns) so they
                   never stack vertically on narrower viewports. Data-fact-*
                   selectors unchanged, so the hydrate code in this file still
                   wires values to the correct cells regardless of DOM order. -->
              <dl class="music-album-profile-facts" data-album-facts>
                <div class="music-album-profile-fact" data-fact-genre>
                  <dt>Genre</dt>
                  <dd>—</dd>
                </div>
                <div class="music-album-profile-fact" data-fact-runtime>
                  <dt>Runtime</dt>
                  <dd>—</dd>
                </div>
                <div class="music-album-profile-fact" data-fact-release>
                  <dt>Release date</dt>
                  <dd>${escHtmlLocal(year || '—')}</dd>
                </div>
              </dl>
              <!-- v11.067: export links — open the EXACT album inside the Apple
                   Music / Spotify apps (resolved via /api/music-links). Hidden
                   until the links resolve. -->
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
          </div>
          <div class="music-album-profile-add-zone" data-music-profile-add-zone>
            <button type="button" class="music-album-profile-add-btn" data-music-profile-add-toggle>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Add to Shelf</span>
            </button>
            <div class="music-album-profile-add-row" data-music-profile-add-choices hidden>
              <!-- v10.897: removed the "In Rotation" choice. Music section
                   now exposes only Listened + Planned; legacy 'watching'
                   data is auto-migrated to 'watched' on read. -->
              <button type="button" class="music-album-profile-add-choice" data-music-profile-add data-add-status="watched">
                <span>Listened</span>
              </button>
              <button type="button" class="music-album-profile-add-choice" data-music-profile-add data-add-status="planned">
                <span>Planned</span>
              </button>
            </div>
            <button type="button" class="music-album-profile-add-btn music-album-profile-already-added" data-music-profile-in-shelf hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              <span data-music-profile-in-shelf-label>Already Added</span>
            </button>
          </div>
          <section class="music-album-profile-tracks" data-album-tracks>
            <div class="music-album-profile-tracks-heading">Tracks</div>
            <ol class="music-album-profile-track-list" data-album-track-list>
              <li class="music-album-profile-track-loading">Loading tracks…</li>
            </ol>
          </section>
        </main>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('music-album-profile-open');
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));

    /* State for Add button — populated by hydration. */
    const state = {
      title, artist, year, poster, mbid,
      releaseDate: '',
      genre: '',
      runtimeMs: 0,
      tracks: []
    };

    /* Hydrate details. Deezer first (real tracklist + cover + genre), MB
       fallback only when no Deezer id was passed in. v10.248. */
    const deezerId = album.deezerId || (String(mbid || '').startsWith('deezer-album-') ? String(mbid).replace('deezer-album-', '') : '');

    /* v11.067: resolve + reveal the Apple Music / Spotify export links. Runs
       independently of hydration using the deezerId (or artist+title fallback
       the worker resolves). Tapping opens the EXACT album in the native app
       via /api/music-links, with a website fallback if the app isn't installed. */
    (function loadMusicExportLinks() {
      const wrap = overlay.querySelector('[data-album-exports]');
      if (!wrap) return;
      const appleA = wrap.querySelector('[data-export-apple]');
      const spotifyA = wrap.querySelector('[data-export-spotify]');
      const params = new URLSearchParams();
      const deezerNumeric = String(deezerId || '').replace(/[^0-9]/g, '');
      if (deezerNumeric) params.set('deezerId', deezerNumeric);
      if (artist) params.set('artist', artist);
      if (title) params.set('title', title);
      if (![...params.keys()].length) return;
      fetch(`/api/music-links?${params.toString()}`)
        .then(r => (r && r.ok) ? r.json() : null)
        .then(data => {
          if (!data || !data.ok || !overlay.isConnected) return;
          let any = false;
          if (data.appleMusic && appleA) {
            wireMusicExport(appleA, data.appleMusic.app, data.appleMusic.web);
            appleA.hidden = false; any = true;
          }
          if (data.spotify && spotifyA) {
            wireMusicExport(spotifyA, data.spotify.app, data.spotify.web);
            spotifyA.hidden = false; any = true;
          }
          if (any) wrap.hidden = false;
        })
        .catch(() => {});
    })();

    const hydratePromise = deezerId
      ? hydrateAlbumDetailsFromDeezer(deezerId).then(d => d || hydrateAlbumDetails(mbid))
      : hydrateAlbumDetails(mbid);
    hydratePromise.then(details => {
      if (!details) {
        const tl = overlay.querySelector('[data-album-track-list]');
        if (tl) tl.innerHTML = '<li class="music-album-profile-track-empty">Track list unavailable</li>';
        return;
      }
      // Update state
      state.releaseDate = details.releaseDate || '';
      state.genre = details.genre || '';
      state.runtimeMs = details.runtimeMs || 0;
      state.tracks = details.tracks || [];
      if (details.artist && !state.artist) state.artist = details.artist;
      if (details.artistDeezerId) state.artistDeezerId = details.artistDeezerId;
      if (details.label) state.label = details.label;
      if (details.cover && !state.poster) state.poster = details.cover;
      /* v10.248: upgrade the hero cover to Deezer's 1000×1000 cover_xl when
         the hydrate flow returns one. */
      if (details.cover) {
        const coverEl = overlay.querySelector('.music-album-profile-cover');
        if (coverEl) {
          coverEl.classList.remove('no-img');
          coverEl.innerHTML = '';
          coverEl.style.backgroundImage = `url('${String(details.cover).replace(/'/g, "\\'")}')`;
        }
        state.poster = details.cover;
      }
      if (details.deezerId) state.deezerId = details.deezerId;
      /* v10.251: re-check shelf membership after hydration in case the
         deezerId was only resolved via hydrate. */
      syncAddBtnState();

      // Update DOM
      const releaseEl = overlay.querySelector('[data-fact-release] dd');
      const genreEl = overlay.querySelector('[data-fact-genre] dd');
      const runtimeEl = overlay.querySelector('[data-fact-runtime] dd');
      if (releaseEl) releaseEl.textContent = formatReleaseDate(state.releaseDate) || state.year || '—';
      if (genreEl) genreEl.textContent = state.genre || '—';
      if (runtimeEl) runtimeEl.textContent = formatRuntime(state.runtimeMs) || '—';

      const tl = overlay.querySelector('[data-album-track-list]');
      if (tl) {
        if (state.tracks.length === 0) {
          tl.innerHTML = '<li class="music-album-profile-track-empty">No tracks listed</li>';
        } else {
          tl.innerHTML = state.tracks.map(t => `
            <li class="music-album-profile-track">
              <span class="music-album-profile-track-num">${escHtmlLocal(String(t.number || ''))}</span>
              <span class="music-album-profile-track-title">${escHtmlLocal(t.title || 'Untitled')}</span>
              <span class="music-album-profile-track-length">${escHtmlLocal(formatTrackLength(t.length))}</span>
            </li>
          `).join('');
        }
      }
    }).catch(() => {
      const tl = overlay.querySelector('[data-album-track-list]');
      if (tl) tl.innerHTML = '<li class="music-album-profile-track-empty">Track list unavailable</li>';
    });

    /* Wire actions */
    const backBtn = overlay.querySelector('[data-music-profile-back]');
    /* v10.258: addBtn is now the per-status buttons + the in-shelf pill, wired below. */
    if (backBtn) backBtn.addEventListener('click', () => closeMusicAlbumProfile());
    /* v10.262: Add zone.
       - Default: single "Add to Shelf" pill (the toggle).
       - Tap toggle → reveal small buttons in one row.
       - When the album is already in the user's library → both states are
         hidden and replaced with "Already Added · {status}" pill. Tap it
         to deep-link into the my-list album shelf page.
       v10.897: dropped the "In Rotation" choice. Only Listened + Planned
       remain. Any legacy 'watching' status maps to Listened. */
    const addToggleBtn = overlay.querySelector('[data-music-profile-add-toggle]');
    const addChoicesEl = overlay.querySelector('[data-music-profile-add-choices]');
    const inShelfBtn = overlay.querySelector('[data-music-profile-in-shelf]');
    const inShelfLabel = overlay.querySelector('[data-music-profile-in-shelf-label]');
    function statusLabelForKey(key) {
      if (key === 'planned') return 'Planned';
      /* v10.897: stale 'watching' now reads as Listened. */
      return 'Listened';
    }
    function syncAddBtnState() {
      const existing = findExistingShelfItem({
        title: state.title,
        artist: state.artist,
        mbid: state.mbid,
        deezerId: state.deezerId || ''
      });
      if (existing) {
        if (addToggleBtn) addToggleBtn.hidden = true;
        if (addChoicesEl) addChoicesEl.hidden = true;
        if (inShelfBtn) {
          inShelfBtn.hidden = false;
          inShelfBtn.setAttribute('data-existing-item-id', existing.id || '');
          if (inShelfLabel) inShelfLabel.textContent = `Already Added · ${statusLabelForKey(existing.status)}`;
        }
      } else {
        if (inShelfBtn) {
          inShelfBtn.hidden = true;
          inShelfBtn.removeAttribute('data-existing-item-id');
        }
        /* Re-collapse the choices row if it was open. */
        if (addChoicesEl) addChoicesEl.hidden = true;
        if (addToggleBtn) addToggleBtn.hidden = false;
      }
    }
    syncAddBtnState();
    if (addToggleBtn) addToggleBtn.addEventListener('click', () => {
      if (!addChoicesEl) return;
      addToggleBtn.hidden = true;
      addChoicesEl.hidden = false;
    });
    overlay.querySelectorAll('[data-music-profile-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.getAttribute('data-add-status') === 'planned' ? 'planned' : 'watched';
        const ok = addAlbumToShelf({
          title: state.title,
          artist: state.artist,
          artistDeezerId: state.artistDeezerId || '',
          year: state.year || (state.releaseDate ? String(state.releaseDate).slice(0,4) : ''),
          poster: state.poster,
          mbid: state.mbid,
          deezerId: state.deezerId || '',
          releaseDate: state.releaseDate,
          genre: state.genre,
          label: state.label || '',
          runtimeMs: state.runtimeMs,
          tracks: state.tracks
        }, status);
        if (ok) {
          closeMusicAlbumProfile();
          /* v10.418: when the album add originated from Universal Search,
             don't auto-navigate to the My List page. Leave the search
             overlay open so the user can keep adding more titles, and
             float a "Go to Shelf" popup for 3.3s — tap it to deep-link
             into the freshly added album, ignore it and keep searching.
             Non-search origins (artist profile, activity feed) keep the
             original auto-navigate behavior so those entry points still
             feel like a commit + jump-to-shelf. */
          const fromUniversalSearch = typeof window.isShelfdUniversalSearchOpen === 'function'
            ? window.isShelfdUniversalSearchOpen()
            : false;
          if (fromUniversalSearch && typeof window.showShelfdGoToShelfPopup === 'function') {
            const liveData = (typeof window !== 'undefined') ? window.data : null;
            /* addAlbumToShelf unshifts the new item to data.music[0], so
               that index is the just-added album's id we deep-link to. */
            const addedItem = Array.isArray(liveData?.music) ? liveData.music[0] : null;
            window.showShelfdGoToShelfPopup({
              section: 'music',
              status: status === 'planned' ? 'planned' : 'watched',
              itemId: addedItem?.id || '',
              title: addedItem?.title || state.title || ''
            });
          } else {
            try { if (typeof window.closeSearchPage === 'function') window.closeSearchPage(); } catch (_) {}
            callGlobalFn('switchSection', 'music');
            /* Default the active tab to match the status they picked. */
            try {
              if (typeof window.switchTab === 'function') window.switchTab(status === 'planned' ? 'planned' : 'watched');
            } catch (_) {}
            callGlobalFn('render');
          }
        }
      });
    });
    if (inShelfBtn) inShelfBtn.addEventListener('click', () => {
      const existingId = inShelfBtn.getAttribute('data-existing-item-id') || '';
      if (existingId && typeof window.openMyListAlbumPage === 'function') {
        try { window.openMyListAlbumPage(existingId); return; } catch (_) {}
      }
      callGlobalFn('showToast', 'Already in your Music shelf');
    });

    /* Esc closes */
    function onKey(e) {
      if (e.key === 'Escape') {
        closeMusicAlbumProfile();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);
  };
})();
