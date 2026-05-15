/* v949: Tracker.gg linking — manual stats for unsupported games (Valorant, Marvel Rivals, Fortnite, Rocket League). */
(function initScreenListTrackerLinking() {
  if (window.__screenListTrackerLinkingV951) return;
  window.__screenListTrackerLinkingV951 = true;

  const TRACKER_GAME_CONFIGS = [
    { key: 'valorant', label: 'Valorant', aliases: ['valorant'], profileKind: 'riot', profileBase: 'https://tracker.gg/valorant/profile/riot/' },
    { key: 'marvel-rivals', label: 'Marvel Rivals', aliases: ['marvel rivals', 'marvelrivals'], profileKind: 'ign', profileBase: 'https://tracker.gg/marvel-rivals/profile/ign/' },
    { key: 'apex', label: 'Apex Legends', aliases: ['apex legends', 'apex'], profileKind: 'platform', profileBase: 'https://tracker.gg/apex/profile/' },
    { key: 'the-division-2', label: 'The Division 2', aliases: ['the division 2', 'division 2'], profileKind: 'platform', profileBase: 'https://tracker.gg/division-2/profile/' },
    { key: 'fortnite', label: 'Fortnite', aliases: ['fortnite'], profileKind: 'epic', profileBase: 'https://tracker.gg/fortnite/profile/all/' },
    { key: 'rocket-league', label: 'Rocket League', aliases: ['rocket league'], profileKind: 'platform', profileBase: 'https://tracker.gg/rocket-league/profile/' },
    { key: 'cs2', label: 'Counter-Strike 2', aliases: ['counter strike 2', 'counter-strike 2', 'cs2', 'counter strike'], profileKind: 'steam', profileBase: 'https://tracker.gg/cs2/profile/steam/' }
  ];
  // Games not supported by the Tracker.gg public developer API — require manual stat entry
  const TRACKER_API_UNSUPPORTED_GAMES = new Set(['valorant', 'marvel-rivals', 'rocket-league', 'fortnite']);
  const VALORANT_RANK_SPRITES = {
    iron: [[0, 0], [1, 0], [2, 0]],
    bronze: [[3, 0], [4, 0], [5, 0]],
    silver: [[0, 1], [1, 1], [2, 1]],
    gold: [[3, 1], [4, 1], [5, 1]],
    diamond: [[0, 2], [1, 2], [2, 2]],
    ascendant: [[3, 2], [4, 2], [5, 2]],
    immortal: [[0, 3], [1, 3], [2, 3]],
    radiant: [[3, 3]]
  };
  let trackerModalFetchedStats = null;

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

  function isGameApiUnsupported(gameKey = '') {
    return TRACKER_API_UNSUPPORTED_GAMES.has(cleanText(gameKey).toLowerCase());
  }

  function getManualStatsFromModal() {
    return {
      currentRank: cleanText(document.getElementById('tracker-manual-rank')?.value || ''),
      peakRank: cleanText(document.getElementById('tracker-manual-peak')?.value || ''),
      winRate: normalizePercent(document.getElementById('tracker-manual-winrate')?.value || ''),
      kd: normalizeDecimal(document.getElementById('tracker-manual-kd')?.value || '')
    };
  }
  function setManualStatsFields(stats = {}) {
    const normalized = normalizeTrackerApiStats(stats);
    const rankInput = document.getElementById('tracker-manual-rank');
    const peakInput = document.getElementById('tracker-manual-peak');
    const winRateInput = document.getElementById('tracker-manual-winrate');
    const kdInput = document.getElementById('tracker-manual-kd');
    if (rankInput) rankInput.value = normalized.currentRank || '';
    if (peakInput) peakInput.value = normalized.peakRank || '';
    if (winRateInput) winRateInput.value = normalized.winRate || '';
    if (kdInput) kdInput.value = normalized.kd || '';
  }

  function applyTrackerUnsupportedUi(gameKey = '') {
    const unsupported = isGameApiUnsupported(gameKey);
    const apiSection = document.getElementById('tracker-api-section');
    const manualSection = document.getElementById('tracker-manual-section');
    const fetchBtn = document.querySelector('.tracker-fetch-btn');
    const copyEl = document.getElementById('tracker-link-copy-text');
    const statsLabel = document.getElementById('tracker-stats-mode-label');
    const noteEl = document.getElementById('tracker-auto-stats-note');
    if (apiSection) apiSection.style.display = unsupported ? 'none' : '';
    if (manualSection) manualSection.style.display = unsupported ? '' : 'none';
    if (fetchBtn) fetchBtn.style.display = unsupported ? 'none' : '';
    if (copyEl) copyEl.textContent = unsupported
      ? "This game isn't in the Tracker.gg public API. Paste your profile URL, then enter your stats manually — they'll show on the game card."
      : "Paste your Tracker.gg profile URL or handle. Shelfd fetches your rank, K/D, and win rate from the API and shows them on the game card.";
    if (unsupported && copyEl) copyEl.textContent = "This game isn't in the Tracker.gg public API. Paste your profile URL, then enter your stats manually so Shelfd can show them on the game card.";
    if (statsLabel) statsLabel.textContent = unsupported ? 'Manual stats' : 'API stats';
    if (noteEl) noteEl.textContent = unsupported ? 'Enter the stats you want saved to this game.' : 'Stats will be fetched from Tracker.gg.';
    return unsupported;
  }

  function onTrackerModalGameKindChange() {
    const gameKey = cleanText(document.getElementById('tracker-link-game-kind')?.value || '');
    applyTrackerUnsupportedUi(gameKey);
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
    const source = (typeof getVisibleListData === 'function')
      ? getVisibleListData()
      : (typeof data !== 'undefined' ? data : (window.data || {}));
    const list = Array.isArray(source?.games) ? source.games : [];
    return list.map((item, index) => ({ item, index, id: getGameItemKey(item, index) }));
  }

  function normalizeTrackerConnection(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const config = getConfigByKey(source.gameSlug || source.defaultGameSlug || '') || null;
    return {
      provider: 'tracker.gg',
      gameSlug: config?.key || cleanText(source.gameSlug || source.defaultGameSlug || ''),
      gameLabel: config?.label || cleanText(source.gameLabel || ''),
      displayName: cleanText(source.displayName || source.accountName || source.handle || ''),
      platform: cleanText(source.platform || 'pc'),
      profileUrl: normalizeUrl(source.profileUrl || source.sourceUrl || source.url || ''),
      connectedAt: cleanText(source.connectedAt || ''),
      updatedAt: cleanText(source.updatedAt || '')
    };
  }

  function getTrackerConnection() {
    const profile = typeof userProfile !== 'undefined' ? userProfile : {};
    return normalizeTrackerConnection(profile?.trackerConnection || {});
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

  function parseValorantRank(value = '') {
    const clean = cleanText(value).toLowerCase();
    if (!clean) return null;
    const compact = clean.replace(/[^a-z0-9]+/g, '');
    const tiers = [
      { key: 'iron', aliases: ['iron', 'i'], short: 'I' },
      { key: 'bronze', aliases: ['bronze', 'b'], short: 'B' },
      { key: 'silver', aliases: ['silver', 's'], short: 'S' },
      { key: 'gold', aliases: ['gold', 'g'], short: 'G' },
      { key: 'platinum', aliases: ['platinum', 'plat', 'p'], short: 'P' },
      { key: 'diamond', aliases: ['diamond', 'dia', 'd'], short: 'D' },
      { key: 'ascendant', aliases: ['ascendant', 'asc', 'a'], short: 'A' },
      { key: 'immortal', aliases: ['immortal', 'imm', 'im'], short: 'IM' },
      { key: 'radiant', aliases: ['radiant', 'rad', 'r'], short: 'RAD' }
    ];
    for (const tier of tiers) {
      const alias = tier.aliases.find(candidate => compact.startsWith(candidate));
      if (alias) {
        const remainder = compact.slice(alias.length).replace(/[^0-9]/g, '');
        let division = tier.key === 'radiant' ? '' : remainder;
        if (division) {
          const numeric = Number(division);
          division = Number.isFinite(numeric)
            ? String(Math.max(1, Math.min(3, numeric)))
            : '';
        }
        return {
          tier: tier.key,
          division,
          code: `${tier.short}${division}`.trim()
        };
      }
    }
    return null;
  }

  function getValorantRankSprite(rank = null) {
    if (!rank) return null;
    const variants = VALORANT_RANK_SPRITES[rank.tier];
    if (!Array.isArray(variants) || !variants.length) return null;
    if (!rank.division || variants.length === 1) {
      const [col, row] = variants[0];
      return { col, row };
    }
    const index = Math.max(0, Math.min(variants.length - 1, Number(rank.division || 1) - 1));
    const [col, row] = variants[index];
    return { col, row };
  }

  function renderValorantRankBadge(value = '') {
    const rank = parseValorantRank(value);
    const sprite = getValorantRankSprite(rank);
    if (!rank || !sprite) return html(value || '-');
    return `
      <span class="tracker-rank-badge tracker-rank-badge-${attr(rank.tier)}" aria-label="${attr(value)}">
        <span class="tracker-rank-sprite" aria-hidden="true" style="--tracker-rank-col:${sprite.col};--tracker-rank-row:${sprite.row};"></span>
        <span class="tracker-rank-code">${html(rank.code)}</span>
      </span>
    `;
  }

  function renderStatCell(label, value, options = {}) {
    const display = options.valorantRank ? renderValorantRankBadge(value) : html(value || '-');
    return `
      <span class="tracker-stat-cell">
        <span>${html(label)}</span>
        <strong>${display}</strong>
      </span>
    `;
  }

  function renderPreviewStatCell(key, label, value) {
    return `
      <span class="tracker-stat-cell tracker-preview-stat-cell">
        <span>${html(label)}</span>
        <strong data-tracker-stat-value="${attr(key)}">${html(value || '-')}</strong>
      </span>
    `;
  }

  function normalizeTrackerApiStats(profile = {}) {
    return {
      currentRank: cleanText(profile.currentRank || ''),
      peakRank: cleanText(profile.peakRank || ''),
      winRate: normalizePercent(profile.winRate || ''),
      kd: normalizeDecimal(profile.kd || '')
    };
  }

  function setTrackerStatsPreview(stats = {}, message = '') {
    const normalized = normalizeTrackerApiStats(stats);
    trackerModalFetchedStats = normalized;
    const overlay = document.getElementById('tracker-link-overlay');
    if (overlay) {
      overlay.dataset.trackerCurrentRank = normalized.currentRank;
      overlay.dataset.trackerPeakRank = normalized.peakRank;
      overlay.dataset.trackerWinRate = normalized.winRate;
      overlay.dataset.trackerKd = normalized.kd;
    }
    Object.entries(normalized).forEach(([key, value]) => {
      document.querySelectorAll(`[data-tracker-stat-value="${key}"]`).forEach(el => {
        el.textContent = value || '-';
      });
    });
    const note = document.getElementById('tracker-auto-stats-note');
    if (note && message) note.textContent = message;
    return normalized;
  }

  function renderTrackerStatsCardHtml(item = {}) {
    const snapshot = getTrackerSnapshot(item);
    if (!hasTrackerBreakdownForItem(item)) return '';
    const isValorant = snapshot.gameSlug === 'valorant';
    const stats = [
      renderStatCell('Rank', snapshot.currentRank, { valorantRank: isValorant }),
      renderStatCell('Peak', snapshot.peakRank, { valorantRank: isValorant }),
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
    const platform = document.getElementById('tracker-link-platform');
    if (gameSelect) gameSelect.value = config.key;
    if (accountInput) accountInput.value = snapshot.sourceUrl || snapshot.displayName || '';
    if (platform) platform.value = item.gamePlatform || item.platform || 'pc';
    setManualStatsFields(snapshot);
    setTrackerStatsPreview(snapshot, snapshot.updatedAt ? 'Current saved stats. Fetch again to refresh from Tracker.gg.' : 'Stats will be fetched from Tracker.gg.');
    applyTrackerUnsupportedUi(config.key);
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
    const connection = getTrackerConnection();
    const config = getConfigByKey(snapshot.gameSlug || connection.gameSlug) || getConfigForTitle(selectedItem?.title || '');
    const profileValue = snapshot.sourceUrl || connection.profileUrl || snapshot.displayName || connection.displayName || '';
    const platformValue = snapshot.platform || connection.platform || selectedItem?.gamePlatform || selectedItem?.platform || 'pc';
    trackerModalFetchedStats = normalizeTrackerApiStats(snapshot);

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
        <div id="tracker-link-copy-text" class="tracker-link-copy">Tracker.gg does not provide a Steam-style callback to Shelfd. Paste a public Tracker profile URL or handle, then Shelfd saves it as your connected competitive profile and attaches the stats to the selected game.</div>
        <div class="tracker-connection-card">
          <span>Connected profile</span>
          <strong>${html(connection.displayName || connection.profileUrl || 'Not connected')}</strong>
        </div>
        <div class="tracker-link-form">
          <label class="tracker-link-field tracker-link-field-wide">
            <span>Game in My Lists</span>
            <select id="tracker-link-game-select" onchange="syncTrackerModalGameDefaults()">${getGameOptionsHtml(selected)}</select>
          </label>
          <label class="tracker-link-field">
            <span>Tracker title</span>
            <select id="tracker-link-game-kind" onchange="onTrackerModalGameKindChange()">${getTrackerGameSelectHtml(config.key)}</select>
          </label>
          <label class="tracker-link-field">
            <span>Platform</span>
            <input id="tracker-link-platform" type="text" value="${attr(platformValue)}" placeholder="pc">
          </label>
          <label class="tracker-link-field tracker-link-field-wide">
            <span>Profile URL or account</span>
            <input id="tracker-link-account" type="text" value="${attr(profileValue)}" placeholder="Riot ID, gamertag, or tracker.gg URL">
          </label>
        </div>
        <div id="tracker-api-section" class="tracker-auto-stats">
          <div class="tracker-auto-stats-head">
            <span id="tracker-stats-mode-label">API stats</span>
            <small id="tracker-auto-stats-note">${snapshot.updatedAt ? 'Current saved stats. Fetch again to refresh from Tracker.gg.' : 'Stats will be fetched from Tracker.gg.'}</small>
          </div>
          <div class="tracker-card-stat-grid">
            ${renderPreviewStatCell('currentRank', 'Rank', snapshot.currentRank)}
            ${renderPreviewStatCell('peakRank', 'Peak', snapshot.peakRank)}
            ${renderPreviewStatCell('winRate', 'Win', snapshot.winRate)}
            ${renderPreviewStatCell('kd', 'K/D', snapshot.kd)}
          </div>
        </div>
        <div id="tracker-manual-section" class="tracker-auto-stats" style="display:none;">
          <div class="tracker-auto-stats-head">
            <span>Manual stats</span>
            <small>These save directly to the Shelfd title card for unsupported Tracker API games.</small>
          </div>
          <div class="tracker-link-form tracker-manual-form">
            <label class="tracker-link-field">
              <span>Current rank</span>
              <input id="tracker-manual-rank" type="text" value="${attr(snapshot.currentRank || '')}" placeholder="Ascendant 2">
            </label>
            <label class="tracker-link-field">
              <span>Peak rank</span>
              <input id="tracker-manual-peak" type="text" value="${attr(snapshot.peakRank || '')}" placeholder="Immortal 1">
            </label>
            <label class="tracker-link-field">
              <span>Win %</span>
              <input id="tracker-manual-winrate" type="text" value="${attr(snapshot.winRate || '')}" placeholder="54.2%">
            </label>
            <label class="tracker-link-field">
              <span>K/D</span>
              <input id="tracker-manual-kd" type="text" value="${attr(snapshot.kd || '')}" placeholder="1.18">
            </label>
          </div>
        </div>
        <div id="tracker-link-status" class="tracker-link-status" aria-live="polite"></div>
        <div class="tracker-link-actions">
          <button class="tracker-link-secondary" type="button" onclick="saveScreenListTrackerConnection(this)">Connect profile</button>
          <button class="tracker-link-secondary tracker-fetch-btn" type="button" onclick="syncScreenListTrackerStats(this)">Fetch stats</button>
          <button class="tracker-link-primary" type="button" onclick="saveScreenListTrackerLink(this)">Save link</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setManualStatsFields(snapshot);
    setTrackerStatsPreview(snapshot);
    applyTrackerUnsupportedUi(config.key);
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

  async function fetchTrackerStatsFromModal({ showSuccess = true } = {}) {
    const game = cleanText(document.getElementById('tracker-link-game-kind')?.value || '');
    if (isGameApiUnsupported(game)) {
      setTrackerLinkStatus('This Tracker title is not available through the public API. Enter the stats manually below.', '');
      return null;
    }
    const platform = cleanText(document.getElementById('tracker-link-platform')?.value || 'pc');
    const account = cleanText(document.getElementById('tracker-link-account')?.value || '');
    const identifier = getTrackerIdentifierFromInput(account);
    if (!game || !identifier) {
      setTrackerLinkStatus('Add a Tracker profile URL or account before fetching stats.', 'error');
      return null;
    }
    const params = new URLSearchParams({ game, platform, identifier });
    const res = await fetch(`/api/trackergg/profile?${params.toString()}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      const message = json?.error || 'Tracker.gg stats are not available for this title yet.';
      setTrackerLinkStatus(message, json?.unsupported ? '' : 'error');
      setTrackerStatsPreview({}, message);
      return null;
    }
    const normalized = setTrackerStatsPreview(json.profile || {}, 'Fetched from Tracker.gg.');
    if (showSuccess) setTrackerLinkStatus('Tracker.gg stats fetched from the API. Save the link to attach them.', '');
    return normalized;
  }

  async function syncScreenListTrackerStats(button = null) {
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent || 'Fetch stats';
      button.textContent = 'Fetching';
    }
    try {
      await fetchTrackerStatsFromModal({ showSuccess: true });
    } catch (error) {
      console.warn('Tracker.gg sync failed:', error);
      setTrackerLinkStatus('Could not fetch Tracker.gg stats.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Fetch stats';
      }
    }
  }

  function buildTrackerConnectionFromModal() {
    const gameKey = cleanText(document.getElementById('tracker-link-game-kind')?.value || '');
    const platform = cleanText(document.getElementById('tracker-link-platform')?.value || 'pc');
    const accountRaw = cleanText(document.getElementById('tracker-link-account')?.value || '');
    const configFromUrl = parseTrackerGameFromUrl(accountRaw);
    const selectedItem = getSelectedModalItem();
    const config = configFromUrl || getConfigByKey(gameKey) || getConfigForTitle(selectedItem?.title || '');
    const profileUrl = buildTrackerProfileUrl(config.key, accountRaw, platform);
    const parsedIdentifier = getTrackerIdentifierFromInput(accountRaw);
    const displayName = /^https?:\/\//i.test(normalizeUrl(accountRaw))
      ? cleanText(parsedIdentifier || getTrackerConnection().displayName || '')
      : accountRaw;
    const now = new Date().toISOString();
    return {
      provider: 'tracker.gg',
      gameSlug: config.key,
      gameLabel: config.label,
      displayName,
      platform,
      profileUrl,
      connectedAt: getTrackerConnection().connectedAt || now,
      updatedAt: now
    };
  }

  async function saveScreenListTrackerConnection(button = null) {
    if (!currentUser || viewingUser) return;
    const next = buildTrackerConnectionFromModal();
    if (!next.profileUrl && !next.displayName) {
      setTrackerLinkStatus('Add a Tracker.gg profile URL or account name first.', 'error');
      return;
    }
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent || 'Connect profile';
      button.textContent = 'Connecting';
    }
    try {
      if (typeof saveProfileSettingsPatch === 'function') {
        await saveProfileSettingsPatch({ trackerConnection: next });
      } else {
        if (!userProfile) userProfile = {};
        userProfile.trackerConnection = next;
      }
      setTrackerLinkStatus(`Connected ${next.displayName || 'Tracker.gg profile'} to Shelfd.`, '');
      if (typeof showToast === 'function') showToast('Tracker.gg profile connected');
    } catch (error) {
      console.warn('Tracker.gg profile connect failed:', error);
      setTrackerLinkStatus('Could not save the Tracker.gg connection. Try again.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Connect profile';
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

    const connection = buildTrackerConnectionFromModal();
    const config = getConfigByKey(connection.gameSlug) || getConfigForTitle(record.item?.title || '');
    const profileUrl = connection.profileUrl;
    const displayName = connection.displayName;
    const platform = connection.platform;
    const now = new Date().toISOString();

    if (!profileUrl && !displayName) {
      setTrackerLinkStatus('Add a Tracker.gg profile URL or account name.', 'error');
      return;
    }

    const unsupported = isGameApiUnsupported(config.key);
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent || 'Save link';
      button.textContent = unsupported ? 'Saving' : 'Fetching';
    }

    try {
      const fetchedStats = unsupported
        ? getManualStatsFromModal()
        : await fetchTrackerStatsFromModal({ showSuccess: false });
      const existingSnapshot = getTrackerSnapshot(record.item || {});
      const mergedStats = normalizeTrackerApiStats({
        currentRank: fetchedStats?.currentRank || existingSnapshot.currentRank,
        peakRank: fetchedStats?.peakRank || existingSnapshot.peakRank,
        winRate: fetchedStats?.winRate || existingSnapshot.winRate,
        kd: fetchedStats?.kd || existingSnapshot.kd
      });
      if (!hasUsefulStat(mergedStats)) {
        throw new Error(unsupported
          ? 'Enter at least one stat before saving this competitive profile.'
          : 'Tracker.gg did not return API stats for this profile.');
      }
      if (button) button.textContent = 'Saving';
      const snapshot = {
        provider: 'tracker.gg',
        gameSlug: config.key,
        gameLabel: config.label,
        displayName,
        platform,
        currentRank: mergedStats.currentRank,
        peakRank: mergedStats.peakRank,
        winRate: mergedStats.winRate,
        kd: mergedStats.kd,
        sourceUrl: profileUrl,
        syncMode: unsupported ? 'manual-entry' : 'tracker-api',
        linkedAt: record.item?.competitiveStats?.linkedAt || now,
        updatedAt: now
      };
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
        currentRank: snapshot.currentRank,
        peakRank: snapshot.peakRank,
        winRate: snapshot.winRate,
        winPercentage: snapshot.winRate,
        kd: snapshot.kd,
        kdRatio: snapshot.kd,
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
      if (typeof saveProfileSettingsPatch === 'function') {
        await saveProfileSettingsPatch({ trackerConnection: connection });
      } else {
        if (!userProfile) userProfile = {};
        userProfile.trackerConnection = connection;
      }
      closeTrackerLinkModal();
      if (typeof render === 'function') render();
      if (typeof showToast === 'function') showToast('Tracker.gg linked');
    } catch (error) {
      console.warn('Tracker.gg link save failed:', error);
      setTrackerLinkStatus(error?.message || 'Could not save the Tracker.gg link. Try again.', 'error');
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
          ${renderStatCell('Current Rank', snapshot.currentRank, { valorantRank: snapshot.gameSlug === 'valorant' })}
          ${renderStatCell('Peak Rank', snapshot.peakRank, { valorantRank: snapshot.gameSlug === 'valorant' })}
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
  window.saveScreenListTrackerConnection = saveScreenListTrackerConnection;
  window.syncScreenListTrackerStats = syncScreenListTrackerStats;
  window.openTrackerStatsPage = openTrackerStatsPage;
  window.closeTrackerStatsPage = closeTrackerStatsPage;
  window.syncTrackerModalGameDefaults = syncTrackerModalGameDefaults;
  window.onTrackerModalGameKindChange = onTrackerModalGameKindChange;
})();
