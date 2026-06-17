/* v949: Tracker.gg linking — manual stats for unsupported games (Valorant, Marvel Rivals, Fortnite, Rocket League). */
(function initScreenListTrackerLinking() {
  if (window.__screenListTrackerLinkingV951) return;
  window.__screenListTrackerLinkingV951 = true;

  const TRACKER_GAME_CONFIGS = [
    { key: 'valorant', label: 'Valorant', aliases: ['valorant'], homeUrl: 'https://tracker.gg/valorant', profileKind: 'riot', profileBase: 'https://tracker.gg/valorant/profile/riot/' },
    { key: 'marvel-rivals', label: 'Marvel Rivals', aliases: ['marvel rivals', 'marvelrivals'], homeUrl: 'https://tracker.gg/marvel-rivals', profileKind: 'ign', profileBase: 'https://tracker.gg/marvel-rivals/profile/ign/' },
    { key: 'apex', label: 'Apex Legends', aliases: ['apex legends', 'apex'], homeUrl: 'https://tracker.gg/apex', profileKind: 'platform', profileBase: 'https://tracker.gg/apex/profile/' },
    { key: 'the-division-2', label: 'The Division 2', aliases: ['the division 2', 'division 2'], homeUrl: 'https://tracker.gg/division-2', profileKind: 'platform', profileBase: 'https://tracker.gg/division-2/profile/' },
    { key: 'fortnite', label: 'Fortnite', aliases: ['fortnite'], homeUrl: 'https://tracker.gg/fortnite', profileKind: 'epic', profileBase: 'https://tracker.gg/fortnite/profile/all/' },
    { key: 'rocket-league', label: 'Rocket League', aliases: ['rocket league'], homeUrl: 'https://tracker.gg/rocket-league', profileKind: 'platform', profileBase: 'https://tracker.gg/rocket-league/profile/' },
    { key: 'cs2', label: 'Counter-Strike 2', aliases: ['counter strike 2', 'counter-strike 2', 'cs2', 'counter strike'], homeUrl: 'https://tracker.gg/cs2', profileKind: 'steam', profileBase: 'https://tracker.gg/cs2/profile/steam/' },
    /* v11.075: full tracker.gg game roster. The entries below have no public
       Tracker.gg developer-API wiring, so they're manual stat entry (added to
       TRACKER_API_UNSUPPORTED_GAMES). profileKind 'manual' + a best-guess
       homeUrl/profileBase for the "view on tracker.gg" link. Listed in the
       dropdown alphabetically (getTrackerGameSelectHtml sorts by label). */
    { key: 'rainbow-six-siege', label: 'Rainbow Six Siege', aliases: ['rainbow six siege', 'rainbow 6 siege', 'r6 siege', 'r6', 'siege'], homeUrl: 'https://tracker.gg/r6siege', profileKind: 'manual', profileBase: 'https://tracker.gg/r6siege/profile/' },
    { key: 'league-of-legends', label: 'League of Legends', aliases: ['league of legends', 'league', 'lol'], homeUrl: 'https://tracker.gg/lol', profileKind: 'manual', profileBase: 'https://tracker.gg/lol/profile/' },
    { key: 'roblox', label: 'Roblox', aliases: ['roblox'], homeUrl: 'https://tracker.gg/roblox', profileKind: 'manual', profileBase: 'https://tracker.gg/roblox/profile/' },
    { key: 'deadlock', label: 'Deadlock', aliases: ['deadlock'], homeUrl: 'https://tracker.gg/deadlock', profileKind: 'manual', profileBase: 'https://tracker.gg/deadlock/profile/' },
    { key: 'battlefield-6', label: 'Battlefield 6', aliases: ['battlefield 6', 'battlefield', 'bf6'], homeUrl: 'https://tracker.gg/battlefield-6', profileKind: 'manual', profileBase: 'https://tracker.gg/battlefield-6/profile/' },
    { key: 'splitgate', label: 'Splitgate', aliases: ['splitgate', 'splitgate 2'], homeUrl: 'https://tracker.gg/splitgate', profileKind: 'manual', profileBase: 'https://tracker.gg/splitgate/profile/' },
    { key: 'halo-infinite', label: 'Halo Infinite', aliases: ['halo infinite', 'halo'], homeUrl: 'https://tracker.gg/halo-infinite', profileKind: 'manual', profileBase: 'https://tracker.gg/halo-infinite/profile/' },
    { key: 'smite-2', label: 'Smite 2', aliases: ['smite 2', 'smite'], homeUrl: 'https://tracker.gg/smite-2', profileKind: 'manual', profileBase: 'https://tracker.gg/smite-2/profile/' },
    { key: 'destiny-2', label: 'Destiny 2', aliases: ['destiny 2', 'destiny'], homeUrl: 'https://tracker.gg/destiny-2', profileKind: 'manual', profileBase: 'https://tracker.gg/destiny-2/profile/' },
    { key: 'teamfight-tactics', label: 'Teamfight Tactics', aliases: ['teamfight tactics', 'tft'], homeUrl: 'https://tracker.gg/tft', profileKind: 'manual', profileBase: 'https://tracker.gg/tft/profile/' },
    { key: 'off-the-grid', label: 'Off the Grid', aliases: ['off the grid', 'otg'], homeUrl: 'https://tracker.gg/off-the-grid', profileKind: 'manual', profileBase: 'https://tracker.gg/off-the-grid/profile/' },
    { key: '2xko', label: '2XKO', aliases: ['2xko', '2 x k o'], homeUrl: 'https://tracker.gg/2xko', profileKind: 'manual', profileBase: 'https://tracker.gg/2xko/profile/' },
    { key: 'overwatch-2', label: 'Overwatch 2', aliases: ['overwatch 2', 'overwatch', 'ow2'], homeUrl: 'https://tracker.gg/overwatch', profileKind: 'manual', profileBase: 'https://tracker.gg/overwatch/profile/' },
    { key: 'pubg', label: 'PUBG', aliases: ['pubg', 'playerunknown'], homeUrl: 'https://tracker.gg/pubg', profileKind: 'manual', profileBase: 'https://tracker.gg/pubg/profile/' },
    { key: 'call-of-duty', label: 'Call of Duty', aliases: ['call of duty', 'cod', 'warzone'], homeUrl: 'https://tracker.gg/warzone', profileKind: 'manual', profileBase: 'https://tracker.gg/warzone/profile/' },
    { key: 'bloodhunt', label: 'Bloodhunt', aliases: ['bloodhunt'], homeUrl: 'https://tracker.gg/bloodhunt', profileKind: 'manual', profileBase: 'https://tracker.gg/bloodhunt/profile/' },
    { key: 'brawlhalla', label: 'Brawlhalla', aliases: ['brawlhalla', 'rawlhalla'], homeUrl: 'https://tracker.gg/brawlhalla', profileKind: 'manual', profileBase: 'https://tracker.gg/brawlhalla/profile/' },
    { key: 'for-honor', label: 'For Honor', aliases: ['for honor'], homeUrl: 'https://tracker.gg/for-honor', profileKind: 'manual', profileBase: 'https://tracker.gg/for-honor/profile/' },
    { key: 'r6-mobile', label: 'R6 Mobile', aliases: ['r6 mobile', 'rainbow six mobile'], homeUrl: 'https://tracker.gg/r6-mobile', profileKind: 'manual', profileBase: 'https://tracker.gg/r6-mobile/profile/' }
  ];
  // Games not supported by the Tracker.gg public developer API — require manual stat entry
  const TRACKER_API_UNSUPPORTED_GAMES = new Set([
    'valorant', 'marvel-rivals', 'rocket-league', 'fortnite',
    /* v11.075: newly-added roster games have no Tracker.gg developer-API
       wiring, so they use manual stat entry. */
    'rainbow-six-siege', 'league-of-legends', 'roblox', 'deadlock', 'battlefield-6',
    'splitgate', 'halo-infinite', 'smite-2', 'destiny-2', 'teamfight-tactics',
    'off-the-grid', '2xko', 'overwatch-2', 'pubg', 'call-of-duty', 'bloodhunt',
    'brawlhalla', 'for-honor', 'r6-mobile'
  ]);
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
  const competitiveProfileSaveLocks = new Set();

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

  function getStreamableId(value = '') {
    const raw = cleanText(value);
    if (!raw) return '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/(^|\.)streamable\.com$/i.test(parsed.hostname)) return '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      const id = parts[0] === 'e' ? parts[1] : parts[0];
      return /^[a-z0-9]+$/i.test(id || '') ? id : '';
    } catch (_) {
      const match = raw.match(/streamable\.com\/(?:e\/)?([a-z0-9]+)/i);
      return match ? match[1] : '';
    }
  }

  function normalizeHighlightClip(entry = null) {
    let url = '';
    let caption = '';
    if (typeof entry === 'string') {
      url = entry;
    } else if (entry && typeof entry === 'object') {
      url = entry.url || entry.href || entry.link || entry.highlightUrl || '';
      caption = entry.caption || entry.title || entry.note || '';
    }
    url = normalizeUrl(url);
    if (url && !/^https?:\/\//i.test(url) && /(^|\.)streamable\.com\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
    caption = cleanText(caption).slice(0, 180);
    if (!getStreamableId(url)) return null;
    return { url, caption };
  }

  function normalizeHighlightClips(value = null) {
    let list = [];
    if (Array.isArray(value)) {
      list = value;
    } else if (typeof value === 'string' && value.trim()) {
      const raw = value.trim();
      if (raw.startsWith('[') || raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw);
          list = Array.isArray(parsed) ? parsed : [parsed];
        } catch (_) {
          list = [raw];
        }
      } else {
        list = [raw];
      }
    }
    const seen = new Set();
    const out = [];
    list.forEach(entry => {
      const clip = normalizeHighlightClip(entry);
      if (!clip) return;
      const id = getStreamableId(clip.url).toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);
      out.push(clip);
    });
    /* v11.440: was 12 — highlight clips are effectively unlimited now (matches
       MYLIST_HIGHLIGHT_MAX_CLIPS in js/06). 50 keeps the saved doc small. */
    return out.slice(0, 50);
  }

  function getJsonBytes(value = null) {
    if (typeof getShelfdJsonByteLength === 'function') return getShelfdJsonByteLength(value);
    try {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text || '').length;
      return unescape(encodeURIComponent(text || '')).length;
    } catch (_) {
      return 0;
    }
  }

  function getCompetitiveSaveErrorInfo(error = null) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || error || '').trim();
    const lower = `${code} ${message}`.toLowerCase();
    let layer = 'unknown';
    if (/storage\/|firebase storage|bucket|object/.test(lower)) layer = 'firebase-storage';
    else if (/resource-exhausted|firestore|document|1048576|maximum allowed size/.test(lower)) layer = 'firestore';
    else if (/quota|localstorage|sessionstorage|indexeddb|webview/.test(lower)) layer = 'local-webview-storage';
    return {
      code,
      message,
      layer,
      quota: /quota|resource-exhausted|storage\/quota-exceeded/.test(lower)
    };
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

  function getSupportedTrackerConfigForGame(input = {}) {
    const gameSlug = cleanText(input.gameSlug || input.trackerGameSlug || input.key || '');
    const title = cleanText(input.title || input.name || '');
    const fromKey = gameSlug ? getConfigByKey(gameSlug) : null;
    if (fromKey?.homeUrl) return fromKey;
    const normalizedTitle = normalizeKey(title);
    if (!normalizedTitle) return null;
    return TRACKER_GAME_CONFIGS.find(config =>
      config.aliases.some(alias => normalizedTitle.includes(normalizeKey(alias)))
    ) || null;
  }

  function getTrackerHomeUrlForGame(input = {}) {
    return getSupportedTrackerConfigForGame(input)?.homeUrl || '';
  }

  function isGameApiUnsupported(gameKey = '') {
    return TRACKER_API_UNSUPPORTED_GAMES.has(cleanText(gameKey).toLowerCase());
  }

  function getManualStatsFromModal() {
    const seasonKd = normalizeDecimal(document.getElementById('tracker-manual-season-kd')?.value || '');
    const lifetimeKd = normalizeDecimal(document.getElementById('tracker-manual-lifetime-kd')?.value || '');
    return {
      currentRank: cleanText(document.getElementById('tracker-manual-rank')?.value || ''),
      peakRank: cleanText(document.getElementById('tracker-manual-peak')?.value || ''),
      winRate: normalizePercent(document.getElementById('tracker-manual-winrate')?.value || ''),
      seasonKd,
      lifetimeKd,
      kd: lifetimeKd || seasonKd || normalizeDecimal(document.getElementById('tracker-manual-kd')?.value || '')
    };
  }
  function setManualStatsFields(stats = {}) {
    const normalized = normalizeTrackerApiStats(stats);
    const rankInput = document.getElementById('tracker-manual-rank');
    const peakInput = document.getElementById('tracker-manual-peak');
    const winRateInput = document.getElementById('tracker-manual-winrate');
    const kdInput = document.getElementById('tracker-manual-kd');
    const seasonKdInput = document.getElementById('tracker-manual-season-kd');
    const lifetimeKdInput = document.getElementById('tracker-manual-lifetime-kd');
    if (rankInput) rankInput.value = normalized.currentRank || '';
    if (peakInput) peakInput.value = normalized.peakRank || '';
    if (winRateInput) winRateInput.value = normalized.winRate || '';
    if (kdInput) kdInput.value = normalized.kd || '';
    if (seasonKdInput) seasonKdInput.value = normalized.seasonKd || '';
    if (lifetimeKdInput) lifetimeKdInput.value = normalized.lifetimeKd || normalized.kd || '';
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
    if (manualSection) manualSection.style.display = '';
    if (fetchBtn) fetchBtn.style.display = unsupported ? 'none' : '';
    if (copyEl) copyEl.textContent = unsupported
      ? "This game isn't in the Tracker.gg public API. Paste your profile URL, then enter your stats manually — they'll show on the game card."
      : "Paste your Tracker.gg profile URL or handle. Shelfd fetches your rank, K/D, and win rate from the API and shows them on the game card.";
    if (unsupported && copyEl) copyEl.textContent = "This game isn't in the Tracker.gg public API. Paste your profile URL, then enter your stats manually so Shelfd can show them on the game card.";
    if (copyEl) copyEl.textContent = unsupported
      ? "This game isn't in the Tracker.gg public API. Enter the competitive profile metadata manually; Tracker.gg and highlights links are optional."
      : "Paste a Tracker.gg profile URL if you want API sync, or edit the competitive profile metadata manually below.";
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
      /* v11.075: map the friendly platform label (e.g. "PlayStation") to the
         Tracker.gg URL slug ("psn") so auto-fetch URLs still resolve. */
      const cleanPlatform = trackerPlatformSlug(platform || 'pc');
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
      seasonKd: cleanText(stats.seasonKd || item.seasonKd || item.gameSeasonKd || ''),
      lifetimeKd: cleanText(stats.lifetimeKd || stats.kd || stats.kdRatio || item.lifetimeKd || item.gameLifetimeKd || item.kd || ''),
      kd: cleanText(stats.kd || stats.kdRatio || stats.lifetimeKd || item.kd || item.kdRatio || item.lifetimeKd || ''),
      sourceUrl,
      highlightUrl: normalizeUrl(stats.highlightUrl || item.highlightsUrl || item.gameHighlightsUrl || item.highlightUrl || item.clipsUrl || ''),
      highlightClips: normalizeHighlightClips(item.highlightClips || item.highlights || stats.highlightClips || stats.highlights || ''),
      linkedAt: stats.linkedAt || linked.linkedAt || '',
      updatedAt: stats.updatedAt || linked.updatedAt || '',
      syncMode: stats.syncMode || linked.syncMode || (sourceUrl ? 'profile-link' : '')
    };
  }

  function hasUsefulStat(snapshot = {}) {
    return !!(snapshot.currentRank || snapshot.peakRank || snapshot.winRate || snapshot.kd || snapshot.seasonKd || snapshot.lifetimeKd);
  }

  function getHighlightUrlFromModal() {
    return normalizeUrl(document.getElementById('tracker-highlight-url')?.value || '');
  }

  function hasTrackerBreakdownForItem(item = {}) {
    const snapshot = getTrackerSnapshot(item);
    return !!(snapshot.sourceUrl || snapshot.displayName || snapshot.highlightUrl || hasUsefulStat(snapshot));
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

  function renderTrackerCardRankArt(value = '', options = {}) {
    if (options.valorantRank) {
      const rank = parseValorantRank(value);
      const sprite = getValorantRankSprite(rank);
      if (rank && sprite) {
        return `
          <span class="tracker-card-rank-art tracker-card-rank-art--valorant tracker-card-rank-art--${attr(rank.tier)}" aria-hidden="true">
            <span class="tracker-card-rank-sprite" style="--tracker-rank-col:${sprite.col};--tracker-rank-row:${sprite.row};"></span>
          </span>
        `;
      }
    }
    return `
      <span class="tracker-card-rank-art" aria-hidden="true">
        <span class="tracker-card-rank-diamond"></span>
      </span>
    `;
  }

  function renderTrackerCardStatCell(label, value, options = {}) {
    return `
      <span class="tracker-card-stat-cell">
        <span class="tracker-card-stat-kicker">
          <span class="tracker-card-stat-label">${html(label)}</span>
          <span class="tracker-card-stat-value">${html(value || '-')}</span>
        </span>
        ${renderTrackerCardRankArt(value, options)}
      </span>
    `;
  }

  function normalizeTrackerApiStats(profile = {}) {
    const seasonKd = normalizeDecimal(profile.seasonKd || profile.gameSeasonKd || '');
    const lifetimeKd = normalizeDecimal(profile.lifetimeKd || profile.gameLifetimeKd || profile.kd || '');
    return {
      currentRank: cleanText(profile.currentRank || ''),
      peakRank: cleanText(profile.peakRank || ''),
      winRate: normalizePercent(profile.winRate || ''),
      seasonKd,
      lifetimeKd,
      kd: lifetimeKd || seasonKd || normalizeDecimal(profile.kd || '')
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
      renderTrackerCardStatCell('Rank', snapshot.currentRank, { valorantRank: isValorant }),
      renderTrackerCardStatCell('Peak', snapshot.peakRank, { valorantRank: isValorant })
    ].join('');
    const account = snapshot.displayName || snapshot.gameLabel;
    return `
      <button class="tracker-card-strip" type="button" onclick="openTrackerStatsPage(event,'${attr(getGameItemKey(item))}')" aria-label="Open Tracker.gg stats for ${attr(item.title || 'this game')}">
        <span class="tracker-card-strip-head">
          <span class="tracker-card-account">${html(account || 'Tracker.gg')}</span>
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
    if (platform) platform.value = trackerPlatformLabel(item.gamePlatform || item.platform || 'pc');
    setManualStatsFields(snapshot);
    setTrackerStatsPreview(snapshot, snapshot.updatedAt ? 'Current saved stats. Fetch again to refresh from Tracker.gg.' : 'Stats will be fetched from Tracker.gg.');
    applyTrackerUnsupportedUi(config.key);
  }

  function getTrackerGameSelectHtml(selected = '') {
    const selectedKey = getConfigByKey(selected)?.key || selected || 'valorant';
    /* v11.075: display the full roster ALPHABETICALLY by label (the array order
       is preserved for default-fallback logic; only the dropdown is sorted). */
    return TRACKER_GAME_CONFIGS
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      .map(config =>
        `<option value="${attr(config.key)}"${config.key === selectedKey ? ' selected' : ''}>${html(config.label)}</option>`
      ).join('');
  }

  /* v11.075: platform is now a fixed dropdown (no free-text). Friendly labels
     are shown + stored; trackerPlatformSlug() maps them to Tracker.gg's URL
     slugs only when building an auto-fetch profile URL, so the platform-kind
     games (Apex / The Division 2 / Rocket League) still resolve. Listed
     alphabetically by label. */
  const TRACKER_PLATFORM_OPTIONS = [
    { label: 'Android', slug: 'android' },
    { label: 'Epic Games', slug: 'epic' },
    { label: 'iOS', slug: 'ios' },
    { label: 'Mobile', slug: 'mobile' },
    { label: 'Nintendo Switch', slug: 'switch' },
    { label: 'PC', slug: 'pc' },
    { label: 'PlayStation', slug: 'psn' },
    { label: 'Steam', slug: 'steam' },
    { label: 'Xbox', slug: 'xbl' }
  ];
  function trackerPlatformLabel(value = '') {
    const v = cleanText(value).toLowerCase();
    if (!v) return 'PC';
    const exact = TRACKER_PLATFORM_OPTIONS.find(p => p.label.toLowerCase() === v || p.slug === v);
    if (exact) return exact.label;
    if (/playstation|psn|ps[345]/.test(v)) return 'PlayStation';
    if (/xbox|xbl|series\s*[xs]|xbone/.test(v)) return 'Xbox';
    if (/steam/.test(v)) return 'Steam';
    if (/epic/.test(v)) return 'Epic Games';
    if (/switch|nintendo/.test(v)) return 'Nintendo Switch';
    if (/ios|iphone|ipad/.test(v)) return 'iOS';
    if (/android/.test(v)) return 'Android';
    if (/mobile/.test(v)) return 'Mobile';
    return 'PC';
  }
  function trackerPlatformSlug(value = '') {
    const label = trackerPlatformLabel(value);
    return (TRACKER_PLATFORM_OPTIONS.find(p => p.label === label)?.slug) || 'pc';
  }
  function getTrackerPlatformSelectHtml(selected = '') {
    const sel = trackerPlatformLabel(selected);
    return TRACKER_PLATFORM_OPTIONS.map(p =>
      `<option value="${attr(p.label)}"${p.label === sel ? ' selected' : ''}>${html(p.label)}</option>`
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
            <select id="tracker-link-platform">${getTrackerPlatformSelectHtml(platformValue)}</select>
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
            <span>Profile metadata</span>
            <small>These fields save directly to this competitive game profile.</small>
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
              <span>Season KD</span>
              <input id="tracker-manual-season-kd" type="text" value="${attr(snapshot.seasonKd || '')}" placeholder="1.18">
            </label>
            <label class="tracker-link-field">
              <span>Lifetime KD</span>
              <input id="tracker-manual-lifetime-kd" type="text" value="${attr(snapshot.lifetimeKd || snapshot.kd || '')}" placeholder="1.22">
            </label>
            <label class="tracker-link-field tracker-link-field-wide">
              <span>Highlight reel URL</span>
              <input id="tracker-highlight-url" type="url" value="${attr(snapshot.highlightUrl || '')}" placeholder="Paste a Streamable link">
              <small>Upload your clip to Streamable, then paste the share link here.</small>
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

  async function fetchScreenListTrackerStatsForProfile(options = {}) {
    const game = cleanText(options.game || '');
    if (isGameApiUnsupported(game)) {
      return {
        ok: false,
        unsupported: true,
        error: 'Tracker.gg does not expose this title through the public API. Save the stats manually.'
      };
    }
    const platform = cleanText(options.platform || 'pc');
    const account = cleanText(options.account || '');
    const identifier = getTrackerIdentifierFromInput(account);
    if (!game || !identifier) {
      return { ok: false, error: 'Add a Tracker.gg profile URL or account before fetching stats.' };
    }
    const params = new URLSearchParams({ game, platform, identifier, force: options.force ? '1' : '0' });
    const res = await fetch(`/api/trackergg/profile?${params.toString()}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      return {
        ok: false,
        unsupported: !!json?.unsupported,
        error: json?.error || 'Tracker.gg stats are not available for this profile.'
      };
    }
    return {
      ok: true,
      profile: normalizeTrackerApiStats(json.profile || {}),
      rawProfile: json.profile || {},
      tracker: json.tracker || {}
    };
  }

  function parseCompetitiveGamesSection(raw = '') {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(String(raw || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function getCompetitiveGameMatchKeys(item = {}) {
    return [
      item.id,
      item.rawgId,
      item.rawgSlug,
      item.metacriticSlug,
      item.backloggdSlug,
      item.title,
      item.name
    ]
      .map(value => cleanText(value).toLowerCase())
      .filter(Boolean);
  }

  function findPersistedCompetitiveGame(expectedItem = {}, games = []) {
    const expectedKeys = new Set(getCompetitiveGameMatchKeys(expectedItem));
    if (!expectedKeys.size) return null;
    return games.find(candidate => {
      const candidateKeys = getCompetitiveGameMatchKeys(candidate);
      return candidateKeys.some(key => expectedKeys.has(key));
    }) || null;
  }

  function normalizeCompetitiveCompareValue(value = '', isUrl = false) {
    const normalized = isUrl ? normalizeUrl(value) : cleanText(value);
    return normalized.toLowerCase();
  }

  function getCompetitiveCandidateValue(candidate = {}, field = '') {
    const stats = candidate?.competitiveStats && typeof candidate.competitiveStats === 'object' ? candidate.competitiveStats : {};
    const account = candidate?.trackerAccount && typeof candidate.trackerAccount === 'object' ? candidate.trackerAccount : {};
    switch (field) {
      case 'displayName':
        return stats.displayName || account.displayName || candidate.trackerAccountName || '';
      case 'currentRank':
        return stats.currentRank || candidate.currentRank || '';
      case 'peakRank':
        return stats.peakRank || candidate.peakRank || '';
      case 'seasonKd':
        return stats.seasonKd || candidate.seasonKd || candidate.gameSeasonKd || '';
      case 'lifetimeKd':
        return stats.lifetimeKd || stats.kd || candidate.lifetimeKd || candidate.gameLifetimeKd || candidate.kd || '';
      case 'sourceUrl':
        return stats.sourceUrl || account.profileUrl || candidate.trackerStatsUrl || candidate.trackerUrl || candidate.gameTrackerUrl || candidate.gameStatsUrl || candidate.statsUrl || '';
      case 'highlightUrl':
        return stats.highlightUrl || candidate.highlightUrl || candidate.highlightsUrl || candidate.gameHighlightsUrl || candidate.clipsUrl || '';
      default:
        return '';
    }
  }

  async function verifyCompetitiveProfileServerPersisted(expectedItem = {}, snapshot = {}) {
    if (!currentUser?.uid || typeof db === 'undefined' || !db) {
      throw new Error('No signed-in user is available for game profile save verification.');
    }
    const ref = db.collection('watchlist').doc(currentUser.uid).collection('sections').doc('games');
    const snap = await ref.get({ source: 'server' });
    const games = snap.exists ? parseCompetitiveGamesSection((snap.data() || {}).data || '') : [];
    const persisted = findPersistedCompetitiveGame(expectedItem, games);
    if (!persisted) {
      throw new Error(`Game profile save verification failed for "${expectedItem.title || expectedItem.name || expectedItem.id || 'game'}".`);
    }
    const checks = [
      ['displayName', snapshot.displayName, false],
      ['currentRank', snapshot.currentRank, false],
      ['peakRank', snapshot.peakRank, false],
      ['seasonKd', snapshot.seasonKd, false],
      ['lifetimeKd', snapshot.lifetimeKd, false],
      ['sourceUrl', snapshot.sourceUrl, true],
      ['highlightUrl', snapshot.highlightUrl, true]
    ].filter(([, expected]) => cleanText(expected));
    const missing = checks.filter(([field, expected, isUrl]) => {
      const actual = getCompetitiveCandidateValue(persisted, field);
      return normalizeCompetitiveCompareValue(actual, isUrl) !== normalizeCompetitiveCompareValue(expected, isUrl);
    });
    if (missing.length) {
      const names = missing.map(([field]) => field).join(', ');
      throw new Error(`Game profile save verification failed for: ${names}.`);
    }
    window.__lastCompetitiveProfileSaveDebug = {
      ok: true,
      itemId: expectedItem.id || expectedItem.rawgId || '',
      title: expectedItem.title || expectedItem.name || '',
      verifiedFields: checks.map(([field]) => field),
      at: new Date().toISOString()
    };
    return true;
  }

  async function saveScreenListCompetitiveProfile(payload = {}) {
    if (!currentUser || viewingUser) throw new Error('Sign in before editing this profile.');
    const itemId = cleanText(payload.itemId || '');
    const record = findGameRecord(itemId);
    if (!record) throw new Error('Game not found.');
    const saveLockKey = `${currentUser.uid}:${record.id}`;
    if (competitiveProfileSaveLocks.has(saveLockKey)) {
      throw new Error('This game profile is already saving.');
    }
    competitiveProfileSaveLocks.add(saveLockKey);

    try {
    const configFromInput = parseTrackerGameFromUrl(payload.profileInput || '');
    const config = configFromInput
      || getConfigByKey(payload.gameSlug || '')
      || getConfigForTitle(record.item?.title || '');
    const platform = cleanText(payload.platform || record.item?.gamePlatform || record.item?.platform || 'pc');
    const profileInput = cleanText(payload.profileInput || '');
    /* v11.078: hours played is now editable on the game profile (even when
       Steam auto-fetches it). When the payload carries it, persist to the item
       so the manual value sticks. */
    const hasHoursPlayed = Object.prototype.hasOwnProperty.call(payload, 'hoursPlayed');
    const hoursPlayedValue = hasHoursPlayed ? cleanText(String(payload.hoursPlayed ?? '')).replace(/[^0-9.]/g, '') : '';
    const profileUrl = buildTrackerProfileUrl(config.key, profileInput, platform);
    const displayName = /^https?:\/\//i.test(normalizeUrl(profileInput))
      ? cleanText(getTrackerIdentifierFromInput(profileInput) || getTrackerSnapshot(record.item || {}).displayName || '')
      : profileInput;
    const manualStats = normalizeTrackerApiStats({
      currentRank: payload.currentRank,
      peakRank: payload.peakRank,
      seasonKd: payload.seasonKd,
      lifetimeKd: payload.lifetimeKd,
      kd: payload.lifetimeKd || payload.seasonKd
    });
    const existingSnapshot = getTrackerSnapshot(record.item || {});
    const hasHighlightClipsPayload = Object.prototype.hasOwnProperty.call(payload, 'highlightClips');
    const hasHighlightUrlPayload = Object.prototype.hasOwnProperty.call(payload, 'highlightUrl');
    const incomingHighlightClips = normalizeHighlightClips(payload.highlightClips);
    const existingHighlightClips = normalizeHighlightClips(record.item?.highlightClips || record.item?.highlights || existingSnapshot.highlightClips || existingSnapshot.highlights || '');
    let highlightUrl = normalizeUrl(hasHighlightUrlPayload ? payload.highlightUrl : (incomingHighlightClips[0]?.url || existingSnapshot.highlightUrl || ''));
    const highlightClips = normalizeHighlightClips(
      hasHighlightClipsPayload
        ? incomingHighlightClips
        : incomingHighlightClips.length
        ? incomingHighlightClips
        : (highlightUrl ? [{ url: highlightUrl }] : existingHighlightClips)
    );
    if (!highlightUrl && highlightClips[0]?.url) highlightUrl = highlightClips[0].url;

    let fetchedStats = null;
    let fetchResult = null;
    if (payload.fetchStats !== false && profileInput && !isGameApiUnsupported(config.key)) {
      try {
        fetchResult = await fetchScreenListTrackerStatsForProfile({
          game: config.key,
          platform,
          account: profileInput,
          force: !!payload.forceFetch
        });
        if (fetchResult.ok) fetchedStats = fetchResult.profile;
      } catch (fetchError) {
        fetchResult = {
          ok: false,
          error: fetchError?.message || String(fetchError || 'Tracker.gg lookup failed.'),
          thrown: true
        };
        console.warn('Tracker.gg profile lookup failed; saving manual/profile fields:', fetchError);
      }
    }

    const mergedStats = normalizeTrackerApiStats({
      currentRank: manualStats.currentRank || fetchedStats?.currentRank || existingSnapshot.currentRank,
      peakRank: manualStats.peakRank || fetchedStats?.peakRank || existingSnapshot.peakRank,
      seasonKd: manualStats.seasonKd || fetchedStats?.seasonKd || existingSnapshot.seasonKd,
      lifetimeKd: manualStats.lifetimeKd || fetchedStats?.lifetimeKd || existingSnapshot.lifetimeKd,
      kd: manualStats.kd || fetchedStats?.kd || existingSnapshot.kd,
      winRate: fetchedStats?.winRate || existingSnapshot.winRate
    });

    /* v11.077: restriction removed per user request — a competitive profile can
       be saved with just the Tracker title + platform. Stats / profile URL /
       highlight are all optional now, so we no longer block the save when
       they're empty. */

    const now = new Date().toISOString();
    const snapshot = {
      provider: 'tracker.gg',
      gameSlug: config.key,
      gameLabel: config.label,
      displayName,
      platform,
      currentRank: mergedStats.currentRank,
      peakRank: mergedStats.peakRank,
      winRate: mergedStats.winRate,
      seasonKd: mergedStats.seasonKd,
      lifetimeKd: mergedStats.lifetimeKd,
      kd: mergedStats.kd,
      sourceUrl: profileUrl,
      highlightUrl,
      highlightClips,
      highlights: highlightClips,
      syncMode: isGameApiUnsupported(config.key) ? 'manual-entry' : (fetchResult?.ok ? 'tracker-api' : 'profile-link'),
      linkedAt: record.item?.competitiveStats?.linkedAt || now,
      updatedAt: now
    };

    const nextData = typeof cloneListData === 'function'
      ? cloneListData(data)
      : JSON.parse(JSON.stringify(data || { games: [] }));
    if (!Array.isArray(nextData.games)) nextData.games = [];
    const nextIndex = nextData.games.findIndex((item, index) => getGameItemKey(item, index) === record.id || cleanText(item?.id) === record.id);
    if (nextIndex < 0) throw new Error('Game not found.');
    const patchedGame = {
      ...nextData.games[nextIndex],
      status: nextData.games[nextIndex]?.status || record.item?.status || 'competitive',
      trackerProvider: 'tracker.gg',
      trackerGameSlug: config.key,
      trackerAccountName: displayName,
      currentRank: snapshot.currentRank,
      peakRank: snapshot.peakRank,
      winRate: snapshot.winRate,
      winPercentage: snapshot.winRate,
      seasonKd: snapshot.seasonKd,
      gameSeasonKd: snapshot.seasonKd,
      lifetimeKd: snapshot.lifetimeKd,
      gameLifetimeKd: snapshot.lifetimeKd,
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
      highlightsUrl: highlightUrl,
      gameHighlightsUrl: highlightUrl,
      highlightUrl,
      clipsUrl: highlightUrl,
      highlightClips,
      highlights: highlightClips,
      ...(hasHoursPlayed ? {
        gameHoursPlayed: hoursPlayedValue,
        hoursPlayed: hoursPlayedValue,
        gameHours: hoursPlayedValue,
        playtimeHours: hoursPlayedValue
      } : {}),
      dateModified: now
    };
    /* v11.464: when this save is purely attaching a highlight reel, stamp the
       moment on the item. The activity-feed derivation (processUserItems in
       10-activity-feed.js) treats a dateModified change that coincides with
       lastHighlightActivityAt as "already represented by the Highlight Reel post"
       and suppresses the generic "updated <game>" card. Mirrors the existing
       lastShowRatingAt / lastSeasonRatingAt suppression markers. Normal stat /
       rank / metadata saves do NOT set this, so their update cards still fire. */
    if (payload.highlightSave) {
      patchedGame.lastHighlightActivityAt = now;
      /* v11.465: a highlight-only save must NOT advance the game's dateModified.
         processUserItems (10-activity-feed.js) synthesizes a generic
         "updated <game>" activity card from ANY fresh dateModified bump, and the
         Highlight Reel post is already the real activity. Restore the prior
         dateModified so the generic card is never even derived — timing- and
         window-independent (does not rely on the lastHighlightActivityAt match
         above). The full games section is still written wholesale by
         persistOwnDataToFirestore, so the highlight clip itself persists normally.
         Normal stat/rank/metadata saves (no highlightSave flag) still bump
         dateModified and post their update cards as before. */
      const priorModified = nextData.games[nextIndex]?.dateModified || patchedGame.dateAdded || '';
      if (priorModified) patchedGame.dateModified = priorModified;
    }
    nextData.games[nextIndex] = typeof compactGameItemForStorage === 'function'
      ? compactGameItemForStorage(patchedGame)
      : patchedGame;

    if (typeof window !== 'undefined') {
      const gamesJson = JSON.stringify(nextData.games || []);
      window.__lastCompetitiveProfileSaveDebug = {
        ok: false,
        stage: 'before-persist',
        itemId: record.id,
        title: record.item?.title || record.item?.name || '',
        uploadError: null,
        itemBeforeBytes: getJsonBytes(record.item || {}),
        itemAfterBytes: getJsonBytes(nextData.games[nextIndex] || {}),
        gamesSectionBytes: getJsonBytes(gamesJson),
        gamesCount: Array.isArray(nextData.games) ? nextData.games.length : 0,
        at: new Date().toISOString()
      };
    }

    if (typeof persistOwnListDataImmediate === 'function') {
      await persistOwnListDataImmediate(nextData, {
        sections: ['games'],
        verify: false,
        localBackupContext: 'competitiveProfileInlineSave'
      });
    } else {
      data = typeof normalizeListData === 'function' ? normalizeListData(nextData) : nextData;
      if (typeof save === 'function') save();
    }
    /* v11.467: a highlight-only save (Activity composer / game-detail clip editor)
       carries no rank/profile stats to verify, yet the verification below does a
       forced `source:'server'` read-back of the entire games section — a full
       extra network round-trip that made "Post highlight" feel slow. Skip it for
       highlight saves; the clip still persists via the awaited
       persistOwnListDataImmediate write above. Normal stat/rank/profile saves keep
       the verification exactly as before. */
    let verifyError = null;
    if (!payload.highlightSave) {
      try {
        await verifyCompetitiveProfileServerPersisted(nextData.games[nextIndex], snapshot);
      } catch (error) {
        verifyError = error;
        console.warn('Competitive profile save verification could not complete after write:', error);
      }
    }
    let profilePatchError = null;
    if (typeof saveProfileSettingsPatch === 'function' && (profileUrl || displayName)) {
      try {
        await saveProfileSettingsPatch({
          trackerConnection: {
            provider: 'tracker.gg',
            gameSlug: config.key,
            gameLabel: config.label,
            displayName,
            platform,
            profileUrl,
            connectedAt: getTrackerConnection().connectedAt || now,
            updatedAt: now
          }
        });
      } catch (patchError) {
        profilePatchError = patchError;
        console.warn('Tracker profile mirror patch failed after competitive profile save:', patchError);
      }
    }

    if (typeof window !== 'undefined') {
      window.__lastCompetitiveProfileSaveDebug = {
        ...(window.__lastCompetitiveProfileSaveDebug || {}),
        ok: true,
        stage: 'complete',
        verifyError: verifyError ? getCompetitiveSaveErrorInfo(verifyError) : null,
        profilePatchError: profilePatchError ? getCompetitiveSaveErrorInfo(profilePatchError) : null,
        at: new Date().toISOString()
      };
    }

    return { snapshot, fetchResult, profilePatchError, verifyError };
    } finally {
      competitiveProfileSaveLocks.delete(saveLockKey);
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

    const manualStatsBeforeSave = getManualStatsFromModal();
    const highlightUrlBeforeSave = getHighlightUrlFromModal();
    if (!profileUrl && !displayName && !hasUsefulStat(manualStatsBeforeSave) && !highlightUrlBeforeSave) {
      setTrackerLinkStatus('Add a profile URL/account, enter at least one profile field, or paste a highlight link.', 'error');
      return;
    }

    const unsupported = isGameApiUnsupported(config.key);
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent || 'Save link';
      button.textContent = unsupported ? 'Saving' : 'Fetching';
    }

    try {
      const manualStats = manualStatsBeforeSave;
      let fetchedStats = manualStats;
      if (!unsupported && (profileUrl || displayName)) {
        try {
          fetchedStats = await fetchTrackerStatsFromModal({ showSuccess: false });
        } catch (fetchError) {
          console.warn('Legacy Tracker modal lookup failed; saving manual/profile fields:', fetchError);
          setTrackerLinkStatus('Could not fetch Tracker.gg stats, but manual fields can still save.', '');
        }
      }
      const existingSnapshot = getTrackerSnapshot(record.item || {});
      let highlightUrl = highlightUrlBeforeSave || existingSnapshot.highlightUrl || '';
      const mergedStats = normalizeTrackerApiStats({
        currentRank: manualStats.currentRank || fetchedStats?.currentRank || existingSnapshot.currentRank,
        peakRank: manualStats.peakRank || fetchedStats?.peakRank || existingSnapshot.peakRank,
        winRate: manualStats.winRate || fetchedStats?.winRate || existingSnapshot.winRate,
        seasonKd: manualStats.seasonKd || fetchedStats?.seasonKd || existingSnapshot.seasonKd,
        lifetimeKd: manualStats.lifetimeKd || fetchedStats?.lifetimeKd || existingSnapshot.lifetimeKd,
        kd: manualStats.kd || fetchedStats?.kd || existingSnapshot.kd
      });
      if (!hasUsefulStat(mergedStats) && !profileUrl && !displayName && !highlightUrl) {
        throw new Error(unsupported
          ? 'Enter at least one profile field before saving this competitive profile.'
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
        seasonKd: mergedStats.seasonKd,
        lifetimeKd: mergedStats.lifetimeKd,
        kd: mergedStats.kd,
        sourceUrl: profileUrl,
        highlightUrl,
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
      const patchedGame = {
        ...nextData.games[nextIndex],
        status: 'competitive',
        trackerProvider: 'tracker.gg',
        trackerGameSlug: config.key,
        trackerAccountName: displayName,
        currentRank: snapshot.currentRank,
        peakRank: snapshot.peakRank,
        winRate: snapshot.winRate,
        winPercentage: snapshot.winRate,
        seasonKd: snapshot.seasonKd,
        gameSeasonKd: snapshot.seasonKd,
        lifetimeKd: snapshot.lifetimeKd,
        gameLifetimeKd: snapshot.lifetimeKd,
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
        highlightsUrl: highlightUrl,
        gameHighlightsUrl: highlightUrl,
        highlightUrl,
        clipsUrl: highlightUrl,
        dateModified: now
      };
      nextData.games[nextIndex] = typeof compactGameItemForStorage === 'function'
        ? compactGameItemForStorage(patchedGame)
        : patchedGame;

      if (typeof persistOwnListDataImmediate === 'function') {
        await persistOwnListDataImmediate(nextData, {
          sections: ['games'],
          verify: false,
          localBackupContext: 'legacyTrackerLinkSave'
        });
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
      if (typeof window.openMyListGameProfilePage === 'function' && document.getElementById('mylist-game-profile-page')) {
        window.openMyListGameProfilePage(record.id);
      }
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
            ${snapshot.highlightUrl ? `<a class="tracker-stats-open" href="${attr(snapshot.highlightUrl)}" target="_blank" rel="noopener">Open highlight</a>` : ''}
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
  window.fetchScreenListTrackerStatsForProfile = fetchScreenListTrackerStatsForProfile;
  window.saveScreenListCompetitiveProfile = saveScreenListCompetitiveProfile;
  window.getScreenListTrackerGameOptionsHtml = getTrackerGameSelectHtml;
  window.getScreenListTrackerGameHomeUrl = getTrackerHomeUrlForGame;
  window.isScreenListTrackerApiUnsupported = isGameApiUnsupported;
  window.openTrackerStatsPage = openTrackerStatsPage;
  window.closeTrackerStatsPage = closeTrackerStatsPage;
  window.syncTrackerModalGameDefaults = syncTrackerModalGameDefaults;
  window.onTrackerModalGameKindChange = onTrackerModalGameKindChange;
})();
