/* v953: Movies-only "Rate by Matchups" private ladder game uses every title in each rating band. */
(function initShelfdMovieRatingDuel() {
  if (window.__shelfdMovieRatingDuelV953) return;
  window.__shelfdMovieRatingDuelV953 = true;

  let duelScrollY = 0;
  let duelState = null;

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

  function buildMovieDuelSession(itemId = '') {
    const targetItem = getMovieDuelTargetById(itemId);
    if (!targetItem) {
      throw new Error('Choose a watched movie from your library first.');
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
      rounds: []
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
    const options = getMovieDuelOptionsHtml();
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
        <label class="movie-duel-field">
          <span>Movie from watched</span>
          <select id="movie-duel-select">
            <option value="">Choose a watched movie</option>
            ${options}
          </select>
        </label>
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

  function renderMovieRatingDuelResult(resultBand, defeatedBand) {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay || !duelState?.targetItem) return;
    const summary = defeatedBand
      ? `It cleared through ${Math.max(1, Math.min(10, defeatedBand - 1))}/10 and stopped at ${defeatedBand}/10.`
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
        <div class="movie-duel-result-note">Nothing was saved to your library.</div>
      </div>
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
    overlay.querySelector('.movie-duel-sheet').innerHTML = getLauncherBodyHtml('');
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
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
      setMovieDuelStatus('Choose a watched movie first.');
      return;
    }
    try {
      duelState = buildMovieDuelSession(selectedId);
      renderMovieRatingDuelRound();
    } catch (error) {
      setMovieDuelStatus(error?.message || 'Could not start this matchup game.');
    }
  }

  function finishMovieRatingDuel(resultBand, defeatedBand = 0) {
    const finalBand = Math.max(1, Math.min(10, Number(resultBand || 0) || 1));
    renderMovieRatingDuelResult(finalBand, defeatedBand);
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
      finishMovieRatingDuel(duelState.currentBand - 1, duelState.currentBand);
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
      finishMovieRatingDuel(derivedTopBand, 0);
      return;
    }

    const nextBandState = getBandState(duelState.targetItem, duelState.itemsByBand, nextBand);
    if (!nextBandState.currentOpponent) {
      const derivedTopBand = nextBand >= 10 ? 10 : Math.min(10, nextBand + 1);
      finishMovieRatingDuel(derivedTopBand, 0);
      return;
    }

    duelState.currentBand = nextBand;
    duelState.currentBandOpponents = nextBandState.opponents;
    duelState.currentOpponentIndex = nextBandState.opponentIndex;
    duelState.currentOpponent = nextBandState.currentOpponent;
    renderMovieRatingDuelRound();
  }

  window.openMovieRatingDuelLauncher = openMovieRatingDuelLauncher;
  window.closeMovieRatingDuel = closeMovieRatingDuel;
  window.startMovieRatingDuel = startMovieRatingDuel;
  window.chooseMovieRatingDuelWinner = chooseMovieRatingDuelWinner;
})();
