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
  const plannedLabel = isGame ? 'Backlog' : 'Watchlist';
  content.innerHTML = `
    <h3>Add to Library</h3>
    <div class="discover-add-desc">Where you bouta put this?</div>
    <div class="discover-status-options">
      <button class="discover-status-btn watched-option" onclick="confirmDiscoveryAdd('watched')">${watchedLabel}</button>
      <button class="discover-status-btn planned-option" onclick="confirmDiscoveryAdd('planned')">${plannedLabel}</button>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary discover-cancel-btn" onclick="closeDiscoverAddModal()">Cancel</button>
    </div>
  `;
}

function closeDiscoverAddModal() {
  document.getElementById('discover-add-modal').style.display = 'none';
  pendingDiscoveryAdd = null;
  pendingFriendAdd = null;
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
  btn.disabled = true;
  btn.textContent = getDiscoverLibraryStatusLabel(status || getDiscoverLibraryMatch(title, section)?.status || '', section);
  btn.classList.add('added');
}

async function addDiscoveryTitle(type, tmdbId, btn, status = 'planned', originalText = '', rating = 0) {
  if (btn) {
    btn.disabled = true;
    btn.classList.remove('added');
    btn.textContent = 'Adding...';
  }
  try {
    const builtItems = type === 'game'
      ? [await buildRawgLibraryItem(tmdbId, status, rating)]
      : await buildTmdbLibraryItems(type, tmdbId, status, rating);
    const item = builtItems[0];
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
      const newItems = builtItems.filter(entry => !isDuplicateTitleInList(entry.title, section, targetData));
      if (!newItems.length) {
        showToast("this title is already added to your library silly!");
        markDiscoverButtonAdded(btn);
        return;
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
        btn.title = 'Click to remove from your library';
      }
      showToast("Added to your library");
      return;
    }

    data[section] = Array.isArray(data[section]) ? data[section] : [];
    if (section === 'anime' && item?.tmdbId) data[section] = removeAnimeSeasonSplitEntries(data[section], item);
    const newItems = builtItems.filter(entry => !isDuplicateTitle(entry.title, section));
    if (!newItems.length) {
      showToast("this title is already added to your library silly!");
      markDiscoverButtonAdded(btn);
      return;
    }
    data[section].push(...newItems);
    activeSection = section;
    activeTab = status;
    save();
    render();
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
      btn.title = 'Click to remove from your library';
    }
    showToast("Added to your library");
  } catch(e) {
    console.error("Discover add failed:", e);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('added');
      btn.textContent = originalText || '+ Add to Library';
    }
    showToast("Could not add this title. Try again.");
  }
}

async function removeDiscoveryTitle(btn) {
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
  const res = await fetchRawgProxy(`games/${rawgId}`);
  if (!res.ok) throw new Error("RAWG details request failed");
  const d = await res.json();
  return {
    id: Date.now().toString() + '-rawg-' + rawgId,
    title: d.name || '',
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
    rawgId: String(rawgId),
    rawgSlug: d.slug || '',
    backloggdSlug: d.slug || '',
    source: 'rawg',
    tmdbId: '',
    episodes: []
  };
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
  const item = await buildTmdbLibraryItem(type, tmdbId, status, rating);
  if (type === 'tv' && shouldSplitAnimeSeasons(item)) {
    return buildAnimeSeasonItemsForLibrary(item, status, rating);
  }
  return [item];
}


// Import Library
let importReturnTab = 'mylist';
let pendingImportSource = '';
let pendingImportRows = [];
let importBusy = false;

function openImportPage() {
  importReturnTab = getActiveMainTab ? getActiveMainTab() : 'mylist';
  syncMainNavButtons('');
  setBottomNavVisibility(false);
  setMainNavVisibility('import');
  window.scrollTo({ top: 0, behavior: 'auto' });
  persistUiState();
}

function closeImportPage() {
  const next = importReturnTab || 'mylist';
  setBottomNavVisibility(true);
  switchMainNav(next);
}

function setImportStatus(message = '', kind = '') {
  const el = document.getElementById('import-status');
  if (!el) return;
  el.className = ['import-status', kind ? `import-status-${kind}` : ''].filter(Boolean).join(' ');
  el.textContent = message;
}

function clearImportPreview() {
  const el = document.getElementById('import-preview');
  if (el) el.innerHTML = '';
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
  return ({ letterboxd: 'Letterboxd', imdb: 'IMDb', myanimelist: 'MyAnimeList', backloggd: 'Backloggd' })[source] || 'Import';
}

async function readImportTextFiles(source, file) {
  if (!file) return [];
  const name = file.name || '';
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) {
    if (!window.JSZip) throw new Error('ZIP support did not load. Upload the CSV/XML file directly, or check the JSZip CDN script.');
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
      const wantedLetterboxd = source !== 'letterboxd' || /(ratings|watched|watchlist|diary|films|reviews|list)/i.test(fileName);
      if (!wantedLetterboxd) continue;
      output.push({ name: fileName, text: await entry.async('string') });
    }
    if (!output.length) throw new Error('No supported CSV/XML file found inside that ZIP.');
    return output;
  }
  return [{ name, text: await file.text() }];
}

function normalizeLetterboxdImportRows(files = []) {
  const rows = [];
  files.forEach(file => {
    const fileName = file.name || '';
    const lower = fileName.toLowerCase();
    const status = lower.includes('watchlist') ? 'planned' : 'watched';
    parseScreenListCsv(file.text).forEach(row => {
      const title = getImportRowValue(row, ['Name', 'Title', 'Film']);
      if (!title) return;
      rows.push({
        source: 'letterboxd',
        sourceFile: fileName,
        title,
        year: getImportRowValue(row, ['Year', 'Release Year']),
        status,
        rating: normalizeImportRating(getImportRowValue(row, ['Rating', 'Stars']), 'letterboxd'),
        typeHint: 'movie',
        raw: row
      });
    });
  });
  return rows;
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
  return [];
}

function renderImportPreview() {
  const el = document.getElementById('import-preview');
  if (!el) return;
  if (!pendingImportRows.length) {
    el.innerHTML = '';
    return;
  }
  const rows = pendingImportRows.slice(0, 60).map((row, index) => `
    <div class="import-preview-row">
      <div class="import-preview-main">
        <strong>${index + 1}. ${escHtml(row.title)}</strong>
        <span>${escHtml([row.year, row.typeHint, row.status].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="import-preview-score">${row.rating ? escHtml(formatRatingValueForSection(row.rating, row.typeHint === 'game' ? 'games' : 'movies', true)) : 'No rating'}</div>
    </div>
  `).join('');
  const hiddenCount = Math.max(0, pendingImportRows.length - 60);
  el.innerHTML = `
    <div class="import-preview-card">
      <div class="import-preview-head">
        <div>
          <div class="import-preview-title">Ready to import ${pendingImportRows.length} title${pendingImportRows.length === 1 ? '' : 's'}</div>
          <div class="import-preview-sub">${escHtml(getImportSourceLabel(pendingImportSource))} · Previewing first ${Math.min(60, pendingImportRows.length)}${hiddenCount ? ` · ${hiddenCount} more hidden` : ''}</div>
        </div>
        <button class="btn-primary" onclick="confirmImportLibrary()">Import to ScreenList</button>
      </div>
      <div class="import-preview-list">${rows}</div>
    </div>
  `;
}

async function handleImportFile(source, file) {
  if (!file || importBusy) return;
  pendingImportSource = source;
  pendingImportRows = [];
  clearImportPreview();
  setImportStatus(`Reading ${file.name}...`, 'busy');
  try {
    const files = await readImportTextFiles(source, file);
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

function getImportTargetSection(entry = {}, item = null) {
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

function buildEpisodesFromCount(itemId, total, watchedCount, status) {
  const count = Math.max(0, Number(total || 0));
  const watched = status === 'watched' ? count : Math.max(0, Number(watchedCount || 0));
  return Array.from({ length: count }, (_, index) => ({
    id: `${itemId}-ep-${index + 1}`,
    number: index + 1,
    seasonNum: 1,
    epNum: index + 1,
    title: '',
    watched: index < watched,
    rating: 0
  }));
}

function getCompactEpisodeStats(item = {}) {
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  const storedTotal = Number(item.totalEps || item.totalEpisodes || 0);
  const total = episodes.length || storedTotal || 0;
  const storedCurrent = Number(item.currentEp || item.currentEpisode || item.watchedEpisodes || 0);
  const watched = episodes.length
    ? episodes.filter(ep => ep && ep.watched).length
    : (item.status === 'watched' ? total : Math.max(0, Math.min(total || Infinity, storedCurrent)));
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
    totalEpisodes: episodesTotal,
    totalEps: episodesTotal,
    currentEp: entry.status === 'watched' ? episodesTotal : Math.max(0, Number(entry.watchedEpisodes || 0)),
    watchedEpisodes: Math.max(0, Number(entry.watchedEpisodes || 0)),
    bulkImportCompact: true,
    episodes: []
  };
  return [item];
}

async function buildImportItems(entry = {}) {
  if (entry.source === 'myanimelist') return buildMalImportItems(entry);
  if (entry.source === 'backloggd') return buildRawgImportItems(entry);
  return buildTmdbImportItems(entry);
}

async function confirmImportLibrary() {
  if (!pendingImportRows.length || importBusy) return;
  importBusy = true;
  const skipDuplicates = document.getElementById('import-skip-duplicates')?.checked !== false;
  let added = 0;
  let skipped = 0;
  let failed = 0;
  let repaired = 0;
  const startedSection = activeSection;
  const source = pendingImportSource;
  const importedStatusCounts = {};
  let firstImportedSection = '';
  try {
    const working = compactImportedAnimeForStorage(data);
    for (let i = 0; i < pendingImportRows.length; i++) {
      const entry = pendingImportRows[i];
      setImportStatus(`Importing ${i + 1}/${pendingImportRows.length}: ${entry.title}`, 'busy');
      try {
        const items = await buildImportItems(entry);
        if (!items.length) {
          failed++;
          continue;
        }
        for (const rawItem of items) {
          const section = getImportTargetSection(entry, rawItem);
          const item = section === 'anime' ? getCompactImportedAnimeItem(rawItem) : rawItem;
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
    activeSection = ['games', 'anime', 'movies', 'shows', 'manga', 'books'].includes(preferredSection)
      ? preferredSection
      : (['games', 'anime', 'movies', 'shows', 'manga', 'books'].includes(startedSection) ? startedSection : 'shows');

    const statuses = activeSection === 'movies'
      ? ['watched', 'planned', 'paused', 'dropped']
      : activeSection === 'games'
        ? ['watched', 'watching', 'planned', 'live', 'paused', 'dropped']
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
    pendingImportRows = [];
    clearImportPreview();
  } finally {
    importBusy = false;
  }
}
