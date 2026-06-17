/* =============================================================================
   51-release-reminders.js  (v11.990 — on-device release-day reminders)
   ----------------------------------------------------------------------------
   Fires a LOCAL push notification at 9:00 AM (device local time) on the day a
   library item releases — so the user is told the moment their stuff is out:

     • Movie in Planning releases today        → "{Title}"  /  "Out now"
     • Game in Wishlist/Planning releases today → "{Title}"  /  "Released today"
     • Album releases today                     → "{Title}"  /  "Out now"
     • Followed show/anime new episode airs     → "{Title}"  /  "New episode out now"
     • Followed show/anime season premiere       → "{Title}"  /  "New season out now"
     • Followed show/anime SEASON FINALE         → "{Title}"  /  "Season finale out now"
     • Unreleased show/anime first season premiere → "{Title}" / "Premieres today"

   HOW IT WORKS
     The library lives in the global `data` object (data[section] = items[]).
     We reuse the SAME release-date / next-episode helpers the Shelf cards use
     (getScreenListKnownReleaseDate, getMyListNextEpisodeAirDate,
      getMyListNextEpisodeLabel) so the alert date always matches the card.
     For every item whose release/air date is today-or-future we schedule ONE
     Capacitor LocalNotification at 9 AM local on that date. The scan is
     idempotent (dedupes by a stable id derived from item+date+kind) and runs
     on sign-in, on app resume/foreground, and hourly, reconciling against the
     OS's pending queue so removed items get their reminder cancelled.

   NATIVE DEPENDENCY (iOS shell — the shelfd-ios-public Xcode repo, NOT here):
     Requires @capacitor/local-notifications. Install it there, run
     `npx cap sync ios`, then re-archive. Until then this file no-ops cleanly
     (logs "[release-reminders] LocalNotifications plugin unavailable") and
     never blocks the app. iOS shares the notification permission with push,
     so a user who already allowed push grants this with no second prompt.

   iOS keeps only the soonest 64 pending local notifications — we cap at 60 and
   always schedule the NEAREST releases first.
   ========================================================================== */
(function () {
  'use strict';

  const LOG = (...a) => { try { console.log('[release-reminders]', ...a); } catch (_) {} };
  const WARN = (...a) => { try { console.warn('[release-reminders]', ...a); } catch (_) {} };

  const NOTIFY_HOUR = 9;            // 9:00 AM device-local time
  const MAX_PENDING = 60;          // stay under the iOS 64 local-notification ceiling
  const RESCAN_THROTTLE_MS = 30000; // never rescan more than once per 30s
  const RESCAN_INTERVAL_MS = 60 * 60 * 1000; // hourly safety rescan
  const SECTIONS = ['movies', 'shows', 'anime', 'games', 'music'];

  let lastScanAtMs = 0;
  let scanInFlight = false;
  let intervalBound = false;

  /* ---------- Capacitor iOS detection (mirrors 33-push-notifications.js) ---------- */
  function isLikelyShelfdNativeIOS() {
    try {
      const ua = String(navigator.userAgent || '');
      return /\bShelfdNativeNoInset\b/.test(ua) && /\b(iPhone|iPad|iPod)\b/i.test(ua);
    } catch (_) { return false; }
  }
  function isCapacitorIOS() {
    try {
      const Cap = window.Capacitor;
      if (Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) {
        const platform = typeof Cap.getPlatform === 'function' ? Cap.getPlatform() : '';
        return platform === 'ios';
      }
      return isLikelyShelfdNativeIOS();
    } catch (_) { return false; }
  }
  function getPlugin() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
    } catch (_) { return null; }
  }
  function getAppPlugin() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null;
    } catch (_) { return null; }
  }

  /* ---------- Helpers ---------- */
  function currentUid() {
    try { return (window.currentUser && window.currentUser.uid) || ''; } catch (_) { return ''; }
  }
  function storageKey() { return 'shelfd-release-reminders-v1:' + (currentUid() || 'anon'); }
  function loadScheduledMap() {
    try { return JSON.parse(localStorage.getItem(storageKey())) || {}; } catch (_) { return {}; }
  }
  function saveScheduledMap(map) {
    try { localStorage.setItem(storageKey(), JSON.stringify(map || {})); } catch (_) {}
  }

  /* Stable positive 31-bit int id from a string (Capacitor ids must be ints). */
  function hashId(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 2000000000) + 1; // 1 .. 2,000,000,000 (safe int, never 0)
  }

  function titleOf(item) {
    return String((item && (item.title || item.name)) || '').trim();
  }

  /* Lean on the exact same helpers the Shelf cards use so dates never disagree. */
  function knownReleaseDate(item) {
    try { return (typeof getScreenListKnownReleaseDate === 'function') ? (getScreenListKnownReleaseDate(item) || '') : ''; }
    catch (_) { return ''; }
  }
  function gameReleaseDate(item) {
    const direct = String((item && (item.releaseDate || item.released || item.release_date)) || '').trim();
    return direct || knownReleaseDate(item);
  }
  function nextEpisodeAirDate(item) {
    try { return (typeof getMyListNextEpisodeAirDate === 'function') ? (getMyListNextEpisodeAirDate(item) || '') : ''; }
    catch (_) { return ''; }
  }
  function nextEpisodeLabel(item, section) {
    try { return (typeof getMyListNextEpisodeLabel === 'function') ? (getMyListNextEpisodeLabel(item, section) || '') : ''; }
    catch (_) { return ''; }
  }
  function parseDateOnly(value) {
    try { return (typeof parseScreenListDateOnly === 'function') ? parseScreenListDateOnly(value) : null; }
    catch (_) { return null; }
  }
  function todayStartMs() {
    try { return (typeof getScreenListTodayStart === 'function') ? getScreenListTodayStart() : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime(); }
    catch (_) { return new Date().setHours(0, 0, 0, 0); }
  }
  function isTodayOrFuture(dateStr) {
    const d = parseDateOnly(dateStr);
    return !!d && d.getTime() >= todayStartMs();
  }

  /* Compute the Date the OS should fire at, given a release day string.
       • future day            → 9:00 AM that day
       • today, before 9 AM     → 9:00 AM today
       • today, on/after 9 AM   → ~20s from now (so a user opening the app on
                                   release day still gets the alert)
       • past day               → null (the OS won't fire a past notification) */
  function fireDateFor(dateStr) {
    const d = parseDateOnly(dateStr);
    if (!d) return null;
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), NOTIFY_HOUR, 0, 0, 0);
    const now = new Date();
    if (at.getTime() > now.getTime()) return at;
    if (d.getTime() === todayStartMs()) return new Date(now.getTime() + 20000);
    return null;
  }

  /* Classify a show/anime episode label into the right copy. */
  function episodeBodyFromLabel(label) {
    const l = String(label || '');
    if (/new season|season premiere/i.test(l)) return { kind: 'premiere', body: 'New season out now' };
    if (/season final|season finale/i.test(l)) return { kind: 'finale', body: 'Season finale out now' };
    return { kind: 'episode', body: 'New episode out now' };
  }

  /* For one library item, return { dateStr, kind, title, body } or null. */
  function deriveReminder(item, section) {
    const title = titleOf(item);
    if (!title) return null;
    const status = String((item && item.status) || '').toLowerCase();

    if (section === 'shows' || section === 'anime') {
      /* Only follow shows the user is actually tracking — never a dropped one. */
      if (status !== 'watching' && status !== 'planned') {
        // exception: an unreleased show sitting in any list still gets its
        // first-season premiere reminder (handled by the release-date path below).
      }
      if (status === 'watching' || status === 'planned') {
        const epDate = nextEpisodeAirDate(item);
        if (epDate && isTodayOrFuture(epDate)) {
          const { kind, body } = episodeBodyFromLabel(nextEpisodeLabel(item, section));
          return { dateStr: epDate, kind, title, body };
        }
      }
      /* No upcoming episode known → maybe the first season hasn't aired yet. */
      const firstAir = String(
        (item && (item.firstAirDate || item.first_air_date || item.premiered || item.premiereDate)) || ''
      ).trim() || knownReleaseDate(item);
      if (firstAir && isTodayOrFuture(firstAir)) {
        return { dateStr: firstAir, kind: 'series-premiere', title, body: 'Premieres today' };
      }
      return null;
    }

    if (section === 'games') {
      const dateStr = gameReleaseDate(item);
      if (dateStr && isTodayOrFuture(dateStr)) {
        return { dateStr, kind: 'game', title, body: 'Released today' };
      }
      return null;
    }

    if (section === 'music') {
      const dateStr = knownReleaseDate(item);
      if (dateStr && isTodayOrFuture(dateStr)) {
        return { dateStr, kind: 'album', title, body: 'Out now' };
      }
      return null;
    }

    /* movies (and any other dated section) */
    const dateStr = knownReleaseDate(item);
    if (dateStr && isTodayOrFuture(dateStr)) {
      return { dateStr, kind: 'movie', title, body: 'Out now' };
    }
    return null;
  }

  /* Walk the whole library → the list of reminders we WANT scheduled. */
  function collectDesiredReminders() {
    const lib = (typeof window.data === 'object' && window.data) ||
                (typeof data === 'object' && data) || null;
    if (!lib) return [];
    const out = [];
    const seenKeys = new Set();
    for (const section of SECTIONS) {
      const list = Array.isArray(lib[section]) ? lib[section] : [];
      for (const item of list) {
        const r = deriveReminder(item, section);
        if (!r) continue;
        const fireAt = fireDateFor(r.dateStr);
        if (!fireAt) continue;
        const itemId = String((item && item.id) || titleOf(item) || '').trim();
        const dedupeKey = section + ':' + itemId + ':' + r.kind + ':' + r.dateStr;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        out.push({
          id: hashId(dedupeKey),
          key: dedupeKey,
          section,
          itemId,
          title: r.title,
          body: r.body,
          fireAtMs: fireAt.getTime(),
          fireAt
        });
      }
    }
    /* Nearest releases first, capped to the iOS pending ceiling. */
    out.sort((a, b) => a.fireAtMs - b.fireAtMs);
    return out.slice(0, MAX_PENDING);
  }

  /* Diagnostics-friendly preview (works on desktop with no plugin). */
  function preview() {
    return collectDesiredReminders().map(r => ({
      title: r.title, body: r.body, when: new Date(r.fireAtMs).toString(), section: r.section, id: r.id
    }));
  }

  async function ensurePermission(plugin) {
    try {
      const check = (typeof plugin.checkPermissions === 'function') ? await plugin.checkPermissions() : null;
      if (check && check.display === 'granted') return true;
      const req = (typeof plugin.requestPermissions === 'function') ? await plugin.requestPermissions() : null;
      return !!(req && req.display === 'granted');
    } catch (e) {
      WARN('permission check failed', e && e.message);
      return false;
    }
  }

  async function getPendingIds(plugin) {
    try {
      const res = (typeof plugin.getPending === 'function') ? await plugin.getPending() : null;
      const arr = (res && Array.isArray(res.notifications)) ? res.notifications : [];
      return new Set(arr.map(n => Number(n && n.id)).filter(n => Number.isFinite(n)));
    } catch (_) { return new Set(); }
  }

  async function reconcile() {
    if (!isCapacitorIOS()) return;
    const plugin = getPlugin();
    if (!plugin) { WARN('LocalNotifications plugin unavailable — native shell needs @capacitor/local-notifications + cap sync'); return; }
    if (!currentUid()) return;
    if (scanInFlight) return;
    const now = Date.now();
    if (now - lastScanAtMs < RESCAN_THROTTLE_MS) return;
    scanInFlight = true;
    lastScanAtMs = now;
    try {
      const granted = await ensurePermission(plugin);
      if (!granted) { LOG('notification permission not granted — skipping schedule'); return; }

      const desired = collectDesiredReminders();
      const desiredById = new Map(desired.map(d => [d.id, d]));
      const prevMap = loadScheduledMap();           // { key: {id, fireAtMs, title} }
      const pendingIds = await getPendingIds(plugin); // ids the OS still has queued

      /* Schedule anything desired that the OS isn't already holding (or whose
         fire-time changed from what we last recorded). */
      const toSchedule = [];
      const nextMap = {};
      for (const d of desired) {
        const prev = prevMap[d.key];
        const alreadyQueued = pendingIds.has(d.id) && prev && Number(prev.fireAtMs) === d.fireAtMs;
        nextMap[d.key] = { id: d.id, fireAtMs: d.fireAtMs, title: d.title };
        if (!alreadyQueued) toSchedule.push(d);
      }

      /* Cancel any reminder we previously scheduled that's no longer desired
         (item removed, date changed, status changed, already fired & gone). */
      const desiredKeys = new Set(desired.map(d => d.key));
      const toCancelIds = [];
      for (const key of Object.keys(prevMap)) {
        if (desiredKeys.has(key)) continue;
        const id = Number(prevMap[key] && prevMap[key].id);
        if (Number.isFinite(id)) toCancelIds.push(id);
      }
      /* Also cancel OS-pending ids that we own (in prevMap) but dropped. */
      if (toCancelIds.length) {
        try {
          await plugin.cancel({ notifications: toCancelIds.map(id => ({ id })) });
          LOG('cancelled', toCancelIds.length, 'stale reminder(s)');
        } catch (e) { WARN('cancel failed', e && e.message); }
      }

      if (toSchedule.length) {
        const notifications = toSchedule.map(d => ({
          id: d.id,
          title: d.title,
          body: d.body,
          schedule: { at: d.fireAt, allowWhileIdle: true },
          extra: { kind: 'release', section: d.section, itemId: d.itemId, shelfdRelease: true }
        }));
        try {
          await plugin.schedule({ notifications });
          LOG('scheduled', notifications.length, 'release reminder(s); total desired', desired.length);
        } catch (e) { WARN('schedule failed', e && e.message); }
      } else {
        LOG('nothing new to schedule;', desired.length, 'reminder(s) already queued');
      }

      saveScheduledMap(nextMap);
    } catch (e) {
      WARN('reconcile error', e && e.message);
    } finally {
      scanInFlight = false;
    }
  }

  /* Tapping a release reminder opens the app to the Shelf (Planning view if we
     can). Default behaviour (just opening the app) is fine if routing helpers
     are absent. */
  function bindTapHandler(plugin) {
    try {
      plugin.addListener('localNotificationActionPerformed', (action) => {
        try {
          const extra = action && action.notification && action.notification.extra;
          if (!extra || !extra.shelfdRelease) return;
          if (typeof window.switchToTab === 'function') {
            try { window.switchToTab('mylist'); } catch (_) {}
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  /* ---------- Triggers ---------- */
  function scheduleRescan(reason) {
    LOG('rescan requested:', reason);
    reconcile();
  }

  function bootstrap() {
    if (!isCapacitorIOS()) {
      LOG('not Capacitor iOS — release reminders are native-only; exposing preview() for debugging');
      window.__shelfdReleaseReminders = { isCapacitorIOS, preview, reconcile: () => {} };
      return;
    }
    const plugin = getPlugin();
    if (plugin) bindTapHandler(plugin);

    window.__shelfdReleaseReminders = {
      isCapacitorIOS,
      preview,
      reconcile,
      rescan: () => scheduleRescan('manual'),
      clearStore: () => saveScheduledMap({})
    };

    /* Re-scan on foreground / resume (covers items added on another device, and
       the day rolling over while the app sat backgrounded). */
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') scheduleRescan('visibilitychange');
      });
    } catch (_) {}
    try {
      const app = getAppPlugin();
      if (app && typeof app.addListener === 'function') {
        app.addListener('resume', () => scheduleRescan('app-resume'));
        app.addListener('appStateChange', (s) => { if (s && s.isActive) scheduleRescan('app-active'); });
      }
    } catch (_) {}

    if (!intervalBound) {
      intervalBound = true;
      try { setInterval(() => scheduleRescan('hourly'), RESCAN_INTERVAL_MS); } catch (_) {}
    }

    /* Initial scan once the library has actually loaded. The library hydrates
       asynchronously after auth, so poll briefly until `data` has content (or a
       uid + a few attempts), then scan. Idempotent, so an early scan is safe. */
    let attempts = 0;
    const poll = () => {
      attempts++;
      const lib = (typeof window.data === 'object' && window.data) || (typeof data === 'object' && data) || null;
      const hasItems = lib && SECTIONS.some(s => Array.isArray(lib[s]) && lib[s].length);
      if (currentUid() && (hasItems || attempts >= 20)) {
        scheduleRescan('initial-load');
        return;
      }
      if (attempts < 40) setTimeout(poll, 1500);
    };
    setTimeout(poll, 2000);
    LOG('release reminders bootstrapped');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
