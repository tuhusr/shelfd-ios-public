/* v943: Tracker.gg competitive account linking framework. */
(function initScreenListTrackerLinking() {
  if (window.__screenListTrackerLinkingV943) return;
  window.__screenListTrackerLinkingV943 = true;

  const TRACKER_LINKED_ACCOUNTS_URL = 'https://tracker.gg/account/linked-accounts';
  const TRACKER_GAME_CONFIGS = [
    { key: 'valorant', label: 'Valorant', aliases: ['valorant'], profileKind: 'riot', profileBase: 'https://tracker.gg/valorant/profile/riot/' },
    { key: 'marvel-rivals', label: 'Marvel Rivals', aliases: ['marvel rivals', 'marvelrivals'], profileKind: 'ign', profileBase: 'https://tracker.gg/marvel-rivals/profile/ign/' },
    { key: 'apex', label: 'Apex Legends', aliases: ['apex legends', 'apex'], profileKind: 'platform', profileBase: 'https://tracker.gg/apex/profile/' },
    { key: 'the-division-2', label: 'The Division 2', aliases: ['the division 2', 'division 2'], profileKind: 'platform', profileBase: 'https://tracker.gg/division-2/profile/' },
    { key: 'fortnite', label: 'Fortnite', aliases: ['fortnite'], profileKind: 'epic', profileBase: 'https://tracker.gg/fortnite/profile/all/' },
    { key: 'rocket-league', label: 'Rocket League', aliases: ['rocket league'], profileKind: 'platform', profileBase: 'https://tracker.gg/rocket-league/profile/' },
    { key: 'cs2', label: 'Counter-Strike 2', aliases: ['counter strike 2', 'counter-strike 2', 'cs2', 'counter strike'], profileKind: 'steam', profileBase: 'https://tracker.gg/cs2/profile/steam/' }
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

  function normalizeKey(value = '') {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizePercent(value = '') {
    const clean = cleanText(value).replace(/%/g, '');
    if (!clean) return '';
    const numeric = Number(clean);
    if (!Number.isFinite(numeric)) return cleanText(value);
    return `${Math.max(0, Math.min(100, Math.round(numeric * 10) / 10))}%`;
  }

  function normalizeDecimal(value = '') {
    const clean = cleanText(value);
    if (!clean) return '';
    const numeric = Number(clean.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(numeric)) return clean;
    return String(Math.round(numeric * 100) / 100);
  }

  function normalizeUrl(value = '') {
    const clean = cleanText(value);
    if (!clean) return '';
    if (/^https?:\/\//i.test(clean)) return clean;
    if (/tracker\.gg\//i.test(clean)) return `https://${clean.replace(/^\/+/, '')}`;
    return clean;
  }

  function getConfigByKey(key = '') {
    const clean = normalizeKey(key).replace(/\s+/g, '-');
    if (clean === 'division-2') return TRACKER_GAME_CONFIGS.find(config => config.key === 'the-division-2') || null;
    if (clean === 'csgo') return TRACKER_GAME_CONFIGS.find(config => config.key === 'cs2') || null;
    return TRACKER_GAME_CONFIGS.find(config => config.key === clean) || null;
  }

  function getConfigForTitle(title = '') {
    const normalized = normalizeKey(title);
    if (!normalized) return TRACKER_GAME_CONFIGS[0];
    return TRACKER_GAME_CONFIGS.find(config =>
      config.aliases.some(alias => normalized.includes(normalizeKey(alias)))
    ) || TRACKER_GAME_CONFIGS[0];
  }

  function parseTrackerGameFromUrl(url = '') {
    try {
      const parsed = new URL(normalizeUrl(url));
      if (!/tracker\.gg$/i.test(parsed.hostname.replace(/^www\./, ''))) return null;
      const first = parsed.pathname.split('/').filter(Boolean)[0] || '';
      return getConfigByKey(first) || TRACKER_GAME_CONFIGS.find(config => first === config.key);
    } catch (e) {
      return null;
    }
  }

  function buildTrackerProfileUrl(gameKey = '', account = '', platform = '') {
    const direct = normalizeUrl(account);
    if (/^https?:\/\//i.test(direct)) return direct;
    const cleanAccount = cleanText(account);
    if (!cleanAccount) return '';
    const config = getConfigByKey(gameKey) || TRACKER_GAME_CONFIGS[0];
    const encoded = encodeURIComponent(cleanAccount);
    if (config.profileKind === 'platform') {
      const cleanPlatform = cleanText(platform || 'pc').toLowerCase();
      return `${config.profileBase}${encodeURIComponent(cleanPlatform)}/${encoded}`;
    }
    return `${config.profileBase}${encoded}`;
  }

  function getOwnGameItems() {
    const list = Array.isArray(window.data?.games) ? window.data.games : [];
    return list.map((item, index) => ({ item, index, id: getGameItemKey(item, index) }));
  }

  function getGameItemKey(item = {}, index = 0) {
    return cleanText(item.id || item.rawgId || item.metacriticSlug || item.rawgSlug || item.backloggdSlug || item.title || `game-${index}`);
  }

  function findGameRecord(itemId = '') {
    const clean = cleanText(itemId);
    const games = getOwnGameItems();
    return games.find(row => row.id === clean || cleanText(row.item?.id) === clean) || null;
  }

  function getTrackerSnapshot(item = {}) {
    const stats = item?.competitiveStats && typeof item.competitiveStats === 'object'
      ? item.competitiveStats
      : {};
    const linked = item?.trackerAccount && typeof item.trackerAccount === 'object'
      ? item.trackerAccount
      : {};
    const sourceUrl = normalizeUrl(
      stats.sourceUrl ||
      linked.profileUrl ||
      item.gameTrackerUrl ||
      item.gameStatsUrl ||
      item.trackerStatsUrl ||
      item.trackerUrl ||
      item.statsUrl ||
      ''
    );
    const config = getConfigByKey(stats.gameSlug || linked.gameSlug || item.trackerGameSlug || '')
      || parseTrackerGameFromUrl(sourceUrl)
      || getConfigForTitle(item.title || '');
    return {
      provider: 'tracker.gg',
      gameSlug: config?.key || 'valorant',
      gameLabel: config?.label || 'Tracker.gg',
      displayName: cleanText(stats.displayName || linked.displayName || item.trackerAccountName || ''),
      currentRank: cleanText(stats.currentRank || item.currentRank || ''),
      peakRank: cleanText(stats.peakRank || item.peakRank || ''),
      winRate: cleanText(stats.winRate || stats.winPercentage || item.winRate || ''),
      kd: cleanText(stats.kd || stats.kdRatio || item.kd || ''),
      sourceUrl,
      linkedAt: stats.linkedAt || linked.linkedAt || '',
      updatedAt: stats.updatedAt || linked.updatedAt || '',
      syncMode: stats.syncMode || linked.syncMode || (sourceUrl ? 'profile-link' : '')
    };
  }

  function hasUsefulStat(snapshot = {}) {
    return !!(snapshot.currentRank || snapshot.peakRank || snapshot.winRate || snapshot.kd);
  }

  function hasTrackerBreakdownForItem(item = {}) {
    const snapshot = getTrackerSnapshot(item);
    return !!(snapshot.sourceUrl || snapshot.displayName || hasUsefulStat(snapshot));
  }

  function formatTrackerUpdated(value = '') {
    if (!value) return '';
    try {
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function renderStatCell(label, value) {
    return `
      <span class="tracker-stat-cell">
        <span>${html(label)}</span>
        <strong>${html(value || '-')}</strong>
      </span>
    `;
  }

  function renderTrackerStatsCardHtml(item = {}) {
    const snapshot = getTrackerSnapshot(item);
    if (!hasTrackerBreakdownForItem(item)) return '';
    const stats = [
      renderStatCell('Rank', snapshot.currentRank),
      renderStatCell('Peak', snapshot.peakRank),
      renderStatCell('Win', snapshot.winRate),
      renderStatCell('K/D', snapshot.kd)
    ].join('');
    const account = snapshot.displayName || snapshot.gameLabel;
    return `
      <button class="tracker-card-strip" type="button" onclick="openTrackerStatsPage(event,'${attr(getGameItemKey(item))}')" aria-label="Open Tracker.gg stats for ${attr(item.title || 'this game')}">
        <span class="tracker-card-strip-head">
          <span class="tracker-card-provider">Tracker.gg</span>
          <span class="tracker-card-account">${html(account)}</span>
        </span>
        <span class="tracker-card-stat-grid">${stats}</span>
      </button>
    `;
  }

  function getGameOptionsHtml(selectedId = '') {
    const games = getOwnGameItems();
    if (!games.length) return '<option value="">No games in My Lists</option>';
    return games.map(({ item, id }) => {
      const title = cleanText(item.title || 'Untitled game');
      return `<option value="${attr(id)}"${id === selectedId ? ' selected' : ''}>${html(title)}</option>`;
    }).join('');
  }

  function getSelectedModalItem() {
    const select = document.getElementById('tracker-link-game-select');
    const itemId = cleanText(select?.value || '');
    const record = findGameRecord(itemId);
    return record?.item || null;
  }

  function syncTrackerModalGameDefaults() {
    const item = getSelectedModalItem();
    if (!item) return;
    const snapshot = getTrackerSnapshot(item);
    const config = getConfigByKey(snapshot.gameSlug) || getConfigForTitle(item.title || '');
    const gameSelect = document.getElementById('tracker-link-game-kind');
    const accountInput = document.getElementById('tracker-link-account');
    const currentRank = document.getElementById('tracker-link-current-rank');
    const peakRank = document.getElementById('tracker-link-peak-rank');
    const winRate = document.getElementById('tracker-link-win-rate');
    const kd = document.getElementById('tracker-link-kd');
    const platform = document.getElementById('tracker-link-platform');
    if (gameSelect) gameSelect.value = config.key;
    if (accountInput) accountInput.value = snapshot.sourceUrl || snapshot.displayName || '';
    if (currentRank) currentRank.value = snapshot.currentRank || '';
    if (peakRank) peakRank.value = snapshot.peakRank || '';
    if (winRate) winRate.value = snapshot.winRate || '';
    if (kd) kd.value = snapshot.kd || '';
    if (platform) platform.value = item.gamePlatform || item.platform || 'pc';
  }

  function getTrackerGameSelectHtml(selected = '') {
    const selectedKey = getConfigByKey(selected)?.key || selected || 'valorant';
    return TRACKER_GAME_CONFIGS.map(config =>
      `<option value="${attr(config.key)}"${config.key === selectedKey ? ' selected' : ''}>${html(config.label)}</option>`
    ).join('');
  }

  function openTrackerLinkModal(options = {}) {
    if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
    const previous = document.getElementById('tracker-link-overlay');
    if (previous) previous.remove();

    const games = getOwnGameItems();
    const requestedId = cleanText(options.itemId || '');
    const selected = requestedId && games.some(row => row.id === requestedId)
      ? requestedId
      : (games.find(row => hasTrackerBreakdownForItem(row.item))?.id || games[0]?.id || '');
    const selectedItem = findGameRecord(selected)?.item || null;
    const snapshot = selectedItem ? getTrackerSnapshot(selectedItem) : {};
    const config = getConfigByKey(snapshot.gameSlug) || getConfigForTitle(selectedItem?.title || '');

    const overlay = document.createElement('div');
    overlay.id = 'tracker-link-overlay';
    overlay.className = 'tracker-link-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="tracker-link-backdrop" data-tracker-close></div>
      <div class="tracker-link-sheet">
        <div class="tracker-link-handle" aria-hidden="true"></div>
        <div class="tracker-link-top">
          <div>
            <div class="tracker-link-kicker">Competitive</div>
            <h2>Link Tracker.gg</h2>
          </div>
          <button class="tracker-link-close" type="button" data-tracker-close aria-label="Close">x</button>
        </div>
        <div class="tracker-link-copy">Connect a public Tracker.gg profile to a game in My Lists and save the stats Shelfd should show on the title card.</div>
        <div class="tracker-link-form">
          <label class="tracker-link-field tracker-link-field-wide">
            <span>Game in My Lists</span>
            <select id="tracker-link-game-select" onchange="syncTrackerModalGameDefaults()">${getGameOptionsHtml(selected)}</select>
          </label>
          <label class="tracker-link-field">
            <span>Tracker title</span>
            <select id="tracker-link-game-kind">${getTrackerGameSelectHtml(config.key)}</select>
          </label>
          <label class="tracker-link-field">
            <span>Platform</span>
            <input id="tracker-link-platform" type="text" value="${attr(selectedItem?.gamePlatform || selectedItem?.platform || 'pc')}" placeholder="pc">
          </label>
          <label class="tracker-link-field tracker-link-field-wide">
            <span>Profile URL or account</span>
            <input id="tracker-link-account" type="text" value="${attr(snapshot.sourceUrl || snapshot.displayName || '')}" placeholder="Riot ID, gamertag, or tracker.gg URL">
          </label>
          <label class="tracker-link-field">
            <span>Current rank</span>
            <input id="tracker-link-current-rank" type="text" value="${attr(snapshot.currentRank || '')}" placeholder="Diamond 2">
          </label>
          <label class="tracker-link-field">
            <span>Peak rank</span>
            <input id="tracker-link-peak-rank" type="text" value="${attr(snapshot.peakRank || '')}" placeholder="Ascendant 1">
          </label>
          <label class="tracker-link-field">
            <span>Win %</span>
            <input id="tracker-link-win-rate" type="text" inputmode="decimal" value="${attr(snapshot.winRate || '')}" placeholder="54.2%">
          </label>
          <label class="tracker-link-field">
            <span>K/D</span>
            <input id="tracker-link-kd" type="text" inputmode="decimal" value="${attr(snapshot.kd || '')}" placeholder="1.18">
          </label>
        </div>
        <div id="tracker-link-status" class="tracker-link-status" aria-live="polite"></div>
        <div class="tracker-link-actions">
          <button class="tracker-link-secondary" type="button" onclick="openTrackerAccountSignIn()">Open Tracker.gg sign in</button>
          <button class="tracker-link-secondary" type="button" onclick="syncScreenListTrackerStats(this)">Sync API</button>
          <button class="tracker-link-primary" type="button" onclick="saveScreenListTrackerLink(this)">Save link</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('tracker-link-open');
    overlay.addEventListener('click', event => {
      if (event.target?.closest?.('[data-tracker-close]')) closeTrackerLinkModal();
    });
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function closeTrackerLinkModal() {
    const overlay = document.getElementById('tracker-link-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.classList.remove('tracker-link-open');
    setTimeout(() => overlay.remove(), 220);
  }

  function setTrackerLinkStatus(message = '', kind = '') {
    const el = document.getElementById('tracker-link-status');
    if (!el) return;
    el.className = ['tracker-link-status', kind ? `tracker-link-status-${kind}` : ''].filter(Boolean).join(' ');
    el.textContent = message;
  }

  function openTrackerAccountSignIn() {
    window.open(TRACKER_LINKED_ACCOUNTS_URL, '_blank', 'noopener');
  }

  function getTrackerIdentifierFromInput(value = '') {
    const clean = cleanText(value);
    if (!clean) return '';
    try {
      const parsed = new URL(normalizeUrl(clean));
      const parts = parsed.pathname.split('/').filter(Boolean);
      const profileIndex = parts.findIndex(part => part.toLowerCase() === 'profile');
      if (profileIndex >= 0 && parts[profileIndex + 2]) {
        return decodeURIComponent(parts[profileIndex + 2]);
      }
      const ignored = new Set(['overview', 'matches', 'performance', 'agents', 'heroes', 'weapons', 'maps']);
      const terminal = [...parts].reverse().find(part => !ignored.has(part.toLowerCase())) || '';
      return decodeURIComponent(terminal);
    } catch (e) {
      return clean;
    }
  }

  async function syncScreenListTrackerStats(button = null) {
    const game = cleanText(document.getElementById('tracker-link-game-kind')?.value || '');
    const platform = cleanText(document.getElementById('tracker-link-platform')?.value || 'pc');
    const account = cleanText(document.getElementById('tracker-link-account')?.value || '');
    const identifier = getTrackerIdentifierFromInput(account);
    if (!game || !identifier) {
      setTrackerLinkStatus('Add a game and account before syncing.', 'error');
      return;
    }
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent || 'Sync API';
      button.textContent = 'Syncing';
    }
    try {
      const params = new URLSearchParams({ game, platform, identifier });
      const res = await fetch(`/api/trackergg/profile?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setTrackerLinkStatus(json?.error || 'Tracker.gg sync is not available for this title yet.', json?.unsupported ? '' : 'error');
        return;
      }
      const profile = json.profile || {};
      const currentRank = document.getElementById('tracker-link-current-rank');
      const peakRank = document.getElementById('tracker-link-peak-rank');
      const winRate = document.getElementById('tracker-link-win-rate');
      const kd = document.getElementById('tracker-link-kd');
      if (currentRank && profile.currentRank) currentRank.value = profile.currentRank;
      if (peakRank && profile.peakRank) peakRank.value = profile.peakRank;
      if (winRate && profile.winRate) winRate.value = profile.winRate;
      if (kd && profile.kd) kd.value = profile.kd;
      setTrackerLinkStatus('Tracker.gg stats synced. Save the link to attach them.', '');
    } catch (error) {
      console.warn('Tracker.gg sync failed:', error);
      setTrackerLinkStatus('Could not reach Tracker.gg sync. You can still save the profile snapshot.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Sync API';
      }
    }
  }

  async function saveScreenListTrackerLink(button = null) {
    if (!currentUser || viewingUser) return;
    const gameId = cleanText(document.getElementById('tracker-link-game-select')?.value || '');
    const record = findGameRecord(gameId);
    if (!record) {
      setTrackerLinkStatus('Choose a game from My Lists first.', 'error');
      return;
    }

    const gameKey = cleanText(document.getElementById('tracker-link-game-kind')?.value || '');
    const platform = cleanText(document.getElementById('tracker-link-platform')?.value || 'pc');
    const accountRaw = cleanText(document.getElementById('tracker-link-account')?.value || '');
    const configFromUrl = parseTrackerGameFromUrl(accountRaw);
    const config = configFromUrl || getConfigByKey(gameKey) || getConfigForTitle(record.item?.title || '');
    const profileUrl = buildTrackerProfileUrl(config.key, accountRaw, platform);
    const parsedIdentifier = getTrackerIdentifierFromInput(accountRaw);
    const displayName = /^https?:\/\//i.test(normalizeUrl(accountRaw))
      ? cleanText(parsedIdentifier || record.item?.trackerAccountName || record.item?.title || '')
      : accountRaw;
    const now = new Date().toISOString();
    const snapshot = {
      provider: 'tracker.gg',
      gameSlug: config.key,
      gameLabel: config.label,
      displayName,
      platform,
      currentRank: cleanText(document.getElementById('tracker-link-current-rank')?.value || ''),
      peakRank: cleanText(document.getElementById('tracker-link-peak-rank')?.value || ''),
      winRate: normalizePercent(document.getElementById('tracker-link-win-rate')?.value || ''),
      kd: normalizeDecimal(document.getElementById('tracker-link-kd')?.value || ''),
      sourceUrl: profileUrl,
      syncMode: 'profile-link-snapshot',
      linkedAt: record.item?.competitiveStats?.linkedAt || now,
      updatedAt: now
    };

    if (!snapshot.sourceUrl && !snapshot.displayName) {
      setTrackerLinkStatus('Add a Tracker.gg profile URL or account name.', 'error');
      return;
    }

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent || 'Save link';
      button.textContent = 'Saving';
    }

    try {
      const nextData = typeof cloneListData === 'function'
        ? cloneListData(data)
        : JSON.parse(JSON.stringify(data || { games: [] }));
      if (!Array.isArray(nextData.games)) nextData.games = [];
      const nextIndex = nextData.games.findIndex((item, index) => getGameItemKey(item, index) === record.id || cleanText(item?.id) === record.id);
      if (nextIndex < 0) throw new Error('Game not found.');
      nextData.games[nextIndex] = {
        ...nextData.games[nextIndex],
        status: 'competitive',
        trackerProvider: 'tracker.gg',
        trackerGameSlug: config.key,
        trackerAccountName: displayName,
        trackerAccount: {
          provider: 'tracker.gg',
          gameSlug: config.key,
          gameLabel: config.label,
          displayName,
          platform,
          profileUrl,
          linkedAt: snapshot.linkedAt,
          updatedAt: now
        },
        competitiveStats: snapshot,
        gameTrackerUrl: profileUrl,
        gameStatsUrl: profileUrl,
        trackerStatsUrl: profileUrl,
        trackerUrl: profileUrl,
        statsUrl: profileUrl,
        dateModified: now
      };

      if (typeof persistOwnListDataImmediate === 'function') {
        await persistOwnListDataImmediate(nextData);
      } else {
        data = typeof normalizeListData === 'function' ? normalizeListData(nextData) : nextData;
        if (typeof save === 'function') save();
      }
      closeTrackerLinkModal();
      if (typeof render === 'function') render();
      if (typeof showToast === 'function') showToast('Tracker.gg linked');
    } catch (error) {
      console.warn('Tracker.gg link save failed:', error);
      setTrackerLinkStatus('Could not save the Tracker.gg link. Try again.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Save link';
      }
    }
  }

  function openTrackerStatsPage(event = null, itemId = '') {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const record = findGameRecord(itemId);
    const item = record?.item;
    if (!item) return;
    const snapshot = getTrackerSnapshot(item);
    if (!hasTrackerBreakdownForItem(item)) {
      openTrackerLinkModal({ itemId: record.id });
      return;
    }
    const previous = document.getElementById('tracker-stats-page');
    if (previous) previous.remove();
    const poster = typeof getScreenListDisplayGameCover === 'function'
      ? getScreenListDisplayGameCover(item)
      : (item.cover || item.igdbCoverUrl || '');
    const updated = formatTrackerUpdated(snapshot.updatedAt);
    const overlay = document.createElement('div');
    overlay.id = 'tracker-stats-page';
    overlay.className = 'tracker-stats-page';
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `
      <div class="tracker-stats-shell">
        <div class="tracker-stats-topbar">
          <button class="tracker-stats-back" type="button" onclick="closeTrackerStatsPage()" aria-label="Back">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"></path></svg>
          </button>
          <div>
            <div class="tracker-stats-kicker">${html(snapshot.gameLabel)}</div>
            <h2>${html(item.title || 'Game stats')}</h2>
          </div>
          <button class="tracker-stats-edit" type="button" onclick="openTrackerLinkModal({ itemId: '${attr(record.id)}' })">Edit</button>
        </div>
        <div class="tracker-stats-hero">
          <div class="tracker-stats-poster" style="${poster ? `background-image:url('${attr(poster)}')` : ''}">${poster ? '' : html((item.title || 'G').slice(0, 1))}</div>
          <div class="tracker-stats-summary">
            <div class="tracker-stats-provider">Tracker.gg</div>
            <div class="tracker-stats-account">${html(snapshot.displayName || 'Linked profile')}</div>
            ${snapshot.sourceUrl ? `<a class="tracker-stats-open" href="${attr(snapshot.sourceUrl)}" target="_blank" rel="noopener">Open profile</a>` : ''}
            ${updated ? `<div class="tracker-stats-updated">Updated ${html(updated)}</div>` : ''}
          </div>
        </div>
        <div class="tracker-stats-grid">
          ${renderStatCell('Current Rank', snapshot.currentRank)}
          ${renderStatCell('Peak Rank', snapshot.peakRank)}
          ${renderStatCell('Win %', snapshot.winRate)}
          ${renderStatCell('K/D', snapshot.kd)}
        </div>
        <div class="tracker-stats-note">Stats are saved to this Shelfd title so the card loads instantly on mobile.</div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('tracker-stats-open');
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function closeTrackerStatsPage() {
    const overlay = document.getElementById('tracker-stats-page');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.classList.remove('tracker-stats-open');
    setTimeout(() => overlay.remove(), 220);
  }

  function handleGameCardSurfaceClick(event = null, itemId = '') {
    const target = event?.target;
    if (!target) return;
    if (target.closest('button,a,input,select,textarea,label,.card-cover,.game-details-panel,.game-card-comment-drop,.ep-list')) return;
    const record = findGameRecord(itemId);
    if (!record || !hasTrackerBreakdownForItem(record.item)) return;
    openTrackerStatsPage(event, record.id);
  }

  window.renderScreenListCompetitiveStatsCardHtml = renderTrackerStatsCardHtml;
  window.hasScreenListTrackerBreakdownForItem = hasTrackerBreakdownForItem;
  window.handleScreenListGameCardSurfaceClick = handleGameCardSurfaceClick;
  window.openTrackerLinkModal = openTrackerLinkModal;
  window.closeTrackerLinkModal = closeTrackerLinkModal;
  window.saveScreenListTrackerLink = saveScreenListTrackerLink;
  window.syncScreenListTrackerStats = syncScreenListTrackerStats;
  window.openTrackerStatsPage = openTrackerStatsPage;
  window.closeTrackerStatsPage = closeTrackerStatsPage;
  window.openTrackerAccountSignIn = openTrackerAccountSignIn;
  window.syncTrackerModalGameDefaults = syncTrackerModalGameDefaults;
})();
