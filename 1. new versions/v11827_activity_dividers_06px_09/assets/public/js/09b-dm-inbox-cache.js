/* v10.761: DM INBOX DEVICE CACHE
   ────────────────────────────────────────────────────────────────────────
   PROBLEM
     Cold-tap "Direct Messages" on a fresh app launch was taking ~37s for
     the inbox row list to appear. Root cause: dmThreadMap starts {} every
     boot, so the UI has nothing to paint until two slow Firestore reads
     return:
       1. friendsDataListener reads the user doc (which mirrors the entire
          directMessageThreadMap inline — can be MBs on a heavy account)
       2. startDirectMessageSharedThreadsListener queries the shared
          dmThreads collection (where('participantUids','array-contains',uid))
     Both are deferred 1500ms past first paint (v10.697 setTimeout in
     17-comments-auth-init.js), then have to round-trip a cold connection.

   FIX
     Cache a TRIMMED snapshot of dmThreadMap (inbox-row data only — no
     message bodies) to localStorage, keyed per-uid. On boot, hydrate
     dmThreadMap synchronously from the cache BEFORE any listener attaches.
     User taps DMs → renderDirectMessagesView() paints the cached list
     instantly. When Firestore data arrives later, the existing merge
     logic (newer-wins by updatedAtMs) overlays the fresh data cleanly.

     Cache writes are debounced ~500ms and wrapped in the v843 quota guard
     (try/catch around setItem — iOS PWA / WKWebView caps localStorage at
     5MB per origin). If the write fails, the cache stays at its last good
     state; the Firestore source-of-truth is never blocked.

   WHAT IS CACHED
     For each thread, only the inbox-row fields:
       - id, participantUids, participants (profiles)
       - lastMessageText, lastMessageAtMs, lastMessageFromUid
       - unreadUids
       - createdAtMs, updatedAtMs
       - isGroup, title, photo (for group threads)
     Notably NOT cached: messages[] array. Opening an individual thread
     still does its normal read; this only solves the inbox-LIST cold start.

   KEY SCHEMA
     shelfd:dm-inbox:v1:<uid>
     → { version: 1, savedAtMs: <epoch>, threads: { [threadId]: <trimmed> } }
*/

const DM_INBOX_CACHE_PREFIX = 'shelfd:dm-inbox:v1:';
const DM_INBOX_CACHE_VERSION = 1;
const DM_INBOX_CACHE_DEBOUNCE_MS = 500;

let dmInboxCacheWriteTimer = null;
let dmInboxCacheHydratedForUid = '';

function dmInboxCacheKeyForUid(uid) {
  const cleanUid = String(uid || '').trim();
  return cleanUid ? (DM_INBOX_CACHE_PREFIX + cleanUid) : '';
}

/* Strip a full thread down to just inbox-row fields. Drops messages[]
   entirely so the cache stays under iOS quota even for chatty users. */
function trimDmThreadForInboxCache(thread = {}) {
  if (!thread || typeof thread !== 'object') return null;
  return {
    id: String(thread.id || ''),
    participantUids: Array.isArray(thread.participantUids)
      ? thread.participantUids.filter(Boolean).map(String)
      : [],
    participants: thread.participants && typeof thread.participants === 'object'
      ? thread.participants
      : {},
    lastMessageText: String(thread.lastMessageText || ''),
    lastMessageAtMs: Number(thread.lastMessageAtMs || 0) || 0,
    lastMessageFromUid: String(thread.lastMessageFromUid || ''),
    unreadUids: Array.isArray(thread.unreadUids)
      ? thread.unreadUids.filter(Boolean).map(String)
      : [],
    createdAtMs: Number(thread.createdAtMs || 0) || 0,
    updatedAtMs: Number(thread.updatedAtMs || 0) || 0,
    isGroup: !!thread.isGroup,
    title: String(thread.title || ''),
    photo: String(thread.photo || ''),
    /* Empty messages array preserves the shape that normalizeDirectMessageThread
       expects when merging — keeps downstream code from re-allocating on every
       cached thread it touches. */
    messages: []
  };
}

/* Hydrate dmThreadMap + dmThreadIds from the cache. Called from the auth
   handler the moment currentUser is assigned, BEFORE the 1.5s deferred
   listener kickoff. Returns the number of threads hydrated (for logging). */
function hydrateDmInboxFromCache(uid) {
  const key = dmInboxCacheKeyForUid(uid);
  if (!key) return 0;
  if (dmInboxCacheHydratedForUid === uid) return 0;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      dmInboxCacheHydratedForUid = uid;
      return 0;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== DM_INBOX_CACHE_VERSION || !parsed.threads) {
      dmInboxCacheHydratedForUid = uid;
      return 0;
    }
    const ids = [];
    Object.entries(parsed.threads).forEach(([threadId, cached]) => {
      if (!threadId || !cached || typeof cached !== 'object') return;
      /* Defensive: cached thread must list this uid as a participant.
         Guards against an edge case where the cache got written under
         a stale uid (e.g. mid-account-switch). */
      if (!Array.isArray(cached.participantUids) || !cached.participantUids.includes(uid)) return;
      if (typeof dmThreadMap === 'object') dmThreadMap[threadId] = cached;
      ids.push(threadId);
    });
    if (typeof dmThreadIds !== 'undefined' && Array.isArray(dmThreadIds)) {
      dmThreadIds.splice(0, dmThreadIds.length, ...[...new Set([...dmThreadIds, ...ids])]);
    }
    dmInboxCacheHydratedForUid = uid;
    return ids.length;
  } catch (e) {
    /* Bad JSON / quota read failure / disabled storage — silently skip.
       The network path still works; the user just doesn't get the instant
       paint on this launch. */
    console.warn('[dm-cache] hydrate failed:', e?.name || e?.message);
    return 0;
  }
}

/* Debounced cache write. Called from every merge into dmThreadMap.
   500ms debounce coalesces a burst of snapshot updates (Firestore tends
   to fire several events for related thread changes) into one write. */
function scheduleDmInboxCacheWrite() {
  if (dmInboxCacheWriteTimer) clearTimeout(dmInboxCacheWriteTimer);
  dmInboxCacheWriteTimer = setTimeout(() => {
    dmInboxCacheWriteTimer = null;
    writeDmInboxCacheNow();
  }, DM_INBOX_CACHE_DEBOUNCE_MS);
}

function writeDmInboxCacheNow() {
  const uid = currentUser?.uid;
  const key = dmInboxCacheKeyForUid(uid);
  if (!key) return;
  if (typeof dmThreadMap !== 'object' || !dmThreadMap) return;
  try {
    const trimmedThreads = {};
    Object.entries(dmThreadMap).forEach(([threadId, thread]) => {
      const trimmed = trimDmThreadForInboxCache(thread);
      if (trimmed && trimmed.id) trimmedThreads[trimmed.id] = trimmed;
    });
    const payload = {
      version: DM_INBOX_CACHE_VERSION,
      savedAtMs: Date.now(),
      threads: trimmedThreads
    };
    /* v843 quota guard pattern (see CLAUDE.md iOS notes). If setItem
       throws QuotaExceededError the catch swallows it and the Firestore
       write below this is unaffected. Worst case: this user's inbox
       cache stays at the last good state until quota frees up. */
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.warn('[dm-cache] inbox cache write skipped:', e?.name || e?.message);
  }
}

/* Wipe a specific uid's cache. Called from the auth handler on sign-out
   so a shared device doesn't leak the previous user's inbox preview to
   whoever signs in next. Other uids' caches stay put — different keys. */
function clearDmInboxCacheForUid(uid) {
  const key = dmInboxCacheKeyForUid(uid);
  if (!key) return;
  if (dmInboxCacheWriteTimer) {
    clearTimeout(dmInboxCacheWriteTimer);
    dmInboxCacheWriteTimer = null;
  }
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('[dm-cache] clear failed:', e?.name || e?.message);
  }
  if (dmInboxCacheHydratedForUid === uid) dmInboxCacheHydratedForUid = '';
}

if (typeof window !== 'undefined') {
  window.hydrateDmInboxFromCache = hydrateDmInboxFromCache;
  window.scheduleDmInboxCacheWrite = scheduleDmInboxCacheWrite;
  window.writeDmInboxCacheNow = writeDmInboxCacheNow;
  window.clearDmInboxCacheForUid = clearDmInboxCacheForUid;
}
