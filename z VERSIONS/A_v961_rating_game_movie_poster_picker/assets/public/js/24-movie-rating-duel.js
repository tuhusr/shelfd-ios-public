/* v961: Movies-only matchup game uses an in-app poster picker instead of a native select. */
(function initShelfdMovieRatingDuel() {
  if (window.__shelfdMovieRatingDuelV961) return;
  window.__shelfdMovieRatingDuelV961 = true;

  let duelScrollY = 0;
  let duelState = null;
  let duelSelectedMovieId = '';
  const TIER_ROWS = [
    { key: 'S', rating: 10, label: 'S Tier', meta: '10 ratings' },
    { key: 'A', rating: 9, label: 'A Tier', meta: '9 ratings' },
    { key: 'B', rating: 8, label: 'B Tier', meta: '8 ratings' },
    { key: 'C', rating: 7, label: 'C Tier', meta: '7 ratings' },
    { key: 'D', rating: 6, label: 'D Tier', meta: '6 ratings' },
    { key: 'F', rating: 5, label: 'F Tier', meta: '5 and below' }
  ];

  function html(value = '') {
    if (typeof escHtml === 'function') return escHtml(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  function attr(value = '') {
    if (typeof escAttr === 'function') return escAttr(value);
    return html(value);
  }

  function cleanText(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function clampRating(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.max(1, Math.min(10, Math.round(numeric)));
  }

  function getTierKeyForRating(value) {
    const rating = clampRating(value);
    if (rating >= 10) return 'S';
    if (rating === 9) return 'A';
    if (rating === 8) return 'B';
    if (rating === 7) return 'C';
    if (rating === 6) return 'D';
    return 'F';
  }

  function getMovieTierItemId(item = {}) {
    return cleanText(item.id || item.tmdbId || item.imdbId || item.title || '');
  }

  function getOwnWatchedMoviesForDuel() {
    if (viewingUser) return [];
    const source = typeof getVisibleListData === 'function' ? getVisibleListData() : data;
    const movies = Array.isArray(source?.movies) ? source.movies : [];
    return movies.filter(item => item && item.status === 'watched');
  }

  function getMoviePoster(item = {}) {
    if (typeof getMyListPosterUrlForItem === 'function') return getMyListPosterUrlForItem(item, 'movies');
    return String(item.cover || item.poster || item.image || '').trim();
  }

  function makeTierEntry(item = {}, ratingOverride = null) {
    const rating = clampRating(ratingOverride ?? item.rating);
    return {
      id: getMovieTierItemId(item),
      title: cleanText(item.title || 'Untitled movie'),
      poster: getMoviePoster(item),
      rating,
      tier: getTierKeyForRating(rating),
      updatedAt: new Date().toISOString()
    };
  }

  function getEmptyTierList() {
    return TIER_ROWS.reduce((acc, tier) => {
      acc[tier.key] = [];
      return acc;
    }, {});
  }

  function normalizeSavedTierList(raw = null) {
    const next = getEmptyTierList();
    const source = raw && typeof raw === 'object'
      ? (raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : raw)
      : {};
    TIER_ROWS.forEach(tier => {
      const entries = Array.isArray(source[tier.key]) ? source[tier.key] : [];
      next[tier.key] = entries
        .map(entry => ({
          id: cleanText(entry?.id || entry?.tmdbId || entry?.title || ''),
          title: cleanText(entry?.title || 'Untitled movie'),
          poster: cleanText(entry?.poster || entry?.cover || entry?.image || ''),
          rating: clampRating(entry?.rating || tier.rating),
          tier: tier.key,
          updatedAt: cleanText(entry?.updatedAt || '')
        }))
        .filter(entry => entry.id || entry.title);
    });
    return next;
  }

  function seedTierListFromLibrary(tierList = null) {
    const next = normalizeSavedTierList(tierList);
    const seen = new Set();
    TIER_ROWS.forEach(tier => {
      next[tier.key].forEach(entry => seen.add(entry.id || entry.title.toLowerCase()));
    });
    getOwnWatchedMoviesForDuel().forEach(item => {
      const rating = clampRating(item.rating);
      if (!rating) return;
      const entry = makeTierEntry(item, rating);
      const key = entry.id || entry.title.toLowerCase();
      if (!key || seen.has(key)) return;
      next[entry.tier].push(entry);
      seen.add(key);
    });
    return next;
  }

  function getSavedMovieTierList() {
    return seedTierListFromLibrary(userProfile?.movieRatingTierList);
  }

  function removeTierEntryEverywhere(tierList, targetId = '') {
    const cleanId = cleanText(targetId);
    TIER_ROWS.forEach(tier => {
      tierList[tier.key] = (tierList[tier.key] || []).filter(entry => cleanText(entry.id || '') !== cleanId);
    });
  }

  function insertTierEntryAfter(tierList, targetEntry, anchorEntry = null) {
    if (!targetEntry?.id) return tierList;
    const tierKey = getTierKeyForRating(targetEntry.rating);
    if (!Array.isArray(tierList[tierKey])) tierList[tierKey] = [];
    removeTierEntryEverywhere(tierList, targetEntry.id);
    const row = tierList[tierKey];
    const anchorId = cleanText(anchorEntry?.id || '');
    const anchorIndex = anchorId ? row.findIndex(entry => cleanText(entry.id || '') === anchorId) : -1;
    if (anchorIndex >= 0) {
      row.splice(anchorIndex + 1, 0, targetEntry);
    } else if (tierKey === 'S') {
      row.unshift(targetEntry);
    } else {
      row.push(targetEntry);
    }
    return tierList;
  }

  async function saveMovieTierList(tierList) {
    const payload = {
      version: 1,
      mediaType: 'movies',
      updatedAt: new Date().toISOString(),
      tiers: normalizeSavedTierList(tierList)
    };
    if (!userProfile) userProfile = {};
    userProfile.movieRatingTierList = payload;
    if (typeof saveProfileSettingsPatch === 'function') {
      await saveProfileSettingsPatch({ movieRatingTierList: payload });
    }
    return payload;
  }

  function sortMoviesForDuel(items = []) {
    return [...items].sort((a, b) => {
      const titleCompare = cleanText(a?.title || '').localeCompare(cleanText(b?.title || ''), undefined, { sensitivity: 'base' });
      if (titleCompare !== 0) return titleCompare;
      return cleanText(String(a?.id || '')).localeCompare(cleanText(String(b?.id || '')), undefined, { sensitivity: 'base' });
    });
  }

  function getOccupiedBands(itemsByBand = {}) {
    return Array.from({ length: 10 }, (_, idx) => idx + 1).filter(band => Array.isArray(itemsByBand[band]) && itemsByBand[band].length);
  }

  function getNearestOccupiedBand(occupiedBands = [], preferred = 6) {
    if (!occupiedBands.length) return 0;
    let best = occupiedBands[0];
    let bestDistance = Math.abs(best - preferred);
    occupiedBands.forEach(band => {
      const distance = Math.abs(band - preferred);
      if (distance < bestDistance || (distance === bestDistance && band > best)) {
        best = band;
        bestDistance = distance;
      }
    });
    return best;
  }

  function getFirstComparisonBand(baseBand, occupiedBands = []) {
    if (!occupiedBands.length) return 0;
    const higherOrEqual = occupiedBands.find(band => band >= baseBand);
    if (higherOrEqual) return higherOrEqual;
    return occupiedBands[occupiedBands.length - 1] || 0;
  }

  function getNextOccupiedBand(currentBand, occupiedBands = []) {
    return occupiedBands.find(band => band > currentBand) || 0;
  }

  function getOpponentsForBand(targetItem, itemsByBand = {}, band = 0) {
    return sortMoviesForDuel(itemsByBand[band] || []).filter(item => cleanText(item?.id || '') !== cleanText(targetItem?.id || ''));
  }

  function getBandState(targetItem, itemsByBand = {}, band = 0) {
    const opponents = getOpponentsForBand(targetItem, itemsByBand, band);
    return {
      band,
      opponents,
      opponentIndex: 0,
      currentOpponent: opponents[0] || null
    };
  }

  function getMovieDuelOptionsHtml(selectedId = '') {
    return sortMoviesForDuel(getOwnWatchedMoviesForDuel()).map(item => {
      const rating = clampRating(item.rating);
      const suffix = rating ? ` · ${rating}/10` : '';
      return `<option value="${attr(item.id || '')}"${cleanText(item.id || '') === cleanText(selectedId) ? ' selected' : ''}>${html(cleanText(item.title || 'Untitled movie') + suffix)}</option>`;
    }).join('');
  }

  function getMovieDuelTargetById(itemId = '') {
    const cleanId = cleanText(itemId);
    return getOwnWatchedMoviesForDuel().find(item => cleanText(item?.id || '') === cleanId) || null;
  }

  function getMoviesGroupedByRatingForPicker() {
    const grouped = new Map();
    for (let rating = 10; rating >= 1; rating -= 1) grouped.set(rating, []);
    sortMoviesForDuel(getOwnWatchedMoviesForDuel()).forEach(item => {
      const rating = clampRating(item.rating) || 0;
      const key = rating > 0 ? rating : 0;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    return Array.from(grouped.entries())
      .filter(([, items]) => items.length)
      .sort(([a], [b]) => b - a);
  }

  function renderMoviePickerPosterButton(item = {}) {
    const poster = getMoviePoster(item);
    const title = cleanText(item.title || 'Untitled movie');
    const itemId = cleanText(item.id || '');
    return `
      <button type="button" class="movie-duel-picker-poster-btn" data-movie-duel-id="${attr(itemId)}" onclick="selectMovieRatingDuelMovie(this.dataset.movieDuelId)">
        <span class="movie-duel-picker-poster-frame">
          ${poster ? `<img src="${attr(poster)}" alt="${attr(title)}" loading="eager" decoding="async">` : `<span class="movie-duel-picker-poster-fallback">${html(title.charAt(0).toUpperCase() || '?')}</span>`}
        </span>
      </button>
    `;
  }

  function renderMovieDuelPickerPage() {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay) return;
    overlay.classList.remove('has-tier-result');
    overlay.classList.add('has-movie-picker');
    const groups = getMoviesGroupedByRatingForPicker();
    overlay.querySelector('.movie-duel-sheet').innerHTML = `
      <div class="movie-duel-header movie-duel-picker-header">
        <div>
          <div class="movie-duel-kicker">Choose a movie</div>
          <h2>Choose a movie</h2>
        </div>
        <button type="button" class="movie-duel-close" onclick="openMovieRatingDuelLauncher()" aria-label="Back">Ã—</button>
      </div>
      <div class="movie-duel-picker-page">
        ${groups.map(([rating, items]) => `
          <section class="movie-duel-picker-rating-section">
            <div class="movie-duel-picker-rating-rule">
              <span>${html(rating ? `${rating}/10` : 'Unrated')}</span>
            </div>
            <div class="movie-duel-picker-grid">
              ${items.map(renderMoviePickerPosterButton).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    `;
  }

  function buildMovieDuelSession(itemId = '') {
    const targetItem = getMovieDuelTargetById(itemId);
    if (!targetItem) {
      throw new Error('Choose a movie first.');
    }
    const watchedMovies = getOwnWatchedMoviesForDuel();
    const ratedOpponents = watchedMovies.filter(item => cleanText(item?.id || '') !== cleanText(targetItem?.id || '') && clampRating(item.rating) > 0);
    if (ratedOpponents.length < 1) {
      throw new Error('You need at least one other rated watched movie to play this game.');
    }

    const itemsByBand = {};
    for (let band = 1; band <= 10; band += 1) itemsByBand[band] = [];
    ratedOpponents.forEach(item => {
      itemsByBand[clampRating(item.rating)].push(item);
    });

    const occupiedBands = getOccupiedBands(itemsByBand);
    const savedRating = clampRating(targetItem.rating);
    const baseBand = savedRating || getNearestOccupiedBand(occupiedBands, 6) || 6;
    const currentBand = getFirstComparisonBand(baseBand, occupiedBands);
    const currentBandState = getBandState(targetItem, itemsByBand, currentBand);
    if (!currentBand || !currentBandState.currentOpponent) {
      throw new Error('Not enough rated watched movies to build matchup rounds right now.');
    }

    return {
      targetItem,
      itemsByBand,
      occupiedBands,
      baseBand,
      currentBand,
      currentBandOpponents: currentBandState.opponents,
      currentOpponentIndex: currentBandState.opponentIndex,
      currentOpponent: currentBandState.currentOpponent,
      savedRating,
      rounds: [],
      finalTierList: null
    };
  }

  function lockMovieDuelScroll() {
    if (document.body.classList.contains('movie-rating-duel-open')) return;
    duelScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('movie-rating-duel-open');
    document.body.classList.add('movie-rating-duel-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${duelScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockMovieDuelScroll() {
    if (!document.body.classList.contains('movie-rating-duel-open')) return;
    const y = duelScrollY || Math.abs(parseInt(document.body.style.top || '0', 10)) || 0;
    document.documentElement.classList.remove('movie-rating-duel-open');
    document.body.classList.remove('movie-rating-duel-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, y);
    duelScrollY = 0;
  }

  function getLauncherBodyHtml(message = '') {
    const selectedMovie = getMovieDuelTargetById(duelSelectedMovieId);
    const selectedPoster = selectedMovie ? getMoviePoster(selectedMovie) : '';
    return `
      <div class="movie-duel-header">
        <div>
          <div class="movie-duel-kicker">Private Game</div>
          <h2>Rate by Matchups</h2>
          <p>Movies only for now. Pick one watched movie and test how high it climbs through your rated ladder.</p>
        </div>
        <button type="button" class="movie-duel-close" onclick="closeMovieRatingDuel()" aria-label="Close">×</button>
      </div>
      <div class="movie-duel-launcher">
        <input id="movie-duel-select" type="hidden" value="${attr(duelSelectedMovieId)}">
        <button type="button" class="movie-duel-picker-open-btn" onclick="openMovieRatingDuelPicker()">
          ${selectedMovie ? `
            <span class="movie-duel-picker-selected-poster">
              ${selectedPoster ? `<img src="${attr(selectedPoster)}" alt="${attr(selectedMovie.title || '')}" loading="eager" decoding="async">` : `<span>${html((selectedMovie.title || '?').charAt(0).toUpperCase())}</span>`}
            </span>
            <span class="movie-duel-picker-selected-copy">
              <strong>${html(selectedMovie.title || 'Untitled movie')}</strong>
              <em>${html(clampRating(selectedMovie.rating) ? `${clampRating(selectedMovie.rating)}/10` : 'Unrated')}</em>
            </span>
          ` : `<span class="movie-duel-picker-open-placeholder">Choose a movie</span>`}
        </button>
        <div class="movie-duel-launch-copy">
          The result stays private for now. It will not write back into your library.
        </div>
        <div id="movie-duel-status" class="movie-duel-status${message ? ' is-visible' : ''}">${html(message)}</div>
        <div class="movie-duel-actions">
          <button type="button" class="movie-duel-secondary" onclick="closeMovieRatingDuel()">Cancel</button>
          <button type="button" class="movie-duel-primary" onclick="startMovieRatingDuel()">Start Game</button>
        </div>
      </div>
    `;
  }

  function renderMovieOptionCard(item = {}, role = 'target') {
    const poster = getMoviePoster(item);
    const rating = clampRating(item.rating);
    const year = cleanText(item.year || item.release_date || item.first_air_date || '').slice(0, 4);
    return `
      <button type="button" class="movie-duel-option movie-duel-option-${attr(role)}" onclick="chooseMovieRatingDuelWinner('${attr(role)}')">
        <span class="movie-duel-option-poster-wrap">
          ${poster ? `<img class="movie-duel-option-poster" src="${attr(poster)}" alt="${attr(item.title || '')}" loading="eager" decoding="async">` : `<span class="movie-duel-option-poster movie-duel-option-poster-fallback">${html((item.title || '?').charAt(0).toUpperCase())}</span>`}
        </span>
        <span class="movie-duel-option-copy">
          <span class="movie-duel-option-title">${html(item.title || 'Untitled movie')}</span>
          <span class="movie-duel-option-meta">${html(year || (role === 'target' ? 'Your movie' : `Rated ${rating}/10`))}</span>
        </span>
      </button>
    `;
  }

  function renderMovieRatingDuelRound() {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay || !duelState?.targetItem || !duelState?.currentOpponent) return;
    overlay.classList.remove('has-tier-result');
    overlay.classList.remove('has-movie-picker');
    const compareBand = duelState.currentBand;
    const roundCount = duelState.rounds.length + 1;
    const bandSize = Array.isArray(duelState.currentBandOpponents) ? duelState.currentBandOpponents.length : 0;
    const bandIndex = Number(duelState.currentOpponentIndex || 0) + 1;
    overlay.querySelector('.movie-duel-sheet').innerHTML = `
      <div class="movie-duel-header">
        <div>
          <div class="movie-duel-kicker">Round ${html(roundCount)}</div>
          <h2>Would you rank this higher?</h2>
          <p>Beat every ${html(compareBand)}/10 title to clear this band. The first loss ends the run.</p>
        </div>
        <button type="button" class="movie-duel-close" onclick="closeMovieRatingDuel()" aria-label="Close">×</button>
      </div>
      <div class="movie-duel-band-chip">Testing ${html(compareBand)}/10 · ${html(bandIndex)} of ${html(bandSize || 1)}</div>
      <div class="movie-duel-versus">
        ${renderMovieOptionCard(duelState.targetItem, 'target')}
        <div class="movie-duel-or">OR</div>
        ${renderMovieOptionCard(duelState.currentOpponent, 'opponent')}
      </div>
      <div class="movie-duel-footnote">
        Pick the movie you would place higher in your personal ranking.
      </div>
    `;
  }

  function renderTierPoster(entry = {}) {
    const poster = cleanText(entry.poster || '');
    const title = cleanText(entry.title || 'Untitled movie');
    return `
      <div class="movie-duel-tier-poster" title="${attr(title)}">
        ${poster ? `<img src="${attr(poster)}" alt="${attr(title)}" loading="eager" decoding="async">` : `<span>${html(title.charAt(0).toUpperCase() || '?')}</span>`}
      </div>
    `;
  }

  function renderMovieDuelTierList(tierList = null, activeId = '') {
    const normalized = normalizeSavedTierList(tierList);
    return `
      <div class="movie-duel-tier-board">
        ${TIER_ROWS.map(tier => {
          const entries = normalized[tier.key] || [];
          return `
            <section class="movie-duel-tier-row movie-duel-tier-${attr(tier.key.toLowerCase())}">
              <div class="movie-duel-tier-label">
                <strong>${html(tier.key)}</strong>
                <span>${html(tier.meta)}</span>
              </div>
              <div class="movie-duel-tier-scroll" aria-label="${attr(tier.label)}">
                ${entries.length ? entries.map(entry => `
                  <div class="movie-duel-tier-item${cleanText(entry.id) === cleanText(activeId) ? ' is-new' : ''}">
                    ${renderTierPoster(entry)}
                  </div>
                `).join('') : `<div class="movie-duel-tier-empty">No movies yet</div>`}
              </div>
            </section>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderMovieRatingDuelResult(resultBand, defeatedBand, tierList = null) {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay || !duelState?.targetItem) return;
    overlay.classList.add('has-tier-result');
    const summary = defeatedBand
      ? `It landed in the ${getTierKeyForRating(resultBand)} tier, directly behind the ${defeatedBand}/10 movie that stopped it.`
      : 'It cleared every matchup in this run.';
    overlay.querySelector('.movie-duel-sheet').innerHTML = `
      <div class="movie-duel-header">
        <div>
          <div class="movie-duel-kicker">Result</div>
          <h2>${html(duelState.targetItem.title || 'This movie')}</h2>
          <p>${html(summary)}</p>
        </div>
        <button type="button" class="movie-duel-close" onclick="closeMovieRatingDuel()" aria-label="Close">×</button>
      </div>
      <div class="movie-duel-result-card">
        <div class="movie-duel-result-label">Your rating for this movie is a</div>
        <div class="movie-duel-result-score">${html(resultBand)}</div>
        <div class="movie-duel-result-note">Saved to your separate matchup tier list. Nothing changed in My Lists.</div>
      </div>
      ${renderMovieDuelTierList(tierList || duelState.finalTierList, getMovieTierItemId(duelState.targetItem))}
      <div class="movie-duel-actions movie-duel-actions-result">
        <button type="button" class="movie-duel-secondary" onclick="openMovieRatingDuelLauncher()">Pick Another Movie</button>
        <button type="button" class="movie-duel-primary" onclick="closeMovieRatingDuel()">Done</button>
      </div>
    `;
  }

  function setMovieDuelStatus(message = '') {
    const status = document.getElementById('movie-duel-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-visible', !!message);
  }

  function ensureMovieDuelOverlay() {
    let overlay = document.getElementById('movie-rating-duel-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'movie-rating-duel-overlay';
    overlay.className = 'movie-duel-overlay';
    overlay.innerHTML = `
      <div class="movie-duel-backdrop" data-movie-duel-close="1"></div>
      <div class="movie-duel-sheet"></div>
    `;
    overlay.addEventListener('click', event => {
      if (event.target?.closest?.('[data-movie-duel-close]')) closeMovieRatingDuel();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function openMovieRatingDuelLauncher() {
    if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
    if (viewingUser) {
      if (typeof showToast === 'function') showToast('Open your own My Lists to play this game');
      return;
    }
    const watchedMovies = getOwnWatchedMoviesForDuel();
    if (!watchedMovies.length) {
      if (typeof showToast === 'function') showToast('You need watched movies to play this game');
      return;
    }
    duelState = null;
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('has-tier-result');
    overlay.classList.remove('has-movie-picker');
    overlay.querySelector('.movie-duel-sheet').innerHTML = getLauncherBodyHtml('');
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function openMovieRatingDuelPicker() {
    const overlay = ensureMovieDuelOverlay();
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    renderMovieDuelPickerPage();
  }

  function selectMovieRatingDuelMovie(itemId = '') {
    duelSelectedMovieId = cleanText(itemId);
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('has-movie-picker');
    overlay.querySelector('.movie-duel-sheet').innerHTML = getLauncherBodyHtml('');
  }

  function closeMovieRatingDuel() {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    duelState = null;
    if (!overlay) {
      unlockMovieDuelScroll();
      return;
    }
    overlay.classList.remove('is-open');
    setTimeout(() => {
      overlay.remove();
      unlockMovieDuelScroll();
    }, 180);
  }

  function startMovieRatingDuel() {
    const selectedId = cleanText(document.getElementById('movie-duel-select')?.value || '');
    if (!selectedId) {
      setMovieDuelStatus('Choose a movie first.');
      return;
    }
    try {
      duelState = buildMovieDuelSession(selectedId);
      renderMovieRatingDuelRound();
    } catch (error) {
      setMovieDuelStatus(error?.message || 'Could not start this matchup game.');
    }
  }

  async function finishMovieRatingDuel(resultBand, defeatedBand = 0, anchorItem = null) {
    const finalBand = Math.max(1, Math.min(10, Number(resultBand || 0) || 1));
    const tierList = getSavedMovieTierList();
    const targetEntry = makeTierEntry(duelState?.targetItem || {}, finalBand);
    const anchorEntry = anchorItem ? makeTierEntry(anchorItem, finalBand) : null;
    insertTierEntryAfter(tierList, targetEntry, anchorEntry);
    duelState.finalTierList = tierList;
    renderMovieRatingDuelResult(finalBand, defeatedBand, tierList);
    try {
      await saveMovieTierList(tierList);
    } catch (error) {
      console.warn('Movie rating tier list save failed:', error);
      if (typeof showToast === 'function') showToast('Tier list saved locally, but sync failed');
    }
  }

  function chooseMovieRatingDuelWinner(choice = '') {
    if (!duelState?.targetItem || !duelState?.currentOpponent) return;
    const targetWon = choice === 'target';
    duelState.rounds.push({
      band: duelState.currentBand,
      winner: targetWon ? cleanText(duelState.targetItem.id || '') : cleanText(duelState.currentOpponent.id || ''),
      loser: targetWon ? cleanText(duelState.currentOpponent.id || '') : cleanText(duelState.targetItem.id || '')
    });

    if (!targetWon) {
      finishMovieRatingDuel(duelState.currentBand, duelState.currentBand, duelState.currentOpponent);
      return;
    }

    const nextOpponentIndex = Number(duelState.currentOpponentIndex || 0) + 1;
    const currentBandOpponents = Array.isArray(duelState.currentBandOpponents) ? duelState.currentBandOpponents : [];
    if (nextOpponentIndex < currentBandOpponents.length) {
      duelState.currentOpponentIndex = nextOpponentIndex;
      duelState.currentOpponent = currentBandOpponents[nextOpponentIndex] || null;
      renderMovieRatingDuelRound();
      return;
    }

    const nextBand = getNextOccupiedBand(duelState.currentBand, duelState.occupiedBands);
    if (!nextBand) {
      const derivedTopBand = duelState.currentBand >= 10 ? 10 : Math.min(10, duelState.currentBand + 1);
      finishMovieRatingDuel(derivedTopBand, 0, null);
      return;
    }

    const nextBandState = getBandState(duelState.targetItem, duelState.itemsByBand, nextBand);
    if (!nextBandState.currentOpponent) {
      const derivedTopBand = nextBand >= 10 ? 10 : Math.min(10, nextBand + 1);
      finishMovieRatingDuel(derivedTopBand, 0, null);
      return;
    }

    duelState.currentBand = nextBand;
    duelState.currentBandOpponents = nextBandState.opponents;
    duelState.currentOpponentIndex = nextBandState.opponentIndex;
    duelState.currentOpponent = nextBandState.currentOpponent;
    renderMovieRatingDuelRound();
  }

  window.openMovieRatingDuelLauncher = openMovieRatingDuelLauncher;
  window.openMovieRatingDuelPicker = openMovieRatingDuelPicker;
  window.selectMovieRatingDuelMovie = selectMovieRatingDuelMovie;
  window.closeMovieRatingDuel = closeMovieRatingDuel;
  window.startMovieRatingDuel = startMovieRatingDuel;
  window.chooseMovieRatingDuelWinner = chooseMovieRatingDuelWinner;
})();
