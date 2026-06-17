/* =========================================================================
   v10.246: Music Artist Profile page.
   ------------------------------------------------------------------------
   Triggered when a user taps an artist row in the universal-search results.
   Slide-in-from-right overlay (same animation language as the Album profile
   and the My-List Album Shelf page) showing:
     - Artist name (h1)
     - Type / Date of birth / Age / Place of birth (facts grid)
     - Album count ("X albums released")
     - Full discography (album rows) — tapping any album opens the Album
       profile so the user can review tracks + Add to Shelf.
   Back button top-left + edge swipe-right-to-dismiss.
   Data: single `/api/musicbrainz/artist/{mbid}?inc=release-groups` fetch.
   ========================================================================= */

(function initMusicArtistProfileModule() {
  const OVERLAY_ID = 'music-artist-profile-page';

  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatBirthDate(raw) {
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
  function computeAge(beginDate, endDate, isEnded) {
    const begin = String(beginDate || '').trim();
    if (!begin) return '';
    const parts = begin.split('-');
    const year = Number(parts[0] || 0);
    if (!year) return '';
    const refRaw = isEnded ? String(endDate || '').trim() : '';
    let ref;
    if (refRaw) {
      const rp = refRaw.split('-');
      ref = new Date(Number(rp[0] || 0), Math.max(0, Number(rp[1] || 1) - 1), Number(rp[2] || 1));
    } else {
      ref = new Date();
    }
    const month = Math.max(0, Number(parts[1] || 1) - 1);
    const day = Number(parts[2] || 1);
    const birth = new Date(year, month, day);
    let age = ref.getFullYear() - birth.getFullYear();
    const monthDiff = ref.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) age -= 1;
    if (age < 0 || age > 150) return '';
    return String(age);
  }

  function _isPrimaryAlbum(rg) {
    const primary = String(rg?.['primary-type'] || rg?.primaryType || '').toLowerCase();
    const secondary = (Array.isArray(rg?.['secondary-types']) ? rg['secondary-types'] : []).map(s => String(s).toLowerCase());
    if (primary !== 'album') return false;
    const blocked = ['compilation', 'live', 'remix', 'demo', 'mixtape', 'interview', 'spokenword'];
    return !secondary.some(s => blocked.includes(s));
  }

  function closeMusicArtistProfile(opts = {}) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      document.body.classList.remove('music-artist-profile-open');
      return;
    }
    if (opts.instant) {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('music-artist-profile-open');
      return;
    }
    overlay.classList.remove('is-open');
    setTimeout(() => {
      try { overlay.remove(); } catch (_) {}
      document.body.classList.remove('music-artist-profile-open');
    }, 320);
  }
  window.closeMusicArtistProfile = closeMusicArtistProfile;

  /* v10.248: Deezer artist + discography fetch. Returns a unified shape with
     the same fields the renderer already reads (life-span begin = year start,
     begin-area.name, type, release-groups). Real artist portrait via
     picture_xl. Real album count via nb_album. */
  async function hydrateArtistDetailsFromDeezer(deezerId) {
    if (!deezerId) return null;
    try {
      const [artistRes, albumsRes] = await Promise.allSettled([
        fetch(`/api/deezer/artist/${encodeURIComponent(deezerId)}`),
        fetch(`/api/deezer/artist/${encodeURIComponent(deezerId)}/albums?limit=200`)
      ]);
      const a = artistRes.status === 'fulfilled' && artistRes.value.ok
        ? await artistRes.value.json().catch(() => null) : null;
      if (!a || a.error) return null;
      const albumsData = albumsRes.status === 'fulfilled' && albumsRes.value.ok
        ? await albumsRes.value.json().catch(() => null) : null;
      const albums = Array.isArray(albumsData?.data) ? albumsData.data : [];
      return {
        __deezer: true,
        name: a.name || '',
        type: 'Person',
        country: '',
        'life-span': {},
        'begin-area': null,
        picture: a.picture_xl || a.picture_big || a.picture_medium || '',
        nbAlbum: a.nb_album || albums.length || 0,
        nbFan: a.nb_fan || 0,
        /* Filter Deezer's album list to record_type === 'album' so we strip
           singles / EPs / compilations and the count matches the user's
           expectation of "official studio albums". */
        'release-groups': albums
          .filter(al => String(al.record_type || 'album').toLowerCase() === 'album')
          .map(al => ({
            id: 'deezer-album-' + String(al.id),
            deezerId: String(al.id),
            title: al.title || '',
            'first-release-date': al.release_date || '',
            'primary-type': 'Album',
            cover: al.cover_xl || al.cover_big || al.cover_medium || ''
          }))
      };
    } catch (e) {
      console.warn('hydrateArtistDetailsFromDeezer failed:', e);
      return null;
    }
  }

  async function hydrateArtistDetails(mbid) {
    if (!mbid) return null;
    try {
      /* v10.247: pull url relations so we can hunt down a Wikipedia page →
         thumbnail for the hero portrait. MusicBrainz doesn't host artist
         images, but most popular artists have a wikipedia/wikidata link. */
      const url = `/api/musicbrainz/artist/${encodeURIComponent(mbid)}?inc=release-groups+url-rels&fmt=json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch (_) { return null; }
  }
  /* v10.247: best-effort artist photo via Wikipedia's REST API. Tries the
     Wikipedia URL from MusicBrainz's url-rels first (more reliable for
     disambiguated names), then falls back to the raw artist name. CORS is
     enabled on the Wikipedia REST API by default. Returns '' on failure. */
  async function fetchArtistThumbnail(artistData, fallbackName) {
    function titleFromWikipediaUrl(rawUrl) {
      try {
        const u = new URL(rawUrl);
        if (!/wikipedia\.org$/i.test(u.hostname)) return '';
        const path = decodeURIComponent(u.pathname || '');
        const m = path.match(/^\/wiki\/(.+)$/);
        return m && m[1] ? m[1] : '';
      } catch (_) { return ''; }
    }
    let candidates = [];
    try {
      const rels = Array.isArray(artistData?.relations) ? artistData.relations : [];
      for (const r of rels) {
        if (!r || !r.url || !r.url.resource) continue;
        const t = titleFromWikipediaUrl(r.url.resource);
        if (t) candidates.push(t);
      }
    } catch (_) {}
    if (fallbackName) candidates.push(String(fallbackName).replace(/\s+/g, '_'));
    for (const title of candidates) {
      try {
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
        const r = await fetch(wikiUrl);
        if (!r.ok) continue;
        const d = await r.json().catch(() => null);
        const src = d?.thumbnail?.source || d?.originalimage?.source || '';
        if (src) return src;
      } catch (_) {}
    }
    return '';
  }

  function attachSwipeBack(overlay) {
    const shell = overlay.querySelector('.music-artist-profile-shell');
    if (!shell) return;
    let active = false, startX = 0, startY = 0, curX = 0, lastX = 0, lastT = 0, velocity = 0, rafId = 0, pointerId = null;
    function onDown(e) {
      if (e.touches && e.touches.length !== 1) return;
      const pt = e.touches?.[0] || e;
      const rect = overlay.getBoundingClientRect();
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
          setTimeout(() => closeMusicArtistProfile({ instant: true }), 290);
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

  window.openMusicArtistProfile = function(artistRow) {
    if (!artistRow || !artistRow.id) return;
    closeMusicArtistProfile({ instant: true });

    const name = artistRow.title || artistRow.name || 'Unknown Artist';
    const mbid = artistRow.id;
    const artistType = artistRow.artistType || artistRow.type || 'Artist';
    const country = artistRow.country || '';
    const disambiguation = artistRow.disambiguation || '';

    const overlay = document.createElement('section');
    overlay.id = OVERLAY_ID;
    overlay.className = 'music-artist-profile-page';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${name} artist profile`);

    overlay.innerHTML = `
      <div class="music-artist-profile-shell">
        <header class="music-artist-profile-topbar">
          <button type="button" class="music-artist-profile-back" data-artist-profile-back aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="music-artist-profile-title-bar">Artist</span>
          <button type="button" class="music-artist-profile-fav" data-artist-profile-fav aria-pressed="false" aria-label="Favorite artist">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.1C1 8.5 3.3 5 6.7 5c2 0 3.6 1.1 4.5 2.8C12.1 6.1 13.7 5 15.7 5c3.4 0 5.7 3.5 4.3 6.9C19.5 16.4 12 21 12 21z"/></svg>
          </button>
        </header>
        <main class="music-artist-profile-content">
          <section class="music-artist-profile-hero">
            <div class="music-artist-profile-portrait" data-artist-portrait>
              <span class="music-artist-profile-portrait-initial" aria-hidden="true">${escHtml((name || '?').charAt(0).toUpperCase())}</span>
            </div>
            <h1 class="music-artist-profile-name">${escHtml(name)}</h1>
            ${disambiguation ? `<div class="music-artist-profile-disambig">${escHtml(disambiguation)}</div>` : ''}
            <dl class="music-artist-profile-facts" data-artist-facts>
              <div class="music-artist-profile-fact" data-fact-type>
                <dt>Type</dt><dd>${escHtml(artistType)}</dd>
              </div>
              <div class="music-artist-profile-fact" data-fact-birthdate>
                <dt>Date of birth</dt><dd>—</dd>
              </div>
              <div class="music-artist-profile-fact" data-fact-age>
                <dt>Age</dt><dd>—</dd>
              </div>
              <div class="music-artist-profile-fact" data-fact-birthplace>
                <dt>Place of birth</dt><dd>${escHtml(country || '—')}</dd>
              </div>
            </dl>
          </section>
          <section class="music-artist-profile-albums" data-artist-albums>
            <div class="music-artist-profile-albums-heading">
              <span data-artist-album-count>Albums</span>
            </div>
            <ol class="music-artist-profile-album-list" data-artist-album-list>
              <li class="music-artist-profile-album-loading">Loading discography…</li>
            </ol>
          </section>
        </main>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('music-artist-profile-open');
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));

    const backBtn = overlay.querySelector('[data-artist-profile-back]');
    if (backBtn) backBtn.addEventListener('click', () => closeMusicArtistProfile());

    /* v10.258: heart-toggle artist favorite, mirrors the actor heart pattern. */
    const favBtn = overlay.querySelector('[data-artist-profile-fav]');
    function refreshFavState(pictureUrl) {
      if (!favBtn) return;
      const isFav = typeof window.shelfdIsFavoriteArtist === 'function'
        ? window.shelfdIsFavoriteArtist(mbid)
        : false;
      favBtn.classList.toggle('is-favorited', isFav);
      favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      favBtn.setAttribute('aria-label', isFav ? 'Unfavorite artist' : 'Favorite artist');
      if (pictureUrl) favBtn.dataset.artistPicture = pictureUrl;
    }
    refreshFavState();
    if (favBtn) {
      favBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (typeof window.shelfdToggleFavoriteArtist !== 'function') return;
        const picture = favBtn.dataset.artistPicture || '';
        await window.shelfdToggleFavoriteArtist({ id: mbid, name, picture });
        refreshFavState(picture);
        const svg = favBtn.querySelector('svg');
        if (svg) {
          svg.style.transform = 'scale(1.25)';
          setTimeout(() => { svg.style.transform = ''; }, 180);
        }
      });
    }

    attachSwipeBack(overlay);

    function onKey(e) {
      if (e.key === 'Escape') {
        closeMusicArtistProfile();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);

    /* v10.248: prefer Deezer when the search row carries a deezerId — it
       gives us a real artist photo (picture_xl), real album count, and a
       full discography ordered newest-first. MB stays as a fallback. */
    const deezerId = artistRow.deezerId
      || (typeof mbid === 'string' && mbid.startsWith('deezer-artist-') ? mbid.replace('deezer-artist-', '') : '');
    const hydratePromise = deezerId
      ? hydrateArtistDetailsFromDeezer(deezerId).then(d => d || hydrateArtistDetails(mbid))
      : hydrateArtistDetails(mbid);
    hydratePromise.then(async data => {
      if (!data) {
        const listEl = overlay.querySelector('[data-artist-album-list]');
        if (listEl) listEl.innerHTML = '<li class="music-artist-profile-album-empty">Couldn’t load discography</li>';
        return;
      }

      /* Artist portrait. Deezer gives us picture_xl directly; for MB fall
         back to the Wikipedia REST API thumbnail. */
      try {
        const thumb = data.__deezer && data.picture
          ? data.picture
          : await fetchArtistThumbnail(data, name);
        if (thumb) {
          const portrait = overlay.querySelector('[data-artist-portrait]');
          if (portrait) {
            portrait.style.backgroundImage = `url('${String(thumb).replace(/'/g, "\\'")}')`;
            portrait.classList.add('has-img');
          }
        }
      } catch (_) {}

      /* Facts. */
      const lifeSpan = data['life-span'] || data.lifeSpan || {};
      const beginDate = lifeSpan.begin || '';
      const endDate = lifeSpan.end || '';
      const isEnded = !!lifeSpan.ended;
      const typeEl = overlay.querySelector('[data-fact-type] dd');
      const bdEl = overlay.querySelector('[data-fact-birthdate] dd');
      const ageEl = overlay.querySelector('[data-fact-age] dd');
      const bpEl = overlay.querySelector('[data-fact-birthplace] dd');
      if (typeEl) typeEl.textContent = data.type || artistType || '—';
      if (bdEl) bdEl.textContent = formatBirthDate(beginDate) || '—';
      if (ageEl) ageEl.textContent = computeAge(beginDate, endDate, isEnded) || '—';
      const beginArea = data['begin-area']?.name || data.beginArea?.name || '';
      const placeParts = [beginArea, data.country].filter(Boolean);
      if (bpEl) bpEl.textContent = placeParts.join(', ') || '—';

      /* Discography. */
      const groups = Array.isArray(data['release-groups']) ? data['release-groups']
        : Array.isArray(data.releaseGroups) ? data.releaseGroups
        : [];
      /* v10.261: discography is always sorted by release date, newest first.
         Empty dates sort to the end so albums missing a date don't push real
         releases out of the top. */
      const albums = groups.filter(_isPrimaryAlbum).sort((a, b) => {
        const ad = String(a['first-release-date'] || '').trim();
        const bd = String(b['first-release-date'] || '').trim();
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        if (ad > bd) return -1;
        if (ad < bd) return 1;
        return 0;
      });

      const countEl = overlay.querySelector('[data-artist-album-count]');
      if (countEl) countEl.textContent = `${albums.length} ${albums.length === 1 ? 'album' : 'albums'} released`;

      const listEl = overlay.querySelector('[data-artist-album-list]');
      if (!listEl) return;
      if (albums.length === 0) {
        listEl.innerHTML = '<li class="music-artist-profile-album-empty">No albums on file</li>';
        return;
      }
      listEl.innerHTML = albums.map(rg => {
        const id = String(rg.id || '').trim();
        const dzId = String(rg.deezerId || '').trim();
        const title = String(rg.title || '').trim();
        const year = String(rg['first-release-date'] || '').slice(0, 4);
        /* v10.248: prefer Deezer cover when present; fall back to CAA. */
        const poster = rg.cover
          ? rg.cover
          : (id ? `/api/musicbrainz/cover-art/release-group/${encodeURIComponent(id)}/front-250` : '');
        return `
          <li class="music-artist-profile-album"
              data-artist-album-mbid="${escAttr(id)}"
              data-artist-album-deezer-id="${escAttr(dzId)}"
              data-artist-album-title="${escAttr(title)}"
              data-artist-album-year="${escAttr(year)}"
              data-artist-album-cover="${escAttr(poster)}">
            <div class="music-artist-profile-album-cover${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}></div>
            <div class="music-artist-profile-album-meta">
              <strong class="music-artist-profile-album-title">${escHtml(title)}</strong>
              ${year ? `<span class="music-artist-profile-album-year">${escHtml(year)}</span>` : ''}
            </div>
            <svg class="music-artist-profile-album-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
          </li>
        `;
      }).join('');

      /* Wire each album → open the Album Profile (already-built module). */
      listEl.querySelectorAll('.music-artist-profile-album').forEach(li => {
        li.addEventListener('click', () => {
          const albumPayload = {
            id: li.getAttribute('data-artist-album-mbid') || '',
            mbid: li.getAttribute('data-artist-album-mbid') || '',
            deezerId: li.getAttribute('data-artist-album-deezer-id') || '',
            title: li.getAttribute('data-artist-album-title') || '',
            year: li.getAttribute('data-artist-album-year') || '',
            artist: name,
            poster: li.getAttribute('data-artist-album-cover') || ''
          };
          if (typeof window.openMusicAlbumProfile === 'function') {
            try { window.openMusicAlbumProfile(albumPayload); } catch (_) {}
          }
        });
      });
    }).catch(() => {
      const listEl = overlay.querySelector('[data-artist-album-list]');
      if (listEl) listEl.innerHTML = '<li class="music-artist-profile-album-empty">Couldn’t load discography</li>';
    });
  };
})();
