let pendingDiscoveryAdd = null;

function openDiscoveryAddModal(type, tmdbId, btn) {
  if (!btn || btn.disabled) return;
  pendingDiscoveryAdd = { type, tmdbId, btn, originalText: btn.textContent };
  renderDiscoveryAddChoice();
  document.getElementById('discover-add-modal').style.display = 'flex';
}

function renderDiscoveryAddChoice() {
  const content = document.getElementById('discover-add-modal-content');
  if (!content) return;
  const isGame = pendingDiscoveryAdd?.type === 'game';
  const watchedLabel = isGame ? 'Played' : 'Watched';
  const plannedLabel = 'Planning';
  const wishlistButton = isGame ? `<button class="discover-status-btn wishlist-option" onclick="confirmDiscoveryAdd('wishlist')">Wishlist</button>` : '';
  content.innerHTML = `
    <h3>Add to Library</h3>
    <div class="discover-add-desc">Where you bouta put this?</div>
    <div class="discover-status-options">
      <button class="discover-status-btn watched-option" onclick="confirmDiscoveryAdd('watched')">${watchedLabel}</button>
      <button class="discover-status-btn planned-option" onclick="confirmDiscoveryAdd('planned')">${plannedLabel}</button>
      ${wishlistButton}
    </div>
    <div class="modal-actions">
      <button class="btn-secondary discover-cancel-btn" onclick="closeDiscoverAddModal()">Cancel</button>
    </div>
  `;
}

function closeDiscoverAddModal() {
  document.getElementById('discover-add-modal').style.display = 'none';
  pendingDiscoveryAdd = null;
}

function confirmDiscoveryAdd(status) {
  if (!pendingDiscoveryAdd) return;
  if (status === 'watched') {
    renderDiscoveryRatingPrompt(0);
    return;
  }
  finalizeDiscoveryAdd(status, 0);
}

function renderDiscoveryRatingPrompt(selectedRating = 0) {
  const content = document.getElementById('discover-add-modal-content');
  if (!content) return;
  const isGame = pendingDiscoveryAdd?.type === 'game';
  const ratingSection = getRatingSectionForDiscoverType(pendingDiscoveryAdd?.type);
  const skipLabel = isGame ? 'completed' : 'watched';
  const stars = buildStandaloneRatingStarsMarkup(selectedRating, ratingSection, 'selectDiscoveryRating');
  content.innerHTML = `
    <div class="discover-rating-prompt">
      <h3>Rate this Title</h3>
      <div class="discover-add-desc">Choose a rating, or skip and add it as ${skipLabel}.</div>
      ${stars}
      <div class="modal-actions">
        <button class="btn-secondary" onclick="renderDiscoveryAddChoice()">Back</button>
        <button class="btn-secondary" onclick="finalizeDiscoveryAdd('watched', 0)">Skip</button>
      </div>
    </div>
  `;
  setupDiscoveryRatingScrub();
}

function getDiscoveryRatingContainer() {
  return document.querySelector('#discover-add-modal .discover-rating-stars');
}

function getDiscoveryScrubValue(container, clientX) {
  const stars = [...container.querySelectorAll('.star-btn')];
  let value = 0;
  stars.forEach((star, index) => {
    const rect = star.getBoundingClientRect();
    if (clientX >= rect.left) value = index + 1;
  });
  return Math.max(0, Math.min(stars.length, value));
}

function previewDiscoveryRatingScrub(container, score) {
  const ratingSection = getRatingSectionForDiscoverType(pendingDiscoveryAdd?.type);
  container.dataset.discoverRating = String(score);
  container.querySelectorAll('.star-btn').forEach((star, index) => {
    const lit = index + 1 <= score;
    star.classList.toggle('lit', lit);
    star.style.color = lit ? '#f59e0b' : '#443d60';
    star.style.transform = lit ? 'scale(1.2)' : 'scale(1)';
  });
  let label = container.querySelector('.star-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'star-label';
    container.appendChild(label);
  }
  label.textContent = score > 0 ? formatRatingValueForSection(score, ratingSection) : '';
}

function setupDiscoveryRatingScrub() {
  const container = getDiscoveryRatingContainer();
  if (!container) return;

  container.ontouchstart = (event) => {
    if (pendingDiscoveryAdd?.ratingLock || !event.touches?.[0]) return;
    const touch = event.touches[0];
    container.dataset.touchStartX = String(touch.clientX);
    container.dataset.touchStartY = String(touch.clientY);
    container.dataset.scrubbing = 'false';
    container.dataset.scrubVal = container.dataset.discoverRating || '0';
  };

  container.ontouchmove = (event) => {
    if (pendingDiscoveryAdd?.ratingLock || !event.touches?.[0]) return;
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - parseFloat(container.dataset.touchStartX || '0'));
    const dy = Math.abs(touch.clientY - parseFloat(container.dataset.touchStartY || '0'));
    if (container.dataset.scrubbing !== 'true') {
      if (dx < 10 || dy > dx) return;
    }
    container.dataset.scrubbing = 'true';
    event.preventDefault();
    const score = getDiscoveryScrubValue(container, touch.clientX);
    if (score < 1) return;
    container.dataset.scrubVal = String(score);
    previewDiscoveryRatingScrub(container, score);
  };

  container.ontouchend = () => {
    if (pendingDiscoveryAdd?.ratingLock) return;
    if (container.dataset.scrubbing !== 'true') return;
    const score = Number(container.dataset.scrubVal || 0);
    container.dataset.scrubbing = 'false';
    if (score > 0) selectDiscoveryRating(score);
  };

  container.ontouchcancel = () => {
    container.dataset.scrubbing = 'false';
  };
}

function selectDiscoveryRating(score) {
  if (!pendingDiscoveryAdd || pendingDiscoveryAdd.ratingLock) return;
  pendingDiscoveryAdd.ratingLock = true;
  const container = document.querySelector('#discover-add-modal .discover-rating-stars');
  const ratingSection = getRatingSectionForDiscoverType(pendingDiscoveryAdd?.type);
  if (container) {
    container.dataset.discoverRating = score;
    container.querySelectorAll('.star-btn').forEach((star, index) => {
      const lit = index + 1 <= score;
      star.classList.toggle('lit', lit);
      star.style.color = lit ? '#f59e0b' : '#443d60';
      star.style.transform = 'scale(1)';
    });
    let label = container.querySelector('.star-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'star-label';
      container.appendChild(label);
    }
    label.textContent = formatRatingValueForSection(score, ratingSection);
    const animationMs = playDiscoveryModalRatingAnimation(score, container);
    setTimeout(() => finalizeDiscoveryAdd('watched', score), animationMs);
    return;
  }
  finalizeDiscoveryAdd('watched', score);
}

function playDiscoveryModalRatingAnimation(score, container) {
  if (!container || score < 1) return 0;

  const t = Math.pow(score / 10, 1.3);
  const peakScale = 1.3 + t * 0.7;
  const midScale  = 1.05 + t * 0.18;
  const glow      = 5 + t * 16;
  const glowAlpha = 0.5 + t * 0.5;
  const stagger   = (0.07 - t * 0.04) * 1000;
  const duration  = 380 + t * 240;
  const isPerfect = score === 10;

  const glowR = Math.round(251 - t * 15);
  const glowG = Math.round(191 - t * 119);
  const glowB = Math.round(36 + t * 117);
  const peakFilter = `drop-shadow(0 0 ${glow}px rgba(${glowR},${glowG},${glowB},${glowAlpha}))`;

  requestAnimationFrame(() => {
    const lit = [...container.querySelectorAll('.star-btn.lit')];
    lit.forEach((star, i) => {
      star.style.willChange = 'transform, filter';
      const anim = star.animate([
        { transform: 'scale(1)', filter: 'none' },
        { transform: `scale(${peakScale})`, filter: peakFilter, offset: 0.3 },
        { transform: `scale(${midScale})`, filter: 'none', offset: 0.6 },
        { transform: 'scale(1)', filter: 'none' }
      ], { duration, delay: i * stagger, easing: 'ease-out', fill: 'none' });
      anim.onfinish = () => { star.style.willChange = ''; };
    });

    const label = container.querySelector('.star-label');
    if (label) {
      label.style.willChange = 'transform, color';
      const lAnim = label.animate([
        { transform: 'scale(1)', color: '' },
        { transform: `scale(${1.15 + t * 0.35})`, color: '#fbbf24', offset: 0.4 },
        { transform: 'scale(1)', color: '' }
      ], { duration: 500 + t * 180, delay: 100 + t * 70, easing: 'ease-out' });
      lAnim.onfinish = () => { label.style.willChange = ''; };
    }

    if (isPerfect) spawnPerfectBurst(container);
  });

  return Math.min(960, Math.ceil(duration + Math.max(0, score - 1) * stagger + 80));
}

function finalizeDiscoveryAdd(status, rating = 0) {
  if (!pendingDiscoveryAdd) return;
  const pending = pendingDiscoveryAdd;
  document.getElementById('discover-add-modal').style.display = 'none';
  pendingDiscoveryAdd = null;
  addDiscoveryTitle(pending.type, pending.tmdbId, pending.btn, status, pending.originalText, rating);
}

function markDiscoverButtonAdded(btn, status = '') {
  if (!btn) return;
  const section = btn.dataset.discoverSection || '';
  const title = btn.dataset.discoverTitle || '';
  btn.classList.add('added');
  if (btn.classList.contains('discover-media-add-floating')) {
    btn.disabled = false;
    btn.innerHTML = `<svg class="discover-media-add-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4 4 10-10"/></svg>`;
    btn.setAttribute('aria-label', 'Manage this title in your library');
    btn.title = 'Manage this title in your library';
    return;
  }
  btn.disabled = true;
  btn.textContent = getDiscoverLibraryStatusLabel(status || getDiscoverLibraryMatch(title, section)?.status || '', section);
}

async function addDiscoveryTitle(type, tmdbId, btn, status = 'planned', originalText = '', rating = 0, options = {}) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return { ok: false };
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('added');
    btn.textContent = 'Adding...';
  }
  try {
    const isJikanAnimeAdd = String(type || '').toLowerCase() === 'anime'
      || /^mal:/i.test(String(tmdbId || ''))
      || (btn?.dataset?.discoverSection === 'anime' && !/^\d+$/.test(String(tmdbId || '')));
    const builtItems = type === 'game'
      ? [await buildRawgLibraryItem(tmdbId, status, rating)]
      : isJikanAnimeAdd
        ? [await buildJikanAnimeLibraryItem(String(tmdbId || '').replace(/^mal:/i, ''), status, rating)]
        : await buildTmdbLibraryItems(type, tmdbId, status, rating);
    const item = builtItems[0];
    if (type === 'game') {
      if (typeof traceShelfdGameIdentity === 'function') traceShelfdGameIdentity('7 game object passed to My Lists save', item, { tmdbId, status, rating });
      if (typeof assertShelfdGameIdentity === 'function' && !assertShelfdGameIdentity('7 discover add before My Lists save', item)) {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('added');
          btn.textContent = originalText || '+ Add to Library';
        }
        return { ok: false, identityMismatch: true };
      }
    }
    const section = type === 'movie'
      ? 'movies'
      : type === 'game'
        ? 'games'
        : resolveShowSection(item, item.mediaCategory || 'shows');

    // While viewing a friend, save() bails — write directly to own Firestore doc.
    if (viewingUser) {
      const targetData = myData
        ? cloneListData(myData)
        : (ownDataCache ? cloneListData(ownDataCache) : await loadOwnDataFromFirestore());
      targetData[section] = Array.isArray(targetData[section]) ? targetData[section] : [];
      if (section === 'anime' && item?.tmdbId) targetData[section] = removeAnimeSeasonSplitEntries(targetData[section], item);
      const newItems = builtItems.filter(entry => !isDuplicateTitleInList(entry, section, targetData));
      if (!newItems.length) {
        showToast("this title is already added to your library silly!");
        markDiscoverButtonAdded(btn);
        return { ok: false, duplicate: true };
      }
      targetData[section].push(...newItems);
      await writeOwnDataDirect(targetData);
      myData = cloneListData(targetData);
      playLibraryAddPopSound();
      markDiscoverButtonAdded(btn, status);
      if (btn) {
        btn.dataset.discoverType = type;
        btn.dataset.discoverId = String(tmdbId);
        btn.dataset.discoverSection = section;
        btn.dataset.discoverTitle = item.title;
        if (!btn.classList.contains('discover-media-add-floating')) {
          btn.setAttribute('onclick', 'removeDiscoveryTitle(this)');
        } else {
          btn.removeAttribute('onclick');
        }
        btn.disabled = false;
        btn.title = btn.classList.contains('discover-media-add-floating')
          ? 'Manage this title in your library'
          : 'Click to remove from your library';
      }
      if (options.successToast !== false) showToast(options.successToastMessage || "Added to your library");
      const result = { ok: true, item: { ...item }, section, status, rating: Number(rating || 0) || 0, source: 'discover-add' };
      if (status === 'watched' && options.promptPost !== false && typeof openScreenListActivityPostPrompt === 'function') {
        if (type === 'game' && typeof traceShelfdGameIdentity === 'function') traceShelfdGameIdentity('8 game object passed to Activity Feed prompt', item, { status, rating });
        window.setTimeout(() => openScreenListActivityPostPrompt(result), Number(options.postPromptDelayMs || 0));
      }
      return result;
    }

    data[section] = Array.isArray(data[section]) ? data[section] : [];
    if (section === 'anime' && item?.tmdbId) data[section] = removeAnimeSeasonSplitEntries(data[section], item);
    const newItems = builtItems.filter(entry => !isDuplicateTitle(entry, section));
    if (!newItems.length) {
      showToast("this title is already added to your library silly!");
      markDiscoverButtonAdded(btn);
      return { ok: false, duplicate: true };
    }
    data[section].push(...newItems);
    activeSection = section;
    activeTab = section === 'games' && status === 'live' ? 'watching' : status;
    /* v850: defensive try/catch around save() + render() so any
       sync exception (legacy compactImportedAnimeForStorage edge
       cases etc) can't abort the flow before the Firestore
       force-flush below. */
    try { save(); } catch (saveErr) {
      console.warn('[v850] save() threw in addDiscoveryTitle:', saveErr);
    }
    try { render(); } catch (renderErr) {
      console.warn('[v850] render() threw in addDiscoveryTitle:', renderErr);
    }
    playLibraryAddPopSound();
    if (rating > 0) {
      requestAnimationFrame(() => playRatingAnimation(item.id, 'overall'));
    }
    markDiscoverButtonAdded(btn, status);
    if (btn) {
      btn.dataset.discoverType = type;
      btn.dataset.discoverId = String(tmdbId);
      btn.dataset.discoverSection = section;
      btn.dataset.discoverTitle = item.title;
      if (!btn.classList.contains('discover-media-add-floating')) {
        btn.setAttribute('onclick', 'removeDiscoveryTitle(this)');
      } else {
        btn.removeAttribute('onclick');
      }
      btn.disabled = false;
      btn.title = btn.classList.contains('discover-media-add-floating')
        ? 'Manage this title in your library'
        : 'Click to remove from your library';
    }
    /* v850: force-flush the Firestore write IMMEDIATELY instead of
       relying on save()'s 500ms debounce. The bug the user reported:
       add a title from Discover search → toast says "Added" → close
       PWA / reopen → title is gone. Cause: save() only queues the
       Firestore write 500ms later; if the user navigates away or
       closes the PWA in that window the write never fires, leaving
       the new item only in localStorage (which Firestore-on-load
       overwrites). Awaiting persistOwnDataToFirestore here makes
       the add durable before the toast is shown. */
    let cloudSyncOk = true;
    try {
      const flushData = compactImportedAnimeForStorage(data);
      await persistOwnDataToFirestore(flushData);
    } catch (flushErr) {
      cloudSyncOk = false;
      console.error('[v850] Discover add Firestore force-flush failed:', flushErr);
    }
    if (cloudSyncOk) {
      if (options.successToast !== false) showToast(options.successToastMessage || "Added to your library");
    } else {
      showToast("Saved locally — cloud sync had trouble. Check your connection and try again.");
    }
    const result = { ok: true, item: { ...item }, section, status, rating: Number(rating || 0) || 0, source: 'discover-add' };
    if (status === 'watched' && options.promptPost !== false && typeof openScreenListActivityPostPrompt === 'function') {
      if (type === 'game' && typeof traceShelfdGameIdentity === 'function') traceShelfdGameIdentity('8 game object passed to Activity Feed prompt', item, { status, rating });
      window.setTimeout(() => openScreenListActivityPostPrompt(result), Number(options.postPromptDelayMs || 0));
    }
    return result;
  } catch(e) {
    console.error("Discover add failed:", e);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('added');
      btn.textContent = originalText || '+ Add to Library';
    }
    showToast("Could not add this title. Try again.");
    return { ok: false };
  }
}

async function removeDiscoveryTitle(btn) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (!btn) return;
  const section = btn.dataset.discoverSection;
  const title = btn.dataset.discoverTitle || '';
  if (!section || !title) return;
  const titleLower = title.trim().toLowerCase();

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Removing...';

  try {
    if (viewingUser) {
      // Bypass save() bail: write directly to own Firestore.
      const targetData = myData
        ? cloneListData(myData)
        : (ownDataCache ? cloneListData(ownDataCache) : await loadOwnDataFromFirestore());
      const list = Array.isArray(targetData[section]) ? targetData[section] : [];
      const idx = list.findIndex(it => (it?.title || '').trim().toLowerCase() === titleLower);
      if (idx === -1) {
        // Stale state: nothing to remove. Just reset the button.
        resetDiscoverButton(btn);
        showToast("Already not in your library");
        return;
      }
      list.splice(idx, 1);
      targetData[section] = list;
      await writeOwnDataDirect(targetData);
      myData = cloneListData(targetData);
      resetDiscoverButton(btn);
      showToast("Removed from your library");
      return;
    }

    const list = Array.isArray(data[section]) ? data[section] : [];
    const idx = list.findIndex(it => (it?.title || '').trim().toLowerCase() === titleLower);
    if (idx === -1) {
      resetDiscoverButton(btn);
      showToast("Already not in your library");
      return;
    }
    data[section].splice(idx, 1);
    save();
    render();
    resetDiscoverButton(btn);
    showToast("Removed from your library");
  } catch(e) {
    console.error("Discover remove failed:", e);
    btn.disabled = false;
    btn.textContent = originalLabel || 'Added';
    showToast("Could not remove. Try again.");
  }
}

function resetDiscoverButton(btn) {
  if (!btn) return;
  const type = btn.dataset.discoverType;
  const discoverId = btn.dataset.discoverId;
  btn.classList.remove('added');
  btn.disabled = false;
  btn.textContent = '+ Add to Library';
  btn.removeAttribute('title');
  if (btn.classList.contains('discover-media-add-floating')) {
    btn.removeAttribute('onclick');
    return;
  }
  if (type && discoverId) {
    btn.setAttribute('onclick', `openDiscoveryAddModal('${type}', ${JSON.stringify(discoverId)}, this)`);
    return;
  }
  btn.removeAttribute('onclick');
}


async function buildRawgLibraryItem(rawgId, status = 'planned', rating = 0) {
  const requestedId = String(rawgId || '').trim();
  const seed = typeof getGameMediaProfileSeed === 'function' ? (getGameMediaProfileSeed(requestedId, {}) || {}) : {};
  const lockedSeed = seed && typeof attachShelfdGameIdentityLock === 'function'
    ? attachShelfdGameIdentityLock({ ...seed }, seed.shelfdGameIdentityLock || (typeof createShelfdGameIdentityLock === 'function' ? createShelfdGameIdentityLock(seed, 'discover-add-build-game') : null))
    : { ...seed };
  if (typeof traceShelfdGameIdentity === 'function') traceShelfdGameIdentity('5 add-to-library build input', lockedSeed, { requestedId, status, rating });
  const seedRawgId = typeof getShelfdGameIdentityRawgId === 'function' ? getShelfdGameIdentityRawgId(lockedSeed) : String(lockedSeed.rawgId || (/^\d+$/.test(requestedId) ? requestedId : '') || '');
  const seedIgdbId = typeof getShelfdGameIdentityIgdbId === 'function' ? getShelfdGameIdentityIgdbId(lockedSeed) : String(lockedSeed.igdbId || (requestedId.match(/^igdb:(\d+)$/i)?.[1] || '') || '');
  if (!seedRawgId && (seedIgdbId || requestedId.startsWith('igdb:'))) {
    const title = lockedSeed.title || lockedSeed.name || '';
    const cover = lockedSeed.igdbCoverUrl || lockedSeed.cover || lockedSeed.poster || lockedSeed.image || lockedSeed.background_image || '';
    const item = {
      id: Date.now().toString() + '-igdb-' + (seedIgdbId || requestedId.replace(/^igdb:/i, '')),
      title,
      name: title,
      cover,
      igdbCoverUrl: lockedSeed.igdbCoverUrl || cover,
      poster: cover,
      image: cover,
      background_image: cover,
      genre: Array.isArray(lockedSeed.genres) ? lockedSeed.genres.map(g => g?.name || g).filter(Boolean).join(', ') : (lockedSeed.genre || ''),
      genreNames: Array.isArray(lockedSeed.genreNames) ? lockedSeed.genreNames : (Array.isArray(lockedSeed.genres) ? lockedSeed.genres.map(g => g?.name || g).filter(Boolean) : []),
      year: String(lockedSeed.released || lockedSeed.year || '').slice(0, 4),
      status,
      rating,
      dateAdded: new Date().toISOString(),
      imdbId: '',
      platforms: Array.isArray(lockedSeed.platforms) ? lockedSeed.platforms.map(p => typeof p === 'string' ? p : (p?.platform?.name || p?.name || '')).filter(Boolean).join(', ') : (lockedSeed.platforms || ''),
      metacritic: lockedSeed.metacritic || '',
      metacriticSlug: lockedSeed.metacriticSlug || '',
      rawgId: '',
      rawgSlug: '',
      igdbId: seedIgdbId,
      igdbSlug: lockedSeed.igdbSlug || lockedSeed.slug || '',
      backloggdSlug: lockedSeed.backloggdSlug || lockedSeed.igdbSlug || lockedSeed.slug || '',
      source: 'igdb',
      sourceId: seedIgdbId,
      gameIdentityKey: lockedSeed.gameIdentityKey || lockedSeed.shelfdGameIdentityLock?.key || requestedId,
      tmdbId: '',
      mediaCategory: 'games',
      librarySection: 'games',
      episodes: []
    };
    if (lockedSeed.shelfdGameIdentityLock && typeof attachShelfdGameIdentityLock === 'function') attachShelfdGameIdentityLock(item, lockedSeed.shelfdGameIdentityLock);
    else if (typeof attachShelfdGameIdentityLock === 'function' && typeof createShelfdGameIdentityLock === 'function') attachShelfdGameIdentityLock(item, createShelfdGameIdentityLock(item, 'discover-add-build-igdb-library-item'));
    if (typeof assertShelfdGameIdentity === 'function' && !assertShelfdGameIdentity('7 discover add IGDB game save object', item)) {
      throw new Error('Game identity mismatch before save');
    }
    return item;
  }
  const cleanRawgId = seedRawgId || requestedId;
  const res = await fetchRawgProxy(`games/${cleanRawgId}`);
  if (!res.ok) throw new Error("RAWG details request failed");
  const d = await res.json();
  let item = {
    id: Date.now().toString() + '-rawg-' + cleanRawgId,
    title: d.name || '',
    name: d.name || '',
    cover: d.background_image || '',
    genre: (d.genres || []).map(g => g.name).join(', '),
    year: (d.released || '').slice(0, 4),
    status,
    rating,
    dateAdded: new Date().toISOString(),
    imdbId: '',
    platforms: (d.platforms || []).map(p => p.platform?.name).filter(Boolean).join(', '),
    metacritic: d.metacritic || '',
    metacriticSlug: d.slug || '',
    rawgId: String(cleanRawgId),
    rawgSlug: d.slug || '',
    backloggdSlug: d.slug || '',
    source: 'rawg',
    tmdbId: '',
    mediaCategory: 'games',
    librarySection: 'games',
    episodes: []
  };
  if (Object.keys(lockedSeed || {}).length && typeof mergeShelfdGameIdentityLockedItem === 'function') {
    item = mergeShelfdGameIdentityLockedItem(lockedSeed, item, 'discover-add-rawg-details');
    item.id = Date.now().toString() + '-rawg-' + cleanRawgId;
    item.status = status;
    item.rating = rating;
    item.dateAdded = new Date().toISOString();
  }
  if (typeof assertShelfdGameIdentity === 'function' && !assertShelfdGameIdentity('7 discover add RAWG game save object', item)) {
    throw new Error('Game identity mismatch before save');
  }
  return item;
}

function applySteamFieldsToLibraryItem(item = {}, entry = {}) {
  const next = { ...(item || {}) };
  const playtimeHours = Math.round((Number(entry.playtimeHours || 0) || 0) * 10) / 10;
  const normalizedHours = playtimeHours > 0 ? String(playtimeHours) : '';
  next.source = 'steam';
  next.librarySection = 'games';
  next.mediaCategory = 'games';
  next.steamAppId = String(entry.steamAppId || next.steamAppId || '').trim();
  next.steamId = String(entry.steamId || next.steamId || '').trim();
  next.steamUrl = String(entry.steamUrl || next.steamUrl || '').trim();
  next.lastPlayedAt = String(entry.lastPlayedAt || next.lastPlayedAt || '').trim();
  if (normalizedHours) {
    next.gameHoursPlayed = normalizedHours;
    next.gameHours = normalizedHours;
    next.hoursPlayed = normalizedHours;
    next.playtimeHours = normalizedHours;
  }
  if (!String(next.platforms || '').trim()) next.platforms = 'Steam';
  return next;
}

async function buildTmdbLibraryItem(type, tmdbId, status = 'planned', rating = 0) {
  const res = await fetchTmdbProxy(`${type}/${tmdbId}`);
  if (!res.ok) throw new Error("TMDB details request failed");
  const d = await res.json();
  const title = d.title || d.name || '';
  const item = {
    id: Date.now().toString() + '-' + tmdbId,
    title,
    cover: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
    genre: (d.genres || []).map(g => g.name).join(', '),
    year: (d.release_date || d.first_air_date || '').slice(0, 4),
    status,
    rating,
    dateAdded: new Date().toISOString(),
    imdbId: d.imdb_id || '',
    platforms: '',
    metacriticSlug: '',
    tmdbId: String(tmdbId),
    genreNames: (d.genres || []).map(g => g.name).filter(Boolean),
    originalTitle: d.original_name || d.original_title || '',
    originalLanguage: d.original_language || '',
    originCountries: Array.isArray(d.origin_country) ? d.origin_country : [],
  };

  if (type === "tv") {
    item.mediaCategory = detectAnimeFromMetadata(item) ? 'anime' : 'shows';
    item.librarySection = item.mediaCategory;
    item.isAnime = item.mediaCategory === 'anime';
    const nextEpisode = typeof normalizeMyListTmdbNextEpisodeMetadata === 'function'
      ? normalizeMyListTmdbNextEpisodeMetadata(d)
      : null;
    if (nextEpisode?.airDate) {
      item.nextEpisodeAirDate = nextEpisode.airDate;
      item.next_episode_to_air = nextEpisode.episode;
    }
    if (item.isAnime) await hydrateAnimeTitleVariants(item);
    try {
      const extRes = await fetchTmdbProxy(`tv/${tmdbId}/external_ids`);
      const extData = await extRes.json();
      if (extData.imdb_id) item.imdbId = extData.imdb_id;
    } catch(e) {}

    const seasons = (d.seasons || []).filter(s => s.season_number > 0 && Number(s.episode_count || 0) > 0);
    let allEpisodes = [];
    const animeSeasonItems = [];
    for (const season of seasons) {
      try {
        const sRes = await fetchTmdbProxy(`tv/${tmdbId}/season/${season.season_number}`);
        const sData = await sRes.json();
        const seasonStartIndex = allEpisodes.length;
        const seasonDisplayName = sData.name || season.name || '';
        const seasonEpisodes = (sData.episodes || []).map((ep, idx) => ({
          number: seasonStartIndex + idx + 1,
          seasonNum: season.season_number,
          seasonName: seasonDisplayName,
          epNum: ep.episode_number,
          title: ep.name || '',
          airDate: ep.air_date || '',
          air_date: ep.air_date || '',
          runtime: ep.runtime || 0,
          runtimeMinutes: ep.runtime || 0,
          cover: (sData.poster_path || season.poster_path) ? `https://image.tmdb.org/t/p/w500${sData.poster_path || season.poster_path}` : '',
        }));
        seasonEpisodes.forEach(ep => {
          allEpisodes.push({
            id: item.id + '-ep-' + (allEpisodes.length + 1),
            number: allEpisodes.length + 1,
            seasonNum: season.season_number,
            epNum: ep.epNum,
            seasonName: ep.seasonName || '',
            title: ep.title,
            airDate: ep.airDate || ep.air_date || '',
            air_date: ep.air_date || ep.airDate || '',
            runtime: ep.runtime || ep.runtimeMinutes || 0,
            runtimeMinutes: ep.runtimeMinutes || ep.runtime || 0,
            cover: ep.cover || '',
            watched: status === 'watched',
            rating: 0,
          });
        });
        animeSeasonItems.push({
          seasonNum: season.season_number,
          season_number: season.season_number,
          name: sData.name || season.name || `Season ${season.season_number}`,
          airDate: sData.air_date || season.air_date || '',
          cover: (sData.poster_path || season.poster_path) ? `https://image.tmdb.org/t/p/w500${sData.poster_path || season.poster_path}` : '',
          episodes: seasonEpisodes
        });
      } catch(e) {}
    }
    item.totalEpisodes = allEpisodes.length;
    item.episodes = allEpisodes;
    item.animeSeasonItems = item.isAnime ? animeSeasonItems : [];
    item.seasonsInfo = animeSeasonItems.map(season => ({
      seasonNum: season.seasonNum || season.season_number || 0,
      season_number: season.season_number || season.seasonNum || 0,
      name: season.name || '',
      title: season.name || '',
      cover: season.cover || '',
      airDate: season.airDate || '',
      episodeCount: Array.isArray(season.episodes) ? season.episodes.length : Number(season.episode_count || 0)
    }));
  } else {
    item.mediaCategory = 'movies';
    item.librarySection = 'movies';
    item.isAnime = false;
  }

  return item;
}

async function buildTmdbLibraryItems(type, tmdbId, status = 'planned', rating = 0) {
  /* v11.087: anime is now saved as ONE parent series card (TV-style), with
     seasons grouped under it via episodes[]/seasonsInfo[] — never split into a
     separate card per season. Returns a single-element array for callers that
     expect a list. */
  const item = await buildTmdbLibraryItem(type, tmdbId, status, rating);
  return [item];
}

async function buildJikanAnimeLibraryItem(malId, status = 'planned', rating = 0) {
  const id = String(malId || '').trim();
  if (!id || !window.JikanAnime?.animeFull) throw new Error('Missing Jikan anime id');
  const j = await window.JikanAnime.animeFull(id);
  if (!j) throw new Error('Jikan details request failed');
  const item = {
    id: Date.now().toString() + '-mal-' + (j.mal_id || id),
    title: j.title_english || j.title || j.title_japanese || '',
    cover: j.images?.jpg?.large_image_url || j.images?.jpg?.image_url || '',
    genre: '',
    genreNames: [],
    year: String(j.year || (j.aired?.from || '').slice(0, 4) || ''),
    status,
    rating,
    dateAdded: new Date().toISOString(),
    imdbId: '',
    tmdbId: '',
    mediaCategory: 'anime',
    librarySection: 'anime',
    source: 'myanimelist',
    originalLanguage: 'ja',
    originCountries: ['JP'],
    isAnime: true,
    episodes: []
  };
  if (typeof applyJikanCanonicalAnimeFields === 'function') {
    applyJikanCanonicalAnimeFields(item, j, { overwrite: true });
  }
  const total = Number(j.episodes || 0);
  item.totalEpisodes = total;
  item.totalEps = total;
  item.currentEp = status === 'watched' ? total : 0;
  item.episodes = total > 0
    ? Array.from({ length: total }, (_, index) => ({
        id: item.id + '-ep-' + (index + 1),
        number: index + 1,
        seasonNum: 1,
        seasonName: '',
        epNum: index + 1,
        title: '',
        cover: item.cover || '',
        watched: status === 'watched',
        rating: 0
      }))
    : [];
  item.animeSeasonItems = [];
  return item;
}


// Import Library
let importReturnTab = 'mylist';
let pendingImportSource = '';
let pendingImportRows = [];
let activeImportSourcePage = '';
let steamImportExcludedKeys = new Set();
let importBusy = false;
const IMPORT_SOURCE_PAGE_CONFIG = {
  letterboxd: {
    label: 'Letterboxd',
    title: 'Letterboxd Library',
    subtitle: 'Import your whole Letterboxd export — watched, ratings, reviews, and watchlist in one go.',
    copy: 'Upload your full Letterboxd .ZIP export (recommended) and Shelfd reads watched, ratings, reviews and watchlist together — merging each film into one entry with its rating, review and real watch date. You can also pick the loose CSVs. Preview before syncing.',
    button: 'Choose Letterboxd .zip'
  },
  imdb: {
    label: 'IMDb',
    title: 'IMDb Library',
    subtitle: 'Import your IMDb ratings, watchlist, or custom list CSV.',
    copy: 'Upload your IMDb CSV export. Shelfd will match movies and TV shows, then let you confirm the import.',
    button: 'Choose IMDb file'
  },
  myanimelist: {
    label: 'MyAnimeList',
    title: 'MyAnimeList Library',
    subtitle: 'Import your MyAnimeList export — Shelfd groups split seasons into one series.',
    copy: 'Upload your MAL export directly — the raw .xml.gz works (no need to unzip), or a .xml / .zip. Shelfd reads the status and score for every entry, then groups the separate season entries MAL splits out (e.g. Jujutsu Kaisen S1, S2, S3) under one series, with each season keeping its own rating.',
    helper: 'Tip: on MyAnimeList, use Profile > Export to download your animelist .xml.gz, then upload it here.',
    button: 'Choose MyAnimeList file'
  },
  backloggd: {
    label: 'Backloggd',
    title: 'Backloggd Library',
    subtitle: 'Import your Backloggd-style or manual game CSV.',
    copy: 'Upload your game CSV. Shelfd will preview the games before syncing them into your Games list.',
    button: 'Choose Backloggd file'
  }
};
const STEAM_IMPORT_QUERY_FLAG = 'steam_import';
const STEAM_AUTH_RESULT_PARAM = 'steam_auth';
const STEAM_AUTH_STEAM_ID_PARAM = 'steam_id';
const STEAM_AUTH_MESSAGE_PARAM = 'steam_message';
const STEAM_PENDING_AUTH_STORAGE_KEY = 'shelfd-steam-auth-pending-v1';
const APPLE_MUSIC_CACHE_PREFIX = 'shelfd-apple-music-metadata-v1:';
const APPLE_MUSIC_DEV_TOKEN_CACHE_KEY = 'shelfd-apple-music-developer-token-v1';
const APPLE_MUSIC_KIT_SCRIPT_SRC = 'https://js-cdn.music.apple.com/musickit/v1/musickit.js';
const APPLE_MUSIC_MAX_CACHE_ALBUMS = 1200;
const APPLE_MUSIC_MAX_CACHE_SONGS = 2500;
const appleMusicKitRuntime = {
  loadingPromise: null,
  instance: null,
  developerToken: '',
  developerTokenExpiresAtMs: 0,
  musicUserToken: '',
  storefront: ''
};

function normalizeAppleMusicConnection(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const total = Number(source.lastMetadataTotal || source.libraryCount || source.lastImportPreviewTotal || 0);
  return {
    provider: 'appleMusic',
    connected: source.connected === true || source.authorized === true || !!source.connectedAt,
    storefront: String(source.storefront || source.storefrontId || '').trim(),
    musicUserId: String(source.musicUserId || source.userId || '').trim(),
    capabilities: Array.isArray(source.capabilities) ? source.capabilities.filter(Boolean) : [],
    subscription: source.subscription && typeof source.subscription === 'object' ? source.subscription : {},
    connectedAt: String(source.connectedAt || '').trim(),
    lastMetadataSyncedAt: String(source.lastMetadataSyncedAt || source.lastSyncedAt || '').trim(),
    lastImportPreviewAt: String(source.lastImportPreviewAt || '').trim(),
    lastMetadataTotal: Number.isFinite(total) && total > 0 ? Math.round(total) : 0
  };
}

function getAppleMusicConnection() {
  if (typeof normalizeAppleMusicConnection === 'function') {
    return normalizeAppleMusicConnection(userProfile?.appleMusicConnection || {});
  }
  return normalizeAppleMusicConnection({});
}

function getAppleMusicNativeBridge() {
  return window.Capacitor?.Plugins?.ShelfdAppleMusic || window.ShelfdAppleMusic || null;
}

function isShelfdNativeIosApp() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true
      && String(window.Capacitor?.getPlatform?.() || '').toLowerCase() === 'ios';
  } catch (_) {
    return /\bShelfdNativeNoInset\b/i.test(navigator.userAgent || '')
      && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  }
}

function getAppleMusicNativeBridgeRequiredMessage() {
  return 'Apple Music is ready server-side, but the iOS app needs a native MusicKit bridge update before connecting from TestFlight.';
}

function loadAppleMusicKitScript() {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (appleMusicKitRuntime.loadingPromise) return appleMusicKitRuntime.loadingPromise;
  appleMusicKitRuntime.loadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${APPLE_MUSIC_KIT_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.MusicKit), { once: true });
      existing.addEventListener('error', () => reject(new Error('Apple MusicKit could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = APPLE_MUSIC_KIT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(window.MusicKit);
    script.onerror = () => reject(new Error('Apple MusicKit could not load.'));
    document.head.appendChild(script);
  });
  return appleMusicKitRuntime.loadingPromise;
}

function readAppleMusicDeveloperTokenCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(APPLE_MUSIC_DEV_TOKEN_CACHE_KEY) || '{}') || {};
    if (cached.developerToken && Number(cached.expiresAtMs || 0) > Date.now() + 60000) return cached;
  } catch (_) {}
  return {};
}

function writeAppleMusicDeveloperTokenCache(payload = {}) {
  if (!payload.developerToken || !payload.expiresAtMs) return;
  try {
    sessionStorage.setItem(APPLE_MUSIC_DEV_TOKEN_CACHE_KEY, JSON.stringify({
      developerToken: payload.developerToken,
      expiresAtMs: Number(payload.expiresAtMs) || 0
    }));
  } catch (_) {}
}

async function fetchAppleMusicDeveloperToken(force = false) {
  if (!force && appleMusicKitRuntime.developerToken && appleMusicKitRuntime.developerTokenExpiresAtMs > Date.now() + 60000) {
    return appleMusicKitRuntime.developerToken;
  }
  if (!force) {
    const cached = readAppleMusicDeveloperTokenCache();
    if (cached.developerToken) {
      appleMusicKitRuntime.developerToken = cached.developerToken;
      appleMusicKitRuntime.developerTokenExpiresAtMs = Number(cached.expiresAtMs) || 0;
      return cached.developerToken;
    }
  }
  const response = await fetch('/api/apple-music/developer-token', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {}
  if (!response.ok || !payload?.ok || !payload.developerToken) {
    throw new Error(payload?.error || 'Apple Music developer token is not configured yet.');
  }
  appleMusicKitRuntime.developerToken = String(payload.developerToken || '').trim();
  appleMusicKitRuntime.developerTokenExpiresAtMs = Number(payload.expiresAtMs || 0) || 0;
  writeAppleMusicDeveloperTokenCache({
    developerToken: appleMusicKitRuntime.developerToken,
    expiresAtMs: appleMusicKitRuntime.developerTokenExpiresAtMs
  });
  return appleMusicKitRuntime.developerToken;
}

async function getAppleMusicKitInstance() {
  const [MusicKit, developerToken] = await Promise.all([
    loadAppleMusicKitScript(),
    fetchAppleMusicDeveloperToken()
  ]);
  if (!MusicKit?.configure && !MusicKit?.getInstance) {
    throw new Error('Apple MusicKit is unavailable on this device.');
  }
  if (!appleMusicKitRuntime.instance) {
    const appBuild = String(window.SCREENLIST_DISPLAY_VERSION || window.SCREENLIST_BUILD_VERSION || 'Shelfd').trim();
    appleMusicKitRuntime.instance = typeof MusicKit.configure === 'function'
      ? MusicKit.configure({
          developerToken,
          app: {
            name: 'Shelfd',
            build: appBuild
          }
        }) || MusicKit.getInstance?.()
      : MusicKit.getInstance?.();
  }
  return appleMusicKitRuntime.instance || MusicKit.getInstance?.();
}

async function authorizeAppleMusicWeb() {
  const music = await getAppleMusicKitInstance();
  if (!music) throw new Error('Apple MusicKit could not start.');
  const token = appleMusicKitRuntime.musicUserToken || music.musicUserToken || await music.authorize();
  if (!token) throw new Error('Apple Music permission was not granted.');
  appleMusicKitRuntime.musicUserToken = token;
  appleMusicKitRuntime.storefront = String(music.storefrontId || music.storefront || '').trim();
  return {
    authorized: true,
    connected: true,
    status: 'authorized',
    provider: 'appleMusic',
    storefront: appleMusicKitRuntime.storefront,
    capabilities: ['musickit-js'],
    connectedAt: new Date().toISOString()
  };
}

async function getAppleMusicWebUserToken() {
  const music = await getAppleMusicKitInstance();
  const token = appleMusicKitRuntime.musicUserToken || music?.musicUserToken || await music?.authorize?.();
  if (!token) throw new Error('Apple Music permission was not granted.');
  appleMusicKitRuntime.musicUserToken = token;
  appleMusicKitRuntime.storefront = String(music.storefrontId || music.storefront || appleMusicKitRuntime.storefront || '').trim();
  return token;
}

async function fetchAppleMusicApiPage(path, params = {}) {
  const developerToken = await fetchAppleMusicDeveloperToken();
  const musicUserToken = await getAppleMusicWebUserToken();
  const url = new URL(`https://api.music.apple.com${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${developerToken}`,
      'Music-User-Token': musicUserToken,
      Accept: 'application/json'
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || `Apple Music request failed (${response.status}).`);
  }
  return payload;
}

async function fetchAppleMusicLibraryCollection(kind = 'albums', maxItems = 200) {
  const collection = kind === 'songs' ? 'songs' : 'albums';
  const limit = 100;
  let offset = 0;
  const rows = [];
  const seen = new Set();
  while (rows.length < maxItems) {
    const payload = await fetchAppleMusicApiPage(`/v1/me/library/${collection}`, {
      limit,
      offset,
      include: collection === 'albums' ? 'tracks' : ''
    });
    const data = Array.isArray(payload.data) ? payload.data : [];
    data.forEach(item => {
      const id = String(item?.id || '').trim();
      const key = id || `${collection}:${String(item?.attributes?.name || item?.attributes?.albumName || '').toLowerCase()}:${String(item?.attributes?.artistName || '').toLowerCase()}`;
      if (!key || seen.has(key) || rows.length >= maxItems) return;
      seen.add(key);
      rows.push(item);
    });
    if (data.length < limit || !payload.next) break;
    offset += limit;
  }
  return rows;
}

async function getAppleMusicWebMetadata(payload = {}) {
  await authorizeAppleMusicWeb();
  const importLibrary = payload?.importLibrary === true;
  const [albums, songs] = await Promise.all([
    fetchAppleMusicLibraryCollection('albums', importLibrary ? APPLE_MUSIC_MAX_CACHE_ALBUMS : 300),
    fetchAppleMusicLibraryCollection('songs', importLibrary ? APPLE_MUSIC_MAX_CACHE_SONGS : 600)
  ]);
  return {
    albums,
    songs,
    storefront: appleMusicKitRuntime.storefront,
    albumCount: albums.length,
    songCount: songs.length
  };
}

function getAppleMusicCacheKey() {
  const uid = currentUser?.uid || userProfile?.uid || 'preview-user';
  return `${APPLE_MUSIC_CACHE_PREFIX}${uid}`;
}

function readAppleMusicMetadataCache() {
  try {
    return JSON.parse(localStorage.getItem(getAppleMusicCacheKey()) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function writeAppleMusicMetadataCache(payload = {}) {
  const albums = Array.isArray(payload.albums) ? payload.albums.slice(0, APPLE_MUSIC_MAX_CACHE_ALBUMS) : [];
  const songs = Array.isArray(payload.songs) ? payload.songs.slice(0, APPLE_MUSIC_MAX_CACHE_SONGS) : [];
  const summary = buildAppleMusicMetadataSummary({ ...payload, albums, songs });
  const cache = { version: 1, cachedAt: new Date().toISOString(), summary, albums, songs };
  try {
    localStorage.setItem(getAppleMusicCacheKey(), JSON.stringify(cache));
  } catch (error) {
    console.warn('Apple Music metadata cache write failed:', error);
  }
  return cache;
}

function buildAppleMusicMetadataSummary(payload = {}) {
  const albums = Array.isArray(payload.albums) ? payload.albums : [];
  const songs = Array.isArray(payload.songs) ? payload.songs : [];
  const totalDurationMs = songs.reduce((sum, song) => sum + Number(song.durationMs || song.length || 0), 0);
  const favoriteSongs = songs.filter(song => song.favorite || song.favorited || song.isFavorite).length;
  const ratedSongs = songs.filter(song => Number(song.rating || song.userRating || 0) > 0).length;
  return {
    albumCount: Number(payload.albumCount || albums.length || 0) || 0,
    songCount: Number(payload.songCount || songs.length || 0) || 0,
    totalDurationMs,
    favoriteSongs,
    ratedSongs,
    storefront: String(payload.storefront || '').trim(),
    updatedAt: new Date().toISOString()
  };
}

async function saveAppleMusicProfilePatch(patch = {}) {
  if (!userProfile) userProfile = typeof normalizeUserProfile === 'function' ? normalizeUserProfile({}) : {};
  Object.assign(userProfile, patch);
  if (typeof saveProfileSettingsPatch === 'function') {
    return saveProfileSettingsPatch(patch);
  }
  if (!currentUser || isPreviewMode()) return true;
  await db.collection('users').doc(currentUser.uid).set({
    ...patch,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return true;
}

function formatAppleMusicRelativeSyncTime(value = '') {
  return formatSteamRelativeSyncTime(value);
}

// v11.943: honest, library-derived Apple Music stats. Apple does NOT expose
// play counts, skips, or minutes listened to the public API, so this panel only
// shows what's actually in the user's library + what they favorite/rate. Every
// figure is labeled "your library", never "plays"/"minutes listened".
function formatAppleMusicRuntime(ms = 0) {
  const totalMin = Math.round(Number(ms || 0) / 60000);
  if (totalMin <= 0) return '0m';
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 1) return `${hours.toLocaleString('en-US')}h${mins ? ` ${mins}m` : ''}`;
  return `${mins}m`;
}

function getAppleMusicStatsModel() {
  const cache = readAppleMusicMetadataCache();
  const summary = (cache && cache.summary) || (userProfile && userProfile.appleMusicMetadataSummary) || {};
  const albums = Array.isArray(cache.albums) ? cache.albums : [];
  const songs = Array.isArray(cache.songs) ? cache.songs : [];
  const artistCounts = new Map();
  const genreCounts = new Map();
  albums.forEach(album => {
    const artist = String(album.artist || '').trim();
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    const genre = String(album.genre || '').trim();
    if (genre) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  });
  const rank = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    albumCount: Number(summary.albumCount || albums.length || 0) || 0,
    songCount: Number(summary.songCount || songs.length || 0) || 0,
    totalDurationMs: Number(summary.totalDurationMs || 0) || 0,
    favoriteSongs: Number(summary.favoriteSongs || 0) || 0,
    ratedSongs: Number(summary.ratedSongs || 0) || 0,
    topArtists: rank(artistCounts),
    topGenres: rank(genreCounts),
    syncedAt: (cache && cache.cachedAt) || summary.updatedAt || getAppleMusicConnection().lastMetadataSyncedAt || ''
  };
}

function renderAppleMusicStatsPanelHtml() {
  const m = getAppleMusicStatsModel();
  if (!m.songCount && !m.albumCount) {
    return `<div class="apple-music-stats apple-music-stats-empty">
      <p class="apple-music-stats-note">Connected. Sync your Apple Music metadata to see your library stats here.</p>
    </div>`;
  }
  const tile = (value, label) => `<div class="apple-music-stat-tile"><strong>${escHtml(String(value))}</strong><span>${escHtml(label)}</span></div>`;
  const chips = (rows) => rows.map(([name, count]) => `<span class="apple-music-stat-chip">${escHtml(name)}<i>${count}</i></span>`).join('');
  const synced = m.syncedAt ? formatAppleMusicRelativeSyncTime(m.syncedAt) : '';
  return `<div class="apple-music-stats">
    <div class="apple-music-stats-head">
      <span class="apple-music-stats-kicker">Your Apple Music library</span>
      ${synced ? `<span class="apple-music-stats-synced">Synced ${escHtml(synced)}</span>` : ''}
    </div>
    <div class="apple-music-stats-grid">
      ${tile(m.albumCount.toLocaleString('en-US'), 'Albums')}
      ${tile(m.songCount.toLocaleString('en-US'), 'Songs')}
      ${tile(formatAppleMusicRuntime(m.totalDurationMs), 'Library runtime')}
      ${tile(m.favoriteSongs.toLocaleString('en-US'), 'Favorites')}
      ${tile(m.ratedSongs.toLocaleString('en-US'), 'Rated')}
    </div>
    ${m.topArtists.length ? `<div class="apple-music-stats-block"><div class="apple-music-stats-block-title">Most in your library · Artists</div><div class="apple-music-stats-chips">${chips(m.topArtists)}</div></div>` : ''}
    ${m.topGenres.length ? `<div class="apple-music-stats-block"><div class="apple-music-stats-block-title">Most in your library · Genres</div><div class="apple-music-stats-chips">${chips(m.topGenres)}</div></div>` : ''}
    <p class="apple-music-stats-note">Apple does not share play counts, skips, or minutes listened, so these reflect what's in your library and what you favorite or rate. Listening trends will build over time as you use Shelfd.</p>
  </div>`;
}

function renderAppleMusicImportCardState() {
  const card = document.getElementById('apple-music-import-card');
  if (!card) return;
  // v11.945: Apple Music import is dev-only (King Kooom) for now. The card is
  // hidden by default in CSS; this class reveals it only for the creator account.
  const appleMusicAllowed = typeof isCreatorAdmin === 'function'
    && isCreatorAdmin(typeof currentUser !== 'undefined' ? currentUser : null);
  card.classList.toggle('shelfd-am-allowed', !!appleMusicAllowed);
  const copyEl = document.getElementById('apple-music-import-copy');
  const metaEl = document.getElementById('apple-music-import-meta');
  const actionEl = document.getElementById('apple-music-import-action');
  const connection = getAppleMusicConnection();
  const busy = importBusy && pendingImportSource === 'applemusic';
  card.classList.toggle('is-connected', !!connection.connected);
  card.classList.toggle('is-busy', !!busy);
  if (copyEl) {
    copyEl.textContent = connection.connected
      ? 'Connected for Apple Music metadata. Import your full library only when you choose.'
      : 'Connect Apple Music for metadata, stats, and optional Music shelf import.';
  }
  if (metaEl) {
    if (connection.connected) {
      const lastSync = connection.lastMetadataSyncedAt ? formatAppleMusicRelativeSyncTime(connection.lastMetadataSyncedAt) : '';
      const pieces = [
        connection.storefront ? `Storefront ${connection.storefront.toUpperCase()}` : 'Apple Music connected',
        connection.lastMetadataTotal ? `${connection.lastMetadataTotal.toLocaleString('en-US')} songs indexed` : '',
        lastSync ? `Metadata ${lastSync}` : ''
      ].filter(Boolean);
      metaEl.textContent = pieces.join(' · ');
    } else {
      metaEl.textContent = 'Connect only for metadata, or preview albums before importing.';
    }
  }
  if (actionEl) actionEl.textContent = busy ? 'Syncing...' : (connection.connected ? 'Manage Apple Music' : 'Connect Apple Music');
}

function closeAppleMusicConnectSheet() {
  const sheet = document.getElementById('apple-music-connect-sheet');
  if (sheet) sheet.remove();
}

function openAppleMusicConnectSheet() {
  closeAppleMusicConnectSheet();
  const connection = getAppleMusicConnection();
  const sheet = document.createElement('div');
  sheet.id = 'apple-music-connect-sheet';
  sheet.className = 'apple-music-connect-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <div class="apple-music-connect-card">
      <button class="apple-music-connect-close" type="button" onclick="closeAppleMusicConnectSheet()" aria-label="Close">×</button>
      <img class="apple-music-connect-logo" src="/assets/import-icons/apple-music.png" alt="" loading="eager" decoding="async">
      <div class="apple-music-connect-kicker">Apple Music</div>
      <div class="apple-music-connect-title">${connection.connected ? 'Manage Apple Music' : 'Connect Apple Music'}</div>
      <div class="apple-music-connect-copy">Choose whether Shelfd only connects for Apple Music metadata, or also previews your full Apple Music library for import.</div>
      ${connection.connected ? renderAppleMusicStatsPanelHtml() : ''}
      <div class="apple-music-connect-actions">
        <button type="button" class="apple-music-connect-option" onclick="connectAppleMusicAccount('metadata')">
          <strong>Connect Only</strong>
          <span>Fetch metadata and stats. Nothing is added to your Shelfd Music shelf.</span>
        </button>
        <button type="button" class="apple-music-connect-option primary" onclick="connectAppleMusicAccount('import')">
          <strong>Connect + Import Library</strong>
          <span>Connect first, then preview albums before adding them to Shelfd.</span>
        </button>
      </div>
      <div id="apple-music-connect-status" class="import-status" aria-live="polite"></div>
    </div>
  `;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('show'));
  if (!isShelfdNativeIosApp() || getAppleMusicNativeBridge()) {
    loadAppleMusicKitScript().catch(() => {});
    fetchAppleMusicDeveloperToken().catch(() => {});
  }
}

function setAppleMusicConnectStatus(message = '', kind = '') {
  const el = document.getElementById('apple-music-connect-status');
  if (!el) return;
  el.className = ['import-status', kind ? `import-status-${kind}` : ''].filter(Boolean).join(' ');
  el.textContent = message;
}

function handleAppleMusicImportAction(event) {
  if (event) event.preventDefault();
  if (importBusy) return;
  openImportPage();
  openAppleMusicConnectSheet();
  renderAppleMusicImportCardState();
}

async function callAppleMusicBridge(methodNames = [], payload = {}) {
  const bridge = getAppleMusicNativeBridge();
  const method = bridge ? methodNames.find(name => typeof bridge[name] === 'function') : '';
  if (bridge && method) {
    return bridge[method](payload);
  }
  if (isShelfdNativeIosApp()) {
    throw new Error(getAppleMusicNativeBridgeRequiredMessage());
  }
  const joined = methodNames.join(' / ').toLowerCase();
  if (/authorize|requestauthorization|connect/.test(joined)) {
    return authorizeAppleMusicWeb(payload);
  }
  if (/metadata|library|sync/.test(joined)) {
    return getAppleMusicWebMetadata(payload);
  }
  throw new Error(`Apple Music bridge is missing ${methodNames.join(' / ')}.`);
}

async function connectAppleMusicAccount(mode = 'metadata') {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const wantsImport = mode === 'import';
  pendingImportSource = 'applemusic';
  importBusy = true;
  renderAppleMusicImportCardState();
  setAppleMusicConnectStatus('Requesting Apple Music permission...', 'busy');
  setImportStatus('Requesting Apple Music permission...', 'busy');
  try {
    const auth = await callAppleMusicBridge(['authorize', 'requestAuthorization', 'connect'], { mode });
    const authorized = auth?.authorized !== false && auth?.status !== 'denied' && auth?.status !== 'restricted';
    if (!authorized) throw new Error('Apple Music permission was not granted.');
    const connectedAt = getAppleMusicConnection().connectedAt || new Date().toISOString();
    const connection = normalizeAppleMusicConnection({
      ...auth,
      connected: true,
      authorized: true,
      connectedAt,
      lastImportPreviewAt: wantsImport ? new Date().toISOString() : getAppleMusicConnection().lastImportPreviewAt
    });
    await saveAppleMusicProfilePatch({ appleMusicConnection: connection });
    setAppleMusicConnectStatus(wantsImport ? 'Connected. Pulling Apple Music library preview...' : 'Connected. Syncing metadata only...', 'busy');
    if (wantsImport) {
      await syncAppleMusicLibraryPreview();
    } else {
      await syncAppleMusicMetadataOnly();
      closeAppleMusicConnectSheet();
    }
  } catch (error) {
    console.error('Apple Music connect failed:', error);
    const message = error?.message || 'Apple Music could not connect.';
    setAppleMusicConnectStatus(message, 'error');
    setImportStatus(message, 'error');
    showToast(message);
  } finally {
    importBusy = false;
    renderAppleMusicImportCardState();
  }
}

function getAppleMusicArtworkUrl(artwork = {}, size = 600) {
  const raw = String(artwork?.url || artwork || '').trim();
  if (!raw) return '';
  return raw.replace('{w}', String(size)).replace('{h}', String(size));
}

function normalizeAppleMusicSong(raw = {}) {
  const attrs = raw.attributes || raw;
  const albumAttrs = raw.relationships?.albums?.data?.[0]?.attributes || {};
  return {
    appleMusicSongId: String(raw.id || attrs.id || attrs.playParams?.id || '').trim(),
    title: String(attrs.name || attrs.title || '').trim(),
    artist: String(attrs.artistName || attrs.artist || '').trim(),
    album: String(attrs.albumName || albumAttrs.name || attrs.album || '').trim(),
    albumArtist: String(attrs.albumArtistName || attrs.artistName || '').trim(),
    appleMusicAlbumId: String(attrs.albumId || raw.relationships?.albums?.data?.[0]?.id || '').trim(),
    durationMs: Number(attrs.durationInMillis || attrs.durationMs || attrs.length || 0) || 0,
    trackNumber: Number(attrs.trackNumber || attrs.track_position || 0) || 0,
    discNumber: Number(attrs.discNumber || 1) || 1,
    releaseDate: String(attrs.releaseDate || '').trim(),
    genre: Array.isArray(attrs.genreNames) ? attrs.genreNames[0] || '' : String(attrs.genre || '').trim(),
    artwork: getAppleMusicArtworkUrl(attrs.artwork || albumAttrs.artwork || '', 600),
    favorite: !!(attrs.favorite || attrs.favorited || attrs.isFavorite),
    rating: Number(attrs.rating || attrs.userRating || 0) || 0,
    playParams: attrs.playParams || null
  };
}

function normalizeAppleMusicAlbum(raw = {}) {
  const attrs = raw.attributes || raw;
  const relSongs = raw.relationships?.tracks?.data || raw.tracks || [];
  const songs = Array.isArray(relSongs) ? relSongs.map(normalizeAppleMusicSong).filter(song => song.title) : [];
  return {
    appleMusicAlbumId: String(raw.id || attrs.id || attrs.playParams?.id || '').trim(),
    title: String(attrs.name || attrs.title || '').trim(),
    artist: String(attrs.artistName || attrs.artist || '').trim(),
    releaseDate: String(attrs.releaseDate || '').trim(),
    year: String(attrs.releaseDate || attrs.year || '').slice(0, 4),
    genre: Array.isArray(attrs.genreNames) ? attrs.genreNames[0] || '' : String(attrs.genre || '').trim(),
    cover: getAppleMusicArtworkUrl(attrs.artwork || attrs.cover || '', 900),
    trackCount: Number(attrs.trackCount || songs.length || 0) || 0,
    playParams: attrs.playParams || null,
    songs
  };
}

function buildAppleMusicAlbumRows(payload = {}) {
  const rawAlbums = Array.isArray(payload.albums) ? payload.albums : Array.isArray(payload.data) ? payload.data : [];
  const rawSongs = Array.isArray(payload.songs) ? payload.songs : [];
  const albums = rawAlbums.map(normalizeAppleMusicAlbum).filter(album => album.title);
  const songs = rawSongs.map(normalizeAppleMusicSong).filter(song => song.title);
  const albumMap = new Map();
  albums.forEach(album => {
    const key = album.appleMusicAlbumId || `${album.title}::${album.artist}`.toLowerCase();
    albumMap.set(key, { ...album, songs: Array.isArray(album.songs) ? album.songs.slice() : [] });
  });
  songs.forEach(song => {
    const key = song.appleMusicAlbumId || `${song.album || song.title}::${song.albumArtist || song.artist}`.toLowerCase();
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        appleMusicAlbumId: song.appleMusicAlbumId,
        title: song.album || song.title,
        artist: song.albumArtist || song.artist,
        releaseDate: song.releaseDate,
        year: String(song.releaseDate || '').slice(0, 4),
        genre: song.genre,
        cover: song.artwork,
        trackCount: 0,
        songs: []
      });
    }
    const album = albumMap.get(key);
    if (!album.songs.some(existing => existing.appleMusicSongId && existing.appleMusicSongId === song.appleMusicSongId)) {
      album.songs.push(song);
    }
    if (!album.cover && song.artwork) album.cover = song.artwork;
  });
  return [...albumMap.values()].map(album => ({
    source: 'applemusic',
    typeHint: 'music',
    title: album.title,
    artist: album.artist,
    year: album.year,
    status: 'watched',
    rating: 0,
    appleMusicAlbumId: album.appleMusicAlbumId,
    appleMusicSongIds: album.songs.map(song => song.appleMusicSongId).filter(Boolean),
    cover: album.cover,
    releaseDate: album.releaseDate,
    genre: album.genre,
    trackCount: album.trackCount || album.songs.length,
    tracks: album.songs
      .sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber))
      .map((song, index) => ({
        number: song.trackNumber || index + 1,
        title: song.title,
        length: song.durationMs,
        appleMusicSongId: song.appleMusicSongId,
        rating: song.rating,
        favorite: song.favorite ? 1 : 0,
        playParams: song.playParams || null
      })),
    raw: album
  }));
}

async function syncAppleMusicMetadataOnly() {
  setImportStatus('Syncing Apple Music metadata...', 'busy');
  let payload = null;
  try {
    payload = await callAppleMusicBridge(['getMetadata', 'syncMetadata', 'getLibraryMetadata'], { importLibrary: false });
  } catch (error) {
    const message = error?.message || '';
    if (!/missing getMetadata|missing syncMetadata|missing getLibraryMetadata/i.test(message)) throw error;
    const connectedAt = getAppleMusicConnection().connectedAt || new Date().toISOString();
    const connection = normalizeAppleMusicConnection({
      ...getAppleMusicConnection(),
      connected: true,
      connectedAt,
      lastMetadataSyncedAt: ''
    });
    await saveAppleMusicProfilePatch({ appleMusicConnection: connection });
    setImportStatus('Apple Music connected. Metadata sync is waiting for the native iOS metadata method.', 'ready');
    showToast('Apple Music connected');
    return;
  }
  const rows = buildAppleMusicAlbumRows(payload || {});
  const songs = rows.flatMap(row => row.tracks || []).map(track => ({
    title: track.title,
    appleMusicSongId: track.appleMusicSongId,
    durationMs: track.length,
    rating: track.rating,
    favorite: !!track.favorite
  }));
  const cache = writeAppleMusicMetadataCache({
    albums: rows.map(row => ({
      title: row.title,
      artist: row.artist,
      appleMusicAlbumId: row.appleMusicAlbumId,
      year: row.year,
      trackCount: row.trackCount,
      cover: row.cover,
      genre: row.genre
    })),
    songs,
    storefront: getAppleMusicConnection().storefront
  });
  const connection = normalizeAppleMusicConnection({
    ...getAppleMusicConnection(),
    connected: true,
    lastMetadataSyncedAt: cache.cachedAt,
    lastMetadataTotal: cache.summary.songCount
  });
  await saveAppleMusicProfilePatch({
    appleMusicConnection: connection,
    appleMusicMetadataSummary: cache.summary
  });
  setImportStatus(`Apple Music connected. Metadata synced for ${cache.summary.songCount.toLocaleString('en-US')} song${cache.summary.songCount === 1 ? '' : 's'}.`, 'ready');
  showToast('Apple Music metadata synced');
}

async function syncAppleMusicLibraryPreview() {
  setImportStatus('Pulling Apple Music library preview...', 'busy');
  const payload = await callAppleMusicBridge(['getLibrary', 'syncLibrary', 'getLibraryPreview'], { importLibrary: true });
  const rows = buildAppleMusicAlbumRows(payload || {});
  if (!rows.length) {
    setImportStatus('Apple Music returned no albums to preview.', 'error');
    setAppleMusicConnectStatus('No Apple Music albums were returned.', 'error');
    return;
  }
  pendingImportSource = 'applemusic';
  pendingImportRows = rows;
  writeAppleMusicMetadataCache({
    albums: rows.map(row => ({
      title: row.title,
      artist: row.artist,
      appleMusicAlbumId: row.appleMusicAlbumId,
      year: row.year,
      trackCount: row.trackCount,
      cover: row.cover,
      genre: row.genre
    })),
    songs: rows.flatMap(row => row.tracks || []),
    storefront: getAppleMusicConnection().storefront
  });
  const nextConnection = normalizeAppleMusicConnection({
    ...getAppleMusicConnection(),
    connected: true,
    lastImportPreviewAt: new Date().toISOString(),
    lastMetadataTotal: rows.reduce((sum, row) => sum + Number(row.trackCount || row.tracks?.length || 0), 0)
  });
  await saveAppleMusicProfilePatch({ appleMusicConnection: nextConnection });
  closeAppleMusicConnectSheet();
  setImportStatus(`Found ${rows.length.toLocaleString('en-US')} Apple Music album${rows.length === 1 ? '' : 's'}. Review, then import.`, 'ready');
  renderImportPreview();
}

function getSteamImportConnection() {
  if (typeof normalizeSteamConnection === 'function') {
    return normalizeSteamConnection(userProfile?.steamConnection || {});
  }
  const raw = userProfile?.steamConnection || {};
  return {
    steamId: String(raw.steamId || '').trim(),
    personaName: String(raw.personaName || '').trim(),
    profileUrl: String(raw.profileUrl || '').trim(),
    avatar: String(raw.avatar || '').trim(),
    connectedAt: String(raw.connectedAt || '').trim(),
    lastSyncedAt: String(raw.lastSyncedAt || '').trim(),
    lastSyncTotal: Number(raw.lastSyncTotal || 0) || 0
  };
}

function formatSteamRelativeSyncTime(value = '') {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return '';
  const diffMinutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function renderSteamImportCardState() {
  const card = document.getElementById('steam-import-card');
  if (!card) return;
  const copyEl = document.getElementById('steam-import-copy');
  const metaEl = document.getElementById('steam-import-meta');
  const actionEl = document.getElementById('steam-import-action');
  const connection = getSteamImportConnection();
  const busy = importBusy && pendingImportSource === 'steam';
  card.classList.toggle('is-connected', !!connection.steamId);
  card.classList.toggle('is-busy', !!busy);
  if (copyEl) {
    copyEl.textContent = connection.steamId
      ? 'Pull your owned Steam games and playtime into Shelfd with a confirm step before import.'
      : 'Connect your Steam account and pull your owned games with playtime.';
  }
  if (metaEl) {
    if (connection.steamId) {
      const lastSync = connection.lastSyncedAt ? formatSteamRelativeSyncTime(connection.lastSyncedAt) : '';
      const pieces = [
        connection.personaName ? `Connected as ${connection.personaName}` : 'Steam connected',
        connection.lastSyncTotal ? `${connection.lastSyncTotal} games last synced` : '',
        lastSync ? `Last sync ${lastSync}` : ''
      ].filter(Boolean);
      metaEl.textContent = pieces.join(' · ');
    } else {
      metaEl.textContent = 'Uses proper Sign in through Steam, then syncs on demand.';
    }
  }
  if (actionEl) {
    actionEl.textContent = busy ? 'Syncing...' : (connection.steamId ? 'Sync library' : 'Connect Steam');
  }
}


function getImportSourcePageConfig(source = '') {
  return IMPORT_SOURCE_PAGE_CONFIG[source] || {
    label: getImportSourceLabel(source),
    title: `${getImportSourceLabel(source)} Library`,
    subtitle: 'Import your export file into Shelfd.',
    copy: 'Choose an export file to preview before syncing.',
    button: 'Choose file'
  };
}

function openImportSourcePage(source = '', options = {}) {
  const cleanSource = String(source || '').trim().toLowerCase();
  if (!cleanSource || cleanSource === 'steam') return;
  openImportPage();
  if (activeImportSourcePage !== cleanSource && !options.preservePreview) {
    pendingImportSource = cleanSource;
    pendingImportRows = [];
    clearImportPreview();
    setImportStatus('', '');
  }
  activeImportSourcePage = cleanSource;
  const config = getImportSourcePageConfig(cleanSource);
  const panel = document.getElementById('import-source-detail-panel');
  const title = document.getElementById('import-source-detail-title');
  const subtitle = document.getElementById('import-source-detail-subtitle');
  const cardTitle = document.getElementById('import-source-detail-card-title');
  const cardCopy = document.getElementById('import-source-detail-card-copy');
  const helper = document.getElementById('import-source-detail-helper');
  const fileBtn = document.getElementById('import-source-detail-file-btn');
  if (title) title.textContent = config.title;
  if (subtitle) subtitle.textContent = config.subtitle;
  if (cardTitle) cardTitle.textContent = `Upload ${config.label} export`;
  if (cardCopy) cardCopy.textContent = config.copy;
  if (helper) {
    const helperText = String(config.helper || '').trim();
    helper.textContent = helperText;
    helper.hidden = !helperText;
  }
  if (fileBtn) fileBtn.textContent = config.button;
  if (panel) {
    panel.dataset.importSource = cleanSource;
    panel.setAttribute('aria-hidden', 'false');
    panel.style.display = 'block';
    requestAnimationFrame(() => panel.classList.add('open'));
  }
  document.body.classList.add('import-source-detail-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function closeImportSourcePage() {
  const panel = document.getElementById('import-source-detail-panel');
  if (panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!panel.classList.contains('open')) panel.style.display = 'none';
    }, 260);
  }
  document.body.classList.remove('import-source-detail-open');
  activeImportSourcePage = '';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function triggerImportFilePicker(source = '') {
  const cleanSource = String(source || activeImportSourcePage || pendingImportSource || '').trim().toLowerCase();
  const input = document.getElementById(`import-file-${cleanSource}`);
  if (!input) return;
  input.value = '';
  input.click();
}

function openSteamImportPage() {
  openImportPage();
  requestAnimationFrame(() => {
    const card = document.getElementById('steam-import-card');
    if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    renderSteamImportCardState();
  });
}

function openImportPage() {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  importReturnTab = getActiveMainTab ? getActiveMainTab() : 'mylist';
  document.body.classList.add('import-page-active');
  document.body.classList.remove('steam-sync-page-active');
  syncMainNavButtons('');
  setBottomNavVisibility(false);
  setMainNavVisibility('import');
  window.scrollTo({ top: 0, behavior: 'auto' });
  persistUiState();
  renderSteamImportCardState();
  renderAppleMusicImportCardState();
  if (typeof renderXboxImportCardState === 'function') renderXboxImportCardState();
}

function closeImportPage() {
  const next = importReturnTab || 'mylist';
  document.body.classList.remove('import-page-active', 'steam-sync-page-active');
  setBottomNavVisibility(true);
  syncMainNavButtons(next);
  setMainNavVisibility(next);
  if (next === 'discover' && typeof loadActiveDiscoveryHub === 'function') loadActiveDiscoveryHub();
  if (next === 'community' && typeof openFriendsActivityDefault === 'function') openFriendsActivityDefault();
  persistUiState();
  pendingImportSource = '';
  activeImportSourcePage = '';
  document.body.classList.remove('import-source-detail-open');
  const importSourcePanel = document.getElementById('import-source-detail-panel');
  if (importSourcePanel) {
    importSourcePanel.classList.remove('open');
    importSourcePanel.style.display = 'none';
    importSourcePanel.setAttribute('aria-hidden', 'true');
  }
  renderSteamImportCardState();
  renderAppleMusicImportCardState();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function setImportStatus(message = '', kind = '') {
  const className = ['import-status', kind ? `import-status-${kind}` : ''].filter(Boolean).join(' ');
  ['import-status', 'import-detail-status'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = className;
    el.textContent = message;
  });
}

function clearImportPreview() {
  ['import-preview', 'import-detail-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function setSteamSyncStatus(message = '', kind = '') {
  const el = document.getElementById('steam-sync-status');
  if (!el) return;
  el.className = ['import-status', kind ? `import-status-${kind}` : ''].filter(Boolean).join(' ');
  el.textContent = message;
}

function clearSteamSyncPreview() {
  const el = document.getElementById('steam-sync-preview');
  if (el) el.innerHTML = '';
  steamImportExcludedKeys = new Set();
}

function openSteamSyncPage() {
  document.body.classList.add('steam-sync-page-active');
  document.body.classList.remove('import-page-active');
  syncMainNavButtons('');
  setBottomNavVisibility(false);
  setMainNavVisibility('steam-sync');
  window.scrollTo({ top: 0, behavior: 'auto' });
  persistUiState();
}

function closeSteamSyncPage() {
  document.body.classList.add('import-page-active');
  document.body.classList.remove('steam-sync-page-active');
  setBottomNavVisibility(false);
  setMainNavVisibility('import');
  renderSteamImportCardState();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderSteamSyncSummary(count = 0) {
  const connection = getSteamImportConnection();
  const titleEl = document.getElementById('steam-sync-summary-title');
  const copyEl = document.getElementById('steam-sync-summary-copy');
  if (titleEl) {
    titleEl.textContent = count
      ? `${count.toLocaleString('en-US')} Steam game${count === 1 ? '' : 's'} ready`
      : (connection.personaName ? `Connected as ${connection.personaName}` : 'Steam connected');
  }
  if (copyEl) {
    const played = pendingImportRows.filter(row => Number(row.playtimeMinutes || 0) > 0).length;
    copyEl.textContent = count
      ? `${played.toLocaleString('en-US')} with playtime. Review below, then import to Shelfd.`
      : 'Your library preview will appear here after Steam responds.';
  }
}

function getSteamImportRowKey(row = {}, index = 0) {
  return String(row.steamAppId || `steam-row-${index}`).trim();
}

function getSelectedSteamImportRows() {
  return pendingImportRows.filter((row, index) => !steamImportExcludedKeys.has(getSteamImportRowKey(row, index)));
}

function updateSteamSyncSelectionUi() {
  const selectedCount = getSelectedSteamImportRows().length;
  const totalCount = pendingImportRows.length;
  const countEl = document.getElementById('steam-sync-selection-count');
  const importBtn = document.getElementById('steam-sync-import-btn');
  if (countEl) countEl.textContent = `${selectedCount.toLocaleString('en-US')} of ${totalCount.toLocaleString('en-US')} selected`;
  if (importBtn) {
    importBtn.disabled = selectedCount <= 0 || importBusy;
    importBtn.textContent = selectedCount > 0 ? `Import ${selectedCount.toLocaleString('en-US')} to Shelfd` : 'Select games to import';
  }
}

function toggleSteamImportRow(key = '', checked = true) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return;
  if (checked) steamImportExcludedKeys.delete(cleanKey);
  else steamImportExcludedKeys.add(cleanKey);
  const rowEl = Array.from(document.querySelectorAll('[data-steam-import-key]'))
    .find(el => el.dataset.steamImportKey === cleanKey);
  if (rowEl) rowEl.classList.toggle('is-excluded', !checked);
  updateSteamSyncSelectionUi();
}

function closeSteamImportSuccessSplash() {
  const splash = document.getElementById('steam-import-success-splash');
  if (!splash) return;
  splash.classList.add('closing');
  setTimeout(() => splash.remove(), 260);
}

function showSteamImportSuccessSplash({ added = 0, repaired = 0, skipped = 0, failed = 0, total = 0, providerLabel = 'Steam', itemLabel = 'title' } = {}) {
  const previous = document.getElementById('steam-import-success-splash');
  if (previous) previous.remove();
  const cleanProvider = String(providerLabel || 'Import').trim();
  const completed = Math.max(0, Number(added || 0) + Number(repaired || 0) + Number(skipped || 0));
  const totalCount = Math.max(total, completed);
  const noun = cleanProvider === 'Steam' ? 'games' : `${itemLabel || 'title'}${totalCount === 1 ? '' : 's'}`;
  const importedCopy = completed
    ? `${completed.toLocaleString('en-US')} of ${totalCount.toLocaleString('en-US')} selected ${noun} finished syncing.`
    : `Your ${cleanProvider} library sync finished.`;
  const detailBits = [
    added ? `${added.toLocaleString('en-US')} added` : '',
    repaired ? `${repaired.toLocaleString('en-US')} updated` : '',
    skipped ? `${skipped.toLocaleString('en-US')} already in Shelfd` : '',
    failed ? `${failed.toLocaleString('en-US')} unmatched` : ''
  ].filter(Boolean);
  const splash = document.createElement('div');
  splash.id = 'steam-import-success-splash';
  splash.className = 'steam-import-success-splash';
  splash.setAttribute('role', 'status');
  splash.setAttribute('aria-live', 'polite');
  splash.innerHTML = `
    <div class="steam-import-success-burst" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span><span></span>
    </div>
    <div class="steam-import-success-card">
      <div class="steam-import-success-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M20 6 9 17l-5-5"></path></svg>
      </div>
      <div class="steam-import-success-kicker">${escHtml(cleanProvider)} sync complete</div>
      <div class="steam-import-success-title">Your library is synced to Shelfd</div>
      <div class="steam-import-success-copy">${escHtml(importedCopy)}</div>
      <div class="steam-import-success-detail">${escHtml(detailBits.join(' · ') || 'Ready in My Lists')}</div>
      <button class="steam-import-success-btn" type="button" onclick="closeSteamImportSuccessSplash()">Continue</button>
    </div>
  `;
  document.body.appendChild(splash);
  requestAnimationFrame(() => splash.classList.add('show'));
  setTimeout(closeSteamImportSuccessSplash, 5200);
}

function normalizeImportText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeImportHeader(value = '') {
  return normalizeImportText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getImportRowValue(row = {}, names = []) {
  const keys = Object.keys(row || {});
  const normalized = new Map(keys.map(key => [normalizeImportHeader(key), key]));
  for (const name of names) {
    const hit = normalized.get(normalizeImportHeader(name));
    if (hit !== undefined) return row[hit];
  }
  return '';
}

function parseScreenListCsv(text = '') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  const cleanRows = rows.filter(r => r.some(cell => String(cell || '').trim() !== ''));
  if (!cleanRows.length) return [];
  const headers = cleanRows[0].map(h => normalizeImportText(h));
  return cleanRows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((header, index) => { obj[header || `Column ${index + 1}`] = normalizeImportText(cells[index] || ''); });
    return obj;
  });
}

function normalizeImportRating(value = '', source = '') {
  const raw = normalizeImportText(value);
  if (!raw || raw === '-') return 0;
  const numeric = Number(raw.replace(/[^0-9.]/g, ''));
  if (!(numeric > 0)) return 0;
  if (source === 'letterboxd') return Math.max(0, Math.min(10, Math.round(numeric * 2)));
  if (source === 'backloggd' && numeric <= 5) return Math.max(0, Math.min(10, Math.round(numeric * 2)));
  return Math.max(0, Math.min(10, Math.round(numeric)));
}

function normalizeImportStatus(value = '', source = '') {
  const raw = normalizeImportText(value).toLowerCase();
  if (source === 'myanimelist') {
    if (/complete|completed|watched|finished/.test(raw)) return 'watched';
    if (/watching|current|in progress|progress/.test(raw)) return 'watching';
    if (/plan|watchlist|want|priority|tbr/.test(raw)) return 'planned';
    if (/hold|on-hold|pause|paused|drop|dropped|abandon/.test(raw)) return 'paused';
    return 'planned';
  }
  if (!raw) return 'planned';
  if (/plan|watchlist|want|backlog|priority|tbr/.test(raw)) return 'planned';
  if (/watching|reading|playing|current|in progress|progress/.test(raw)) return 'watching';
  if (/complete|completed|watched|read|finished|played|own/.test(raw)) return 'watched';
  if (/hold|pause|paused|shelved/.test(raw)) return 'paused';
  if (/drop|dropped|abandon/.test(raw)) return 'dropped';
  if (source === 'letterboxd' || source === 'imdb') return 'watched';
  return 'planned';
}

function getImportSourceLabel(source = '') {
  return ({ letterboxd: 'Letterboxd', imdb: 'IMDb', myanimelist: 'MyAnimeList', backloggd: 'Backloggd', steam: 'Steam', applemusic: 'Apple Music' })[source] || 'Import';
}

const STEAM_IGDB_COVER_CACHE = new Map();
let _steamIgdbBackfillRunning = false;

function isIgdbCoverUrl(value = '') {
  return /images\.igdb\.com\/igdb\/image\/upload/i.test(String(value || ''));
}

function isSteamImportedGameItem(item = {}) {
  return !!(item && (String(item.source || '').trim().toLowerCase() === 'steam' || String(item.steamAppId || '').trim()));
}

function isUserLockedCover(item = {}) {
  return !!(item && (item.coverLocked || String(item.userSelectedGameCover || '').trim() || String(item.customCover || '').trim() || String(item.selectedCover || '').trim()));
}

function shouldRefreshGameIgdbCover(item = {}) {
  if (!item || !item.title) return false;
  if (isUserLockedCover(item)) return false;
  if (isSteamImportedGameItem(item)) return !isIgdbCoverUrl(item.igdbCoverUrl) || !isIgdbCoverUrl(item.cover);
  return !isIgdbCoverUrl(item.igdbCoverUrl || item.cover || '');
}

function getSteamIgdbCoverCacheKey(title = '', steamAppId = '') {
  return `${String(steamAppId || '').trim()}|${String(title || '').trim().toLowerCase()}`;
}

async function fetchSteamIgdbCover(entry = {}) {
  const title = String(entry.title || entry.name || '').trim();
  if (!title) return null;
  const steamAppId = String(entry.steamAppId || entry.appId || '').trim();
  const cacheKey = getSteamIgdbCoverCacheKey(title, steamAppId);
  if (STEAM_IGDB_COVER_CACHE.has(cacheKey)) return STEAM_IGDB_COVER_CACHE.get(cacheKey);
  try {
    const params = new URLSearchParams({ title });
    if (steamAppId) params.set('steamAppId', steamAppId);
    const res = await fetch(`/api/igdb/cover?${params.toString()}`, { cache: 'no-store' });
    const json = res.ok ? await res.json() : null;
    const payload = json?.ok && json.coverUrl ? json : null;
    STEAM_IGDB_COVER_CACHE.set(cacheKey, payload);
    return payload;
  } catch (error) {
    console.warn('Steam IGDB cover lookup failed:', title, error);
    STEAM_IGDB_COVER_CACHE.set(cacheKey, null);
    return null;
  }
}

async function applySteamIgdbCoverToItem(item = {}, entry = {}) {
  if (!item || !item.title) return false;
  if (isUserLockedCover(item)) return false;
  const cover = await fetchSteamIgdbCover({
    ...entry,
    title: entry.title || item.title,
    steamAppId: entry.steamAppId || item.steamAppId || ''
  });
  if (!cover?.coverUrl) return false;
  const nextCover = String(cover.coverUrl || '').trim();
  const changed = item.igdbCoverUrl !== nextCover || item.cover !== nextCover;
  item.igdbCoverUrl = nextCover;
  item.cover = nextCover;
  item.coverProvider = 'igdb';
  item.coverSource = 'igdb';
  item.igdbMatchedName = cover.matchedName || item.igdbMatchedName || '';
  item.igdbSlug = cover.slug || item.igdbSlug || '';
  item.igdbCoverUpdatedAt = new Date().toISOString();
  return changed;
}

async function backfillSteamImportedGameCoversFromRows(rows = []) {
  if (_steamIgdbBackfillRunning) return 0;
  if (!currentUser || isPreviewMode()) return 0;
  _steamIgdbBackfillRunning = true;
  try {
    const targetData = ownDataCache
      ? cloneListData(ownDataCache)
      : (typeof loadOwnDataFromFirestore === 'function' ? await loadOwnDataFromFirestore() : cloneListData(data));
    if (!targetData || !Array.isArray(targetData.games) || !targetData.games.length) return 0;

    const rowByAppId = new Map((Array.isArray(rows) ? rows : [])
      .filter(row => row?.steamAppId)
      .map(row => [String(row.steamAppId).trim(), row]));
    const candidates = targetData.games.filter(item => {
      if (!item || !item.title || !shouldRefreshGameIgdbCover(item)) return false;
      return isSteamImportedGameItem(item);
    });

    let updated = 0;
    for (const item of candidates) {
      const appId = String(item.steamAppId || '').trim();
      const row = rowByAppId.get(appId) || { title: item.title, steamAppId: appId };
      const changed = await applySteamIgdbCoverToItem(item, row);
      if (changed) updated++;
      await new Promise(resolve => setTimeout(resolve, 260));
    }

    if (updated) {
      await writeOwnDataDirect(targetData);
      data = cloneListData(targetData);
      ownDataCache = cloneListData(targetData);
      if (activeSection === 'games') render();
    }
    return updated;
  } catch (error) {
    console.warn('Steam IGDB cover backfill failed:', error);
    return 0;
  } finally {
    _steamIgdbBackfillRunning = false;
  }
}

/* v10.696: Lazy JSZip loader. Previously JSZip (~95 KB minified) was loaded
   from jsdelivr CDN on every cold start via a parser-blocking <script> tag
   in index.html, even though it's only used for .zip uploads in the
   Letterboxd / Steam / MyAnimeList import flows. Move it off the cold-start
   path: load on demand the first time the user picks a .zip file. */
let _shelfdJSZipLoadPromise = null;
function ensureShelfdJSZipLoaded() {
  if (typeof window !== 'undefined' && window.JSZip) return Promise.resolve(window.JSZip);
  if (_shelfdJSZipLoadPromise) return _shelfdJSZipLoadPromise;
  _shelfdJSZipLoadPromise = new Promise((resolve, reject) => {
    try {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.async = true;
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { _shelfdJSZipLoadPromise = null; reject(new Error('JSZip failed to load from CDN.')); };
      document.head.appendChild(s);
    } catch (e) {
      _shelfdJSZipLoadPromise = null;
      reject(e);
    }
  });
  return _shelfdJSZipLoadPromise;
}

async function readImportTextFiles(source, file) {
  if (!file) return [];
  const name = file.name || '';
  const lower = name.toLowerCase();
  /* v11.570: MyAnimeList exports a GZIPPED xml (animelist_*.xml.gz). Gunzip it
     natively via DecompressionStream (iOS 16.4+) so users can upload the raw
     export without manually decompressing. Routed BEFORE the .zip branch — .gz is
     gzip, not PKZIP, so JSZip cannot read it. */
  if (lower.endsWith('.gz')) {
    if (typeof DecompressionStream !== 'function' || typeof file.stream !== 'function') {
      throw new Error("This .gz file is compressed and can't be opened on this device. Unzip it to a .xml first (or use a desktop browser), then upload that.");
    }
    const text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return [{ name: name.replace(/\.gz$/i, ''), text }];
  }
  if (lower.endsWith('.zip')) {
    /* v10.696: lazy-load JSZip on first .zip pick instead of CDN script at cold start. */
    try { await ensureShelfdJSZipLoaded(); } catch (e) {
      throw new Error('ZIP support could not load. Check your connection or upload the CSV/XML file directly.');
    }
    if (!window.JSZip) throw new Error('ZIP support did not load. Upload the CSV/XML file directly.');
    const zip = await window.JSZip.loadAsync(file);
    const output = [];
    const names = Object.keys(zip.files || {});
    for (const fileName of names) {
      const entry = zip.files[fileName];
      if (!entry || entry.dir) continue;
      const entryLower = fileName.toLowerCase();
      const isCsv = entryLower.endsWith('.csv');
      const isXml = entryLower.endsWith('.xml');
      if (source === 'myanimelist' && !isXml) continue;
      if (source !== 'myanimelist' && !isCsv) continue;
      /* v11.569: only pull the four+diary Letterboxd CSVs we actually merge
         (watched / ratings / reviews / watchlist / diary). Match by exact
         basename so likes/films.csv, lists/*.csv, profile.csv, comments.csv
         are ignored. */
      const wantedLetterboxd = source !== 'letterboxd' || !!getLetterboxdCsvType(fileName);
      if (!wantedLetterboxd) continue;
      output.push({ name: fileName, text: await entry.async('string') });
    }
    if (!output.length) throw new Error('No supported CSV/XML file found inside that ZIP.');
    return output;
  }
  return [{ name, text: await file.text() }];
}

/* v11.569: classify a Letterboxd export CSV by its EXACT basename so we only
   merge the files we want and ignore likes/films.csv, lists/*.csv, profile.csv,
   comments.csv, etc. Returns '' for anything we don't ingest. */
function getLetterboxdCsvType(fileName = '') {
  const base = String(fileName || '').split(/[\\/]/).pop().trim().toLowerCase();
  if (base === 'watchlist.csv') return 'watchlist';
  if (base === 'watched.csv') return 'watched';
  if (base === 'ratings.csv') return 'ratings';
  if (base === 'diary.csv') return 'diary';
  if (base === 'reviews.csv') return 'reviews';
  return '';
}

/* v11.569: stable identity for a film across the export. We key on title+year,
   NOT the Letterboxd URI: in diary.csv / reviews.csv the "Letterboxd URI" is the
   diary-entry / review URI (unique per viewing), so keying on it would fail to
   match the same film's watched.csv/ratings.csv rows and create duplicates.
   Name+Year is identical for the same film across every export CSV. */
function letterboxdMergeKey(title = '', year = '') {
  return String(title || '').trim().toLowerCase() + '|' + String(year || '').trim();
}

/* v11.569: Letterboxd 'Watched Date' is YYYY-MM-DD. Convert to an ISO string at
   local noon so a date never slips to the previous day across time zones. */
function parseLetterboxdWatchedDate(value = '') {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!m) return '';
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/* v11.569: WHOLE-EXPORT Letterboxd import. Folds watched/ratings/diary/reviews/
   watchlist CSVs into ONE row per film (keyed by Letterboxd URI, else title+year)
   carrying {status, rating, reviewText, dateWatched}. Tolerates any subset of the
   files. Precedence: watchlist < watched < ratings < diary < reviews, so 'watched'
   always beats 'planned' and the richest source (reviews) wins for rating/date/text. */
function normalizeLetterboxdImportRows(files = []) {
  const TYPE_RANK = { watchlist: 0, watched: 1, ratings: 2, diary: 3, reviews: 4 };
  const wanted = (Array.isArray(files) ? files : [])
    .map(file => ({ file, lbType: getLetterboxdCsvType(file && file.name) }))
    .filter(entry => entry.lbType)
    .sort((a, b) => TYPE_RANK[a.lbType] - TYPE_RANK[b.lbType]);

  const merged = new Map();
  const order = [];

  wanted.forEach(({ file, lbType }) => {
    const fileName = file.name || '';
    parseScreenListCsv(file.text).forEach(row => {
      const title = getImportRowValue(row, ['Name', 'Title', 'Film']);
      if (!title) return;
      const year = getImportRowValue(row, ['Year', 'Release Year']);
      const uri = getImportRowValue(row, ['Letterboxd URI', 'URI', 'URL']);
      const key = letterboxdMergeKey(title, year);

      let rec = merged.get(key);
      if (!rec) {
        rec = {
          source: 'letterboxd',
          sourceFile: fileName,
          title,
          year,
          letterboxdUri: uri || '',
          status: 'planned',
          rating: 0,
          reviewText: '',
          dateWatched: '',
          typeHint: 'movie',
          raw: row
        };
        merged.set(key, rec);
        order.push(key);
      }
      if (!rec.title && title) rec.title = title;
      if (!rec.year && year) rec.year = year;
      if (!rec.letterboxdUri && uri) rec.letterboxdUri = uri;

      /* watched beats watchlist */
      if (lbType !== 'watchlist') rec.status = 'watched';

      /* rating: ratings.csv is the user's CURRENT canonical rating and wins.
         diary/reviews ratings are per-viewing (can be stale on a rewatch), so they
         only fill the rating when ratings.csv had none for this film. */
      if (lbType === 'ratings' || lbType === 'diary' || lbType === 'reviews') {
        const r = normalizeImportRating(getImportRowValue(row, ['Rating', 'Stars']), 'letterboxd');
        if (r > 0 && (lbType === 'ratings' || !rec.ratingLocked)) {
          rec.rating = r;
          if (lbType === 'ratings') rec.ratingLocked = true;
        }
      }
      /* real watch date from diary/reviews — keep the LATEST viewing when a film
         has multiple diary/review rows (rewatches). ISO strings sort chronologically. */
      if (lbType === 'diary' || lbType === 'reviews') {
        const wd = parseLetterboxdWatchedDate(getImportRowValue(row, ['Watched Date', 'WatchedDate']));
        if (wd && wd > (rec.dateWatched || '')) rec.dateWatched = wd;
      }
      /* review text (reviews.csv only) — store on the title only, no feed post */
      if (lbType === 'reviews') {
        const review = String(getImportRowValue(row, ['Review']) || '').trim();
        if (review) rec.reviewText = review.slice(0, 4000);
      }
    });
  });

  return order.map(key => {
    const rec = merged.get(key);
    if (rec) delete rec.ratingLocked;
    return rec;
  }).filter(Boolean);
}

function normalizeImdbTypeHint(titleType = '') {
  const raw = normalizeImportText(titleType).toLowerCase();
  if (/tv|series|episode|miniseries|mini-series/.test(raw)) return 'tv';
  return 'movie';
}

function normalizeImdbImportRows(files = []) {
  const rows = [];
  files.forEach(file => {
    const fileName = file.name || '';
    const lower = fileName.toLowerCase();
    const fileStatus = lower.includes('watchlist') ? 'planned' : 'watched';
    parseScreenListCsv(file.text).forEach(row => {
      const title = getImportRowValue(row, ['Title', 'Name']);
      if (!title) return;
      const titleType = getImportRowValue(row, ['Title Type', 'TitleType', 'Type']);
      const ratingRaw = getImportRowValue(row, ['Your Rating', 'YourRating', 'Rating']);
      rows.push({
        source: 'imdb',
        sourceFile: fileName,
        title,
        year: getImportRowValue(row, ['Year', 'Release Year']),
        status: ratingRaw ? 'watched' : fileStatus,
        rating: normalizeImportRating(ratingRaw, 'imdb'),
        typeHint: normalizeImdbTypeHint(titleType),
        imdbId: getImportRowValue(row, ['Const', 'IMDb ID', 'imdbID']),
        raw: row
      });
    });
  });
  return rows;
}

function readXmlText(node, tagName) {
  return normalizeImportText(node.getElementsByTagName(tagName)?.[0]?.textContent || '');
}

function normalizeMalImportRows(files = []) {
  const rows = [];
  files.forEach(file => {
    const doc = new DOMParser().parseFromString(file.text, 'text/xml');
    const animeNodes = [...doc.getElementsByTagName('anime')];
    animeNodes.forEach(node => {
      const title = readXmlText(node, 'series_title');
      if (!title) return;
      const statusRaw = readXmlText(node, 'my_status');
      rows.push({
        source: 'myanimelist',
        sourceFile: file.name || '',
        title,
        year: '',
        status: normalizeImportStatus(statusRaw, 'myanimelist'),
        rating: normalizeImportRating(readXmlText(node, 'my_score'), 'myanimelist'),
        typeHint: 'anime',
        malId: readXmlText(node, 'series_animedb_id'),
        malType: readXmlText(node, 'series_type'),
        totalEpisodes: Number(readXmlText(node, 'series_episodes') || 0),
        watchedEpisodes: Number(readXmlText(node, 'my_watched_episodes') || 0),
        rawStatus: statusRaw,
        raw: {}
      });
    });
  });
  return rows;
}

function normalizeBackloggdImportRows(files = []) {
  const rows = [];
  files.forEach(file => {
    const fileName = file.name || '';
    parseScreenListCsv(file.text).forEach(row => {
      const title = getImportRowValue(row, ['Title', 'Name', 'Game', 'Game Title']);
      if (!title) return;
      const statusRaw = getImportRowValue(row, ['Status', 'State', 'Shelf', 'List']);
      rows.push({
        source: 'backloggd',
        sourceFile: fileName,
        title,
        year: getImportRowValue(row, ['Year', 'Release Year', 'Released']),
        status: normalizeImportStatus(statusRaw, 'backloggd'),
        rating: normalizeImportRating(getImportRowValue(row, ['Rating', 'Score', 'User Rating']), 'backloggd'),
        typeHint: 'game',
        raw: row
      });
    });
  });
  return rows;
}

function normalizeImportRows(source, files = []) {
  if (source === 'letterboxd') return normalizeLetterboxdImportRows(files);
  if (source === 'imdb') return normalizeImdbImportRows(files);
  if (source === 'myanimelist') return normalizeMalImportRows(files);
  if (source === 'backloggd') return normalizeBackloggdImportRows(files);
  if (source === 'steam') return Array.isArray(files) ? files : [];
  if (source === 'applemusic') return Array.isArray(files) ? files : [];
  return [];
}

function getImportStatusDisplayLabel(status = '', source = pendingImportSource) {
  const section = source === 'myanimelist' ? 'anime' : source === 'backloggd' || source === 'steam' ? 'games' : source === 'applemusic' ? 'music' : 'movies';
  if (status === 'watching') return section === 'games' ? 'Playing' : section === 'anime' ? 'Watching' : 'Watching';
  if (status === 'planned') return 'Planning';
  if (status === 'watched') return section === 'games' ? 'Played' : section === 'music' ? 'Listened' : 'Watched';
  if (status === 'paused') return 'Paused';
  if (status === 'wishlist') return 'Wishlist';
  return status || 'Planning';
}

function getImportStatusOptions(source = pendingImportSource) {
  if (source === 'myanimelist') {
    return [
      { value: 'watching', label: 'Watching' },
      { value: 'planned', label: 'Planning' },
      { value: 'watched', label: 'Watched' },
      { value: 'paused', label: 'Paused' }
    ];
  }
  return [];
}

function updatePendingImportRowStatus(index = 0, status = '') {
  const rowIndex = Number(index);
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= pendingImportRows.length) return;
  const allowed = getImportStatusOptions(pendingImportSource).map(option => option.value);
  if (!allowed.includes(status)) return;
  pendingImportRows[rowIndex].status = status;
  renderImportPreview();
}

function renderImportStatusControl(row = {}, index = 0) {
  const options = getImportStatusOptions(pendingImportSource);
  if (!options.length) return '';
  const selected = row.status || 'planned';
  return `
    <label class="import-row-status-control">
      <span>Send to</span>
      <select onchange="updatePendingImportRowStatus(${index}, this.value)">
        ${options.map(option => `<option value="${escAttr(option.value)}"${option.value === selected ? ' selected' : ''}>${escHtml(option.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

function setImportPreviewHtml(html = '') {
  ['import-preview', 'import-detail-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

function renderImportPreview() {
  if (!pendingImportRows.length) {
    setImportPreviewHtml('');
    return;
  }
  const rows = pendingImportRows.slice(0, 80).map((row, index) => {
    const metaParts = [row.year, row.typeHint, getImportStatusDisplayLabel(row.status, row.source || pendingImportSource)];
    if (row.reviewText) metaParts.push('Review');
    const meta = metaParts.filter(Boolean).join(' · ');
    const ratingSection = row.typeHint === 'game' ? 'games' : row.typeHint === 'anime' ? 'anime' : row.typeHint === 'music' ? 'music' : 'movies';
    return `
      <div class="import-preview-row${pendingImportSource === 'myanimelist' ? ' import-preview-row-myanimelist' : ''}">
        <div class="import-preview-main">
          <strong>${index + 1}. ${escHtml(row.title)}</strong>
          <span>${escHtml(meta)}</span>
          ${row.artist ? `<small class="import-source-raw-status">${escHtml(row.artist)}${row.trackCount ? ` Â· ${Number(row.trackCount).toLocaleString('en-US')} tracks` : ''}</small>` : ''}
          ${row.rawStatus ? `<small class="import-source-raw-status">MAL status: ${escHtml(row.rawStatus)}</small>` : ''}
        </div>
        ${renderImportStatusControl(row, index)}
        <div class="import-preview-score">${row.rating ? escHtml(formatRatingValueForSection(row.rating, ratingSection, true)) : 'No rating'}</div>
      </div>
    `;
  }).join('');
  const hiddenCount = Math.max(0, pendingImportRows.length - 80);
  const sourceLabel = getImportSourceLabel(pendingImportSource);
  let malSub;
  if (pendingImportSource === 'myanimelist') {
    malSub = 'MAL status and rating are mapped automatically when possible. You can change each title before importing.';
  } else if (pendingImportSource === 'letterboxd') {
    /* v11.569: whole-export breakdown so the user can confirm the right file. */
    const watchedCount = pendingImportRows.filter(r => r.status === 'watched').length;
    const plannedCount = pendingImportRows.length - watchedCount;
    const ratedCount = pendingImportRows.filter(r => Number(r.rating) > 0).length;
    const reviewCount = pendingImportRows.filter(r => r.reviewText).length;
    const bits = [
      `${watchedCount.toLocaleString('en-US')} watched`,
      `${ratedCount.toLocaleString('en-US')} rated`,
      `${reviewCount.toLocaleString('en-US')} reviews`,
      `${plannedCount.toLocaleString('en-US')} planning`
    ];
    malSub = `${bits.join(' · ')}${hiddenCount ? ` · previewing first 80` : ''}`;
  } else {
    malSub = `${sourceLabel} · Previewing first ${Math.min(80, pendingImportRows.length)}${hiddenCount ? ` · ${hiddenCount} more hidden` : ''}`;
  }
  setImportPreviewHtml(`
    <div class="import-preview-card">
      <div class="import-preview-head">
        <div>
          <div class="import-preview-title">Ready to import ${pendingImportRows.length} ${pendingImportSource === 'applemusic' ? `album${pendingImportRows.length === 1 ? '' : 's'}` : `title${pendingImportRows.length === 1 ? '' : 's'}`}</div>
          <div class="import-preview-sub">${escHtml(malSub)}${pendingImportSource === 'myanimelist' && hiddenCount ? escHtml(` Previewing first 80 · ${hiddenCount} more hidden`) : ''}</div>
        </div>
        <button class="btn-primary" onclick="confirmImportLibrary()">Import to Shelfd</button>
      </div>
      <div class="import-preview-list">${rows}</div>
    </div>
  `);
}

const STEAM_IMPORT_STATUS_OPTIONS = [
  { value: 'watching', label: 'Playing' },
  { value: 'live',     label: 'Live Games' },
  { value: 'planned',  label: 'Planning' },
  { value: 'watched',  label: 'Played' },
  { value: 'wishlist', label: 'Wishlist' }
];

function buildSteamImportStatusOptions(selected = '') {
  const clean = String(selected || '').trim().toLowerCase();
  return STEAM_IMPORT_STATUS_OPTIONS.map(opt =>
    `<option value="${escAttr(opt.value)}"${opt.value === clean ? ' selected' : ''}>${escHtml(opt.label)}</option>`
  ).join('');
}

function setSteamImportRowStatus(key = '', status = '') {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return;
  const validStatuses = STEAM_IMPORT_STATUS_OPTIONS.map(o => o.value);
  const cleanStatus = validStatuses.includes(String(status || '').trim().toLowerCase()) ? String(status).trim().toLowerCase() : 'planned';
  const idx = pendingImportRows.findIndex((row, index) => getSteamImportRowKey(row, index) === cleanKey);
  if (idx < 0) return;
  pendingImportRows[idx] = { ...pendingImportRows[idx], status: cleanStatus };
}

function renderSteamSyncPreview() {
  const el = document.getElementById('steam-sync-preview');
  if (!el) return;
  if (!pendingImportRows.length) {
    el.innerHTML = '';
    renderSteamSyncSummary(0);
    return;
  }
  renderSteamSyncSummary(pendingImportRows.length);
  const rows = pendingImportRows.slice(0, 80).map((row, index) => {
    const key = getSteamImportRowKey(row, index);
    const playtimeLabel = Number(row.playtimeHours || 0) > 0
      ? `${row.playtimeHours}h played`
      : 'No playtime yet';
    return `
    <label class="import-preview-row steam-sync-preview-row" data-steam-import-key="${escAttr(key)}">
      <input class="steam-sync-row-toggle" type="checkbox" checked onchange="toggleSteamImportRow('${escAttr(key)}', this.checked)">
      <div class="import-preview-main">
        <strong>${index + 1}. ${escHtml(row.title)}</strong>
      </div>
      <div class="steam-sync-row-destination" onclick="event.stopPropagation()">
        <select class="steam-sync-status-select" data-steam-import-key="${escAttr(key)}" onclick="event.stopPropagation()" onchange="setSteamImportRowStatus('${escAttr(key)}', this.value)">
          ${buildSteamImportStatusOptions(row.status)}
        </select>
        <span class="steam-sync-row-hours">${escHtml(playtimeLabel)}</span>
      </div>
    </label>
  `;
  }).join('');
  const hiddenCount = Math.max(0, pendingImportRows.length - 80);
  el.innerHTML = `
    <div class="import-preview-card steam-sync-preview-card">
      <div class="import-preview-head">
        <div>
          <div class="import-preview-title">Review Steam Library</div>
          <div class="import-preview-sub"><span id="steam-sync-selection-count">${pendingImportRows.length.toLocaleString('en-US')} of ${pendingImportRows.length.toLocaleString('en-US')} selected</span> · Previewing first ${Math.min(80, pendingImportRows.length)}${hiddenCount ? ` · ${hiddenCount} more hidden` : ''}</div>
        </div>
        <button id="steam-sync-import-btn" class="btn-primary steam-sync-import-btn" onclick="confirmImportLibrary()">Import ${pendingImportRows.length.toLocaleString('en-US')} to Shelfd</button>
      </div>
      <div class="import-preview-list">${rows}</div>
    </div>
  `;
  updateSteamSyncSelectionUi();
}

async function handleImportFile(source, fileOrFiles) {
  /* v11.569: accept a single File (legacy single-pick) OR a FileList/array of
     Files (Letterboxd multi-select fallback for users who pre-unzipped). Each
     file is read via readImportTextFiles and the extracted CSVs are concatenated
     before normalize — so loose watched.csv + ratings.csv + reviews.csv +
     watchlist.csv merge exactly like the all-in-one .zip path. */
  const fileList = fileOrFiles && typeof fileOrFiles.length === 'number' && !(fileOrFiles instanceof File)
    ? Array.from(fileOrFiles)
    : (fileOrFiles ? [fileOrFiles] : []);
  if (!fileList.length || importBusy) return;
  const cleanSource = String(source || '').trim().toLowerCase();
  if (cleanSource && cleanSource !== 'steam') openImportSourcePage(cleanSource, { preservePreview: true });
  pendingImportSource = cleanSource || source;
  pendingImportRows = [];
  clearImportPreview();
  setImportStatus(`Reading ${fileList.length > 1 ? `${fileList.length} files` : fileList[0].name}...`, 'busy');
  try {
    let files = [];
    for (const f of fileList) {
      const parts = await readImportTextFiles(source, f);
      if (Array.isArray(parts)) files = files.concat(parts);
    }
    pendingImportRows = normalizeImportRows(source, files);
    if (!pendingImportRows.length) {
      setImportStatus('No titles found in that file. Try the original export CSV/XML.', 'error');
      return;
    }
    setImportStatus(`Found ${pendingImportRows.length} title${pendingImportRows.length === 1 ? '' : 's'}. Review, then import.`, 'ready');
    renderImportPreview();
  } catch (error) {
    console.error('Import parse failed:', error);
    setImportStatus(error?.message || 'Could not read this import file.', 'error');
  }
}

function cleanupSteamImportUrlParams() {
  const url = new URL(window.location.href);
  let changed = false;
  [STEAM_IMPORT_QUERY_FLAG, STEAM_AUTH_RESULT_PARAM, STEAM_AUTH_STEAM_ID_PARAM, STEAM_AUTH_MESSAGE_PARAM].forEach(key => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  if (changed) window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
}

function storePendingSteamAuth(payload = {}) {
  try {
    sessionStorage.setItem(STEAM_PENDING_AUTH_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {}
}

function readPendingSteamAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(STEAM_PENDING_AUTH_STORAGE_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function clearPendingSteamAuth() {
  try { sessionStorage.removeItem(STEAM_PENDING_AUTH_STORAGE_KEY); } catch (error) {}
}

async function fetchSteamProxyJson(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const res = await fetch(url.toString(), { credentials: 'same-origin' });
  let json = {};
  try { json = await res.json(); } catch (error) {}
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `Steam request failed with status ${res.status}.`);
  }
  return json;
}

async function saveSteamConnectionPatch(connection = {}) {
  // v429 hardening: build the steamConnection object from an explicit allow-list
  // so Shelfd profile fields (name/photo/displayName/etc.) can never bleed into
  // the user document via this path. Steam identity stays nested under steamConnection.
  const previous = getSteamImportConnection();
  const safeConnection = connection && typeof connection === 'object' ? connection : {};
  const next = {
    steamId: String(safeConnection.steamId || previous.steamId || '').trim(),
    personaName: String(safeConnection.personaName || previous.personaName || '').trim(),
    profileUrl: String(safeConnection.profileUrl || previous.profileUrl || '').trim(),
    avatar: String(safeConnection.avatar || previous.avatar || '').trim(),
    connectedAt: String(safeConnection.connectedAt || previous.connectedAt || new Date().toISOString()).trim(),
    lastSyncedAt: String(safeConnection.lastSyncedAt || previous.lastSyncedAt || '').trim(),
    lastSyncTotal: Number(safeConnection.lastSyncTotal || previous.lastSyncTotal || 0) || 0
  };
  if (typeof saveProfileSettingsPatch === 'function') {
    await saveProfileSettingsPatch({ steamConnection: next });
  } else {
    if (!userProfile) userProfile = {};
    userProfile.steamConnection = next;
  }
  renderSteamImportCardState();
  return next;
}

function startSteamConnect() {
  const target = new URL('/api/steam/connect', window.location.origin).toString();
  setImportStatus('Opening Steam sign-in...', 'busy');
  window.location.href = target;
}

async function handleSteamImportAction(event) {
  if (event?.preventDefault) event.preventDefault();
  if (event?.stopPropagation) event.stopPropagation();
  const connection = getSteamImportConnection();
  if (!connection.steamId) {
    startSteamConnect();
    return;
  }
  openSteamSyncPage();
  clearSteamSyncPreview();
  renderSteamSyncSummary(0);
  setSteamSyncStatus('Syncing your Steam library...', 'busy');
  await syncSteamLibraryPreview();
}

// v430: Steam import default status now uses lastPlayedAt + a 30-day "recent" window.
//   - 0h playtime              → planned (Backlog / Want to Play)
//   - has playtime, recent     → watching (Playing — launched within last 30 days)
//   - has playtime, older      → watched (Played)
//   - has playtime, no last-played timestamp → watched (per fallback rule)
// Steam's GetOwnedGames provides rtime_last_played which the worker normalizes to
// lastPlayedAt (ISO string). Worker also exposes playtimeMinutes only — we don't get
// playtime_2weeks today, so the 30-day window relies on lastPlayedAt as the proxy.
const SHELFD_STEAM_RECENT_PLAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
function normalizeSteamImportStatusFromPlaytime(playtimeMinutes = 0, lastPlayedAt = '') {
  const playtime = Number(playtimeMinutes || 0);
  if (!(playtime > 0)) return 'planned';
  const ts = String(lastPlayedAt || '').trim();
  if (ts) {
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms) && ms > 0) {
      return (Date.now() - ms) <= SHELFD_STEAM_RECENT_PLAY_WINDOW_MS ? 'watching' : 'watched';
    }
  }
  // Has playtime but Steam didn't provide a last-played timestamp — fall back to Played.
  return 'watched';
}

function buildSteamImportRows(games = [], steamId = '') {
  return (Array.isArray(games) ? games : []).map(game => {
    const playtimeMinutes = Math.max(0, Number(game.playtimeMinutes || game.playtime_forever || 0));
    const playtimeHours = Math.round((playtimeMinutes / 60) * 10) / 10;
    const lastPlayedAt = String(game.lastPlayedAt || '').trim();
    return {
      source: 'steam',
      title: String(game.name || '').trim(),
      year: '',
      status: normalizeSteamImportStatusFromPlaytime(playtimeMinutes, lastPlayedAt),
      rating: 0,
      typeHint: 'game',
      steamId: String(steamId || '').trim(),
      steamAppId: String(game.appId || game.appid || '').trim(),
      steamUrl: String(game.storeUrl || '').trim(),
      playtimeMinutes,
      playtimeHours,
      lastPlayedAt,
      cover: '',
      igdbCoverUrl: '',
      raw: game
    };
  }).filter(row => row.title);
}

async function syncSteamLibraryPreview(options = {}) {
  const connection = getSteamImportConnection();
  if (!connection.steamId) {
    openSteamImportPage();
    setImportStatus('Connect Steam before syncing your library.', 'error');
    return;
  }
  if (importBusy) {
    openSteamSyncPage();
    setSteamSyncStatus('Steam sync is already running...', 'busy');
    return;
  }
  pendingImportSource = 'steam';
  pendingImportRows = [];
  clearImportPreview();
  clearSteamSyncPreview();
  openSteamSyncPage();
  importBusy = true;
  renderSteamImportCardState();
  setImportStatus('Syncing your Steam library...', 'busy');
  setSteamSyncStatus('Syncing your Steam library...', 'busy');
  renderSteamSyncSummary(0);
  try {
    const payload = await fetchSteamProxyJson('/api/steam/library', { steamId: connection.steamId });
    const rows = buildSteamImportRows(payload.games || [], connection.steamId);
    if (!rows.length) {
      setImportStatus('No Steam games were returned. Check that the account library is visible on Steam.', 'error');
      setSteamSyncStatus('No Steam games were returned. Check that the account library is visible on Steam.', 'error');
      return;
    }
    pendingImportRows = rows;
    steamImportExcludedKeys = new Set();
    await saveSteamConnectionPatch({
      steamId: connection.steamId,
      personaName: payload.player?.personaName || connection.personaName,
      profileUrl: payload.player?.profileUrl || connection.profileUrl,
      avatar: payload.player?.avatar || connection.avatar,
      lastSyncedAt: new Date().toISOString(),
      lastSyncTotal: rows.length
    });
    setImportStatus(`Found ${rows.length} Steam game${rows.length === 1 ? '' : 's'}. Review, then import.`, 'ready');
    setSteamSyncStatus(`Found ${rows.length} Steam game${rows.length === 1 ? '' : 's'}. Review, then import to Shelfd.`, 'ready');
    renderSteamSyncPreview();
    backfillSteamImportedGameCoversFromRows(rows).then(updated => {
      if (updated) setSteamSyncStatus(`Found ${rows.length} Steam game${rows.length === 1 ? '' : 's'}. Updated ${updated} game poster${updated === 1 ? '' : 's'} from IGDB.`, 'ready');
    });
  } catch (error) {
    console.error('Steam sync failed:', error);
    setImportStatus(error?.message || 'Steam sync failed.', 'error');
    setSteamSyncStatus(error?.message || 'Steam sync failed.', 'error');
  } finally {
    importBusy = false;
    renderSteamImportCardState();
    updateSteamSyncSelectionUi();
  }
}

/* =============================================================================
   One-tap Steam library refresh (v11.386)
   -----------------------------------------------------------------------------
   The games-shelf toolbar refresh button. Pulls the linked Steam account and:
     • UPDATES existing library games in place — hours played, last played, and
       achievement progress ONLY. Never touches user-entered data (rating,
       review, rank, status, cover, notes) and never rebuilds an existing title.
     • ADDS any brand-new Steam games not already in the library.
   Existing games are matched by Steam App ID first, then by title. Achievements
   are refreshed in a throttled background pass so the core sync returns fast.
   ========================================================================== */
let steamQuickSyncBusy = false;

const STEAM_SYNC_BTN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4"/><polyline points="21 3 21 8 16 8"/><polyline points="3 21 3 16 8 16"/></svg>';

function getOwnGamesArrayForSteamSync() {
  if (typeof data !== 'object' || !data) return null;
  if (!Array.isArray(data.games)) data.games = [];
  return data.games;
}

function findExistingSteamGameInLibrary(games, appId, title) {
  const cleanAppId = String(appId || '').trim();
  if (cleanAppId) {
    const byApp = games.find(g => g && String(g.steamAppId || g.appId || '').trim() === cleanAppId);
    if (byApp) return byApp;
  }
  if (typeof getDuplicateTitleKeys === 'function') {
    const keys = getDuplicateTitleKeys({ title });
    if (keys && keys.size) {
      const byTitle = games.find(g => {
        if (!g) return false;
        const gk = getDuplicateTitleKeys(g);
        return [...keys].some(k => gk.has(k));
      });
      if (byTitle) return byTitle;
    }
  }
  const norm = String(title || '').trim().toLowerCase();
  return games.find(g => g && String(g.title || '').trim().toLowerCase() === norm) || null;
}

/* Update ONLY Steam-sourced fields on an existing item. Returns true if any
   value actually changed. Deliberately leaves rating / review / rank / status /
   cover / notes untouched so user-entered data is never overwritten. */
function applySteamRefreshToExistingGame(existing, entry) {
  if (!existing || !entry) return false;
  let changed = false;
  const set = (k, v) => { if (v !== '' && v != null && existing[k] !== v) { existing[k] = v; changed = true; } };
  const playtimeHours = Math.round((Number(entry.playtimeHours || 0) || 0) * 10) / 10;
  if (playtimeHours > 0) {
    const h = String(playtimeHours);
    set('gameHoursPlayed', h);
    set('gameHours', h);
    set('hoursPlayed', h);
    set('playtimeHours', h);
  }
  set('lastPlayedAt', String(entry.lastPlayedAt || '').trim());
  set('steamAppId', String(entry.steamAppId || existing.steamAppId || '').trim());
  set('steamId', String(entry.steamId || existing.steamId || '').trim());
  set('steamUrl', String(entry.steamUrl || existing.steamUrl || '').trim());
  if (!String(existing.platforms || '').trim()) set('platforms', 'Steam');
  if (!String(existing.source || '').trim()) set('source', 'steam');
  return changed;
}

async function mergeSteamLibraryIntoOwnGames(steamGames, steamId) {
  const games = getOwnGamesArrayForSteamSync();
  if (!games) return { added: 0, updated: 0 };
  let added = 0, updated = 0;
  const rows = buildSteamImportRows(steamGames, steamId);
  for (const entry of rows) {
    const existing = findExistingSteamGameInLibrary(games, entry.steamAppId, entry.title);
    if (existing) {
      if (applySteamRefreshToExistingGame(existing, entry)) updated++;
    } else {
      try {
        const items = await buildSteamImportItems(entry);
        for (const it of items) {
          if (!it) continue;
          it.importSource = it.importSource || 'steam';
          it.importSourceLabel = it.importSourceLabel || 'Steam';
          it.importedAt = it.importedAt || new Date().toISOString();
          games.push(it);
          added++;
        }
      } catch (e) { console.warn('Steam sync new-game build failed:', entry?.title, e); }
    }
  }
  return { added, updated };
}

/* Throttled background pass: refresh achievement progress for library games
   that have a Steam App ID. Stores a compact summary on each item. */
async function refreshSteamAchievementsForLibrary(steamId) {
  const games = getOwnGamesArrayForSteamSync();
  if (!games || !steamId) return;
  const targets = games.filter(g => g && /^\d+$/.test(String(g.steamAppId || '').trim()));
  if (!targets.length) return;
  let changed = 0;
  let idx = 0;
  const CONCURRENCY = 4;
  async function worker() {
    while (idx < targets.length) {
      const g = targets[idx++];
      const appId = String(g.steamAppId).trim();
      try {
        const res = await fetch(`/api/steam/achievements?appid=${encodeURIComponent(appId)}&steamId=${encodeURIComponent(steamId)}`);
        const d = await res.json();
        if (d && d.ok && d.eligible && d.hasAchievements && d.hasPlayerData) {
          const summary = { unlocked: Number(d.unlocked || 0), total: Number(d.total || 0), percent: Number(d.percent || 0), updatedAt: new Date().toISOString() };
          const prev = g.steamAchievements || {};
          if (prev.unlocked !== summary.unlocked || prev.total !== summary.total) changed++;
          g.steamAchievements = summary;
        }
      } catch (_) {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  if (changed) {
    try {
      if (typeof writeOwnDataDirect === 'function') await writeOwnDataDirect(data);
      else if (typeof save === 'function') save();
    } catch (_) {}
    if (activeSection === 'games' && !viewingUser && typeof render === 'function') render();
  }
}

async function quickSyncSteamLibrary() {
  if (!currentUser || viewingUser) return;
  const connection = getSteamImportConnection();
  if (!connection.steamId) {
    if (typeof openSteamImportPage === 'function') openSteamImportPage();
    if (typeof showToast === 'function') showToast('Connect your Steam account first to sync.');
    return;
  }
  if (steamQuickSyncBusy) return;
  steamQuickSyncBusy = true;
  setSteamSyncToolbarBusy(true);
  try {
    const payload = await fetchSteamProxyJson('/api/steam/library', { steamId: connection.steamId });
    const steamGames = Array.isArray(payload.games) ? payload.games : [];
    if (!steamGames.length) {
      if (typeof showToast === 'function') showToast('No Steam games returned — make sure your Steam library is set to Public.');
      return;
    }
    const { added, updated } = await mergeSteamLibraryIntoOwnGames(steamGames, connection.steamId);
    try {
      await saveSteamConnectionPatch({
        steamId: connection.steamId,
        personaName: payload.player?.personaName || connection.personaName,
        profileUrl: payload.player?.profileUrl || connection.profileUrl,
        avatar: payload.player?.avatar || connection.avatar,
        lastSyncedAt: new Date().toISOString(),
        lastSyncTotal: steamGames.length
      });
    } catch (_) {}
    try {
      if (typeof writeOwnDataDirect === 'function') await writeOwnDataDirect(data);
      else if (typeof save === 'function') save();
    } catch (e) { console.warn('Steam sync persist failed:', e); }
    if (activeSection === 'games' && !viewingUser && typeof render === 'function') render();
    if (typeof showToast === 'function') {
      const bits = [];
      if (added) bits.push(`${added} new game${added === 1 ? '' : 's'}`);
      if (updated) bits.push(`${updated} updated`);
      showToast(bits.length ? `Steam synced — ${bits.join(', ')}. Refreshing achievements…` : 'Steam library is up to date. Refreshing achievements…');
    }
    // Best-effort achievements refresh in the background; doesn't block the sync.
    refreshSteamAchievementsForLibrary(connection.steamId);
  } catch (e) {
    console.error('Steam quick sync failed:', e);
    if (typeof showToast === 'function') showToast('Steam sync failed. Try again in a moment.');
  } finally {
    steamQuickSyncBusy = false;
    setSteamSyncToolbarBusy(false);
  }
}

function setSteamSyncToolbarBusy(busy) {
  const btn = document.getElementById('mylist-steam-sync-btn');
  if (!btn) return;
  btn.classList.toggle('is-busy', !!busy);
  btn.disabled = !!busy;
}

/* Inject / remove the refresh-sync button as the FAR-LEFT control in the
   My List toolbar — games shelf only, on the user's own shelf. Called from the
   main render right after the sort button is placed. */
function updateSteamSyncToolbarButton() {
  const toolbarRight = document.querySelector('#mylist-toolbar .toolbar-right');
  if (!toolbarRight) return;
  let btn = document.getElementById('mylist-steam-sync-btn');
  const onGamesOwnShelf = (typeof activeSection !== 'undefined' && activeSection === 'games') && !viewingUser && !!currentUser;
  if (!onGamesOwnShelf) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'mylist-steam-sync-btn';
    btn.type = 'button';
    btn.className = 'mylist-steam-sync-btn';
    btn.setAttribute('aria-label', 'resync steam');
    btn.title = 'Resync Steam — hours played & achievements';
    btn.onclick = quickSyncSteamLibrary;
    /* v11.467: labeled pill — the existing resync glyph + lowercase "resync steam"
       text. Pinned far-left in the games toolbar via .mylist-steam-sync-btn
       (margin-right:auto) in css/01. */
    btn.innerHTML = STEAM_SYNC_BTN_ICON + '<span class="mylist-steam-sync-label">resync steam</span>';
  }
  if (toolbarRight.firstChild !== btn) toolbarRight.insertBefore(btn, toolbarRight.firstChild);
  btn.classList.toggle('is-busy', steamQuickSyncBusy);
  btn.disabled = steamQuickSyncBusy;
}

async function processPendingSteamAuthResult(retries = 10) {
  const pending = readPendingSteamAuth();
  if (!pending) return;
  if (!pending.ok || !pending.steamId) {
    openSteamImportPage();
    setImportStatus(pending.message || 'Steam connect failed.', 'error');
    clearPendingSteamAuth();
    return;
  }
  if (!currentUser && retries > 1) {
    setTimeout(() => processPendingSteamAuthResult(retries - 1), 500);
    return;
  }
  if (retries <= 0) {
    openSteamImportPage();
    setImportStatus('Steam connected, but the profile session is still loading. Reopen Import Steam in a moment.', 'error');
    return;
  }
  openSteamImportPage();
  setImportStatus('Steam connected. Finalizing account link...', 'busy');
  try {
    const profile = await fetchSteamProxyJson('/api/steam/profile', { steamId: pending.steamId });
    await saveSteamConnectionPatch({
      steamId: pending.steamId,
      personaName: profile.player?.personaName || '',
      profileUrl: profile.player?.profileUrl || '',
      avatar: profile.player?.avatar || '',
      connectedAt: getSteamImportConnection().connectedAt || new Date().toISOString()
    });
    clearPendingSteamAuth();
    setImportStatus(`Connected Steam as ${profile.player?.personaName || pending.steamId}. Pulling your library now...`, 'busy');
    await syncSteamLibraryPreview({ fromAuth: true });
  } catch (error) {
    if (!currentUser && retries > 1) {
      setTimeout(() => processPendingSteamAuthResult(retries - 1), 500);
      return;
    }
    clearPendingSteamAuth();
    setImportStatus(error?.message || 'Steam connect finished, but profile sync failed.', 'error');
  }
}

/* ==========================================================================
   v11.486: Xbox account sync — mirrors the Steam proxy + merge shape. The whole
   flow is config-gated by the worker's /api/xbox/config (reports whether the
   Azure-app secrets are set). With no config the card shows "Setup required"
   and Connect is inert — production is unaffected. Sensitive tokens live ONLY in
   the worker KV; the client stores just an opaque linkToken + public profile
   under userProfile.xboxConnection. Xbox does NOT expose per-title hours played,
   so hours are never written (only games + achievements/gamerscore).
   ========================================================================== */
let xboxConfigCache = null;
let xboxQuickSyncBusy = false;

function normalizeXboxConnection(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    platform: 'xbox',
    linkToken: String(r.linkToken || '').trim(),
    platformUserId: String(r.platformUserId || r.xuid || '').trim(),
    gamertag: String(r.gamertag || '').trim(),
    displayName: String(r.displayName || r.gamertag || '').trim(),
    gamerpic: String(r.gamerpic || '').trim(),
    gamerscore: Number(r.gamerscore || 0) || 0,
    connectedAt: String(r.connectedAt || '').trim(),
    lastSyncedAt: String(r.lastSyncedAt || '').trim(),
    lastSyncTotal: Number(r.lastSyncTotal || 0) || 0,
    syncStatus: String(r.syncStatus || '').trim(),
    syncError: String(r.syncError || '').trim()
  };
}
if (typeof window !== 'undefined') window.normalizeXboxConnection = normalizeXboxConnection;

function getXboxImportConnection() {
  return normalizeXboxConnection((typeof userProfile !== 'undefined' && userProfile && userProfile.xboxConnection) || {});
}

async function fetchXboxConfig(force = false) {
  if (xboxConfigCache && !force) return xboxConfigCache;
  try {
    const res = await fetch(new URL('/api/xbox/config', window.location.origin).toString(), { headers: { Accept: 'application/json' } });
    const json = await res.json();
    xboxConfigCache = (json && json.xbox) ? json.xbox : { configured: false };
  } catch (_) {
    xboxConfigCache = { configured: false };
  }
  return xboxConfigCache;
}

async function saveXboxConnectionPatch(connection = {}) {
  const previous = getXboxImportConnection();
  const safe = connection && typeof connection === 'object' ? connection : {};
  const next = normalizeXboxConnection({
    linkToken: safe.linkToken || previous.linkToken,
    platformUserId: safe.platformUserId || safe.xuid || previous.platformUserId,
    gamertag: safe.gamertag || previous.gamertag,
    displayName: safe.displayName || safe.gamertag || previous.displayName,
    gamerpic: safe.gamerpic || previous.gamerpic,
    gamerscore: (safe.gamerscore != null ? safe.gamerscore : previous.gamerscore),
    connectedAt: safe.connectedAt || previous.connectedAt || new Date().toISOString(),
    lastSyncedAt: safe.lastSyncedAt || previous.lastSyncedAt,
    lastSyncTotal: (safe.lastSyncTotal != null ? safe.lastSyncTotal : previous.lastSyncTotal),
    syncStatus: (safe.syncStatus != null ? safe.syncStatus : previous.syncStatus),
    syncError: (safe.syncError != null ? safe.syncError : previous.syncError)
  });
  if (typeof saveProfileSettingsPatch === 'function') {
    await saveProfileSettingsPatch({ xboxConnection: next });
  } else {
    if (typeof userProfile === 'undefined' || !userProfile) userProfile = {};
    userProfile.xboxConnection = next;
  }
  renderXboxImportCardState();
  return next;
}

async function clearXboxConnectionPatch() {
  const next = normalizeXboxConnection({});
  if (typeof saveProfileSettingsPatch === 'function') {
    await saveProfileSettingsPatch({ xboxConnection: next });
  } else if (typeof userProfile !== 'undefined' && userProfile) {
    userProfile.xboxConnection = next;
  }
  renderXboxImportCardState();
}

function startXboxConnect() {
  if (typeof setImportStatus === 'function') setImportStatus('Opening Xbox sign-in...', 'busy');
  window.location.href = new URL('/api/xbox/connect', window.location.origin).toString();
}

async function handleXboxImportAction(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  const cfg = await fetchXboxConfig();
  if (!cfg.configured) {
    if (typeof showToast === 'function') showToast('Xbox sign-in is not set up yet.');
    renderXboxImportCardState();
    return;
  }
  const connection = getXboxImportConnection();
  if (!connection.linkToken) { startXboxConnect(); return; }
  await quickSyncXboxLibrary();
}
if (typeof window !== 'undefined') window.handleXboxImportAction = handleXboxImportAction;

async function renderXboxImportCardState() {
  const card = document.getElementById('xbox-import-card');
  if (!card) return;
  const copyEl = document.getElementById('xbox-import-copy');
  const metaEl = document.getElementById('xbox-import-meta');
  const actionEl = document.getElementById('xbox-import-action');
  const connection = getXboxImportConnection();
  const cfg = await fetchXboxConfig();
  const connected = !!connection.linkToken;
  card.classList.toggle('is-connected', connected);
  card.classList.toggle('is-busy', !!xboxQuickSyncBusy);
  card.classList.toggle('import-source-card-soon', !cfg.configured);
  card.disabled = false;
  card.style.opacity = cfg.configured ? '' : '0.55';
  card.style.cursor = '';
  if (!cfg.configured) {
    if (copyEl) copyEl.textContent = 'Sync your Xbox played games and achievements.';
    if (metaEl) metaEl.textContent = 'Setup required — Xbox sign-in is not configured yet.';
    if (actionEl) actionEl.textContent = 'Setup required';
    return;
  }
  if (xboxQuickSyncBusy) {
    if (actionEl) actionEl.textContent = 'Syncing...';
    if (metaEl) metaEl.textContent = 'Pulling your Xbox games and achievements...';
    return;
  }
  if (connected) {
    if (copyEl) copyEl.textContent = connection.gamertag ? ('Connected as ' + connection.gamertag + '.') : 'Xbox connected.';
    if (metaEl) metaEl.textContent = connection.lastSyncedAt
      ? ('Connected' + (connection.gamertag ? ' as ' + connection.gamertag : '') + ' · last synced ' + (typeof formatSteamRelativeSyncTime === 'function' ? formatSteamRelativeSyncTime(connection.lastSyncedAt) : 'recently') + ' · tap to resync.')
      : 'Connected · tap to sync games + achievements.';
    if (actionEl) actionEl.textContent = 'Connected';
  } else {
    if (copyEl) copyEl.textContent = 'Sync your Xbox played games and achievements.';
    if (metaEl) metaEl.textContent = 'Official Microsoft sign-in. No password is shared with Shelfd.';
    if (actionEl) actionEl.textContent = 'Connect Xbox';
  }
}
if (typeof window !== 'undefined') window.renderXboxImportCardState = renderXboxImportCardState;

function getOwnGamesArrayForXboxSync() {
  if (typeof data !== 'object' || !data) return null;
  if (!Array.isArray(data.games)) data.games = [];
  return data.games;
}

function findExistingXboxGameInLibrary(games, titleId, title) {
  const cleanId = String(titleId || '').trim();
  if (cleanId) {
    const byId = games.find(g => g && String(g.xboxTitleId || '').trim() === cleanId);
    if (byId) return byId;
  }
  if (typeof getDuplicateTitleKeys === 'function') {
    const keys = getDuplicateTitleKeys({ title });
    if (keys && keys.size) {
      const byTitle = games.find(g => { if (!g) return false; const gk = getDuplicateTitleKeys(g); return [...keys].some(k => gk.has(k)); });
      if (byTitle) return byTitle;
    }
  }
  const norm = String(title || '').trim().toLowerCase();
  return games.find(g => g && String(g.title || '').trim().toLowerCase() === norm) || null;
}

/* Update ONLY Xbox-sourced fields on an existing item. Leaves rating / review /
   status / cover / notes / manual hours untouched (mirrors the Steam refresh). */
function applyXboxRefreshToExistingGame(existing, entry) {
  if (!existing || !entry) return false;
  let changed = false;
  const set = (k, v) => { if (v !== '' && v != null && existing[k] !== v) { existing[k] = v; changed = true; } };
  set('xboxTitleId', String(entry.titleId || existing.xboxTitleId || '').trim());
  set('xboxProductId', String(entry.productId || existing.xboxProductId || '').trim());
  set('xboxServiceConfigId', String(entry.serviceConfigId || existing.xboxServiceConfigId || '').trim());
  set('xboxLastPlayed', String(entry.lastPlayedAt || '').trim());
  if (Number(entry.gamerscore || 0) > 0) set('xboxGamerscore', Number(entry.gamerscore));
  if (Number(entry.achievementsTotal || 0) > 0) {
    set('xboxAchievementsUnlocked', Number(entry.achievementsUnlocked || 0));
    set('xboxAchievementsTotal', Number(entry.achievementsTotal || 0));
    set('xboxAchievementPercent', Number(entry.achievementPercent || 0));
  }
  set('xboxSourceSyncedAt', new Date().toISOString());
  let sources = Array.isArray(existing.platformSources) ? existing.platformSources.slice() : [];
  if (existing.source && !sources.includes(existing.source)) sources.push(existing.source);
  if (!sources.includes('xbox')) { sources.push('xbox'); existing.platformSources = sources; changed = true; }
  else if (!Array.isArray(existing.platformSources)) { existing.platformSources = sources; changed = true; }
  return changed;
}

function buildXboxImportItem(entry) {
  const nowIso = new Date().toISOString();
  const title = String(entry.name || '').trim();
  if (!title) return null;
  const recent = entry.lastPlayedAt && ((Date.now() - new Date(entry.lastPlayedAt).getTime()) < SHELFD_STEAM_RECENT_PLAY_WINDOW_MS);
  const status = entry.lastPlayedAt ? (recent ? 'watching' : 'watched') : 'planned';
  return {
    id: (typeof generateId === 'function') ? generateId() : ('xbox-' + (entry.titleId || Math.random().toString(36).slice(2))),
    title,
    name: title,
    mediaCategory: 'games',
    librarySection: 'games',
    type: 'games',
    status,
    cover: String(entry.displayImage || '').trim(),
    image: String(entry.displayImage || '').trim(),
    platforms: 'Xbox',
    source: 'xbox',
    importSource: 'xbox',
    importSourceLabel: 'Xbox',
    importedAt: nowIso,
    dateAdded: nowIso,
    dateModified: nowIso,
    xboxTitleId: String(entry.titleId || '').trim(),
    xboxProductId: String(entry.productId || '').trim(),
    xboxServiceConfigId: String(entry.serviceConfigId || '').trim(),
    xboxLastPlayed: String(entry.lastPlayedAt || '').trim(),
    xboxGamerscore: Number(entry.gamerscore || 0) || 0,
    xboxAchievementsUnlocked: Number(entry.achievementsUnlocked || 0) || 0,
    xboxAchievementsTotal: Number(entry.achievementsTotal || 0) || 0,
    xboxAchievementPercent: Number(entry.achievementPercent || 0) || 0,
    xboxSourceSyncedAt: nowIso,
    platformSources: ['xbox']
  };
}

async function quickSyncXboxLibrary() {
  if (xboxQuickSyncBusy) return;
  const connection = getXboxImportConnection();
  if (!connection.linkToken) { renderXboxImportCardState(); return; }
  xboxQuickSyncBusy = true;
  renderXboxImportCardState();
  try {
    const url = new URL('/api/xbox/library', window.location.origin);
    url.searchParams.set('link', connection.linkToken);
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) {
      const msg = (json && json.error) || 'Xbox sync failed.';
      await saveXboxConnectionPatch({ syncStatus: 'error', syncError: msg });
      if (typeof showToast === 'function') showToast(msg);
      return;
    }
    const games = getOwnGamesArrayForXboxSync();
    let added = 0, updated = 0;
    if (games) {
      for (const entry of (Array.isArray(json.games) ? json.games : [])) {
        const existing = findExistingXboxGameInLibrary(games, entry.titleId, entry.name);
        if (existing) { if (applyXboxRefreshToExistingGame(existing, entry)) updated++; }
        else { const it = buildXboxImportItem(entry); if (it) { games.push(it); added++; } }
      }
    }
    if (added || updated) {
      if (typeof persistOwnListDataImmediate === 'function') { try { await persistOwnListDataImmediate(data, { sections: ['games'] }); } catch (_) {} }
      else if (typeof save === 'function') { try { save(); } catch (_) {} }
      if (typeof render === 'function') { try { render(); } catch (_) {} }
    }
    await saveXboxConnectionPatch({
      gamertag: (json.player && json.player.gamertag) || connection.gamertag,
      gamerpic: (json.player && json.player.gamerpic) || connection.gamerpic,
      gamerscore: (json.player && json.player.gamerscore) != null ? json.player.gamerscore : connection.gamerscore,
      lastSyncedAt: new Date().toISOString(),
      lastSyncTotal: (Array.isArray(json.games) ? json.games.length : 0),
      syncStatus: 'ok',
      syncError: ''
    });
    if (typeof showToast === 'function') showToast('Xbox synced — ' + added + ' added, ' + updated + ' updated.');
  } catch (e) {
    console.warn('quickSyncXboxLibrary failed:', e);
    if (typeof showToast === 'function') showToast('Xbox sync failed. Try again.');
  } finally {
    xboxQuickSyncBusy = false;
    renderXboxImportCardState();
  }
}
if (typeof window !== 'undefined') window.quickSyncXboxLibrary = quickSyncXboxLibrary;

async function disconnectXbox() {
  const connection = getXboxImportConnection();
  if (connection.linkToken) {
    try {
      const url = new URL('/api/xbox/disconnect', window.location.origin);
      url.searchParams.set('link', connection.linkToken);
      await fetch(url.toString(), { method: 'POST' });
    } catch (_) {}
  }
  await clearXboxConnectionPatch();
  if (typeof showToast === 'function') showToast('Xbox disconnected. Your imported games stay in your library.');
}
if (typeof window !== 'undefined') window.disconnectXbox = disconnectXbox;

const SHELFD_PENDING_XBOX_KEY = 'shelfd_pending_xbox';

function processPendingXboxAuthResult() {
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (_) { params = null; }
  const status = params ? String(params.get('xbox_auth') || '').trim() : '';
  const cleanUrl = () => { try { history.replaceState(null, '', window.location.pathname); } catch (_) {} };
  if (status === 'error') {
    cleanUrl();
    if (typeof showToast === 'function') showToast((params && params.get('xbox_message')) || 'Xbox sign-in failed.');
    renderXboxImportCardState();
    return;
  }
  if (status === 'success' && params.get('xbox_link')) {
    /* v11.493: persist the result to localStorage FIRST. On the fresh page load
       right after the OAuth redirect, Firebase auth often hasn't resolved yet, so
       a straight save would only write in-memory (saveProfileSettingsPatch skips
       Firestore when !currentUser) and the connection would be lost on reload.
       Stashing it locally lets us apply it the moment currentUser is ready, and
       re-apply on every app open until it actually persists to the cloud. */
    const conn = {
      linkToken: params.get('xbox_link') || '',
      platformUserId: params.get('xbox_xuid') || '',
      gamertag: params.get('xbox_gamertag') || '',
      displayName: params.get('xbox_gamertag') || '',
      gamerpic: params.get('xbox_gamerpic') || '',
      gamerscore: Number(params.get('xbox_gamerscore') || 0) || 0,
      connectedAt: new Date().toISOString()
    };
    try { localStorage.setItem(SHELFD_PENDING_XBOX_KEY, JSON.stringify(conn)); } catch (_) {}
    cleanUrl();
  }
  applyPendingXboxConnection(60);
}
if (typeof window !== 'undefined') window.processPendingXboxAuthResult = processPendingXboxAuthResult;

async function applyPendingXboxConnection(retries = 60) {
  let conn = null;
  try { conn = JSON.parse(localStorage.getItem(SHELFD_PENDING_XBOX_KEY) || 'null'); } catch (_) { conn = null; }
  if (!conn || !conn.linkToken) return;
  if (typeof currentUser === 'undefined' || !currentUser) {
    if (retries > 0) setTimeout(() => applyPendingXboxConnection(retries - 1), 500);
    return;
  }
  try {
    await saveXboxConnectionPatch(conn);   // currentUser is ready → writes to Firestore
    try { localStorage.removeItem(SHELFD_PENDING_XBOX_KEY); } catch (_) {}
    if (typeof openImportPage === 'function') openImportPage();
    if (typeof showToast === 'function') showToast('Xbox connected' + (conn.gamertag ? ' as ' + conn.gamertag : '') + '.');
    await quickSyncXboxLibrary();
  } catch (e) { console.warn('Xbox connect apply failed:', e); }
}
if (typeof window !== 'undefined') window.applyPendingXboxConnection = applyPendingXboxConnection;

function bootstrapSteamImportAuthFlow() {
  const url = new URL(window.location.href);
  const authResult = normalizeImportText(url.searchParams.get(STEAM_AUTH_RESULT_PARAM));
  const steamId = normalizeImportText(url.searchParams.get(STEAM_AUTH_STEAM_ID_PARAM));
  const message = normalizeImportText(url.searchParams.get(STEAM_AUTH_MESSAGE_PARAM));
  const wantsImportView = url.searchParams.get(STEAM_IMPORT_QUERY_FLAG) === '1';
  if (authResult) {
    storePendingSteamAuth({
      ok: authResult === 'success' && !!steamId,
      steamId,
      message
    });
    cleanupSteamImportUrlParams();
  }
  if (authResult || wantsImportView) openSteamImportPage();
  processPendingSteamAuthResult();
  if (typeof processPendingXboxAuthResult === 'function') processPendingXboxAuthResult();
}

function getImportTargetSection(entry = {}, item = null) {
  if (entry.typeHint === 'music' || entry.source === 'applemusic' || item?.librarySection === 'music') return 'music';
  if (entry.typeHint === 'game') return 'games';
  if (entry.typeHint === 'anime') return 'anime';
  if (entry.typeHint === 'tv') return resolveShowSection(item || {}, 'shows');
  return 'movies';
}

async function findTmdbByImdbId(imdbId = '', typeHint = '') {
  const cleanId = normalizeImportText(imdbId);
  if (!/^tt\d+/i.test(cleanId)) return null;
  try {
    const res = await fetchTmdbProxy(`find/${cleanId}`, { external_source: 'imdb_id' });
    if (!res.ok) return null;
    const json = await res.json();
    const movie = Array.isArray(json.movie_results) ? json.movie_results[0] : null;
    const tv = Array.isArray(json.tv_results) ? json.tv_results[0] : null;
    if (typeHint === 'tv' && tv) return { type: 'tv', id: tv.id };
    if (movie) return { type: 'movie', id: movie.id };
    if (tv) return { type: 'tv', id: tv.id };
  } catch (e) {
    console.warn('IMDb external match failed:', e);
  }
  return null;
}

async function searchTmdbForImport(entry = {}) {
  const external = await findTmdbByImdbId(entry.imdbId, entry.typeHint);
  if (external) return external;
  const types = entry.typeHint === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];
  for (const type of types) {
    try {
      const params = { query: entry.title };
      if (entry.year) params[type === 'tv' ? 'first_air_date_year' : 'year'] = entry.year;
      const res = await fetchTmdbProxy(`search/${type}`, params);
      if (!res.ok) continue;
      const json = await res.json();
      const hit = (json.results || []).find(r => {
        if (!entry.year) return true;
        const y = String(r.release_date || r.first_air_date || '').slice(0, 4);
        return !y || y === String(entry.year);
      }) || (json.results || [])[0];
      if (hit?.id) return { type, id: hit.id };
    } catch (e) {
      console.warn('TMDB import search failed:', e);
    }
  }
  return null;
}

async function tryAiNormalizeImportEntry(entry = {}) {
  const enabled = document.getElementById('import-ai-fallback')?.checked !== false;
  if (!enabled) return null;
  try {
    const res = await fetchDeepSeekImportMatch({
      systemPrompt: 'Return valid JSON only. Normalize an imported media title for database search.',
      userPrompt: `Source: ${entry.source}. Title: ${entry.title}. Year: ${entry.year || ''}. Type hint: ${entry.typeHint || ''}. Return {"title":"clean title","type":"movie|tv|game|anime","year":"YYYY or empty"}.`,
      temperature: 0
    });
    if (!res.ok) return null;
    const raw = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {}
    const payload = parsed?.title ? parsed : (parsed?.result || parsed?.data || null);
    if (!payload?.title) return null;
    return {
      ...entry,
      title: normalizeImportText(payload.title) || entry.title,
      typeHint: payload.type === 'tv' ? 'tv' : payload.type === 'game' ? 'game' : payload.type === 'anime' ? 'anime' : entry.typeHint,
      year: normalizeImportText(payload.year || entry.year)
    };
  } catch (e) {
    return null;
  }
}

async function buildTmdbImportItems(entry = {}) {
  let match = await searchTmdbForImport(entry);
  if (!match) {
    const normalized = await tryAiNormalizeImportEntry(entry);
    if (normalized) match = await searchTmdbForImport(normalized);
  }
  if (!match) return [];
  return buildTmdbLibraryItems(match.type, match.id, entry.status, entry.rating);
}

async function buildRawgImportItems(entry = {}) {
  try {
    let res = await fetchRawgProxy('games', { search: entry.title, page_size: 1 });
    let json = res.ok ? await res.json() : {};
    let hit = (json.results || [])[0];
    if (!hit) {
      const normalized = await tryAiNormalizeImportEntry(entry);
      if (normalized?.title) {
        res = await fetchRawgProxy('games', { search: normalized.title, page_size: 1 });
        json = res.ok ? await res.json() : {};
        hit = (json.results || [])[0];
      }
    }
    if (!hit?.id) {
      return [{
        id: Date.now().toString() + '-import-game-' + Math.random().toString(36).slice(2, 7),
        title: entry.title,
        cover: '',
        genre: 'Game',
        year: entry.year || '',
        status: entry.status,
        rating: entry.rating,
        dateAdded: new Date().toISOString(),
        source: 'import',
        librarySection: 'games',
        mediaCategory: 'games',
        episodes: []
      }];
    }
    return [await buildRawgLibraryItem(hit.id, entry.status, entry.rating)];
  } catch (e) {
    console.warn('RAWG import match failed:', e);
    return [];
  }
}

async function buildSteamImportItems(entry = {}) {
  try {
    let res = await fetchRawgProxy('games', { search: entry.title, page_size: 1 });
    let json = res.ok ? await res.json() : {};
    let hit = (json.results || [])[0];
    if (!hit) {
      const normalized = await tryAiNormalizeImportEntry(entry);
      if (normalized?.title) {
        res = await fetchRawgProxy('games', { search: normalized.title, page_size: 1 });
        json = res.ok ? await res.json() : {};
        hit = (json.results || [])[0];
      }
    }
    if (!hit?.id) {
      const item = applySteamFieldsToLibraryItem({
        id: Date.now().toString() + '-steam-' + (entry.steamAppId || Math.random().toString(36).slice(2, 7)),
        title: entry.title,
        cover: '',
        genre: 'Game',
        year: entry.year || '',
        status: entry.status,
        rating: entry.rating,
        dateAdded: new Date().toISOString(),
        source: 'steam',
        librarySection: 'games',
        mediaCategory: 'games',
        episodes: []
      }, entry);
      await applySteamIgdbCoverToItem(item, entry);
      return [item];
    }
    const item = applySteamFieldsToLibraryItem(await buildRawgLibraryItem(hit.id, entry.status, entry.rating), entry);
    await applySteamIgdbCoverToItem(item, entry);
    return [item];
  } catch (e) {
    console.warn('Steam import match failed:', e);
    return [];
  }
}

function getCompactEpisodeStats(item = {}) {
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  const storedTotal = Number(item.totalEps || item.totalEpisodes || 0);
  if (episodes.length) {
    /* v11.398: count ONLY aired episodes (exclude confirmed-but-unaired episodes
       from upcoming seasons) so the card shows what's currently out, and the
       percent reflects aired progress (e.g. 18/18 = 100%, not 18/26). */
    const aired = (typeof isScreenListEpisodeAired === 'function')
      ? episodes.filter(ep => isScreenListEpisodeAired(ep, item))
      : episodes;
    const total = aired.length;
    const watched = aired.filter(ep => ep && ep.watched).length;
    const percent = total > 0 ? Math.round((watched / total) * 100) : 0;
    return { total, watched, percent };
  }
  const total = storedTotal || 0;
  const storedCurrent = Number(item.currentEp || item.currentEpisode || item.watchedEpisodes || 0);
  const watched = item.status === 'watched' ? total : Math.max(0, Math.min(total || Infinity, storedCurrent));
  const percent = total > 0 ? Math.round((watched / total) * 100) : 0;
  return { total, watched, percent };
}

const MAL_POSTER_CACHE_KEY = 'screenlist-mal-poster-cache-v1';
const malPosterHydrationState = { queued: new Set(), queue: [], active: false, persistTimer: null, renderTimer: null };

function readMalPosterCache() {
  try { return JSON.parse(localStorage.getItem(MAL_POSTER_CACHE_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function writeMalPosterCache(cache = {}) {
  try { localStorage.setItem(MAL_POSTER_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
}

function getBestJikanAnimeCover(info = {}) {
  const images = info?.images || {};
  return images.jpg?.large_image_url ||
    images.webp?.large_image_url ||
    images.jpg?.image_url ||
    images.webp?.image_url ||
    images.jpg?.small_image_url ||
    images.webp?.small_image_url ||
    '';
}

async function fetchMalPosterById(malId = '') {
  const id = String(malId || '').trim();
  if (!id) return '';
  const cache = readMalPosterCache();
  if (cache[id]) return cache[id];
  let cover = '';
  try {
    const res = await fetch(`${JIKAN_API_BASE}/anime/${encodeURIComponent(id)}/full`, { cache: 'force-cache' });
    if (res.ok) cover = getBestJikanAnimeCover((await res.json()).data || {});
  } catch (e) {}
  if (!cover) {
    try {
      const res = await fetch(`${JIKAN_API_BASE}/anime/${encodeURIComponent(id)}/pictures`, { cache: 'force-cache' });
      if (res.ok) {
        const first = ((await res.json()).data || [])[0] || {};
        cover = getBestJikanAnimeCover(first);
      }
    } catch (e) {}
  }
  if (cover) {
    cache[id] = cover;
    writeMalPosterCache(cache);
  }
  return cover;
}

function applyMalPosterToList(source, malId = '', cover = '') {
  if (!source || !Array.isArray(source.anime) || !malId || !cover) return false;
  let changed = false;
  source.anime.forEach(item => {
    if (item && !item.cover && String(item.malId || '').trim() === String(malId).trim()) {
      item.cover = cover;
      changed = true;
    }
  });
  return changed;
}

function updateLibraryCardCoverElement(itemId = '', cover = '') {
  if (!itemId || !cover) return;
  const card = document.getElementById('card-' + itemId);
  if (!card) return;
  const coverEl = card.querySelector('.card-cover, .card-cover-profile-btn');
  if (!coverEl) return;
  coverEl.classList.remove('no-img');
  coverEl.style.backgroundImage = 'url(' + JSON.stringify(cover) + ')';
  coverEl.style.backgroundSize = 'cover';
  coverEl.style.backgroundPosition = 'center';
  coverEl.innerHTML = '';
}

function repairLibraryItemCoverFromProfile(seed = {}, details = {}) {
  const itemId = String(seed.libraryItemId || '').trim();
  const section = String(seed.librarySection || seed.mediaCategory || '').trim();
  if (!itemId || !section) return false;
  const cover = getDiscoverMediaPoster(details) || String(seed.poster || '').trim();
  if (!cover) return false;
  const source = seed.librarySource === 'friend' ? friendViewData : data;
  const list = source && Array.isArray(source[section]) ? source[section] : [];
  const item = list.find(entry => entry && String(entry.id) === itemId);
  if (!item || item.cover) return false;
  item.cover = cover;
  updateLibraryCardCoverElement(itemId, cover);
  if (section === 'anime' && item.malId) {
    const cache = readMalPosterCache();
    cache[String(item.malId).trim()] = cover;
    writeMalPosterCache(cache);
  }
  if (source === data && currentUser && !viewingUser) {
    writeOwnDataDirect(data).catch(error => console.warn('Profile poster repair save failed:', error));
  }
  return true;
}

function scheduleMalPosterPersist() {
  if (!currentUser || viewingUser || malPosterHydrationState.persistTimer) return;
  malPosterHydrationState.persistTimer = setTimeout(async () => {
    malPosterHydrationState.persistTimer = null;
    try { await writeOwnDataDirect(data); } catch (e) { console.warn('MAL poster repair save failed:', e); }
  }, 800);
}

function scheduleMalPosterRender() {
  if (malPosterHydrationState.renderTimer) return;
  malPosterHydrationState.renderTimer = setTimeout(() => {
    malPosterHydrationState.renderTimer = null;
    try {
      if (typeof render === 'function') render();
      if (document.body.classList.contains('profile-active') && typeof renderProfileLists === 'function') renderProfileLists();
    } catch (e) {}
  }, 120);
}

async function processMalPosterHydrationQueue() {
  if (malPosterHydrationState.active) return;
  malPosterHydrationState.active = true;
  while (malPosterHydrationState.queue.length) {
    const malId = malPosterHydrationState.queue.shift();
    try {
      const cover = await fetchMalPosterById(malId);
      if (cover) {
        const ownChanged = applyMalPosterToList(data, malId, cover);
        if (ownDataCache) applyMalPosterToList(ownDataCache, malId, cover);
        const friendChanged = applyMalPosterToList(friendViewData, malId, cover);
        if (ownChanged) scheduleMalPosterPersist();
        if (ownChanged || friendChanged) scheduleMalPosterRender();
      }
    } catch (e) {
      console.warn('MAL poster hydration failed:', malId, e);
    }
    await new Promise(resolve => setTimeout(resolve, 420));
  }
  malPosterHydrationState.active = false;
}

function queueMissingMalPosterHydration(item = {}, section = '') {
  if (section !== 'anime' || !item || item.cover) return;
  const malId = String(item.malId || '').trim();
  if (!malId) return;
  const cache = readMalPosterCache();
  if (cache[malId]) {
    item.cover = cache[malId];
    applyMalPosterToList(data, malId, cache[malId]);
    if (ownDataCache) applyMalPosterToList(ownDataCache, malId, cache[malId]);
    applyMalPosterToList(friendViewData, malId, cache[malId]);
    scheduleMalPosterPersist();
    return;
  }
  if (malPosterHydrationState.queued.has(malId)) return;
  malPosterHydrationState.queued.add(malId);
  malPosterHydrationState.queue.push(malId);
  processMalPosterHydrationQueue();
}

async function buildMalImportItems(entry = {}) {
  const baseId = Date.now().toString() + '-mal-' + (entry.malId || Math.random().toString(36).slice(2, 7));
  let info = null;
  if (entry.malId) {
    try {
      const res = await fetch(`${JIKAN_API_BASE}/anime/${encodeURIComponent(entry.malId)}/full`, { cache: 'force-cache' });
      if (res.ok) info = (await res.json()).data || null;
    } catch (e) {}
  }
  const titleRows = Array.isArray(info?.titles) ? info.titles : [];
  const titleByType = type => titleRows.find(row => String(row?.type || '').toLowerCase() === type)?.title || '';
  const title = info?.title_english || entry.title;
  const episodesTotal = Number(info?.episodes || entry.totalEpisodes || 0);
  const item = {
    id: baseId,
    title,
    cover: getBestJikanAnimeCover(info) || '',
    genre: (info?.genres || []).map(g => g.name).join(', ') || 'Anime',
    genreNames: (info?.genres || []).map(g => g.name).filter(Boolean),
    year: String(info?.year || info?.aired?.from || '').slice(0, 4),
    status: entry.status,
    rating: entry.rating,
    dateAdded: new Date().toISOString(),
    imdbId: '',
    tmdbId: '',
    malId: entry.malId || '',
    mal_id: entry.malId || '',
    animeIdentityKey: entry.malId ? `mal:${entry.malId}` : '',
    malUrl: info?.url || (entry.malId ? `https://myanimelist.net/anime/${entry.malId}` : ''),
    jikanUrl: info?.url || (entry.malId ? `https://myanimelist.net/anime/${entry.malId}` : ''),
    url: info?.url || (entry.malId ? `https://myanimelist.net/anime/${entry.malId}` : ''),
    mediaCategory: 'anime',
    librarySection: 'anime',
    source: 'myanimelist',
    originalTitle: titleByType('japanese') || '',
    originalLanguage: 'ja',
    originCountries: ['JP'],
    isAnime: true,
    titleVariants: normalizeAnimeTitleVariants({
      english: info?.title_english || entry.title,
      romaji: titleByType('default') || info?.title || entry.title,
      japanese: titleByType('japanese') || ''
    }, entry.title),
    englishTitle: info?.title_english || entry.title,
    romajiTitle: titleByType('default') || info?.title || entry.title,
    japaneseTitle: titleByType('japanese') || '',
    animeType: info?.type || entry.malType || '',
    totalEpisodes: episodesTotal,
    totalEps: episodesTotal,
    currentEp: entry.status === 'watched' ? episodesTotal : Math.max(0, Number(entry.watchedEpisodes || 0)),
    watchedEpisodes: Math.max(0, Number(entry.watchedEpisodes || 0)),
    bulkImportCompact: true,
    episodes: []
  };
  if (info && typeof applyJikanCanonicalAnimeFields === 'function') {
    applyJikanCanonicalAnimeFields(item, info);
  }
  return [item];
}

async function buildAppleMusicImportItems(entry = {}) {
  const nowIso = new Date().toISOString();
  const tracks = Array.isArray(entry.tracks) ? entry.tracks.map((track, index) => ({
    number: track.number || index + 1,
    title: track.title || `Track ${index + 1}`,
    length: Number(track.length || track.durationMs || 0) || 0,
    appleMusicSongId: String(track.appleMusicSongId || '').trim(),
    rating: Number(track.rating || 0) || 0,
    favorite: Number(track.favorite || 0) || 0,
    playParams: track.playParams || null
  })) : [];
  const item = {
    id: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : ('applemusic-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
    title: entry.title || '',
    artist: entry.artist || '',
    year: entry.year || String(entry.releaseDate || '').slice(0, 4),
    releaseDate: entry.releaseDate || '',
    genre: entry.genre || '',
    cover: entry.cover || '',
    tracks,
    runtimeMs: tracks.reduce((sum, track) => sum + Number(track.length || 0), 0),
    status: entry.status === 'planned' ? 'planned' : 'watched',
    rating: Number(entry.rating || 0) || 0,
    librarySection: 'music',
    mediaCategory: 'music',
    source: 'applemusic',
    importSource: 'applemusic',
    appleMusicAlbumId: String(entry.appleMusicAlbumId || '').trim(),
    appleMusicSongIds: Array.isArray(entry.appleMusicSongIds) ? entry.appleMusicSongIds.filter(Boolean) : tracks.map(track => track.appleMusicSongId).filter(Boolean),
    appleMusicPlayParams: entry.raw?.playParams || null,
    dateAdded: nowIso,
    createdAt: nowIso,
    lastEditedAt: nowIso
  };
  return [item];
}

async function buildImportItems(entry = {}) {
  if (entry.source === 'myanimelist') return buildMalImportItems(entry);
  if (entry.source === 'backloggd') return buildRawgImportItems(entry);
  if (entry.source === 'steam') return buildSteamImportItems(entry);
  if (entry.source === 'applemusic') return buildAppleMusicImportItems(entry);
  return buildTmdbImportItems(entry);
}

async function confirmImportLibrary() {
  if (!pendingImportRows.length || importBusy) return;
  const rowsToImport = pendingImportSource === 'steam' ? getSelectedSteamImportRows() : pendingImportRows.slice();
  if (!rowsToImport.length) {
    if (pendingImportSource === 'steam') setSteamSyncStatus('Select at least one Steam game to import.', 'error');
    else setImportStatus('Select at least one title to import.', 'error');
    return;
  }
  importBusy = true;
  const skipDuplicates = pendingImportSource === 'steam'
    ? document.getElementById('steam-sync-skip-duplicates')?.checked !== false
    : document.getElementById('import-skip-duplicates')?.checked !== false;
  let added = 0;
  let skipped = 0;
  let failed = 0;
  let repaired = 0;
  const startedSection = activeSection;
  const source = pendingImportSource;
  const importBatchStartedAt = new Date().toISOString();
  const importBatchId = `import-${source || 'library'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const importSourceLabel = getImportSourceLabel(source);
  const importedStatusCounts = {};
  let firstImportedSection = '';
  try {
    const working = compactImportedAnimeForStorage(data);
    for (let i = 0; i < rowsToImport.length; i++) {
      const entry = rowsToImport[i];
      setImportStatus(`Importing ${i + 1}/${rowsToImport.length}: ${entry.title}`, 'busy');
      if (source === 'steam') setSteamSyncStatus(`Importing ${i + 1}/${rowsToImport.length}: ${entry.title}`, 'busy');
      try {
        const items = await buildImportItems(entry);
        if (!items.length) {
          failed++;
          continue;
        }
        for (const rawItem of items) {
          const section = getImportTargetSection(entry, rawItem);
          const item = section === 'anime' ? getCompactImportedAnimeItem(rawItem) : rawItem;
          item.importBatchId = item.importBatchId || importBatchId;
          item.importedAt = item.importedAt || importBatchStartedAt;
          item.importSource = item.importSource || source;
          item.importSourceLabel = item.importSourceLabel || importSourceLabel;
          item.importBatchTotal = rowsToImport.length;
          /* v11.569: carry Letterboxd review text + real watch date onto the item
             (title-only — no activity-feed post is created on import). */
          if (entry.reviewText && !item.reviewText) {
            item.reviewText = String(entry.reviewText).slice(0, 4000);
            /* Keep imported reviews PRIVATE/title-only so nothing auto-publishes.
               Without these, the review defaults to public+repliable and the first
               Reply tap / edit-save would silently create a friends-visible feed
               post — breaking the user's "no feed posts" choice. */
            if (item.reviewRepliesPublic === undefined) item.reviewRepliesPublic = false;
            if (!item.reviewVisibility) item.reviewVisibility = 'private';
          }
          if (entry.dateWatched && !item.dateWatched) item.dateWatched = entry.dateWatched;
          if (entry.letterboxdUri && !item.letterboxdUri) item.letterboxdUri = entry.letterboxdUri;
          working[section] = Array.isArray(working[section]) ? working[section] : [];
          const duplicateItem = skipDuplicates ? findDuplicateImportItemInList(item, entry, section, working) : null;
          if (duplicateItem) {
            if (repairDuplicateImportItem(duplicateItem, item, entry, section)) repaired++;
            else skipped++;
            importedStatusCounts[entry.status || item.status || 'planned'] = (importedStatusCounts[entry.status || item.status || 'planned'] || 0) + 1;
            if (!firstImportedSection) firstImportedSection = section;
            continue;
          }
          working[section].push(item);
          importedStatusCounts[item.status || 'planned'] = (importedStatusCounts[item.status || 'planned'] || 0) + 1;
          if (!firstImportedSection) firstImportedSection = section;
          added++;
        }
      } catch (error) {
        console.warn('Import item failed:', entry, error);
        failed++;
      }
    }

    await writeOwnDataDirect(working);

    const preferredSection = source === 'myanimelist' ? 'anime' : firstImportedSection;
    activeSection = ['games', 'anime', 'movies', 'shows', 'music', 'manga', 'books'].includes(preferredSection)
      ? preferredSection
      : (['games', 'anime', 'movies', 'shows', 'music', 'manga', 'books'].includes(startedSection) ? startedSection : 'shows');

    const statuses = activeSection === 'movies'
      ? ['watched', 'planned', 'paused', 'dropped']
      : activeSection === 'games'
        ? ['watched', 'watching', 'planned', 'live', 'paused', 'dropped']
        : activeSection === 'music'
          ? ['watched', 'watching', 'planned']
          : ['watched', 'watching', 'planned', 'paused', 'dropped'];
    activeTab = statuses
      .filter(status => importedStatusCounts[status])
      .sort((a, b) => importedStatusCounts[b] - importedStatusCounts[a])[0] || getDefaultTabForSection(activeSection);

    clearListSearch();
    render();
    setBottomNavVisibility(true);
    syncMainNavButtons('mylist');
    setMainNavVisibility('mylist');
    window.scrollTo({ top: 0, behavior: 'auto' });
    persistUiState();
    playLibraryAddPopSound();
    const sectionLabel = getSectionLabel(activeSection);
    setImportStatus(`Import complete: ${added} added, ${repaired} repaired, ${skipped} skipped, ${failed} unmatched. Showing ${sectionLabel} · ${activeTab}.`, added || repaired || skipped ? 'ready' : 'error');
    if (source === 'steam') {
      setSteamSyncStatus(`Import complete: ${added} added, ${repaired} updated, ${skipped} skipped, ${failed} unmatched.`, added || repaired || skipped ? 'ready' : 'error');
      showSteamImportSuccessSplash({ added, repaired, skipped, failed, total: rowsToImport.length, providerLabel: 'Steam', itemLabel: 'game' });
    } else {
      showSteamImportSuccessSplash({ added, repaired, skipped, failed, total: rowsToImport.length, providerLabel: importSourceLabel, itemLabel: source === 'backloggd' ? 'game' : source === 'myanimelist' ? 'anime title' : source === 'applemusic' ? 'album' : 'title' });
    }
    /* v11.570: MAL lists each season as its own entry. Kick the Jikan root resolver
       now so the franchise collapses into ONE parent series (each season keeping its
       own imported score) promptly, instead of lazily on the next session's render.
       Fire-and-forget; the throttled/cached resolver surfaces its own progress pill. */
    if (source === 'myanimelist' && typeof window !== 'undefined' && typeof window.kickAnimeSeriesRootResolve === 'function') {
      window.kickAnimeSeriesRootResolve();
    }
    closeImportSourcePage();
    pendingImportRows = [];
    steamImportExcludedKeys = new Set();
    clearImportPreview();
    clearSteamSyncPreview();
  } catch (error) {
    console.error('Import save failed:', error);
    const message = typeof formatOwnDataSaveError === 'function'
      ? formatOwnDataSaveError(error, working)
      : (error?.message || 'Import could not be saved permanently. Check your connection and try syncing again.');
    setImportStatus(message, 'error');
    if (source === 'steam') setSteamSyncStatus(message, 'error');
    showToast(message);
  } finally {
    importBusy = false;
    renderSteamImportCardState();
    renderAppleMusicImportCardState();
    if (typeof renderXboxImportCardState === 'function') renderXboxImportCardState();
  }
}

window.normalizeAppleMusicConnection = normalizeAppleMusicConnection;
window.getShelfdAppleMusicConnection = getAppleMusicConnection;
window.getShelfdAppleMusicMetadataCache = readAppleMusicMetadataCache;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bootstrapSteamImportAuthFlow();
    renderAppleMusicImportCardState();
  }, { once: true });
} else {
  setTimeout(() => {
    bootstrapSteamImportAuthFlow();
    renderAppleMusicImportCardState();
  }, 0);
}
