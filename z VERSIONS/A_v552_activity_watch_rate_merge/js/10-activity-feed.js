

function getActivityAction(item) {
  if (item.rating > 0) {
    const section = item.librarySection || item.mediaCategory || activeSection;
    return { verb: 'rated', extra: ` ${formatRatingValueForSection(item.rating, section, true)} &#9733;`, isRating: true };
  }
  if (item.status === 'watching') return { verb: 'is watching', extra: '', isRating: false };
  if (item.status === 'watched') return { verb: 'Finished watching!', extra: '', isRating: false };
  if (item.status === 'planned') return { verb: 'wants to watch', extra: '', isRating: false };
  return { verb: 'added', extra: '', isRating: false };
}

function getActivityEventType(activity) {
  if (activity.type === 'comment') return 'commented';
  if (activity.type === 'import-batch') return 'import-batch';
  if (activity.type === 'activity-stack') return activity.stackEventType || activity.eventType || 'added';
  const item = activity.item || {};
  const evType = activity.eventType;
  if (evType) return evType;
  if (Number(item.rating || 0) > 0) return 'rated';
  if (item.status === 'watched') return 'completed';
  if (item.status === 'watching') return 'started';
  if (item.status === 'paused') return 'paused';
  if (item.status === 'dropped') return 'dropped';
  if (item.status === 'planned') return 'planned';
  return 'added';
}

function getActivityVerbPhrase(eventType, item = {}) {
  const section = item.librarySection || item.mediaCategory || '';
  const isGame = section === 'games';
  switch (eventType) {
    case 'rated':     return 'rated';
    case 'status-changed': return 'changed status';
    case 'removed':   return 'removed';
    case 'completed': return isGame ? 'completed' : 'Finished watching!';
    case 'started':   return isGame ? 'started playing' : 'started watching';
    case 'paused':    return isGame ? 'put on hold' : 'paused';
    case 'dropped':   return 'dropped';
    case 'planned':   return isGame ? 'wants to play' : 'wants to watch';
    case 'commented': return 'commented on';
    case 'episode-watched': return 'watched an episode of';
    case 'import-batch': return 'imported';
    case 'added':     return 'added';
    default:          return 'updated';
  }
}

function getSectionLabel2(section) {
  if (section === 'movies') return 'Movie';
  if (section === 'anime') return 'Anime';
  if (section === 'games') return 'Game';
  if (section === 'shows') return 'TV Show';
  return '';
}

function renderPreviewFriendActivity() {
  const feed = document.getElementById('friend-activity-feed');
  if (!feed) return;
  PREVIEW_COMMUNITY_USERS.forEach(user => { usersMap[user.uid] = user; });
  const demo = PREVIEW_COMMUNITY_USERS.map((user, index) => {
    const sections = ['shows', 'movies', 'anime', 'games'];
    const item = sections.flatMap(section => user.listData[section] || []).find(entry => entry.title);
    return item ? { uid: user.uid, name: user.name, photo: user.photo, item: { ...item, dateAdded: new Date(Date.now() - (index + 1) * 45 * 60000).toISOString() } } : null;
  }).filter(Boolean);
  if (!demo.length) {
    feed.innerHTML = '<div class="discover-message">Preview activity appears here with demo profiles.</div>';
    return;
  }
  renderFriendActivityItems(feed, demo);
}

let friendActivityClickTargets = {};
const screenListExpandedInlineActivityStacks = new Set();

function screenlistStableHash(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getStableActivityDocId(activity = {}, fallbackId = '') {
  if (!activity || typeof activity !== 'object') return String(fallbackId || '').trim();
  if ((activity.type === 'post' || activity.type === 'trailer') && (activity.postId || activity.id)) {
    return String(activity.postId || activity.id).trim();
  }
  const item = activity.item || {};
  const eventType = getActivityEventType(activity);
  const uid = String(activity.uid || '').trim();
  const section = String(item.librarySection || item.mediaCategory || '').trim();
  const mediaKey = String(activity.mediaKey || getMediaKey(item) || item.mediaKey || item.tmdbId || item.rawgId || item.id || item.itemId || item.title || '').trim();
  const timestamp = parseFriendActivityTime(activity.timestamp || item.dateModified || item.dateAdded || item.updatedAt || item.createdAt) || '';
  const rawKey = [uid, eventType, section, mediaKey, timestamp].filter(Boolean).join('|') || String(fallbackId || 'activity');
  return 'activity-' + screenlistStableHash(rawKey);
}


const SCREENLIST_ACTIVITY_DELETED_IDS_FIELD = 'activityDeletedIds';
const SCREENLIST_ACTIVITY_DELETED_LOCAL_PREFIX = 'screenlist-deleted-activity-ids-';

function getScreenListTrashIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
}

function getScreenListDeletedActivityLocalKey(uid = '') {
  const cleanUid = String(uid || currentUser?.uid || '').trim();
  return cleanUid ? `${SCREENLIST_ACTIVITY_DELETED_LOCAL_PREFIX}${cleanUid}` : '';
}

function readScreenListDeletedActivityLocalIds(uid = '') {
  const key = getScreenListDeletedActivityLocalKey(uid);
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function writeScreenListDeletedActivityLocalIds(uid = '', ids = []) {
  const key = getScreenListDeletedActivityLocalKey(uid);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(new Set((ids || []).map(String).filter(Boolean))).slice(-500)));
  } catch (error) {}
}

function getScreenListActivityFamilyDeleteKey(activity = {}) {
  if (!activity || typeof activity !== 'object') return '';
  const item = activity.item || {};
  const uid = String(activity.uid || '').trim();
  const eventType = getActivityEventType(activity);
  const section = String(item.librarySection || item.mediaCategory || '').trim();
  const mediaKey = String(activity.mediaKey || getMediaKey(item) || item.mediaKey || item.tmdbId || item.rawgId || item.id || item.itemId || item.title || '').trim();
  const timestamp = parseFriendActivityTime(activity.timestamp || item.dateModified || item.dateAdded || item.updatedAt || item.createdAt) || 0;
  const bucket = timestamp ? Math.floor(timestamp / 60000) : 0;
  if (!uid || !eventType || !section || !mediaKey || !bucket) return '';
  return 'activity-family-' + screenlistStableHash([uid, eventType, section, mediaKey, bucket].join('|'));
}

function getScreenListStackChildDeleteCandidates(activity = {}) {
  if (!activity || activity.type !== 'activity-stack' || !Array.isArray(activity.stackedActivities)) return [];
  return activity.stackedActivities.flatMap(child => getScreenListActivityDeleteCandidates(child, child?.eventKey || child?.id || child?.activityId || ''));
}

function getScreenListActivityDeleteCandidates(activity = {}, fallbackId = '') {
  const ids = new Set();
  [fallbackId, activity.id, activity.activityId, activity.originalActivityId, activity.postId, activity.eventKey].forEach(value => {
    const clean = String(value || '').trim();
    if (clean) ids.add(clean);
  });
  const stableId = getStableActivityDocId(activity, fallbackId);
  if (stableId) ids.add(stableId);
  const familyKey = getScreenListActivityFamilyDeleteKey(activity);
  if (familyKey) ids.add(familyKey);
  if (activity.type === 'activity-stack') {
    getScreenListStackChildDeleteCandidates(activity).forEach(id => { if (id) ids.add(String(id)); });
  }
  return Array.from(ids);
}

function getScreenListDeletedActivityIdsForUser(uid = '', userLike = null) {
  const cleanUid = String(uid || userLike?.uid || '').trim();
  const ids = new Set();
  const userIds = Array.isArray(userLike?.[SCREENLIST_ACTIVITY_DELETED_IDS_FIELD])
    ? userLike[SCREENLIST_ACTIVITY_DELETED_IDS_FIELD]
    : [];
  userIds.forEach(id => { if (id) ids.add(String(id)); });
  if (cleanUid && currentUser?.uid === cleanUid) {
    readScreenListDeletedActivityLocalIds(cleanUid).forEach(id => ids.add(id));
  }
  return ids;
}

function rememberCurrentUserDeletedActivityIds(ids = []) {
  if (!currentUser?.uid) return;
  const cleanIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  if (!cleanIds.length) return;
  const uid = currentUser.uid;
  const existingLocal = readScreenListDeletedActivityLocalIds(uid);
  writeScreenListDeletedActivityLocalIds(uid, [...existingLocal, ...cleanIds]);
  const existingUserIds = Array.isArray(usersMap?.[uid]?.[SCREENLIST_ACTIVITY_DELETED_IDS_FIELD])
    ? usersMap[uid][SCREENLIST_ACTIVITY_DELETED_IDS_FIELD]
    : [];
  if (!usersMap[uid]) usersMap[uid] = { uid };
  usersMap[uid][SCREENLIST_ACTIVITY_DELETED_IDS_FIELD] = Array.from(new Set([...existingUserIds, ...cleanIds]));
  if (typeof userProfile === 'object' && userProfile) {
    const existingProfileIds = Array.isArray(userProfile[SCREENLIST_ACTIVITY_DELETED_IDS_FIELD])
      ? userProfile[SCREENLIST_ACTIVITY_DELETED_IDS_FIELD]
      : [];
    userProfile[SCREENLIST_ACTIVITY_DELETED_IDS_FIELD] = Array.from(new Set([...existingProfileIds, ...cleanIds]));
  }
}

async function persistCurrentUserDeletedActivityIds(ids = []) {
  const cleanIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
  if (!currentUser?.uid || !cleanIds.length) return;
  rememberCurrentUserDeletedActivityIds(cleanIds);
  if (typeof firebase !== 'undefined' && firebase.firestore?.FieldValue?.arrayUnion) {
    await db.collection('users').doc(currentUser.uid).set({
      [SCREENLIST_ACTIVITY_DELETED_IDS_FIELD]: firebase.firestore.FieldValue.arrayUnion(...cleanIds),
      activityDeletedAt: Date.now()
    }, { merge: true });
  } else {
    const existingIds = Array.from(getScreenListDeletedActivityIdsForUser(currentUser.uid, usersMap[currentUser.uid] || userProfile || {}));
    await db.collection('users').doc(currentUser.uid).set({
      [SCREENLIST_ACTIVITY_DELETED_IDS_FIELD]: Array.from(new Set([...existingIds, ...cleanIds])),
      activityDeletedAt: Date.now()
    }, { merge: true });
  }
}

function isScreenListActivityDeletedForOwner(activity = {}, fallbackId = '') {
  if (!activity || activity.deletedByOwner) return !!activity?.deletedByOwner;
  const uid = String(activity.uid || '').trim();
  if (!uid) return false;
  const owner = usersMap?.[uid] || (currentUser?.uid === uid ? userProfile : null) || {};
  const deletedIds = getScreenListDeletedActivityIdsForUser(uid, owner);
  if (!deletedIds.size) return false;
  return getScreenListActivityDeleteCandidates(activity, fallbackId).some(id => deletedIds.has(id));
}

function canCurrentUserDeleteActivity(activity = {}) {
  if (!currentUser?.uid || !activity) return false;
  if (String(activity.uid || '').trim() !== currentUser.uid) return false;
  if (activity.type === 'comment') return false;
  return true;
}

function purgeDeletedActivityFromMemory(ids = []) {
  const idSet = new Set((ids || []).map(String).filter(Boolean));
  if (!idSet.size) return;
  const shouldKeep = activity => !getScreenListActivityDeleteCandidates(activity, activity?.id || activity?.activityId || activity?.eventKey || '').some(id => idSet.has(id));
  if (friendActivityCache?.activities) friendActivityCache.activities = friendActivityCache.activities.filter(shouldKeep);
  if (Array.isArray(friendActivityLiveEvents)) friendActivityLiveEvents = friendActivityLiveEvents.filter(shouldKeep);
  if (Array.isArray(window.feedPosts)) window.feedPosts = window.feedPosts.filter(shouldKeep);
  Object.keys(friendActivityClickTargets || {}).forEach(key => {
    const activity = friendActivityClickTargets[key];
    if (!shouldKeep({ ...activity, id: key })) delete friendActivityClickTargets[key];
  });
  document.querySelectorAll('[data-activity-card-id], [data-activity-id], [data-post-id]').forEach(card => {
    const values = [card.getAttribute('data-activity-card-id'), card.getAttribute('data-activity-id'), card.getAttribute('data-post-id')].filter(Boolean);
    if (values.some(value => idSet.has(String(value)))) card.remove();
  });
}


const SCREENLIST_ACTIVITY_MERGE_WINDOW_MS = 6 * 60 * 60 * 1000;

function isScreenListMergeableLibraryActivity(activity = {}) {
  if (!activity || activity.type === 'comment' || activity.type === 'post' || activity.type === 'trailer') return false;
  const item = activity.item || {};
  const section = String(item.librarySection || item.mediaCategory || '').trim();
  if (!section) return false;
  const eventType = getActivityEventType(activity);
  /* v552: episode-watched is now mergeable so a watch+rate pair within the
     same window collapses into ONE activity card showing both signals. */
  return ['added', 'rated', 'status-changed', 'completed', 'started', 'planned', 'paused', 'dropped', 'episode-watched'].includes(eventType);
}

function getScreenListActivityMergeKey(activity = {}) {
  const item = activity.item || {};
  const uid = String(activity.uid || '').trim();
  const section = String(item.librarySection || item.mediaCategory || '').trim();
  const mediaKey = String(activity.mediaKey || getMediaKey(item) || item.mediaKey || '').trim();
  const fallbackTitle = String(item.title || item.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!uid || !section || (!mediaKey && !fallbackTitle)) return '';
  return [uid, section, mediaKey || fallbackTitle].join('|');
}

function mergeScreenListActivityPair(base = {}, incoming = {}) {
  const baseTime = parseFriendActivityTime(base.timestamp || base.item?.dateModified || base.item?.dateAdded);
  const incomingTime = parseFriendActivityTime(incoming.timestamp || incoming.item?.dateModified || incoming.item?.dateAdded);
  const newer = incomingTime >= baseTime ? incoming : base;
  const older = incomingTime >= baseTime ? base : incoming;
  const mergedItem = { ...(older.item || {}), ...(newer.item || {}) };
  const olderRating = Number(older.item?.rating || older.rating || 0);
  const newerRating = Number(newer.item?.rating || newer.rating || 0);
  if (!Number(mergedItem.rating || 0) && (newerRating || olderRating)) mergedItem.rating = newerRating || olderRating;
  ['cover', 'igdbCoverUrl', 'poster', 'image', 'background_image'].forEach(key => {
    if (!mergedItem[key] && older.item?.[key]) mergedItem[key] = older.item[key];
  });
  /* v552: when merging episode-watched + rated/etc, preserve episode metadata
     so the combined card can render "watched episode X, rated 9". */
  ['lastEpisodeActivityAt', 'lastEpisodeActivityCount', 'lastEpisodeActivityLabel'].forEach(key => {
    if (!mergedItem[key]) {
      if (newer.item?.[key]) mergedItem[key] = newer.item[key];
      else if (older.item?.[key]) mergedItem[key] = older.item[key];
    }
  });
  /* Choose merged eventType: 'rated' wins over 'episode-watched' so the
     rating chip surfaces; episode info is preserved in mergedItem and
     surfaced by the verb renderer. */
  const olderEvent = older.eventType || '';
  const newerEvent = newer.eventType || '';
  const eventTypes = [olderEvent, newerEvent];
  const PRIORITY = ['rated', 'completed', 'started', 'status-changed', 'episode-watched', 'planned', 'paused', 'dropped', 'added'];
  let chosenEvent = newerEvent || olderEvent || 'added';
  for (const candidate of PRIORITY) {
    if (eventTypes.includes(candidate)) { chosenEvent = candidate; break; }
  }
  return {
    ...older,
    ...newer,
    item: mergedItem,
    timestamp: newer.timestamp || incoming.timestamp || base.timestamp,
    eventType: chosenEvent,
    nextStatus: newer.nextStatus || mergedItem.status || older.nextStatus || '',
    eventKey: `merged:${getScreenListActivityMergeKey(newer) || getScreenListActivityMergeKey(older)}:${Math.min(baseTime || incomingTime || Date.now(), incomingTime || baseTime || Date.now())}`,
    mergedActivityActions: true,
    /* v552: explicit flag so the renderer knows this card represents a
       watch + rate pair (or watch + status, etc.) */
    mergedHadEpisodeWatch: eventTypes.includes('episode-watched') || !!mergedItem.lastEpisodeActivityAt
  };
}

function mergeRelatedLibraryActivities(activities = []) {
  const ordered = Array.isArray(activities) ? activities.slice().sort((a, b) => parseFriendActivityTime(a.timestamp || a.item?.dateAdded) - parseFriendActivityTime(b.timestamp || b.item?.dateAdded)) : [];
  const merged = [];
  const latestByKey = new Map();
  ordered.forEach(activity => {
    if (!isScreenListMergeableLibraryActivity(activity)) {
      merged.push(activity);
      return;
    }
    const key = getScreenListActivityMergeKey(activity);
    const currentTime = parseFriendActivityTime(activity.timestamp || activity.item?.dateModified || activity.item?.dateAdded);
    const existingIndex = key ? latestByKey.get(key) : undefined;
    const existing = existingIndex !== undefined ? merged[existingIndex] : null;
    const existingTime = existing ? parseFriendActivityTime(existing.timestamp || existing.item?.dateModified || existing.item?.dateAdded) : 0;
    if (existing && Math.abs(currentTime - existingTime) <= SCREENLIST_ACTIVITY_MERGE_WINDOW_MS) {
      merged[existingIndex] = mergeScreenListActivityPair(existing, activity);
      latestByKey.set(key, existingIndex);
    } else {
      latestByKey.set(key, merged.length);
      merged.push(activity);
    }
  });
  return merged;
}



const SCREENLIST_IMPORT_ACTIVITY_GROUP_WINDOW_MS = 12 * 60 * 1000;
const SCREENLIST_IMPORT_ACTIVITY_MIN_GROUP_SIZE = 3;

function getScreenListImportSourceLabel(source = '') {
  const key = String(source || '').trim().toLowerCase();
  return ({
    steam: 'Steam',
    myanimelist: 'MyAnimeList',
    backloggd: 'Backloggd',
    letterboxd: 'Letterboxd',
    imdb: 'IMDb'
  })[key] || 'Import';
}

function isScreenListImportAddedActivity(activity = {}) {
  if (!activity || activity.type === 'comment' || activity.type === 'post' || activity.type === 'trailer' || activity.type === 'import-batch') return false;
  const item = activity.item || {};
  // v464: any activity whose item carries an importBatchId is part of a bulk
  // import — include it regardless of eventType. Re-importing a Steam library
  // bumps `dateModified` on existing games (playtime sync), which creates
  // 'status-changed' activities; mergeRelatedLibraryActivities then collapses
  // each game's added+status pair into one activity whose newer eventType is
  // 'status-changed'. The old `eventType !== 'added'` guard threw those out
  // of the import grouping, so they reappeared as standalone activity cards
  // next to the import card. Trusting importBatchId fixes that.
  if (item.importBatchId) return true;
  const eventType = getActivityEventType(activity);
  if (eventType !== 'added') return false;
  const source = String(item.importSource || item.source || activity.importSource || '').trim().toLowerCase();
  return ['steam', 'myanimelist', 'backloggd', 'letterboxd', 'imdb'].includes(source);
}

function getScreenListImportActivityGroupKey(activity = {}) {
  const item = activity.item || {};
  const uid = String(activity.uid || '').trim();
  const source = String(item.importSource || item.source || activity.importSource || 'import').trim().toLowerCase();
  const section = String(item.librarySection || item.mediaCategory || '').trim();
  const batchId = String(item.importBatchId || activity.importBatchId || '').trim();
  if (batchId) return [uid, source, section, batchId].filter(Boolean).join('|');
  const ts = parseFriendActivityTime(activity.timestamp || item.dateAdded || item.importedAt);
  const bucket = ts ? Math.floor(ts / SCREENLIST_IMPORT_ACTIVITY_GROUP_WINDOW_MS) : 0;
  return [uid, source, section, bucket].filter(Boolean).join('|');
}

function buildScreenListImportBatchActivity(group = []) {
  const items = group.map(activity => ({ ...(activity.item || {}) }));
  const first = group[0] || {};
  const firstItem = first.item || {};
  const latest = group.reduce((best, activity) => {
    const bestTime = parseFriendActivityTime(best.timestamp || best.item?.dateAdded || best.item?.importedAt);
    const nextTime = parseFriendActivityTime(activity.timestamp || activity.item?.dateAdded || activity.item?.importedAt);
    return nextTime >= bestTime ? activity : best;
  }, first);
  const source = String(firstItem.importSource || firstItem.source || first.importSource || 'import').trim().toLowerCase();
  const section = String(firstItem.librarySection || firstItem.mediaCategory || '').trim();
  const statusCounts = items.reduce((acc, item) => {
    const status = String(item.status || 'planned').trim();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return {
    type: 'import-batch',
    eventType: 'import-batch',
    uid: first.uid,
    name: first.name,
    photo: first.photo,
    importSource: source,
    importSourceLabel: getScreenListImportSourceLabel(source),
    importSection: section,
    importStatusCounts: statusCounts,
    importItems: items,
    item: {
      title: `${getScreenListImportSourceLabel(source)} import`,
      librarySection: section,
      mediaCategory: section,
      dateAdded: latest.timestamp || latest.item?.dateAdded || latest.item?.importedAt || first.timestamp || firstItem.dateAdded || '',
      importBatchId: firstItem.importBatchId || first.importBatchId || '',
      importSource: source
    },
    timestamp: latest.timestamp || latest.item?.dateAdded || latest.item?.importedAt || first.timestamp || firstItem.dateAdded || Date.now(),
    eventKey: `import-batch:${getScreenListImportActivityGroupKey(first)}:${items.length}`
  };
}

function collapseImportBatchActivities(activities = []) {
  const source = Array.isArray(activities) ? activities : [];
  const groups = new Map();
  source.forEach(activity => {
    if (!isScreenListImportAddedActivity(activity)) return;
    const key = getScreenListImportActivityGroupKey(activity);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(activity);
  });

  const collapsedKeys = new Set();
  const collapsedByKey = new Map();
  groups.forEach((group, key) => {
    // v464: groups whose items carry an importBatchId always collapse, even
    // for size 1 — the user's intent is "every bulk-import title goes into
    // the import card". The MIN_GROUP_SIZE floor only applies to source-only
    // fallback groups (items with importSource but no batchId), which can
    // include single MAL/Backloggd search-modal adds we don't want to wrap.
    const hasBatchId = group.some(activity => !!(activity?.item?.importBatchId));
    const minSize = hasBatchId ? 1 : SCREENLIST_IMPORT_ACTIVITY_MIN_GROUP_SIZE;
    if (group.length < minSize) return;
    collapsedKeys.add(key);
    collapsedByKey.set(key, buildScreenListImportBatchActivity(group));
  });
  if (!collapsedKeys.size) return source;

  const emitted = new Set();
  const result = [];
  source.forEach(activity => {
    if (!isScreenListImportAddedActivity(activity)) {
      result.push(activity);
      return;
    }
    const key = getScreenListImportActivityGroupKey(activity);
    if (!collapsedKeys.has(key)) {
      result.push(activity);
      return;
    }
    if (emitted.has(key)) return;
    emitted.add(key);
    result.push(collapsedByKey.get(key));
  });

  return result;
}

const SCREENLIST_STACKED_ACTIVITY_GROUP_WINDOW_MS = 30 * 60 * 1000;
const SCREENLIST_STACKED_ACTIVITY_MIN_GROUP_SIZE = 3;

function getScreenListStackedActivityType(activity = {}) {
  if (!activity || activity.type === 'activity-stack' || activity.type === 'import-batch' || activity.type === 'post' || activity.type === 'trailer') return '';
  const eventType = getActivityEventType(activity);
  if (eventType === 'commented' || activity.type === 'comment') return 'commented';
  if (eventType === 'rated') return 'rated';
  if (eventType === 'added' || eventType === 'planned' || eventType === 'wishlist') return 'added';
  if (eventType === 'status-changed' || eventType === 'completed' || eventType === 'started' || eventType === 'paused' || eventType === 'dropped') return 'status';
  return '';
}

function getScreenListStackedActivityTimestamp(activity = {}) {
  return parseFriendActivityTime(activity.timestamp || activity.item?.dateModified || activity.item?.dateAdded || activity.updatedAt || activity.createdAt);
}

function getScreenListStackedActivityBucket(activity = {}) {
  const ts = getScreenListStackedActivityTimestamp(activity);
  return ts ? Math.floor(ts / SCREENLIST_STACKED_ACTIVITY_GROUP_WINDOW_MS) : 0;
}

function getScreenListStackedActivityGroupKey(activity = {}) {
  const uid = String(activity.uid || '').trim();
  const stackType = getScreenListStackedActivityType(activity);
  const bucket = getScreenListStackedActivityBucket(activity);
  if (!uid || !stackType || !bucket) return '';
  return [uid, stackType, bucket].join('|');
}

function cloneScreenListStackActivity(activity = {}) {
  return {
    ...activity,
    item: cloneFriendActivityItem(activity.item || {})
  };
}

function getScreenListStackedActivityTypeLabel(type = '', count = 0) {
  const total = Math.max(0, Number(count) || 0);
  if (type === 'rated') return `rated ${total} title${total === 1 ? '' : 's'}`;
  if (type === 'commented') return `commented on ${total} title${total === 1 ? '' : 's'}`;
  if (type === 'status') return `changed status on ${total} title${total === 1 ? '' : 's'}`;
  return `added ${total} title${total === 1 ? '' : 's'}`;
}

function buildScreenListStackedActivity(group = [], key = '') {
  const sorted = group
    .map(cloneScreenListStackActivity)
    .sort((a, b) => getScreenListStackedActivityTimestamp(b) - getScreenListStackedActivityTimestamp(a));
  const primary = sorted[0] || {};
  const stackType = getScreenListStackedActivityType(primary) || 'added';
  const newestTime = getScreenListStackedActivityTimestamp(primary) || Date.now();
  return {
    ...primary,
    type: 'activity-stack',
    stackEventType: stackType,
    stackGroupKey: key,
    stackCount: sorted.length,
    stackLabel: getScreenListStackedActivityTypeLabel(stackType, sorted.length),
    stackedActivities: sorted,
    stackPrimaryActivity: primary,
    timestamp: primary.timestamp || newestTime,
    eventKey: `activity-stack:${key}:${sorted.length}:${newestTime}`
  };
}

function collapseStackedActivityBurstActivities(activities = []) {
  const source = Array.isArray(activities) ? activities : [];
  const groups = new Map();
  source.forEach(activity => {
    const key = getScreenListStackedActivityGroupKey(activity);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(activity);
  });

  const collapsedKeys = new Set();
  const collapsedByKey = new Map();
  groups.forEach((group, key) => {
    if (group.length < SCREENLIST_STACKED_ACTIVITY_MIN_GROUP_SIZE) return;
    collapsedKeys.add(key);
    collapsedByKey.set(key, buildScreenListStackedActivity(group, key));
  });
  if (!collapsedKeys.size) return source;

  const emitted = new Set();
  const result = [];
  source.forEach(activity => {
    const key = getScreenListStackedActivityGroupKey(activity);
    if (!key || !collapsedKeys.has(key)) {
      result.push(activity);
      return;
    }
    if (emitted.has(key)) return;
    emitted.add(key);
    result.push(collapsedByKey.get(key));
  });
  return result;
}

function ensureScreenListStackedActivityPage() {
  let page = document.getElementById('screenlist-stacked-activity-page');
  if (page) return page;
  page = document.createElement('div');
  page.id = 'screenlist-stacked-activity-page';
  page.className = 'screenlist-stacked-activity-page activity-page';
  page.style.display = 'none';
  page.innerHTML = `
    <div class="screenlist-stacked-activity-scrim" onclick="closeScreenListStackedActivityPage()"></div>
    <section class="screenlist-stacked-activity-sheet" role="dialog" aria-modal="true" aria-labelledby="screenlist-stacked-activity-title">
      <div class="screenlist-stacked-activity-handle" aria-hidden="true"></div>
      <div class="screenlist-stacked-activity-topbar">
        <button class="screenlist-stacked-activity-back" type="button" onclick="closeScreenListStackedActivityPage()">Back</button>
        <div>
          <h2 id="screenlist-stacked-activity-title">Grouped activity</h2>
          <p id="screenlist-stacked-activity-subtitle"></p>
        </div>
      </div>
      <div class="screenlist-stacked-activity-list" id="screenlist-stacked-activity-list"></div>
    </section>`;
  document.body.appendChild(page);
  return page;
}

function openScreenListStackedActivityPage(activityId = '') {
  const cleanId = String(activityId || '').trim();
  const stack = friendActivityClickTargets[cleanId];
  const items = Array.isArray(stack?.stackedActivities) ? stack.stackedActivities : [];
  if (!items.length) {
    const fallback = stack?.stackPrimaryActivity || stack;
    if (fallback && fallback.type !== 'activity-stack') handleScreenListActivityCardOpen(cleanId, 'activity');
    return;
  }

  const page = ensureScreenListStackedActivityPage();
  const list = page.querySelector('#screenlist-stacked-activity-list');
  const title = page.querySelector('#screenlist-stacked-activity-title');
  const subtitle = page.querySelector('#screenlist-stacked-activity-subtitle');
  const stackType = stack.stackEventType || getScreenListStackedActivityType(items[0]) || 'added';
  if (title) title.textContent = getScreenListStackedActivityTypeLabel(stackType, items.length);
  if (subtitle) subtitle.textContent = 'Newest to oldest';

  if (list) {
    list.innerHTML = items.map((activity, index) => {
      const childId = `${cleanId}-stack-${index}`;
      friendActivityClickTargets[childId] = activity;
      return buildActivityCardHTML(activity, childId, { hideStories: true });
    }).join('');
  }

  page.style.display = 'block';
  document.body.classList.add('screenlist-stacked-activity-open');
  requestAnimationFrame(() => page.classList.add('open'));
  hydrateActivityInteractionCounts(page);
  scheduleBackfillActivityGamePosters(page);
}

function closeScreenListStackedActivityPage() {
  const page = document.getElementById('screenlist-stacked-activity-page');
  if (!page) return;
  page.classList.remove('open');
  document.body.classList.remove('screenlist-stacked-activity-open');
  setTimeout(() => {
    if (!page.classList.contains('open')) page.style.display = 'none';
  }, 260);
}

function setScreenListInlineActivityStackExpanded(wrapper, expanded) {
  if (!wrapper) return;
  const stackId = wrapper.getAttribute('data-stacked-activity-id') || '';
  const panel = wrapper.querySelector('[data-inline-stack-panel]');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Logical + accessibility state always updates immediately
  if (stackId) {
    if (expanded) screenListExpandedInlineActivityStacks.add(stackId);
    else screenListExpandedInlineActivityStacks.delete(stackId);
  }
  wrapper.querySelectorAll('[data-inline-stack-toggle]').forEach(btn => {
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });
  if (!panel) { wrapper.classList.toggle('is-expanded', !!expanded); return; }
  panel.setAttribute('aria-hidden', expanded ? 'false' : 'true');

  if (expanded) {
    wrapper.classList.add('is-expanded');
    if (reduceMotion) return;
    const inner = panel.querySelector('.sl-activity-stack-inline-inner');
    if (inner) _slExpandStack(panel, inner);
  } else {
    if (reduceMotion) { wrapper.classList.remove('is-expanded'); return; }
    const inner = panel.querySelector('.sl-activity-stack-inline-inner');
    if (!inner) { wrapper.classList.remove('is-expanded'); return; }
    _slCollapseStack(wrapper, panel, inner);
  }
}

// Expand: inner container slides in from above (composited translateY + opacity)
function _slExpandStack(panel, inner) {
  const sp = (el, prop, val) => el.style.setProperty(prop, val, 'important');
  const cp = (el, ...props) => props.forEach(p => el.style.removeProperty(p));
  // Clear any lingering collapse-animation inline styles on cards
  panel.querySelectorAll('.sl-activity-stack-compact-card').forEach(c =>
    cp(c, 'will-change', 'transition', 'transform', 'opacity'));
  // Cancel any in-progress animation on inner
  cp(inner, 'will-change', 'transition', 'transform', 'opacity');
  // Measure natural height (one layout read)
  sp(panel, 'height', 'auto');
  sp(panel, 'overflow', 'hidden');
  sp(panel, 'visibility', 'hidden');
  const h = panel.scrollHeight;
  cp(panel, 'visibility');
  // Snap panel to full height; inner starts above clip boundary
  sp(panel, 'height', h + 'px');
  sp(panel, 'margin-top', 'clamp(10px, 2.8vw, 14px)');
  sp(inner, 'will-change', 'transform, opacity');
  sp(inner, 'transition', 'none');
  sp(inner, 'transform', 'translateY(' + (-(h + 8)) + 'px)');
  sp(inner, 'opacity', '0');
  requestAnimationFrame(() => {
    sp(inner, 'transition', 'transform 260ms cubic-bezier(.22, 1, .36, 1), opacity 220ms ease');
    sp(inner, 'transform', 'translateY(0px)');
    sp(inner, 'opacity', '1');
    inner.addEventListener('transitionend', function onExpandEnd(e) {
      if (e.propertyName !== 'transform') return;
      inner.removeEventListener('transitionend', onExpandEnd);
      cp(inner, 'will-change', 'transition', 'transform', 'opacity');
      sp(panel, 'height', 'auto');
    });
  });
}

// Collapse: exact reverse of expand — inner container slides upward out of clip boundary
function _slCollapseStack(wrapper, panel, inner) {
  const sp = (el, prop, val) => el.style.setProperty(prop, val, 'important');
  const cp = (el, ...props) => props.forEach(p => el.style.removeProperty(p));
  // Cancel any in-progress expand animation on inner
  cp(inner, 'will-change', 'transition', 'transform', 'opacity');
  // Lock panel at current height (one layout read)
  const h = panel.scrollHeight;
  sp(panel, 'height', h + 'px');
  sp(panel, 'overflow', 'hidden');
  // Confirm inner at resting state before reversing
  sp(inner, 'will-change', 'transform, opacity');
  sp(inner, 'transition', 'none');
  sp(inner, 'transform', 'translateY(0px)');
  sp(inner, 'opacity', '1');
  // Next frame: reverse of expand — same path, mirrored easing, same duration
  requestAnimationFrame(() => {
    sp(inner, 'transition', 'transform 260ms cubic-bezier(.64,0,.78,0), opacity 220ms ease-in');
    sp(inner, 'transform', 'translateY(' + (-(h + 8)) + 'px)');
    sp(inner, 'opacity', '0');
    inner.addEventListener('transitionend', function onCollapseEnd(e) {
      if (e.propertyName !== 'transform') return;
      inner.removeEventListener('transitionend', onCollapseEnd);
      cp(inner, 'will-change', 'transition', 'transform', 'opacity');
      wrapper.classList.remove('is-expanded');
      cp(panel, 'height', 'margin-top', 'overflow');
    });
  });
}

function toggleScreenListInlineActivityStack(activityId = '', event) {
  if (event?.stopPropagation) event.stopPropagation();
  const cleanId = String(activityId || '').trim();
  if (!cleanId) return;
  const wrapper = Array.from(document.querySelectorAll('[data-stacked-activity-id]')).find(el => el.getAttribute('data-stacked-activity-id') === cleanId);
  if (!wrapper) return;
  setScreenListInlineActivityStackExpanded(wrapper, !wrapper.classList.contains('is-expanded'));
}

// v433: clicking the body of an expanded stacked child collapses the parent
// stack from anywhere in the dropdown — no need to scroll back up to the front
// card. Inner buttons (avatar/poster/heart/comment/delete) already call
// event.stopPropagation(), so they never reach this article-level click.
function handleScreenListStackChildClick(childId = '', stackActivityId = '', event) {
  const cleanStackId = String(stackActivityId || '').trim();
  const wrapper = cleanStackId
    ? Array.from(document.querySelectorAll('[data-stacked-activity-id]')).find(el => el.getAttribute('data-stacked-activity-id') === cleanStackId)
    : null;
  if (wrapper && wrapper.classList.contains('is-expanded')) {
    if (event?.stopPropagation) event.stopPropagation();
    setScreenListInlineActivityStackExpanded(wrapper, false);
    return;
  }
  // Stack already collapsed (rare race) — fall back to opening the child's
  // detail page so the card never feels broken.
  if (typeof handleScreenListActivityCardOpen === 'function') {
    handleScreenListActivityCardOpen(String(childId || ''), 'activity');
  }
}

async function resolveActivityInteractionTarget(activityId = '') {
  const rawId = String(activityId || '').trim();
  if (!rawId) return null;

  const feedDoc = db.collection('feed').doc(rawId);
  const feedSnap = await feedDoc.get();
  if (feedSnap.exists) {
    return { id: rawId, collection: 'feed', ref: feedDoc, activity: { ...feedSnap.data(), id: rawId, _collection: 'feed' } };
  }

  const activityDoc = db.collection('activities').doc(rawId);
  const activitySnap = await activityDoc.get();
  if (activitySnap.exists) {
    return { id: rawId, collection: 'activities', ref: activityDoc, activity: { ...activitySnap.data(), id: rawId, _collection: 'activities' } };
  }

  const inMemoryActivity = friendActivityClickTargets[rawId];
  if (!inMemoryActivity) return null;

  const stableId = getStableActivityDocId(inMemoryActivity, rawId);
  const stableRef = db.collection('activities').doc(stableId);
  const stableSnap = await stableRef.get();
  if (!stableSnap.exists) {
    const baseActivity = {
      ...inMemoryActivity,
      id: stableId,
      activityId: stableId,
      originalActivityId: rawId,
      likes: Array.isArray(inMemoryActivity.likes) ? inMemoryActivity.likes : [],
      replies: Array.isArray(inMemoryActivity.replies) ? inMemoryActivity.replies : []
    };
    await stableRef.set(baseActivity, { merge: true });
    return { id: stableId, collection: 'activities', ref: stableRef, activity: { ...baseActivity, _collection: 'activities' } };
  }

  const mergedStableActivity = { ...inMemoryActivity, ...stableSnap.data(), id: stableId, activityId: stableId, originalActivityId: rawId };
  return { id: stableId, collection: 'activities', ref: stableRef, activity: { ...mergedStableActivity, _collection: 'activities' } };
}


function getScreenListReplyIconSvg() {
  return `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
}

function getScreenListHeartIconSvg(isLiked = false) {
  return isLiked
    ? `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
    : `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

function getActivityReplyCountValue(activity = {}) {
  return Array.isArray(activity.replies) ? activity.replies.length : 0;
}

function getActivityLikeCountValue(activity = {}) {
  return Array.isArray(activity.likes) ? activity.likes.length : 0;
}

function isActivityLikedByCurrentUser(activity = {}) {
  return !!(currentUser && Array.isArray(activity.likes) && activity.likes.includes(currentUser.uid));
}

function updateActivityInteractionCardState(card, activity = {}) {
  if (!card) return;
  const likes = Array.isArray(activity.likes) ? activity.likes : [];
  const replies = Array.isArray(activity.replies) ? activity.replies : [];
  const isLiked = currentUser && likes.includes(currentUser.uid);
  const replyCount = replies.length;
  const likeCount = likes.length;
  const replyCountEl = card.querySelector('[data-activity-reply-count]');
  const likeCountEl = card.querySelector('[data-activity-like-count]');
  const likeBtn = card.querySelector('[data-activity-action="like"]');
  const likeIconSlot = card.querySelector('[data-like-icon-slot]');
  if (replyCountEl) replyCountEl.textContent = String(replyCount);
  if (likeCountEl) likeCountEl.textContent = String(likeCount);
  if (likeBtn) likeBtn.classList.toggle('liked', !!isLiked);
  if (likeIconSlot) likeIconSlot.innerHTML = getScreenListHeartIconSvg(!!isLiked);
}

async function getPersistedActivityInteractionState(activityId = '') {
  const rawId = String(activityId || '').trim();
  if (!rawId) return null;

  try {
    const feedSnap = await db.collection('feed').doc(rawId).get();
    if (feedSnap.exists) return { id: rawId, collection: 'feed', activity: { ...feedSnap.data(), id: rawId, _collection: 'feed' } };

    const activitySnap = await db.collection('activities').doc(rawId).get();
    if (activitySnap.exists) return { id: rawId, collection: 'activities', activity: { ...activitySnap.data(), id: rawId, _collection: 'activities' } };

    const inMemoryActivity = friendActivityClickTargets[rawId];
    if (inMemoryActivity) {
      const stableId = getStableActivityDocId(inMemoryActivity, rawId);
      const stableSnap = await db.collection('activities').doc(stableId).get();
      if (stableSnap.exists) return { id: stableId, collection: 'activities', activity: { ...stableSnap.data(), id: stableId, _collection: 'activities' } };
    }
  } catch (error) {
    console.error('Could not hydrate activity interaction state:', error);
  }
  return null;
}

async function hydrateActivityInteractionCounts(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const cards = Array.from(root.querySelectorAll('[data-activity-card-id]'));
  if (!cards.length) return;

  for (const card of cards) {
    const rawId = card.getAttribute('data-activity-card-id') || card.getAttribute('data-activity-id') || card.getAttribute('data-post-id') || '';
    if (!rawId) continue;
    getPersistedActivityInteractionState(rawId).then(result => {
      if (result?.activity) updateActivityInteractionCardState(card, result.activity);
    }).catch(error => console.error('Activity interaction count hydration failed:', error));
  }
}

function refreshVisibleActivityInteractionCards(activityId = '', activity = {}) {
  if (!activityId) return;
  const ids = new Set([String(activityId)]);
  if (activity.id) ids.add(String(activity.id));
  if (activity.activityId) ids.add(String(activity.activityId));
  if (activity.originalActivityId) ids.add(String(activity.originalActivityId));
  document.querySelectorAll('[data-activity-card-id], [data-activity-id], [data-post-id]').forEach(card => {
    const values = [
      card.getAttribute('data-activity-card-id'),
      card.getAttribute('data-activity-id'),
      card.getAttribute('data-post-id')
    ].filter(Boolean).map(String);
    if (values.some(value => ids.has(value))) updateActivityInteractionCardState(card, activity);
  });
}


// FEED SYSTEM
// Feed posts stored in 'feed' collection, indexed by timestamp
// Structure: { postId, uid, type, timestamp, content: {...}, likes: [] }

async function createFeedPost(postData) {
  if (!currentUser) throw new Error('Not authenticated');
  const postId = crypto.randomUUID ? crypto.randomUUID() : `post-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const timestamp = Date.now();
  
  const feedPost = {
    postId,
    uid: currentUser.uid,
    timestamp,
    type: postData.type || 'post',
    content: postData.content || {},
    likes: [],
    visibility: postData.visibility || 'friends'
  };

  if (postData.eventType) feedPost.eventType = postData.eventType;
  if (postData.item) feedPost.item = postData.item;
  if (postData.mediaKey) feedPost.mediaKey = postData.mediaKey;
  if (postData.commentText) feedPost.commentText = postData.commentText;
  if (postData.rating !== undefined) feedPost.rating = postData.rating;

  // Store in feed collection
  await db.collection('feed').doc(postId).set(feedPost);
  
  // Push to live feed cache
  if (Array.isArray(window.feedPosts)) {
    window.feedPosts.unshift(feedPost);
  }
  
  return feedPost;
}

let screenlistCompletionRatingState = null;
let screenlistActivityPostPromptState = null;

function isScreenListCompletedStatus(status = '') {
  return String(status || '').trim() === 'watched';
}

function getScreenListCompletedLabel(section = '') {
  if (section === 'games') return 'Played';
  if (section === 'books' || section === 'manga') return 'Read';
  return 'Watched';
}

function getScreenListActivityItemTitle(item = {}) {
  return String(item?.title || item?.name || 'Untitled').trim() || 'Untitled';
}

function getScreenListActivityItemCover(item = {}) {
  const section = item?.librarySection || item?.mediaCategory || '';
  if (section === 'games') {
    return typeof getScreenListDisplayGameCover === 'function' ? getScreenListDisplayGameCover(item) : (typeof getScreenListPreferredGameCover === 'function' ? getScreenListPreferredGameCover(item) : '');
  }
  return String(item?.cover || item?.poster || item?.image || item?.background_image || '').trim();
}

function normalizeScreenListActivityPostItem(item = {}, section = '', status = 'watched', rating = 0, comment = '') {
  const nowIso = new Date().toISOString();
  const cleanSection = section || item.librarySection || item.mediaCategory || activeSection || '';
  const cleanRating = Number(rating || item.rating || 0) || 0;
  const cleanComment = String(comment || '').trim();
  const copy = {
    ...item,
    title: getScreenListActivityItemTitle(item),
    cover: getScreenListActivityItemCover(item),
    status: status || item.status || 'watched',
    rating: cleanRating,
    librarySection: cleanSection,
    mediaCategory: item.mediaCategory || cleanSection,
    dateAdded: item.dateAdded || nowIso,
    dateModified: nowIso
  };
  if (cleanComment) {
    copy.activityComment = cleanComment;
    copy.watchedComment = cleanComment;
    copy.comment = cleanComment;
  }
  return copy;
}

function getScreenListActivityPostMediaKey(item = {}) {
  try {
    if (typeof getMediaKey === 'function') return getMediaKey(item) || '';
  } catch (error) {}
  const section = item.librarySection || item.mediaCategory || '';
  const id = item.tmdbId || item.rawgId || item.imdbId || item.id || '';
  const title = getScreenListActivityItemTitle(item).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [section, id || title].filter(Boolean).join(':');
}

function closeScreenListCompletionRatingPrompt() {
  const modal = document.getElementById('screenlist-completion-rating-modal');
  if (!modal) return;
  modal.classList.remove('open');
  window.setTimeout(() => modal.remove(), 220);
}

function openScreenListCompletionRatingPrompt(options = {}) {
  const item = options.item || {};
  const section = options.section || item.librarySection || item.mediaCategory || activeSection || '';
  const title = getScreenListActivityItemTitle(item);
  const cover = getScreenListActivityItemCover(item);
  const status = options.status || 'watched';
  const initialRating = Math.max(0, Number(options.initialRating || item.rating || 0) || 0);

  if (!isScreenListCompletedStatus(status) || typeof options.onApply !== 'function') {
    if (typeof options.onApply === 'function') options.onApply(initialRating);
    return;
  }

  closeScreenListCompletionRatingPrompt();
  screenlistCompletionRatingState = { ...options, item, section, status, selectedRating: initialRating, saving: false };

  const stars = buildStandaloneRatingStarsMarkup(initialRating, section, 'selectScreenListCompletionRating');
  const modal = document.createElement('div');
  modal.id = 'screenlist-completion-rating-modal';
  modal.className = 'screenlist-completion-modal';
  modal.innerHTML = `
    <div class="screenlist-completion-card" role="dialog" aria-modal="true" aria-label="Rate ${escAttr(title)}">
      <div class="screenlist-completion-preview">
        <div class="screenlist-completion-poster">${cover ? `<img src="${escAttr(cover)}" alt="" loading="lazy">` : `<span>${escHtml(title.charAt(0).toUpperCase())}</span>`}</div>
        <div class="screenlist-completion-copy">
          <div class="screenlist-completion-kicker">${escHtml(getScreenListCompletedLabel(section))}</div>
          <h3>${escHtml(title)}</h3>
          <p>Rate this title before saving it as ${escHtml(getScreenListCompletedLabel(section).toLowerCase())}.</p>
        </div>
      </div>
      <div class="screenlist-completion-stars-wrap">${stars}</div>
      <div class="screenlist-completion-actions">
        <button class="btn-secondary screenlist-completion-skip" type="button" onclick="finalizeScreenListCompletionRating(0)">Skip rating</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

function selectScreenListCompletionRating(score) {
  const state = screenlistCompletionRatingState;
  if (!state || state.saving) return;
  const cleanScore = Math.max(0, Number(score || 0) || 0);
  state.selectedRating = cleanScore;
  const container = document.querySelector('#screenlist-completion-rating-modal .discover-rating-stars');
  if (container) {
    container.dataset.discoverRating = String(cleanScore);
    container.querySelectorAll('.star-btn').forEach((star) => {
      const lit = Number(star.getAttribute('onclick')?.match(/\((\d+)\)/)?.[1] || star.dataset.rating || 0) <= cleanScore;
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
    label.textContent = cleanScore > 0 ? formatRatingValueForSection(cleanScore, state.section) : '';
    const animationMs = typeof playDiscoveryModalRatingAnimation === 'function'
      ? playDiscoveryModalRatingAnimation(cleanScore, container)
      : 180;
    window.setTimeout(() => finalizeScreenListCompletionRating(cleanScore), animationMs);
    return;
  }
  finalizeScreenListCompletionRating(cleanScore);
}

async function finalizeScreenListCompletionRating(score = 0) {
  const state = screenlistCompletionRatingState;
  if (!state || state.saving) return;
  state.saving = true;
  const modal = document.getElementById('screenlist-completion-rating-modal');
  const card = modal?.querySelector?.('.screenlist-completion-card');
  if (card) card.classList.add('saving');
  try {
    const result = await state.onApply(Number(score || 0) || 0);
    closeScreenListCompletionRatingPrompt();
    screenlistCompletionRatingState = null;
    if (result && result.ok !== false && isScreenListCompletedStatus(result.status || state.status)) {
      window.setTimeout(() => openScreenListActivityPostPrompt({
        item: result.item || state.item,
        section: result.section || state.section,
        status: result.status || state.status,
        rating: Number(result.rating ?? score ?? 0) || 0,
        source: result.source || state.source || ''
      }), Number(result.postPromptDelayMs || state.postPromptDelayMs || 0));
    }
  } catch (error) {
    console.error('Completion rating flow failed:', error);
    if (typeof showToast === 'function') showToast('Could not save this title. Try again.');
    if (card) card.classList.remove('saving');
    state.saving = false;
  }
}

// v436: lightweight activity-post prompt for rating edits. Uses the same modal
// as the completion flow but with 'rated' event type instead of 'completed', and
// no status-check gate (rating edits aren't restricted to Watched status).
function openScreenListActivityPostPromptForRatingEdit(item = {}, section = '', newRating = 0) {
  if (!currentUser) return;
  const rating = Math.max(0, Number(newRating || item?.rating || 0));
  const title = getScreenListActivityItemTitle(item);
  const cover = getScreenListActivityItemCover(item);
  closeScreenListActivityPostPrompt();
  screenlistActivityPostPromptState = { item, section, status: item.status || 'watched', rating, saving: false, eventType: 'rated' };
  const ratingText = rating > 0 ? formatRatingValueForSection(rating, section, true) : 'No rating';
  const modal = document.createElement('div');
  modal.id = 'screenlist-activity-post-modal';
  modal.className = 'screenlist-completion-modal screenlist-post-modal';
  modal.innerHTML = `
    <div class="screenlist-completion-card screenlist-post-card" role="dialog" aria-modal="true" aria-label="Post rating update for ${escAttr(title)}">
      <div class="screenlist-completion-preview">
        <div class="screenlist-completion-poster">${cover ? `<img src="${escAttr(cover)}" alt="" loading="lazy">` : `<span>${escHtml(title.charAt(0).toUpperCase())}</span>`}</div>
        <div class="screenlist-completion-copy">
          <div class="screenlist-completion-kicker">Rating Update</div>
          <h3>${escHtml(title)}</h3>
          <p>New rating: ${escHtml(ratingText)}</p>
        </div>
      </div>
      <label class="screenlist-post-comment-label" for="screenlist-activity-post-comment">Add a comment (optional)</label>
      <textarea id="screenlist-activity-post-comment" class="screenlist-post-comment-input" maxlength="420" placeholder="Say something about it..."></textarea>
      <div class="screenlist-completion-actions screenlist-post-actions">
        <button class="btn-primary screenlist-post-submit" type="button" onclick="submitScreenListActivityPostPrompt()">Post to Activity Feed</button>
        <button class="btn-secondary screenlist-post-skip" type="button" onclick="closeScreenListActivityPostPrompt()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

function closeScreenListActivityPostPrompt() {
  const modal = document.getElementById('screenlist-activity-post-modal');
  if (!modal) {
    screenlistActivityPostPromptState = null;
    return;
  }
  modal.classList.remove('open');
  window.setTimeout(() => modal.remove(), 220);
  screenlistActivityPostPromptState = null;
}


function handleScreenListActivityCardOpen(activityId = '', kind = 'activity') {
  const cleanId = String(activityId || '').trim();
  if (!cleanId) return;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const opener = kind === 'feed' ? () => openFeedPostPage(cleanId) : () => openActivityReplyPage(cleanId);
  if (reduceMotion) {
    opener();
    return;
  }
  requestAnimationFrame(() => opener());
}

function setFeedPostPageDeleteButton(postId = '', collection = 'feed', visible = false) {
  const btn = document.getElementById('feed-post-delete-top-btn');
  if (!btn) return;
  const cleanPostId = String(postId || '').trim();
  const cleanCollection = collection === 'activities' ? 'activities' : 'feed';
  btn.dataset.postId = visible ? cleanPostId : '';
  btn.dataset.collection = cleanCollection;
  btn.style.display = visible && cleanPostId ? 'inline-flex' : 'none';
  btn.classList.toggle('is-visible', !!(visible && cleanPostId));
}

function deleteCurrentFeedPostPagePost() {
  const btn = document.getElementById('feed-post-delete-top-btn');
  const postId = String(btn?.dataset?.postId || currentFeedPostId || '').trim();
  const collection = String(btn?.dataset?.collection || currentFeedPostCollection || 'feed').trim();
  if (!postId) return;
  openScreenListDeletePostPrompt(postId, collection);
}

function closeScreenListDeletePostPrompt() {
  const modal = document.getElementById('screenlist-delete-post-modal');
  if (!modal) return;
  modal.classList.remove('open');
  window.setTimeout(() => modal.remove(), 220);
}

function openScreenListDeletePostPrompt(postId = '', collection = 'feed') {
  const cleanPostId = String(postId || '').trim();
  const cleanCollection = collection === 'activities' ? 'activities' : 'feed';
  if (!cleanPostId || !currentUser) return;
  closeScreenListDeletePostPrompt();
  const modal = document.createElement('div');
  modal.id = 'screenlist-delete-post-modal';
  modal.className = 'screenlist-completion-modal screenlist-delete-post-modal';
  modal.innerHTML = `
    <div class="screenlist-completion-card screenlist-delete-post-card" role="dialog" aria-modal="true" aria-label="Confirm delete post">
      <div class="screenlist-delete-post-copy">
        <p>Delete this post? This removes it from the Activity Feed.</p>
      </div>
      <div class="screenlist-completion-actions screenlist-delete-post-actions">
        <button class="btn-secondary screenlist-delete-post-cancel" type="button" onclick="closeScreenListDeletePostPrompt()">Cancel</button>
        <button class="btn-primary screenlist-delete-post-confirm" type="button" onclick="confirmScreenListDeletePost('${escAttr(cleanPostId)}','${escAttr(cleanCollection)}')">Delete Post</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

async function confirmScreenListDeletePost(postId = '', collection = 'feed') {
  const cleanPostId = String(postId || '').trim();
  const cleanCollection = collection === 'activities' ? 'activities' : 'feed';
  if (!currentUser || !cleanPostId) return;
  const modal = document.getElementById('screenlist-delete-post-modal');
  const card = modal?.querySelector?.('.screenlist-delete-post-card');
  const confirmBtn = modal?.querySelector?.('.screenlist-delete-post-confirm');
  const cancelBtn = modal?.querySelector?.('.screenlist-delete-post-cancel');
  if (card) card.classList.add('saving');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Deleting...'; }
  if (cancelBtn) cancelBtn.disabled = true;
  try {
    let target = null;
    if (cleanCollection === 'feed') {
      const feedRef = db.collection('feed').doc(cleanPostId);
      const feedSnap = await feedRef.get();
      if (feedSnap.exists) {
        target = { id: cleanPostId, collection: 'feed', ref: feedRef, activity: { ...feedSnap.data(), id: cleanPostId, _collection: 'feed' } };
      }
    }
    if (!target) target = await resolveActivityInteractionTarget(cleanPostId);
    const activity = target?.activity || friendActivityClickTargets[cleanPostId] || {};
    if (!canCurrentUserDeleteActivity(activity)) throw new Error('Only the owner can delete this activity.');

    const deleteIds = Array.from(new Set([
      cleanPostId,
      target?.id || '',
      ...getScreenListActivityDeleteCandidates(activity, cleanPostId)
    ].map(String).filter(Boolean)));

    if (target?.collection === 'feed') {
      await target.ref.delete();
    } else {
      await persistCurrentUserDeletedActivityIds(deleteIds);
      if (target?.ref && target.collection === 'activities') {
        await target.ref.set({ deletedByOwner: true, deletedAt: Date.now(), deletedByUid: currentUser.uid }, { merge: true }).catch(() => {});
      }
    }

    const previousScrollY = window.scrollY || window.pageYOffset || 0;
    purgeDeletedActivityFromMemory(deleteIds);
    if (friendActivityCache) friendActivityCache.timestamp = 0;
    try {
      document.querySelectorAll('.activity-feed-list [data-activity-card-id]').forEach(cardEl => {
        const cid = cardEl.getAttribute('data-activity-card-id') || cardEl.getAttribute('data-activity-id') || '';
        if (cid && deleteIds.includes(cid)) cardEl.remove();
      });
    } catch (error) {}
    if (currentFeedPostId === cleanPostId || deleteIds.includes(String(currentFeedPostId || ''))) {
      try { closeFeedPostPage(); } catch (error) {}
    }
    closeScreenListDeletePostPrompt();
    requestAnimationFrame(() => {
      try { window.scrollTo({ top: previousScrollY, left: 0, behavior: 'auto' }); } catch (error) { window.scrollTo(0, previousScrollY); }
    });
    if (typeof showToast === 'function') showToast('Activity deleted');
  } catch (err) {
    console.error('Error deleting activity:', err);
    if (typeof showToast === 'function') showToast('Could not delete activity. Try again.');
    if (card) card.classList.remove('saving');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Delete Post'; }
    if (cancelBtn) cancelBtn.disabled = false;
  }
}


function openScreenListActivityPostPrompt(options = {}) {
  if (!currentUser || !isScreenListCompletedStatus(options.status || 'watched')) return;
  const item = options.item || {};
  if (!item || typeof item !== 'object') return;
  const section = options.section || item.librarySection || item.mediaCategory || activeSection || '';
  const rating = Number(options.rating || item.rating || 0) || 0;
  const title = getScreenListActivityItemTitle(item);
  const cover = getScreenListActivityItemCover(item);

  closeScreenListActivityPostPrompt();
  screenlistActivityPostPromptState = { item, section, status: options.status || 'watched', rating, saving: false };

  const ratingText = rating > 0 ? formatRatingValueForSection(rating, section, true) : 'No rating';
  const modal = document.createElement('div');
  modal.id = 'screenlist-activity-post-modal';
  modal.className = 'screenlist-completion-modal screenlist-post-modal';
  modal.innerHTML = `
    <div class="screenlist-completion-card screenlist-post-card" role="dialog" aria-modal="true" aria-label="Post ${escAttr(title)} to Activity Feed">
      <div class="screenlist-completion-preview">
        <div class="screenlist-completion-poster">${cover ? `<img src="${escAttr(cover)}" alt="" loading="lazy">` : `<span>${escHtml(title.charAt(0).toUpperCase())}</span>`}</div>
        <div class="screenlist-completion-copy">
          <div class="screenlist-completion-kicker">Activity Feed</div>
          <h3>${escHtml(title)}</h3>
          <p>${escHtml(getScreenListCompletedLabel(section))} · ${escHtml(ratingText)}</p>
        </div>
      </div>
      <label class="screenlist-post-comment-label" for="screenlist-activity-post-comment">Add a comment</label>
      <textarea id="screenlist-activity-post-comment" class="screenlist-post-comment-input" maxlength="420" placeholder="Say something about it..."></textarea>
      <div class="screenlist-completion-actions screenlist-post-actions">
        <button class="btn-primary screenlist-post-submit" type="button" onclick="submitScreenListActivityPostPrompt()">Post to Activity Feed</button>
        <button class="btn-secondary screenlist-post-skip" type="button" onclick="closeScreenListActivityPostPrompt()">I don't want to post this</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}

async function submitScreenListActivityPostPrompt() {
  const state = screenlistActivityPostPromptState;
  if (!state || state.saving || !currentUser) return;
  state.saving = true;
  const modal = document.getElementById('screenlist-activity-post-modal');
  const card = modal?.querySelector?.('.screenlist-post-card');
  const submitBtn = modal?.querySelector?.('.screenlist-post-submit');
  const skipBtn = modal?.querySelector?.('.screenlist-post-skip');
  const comment = String(modal?.querySelector?.('#screenlist-activity-post-comment')?.value || '').trim();
  if (card) card.classList.add('saving');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Posting...'; }
  if (skipBtn) skipBtn.disabled = true;

  try {
    const item = normalizeScreenListActivityPostItem(state.item, state.section, state.status, state.rating, comment);
    const mediaKey = getScreenListActivityPostMediaKey(item);
    const post = await createFeedPost({
      type: 'activity_post',
      eventType: 'completed',
      item,
      mediaKey,
      commentText: comment,
      rating: state.rating,
      visibility: 'friends',
      content: {
        activityPost: true,
        mediaTitle: item.title,
        mediaSection: state.section,
        rating: state.rating,
        comment
      }
    });
    const activity = { ...post, item, mediaKey, commentText: comment, eventType: 'completed', eventKey: `feed:${post.postId || post.id}` };
    if (typeof pushFriendActivityLiveEvents === 'function') pushFriendActivityLiveEvents([activity]);
    friendActivityCache = null;
    friendActivityPromise = null;
    if (typeof loadActivityTabFeed === 'function' && activeFriendsTab === 'activity') loadActivityTabFeed();
    closeScreenListActivityPostPrompt();
    if (typeof showToast === 'function') showToast('Posted to Activity Feed');
  } catch (error) {
    console.error('Activity post failed:', error);
    if (typeof showToast === 'function') showToast('Could not post. Try again.');
    if (card) card.classList.remove('saving');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Post to Activity Feed'; }
    if (skipBtn) skipBtn.disabled = false;
    state.saving = false;
  }
}

async function likeFeedPost(postId) {
  if (!currentUser) return;
  const postRef = db.collection('feed').doc(postId);
  await postRef.update({
    likes: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
  });
}

async function unlikeFeedPost(postId) {
  if (!currentUser) return;
  const postRef = db.collection('feed').doc(postId);
  await postRef.update({
    likes: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
  });
}

async function deleteFeedPost(postId, collection = 'feed') {
  openScreenListDeletePostPrompt(postId, collection);
}

async function fetchFeedPosts(limit = 50) {
  if (isPreviewMode()) return [];
  if (!currentUser || !friends.length) return [];
  
  const friendsSet = new Set([...friends, currentUser.uid]);
  const friendsArray = [...friendsSet];
  
  // Firestore 'in' limit is 10, so batch the queries
  const batches = [];
  for (let i = 0; i < friendsArray.length; i += 10) {
    batches.push(friendsArray.slice(i, i + 10));
  }
  
  const allPosts = [];
  
  for (const batch of batches) {
    try {
      const snapshot = await db.collection('feed')
        .where('uid', 'in', batch)
        .orderBy('timestamp', 'desc')
        .limit(Math.ceil(limit / batches.length))
        .get();
      
      snapshot.forEach(doc => {
        allPosts.push({ ...doc.data(), id: doc.id });
      });
    } catch(e) {
      console.error('Error fetching feed batch:', e);
    }
  }
  
  // Sort all posts by timestamp and limit
  return allPosts
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

// Feed Composer Functions
let composerTrailerData = null;

function autoExpandComposer(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  
  const postBtn = document.getElementById('feed-composer-post-btn');
  const hasContent = textarea.value.trim().length > 0 || composerTrailerData;
  if (postBtn) postBtn.disabled = !hasContent;
}

function clearComposerTrailer() {
  composerTrailerData = null;
  const preview = document.getElementById('feed-composer-trailer-preview');
  if (preview) preview.style.display = 'none';
  
  const textarea = document.getElementById('feed-composer-input');
  if (textarea) autoExpandComposer(textarea);
}

function openTrailerSelector() {
  // Show modal to pick from user's library
  const modalHtml = `
    <div class="modal-overlay" id="trailer-selector-modal" onclick="if(event.target===this) closeTrailerSelector()">
      <div class="modal-content" style="max-width: 600px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>Share a Trailer</h2>
          <button class="modal-close" onclick="closeTrailerSelector()">✕</button>
        </div>
        <div class="modal-body">
          <input type="text" class="search-input" placeholder="Search your library..." 
            oninput="filterTrailerOptions(this.value)" style="margin-bottom: 16px;">
          <div id="trailer-options-grid" class="trailer-options-grid">
            <div class="discover-message">Loading your library...</div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const existing = document.getElementById('trailer-selector-modal');
  if (existing) existing.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  renderTrailerOptions();
}

function closeTrailerSelector() {
  const modal = document.getElementById('trailer-selector-modal');
  if (modal) modal.remove();
}

async function renderTrailerOptions(filterText = '') {
  const grid = document.getElementById('trailer-options-grid');
  if (!grid || !currentUser) return;
  
  try {
    const snap = await db.collection('watchlist').doc(currentUser.uid).get();
    if (!snap.exists) {
      grid.innerHTML = '<div class="discover-message">No items in your library yet.</div>';
      return;
    }
    
    const data = snap.data();
    let allItems = [];
    
    for (const section of SCREENLIST_SECTIONS) {
      let items = [];
      try { items = data[section] ? JSON.parse(data[section]) : []; } catch(e) {}
      items.forEach(item => {
        if (item.title && item.cover) {
          allItems.push({ ...item, section, mediaType: section });
        }
      });
    }
    
    if (filterText) {
      const lower = filterText.toLowerCase();
      allItems = allItems.filter(item => 
        item.title && item.title.toLowerCase().includes(lower)
      );
    }
    
    if (!allItems.length) {
      grid.innerHTML = '<div class="discover-message">No items found.</div>';
      return;
    }
    
    grid.innerHTML = allItems.slice(0, 20).map(item => `
      <div class="trailer-option-card" onclick="selectTrailer(${escAttr(JSON.stringify(item))})">
        <img src="${escAttr(item.cover)}" alt="${escAttr(item.title)}" loading="lazy">
        <div class="trailer-option-title">${escHtml(item.title)}</div>
      </div>
    `).join('');
  } catch(err) {
    grid.innerHTML = '<div class="discover-message">Error loading library.</div>';
  }
}

function filterTrailerOptions(value) {
  renderTrailerOptions(value);
}

function selectTrailer(itemData) {
  if (typeof itemData === 'string') {
    try { itemData = JSON.parse(itemData); } catch(e) { return; }
  }
  
  composerTrailerData = itemData;
  
  const preview = document.getElementById('feed-composer-trailer-preview');
  const img = document.getElementById('feed-composer-trailer-img');
  const title = document.getElementById('feed-composer-trailer-title');
  
  if (preview && img && title) {
    img.src = itemData.cover || '';
    title.textContent = itemData.title || 'Untitled';
    preview.style.display = 'flex';
  }
  
  const textarea = document.getElementById('feed-composer-input');
  if (textarea) autoExpandComposer(textarea);
  
  closeTrailerSelector();
}

async function submitFeedPost() {
  const textarea = document.getElementById('feed-composer-input');
  if (!textarea || !currentUser) return;
  
  const text = textarea.value.trim();
  if (!text && !composerTrailerData) return;
  
  const postBtn = document.getElementById('feed-composer-post-btn');
  if (postBtn) {
    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';
  }
  
  try {
    const content = {};
    
    // Only add text if it exists
    if (text) {
      content.text = text;
    }
    
    // Only add trailer fields if trailer data exists
    if (composerTrailerData) {
      content.trailerMediaId = composerTrailerData.itemId || '';
      content.trailerTitle = composerTrailerData.title || '';
      content.trailerCover = composerTrailerData.cover || '';
      content.trailerMediaType = composerTrailerData.mediaType || composerTrailerData.section || '';
      
      // Store IDs for opening media profile
      // Library items use itemId which is the TMDB ID or RAWG ID
      const mediaType = content.trailerMediaType;
      
      if (mediaType === 'games') {
        // For games, itemId is the RAWG ID
        content.trailerRawgId = composerTrailerData.rawgId || composerTrailerData.itemId || '';
      } else if (mediaType === 'movies' || mediaType === 'shows' || mediaType === 'anime') {
        // For movies/shows, itemId is the TMDB ID
        content.trailerTmdbId = composerTrailerData.tmdbId || composerTrailerData.itemId || '';
        content.trailerTmdbType = mediaType === 'movies' ? 'movie' : 'tv';
      }
      
      console.log('Storing trailer data:', {
        mediaType,
        tmdbId: content.trailerTmdbId,
        rawgId: content.trailerRawgId,
        title: content.trailerTitle
      });
    }
    
    const postData = {
      type: composerTrailerData ? 'trailer' : 'post',
      content,
      visibility: 'friends'
    };
    
    await createFeedPost(postData);
    
    // Clear composer
    textarea.value = '';
    textarea.style.height = 'auto';
    clearComposerTrailer();
    
    if (postBtn) {
      postBtn.textContent = 'Posted!';
      setTimeout(() => {
        postBtn.textContent = 'Post';
      }, 2000);
    }
    
    // Clear cache and reload feed to show new post
    friendActivityCache = null;
    friendActivityPromise = null;
    loadActivityTabFeed();
    
  } catch(err) {
    console.error('Error posting:', err);
    if (postBtn) {
      postBtn.disabled = false;
      postBtn.textContent = 'Post';
    }
    alert('Failed to post. Please try again.');
  }
}

function initFeedComposer() {
  const avatar = document.getElementById('feed-composer-avatar');
  if (!avatar || !currentUser) return;
  
  const user = usersMap[currentUser.uid] || currentUser;
  const photo = user.photo || user.photoURL || '';
  const name = user.name || user.displayName || 'User';
  const initial = name.charAt(0).toUpperCase();
  
  if (photo) {
    avatar.innerHTML = `<img src="${escAttr(photo)}" alt="">`;
  } else {
    avatar.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#a78bfa;">${initial}</div>`;
  }
}

const ACTIVITY_TYPE_META = {
  rated:     { label: 'Rated',    labelClass: 'el-rated',     ringClass: 'ring-rated',     storyRingClass: 'story-ring-rated',     topClass: 'card-top-rated'     },
  added:     { label: 'Added',    labelClass: 'el-added',     ringClass: 'ring-added',     storyRingClass: 'story-ring-added',     topClass: 'card-top-added'     },
  'status-changed': { label: 'Status',   labelClass: 'el-completed', ringClass: 'ring-completed', storyRingClass: 'story-ring-completed', topClass: 'card-top-completed' },
  removed:   { label: 'Removed',  labelClass: 'el-dropped',   ringClass: 'ring-dropped',   storyRingClass: 'story-ring-dropped',   topClass: 'card-top-dropped'   },
  completed: { label: 'Finished watching!', labelClass: 'el-completed', ringClass: 'ring-completed', storyRingClass: 'story-ring-completed', topClass: 'card-top-completed' },
  started:   { label: 'Watching', labelClass: 'el-started',   ringClass: 'ring-started',   storyRingClass: 'story-ring-started',   topClass: 'card-top-started'   },
  paused:    { label: 'Paused',   labelClass: 'el-paused',    ringClass: 'ring-paused',    storyRingClass: 'story-ring-paused',    topClass: 'card-top-paused'    },
  dropped:   { label: 'Dropped',  labelClass: 'el-dropped',   ringClass: 'ring-dropped',   storyRingClass: 'story-ring-dropped',   topClass: 'card-top-dropped'   },
  planned:   { label: 'Planning', labelClass: 'el-planned',   ringClass: 'ring-planned',   storyRingClass: 'story-ring-planned',   topClass: 'card-top-planned'   },
  commented: { label: 'Comment',  labelClass: 'el-commented', ringClass: 'ring-commented', storyRingClass: 'story-ring-commented', topClass: 'card-top-commented' },
  post:      { label: 'Post',     labelClass: 'el-added',     ringClass: 'ring-added',     storyRingClass: 'story-ring-added',     topClass: 'card-top-added'     },
  trailer:   { label: 'Trailer',  labelClass: 'el-started',   ringClass: 'ring-started',   storyRingClass: 'story-ring-started',   topClass: 'card-top-started'   },
};


let activityUserListTransitionTimer = null;

function runActivityUserListTransition(triggerEl, navigate) {
  if (typeof navigate !== 'function') return;
  const trigger = triggerEl && typeof triggerEl.closest === 'function' ? triggerEl : null;
  const card = trigger ? trigger.closest('.shelfd-social-card') : null;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  if (!trigger || reduceMotion) {
    navigate();
    return;
  }

  clearTimeout(activityUserListTransitionTimer);
  trigger.classList.add('activity-avatar-transitioning');
  if (card) card.classList.add('activity-user-list-transition-card');

  requestAnimationFrame(() => {
    trigger.classList.add('is-exiting');
    if (card) card.classList.add('is-exiting');
  });

  activityUserListTransitionTimer = setTimeout(() => {
    navigate();
    requestAnimationFrame(() => {
      trigger.classList.remove('activity-avatar-transitioning', 'is-exiting');
      if (card) card.classList.remove('activity-user-list-transition-card', 'is-exiting');
    });
  }, 300);
}

function openActivityUserList(uid = '', name = '', photo = '', triggerEl = null) {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) return;

  const openTarget = () => {
    if (isPreviewMode()) {
      openPreviewCommunityProfile(cleanUid);
      return;
    }
    if (currentUser && cleanUid === currentUser.uid) {
      switchMainNav('mylist');
      return;
    }
    const existing = usersMap[cleanUid] || {};
    const resolvedName = String(name || existing.name || existing.customName || existing.displayName || 'User').trim() || 'User';
    const resolvedPhoto = String(photo || existing.photo || existing.customPhoto || '').trim();
    usersMap[cleanUid] = { ...existing, uid: cleanUid, name: resolvedName, photo: resolvedPhoto };
    if (document.getElementById('feed-post-page')?.style.display !== 'none') {
      try { closeFeedPostPage(); } catch (error) {}
    }
    if (document.getElementById('activity-page')?.classList.contains('active')) {
      try { closeActivityPage(); } catch (error) {}
    }
    if (typeof viewUserList === 'function') {
      viewUserList(cleanUid, resolvedName, resolvedPhoto);
    } else if (typeof viewUserFromMap === 'function') {
      viewUserFromMap(cleanUid);
    }
  };

  runActivityUserListTransition(triggerEl, openTarget);
}

function buildFeedPostCardHTML(a, activityId, options = {}) {
  const content = a.content || {};
  const actor = usersMap[a.uid] ? { ...a, ...usersMap[a.uid] } : a;
  const timeStr = relativeTime(a.timestamp);
  const avatarSrc = actor.photo || a.photo || '';
  const initial = getDisplayName(actor, 'F').charAt(0).toUpperCase();
  const meta = ACTIVITY_TYPE_META[a.type] || ACTIVITY_TYPE_META.post;
  
  const avatarHtml = avatarSrc
    ? `<img class="activity-card-avatar ${meta.ringClass}" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','','',event.currentTarget)" style="cursor:pointer;" title="View list" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="activity-card-avatar-placeholder ${meta.ringClass}" style="display:none;cursor:pointer;" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','','',event.currentTarget)" title="View list">${initial}</div>`
    : `<div class="activity-card-avatar-placeholder ${meta.ringClass}" style="cursor:pointer;" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','','',event.currentTarget)" title="View list">${initial}</div>`;
  
  const nameHtml = `<span class="activity-card-name" style="cursor:pointer;" onclick="event.stopPropagation(); viewUserFromMap('${escAttr(a.uid)}')">${renderDisplayNameHTML(actor, 'Friend', '')}</span>`;
  
  let postContentHtml = '';
  
  if (content.text) {
    postContentHtml = `<div class="feed-post-text">${escHtml(content.text)}</div>`;
  }
  
  if (a.type === 'trailer' && content.trailerCover) {
    // Store data in a global map to avoid JSON escaping issues
    const trailerId = `trailer_${a.postId || a.id}`;
    if (!window.trailerDataMap) window.trailerDataMap = {};
    window.trailerDataMap[trailerId] = content;
    
    postContentHtml += `
      <div class="feed-post-trailer">
        <div class="feed-post-trailer-thumb" onclick="event.stopPropagation(); playTrailerVideo('${escAttr(trailerId)}')">
          <img src="${escAttr(content.trailerCover)}" alt="" loading="lazy">
          <button class="feed-post-trailer-play" onclick="event.stopPropagation(); playTrailerVideo('${escAttr(trailerId)}')">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        </div>
        <div class="feed-post-trailer-info" onclick="event.stopPropagation(); openMediaProfileFromTrailerId('${escAttr(trailerId)}', this)">
          <div class="feed-post-trailer-title">${escHtml(content.trailerTitle || 'Untitled')}</div>
          <div class="feed-post-trailer-meta">${escHtml(content.trailerMediaType || 'Video')} • Trailer</div>
        </div>
      </div>
    `;
  }
  
  const likes = Array.isArray(a.likes) ? a.likes : [];
  const likeCount = likes.length;
  const isLiked = currentUser && likes.includes(currentUser.uid);
  const likeIcon = isLiked
    ? `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
    : `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  
  const replyIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
  
  const replies = Array.isArray(a.replies) ? a.replies : [];
  const replyCount = replies.length;
  
  const feedDeleteHtml = canCurrentUserDeleteActivity(a) ? `
      <button class="activity-interaction-btn" data-activity-action="delete" onclick="event.stopPropagation(); openScreenListDeletePostPrompt('${escAttr(a.postId || a.id || activityId)}','feed')" aria-label="Delete post">
        ${getScreenListTrashIconSvg()}
      </button>` : '';
  const interactionsHtml = `
    <div class="activity-interactions" data-activity-interactions>
      <button class="activity-interaction-btn" data-activity-action="reply" onclick="event.stopPropagation(); openFeedPostPage('${escAttr(a.postId || a.id)}')">
        ${getScreenListReplyIconSvg()}
        <span data-activity-reply-count>${replyCount}</span>
      </button>
      <button class="activity-interaction-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" onclick="event.stopPropagation(); toggleFeedLike('${escAttr(a.postId || a.id)}', this)">
        <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span>
        <span data-activity-like-count>${likeCount}</span>
      </button>${feedDeleteHtml}
    </div>
  `;
  
  return `<div class="activity-card feed-post ${meta.topClass}" data-activity-card-id="${escAttr(activityId)}" data-post-id="${escAttr(a.postId || a.id || '')}" onclick="handleScreenListActivityCardOpen('${escAttr(a.postId || a.id || activityId)}','feed')">
    <div class="activity-avatar-wrap">${avatarHtml}</div>
    <div class="activity-content-col">
      <div class="activity-who-row">
        ${nameHtml}
        <span class="activity-card-time" style="margin-left:auto;">${timeStr}</span>
      </div>
      ${postContentHtml}
      <div class="activity-card-bottom">
        <span class="activity-event-label ${meta.labelClass}">${meta.label}</span>
      </div>
    </div>
    ${interactionsHtml}
  </div>`;
}

function patchCachedActivityLikes(postOrFeedId, eventKey, isNowLiked) {
  if (!friendActivityCache?.activities || !currentUser) return;
  friendActivityCache.activities = friendActivityCache.activities.map(a => {
    const matchesId = postOrFeedId && (a.postId || a.id) === postOrFeedId;
    const matchesKey = eventKey && a.eventKey === eventKey;
    if (!matchesId && !matchesKey) return a;
    const likes = Array.isArray(a.likes) ? [...a.likes] : [];
    if (isNowLiked) {
      if (!likes.includes(currentUser.uid)) likes.push(currentUser.uid);
    } else {
      const idx = likes.indexOf(currentUser.uid);
      if (idx !== -1) likes.splice(idx, 1);
    }
    return { ...a, likes };
  });
}

async function toggleActivityLike(activityId, btnEl) {
  if (!currentUser || !activityId) return;

  const isLiked = btnEl.classList.contains('liked');
  if (!isLiked && btnEl) {
    btnEl.classList.remove('sl-activity-heart-pop');
    void btnEl.offsetWidth;
    btnEl.classList.add('sl-activity-heart-pop');
    setTimeout(() => btnEl.classList.remove('sl-activity-heart-pop'), 360);
  }

  try {
    const target = await resolveActivityInteractionTarget(activityId);
    if (!target || !target.ref) throw new Error('Activity not found for like action');

    if (isLiked) {
      await target.ref.update({
        likes: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
      });
    } else {
      await target.ref.set({ likes: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) }, { merge: true });
    }

    const cachedActivity = friendActivityClickTargets[activityId];
    patchCachedActivityLikes(null, cachedActivity?.eventKey || activityId, !isLiked);

    const latest = await target.ref.get();
    const latestActivity = latest.exists ? { ...target.activity, ...latest.data(), id: target.id, _collection: target.collection } : target.activity;
    const rawMemory = friendActivityClickTargets[activityId];
    if (rawMemory) {
      rawMemory.likes = Array.isArray(latestActivity.likes) ? latestActivity.likes : [];
      rawMemory.replies = Array.isArray(latestActivity.replies) ? latestActivity.replies : [];
    }
    refreshVisibleActivityInteractionCards(activityId, latestActivity);
    refreshVisibleActivityInteractionCards(target.id, latestActivity);
  } catch(err) {
    console.error('Error toggling activity like:', err);
    if (typeof showToast === 'function') showToast('Could not update like. Try again.');
  }
}

async function openActivityReplyPage(activityId) {
  console.log('Opening activity reply page for:', activityId);

  if (!activityId) {
    console.error('No activityId provided');
    return;
  }

  const page = document.getElementById('feed-post-page');
  const detailContainer = document.getElementById('feed-post-detail-container');
  const repliesComposer = document.getElementById('feed-post-replies-composer');
  const repliesList = document.getElementById('feed-post-replies-list');

  if (!page) {
    console.error('feed-post-page element not found');
    return;
  }

  console.log('Showing page...');
  openShelfdFeedPostBottomSheet(page);
  setFeedPostPageDeleteButton('', 'feed', false);
  clearFeedReplyParent(false);
  prepareFeedPostPageForOpen(page);

  const scroll = page.querySelector('.overlay-page-content');
  if (scroll) scroll.scrollTop = 0;

  if (detailContainer) {
    detailContainer.innerHTML = '<div class="discover-message" style="padding:40px;text-align:center;">Loading activity...</div>';
  }
  if (repliesList) repliesList.innerHTML = '';

  console.log('Fetching activity...');

  try {
    const target = await resolveActivityInteractionTarget(activityId);

    if (!target || !target.activity) {
      console.error('Activity not found:', activityId);
      if (detailContainer) {
        detailContainer.innerHTML = '<div class="discover-message" style="padding:40px;text-align:center;">Activity not found</div>';
      }
      return;
    }

    currentFeedPostId = target.id;
    currentFeedPostCollection = target.collection || 'activities';
    const activity = { ...target.activity, id: target.id, _collection: target.collection };
    const canDeleteDetailPost = canCurrentUserDeleteActivity(activity);
    setFeedPostPageDeleteButton(target.id, currentFeedPostCollection, canDeleteDetailPost);
    console.log('Activity loaded:', activity);

    if (detailContainer) {
      console.log('Rendering activity detail...');
      detailContainer.innerHTML = buildActivityPostDetailHTML(activity, target.id, target.collection);
      hydrateActivityInteractionCounts(detailContainer);
    }

    if (repliesComposer) {
      console.log('Showing reply composer...');
      repliesComposer.style.display = 'block';
      initReplyComposer();
      window.requestAnimationFrame(syncFeedPostComposerViewport);
    }

    console.log('Loading replies...');
    loadActivityReplies(target.id, target.collection);

  } catch(err) {
    console.error('Error loading activity:', err);
    if (detailContainer) {
      detailContainer.innerHTML = `<div class="discover-message" style="padding:40px;text-align:center;">Error loading activity<br><small>${escHtml(err.message)}</small></div>`;
    }
  }
}

function getFeedReplyParentId(reply = {}) {
  return String(reply.parentReplyId || reply.replyToId || reply.inReplyToId || '').trim();
}

function getFeedReplyStableId(reply = {}, index = 0) {
  return String(reply.id || reply.replyId || `reply-${reply.uid || 'user'}-${reply.timestamp || index}-${index}`).trim();
}

function buildFeedReplyItemHTML(reply, index = 0, total = 1, depth = 0, childHtml = '') {
  const replyId = getFeedReplyStableId(reply, index);
  const user = usersMap[reply.uid] || { uid: reply.uid, name: 'User' };
  const avatarSrc = user.photo || user.photoURL || '';
  const name = getDisplayName(user, user.displayName || user.name || 'User');
  const initial = String(name || 'U').charAt(0).toUpperCase();
  const timeStr = relativeTime(reply.timestamp);
  const parentId = getFeedReplyParentId(reply);
  const showLine = index < total - 1;
  const avatarHtml = avatarSrc
    ? `<img class="feed-reply-avatar-img" src="${escAttr(avatarSrc)}" alt="" loading="lazy">`
    : `<div class="feed-reply-avatar-img feed-reply-avatar-placeholder">${escHtml(initial)}</div>`;

  return `<article class="feed-reply-item x-reply-item ${parentId ? 'feed-reply-threaded' : ''}" data-reply-id="${escAttr(replyId)}" data-parent-reply-id="${escAttr(parentId)}">
    <div class="feed-reply-avatar-col">
      ${avatarHtml}
      ${showLine ? '<div class="feed-reply-thread-line"></div>' : ''}
    </div>
    <div class="feed-reply-content">
      <div class="feed-reply-header">
        <span class="feed-reply-author">${renderDisplayNameHTML(user, name, '')}</span>
        <span class="feed-reply-time">${timeStr}</span>
      </div>
      <div class="feed-reply-text">${escHtml(reply.text || '')}</div>
      <button class="feed-reply-inline-reply" type="button" onclick="event.stopPropagation(); startFeedReplyTo('${escAttr(replyId)}','${escAttr(reply.uid || '')}')">Reply</button>
    </div>
  </article>`;
}

function renderFeedRepliesList(replies = []) {
  const normalized = [...replies]
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .map((reply, index) => ({ ...reply, id: getFeedReplyStableId(reply, index) }));
  const byId = new Map(normalized.map(reply => [String(reply.id), reply]));
  const byParent = new Map();

  normalized.forEach(reply => {
    const parentId = getFeedReplyParentId(reply);
    const key = parentId && byId.has(parentId) ? parentId : '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(reply);
  });

  const flatReplies = [];
  const seen = new Set();
  const collectBranch = (parentId = '', depth = 0) => {
    const children = byParent.get(parentId) || [];
    children.forEach(reply => {
      if (seen.has(reply.id)) return;
      seen.add(reply.id);
      flatReplies.push({ ...reply, depth: Math.min(1, depth) });
      collectBranch(reply.id, depth + 1);
    });
  };

  collectBranch('', 0);
  return flatReplies.map((reply, index) => buildFeedReplyItemHTML(reply, index, flatReplies.length, reply.depth || 0, '')).join('');
}

function updateActivityReplyCountBadge(postId, count) {
  if (!postId) return;
  document.querySelectorAll(`.activity-card[data-post-id="${CSS.escape(postId)}"] .activity-reply-count`).forEach(el => {
    el.textContent = String(Math.max(0, Number(count) || 0));
  });
}

async function loadActivityReplies(activityId, collection = 'feed') {
  const repliesList = document.getElementById('feed-post-replies-list');
  if (!repliesList) return;
  
  try {
    const doc = await db.collection(collection).doc(activityId).get();
    if (!doc.exists) {
      repliesList.innerHTML = '';
      return;
    }
    
    const data = doc.data();
    const replies = Array.isArray(data.replies) ? data.replies : [];
    updateActivityReplyCountBadge(activityId, replies.length);

    if (!replies.length) {
      repliesList.innerHTML = '<div class="x-empty-replies">No replies yet. Be the first to reply.</div>';
      return;
    }

    repliesList.innerHTML = renderFeedRepliesList(replies);
  } catch(err) {
    console.error('Error loading replies:', err);
    repliesList.innerHTML = '<div class="discover-message">Error loading replies</div>';
  }
}

async function toggleFeedLike(postId, btnEl) {
  if (!currentUser || !postId) return;

  const isLiked = btnEl.classList.contains('liked');

  try {
    if (isLiked) {
      await unlikeFeedPost(postId);
    } else {
      await likeFeedPost(postId);
    }
    patchCachedActivityLikes(postId, `feed:${postId}`, !isLiked);

    const postRef = db.collection('feed').doc(postId);
    const doc = await postRef.get();
    if (doc.exists) {
      const activity = { ...doc.data(), id: postId, _collection: 'feed' };
      refreshVisibleActivityInteractionCards(postId, activity);
    }
  } catch(err) {
    console.error('Error toggling like:', err);
  }
}

async function playTrailerVideo(trailerId) {
  console.log('=== playTrailerVideo called ===');
  console.log('trailerId:', trailerId);
  
  if (!window.trailerDataMap || !window.trailerDataMap[trailerId]) {
    console.error('Trailer data not found for ID:', trailerId);
    if (typeof showToast === 'function') showToast('Trailer data not found');
    return;
  }
  
  const content = window.trailerDataMap[trailerId];
  console.log('Trailer content:', content);
  
  const mediaType = content.trailerMediaType || '';
  
  // For TMDB content (movies, shows, anime)
  if ((mediaType === 'movies' || mediaType === 'shows' || mediaType === 'anime') && content.trailerTmdbId) {
    const tmdbType = content.trailerTmdbType || (mediaType === 'movies' ? 'movie' : 'tv');
    
    try {
      // Use existing TMDB proxy
      const response = await fetchTmdbProxy(`${tmdbType}/${content.trailerTmdbId}/videos`);
      const data = await response.json();
      
      console.log('Trailer API response:', data);
      
      if (data.results && data.results.length > 0) {
        // Find YouTube trailer
        const trailer = data.results.find(v => v.site === 'YouTube' && v.type === 'Trailer') || data.results[0];
        
        if (trailer && trailer.key) {
          console.log('Playing trailer:', trailer.key);
          showTrailerModal(trailer.key, content.trailerTitle);
          return;
        }
      }
      
      console.log('No trailer found in results');
      if (typeof showToast === 'function') showToast('No trailer available');
      
    } catch (err) {
      console.error('Error fetching trailer:', err);
      if (typeof showToast === 'function') showToast('Failed to load trailer');
    }
    return;
  }
  
  // For games - no trailer API, just open profile instead
  if (mediaType === 'games') {
    openMediaProfileFromTrailerId(trailerId);
    return;
  }
  
  if (typeof showToast === 'function') showToast('Trailer not available');
}

function showTrailerModal(youtubeKey, title) {
  // Check if mobile
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // On mobile: create container with close button
    const container = document.createElement('div');
    container.id = 'trailer-fullscreen-container';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #000;
      z-index: 999999;
      display: flex;
      flex-direction: column;
    `;
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
      position: absolute;
      top: max(12px, env(safe-area-inset-top));
      right: 12px;
      z-index: 1000000;
      background: rgba(0, 0, 0, 0.8);
      border: none;
      color: #fff;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      backdrop-filter: blur(10px);
    `;
    closeBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    `;
    closeBtn.onclick = () => closeTrailerModal();
    
    const iframeWrapper = document.createElement('div');
    iframeWrapper.style.cssText = `
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    `;
    
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
    iframe.src = `https://www.youtube.com/embed/${youtubeKey}?autoplay=1&playsinline=0&rel=0&modestbranding=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    
    iframeWrapper.appendChild(iframe);
    container.appendChild(closeBtn);
    container.appendChild(iframeWrapper);
    document.body.appendChild(container);
    document.body.style.overflow = 'hidden';
    
    // Try to request fullscreen (may not work on all mobile browsers)
    setTimeout(() => {
      if (iframe.requestFullscreen) {
        iframe.requestFullscreen().catch(err => {
          console.log('Fullscreen not available:', err.message);
        });
      } else if (iframe.webkitRequestFullscreen) {
        iframe.webkitRequestFullscreen();
      }
    }, 100);
    
    // Close when fullscreen exits (if it was entered)
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && 
          !document.webkitFullscreenElement && 
          !document.mozFullScreenElement && 
          !document.msFullscreenElement) {
        // Don't auto-close, let user use close button
        console.log('Fullscreen exited');
      }
    };
    
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    
    // Store cleanup function
    container._cleanup = () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
    
  } else {
    // On desktop: show modal with close button
    const modalHtml = `
      <div id="trailer-video-modal" class="overlay-page" style="display:block;background:rgba(0,0,0,0.95);z-index:999999;">
        <div class="overlay-page-inner">
          <div class="overlay-page-header">
            <button class="overlay-page-back-btn" onclick="closeTrailerModal()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <h2 class="overlay-page-title">${escHtml(title || 'Trailer')}</h2>
          </div>
          <div style="padding:16px;max-width:900px;margin:0 auto;">
            <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">
              <iframe 
                style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"
                src="https://www.youtube.com/embed/${escAttr(youtubeKey)}?autoplay=1&rel=0&modestbranding=1"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen>
              </iframe>
            </div>
          </div>
        </div>
      </div>
    `;
    
    const existing = document.getElementById('trailer-video-modal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
  }
}

function closeTrailerModal() {
  console.log('Closing trailer modal...');
  
  // Close mobile fullscreen container
  const container = document.getElementById('trailer-fullscreen-container');
  if (container) {
    console.log('Removing mobile container');
    if (container._cleanup) container._cleanup();
    container.remove();
  }
  
  // Close desktop modal
  const modal = document.getElementById('trailer-video-modal');
  if (modal) {
    console.log('Removing desktop modal');
    modal.remove();
  }
  
  document.body.style.overflow = '';
  
  // Exit fullscreen if still in it
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    console.log('Exiting fullscreen');
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

function openMediaProfileFromTrailerId(trailerId, triggerEl = null) {
  console.log('=== openMediaProfileFromTrailerId called ===');
  console.log('trailerId:', trailerId);
  console.log('trailerDataMap:', window.trailerDataMap);
  
  if (!window.trailerDataMap || !window.trailerDataMap[trailerId]) {
    console.error('Trailer data not found for ID:', trailerId);
    if (typeof showToast === 'function') showToast('Trailer data not found');
    return;
  }
  
  const content = window.trailerDataMap[trailerId];
  console.log('Found trailer content:', content);
  openMediaProfileFromTrailer(content, triggerEl);
}

async function openMediaProfileFromTrailer(content, triggerEl = null) {
  console.log('=== openMediaProfileFromTrailer called ===');
  console.log('content:', content);
  
  if (!content) {
    console.error('No content provided');
    if (typeof showToast === 'function') showToast('Cannot open media profile');
    return;
  }
  
  const mediaType = content.trailerMediaType || '';
  console.log('mediaType:', mediaType);
  
  // For games
  if (mediaType === 'games' && content.trailerRawgId) {
    console.log('Opening game profile for RAWG ID:', content.trailerRawgId);
    const seed = {
      id: content.trailerRawgId,
      rawgId: content.trailerRawgId,
      title: content.trailerTitle || '',
      name: content.trailerTitle || '',
      cover: content.trailerCover || ''
    };
    if (typeof setGameMediaProfileSeed === 'function') {
      setGameMediaProfileSeed(content.trailerRawgId, seed);
    }
    if (typeof openGameMediaProfile === 'function') {
      await openGameMediaProfile(null, content.trailerRawgId, seed, triggerEl);
    } else {
      console.error('openGameMediaProfile function not found');
    }
    return;
  }
  
  // For movies/shows
  if ((mediaType === 'movies' || mediaType === 'shows' || mediaType === 'anime') && content.trailerTmdbId) {
    console.log('Opening TMDB profile for ID:', content.trailerTmdbId, 'type:', content.trailerTmdbType);
    const tmdbType = content.trailerTmdbType || (mediaType === 'movies' ? 'movie' : 'tv');
    const seed = {
      id: content.trailerTmdbId,
      tmdbId: content.trailerTmdbId,
      title: content.trailerTitle || '',
      name: content.trailerTitle || '',
      poster: content.trailerCover || '',
      cover: content.trailerCover || '',
      librarySection: mediaType,
      mediaCategory: mediaType
    };
    if (typeof setDiscoverMediaProfileSeed === 'function') {
      setDiscoverMediaProfileSeed(tmdbType, content.trailerTmdbId, seed);
    }
    if (typeof openDiscoverMediaProfile === 'function') {
      await openDiscoverMediaProfile(null, tmdbType, content.trailerTmdbId, triggerEl);
    } else {
      console.error('openDiscoverMediaProfile function not found');
    }
    return;
  }
  
  // Fallback - show message
  console.error('No valid media type or ID found:', { mediaType, content });
  if (typeof showToast === 'function') {
    showToast('Cannot open media profile - missing data');
  }
}

// Feed Post Detail Page
let currentFeedPostId = null;
let currentFeedPostCollection = 'feed';
let currentFeedReplyParentId = '';
let feedPostSwipeBackReady = false;
let feedPostSwipeBackState = null;
let feedPostViewportSyncReady = false;

function syncFeedPostComposerViewport() {
  const page = document.getElementById('feed-post-page');
  if (!page || page.style.display === 'none') return;
  const composer = document.getElementById('feed-post-replies-composer');
  const visualViewport = window.visualViewport;
  const viewportOffset = visualViewport
    ? Math.max(0, Math.round(window.innerHeight - visualViewport.height - visualViewport.offsetTop))
    : 0;
  document.documentElement.style.setProperty('--feed-reply-keyboard-offset', `${viewportOffset}px`);
  if (composer) {
    const composerHeight = Math.ceil(composer.getBoundingClientRect().height || composer.offsetHeight || 76);
    document.documentElement.style.setProperty('--feed-post-composer-height', `${composerHeight}px`);
  }
}

function installFeedPostViewportSync() {
  if (feedPostViewportSyncReady) {
    syncFeedPostComposerViewport();
    return;
  }
  feedPostViewportSyncReady = true;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncFeedPostComposerViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', syncFeedPostComposerViewport, { passive: true });
  }
  window.addEventListener('resize', syncFeedPostComposerViewport, { passive: true });
  window.requestAnimationFrame(syncFeedPostComposerViewport);
}

function isFeedPostSwipeBlockedTarget(target) {
  return !!(target && target.closest && target.closest('textarea, input, select, button, a, [contenteditable="true"], .x-post-media-poster'));
}

function resetFeedPostSwipeState(page = document.getElementById('feed-post-page')) {
  if (!page) return;
  page.classList.remove('feed-post-swipe-dragging', 'feed-post-swipe-closing', 'feed-post-swipe-restoring');
  page.style.removeProperty('--feed-post-swipe-x');
  page.style.removeProperty('--feed-post-swipe-rotate');
  page.style.transform = '';
  page.style.transition = '';
  feedPostSwipeBackState = null;
}

function prepareFeedPostPageForOpen(page = document.getElementById('feed-post-page')) {
  if (!page) return;
  resetFeedPostSwipeState(page);
  // Disabled for now: the swipe-back transform can break iOS/PWA fixed keyboard composer behavior.
  // Rebuild swipe-back later after the composer is fully stable.
  installFeedPostViewportSync();
}

function installFeedPostSwipeBack(page = document.getElementById('feed-post-page')) {
  if (!page || feedPostSwipeBackReady) return;
  feedPostSwipeBackReady = true;

  page.addEventListener('touchstart', event => {
    if (!event.touches || event.touches.length !== 1 || isFeedPostSwipeBlockedTarget(event.target)) return;
    const touch = event.touches[0];
    feedPostSwipeBackState = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      startedAt: Date.now(),
      dragging: false
    };
  }, { passive: true });

  page.addEventListener('touchmove', event => {
    const state = feedPostSwipeBackState;
    if (!state || !event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = Math.max(0, touch.clientX - state.startX);
    const dy = touch.clientY - state.startY;
    if (!state.dragging) {
      if (dx < 14) return;
      if (Math.abs(dy) > dx * 0.72) {
        feedPostSwipeBackState = null;
        return;
      }
      state.dragging = true;
      page.classList.add('feed-post-swipe-dragging');
      page.style.transition = 'none';
    }
    event.preventDefault();
    state.lastX = touch.clientX;
    const width = Math.max(1, window.innerWidth || page.offsetWidth || 390);
    const progress = Math.min(1, dx / width);
    const rotate = Math.min(9, progress * 9);
    page.style.setProperty('--feed-post-swipe-x', `${dx}px`);
    page.style.setProperty('--feed-post-swipe-rotate', `${rotate}deg`);
    page.style.transform = `translate3d(${dx}px, 0, 0) rotate(${rotate}deg)`;
  }, { passive: false });

  const finishSwipe = () => {
    const state = feedPostSwipeBackState;
    if (!state) return;
    if (!state.dragging) {
      feedPostSwipeBackState = null;
      return;
    }
    const pageWidth = Math.max(1, window.innerWidth || page.offsetWidth || 390);
    const dx = Math.max(0, (state.lastX || state.startX) - state.startX);
    const elapsed = Math.max(1, Date.now() - state.startedAt);
    const velocity = dx / elapsed;
    const shouldClose = dx > pageWidth * 0.34 || (dx > 72 && velocity > 0.55);
    page.classList.remove('feed-post-swipe-dragging');
    page.style.transition = '';
    if (shouldClose) {
      page.classList.add('feed-post-swipe-closing');
      page.style.transform = 'translate3d(104vw, 0, 0) rotate(9deg)';
      window.setTimeout(() => closeFeedPostPage(), 260);
    } else {
      page.classList.add('feed-post-swipe-restoring');
      page.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      window.setTimeout(() => resetFeedPostSwipeState(page), 260);
    }
    feedPostSwipeBackState = null;
  };

  page.addEventListener('touchend', finishSwipe, { passive: true });
  page.addEventListener('touchcancel', () => {
    if (feedPostSwipeBackState?.dragging) {
      page.classList.remove('feed-post-swipe-dragging');
      page.classList.add('feed-post-swipe-restoring');
      page.style.transition = '';
      page.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      window.setTimeout(() => resetFeedPostSwipeState(page), 260);
    }
    feedPostSwipeBackState = null;
  }, { passive: true });
}

function updateFeedReplyContext() {
  const composer = document.getElementById('feed-post-replies-composer');
  if (!composer) return;
  let context = composer.querySelector('.feed-reply-context');
  if (!context) {
    context = document.createElement('div');
    context.className = 'feed-reply-context';
    const target = composer.querySelector('.feed-reply-composer') || composer.firstChild;
    composer.insertBefore(context, target || null);
  }
  const parentId = String(currentFeedReplyParentId || '').trim();
  if (!parentId) {
    context.style.display = 'none';
    context.innerHTML = '';
    return;
  }
  const author = context.dataset.replyAuthor || 'comment';
  context.style.display = 'flex';
  context.innerHTML = `<span>Replying to ${escHtml(author)}</span><button type="button" onclick="clearFeedReplyParent()" aria-label="Cancel threaded reply">×</button>`;
}

function clearFeedReplyParent(focusInput = false) {
  currentFeedReplyParentId = '';
  const composer = document.getElementById('feed-post-replies-composer');
  const context = composer?.querySelector?.('.feed-reply-context');
  if (context) {
    context.dataset.replyAuthor = '';
    context.style.display = 'none';
    context.innerHTML = '';
  }
  const input = document.getElementById('feed-reply-input');
  if (input) {
    input.placeholder = 'Post your reply';
    if (focusInput) input.focus();
  }
}

function startFeedReplyTo(replyId = '', uid = '') {
  const cleanReplyId = String(replyId || '').trim();
  if (!cleanReplyId) return;
  currentFeedReplyParentId = cleanReplyId;
  const user = usersMap[uid] || { uid, name: 'comment' };
  const name = getDisplayName(user, user.displayName || user.name || 'comment');
  const composer = document.getElementById('feed-post-replies-composer');
  const context = composer?.querySelector?.('.feed-reply-context');
  if (context) context.dataset.replyAuthor = name || 'comment';
  const input = document.getElementById('feed-reply-input');
  if (input) {
    input.placeholder = `Reply to ${name || 'comment'}`;
    focusFeedReplyInput();
  }
  updateFeedReplyContext();
}

async function openFeedPostPage(postId) {
  console.log('=== openFeedPostPage called ===');
  console.log('postId:', postId);
  
  if (!postId) {
    console.error('ERROR: No postId provided to openFeedPostPage');
    if (typeof showToast === 'function') showToast('Error opening post');
    return;
  }
  
  currentFeedPostId = postId;
  currentFeedPostCollection = 'feed';
  
  const page = document.getElementById('feed-post-page');
  console.log('feed-post-page element:', page ? 'found' : 'NOT FOUND');
  
  if (!page) {
    console.error('ERROR: feed-post-page element not found in DOM');
    if (typeof showToast === 'function') showToast('Error: Page element missing');
    return;
  }
  
  const detailContainer = document.getElementById('feed-post-detail-container');
  const repliesComposer = document.getElementById('feed-post-replies-composer');
  const repliesList = document.getElementById('feed-post-replies-list');
  
  console.log('Elements:', {
    detailContainer: detailContainer ? 'found' : 'missing',
    repliesComposer: repliesComposer ? 'found' : 'missing',
    repliesList: repliesList ? 'found' : 'missing'
  });
  
  // v430: bottom sheet open
  console.log('Opening bottom sheet...');
  openShelfdFeedPostBottomSheet(page);
  setFeedPostPageDeleteButton('', 'feed', false);
  clearFeedReplyParent(false);
  prepareFeedPostPageForOpen(page);
  
  // Add visual confirmation
  console.log('Page computed styles:', {
    display: window.getComputedStyle(page).display,
    visibility: window.getComputedStyle(page).visibility,
    opacity: window.getComputedStyle(page).opacity,
    zIndex: window.getComputedStyle(page).zIndex
  });
  
  // Scroll to top
  const inner = page.querySelector('.overlay-page-inner');
  if (inner) {
    inner.scrollTop = 0;
  }
  
  // Show loading state
  if (detailContainer) {
    detailContainer.innerHTML = '<div class="discover-message" style="padding:40px;text-align:center;">Loading post...</div>';
  }
  if (repliesList) {
    repliesList.innerHTML = '';
  }
  
  console.log('Page should now be visible. Starting Firestore fetch...');
  
  try {
    const doc = await db.collection('feed').doc(postId).get();
    console.log('Firestore fetch complete. Exists:', doc.exists);
    
    if (!doc.exists) {
      console.error('Post not found in Firestore:', postId);
      if (detailContainer) {
        detailContainer.innerHTML = '<div class="discover-message" style="padding:40px;text-align:center;">Post not found</div>';
      }
      return;
    }
    
    const post = { ...doc.data(), id: doc.id };
    setFeedPostPageDeleteButton(postId, 'feed', !!(currentUser && post.uid === currentUser.uid));
    console.log('Post data:', post);
    
    // Render post using simplified version
    if (detailContainer) {
      console.log('Rendering post detail...');
      detailContainer.innerHTML = buildFeedPostDetailHTML(post, postId);
      hydrateActivityInteractionCounts(detailContainer);
    }
    
    // Show reply composer
    if (repliesComposer) {
      console.log('Showing reply composer...');
      repliesComposer.style.display = 'block';
      initReplyComposer();
      window.requestAnimationFrame(syncFeedPostComposerViewport);
    }
    
    // Load replies
    console.log('Loading replies...');
    loadFeedPostReplies(postId);
    
    console.log('=== openFeedPostPage complete ===');
    
  } catch(err) {
    console.error('ERROR in openFeedPostPage:', err);
    console.error('Error stack:', err.stack);
    if (detailContainer) {
      detailContainer.innerHTML = `<div class="discover-message" style="padding:40px;text-align:center;">Error loading post<br><small>${escHtml(err.message)}</small></div>`;
    }
  }
}

function buildFeedPostDetailHTML(post, postId) {
  const content = post.content || {};
  const actor = usersMap[post.uid] ? { ...post, ...usersMap[post.uid] } : post;
  const timeStr = relativeTime(post.timestamp);
  const avatarSrc = actor.photo || post.photo || '';
  const initial = getDisplayName(actor, 'F').charAt(0).toUpperCase();
  const likes = Array.isArray(post.likes) ? post.likes : [];
  const replies = Array.isArray(post.replies) ? post.replies : [];
  const isLiked = currentUser && likes.includes(currentUser.uid);

  const avatarHtml = avatarSrc
    ? `<img class="x-post-avatar" src="${escAttr(avatarSrc)}" alt="" loading="lazy">`
    : `<div class="x-post-avatar x-post-avatar-placeholder">${initial}</div>`;

  let postContentHtml = '';
  if (content.text) {
    postContentHtml += `<div class="x-post-text">${escHtml(content.text)}</div>`;
  }

  if (post.type === 'trailer' && content.trailerCover) {
    const trailerId = `trailer_detail_${postId}`;
    if (!window.trailerDataMap) window.trailerDataMap = {};
    window.trailerDataMap[trailerId] = content;
    postContentHtml += `
      <button type="button" class="x-post-trailer-card" onclick="playTrailerVideo('${escAttr(trailerId)}')">
        <img class="x-post-trailer-img" src="${escAttr(content.trailerCover)}" alt="" loading="lazy">
        <span class="x-post-trailer-play">▶</span>
        <span class="x-post-trailer-copy">
          <strong>${escHtml(content.trailerTitle || 'Untitled')}</strong>
          <small>${escHtml(content.trailerMediaType || 'Video')} • Trailer</small>
        </span>
      </button>`;
  }

  return `
    <article class="x-post-detail-card" data-activity-card-id="${escAttr(postId)}" data-post-id="${escAttr(postId)}">
      <div class="x-post-main-row">
        ${avatarHtml}
        <div class="x-post-body">
          <div class="x-post-header-row">
            <span class="x-post-author">${renderDisplayNameHTML(actor, 'Friend', '')}</span>
            <span class="x-post-time">${timeStr}</span>
          </div>
          ${postContentHtml || '<div class="x-post-text">Post</div>'}
        </div>
      </div>
      <div class="x-post-actions-row" data-activity-interactions>
        <button class="x-post-action-btn" data-activity-action="reply" type="button" onclick="focusFeedReplyInput()">
          ${getScreenListReplyIconSvg()}<span data-activity-reply-count>${replies.length}</span>
        </button>
        <button class="x-post-action-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" type="button" onclick="toggleFeedLike('${escAttr(postId)}', this)">
          <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span><span data-activity-like-count>${likes.length}</span>
        </button>
      </div>
    </article>`;
}

function buildActivityPostDetailHTML(activity, activityId, collection = 'activities') {
  const item = activity.item || {};
  const actor = usersMap[activity.uid] ? { ...activity, ...usersMap[activity.uid] } : activity;
  const eventType = getActivityEventType(activity);
  const section = item.librarySection || item.mediaCategory || '';
  const sectionLabel = getSectionLabel2(section);
  const timeStr = relativeTime(activity.timestamp || item.dateAdded);
  const title = item.title || item.name || 'Untitled';
  const avatarSrc = actor.photo || activity.photo || '';
  const initial = getDisplayName(actor, 'F').charAt(0).toUpperCase();
  const likes = Array.isArray(activity.likes) ? activity.likes : [];
  const replies = Array.isArray(activity.replies) ? activity.replies : [];
  const isLiked = currentUser && likes.includes(currentUser.uid);
  const meta = ACTIVITY_TYPE_META[eventType] || ACTIVITY_TYPE_META.added;

  const avatarHtml = avatarSrc
    ? `<img class="x-post-avatar ${meta.ringClass}" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onclick="openActivityUserList('${escAttr(activity.uid)}')">`
    : `<div class="x-post-avatar x-post-avatar-placeholder ${meta.ringClass}" onclick="openActivityUserList('${escAttr(activity.uid)}')">${initial}</div>`;

  const itemCover = getScreenListActivityItemCover(item);
  const actorPhoto = String(avatarSrc || '').trim();
  const mediaCover = itemCover && itemCover !== actorPhoto ? itemCover : '';
  const posterHtml = mediaCover
    ? `<button type="button" class="x-post-media-poster" data-activity-game-poster="${section === 'games' ? '1' : '0'}" data-game-title="${escAttr(title)}" data-rawg-id="${escAttr(getGameRawgIdValue(item) || '')}" onclick="handleActivityMediaClick('${escAttr(activityId)}', this)"><img src="${escAttr(mediaCover)}" alt="" loading="lazy"></button>`
    : '';

  let actionText = getActivityVerbPhrase(eventType, item);
  let ratingHtml = '';
  if (eventType === 'rated') {
    const rating = Number(item.rating || 0);
    actionText = `rated ${formatRatingValueForSection(rating, section, true)}`;
    const filledStars = Math.round(rating / 2);
    let stars = '';
    for (let i = 1; i <= 5; i += 1) stars += `<span class="activity-star ${i <= filledStars ? 'lit' : 'dim'}">★</span>`;
    ratingHtml = `<div class="x-post-stars">${stars}</div>`;
  }

  if (eventType === 'added') actionText = `added to ${section === 'games' ? 'library' : 'shelf'}`;
  if (eventType === 'completed') actionText = section === 'games' ? 'completed' : 'Finished watching!';
  if (eventType === 'started') actionText = section === 'games' ? 'started playing' : 'started watching';

  const commentHtml = activity.commentText ? `<div class="x-post-text">${escHtml(String(activity.commentText))}</div>` : '';
  const detailLabel = [meta.label, sectionLabel].filter(Boolean).join(' · ');

  return `
    <article class="x-post-detail-card activity-detail-post ${meta.topClass}" data-activity-card-id="${escAttr(activityId)}" data-activity-id="${escAttr(activityId)}">
      <div class="x-post-main-row">
        ${avatarHtml}
        <div class="x-post-body">
          <div class="x-post-header-row">
            <span class="x-post-author" onclick="viewUserFromMap('${escAttr(activity.uid)}')">${renderDisplayNameHTML(actor, 'Friend', '')}</span>
            <span class="x-post-time">${timeStr}</span>
          </div>
          <div class="x-post-action-text">${escHtml(actionText)}</div>
          <div class="x-post-title">${escHtml(title)}</div>
          ${ratingHtml}
          ${commentHtml}
          <div class="x-post-meta-line"><span class="activity-event-label ${meta.labelClass}">${escHtml(detailLabel)}</span></div>
        </div>
        ${posterHtml}
      </div>
      <div class="x-post-actions-row" data-activity-interactions>
        <button class="x-post-action-btn" data-activity-action="reply" type="button" onclick="focusFeedReplyInput()">
          ${getScreenListReplyIconSvg()}<span data-activity-reply-count>${replies.length}</span>
        </button>
        <button class="x-post-action-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" type="button" onclick="toggleActivityLike('${escAttr(activityId)}', this)">
          <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span><span data-activity-like-count>${likes.length}</span>
        </button>
        ${canCurrentUserDeleteActivity(activity) ? `<button class="x-post-action-btn" data-activity-action="delete" type="button" onclick="openScreenListDeletePostPrompt('${escAttr(activityId)}','${escAttr(collection)}')">${getScreenListTrashIconSvg()}</button>` : ''}
      </div>
    </article>`;
}

function focusFeedReplyInput() {
  const input = document.getElementById('feed-reply-input');
  const scroller = document.getElementById('feed-post-scroll-content') || document.querySelector('#feed-post-page .overlay-page-content');
  const keepScrollTop = scroller ? scroller.scrollTop : 0;
  const keepWindowY = window.scrollY || window.pageYOffset || 0;
  if (input) {
    try { input.focus({ preventScroll: true }); }
    catch (error) { input.focus(); }
    window.requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = keepScrollTop;
      if (keepWindowY) window.scrollTo(0, keepWindowY);
      syncFeedPostComposerViewport();
    });
  }
}

function closeFeedPostPage() {
  const page = document.getElementById('feed-post-page');
  if (page) {
    closeShelfdFeedPostBottomSheet(page);
    resetFeedPostSwipeState(page);
  }
  setFeedPostPageDeleteButton('', 'feed', false);
  clearFeedReplyParent(false);
  // closeShelfdFeedPostBottomSheet already calls unlockShelfdFeedSheetBackgroundScroll;
  // this is a belt-and-suspenders fallback in case closeFeedPostPage is invoked when
  // the sheet element wasn't found.
  unlockShelfdFeedSheetBackgroundScroll();
  document.documentElement.style.removeProperty('--feed-reply-keyboard-offset');
  document.documentElement.style.removeProperty('--feed-post-composer-height');
  currentFeedReplyParentId = '';
  currentFeedPostId = null;
  currentFeedPostCollection = 'feed';
}

// v430: Instagram-style bottom sheet plumbing for the feed-post-page (comments).
// Open: display:block → next frame add .is-open class to trigger slide-up.
// Close: remove .is-open → after transitionend hide with display:none.
// Drag handle: touch/mouse drag down >120px (or >40% sheet height) → close.
let _shelfdFeedSheetReady = false;
let _shelfdFeedSheetCloseTimer = null;
let _shelfdFeedSheetScrollLockState = null;

// v435: robust mobile-Safari/PWA scroll lock for the comment bottom sheet.
// `body { overflow: hidden }` alone doesn't stop iOS from scrolling — we have to
// pin the body with `position: fixed; top: -<scrollY>` so the underlying page
// can't move while the sheet is open. The original scroll position is restored
// on close. We also block touchmove events that bubble up from the backdrop so
// rubber-band scroll can't bleed through.
function lockShelfdFeedSheetBackgroundScroll() {
  if (_shelfdFeedSheetScrollLockState) return;
  const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  const body = document.body;
  _shelfdFeedSheetScrollLockState = {
    scrollY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow
  };
  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.body.classList.add('shelfd-feed-sheet-scroll-locked');
}
function unlockShelfdFeedSheetBackgroundScroll() {
  const state = _shelfdFeedSheetScrollLockState;
  if (!state) return;
  _shelfdFeedSheetScrollLockState = null;
  const body = document.body;
  body.style.position = state.bodyPosition || '';
  body.style.top = state.bodyTop || '';
  body.style.left = state.bodyLeft || '';
  body.style.right = state.bodyRight || '';
  body.style.width = state.bodyWidth || '';
  body.style.overflow = state.bodyOverflow || '';
  document.documentElement.style.overflow = state.htmlOverflow || '';
  document.body.classList.remove('shelfd-feed-sheet-scroll-locked');
  // Restore the original scroll offset before the lock was applied.
  window.scrollTo(0, state.scrollY || 0);
}
// Block touchmove on the page backdrop so a finger drag outside the inner sheet
// can't scroll the document. Touch inside .overlay-page-content / sheet body
// still scrolls because that handler stops propagation here only.
function _shelfdFeedSheetBackdropTouchMove(event) {
  const target = event.target;
  if (!target || !target.closest) return;
  if (target.closest('.overlay-page-content') || target.closest('#feed-post-replies-composer') || target.closest('.feed-post-bottom-sheet-grabber')) {
    return; // allow scroll inside the sheet's scrollable regions / drag handle
  }
  if (event.cancelable) event.preventDefault();
}

function openShelfdFeedPostBottomSheet(page) {
  if (!page) return;
  if (_shelfdFeedSheetCloseTimer) {
    clearTimeout(_shelfdFeedSheetCloseTimer);
    _shelfdFeedSheetCloseTimer = null;
  }
  page.style.display = 'block';
  page.style.visibility = 'visible';
  page.classList.remove('is-dragging');
  const inner = page.querySelector('.overlay-page-inner');
  if (inner) inner.style.transform = '';
  lockShelfdFeedSheetBackgroundScroll();
  page.addEventListener('touchmove', _shelfdFeedSheetBackdropTouchMove, { passive: false });
  installShelfdFeedSheetGestures(page);
  // Force reflow so the initial transform (translateY 100%) takes effect before .is-open transitions to 0%.
  void page.offsetWidth;
  requestAnimationFrame(() => page.classList.add('is-open'));
}

function closeShelfdFeedPostBottomSheet(page) {
  if (!page) return;
  page.classList.remove('is-open');
  page.classList.remove('is-dragging');
  page.removeEventListener('touchmove', _shelfdFeedSheetBackdropTouchMove);
  const inner = page.querySelector('.overlay-page-inner');
  if (inner) inner.style.transform = '';
  unlockShelfdFeedSheetBackgroundScroll();
  if (_shelfdFeedSheetCloseTimer) clearTimeout(_shelfdFeedSheetCloseTimer);
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hideMs = reduceMotion ? 0 : 380;
  _shelfdFeedSheetCloseTimer = setTimeout(() => {
    page.style.display = 'none';
    _shelfdFeedSheetCloseTimer = null;
  }, hideMs);
}

function installShelfdFeedSheetGestures(page) {
  if (!page || _shelfdFeedSheetReady) return;
  _shelfdFeedSheetReady = true;
  const grabber = page.querySelector('.feed-post-bottom-sheet-grabber');
  if (!grabber) return;

  let dragState = null;
  let pendingFrame = 0;
  const getInner = () => page.querySelector('.overlay-page-inner');

  // v433: drag transform must be set inline with `!important` so it beats the
  // CSS `!important` rule that defines the open-state transform. Otherwise the
  // sheet ignores the inline value and stays at translateY(0) — that's why
  // earlier versions felt "automated" / didn't follow the finger.
  const writeDragTransform = (inner, dy) => {
    inner.style.setProperty('transform', `translate3d(-50%, ${dy}px, 0)`, 'important');
  };
  const clearDragTransform = (inner) => {
    inner.style.removeProperty('transform');
  };

  // Soft resistance past ~70% so the sheet feels weighted near the bottom edge.
  const applyResistance = (dy, sheetH) => {
    const knee = sheetH * 0.7;
    if (dy <= knee) return dy;
    const over = dy - knee;
    return knee + over / (1 + over / 100);
  };

  const onPointerDown = (event) => {
    if (event.touches && event.touches.length > 1) return;
    const inner = getInner();
    if (!inner) return;
    const point = event.touches ? event.touches[0] : event;
    dragState = {
      startY: point.clientY,
      lastY: point.clientY,
      prevY: point.clientY,
      prevT: performance.now(),
      lastT: performance.now(),
      startedAt: performance.now(),
      sheetH: inner.offsetHeight || 1,
      moved: false,
      vy: 0
    };
    page.classList.add('is-dragging');
  };
  const onPointerMove = (event) => {
    if (!dragState) return;
    const inner = getInner();
    if (!inner) return;
    const point = event.touches ? event.touches[0] : event;
    const rawDy = point.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(rawDy) < 4) return;
    dragState.moved = true;
    const dy = applyResistance(Math.max(0, rawDy), dragState.sheetH);
    const now = performance.now();
    // running velocity (px/ms) over the most recent move window
    const dt = Math.max(1, now - dragState.prevT);
    dragState.vy = (point.clientY - dragState.prevY) / dt;
    dragState.prevY = point.clientY;
    dragState.prevT = now;
    dragState.lastY = point.clientY;
    dragState.lastT = now;
    // Coalesce repeated moves into a single rAF write so paint stays in sync
    // with high-refresh displays.
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      if (dragState) writeDragTransform(inner, dy);
    });
    if (event.cancelable) event.preventDefault();
  };
  const onPointerUp = () => {
    if (!dragState) return;
    const inner = getInner();
    if (pendingFrame) { cancelAnimationFrame(pendingFrame); pendingFrame = 0; }
    const sheetH = dragState.sheetH || 1;
    const dy = Math.max(0, dragState.lastY - dragState.startY);
    const fingerVel = dragState.vy; // px/ms during last move window
    const shouldClose = dy > 90 || dy / sheetH > 0.28 || fingerVel > 0.55;
    dragState = null;
    // Re-enable transition BEFORE removing the inline transform so the snap-back
    // (or close) is a single smooth interpolation, not an instant jump.
    page.classList.remove('is-dragging');
    if (!inner) return;
    if (shouldClose) {
      // Removing .is-open changes the CSS target to translateY(100%). Clearing
      // the inline transform on the next frame lets the active transition
      // interpolate from the user's last drag position to fully-closed.
      page.classList.remove('is-open');
      requestAnimationFrame(() => clearDragTransform(inner));
      const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const hideMs = reduceMotion ? 0 : 380;
      if (_shelfdFeedSheetCloseTimer) clearTimeout(_shelfdFeedSheetCloseTimer);
      _shelfdFeedSheetCloseTimer = setTimeout(() => {
        page.style.display = 'none';
        _shelfdFeedSheetCloseTimer = null;
      }, hideMs);
      setFeedPostPageDeleteButton('', 'feed', false);
      try { clearFeedReplyParent(false); } catch (e) {}
      page.removeEventListener('touchmove', _shelfdFeedSheetBackdropTouchMove);
      unlockShelfdFeedSheetBackgroundScroll();
      document.documentElement.style.removeProperty('--feed-reply-keyboard-offset');
      document.documentElement.style.removeProperty('--feed-post-composer-height');
      currentFeedReplyParentId = '';
      currentFeedPostId = null;
      currentFeedPostCollection = 'feed';
    } else {
      // Snap back: clear inline transform → .is-open CSS rule animates back to 0.
      clearDragTransform(inner);
    }
  };

  grabber.addEventListener('touchstart', onPointerDown, { passive: true });
  grabber.addEventListener('touchmove', onPointerMove, { passive: false });
  grabber.addEventListener('touchend', onPointerUp);
  grabber.addEventListener('touchcancel', onPointerUp);
  grabber.addEventListener('mousedown', (event) => {
    onPointerDown(event);
    const move = (e) => onPointerMove(e);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onPointerUp();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function initReplyComposer() {
  const avatar = document.getElementById('feed-reply-avatar');
  const input = document.getElementById('feed-reply-input');
  const btn = document.getElementById('feed-reply-btn');
  
  if (!avatar || !input || !btn || !currentUser) return;
  clearFeedReplyParent(false);
  updateFeedReplyContext();
  
  const user = usersMap[currentUser.uid] || currentUser;
  const photo = user.photo || user.photoURL || '';
  const name = user.name || user.displayName || 'User';
  const initial = name.charAt(0).toUpperCase();
  
  if (photo) {
    avatar.innerHTML = `<img src="${escAttr(photo)}" alt="">`;
  } else {
    avatar.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#a78bfa;">${initial}</div>`;
  }
  
  // Auto-expand and enable/disable button
  input.oninput = function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 56) + 'px';
    btn.disabled = !this.value.trim();
    syncFeedPostComposerViewport();
  };
  input.onfocus = function() {
    const scroller = document.getElementById('feed-post-scroll-content') || document.querySelector('#feed-post-page .overlay-page-content');
    const keepScrollTop = scroller ? scroller.scrollTop : 0;
    window.requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = keepScrollTop;
      syncFeedPostComposerViewport();
    });
  };
  
  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;
  window.requestAnimationFrame(syncFeedPostComposerViewport);
}

async function submitFeedReply() {
  const input = document.getElementById('feed-reply-input');
  const btn = document.getElementById('feed-reply-btn');
  
  if (!input || !btn || !currentUser || !currentFeedPostId) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  btn.disabled = true;
  btn.textContent = 'Posting...';
  
  try {
    const replyId = crypto.randomUUID ? crypto.randomUUID() : `reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const parentReplyId = String(currentFeedReplyParentId || '').trim();
    const reply = {
      id: replyId,
      uid: currentUser.uid,
      text,
      timestamp: Date.now(),
      ...(parentReplyId ? { parentReplyId } : {})
    };

    const collection = currentFeedPostCollection || 'feed';
    const ref = db.collection(collection).doc(currentFeedPostId);
    await ref.set({ replies: firebase.firestore.FieldValue.arrayUnion(reply) }, { merge: true });

    const latest = await ref.get();
    const latestActivity = latest.exists ? { ...latest.data(), id: currentFeedPostId, _collection: collection } : { replies: [reply] };
    refreshVisibleActivityInteractionCards(currentFeedPostId, latestActivity);

    const rawMemory = friendActivityClickTargets[currentFeedPostId];
    if (rawMemory) rawMemory.replies = Array.isArray(latestActivity.replies) ? latestActivity.replies : [reply];

    input.value = '';
    input.style.height = 'auto';
    clearFeedReplyParent(false);
    btn.textContent = 'Reply';
    btn.disabled = true;
    window.requestAnimationFrame(syncFeedPostComposerViewport);

    if (collection === 'feed') {
      loadFeedPostReplies(currentFeedPostId);
    } else {
      loadActivityReplies(currentFeedPostId, collection);
    }
  } catch(err) {
    console.error('Error posting reply:', err);
    btn.disabled = false;
    btn.textContent = 'Reply';
    alert('Failed to post reply');
  }
}

async function loadFeedPostReplies(postId) {
  const repliesList = document.getElementById('feed-post-replies-list');
  if (!repliesList) return;
  
  try {
    const doc = await db.collection('feed').doc(postId).get();
    if (!doc.exists) {
      repliesList.innerHTML = '';
      return;
    }
    
    const replies = Array.isArray(doc.data().replies) ? doc.data().replies : [];
    updateActivityReplyCountBadge(postId, replies.length);

    if (!replies.length) {
      repliesList.innerHTML = '<div class="x-empty-replies">No replies yet. Be the first to reply.</div>';
      return;
    }

    repliesList.innerHTML = renderFeedRepliesList(replies);
  } catch(err) {
    console.error('Error loading replies:', err);
    repliesList.innerHTML = '<div class="discover-message">Error loading replies</div>';
  }
}

function buildActivityStoriesHTML(activities) {
  const storyByUid = new Map();
  const unreadCutoff = friendActivityStorySeenAtSnapshot || getFriendActivitySeenAt();
  activities.forEach(a => {
    if (!a?.uid) return;
    const activityTime = parseFriendActivityTime(a.timestamp || a.item?.dateModified || a.item?.dateAdded);
    const existing = storyByUid.get(a.uid);
    if (!existing || activityTime > existing.latestTime) {
      storyByUid.set(a.uid, { activity: a, latestTime: activityTime });
    }
  });
  const storyUsers = [...storyByUid.values()].sort((a, b) => b.latestTime - a.latestTime);
  if (!storyUsers.length) return '';
  const items = storyUsers.map(({ activity: a, latestTime }) => {
    const actor = usersMap[a.uid] ? { ...a, ...usersMap[a.uid] } : a;
    const firstName = getDisplayName(actor, 'Friend').split(' ')[0].slice(0, 10);
    const initial = firstName.charAt(0).toUpperCase();
    const avatarSrc = actor.photo || a.photo || '';
    const hasNewActivity = unreadCutoff > 0 && latestTime > unreadCutoff;
    const ringClass = hasNewActivity ? 'story-ring-new' : 'story-ring-seen';
    const innerHtml = avatarSrc
      ? `<img class="story-avatar" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="story-avatar-placeholder" style="display:none">${initial}</span>`
      : `<span class="story-avatar-placeholder">${initial}</span>`;
    return `<div class="activity-story" onclick="openUserActivityPage('${escAttr(a.uid)}', this.querySelector('.story-ring') || this)">
      <div class="story-ring ${ringClass}"><div class="story-avatar-inner">${innerHtml}</div></div>
      <span class="story-name">${escHtml(firstName)}</span>
    </div>`;
  }).join('');
  return `<div class="activity-stories-row" aria-label="Friend activity stories">${items}</div>`;
}

function normalizeActivityRatingOutOfTen(value = 0) {
  const rating = Number(value || 0);
  if (!Number.isFinite(rating) || rating <= 0) return 0;
  return Math.max(0, Math.min(10, rating));
}

function formatActivityRatingScore(value = 0) {
  const rating = normalizeActivityRatingOutOfTen(value);
  if (!rating) return '';
  const rounded = Math.round(rating * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, '');
}

function renderActivityRatingStar(fillPercent = 0, index = 0) {
  const fill = Math.max(0, Math.min(100, Number(fillPercent || 0)));
  const starPath = 'M12 0.95l2.72 7.74 8.18.28-6.45 5.05 2.28 7.88L12 17.25 5.25 21.9l2.28-7.88L1.1 8.97l8.18-.28L12 0.95z';
  return `<span class="sl-rating-star" style="--star-fill:${fill}%" aria-hidden="true">
    <svg class="sl-rating-star-base" viewBox="0 0 24 24" focusable="false"><path d="${starPath}"></path></svg>
    <span class="sl-rating-star-fill"><svg viewBox="0 0 24 24" focusable="false"><path d="${starPath}"></path></svg></span>
  </span>`;
}

function renderActivityUniversalRating(ratingValue = 0) {
  const rating = normalizeActivityRatingOutOfTen(ratingValue);
  if (!rating) return '';
  const starValue = Math.round((rating / 2) * 2) / 2;
  const starHtml = Array.from({ length: 5 }, (_, index) => {
    const fill = Math.max(0, Math.min(1, starValue - index)) * 100;
    return renderActivityRatingStar(fill, index);
  }).join('');
  return `<div class="sl-activity-rating" aria-label="Rating ${escAttr(formatActivityRatingScore(rating))} out of 10">
    <span class="sl-activity-stars">${starHtml}</span>
    <span class="sl-activity-score">${escHtml(formatActivityRatingScore(rating))}/10</span>
  </div>`;
}

function getActivityDisplayAction(eventType = '', item = {}, activity = {}) {
  const section = item.librarySection || item.mediaCategory || '';
  const status = String(activity.nextStatus || item.status || '').toLowerCase();
  const isGame = section === 'games';
  /* v552: combined watch + rate card.
     If the merged activity carries both episode-watched metadata AND a
     rating, render the verb as "watched episode X, rated" so a single
     card describes both signals. */
  const hadEpisodeWatch = !!(activity?.mergedHadEpisodeWatch || item?.lastEpisodeActivityAt);
  const epLabel = String(item?.lastEpisodeActivityLabel || '').trim();
  if (eventType === 'rated' && hadEpisodeWatch) {
    return epLabel ? `watched ${epLabel}, rated` : 'watched an episode, rated';
  }
  if (status === 'watched' || eventType === 'completed') return isGame ? 'played' : 'watched';
  if (eventType === 'import-batch' || activity.type === 'import-batch') return 'imported titles';
  if (eventType === 'episode-watched') return 'watched an episode';
  if (eventType === 'rated') return 'rated';
  if (eventType === 'commented' || activity.type === 'comment') return 'commented';
  if (status === 'watching' || eventType === 'started') return isGame ? 'playing' : 'watching';
  if (status === 'planned' || eventType === 'planned') return isGame ? 'added to Backlog' : 'added to Watchlist';
  if (status === 'paused' || eventType === 'paused') return 'paused';
  if (status === 'dropped' || eventType === 'dropped') return 'dropped';
  if (eventType === 'removed') return 'removed';
  if (eventType === 'status-changed') return status ? `changed to ${status}` : 'updated';
  return 'added';
}

function getActivityPreviewComment(activity = {}, item = {}) {
  const candidates = [
    activity.commentText,
    activity.comment,
    activity.body,
    activity.text,
    activity.watchedComment,
    activity.activityComment,
    item.comment,
    item.watchedComment,
    item.activityComment,
    item.review,
    item.notes
  ];
  return String(candidates.find(value => String(value || '').trim()) || '').trim();
}

function renderActivityCommentPreview(comment = '', activityId = '') {
  const text = String(comment || '').trim();
  if (!text) return '';
  const shouldClamp = text.length > 135;
  return `<div class="sl-activity-comment-wrap${shouldClamp ? ' is-clamped' : ''}" data-activity-comment-wrap>
    <div class="sl-activity-comment" data-activity-comment-text>${escHtml(text)}</div>
    ${shouldClamp ? `<button class="sl-activity-show-more" type="button" onclick="event.stopPropagation(); toggleActivityCommentPreview(this)">Show more</button>` : ''}
  </div>`;
}

function toggleActivityCommentPreview(btn) {
  const wrap = btn?.closest?.('[data-activity-comment-wrap]');
  if (!wrap) return;
  const expanded = wrap.classList.toggle('is-expanded');
  wrap.classList.toggle('is-clamped', !expanded);
  btn.textContent = expanded ? 'Show less' : 'Show more';
}



function toggleImportActivityCard(btn, forceState = null) {
  const card = btn?.closest?.('[data-import-activity-card]');
  if (!card) return;
  const expanded = forceState === null ? !card.classList.contains('expanded') : !!forceState;
  card.classList.toggle('expanded', expanded);
  card.querySelectorAll('.import-activity-toggle, .import-activity-collapse-float').forEach(button => {
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });
  const label = card.querySelector('[data-import-toggle-label]');
  if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
  if (expanded) {
    const list = card.querySelector('.import-activity-list');
    if (list) list.scrollTop = 0;
  }
}

function buildImportActivityCardHTML(a = {}, activityId = '', options = {}) {
  // v430: import activity card now mirrors a normal activity card —
  //   - heart + comment action row restored
  //   - right cluster shows count "Expand N titles" + max 3 preview posters
  //   - clicking the card or the right cluster expands inline using the same
  //     setScreenListInlineActivityStackExpanded() machinery as stacked activities,
  //     animating via _slExpandStack/_slCollapseStack
  //   - expanded body is a 3-column grid of poster + game name only
  const items = Array.isArray(a.importItems) ? a.importItems : [];
  const actor = usersMap[a.uid] ? { ...a, ...usersMap[a.uid] } : a;
  const avatarSrc = actor.photo || a.photo || '';
  const initial = getDisplayName(actor, 'F').charAt(0).toUpperCase();
  const actorName = renderDisplayNameHTML(actor, 'Friend', '');
  const sourceLabel = a.importSourceLabel || getScreenListImportSourceLabel(a.importSource || a.item?.importSource || '');
  const section = a.importSection || a.item?.librarySection || a.item?.mediaCategory || '';
  const sectionLabel = getSectionLabel2(section) || getSectionLabel(section, true) || 'Library';
  const count = items.length;
  const timeStr = relativeTime(a.timestamp || a.item?.dateAdded || Date.now());
  const avatarHtml = avatarSrc
    ? `<button class="sl-activity-avatar-btn" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','${escAttr(avatarSrc)}',event.currentTarget)" title="View list" aria-label="Open ${escAttr(getDisplayName(actor, 'Friend'))} list"><img class="sl-activity-avatar-img" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="sl-activity-avatar-fallback" style="display:none">${escHtml(initial)}</span></button>`
    : `<button class="sl-activity-avatar-btn" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','',event.currentTarget)" title="View list" aria-label="Open ${escAttr(getDisplayName(actor, 'Friend'))} list"><span class="sl-activity-avatar-fallback">${escHtml(initial)}</span></button>`;

  // Right cluster preview: max 3 mini posters
  const previewTiles = items.slice(0, 3).map(item => {
    const cover = getScreenListActivityItemCover(item);
    return `<div class="import-activity-preview-tile import-activity-preview-tile-mini">${cover ? `<img src="${escAttr(cover)}" alt="" loading="lazy">` : `<span>${escHtml((item.title || '?').charAt(0).toUpperCase())}</span>`}</div>`;
  }).join('');

  // Expanded grid: 3 columns × N rows, poster + name only
  const gridCells = items.map(item => {
    const cover = getScreenListActivityItemCover(item);
    const title = item.title || item.name || 'Untitled';
    return `<div class="import-activity-grid-cell">
      <div class="import-activity-grid-poster">${cover ? `<img src="${escAttr(cover)}" alt="" loading="lazy">` : `<span>${escHtml((title || '?').charAt(0).toUpperCase())}</span>`}</div>
      <div class="import-activity-grid-name">${escHtml(title)}</div>
    </div>`;
  }).join('');

  const isLiked = currentUser && Array.isArray(a.likes) && a.likes.includes(currentUser.uid);
  const likeCount = Array.isArray(a.likes) ? a.likes.length : 0;
  const replyCount = Array.isArray(a.replies) ? a.replies.length : 0;
  const isExpanded = screenListExpandedInlineActivityStacks.has(String(activityId || ''));
  const deleteHtml = canCurrentUserDeleteActivity(a) ? `
      <button class="sl-activity-action-btn activity-interaction-btn" data-activity-action="delete" onclick="event.stopPropagation(); openScreenListDeletePostPrompt('${escAttr(activityId)}','activities')" aria-label="Delete activity">
        ${getScreenListTrashIconSvg()}
      </button>` : '';

  return `<article class="shelfd-social-card import-activity-card sl-import-activity-stack-wrap${isExpanded ? ' is-expanded' : ''}" data-import-activity-card="1" data-stacked-activity-id="${escAttr(activityId)}" data-activity-card-id="${escAttr(activityId)}" data-activity-id="${escAttr(activityId)}">
    <div class="import-activity-top">
      <div class="sl-activity-avatar-zone">${avatarHtml}</div>
      <div class="import-activity-copy">
        <div class="sl-activity-meta-row"><button class="sl-activity-name" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','${escAttr(avatarSrc)}',event.currentTarget)">${actorName}</button><span class="sl-activity-dot">·</span><time class="sl-activity-time">${escHtml(timeStr)}</time></div>
        <div class="import-activity-title">Imported ${count} ${escHtml(sectionLabel)} ${count === 1 ? 'title' : 'titles'}</div>
        <div class="import-activity-status">${escHtml(sourceLabel)} library import</div>
      </div>
    </div>
    <div class="import-activity-bottom">
      <div class="sl-activity-actions activity-interactions import-activity-actions" data-activity-interactions>
        <button class="sl-activity-action-btn activity-interaction-btn" data-activity-action="reply" onclick="event.stopPropagation(); openActivityReplyPage('${escAttr(activityId)}')" aria-label="Open comments">
          ${getScreenListReplyIconSvg()}
          <span data-activity-reply-count>${replyCount}</span>
        </button>
        <button class="sl-activity-action-btn activity-interaction-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" onclick="event.stopPropagation(); toggleActivityLike('${escAttr(activityId)}', this)" aria-label="Like activity">
          <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span>
          <span data-activity-like-count>${likeCount}</span>
        </button>${deleteHtml}
      </div>
      <button class="import-activity-right-cluster" type="button" data-inline-stack-toggle aria-expanded="${isExpanded ? 'true' : 'false'}" onclick="event.stopPropagation(); toggleScreenListInlineActivityStack('${escAttr(activityId)}', event)" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${count} imported title${count === 1 ? '' : 's'}">
        <span class="import-activity-count-label" data-import-toggle-label>${isExpanded ? 'Collapse' : 'Expand'} ${count} title${count === 1 ? '' : 's'}</span>
        <span class="import-activity-preview-stack">${previewTiles}</span>
      </button>
    </div>
    <div class="sl-activity-stack-inline-list import-activity-grid-panel" data-inline-stack-panel aria-hidden="${isExpanded ? 'false' : 'true'}" role="region" aria-label="Imported titles">
      <div class="sl-activity-stack-inline-inner import-activity-grid-inner">
        <div class="import-activity-grid">${gridCells}</div>
      </div>
    </div>
  </article>`;
}


function buildStackedActivityCardHTML(a = {}, activityId = '', options = {}) {
  const items = Array.isArray(a.stackedActivities) ? a.stackedActivities : [];
  const primary = cloneScreenListStackActivity(a.stackPrimaryActivity || items[0] || {});
  if (!primary || !Object.keys(primary).length) return '';
  const extraCount = Math.max(0, (items.length || Number(a.stackCount || 0)) - 1);
  const isExpanded = screenListExpandedInlineActivityStacks.has(String(activityId || ''));
  const hiddenItems = items.slice(1);
  let html = buildActivityCardHTML(primary, activityId, { ...options, renderStackPrimary: true, stackExtraCount: extraCount, stackActivityId: activityId });
  html = html.replace('class="shelfd-social-card ', 'class="shelfd-social-card sl-activity-stack-front ');
  html = html.replace('<article ', `<article aria-label="Open grouped activity stack" `);
  html = html.replace(/onclick="handleScreenListActivityCardOpen\('[^']*','activity'\)"/, `onclick="toggleScreenListInlineActivityStack('${escAttr(activityId)}', event)"`);
  const hiddenHtml = hiddenItems.map((activity, index) => {
    const childId = `${activityId}-inline-stack-${index}`;
    friendActivityClickTargets[childId] = activity;
    let childHtml = buildActivityCardHTML(activity, childId, { hideActorName: true, compactStackChild: true });
    childHtml = childHtml.replace('class="shelfd-social-card ', `class="shelfd-social-card sl-activity-stack-compact-card `);
    childHtml = childHtml.replace('<article ', `<article style="--stack-index:${index}; --stack-reverse-index:${Math.max(0, hiddenItems.length - index - 1)}" `);
    // v433: clicking the body of an expanded stack child now collapses the whole
    // stack instead of opening that child's media profile. Inner buttons (avatar,
    // poster, heart, comment, etc.) all use event.stopPropagation() so they
    // continue firing their own actions and never reach this article-level click.
    childHtml = childHtml.replace(
      `onclick="handleScreenListActivityCardOpen('${escAttr(childId)}','activity')"`,
      `onclick="handleScreenListStackChildClick('${escAttr(childId)}','${escAttr(activityId)}', event)"`
    );
    return childHtml;
  }).join('');
  return `
    <div class="sl-activity-stack-wrap ${isExpanded ? 'is-expanded' : ''}" data-stacked-activity-id="${escAttr(activityId)}">
      <button class="sl-activity-stack-layer sl-activity-stack-layer-one" type="button" data-inline-stack-toggle onclick="toggleScreenListInlineActivityStack('${escAttr(activityId)}', event)" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="Toggle grouped activity stack"></button>
      <button class="sl-activity-stack-layer sl-activity-stack-layer-two" type="button" data-inline-stack-toggle onclick="toggleScreenListInlineActivityStack('${escAttr(activityId)}', event)" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="Toggle grouped activity stack"></button>
      ${html}
      ${hiddenHtml ? `<div class="sl-activity-stack-inline-list" data-inline-stack-panel aria-hidden="${isExpanded ? 'false' : 'true'}"><div class="sl-activity-stack-inline-inner">${hiddenHtml}</div></div>` : ''}
    </div>`;
}

function buildActivityCardHTML(a, activityId, options = {}) {
  if (a.type === 'activity-stack' && !options.renderStackPrimary) {
    return buildStackedActivityCardHTML(a, activityId, options);
  }
  if (a.type === 'import-batch') {
    return buildImportActivityCardHTML(a, activityId, options);
  }
  if (a.type === 'post' || a.type === 'trailer') {
    return buildFeedPostCardHTML(a, activityId, options);
  }

  const hideActorName = !!options.hideActorName;
  const item = a.item || {};
  const actor = usersMap[a.uid] ? { ...a, ...usersMap[a.uid] } : a;
  const eventType = getActivityEventType(a);
  const section = item.librarySection || item.mediaCategory || '';
  const sectionLabel = getSectionLabel2(section);
  const meta = ACTIVITY_TYPE_META[eventType] || ACTIVITY_TYPE_META.added;
  const timeStr = relativeTime(a.timestamp || item.dateModified || item.dateAdded || item.updatedAt || item.createdAt);
  const title = item.title || item.name || 'Untitled';
  const activityAction = getActivityDisplayAction(eventType, item, a);

  const avatarSrc = actor.photo || a.photo || '';
  const initial = getDisplayName(actor, 'F').charAt(0).toUpperCase();
  const actorName = renderDisplayNameHTML(actor, 'Friend', '');
  const avatarHtml = avatarSrc
    ? `<button class="sl-activity-avatar-btn" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','${escAttr(avatarSrc)}',event.currentTarget)" title="View list" aria-label="Open ${escAttr(getDisplayName(actor, 'Friend'))} list"><img class="sl-activity-avatar-img" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="sl-activity-avatar-fallback" style="display:none">${escHtml(initial)}</span></button>`
    : `<button class="sl-activity-avatar-btn" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','',event.currentTarget)" title="View list" aria-label="Open ${escAttr(getDisplayName(actor, 'Friend'))} list"><span class="sl-activity-avatar-fallback">${escHtml(initial)}</span></button>`;

  const itemCover = getScreenListActivityItemCover(item);
  const actorPhoto = String(avatarSrc || '').trim();
  const mediaCover = itemCover && itemCover !== actorPhoto ? itemCover : '';
  const posterClick = `event.stopPropagation(); handleActivityMediaClick('${escAttr(activityId)}', this)`;
  const posterHtml = mediaCover
    ? `<button type="button" class="sl-activity-poster" data-activity-game-poster="${section === 'games' ? '1' : '0'}" data-activity-game-activity-id="${escAttr(activityId)}" data-game-title="${escAttr(title)}" data-rawg-id="${escAttr(getGameRawgIdValue(item) || '')}" data-steam-app-id="${escAttr(item.steamAppId || item.appId || '')}" onclick="${posterClick}" aria-label="Open ${escAttr(title)} media profile"><img class="sl-activity-poster-img" src="${escAttr(mediaCover)}" alt="${escAttr(title)}" loading="lazy"></button>`
    : (section === 'games'
      ? `<button type="button" class="sl-activity-poster sl-activity-poster-empty screenlist-game-cover-pending" data-activity-game-poster="1" data-activity-game-activity-id="${escAttr(activityId)}" data-game-title="${escAttr(title)}" data-rawg-id="${escAttr(getGameRawgIdValue(item) || '')}" data-steam-app-id="${escAttr(item.steamAppId || item.appId || '')}" onclick="${posterClick}" aria-label="Open ${escAttr(title)} media profile"><span>${escHtml(title || 'Shelfd')}</span></button>`
      : `<button type="button" class="sl-activity-poster sl-activity-poster-empty" onclick="${posterClick}" aria-label="Open ${escAttr(title)} media profile"><span>${escHtml((sectionLabel || title || '?').charAt(0).toUpperCase())}</span></button>`);

  const ratingHtml = renderActivityUniversalRating(item.rating || a.rating || a.activityRating || 0);
  const commentHtml = renderActivityCommentPreview(getActivityPreviewComment(a, item), activityId);

  const likes = Array.isArray(a.likes) ? a.likes : [];
  const isLiked = currentUser && likes.includes(currentUser.uid);
  const likeCount = likes.length;
  const replies = Array.isArray(a.replies) ? a.replies : [];
  const replyCount = replies.length;
  const stackExtraCount = Math.max(0, Number(options.stackExtraCount || 0));
  const stackActivityId = options.stackActivityId || activityId;
  const stackExtraHtml = stackExtraCount > 0 ? `
      <button class="sl-activity-action-btn activity-interaction-btn sl-activity-stack-action-count" data-activity-action="stack" data-inline-stack-toggle onclick="toggleScreenListInlineActivityStack('${escAttr(stackActivityId)}', event)" aria-expanded="${screenListExpandedInlineActivityStacks.has(String(stackActivityId || '')) ? 'true' : 'false'}" aria-label="Toggle ${stackExtraCount} more grouped activities">+${stackExtraCount}</button>` : '';
  const deleteHtml = canCurrentUserDeleteActivity(a) ? `
      <button class="sl-activity-action-btn activity-interaction-btn" data-activity-action="delete" onclick="event.stopPropagation(); openScreenListDeletePostPrompt('${escAttr(activityId)}','activities')" aria-label="Delete activity">
        ${getScreenListTrashIconSvg()}
      </button>` : '';
  const interactionsHtml = options.hideInteractions ? '' : `
    <div class="sl-activity-actions activity-interactions" data-activity-interactions>
      ${stackExtraHtml}
      <button class="sl-activity-action-btn activity-interaction-btn" data-activity-action="reply" onclick="event.stopPropagation(); openActivityReplyPage('${escAttr(activityId)}')" aria-label="Open comments">
        ${getScreenListReplyIconSvg()}
        <span data-activity-reply-count>${replyCount}</span>
      </button>
      <button class="sl-activity-action-btn activity-interaction-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" onclick="event.stopPropagation(); toggleActivityLike('${escAttr(activityId)}', this)" aria-label="Like activity">
        <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span>
        <span data-activity-like-count>${likeCount}</span>
      </button>${deleteHtml}
    </div>`;

  const nameLine = hideActorName
    ? `<span class="sl-activity-name-spacer" aria-hidden="true"></span>`
    : `<button class="sl-activity-name" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','${escAttr(avatarSrc)}',event.currentTarget)">${actorName}</button>`;

  return `<article class="shelfd-social-card ${meta.topClass}" data-activity-card-id="${escAttr(activityId)}" data-activity-id="${escAttr(activityId)}" data-shelfd-activity-card="v4" onclick="handleScreenListActivityCardOpen('${escAttr(activityId)}','activity')">
    <div class="sl-activity-main">
      <div class="sl-activity-avatar-zone">${avatarHtml}</div>
      <div class="sl-activity-copy-zone">
        <div class="sl-activity-meta-row">${nameLine}<span class="sl-activity-dot">·</span><time class="sl-activity-time">${escHtml(timeStr)}</time></div>
        <button class="sl-activity-title" type="button" onclick="event.stopPropagation(); handleActivityMediaClick('${escAttr(activityId)}', this)">${escHtml(title)}</button>
        <div class="sl-activity-status">${escHtml(activityAction)}</div>
        ${ratingHtml}
        ${commentHtml}
      </div>
    </div>
    <div class="sl-activity-bottom-safe">${interactionsHtml}</div>
    ${posterHtml}
  </article>`;
}

function buildActivityItemHTML(a, activityId) {
  return buildActivityCardHTML(a, activityId);
}

function getActivityTimeGroup(timestamp) {
  if (!timestamp) return 'Earlier';
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!ts) return 'Earlier';
  const now = Date.now();
  const diff = now - ts;
  const DAY = 86400000;
  if (diff < DAY) return 'Today';
  if (diff < 2 * DAY) return 'Yesterday';
  if (diff < 7 * DAY) return 'This Week';
  if (diff < 14 * DAY) return 'Last Week';
  return 'Earlier';
}

function getUserActivityTimeGroup(timestamp) {
  if (!timestamp) return 'Earlier';
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!ts) return 'Earlier';
  const nowDate = new Date();
  const itemDate = new Date(ts);
  const diff = Date.now() - ts;
  const DAY = 86400000;
  if (diff < DAY) return 'Today';
  if (diff < 7 * DAY) return 'This Week';
  if (itemDate.getFullYear() === nowDate.getFullYear() && itemDate.getMonth() === nowDate.getMonth()) return 'This Month';
  return 'Earlier';
}

function getActivityGroupLabelClass(groupName = '') {
  return 'activity-group-label-' + String(groupName || 'earlier').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}


function buildSharedWatchCountBubbleHTML() {
  const count = getSharedWatchActivityTotal();
  return `<span class="activity-shared-watch-count" data-shared-watch-count style="display:${count > 0 ? 'inline-flex' : 'none'};">${count > 0 ? String(count) : ''}</span>`;
}

function buildActivityFeedHeaderHTML(heading = 'Activity Feed', options = {}) {
  const showSectionNav = options.showSharedWatch !== false;
  const actionButtons = [];
  if (showSectionNav) {
    const friendWatchActive = activeActivitySubTab === 'friendWatch';
    const feedActive = activeActivitySubTab === 'feed';
    const sharedWatchActive = activeActivitySubTab === 'sharedWatch';
    actionButtons.push(`<button type="button" class="activity-shared-watch-pill friend-watch-pill ${friendWatchActive ? 'active' : 'secondary'}" aria-current="${friendWatchActive ? 'true' : 'false'}" onclick="switchActivitySubTab('friendWatch')">Watch Together ${buildSharedWatchCountBubbleHTML()}</button>`);
    actionButtons.push(`<button type="button" class="activity-shared-watch-pill activity-feed-pill ${feedActive ? 'active' : 'secondary'}" aria-current="${feedActive ? 'true' : 'false'}" onclick="switchActivitySubTab('feed')">Activity</button>`);
    actionButtons.push(`<button type="button" class="activity-shared-watch-pill shared-watch-tab-pill ${sharedWatchActive ? 'active' : 'secondary'}" aria-current="${sharedWatchActive ? 'true' : 'false'}" onclick="switchActivitySubTab('sharedWatch')">Shared Watch</button>`);
  }
  if (options.hideHeading && !actionButtons.length) return '';
  return `<div class="activity-feed-header"><span class="activity-feed-heading">${options.hideHeading ? '' : escHtml(heading)}</span><div class="activity-feed-actions">${actionButtons.join('')}</div></div>`;
}


function renderFriendActivityItems(feed, activities, options = {}) {
  friendActivityClickTargets = {};
  activities = collapseStackedActivityBurstActivities(Array.isArray(activities) ? activities : []);

  if (!activities.length) {
    feed.innerHTML = `<div class="activity-feed-empty"><strong>Nothing yet</strong>${options.emptyText || 'Add friends to see what they are watching, playing, and rating.'}</div>`;
    return;
  }

  const useUserActivityGroups = !!options.useUserActivityGroups;
  const groupOrder = useUserActivityGroups
    ? ['Today', 'This Week', 'This Month', 'Earlier']
    : ['Today', 'Yesterday', 'This Week', 'Last Week', 'Earlier'];
  const groups = {};
  groupOrder.forEach(g => { groups[g] = []; });

  activities.forEach((activity, index) => {
    const ts = activity.timestamp || activity.item?.dateAdded;
    const group = useUserActivityGroups ? getUserActivityTimeGroup(ts) : getActivityTimeGroup(ts);
    const id = getStableActivityDocId(activity, `activity-${index}`);
    friendActivityClickTargets[id] = activity;
    if (!groups[group]) groups[group] = [];
    groups[group].push({ activity, id });
  });

  const storiesHtml = options.hideStories ? '' : buildActivityStoriesHTML(activities);

  let cardsHtml = '';
  groupOrder.forEach(groupName => {
    if (!groups[groupName].length) return;
    cardsHtml += `<div class="activity-group-label ${getActivityGroupLabelClass(groupName)}">${groupName}</div>`;
    groups[groupName].forEach(({ activity, id }) => {
      cardsHtml += buildActivityCardHTML(activity, id, options);
    });
  });

  feed.innerHTML =
    buildActivityFeedHeaderHTML(options.heading || 'Activity Feed', { showSharedWatch: !options.hideSharedWatchPill, showRefresh: !options.hideRefresh, hideHeading: !!options.hideHeading }) +
    storiesHtml +
    `<div class="activity-feed-list">${cardsHtml}</div>`;

  feed.querySelectorAll('.activity-card, .shelfd-social-card').forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
  });
  hydrateActivityInteractionCounts(feed);
  scheduleBackfillActivityGamePosters(feed);
}

function getScreenListActivityIgdbCoverFetchTitle(item = {}, poster = null) {
  return String(item.title || item.name || poster?.dataset?.gameTitle || poster?.dataset?.discoverTitle || '').trim();
}

async function fetchScreenListActivityForcedIgdbCover(item = {}, poster = null) {
  const title = getScreenListActivityIgdbCoverFetchTitle(item, poster);
  if (!title) return null;
  try {
    const params = new URLSearchParams({ title, force: '1', strict: '1', activity: '1', t: String(Date.now()) });
    const steamAppId = String(item.steamAppId || item.appId || poster?.dataset?.steamAppId || '').trim();
    const rawgId = String(item.rawgId || item.id || poster?.dataset?.rawgId || poster?.dataset?.mediaId || '').trim();
    if (steamAppId) params.set('steamAppId', steamAppId);
    if (rawgId) params.set('rawgId', rawgId);
    const res = await fetch('/api/igdb/cover?' + params.toString(), { cache: 'no-store' });
    const json = res.ok ? await res.json() : null;
    return json?.ok && json.coverUrl ? json : null;
  } catch (error) {
    console.warn('Forced Activity IGDB/Twitch cover lookup failed:', title, error);
    return null;
  }
}

function updateScreenListActivityPosterElement(poster = null, coverUrl = '') {
  if (!poster || !coverUrl) return;
  const img = poster.matches?.('img') ? poster : poster.querySelector?.('img');
  if (img) {
    img.src = coverUrl;
    img.setAttribute('src', coverUrl);
  }
  if (!poster.matches?.('img')) {
    poster.style.backgroundImage = `url('${coverUrl}')`;
    poster.style.backgroundSize = 'cover';
    poster.style.backgroundPosition = 'top center';
    poster.classList.remove('no-img');
  }
  poster.dataset.igdbCoverApplied = '1';
  poster.dataset.poster = coverUrl;
}

async function persistActivityGameIgdbCover(activityId = '', activity = {}, cover = {}) {
  const coverUrl = String(cover?.coverUrl || '').trim();
  if (!activityId || !activity || !coverUrl) return;
  const item = { ...(activity.item || {}) };
  if (typeof applyScreenListIgdbCoverToGameItem === 'function') {
    applyScreenListIgdbCoverToGameItem(item, cover);
  } else {
    item.igdbCoverUrl = coverUrl;
    item.cover = coverUrl;
    item.poster = coverUrl;
    item.image = coverUrl;
    item.background_image = coverUrl;
    item.coverProvider = 'igdb';
    item.coverSource = 'igdb';
  }
  activity.item = { ...(activity.item || {}), ...item };
  activity.igdbCoverUrl = coverUrl;
  activity.cover = coverUrl;
  activity.poster = coverUrl;
  activity.image = coverUrl;
  activity.background_image = coverUrl;
  activity.__igdbActivityCoverSaved = coverUrl;

  try {
    const target = await resolveActivityInteractionTarget(activityId);
    if (!target?.ref) return;
    await target.ref.set({
      item: activity.item,
      igdbCoverUrl: coverUrl,
      cover: coverUrl,
      poster: coverUrl,
      image: coverUrl,
      background_image: coverUrl,
      coverProvider: 'igdb',
      coverSource: 'igdb',
      igdbCoverUpdatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.warn('Activity IGDB/Twitch cover save failed:', error);
  }
}

const activityGamePosterBackfillDone = new Set();
const activityGamePosterBackfillInFlight = new Set();
let activityGamePosterBackfillTimer = null;

function getActivityGamePosterBackfillKey(activityId = '', item = {}, currentCover = '') {
  const mediaKey = item.mediaKey || (typeof getMediaKey === 'function' ? getMediaKey(item) : '') || item.rawgId || item.steamAppId || item.title || item.name || '';
  return [activityId || 'activity', mediaKey || 'game', currentCover || 'no-cover'].join('|');
}

function scheduleBackfillActivityGamePosters(root = document) {
  if (!root || typeof backfillActivityGamePosters !== 'function') return;
  if (activityGamePosterBackfillTimer) clearTimeout(activityGamePosterBackfillTimer);
  const run = () => {
    activityGamePosterBackfillTimer = null;
    const start = () => backfillActivityGamePosters(root).catch(error => console.warn('Activity game poster backfill failed:', error));
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(start, { timeout: 1600 });
    } else {
      window.setTimeout(start, 260);
    }
  };
  activityGamePosterBackfillTimer = window.setTimeout(run, 180);
}

async function backfillActivityGamePosters(root = document) {
  if (!root || typeof forceHydrateScreenListGamePosterElement !== 'function') return;
  const posters = Array.from(root.querySelectorAll('[data-activity-game-poster="1"]'));
  for (const poster of posters) {
    const card = poster.closest?.('[data-activity-card-id], [data-activity-id]');
    const activityId = poster.dataset.activityGameActivityId || card?.getAttribute('data-activity-card-id') || card?.getAttribute('data-activity-id') || '';
    const activity = activityId ? friendActivityClickTargets[activityId] : null;
    const item = activity?.item || {};
    const title = poster.dataset.gameTitle || item.title || item.name || '';
    if (!title) continue;
    const img = poster.matches?.('img') ? poster : poster.querySelector?.('img');
    const currentCover = String(img?.currentSrc || img?.src || item.igdbCoverUrl || item.cover || item.poster || item.image || item.background_image || '').trim();
    const backfillKey = getActivityGamePosterBackfillKey(activityId, item, currentCover);
    const currentIsIgdb = typeof isScreenListIgdbCoverUrl === 'function' && isScreenListIgdbCoverUrl(currentCover);
    if (currentIsIgdb && activity?.__igdbActivityCoverSaved === currentCover) {
      activityGamePosterBackfillDone.add(backfillKey);
      continue;
    }
    if (currentIsIgdb && activityGamePosterBackfillDone.has(backfillKey)) continue;
    if (activityGamePosterBackfillInFlight.has(backfillKey)) continue;
    activityGamePosterBackfillInFlight.add(backfillKey);
    try {
      const payload = {
        ...item,
        title,
        name: item.name || title,
        rawgId: item.rawgId || poster.dataset.rawgId || getGameRawgIdValue(item) || '',
        id: item.id || item.rawgId || poster.dataset.rawgId || '',
        steamAppId: item.steamAppId || item.appId || poster.dataset.steamAppId || '',
        librarySection: 'games',
        mediaCategory: 'games'
      };
      let cover = currentIsIgdb ? null : await fetchScreenListActivityForcedIgdbCover(payload, poster);
      if (!cover?.coverUrl && typeof forceHydrateScreenListGamePosterElement === 'function') {
        cover = await forceHydrateScreenListGamePosterElement(poster, payload);
      }
      if (cover?.coverUrl && (typeof isScreenListIgdbCoverUrl !== 'function' || isScreenListIgdbCoverUrl(cover.coverUrl))) {
        updateScreenListActivityPosterElement(poster, cover.coverUrl);
        if (activityId && activity) {
          await persistActivityGameIgdbCover(activityId, activity, cover);
          activityGamePosterBackfillDone.add(getActivityGamePosterBackfillKey(activityId, activity.item || item, cover.coverUrl));
        }
      }
      if (currentIsIgdb || cover?.coverUrl) activityGamePosterBackfillDone.add(backfillKey);
    } catch (error) {
      console.warn('Activity game poster repair skipped:', error);
    } finally {
      activityGamePosterBackfillInFlight.delete(backfillKey);
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
}

function getActivityMediaProfileTarget(activity = {}) {
  const item = activity.item || {};
  const mediaKey = activity.mediaKey || getMediaKey(item) || '';
  const section = item.librarySection || item.mediaCategory || '';

  if (section === 'games') {
    const rawgId = getGameRawgIdValue(item);
    return { kind: 'game', rawgId, seed: item };
  }

  const tmdbKeyMatch = String(mediaKey || '').match(/^tmdb-(movie|tv):(\d+)/);
  if (tmdbKeyMatch) {
    return { kind: 'tmdb', type: tmdbKeyMatch[1], id: Number(tmdbKeyMatch[2]) };
  }

  const tmdbId = Number(item.tmdbId || item.tmdb_id || item.sourceId || 0);
  if (tmdbId && (section === 'movies' || section === 'shows' || section === 'anime')) {
    return { kind: 'tmdb', type: section === 'movies' ? 'movie' : 'tv', id: tmdbId };
  }

  return null;
}

function getActivityMediaProfileTransitionOrigin(triggerEl = null) {
  return triggerEl || null;
}

function isActivityMediaProfileOrigin(triggerEl = null) {
  return !!(triggerEl && typeof triggerEl.closest === 'function' && triggerEl.closest('.activity-poster-col, .activity-poster-placeholder'));
}

async function resolveActivityMediaProfileTarget(activity = {}) {
  const item = activity.item || {};
  const directTarget = getActivityMediaProfileTarget(activity);
  if (directTarget) return directTarget;

  const title = String(item.title || item.name || '').trim();
  if (!title) return null;

  const section = String(item.librarySection || item.mediaCategory || '').toLowerCase();
  const year = String(
    item.year ||
    item.releaseYear ||
    item.release_date ||
    item.first_air_date ||
    item.released ||
    ''
  ).slice(0, 4);

  if (section === 'games') {
    try {
      const gameRes = await fetchRawgProxy('games', { search: title, page_size: 5 });
      if (!gameRes.ok) throw new Error(`RAWG activity resolve failed: ${gameRes.status}`);
      const gameJson = await gameRes.json();
      const gameResults = gameJson?.results || [];
      const gamePicked = year
        ? (gameResults.find(entry => String(entry.released || '').slice(0, 4) === year) || gameResults[0])
        : gameResults[0];
      if (gamePicked?.id) {
        return { kind: 'game', rawgId: String(gamePicked.id), seed: { ...item, ...gamePicked } };
      }
    } catch (error) {
      console.error('Activity game profile resolve failed:', error);
    }
    return null;
  }

  const searchType = section === 'movies' ? 'movie' : 'tv';
  try {
    const params = { query: title };
    if (year) params[searchType === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
    let res = await fetchTmdbProxy(`search/${searchType}`, params);
    if (!res.ok) throw new Error(`TMDB activity resolve failed: ${res.status}`);
    let json = await res.json();
    let results = json?.results || [];
    if (!results.length && year) {
      res = await fetchTmdbProxy(`search/${searchType}`, { query: title });
      if (!res.ok) throw new Error(`TMDB activity fallback resolve failed: ${res.status}`);
      json = await res.json();
      results = json?.results || [];
    }
    const picked = pickDeepSeekResolvedMediaResult(results, title, year);
    if (picked?.id) {
      return {
        kind: 'tmdb',
        type: searchType,
        id: Number(picked.id),
        seed: { ...item, ...picked }
      };
    }
  } catch (error) {
    console.error('Activity TMDB profile resolve failed:', error);
  }

  return null;
}

async function openActivityMediaFullProfile(activity = {}, triggerEl = null) {
  const item = activity.item || {};
  const target = await resolveActivityMediaProfileTarget(activity);
  const transitionOrigin = getActivityMediaProfileTransitionOrigin(triggerEl);
  if (!target) {
    if (typeof showToast === 'function') showToast('Could not open media profile');
    return;
  }
  if (target.kind === 'game') {
    const gameSeed = target.seed || item;
    if (target.rawgId) {
      setGameMediaProfileSeed(target.rawgId, {
        ...gameSeed,
        id: target.rawgId,
        rawgId: String(target.rawgId),
        title: gameSeed.title || gameSeed.name || '',
        name: gameSeed.name || gameSeed.title || ''
      });
    }
    openGameMediaProfile(null, target.rawgId || '', gameSeed, transitionOrigin);
    return;
  }
  if (target.kind === 'tmdb') {
    const seed = target.seed || item;
    setDiscoverMediaProfileSeed(target.type, target.id, {
      ...seed,
      id: target.id,
      tmdbId: target.id,
      title: seed.title || seed.name || '',
      name: seed.name || seed.title || '',
      poster: seed.cover || seed.poster || '',
      backdrop: seed.backdrop || seed.cover || seed.poster || '',
      librarySection: seed.librarySection || seed.mediaCategory || (target.type === 'movie' ? 'movies' : 'shows'),
      mediaCategory: seed.mediaCategory || seed.librarySection || (target.type === 'movie' ? 'movies' : 'shows')
    });
    openDiscoverMediaProfile(null, target.type, target.id, transitionOrigin);
  }
}

function handleActivityMediaClick(activityId, triggerEl = null) {
  const activity = friendActivityClickTargets[activityId];
  if (!activity || !activity.item) return;
  openActivityMediaFullProfile(activity, triggerEl);
}

function handleFriendActivityClick(activityId) {
  const activity = friendActivityClickTargets[activityId];
  if (!activity) return;
  if (activity.type === 'comment') {
    const item = activity.item || {};
    openCommentsPageForActivity(activity.mediaKey, item.title || 'Untitled', item.cover || '', activity.commentId || '');
    return;
  }
  viewUserFromMap(activity.uid);
}

function getFriendActivityCacheKey(dayLimit = 7) {
  return `${isPreviewMode() ? 'preview' : (currentUser?.uid || 'guest')}|${friends.slice().sort().join(',')}|${dayLimit || 0}`;
}

function cloneFriendActivityList(activities = []) {
  return (Array.isArray(activities) ? activities : []).map(activity => ({
    ...activity,
    item: activity.item ? { ...activity.item } : activity.item
  }));
}

function getFreshFriendActivityCache(dayLimit = 7) {
  const cacheKey = getFriendActivityCacheKey(dayLimit);
  const now = Date.now();
  if (
    friendActivityCache &&
    friendActivityCache.key === cacheKey &&
    (now - friendActivityCache.timestamp) < FRIEND_ACTIVITY_CACHE_MS
  ) {
    return cloneFriendActivityList(friendActivityCache.activities).filter(activity => !isScreenListActivityDeletedForOwner(activity, activity.eventKey || activity.id || activity.activityId || ''));
  }
  return null;
}

async function fetchAllFriendActivities(dayLimit = 7) {
  const cacheKey = getFriendActivityCacheKey(dayLimit);
  const cachedActivities = getFreshFriendActivityCache(dayLimit);
  if (cachedActivities) return cachedActivities;
  if (friendActivityPromise && friendActivityPromise.key === cacheKey) {
    return friendActivityPromise.promise;
  }

  const loader = (async () => {
  if (isPreviewMode()) {
    const previewActivities = PREVIEW_COMMUNITY_USERS.map((user, index) => {
      const sections = ['shows', 'movies', 'anime', 'games'];
      const item = sections.flatMap(section => user.listData[section] || []).find(entry => entry.title);
      return item ? { uid: user.uid, name: user.name, photo: user.photo, item: { ...item, dateAdded: new Date(Date.now() - (index + 1) * 45 * 60000).toISOString() } } : null;
    }).filter(Boolean);
    friendActivityCache = { key: cacheKey, timestamp: Date.now(), activities: previewActivities };
    return cloneFriendActivityList(previewActivities);
  }
  if (!currentUser) {
    friendActivityCache = { key: cacheKey, timestamp: Date.now(), activities: [] };
    return [];
  }
  const cutoff = dayLimit ? new Date(Date.now() - dayLimit * 24 * 60 * 60 * 1000).toISOString() : null;
  const activities = [];
  const mediaMap = new Map();
  const friendUidSet = new Set([...friends, currentUser.uid]); // Always include current user

  // Helper to process one user's items into activity events
  function processUserItems(uid, u, sectionItems, section) {
    for (const item of sectionItems) {
      const enriched = { ...item, librarySection: section, mediaCategory: section };
      const mediaKey = getMediaKey(enriched);
      if (mediaKey && !mediaMap.has(mediaKey)) mediaMap.set(mediaKey, { title: item.title, cover: item.cover || '', section });

      const addedAt = item.dateAdded || '';
      const modifiedAt = item.dateModified || '';
      const episodeActivityAt = item.lastEpisodeActivityAt || item.episodeActivityAt || '';
      const hasRating = Number(item.rating || 0) > 0;
      const modIsDistinct = modifiedAt && modifiedAt !== addedAt &&
        (new Date(modifiedAt).getTime() - new Date(addedAt).getTime()) > 5 * 60 * 1000;
      const modIsEpisodeActivity = episodeActivityAt && modifiedAt &&
        Math.abs(parseFriendActivityTime(episodeActivityAt) - parseFriendActivityTime(modifiedAt)) <= 2000;

      if (addedAt && (!cutoff || addedAt >= cutoff)) {
        activities.push({ uid, name: u.name || 'User', photo: u.photo || '', item: enriched, timestamp: addedAt, eventType: 'added', mediaKey });
      }

      if (episodeActivityAt && (!cutoff || episodeActivityAt >= cutoff)) {
        activities.push({
          uid,
          name: u.name || 'User',
          photo: u.photo || '',
          item: enriched,
          timestamp: episodeActivityAt,
          eventType: 'episode-watched',
          mediaKey,
          eventKey: [uid, 'episode-watched', mediaKey, episodeActivityAt].join('|')
        });
      }

      if (modIsDistinct && !modIsEpisodeActivity && (!cutoff || modifiedAt >= cutoff)) {
        let modEventType = 'added';
        if (hasRating) {
          // v436: only generate a 'rated' activity event for a FIRST-TIME rating.
          // `rate()` now guards dateModified — it only updates dateModified when
          // prevRating was 0. If an item has shelfdRatingEditedAt === dateModified,
          // that means the last touch was a rating EDIT and should not create activity.
          // Fall through to status-changed in that case (or skip if also unchanged).
          const isRatingEdit = item.shelfdRatingEditedAt && item.shelfdRatingEditedAt === modifiedAt;
          if (!isRatingEdit) {
            modEventType = 'rated';
          } else if (item.status === 'watched' || item.status === 'watching' || item.status === 'planned' || item.status === 'paused' || item.status === 'dropped' || item.status === 'live' || item.status === 'wishlist') {
            modEventType = 'status-changed';
          } else {
            continue;
          }
        } else if (item.status === 'watched' || item.status === 'watching' || item.status === 'planned' || item.status === 'paused' || item.status === 'dropped' || item.status === 'live' || item.status === 'wishlist') {
          modEventType = 'status-changed';
        } else {
          continue;
        }
        activities.push({
          uid,
          name: u.name || 'User',
          photo: u.photo || '',
          item: enriched,
          timestamp: modifiedAt,
          eventType: modEventType,
          nextStatus: item.status,
          mediaKey
        });
      }
    }
  }

  // Include own activities from in-memory data (fast, no extra Firestore read)
  const ownName = (typeof userProfile !== 'undefined' && userProfile?.name) || currentUser.displayName || 'You';
  const ownPhoto = (typeof userProfile !== 'undefined' && userProfile?.photo) || currentUser.photoURL || '';
  if (!usersMap[currentUser.uid]) usersMap[currentUser.uid] = { uid: currentUser.uid, name: ownName, photo: ownPhoto };
  if (typeof data !== 'undefined' && data) {
    for (const section of SCREENLIST_SECTIONS) {
      let ownItems = [];
      try { ownItems = Array.isArray(data[section]) ? data[section] : []; } catch(e) {}
      processUserItems(currentUser.uid, usersMap[currentUser.uid], ownItems, section);
    }
  }

  // Include friends' activities from Firestore
  await Promise.all(friends.map(async uid => {
    try {
      if (!usersMap[uid]) {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.exists) usersMap[uid] = { ...userSnap.data(), uid };
      }
      const snap = await db.collection('watchlist').doc(uid).get();
      if (!snap.exists) return;
      const d = snap.data();
      const u = usersMap[uid] || {};
      for (const section of SCREENLIST_SECTIONS) {
        let items = [];
        try { items = d[section] ? JSON.parse(d[section]) : []; } catch(e) {}
        processUserItems(uid, u, items, section);
      }
    } catch(e) {}
  }));
  await Promise.all(Array.from(mediaMap.entries()).map(async ([mediaKey, media]) => {
    try {
      const snap = await db.collection('comments').doc(mediaKey).get();
      if (!snap.exists) return;
      const comments = Array.isArray(snap.data().comments) ? snap.data().comments : [];
      comments.forEach(comment => {
        if (!friendUidSet.has(comment.uid)) return;
        const commentIso = comment.timestamp ? new Date(comment.timestamp).toISOString() : '';
        if (cutoff && commentIso && commentIso < cutoff) return;
        activities.push({
          type: 'comment',
          uid: comment.uid,
          name: usersMap[comment.uid]?.name || comment.name || 'Friend',
          photo: usersMap[comment.uid]?.photo || comment.photo || '',
          item: { title: media.title, cover: media.cover, dateAdded: commentIso, librarySection: media.section, mediaCategory: media.section },
          mediaKey,
          commentId: comment.id,
          commentText: comment.text || comment.body || comment.comment || '',
          timestamp: comment.timestamp || Date.now()
        });
      });
    } catch(e) {}
  }));
  friendActivityLiveEvents.forEach(event => {
    if (!event || !friendUidSet.has(event.uid)) return;
    const eventTime = parseFriendActivityTime(event.timestamp || event.item?.dateAdded);
    if (cutoff && eventTime && eventTime < parseFriendActivityTime(cutoff)) return;
    activities.push({
      ...event,
      item: cloneFriendActivityItem(event.item),
      eventKey: event.eventKey || buildFriendActivityEventKey(event)
    });
  });
  
  // Fetch and merge feed posts
  try {
    const feedPosts = await fetchFeedPosts(50);
    feedPosts.forEach(post => {
      if (!friendUidSet.has(post.uid)) return;
      const postTime = post.timestamp || Date.now();
      if (cutoff && postTime < new Date(cutoff).getTime()) return;
      activities.push({
        ...post,
        timestamp: postTime,
        eventKey: `feed:${post.postId || post.id}`
      });
    });
  } catch(e) {
    console.error('Error fetching feed posts:', e);
  }
  
  const deduped = new Map();
  activities.forEach(activity => {
    const eventKey = activity.eventKey || buildFriendActivityEventKey(activity);
    deduped.set(eventKey, {
      ...activity,
      eventKey,
      item: cloneFriendActivityItem(activity.item)
    });
  });
  const mergedActivities = collapseStackedActivityBurstActivities(collapseImportBatchActivities(mergeRelatedLibraryActivities([...deduped.values()])))
    .filter(activity => !isScreenListActivityDeletedForOwner(activity, activity.eventKey || activity.id || activity.activityId || ''))
    .sort((a, b) => new Date(b.timestamp || b.item?.dateAdded || 0) - new Date(a.timestamp || a.item?.dateAdded || 0));
  friendActivityCache = { key: cacheKey, timestamp: Date.now(), activities: mergedActivities };
  return cloneFriendActivityList(mergedActivities);
  })();

  friendActivityPromise = { key: cacheKey, promise: loader };
  try {
    return await loader;
  } finally {
    if (friendActivityPromise?.key === cacheKey) friendActivityPromise = null;
  }
}

async function loadFriendActivity() {
  if (activeFriendsTab === 'activity') {
    if (isWatchActivitySubTab()) renderActiveWatchActivitySubTab();
    else loadActivityTabFeed();
  }
}

let activityPageFilterUid = null;

function getActivityOpenOriginRect(triggerEl) {
  if (!triggerEl || typeof triggerEl.getBoundingClientRect !== 'function') return null;
  const rect = triggerEl.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2
  };
}

function animateActivityPageOpen(page, originRect) {
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!page || !originRect || prefersReduced || typeof page.animate !== 'function') return;

  const vw = window.innerWidth || document.documentElement.clientWidth || page.offsetWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || page.offsetHeight || 1;
  const originX = Math.max(0, Math.min(vw, originRect.centerX));
  const originY = Math.max(0, Math.min(vh, originRect.centerY));
  const maxDx = Math.max(originX, vw - originX);
  const maxDy = Math.max(originY, vh - originY);
  const startRadius = Math.max(originRect.width, originRect.height, 48) / 2;
  const endRadius = Math.ceil(Math.hypot(maxDx, maxDy) + 24);

  page.classList.add('activity-page-opening');
  page.style.clipPath = `circle(${startRadius}px at ${originX}px ${originY}px)`;
  page.style.webkitClipPath = `circle(${startRadius}px at ${originX}px ${originY}px)`;

  const animation = page.animate([
    {
      clipPath: `circle(${startRadius}px at ${originX}px ${originY}px)`,
      WebkitClipPath: `circle(${startRadius}px at ${originX}px ${originY}px)`,
      opacity: 0.96
    },
    {
      clipPath: `circle(${endRadius}px at ${originX}px ${originY}px)`,
      WebkitClipPath: `circle(${endRadius}px at ${originX}px ${originY}px)`,
      opacity: 1
    }
  ], {
    duration: 430,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'both'
  });

  animation.onfinish = animation.oncancel = () => {
    page.classList.remove('activity-page-opening');
    page.style.clipPath = '';
    page.style.webkitClipPath = '';
  };
}

function openUserActivityPage(uid, triggerEl = null) {
  openActivityPage(uid, triggerEl);
}

function openActivityPage(filterUid = null, triggerEl = null) {
  const originRect = getActivityOpenOriginRect(triggerEl);
  markFriendActivitySeen();
  friendActivityStorySeenAtSnapshot = 0;
  activityPageFilterUid = filterUid || null;
  const page = document.getElementById('activity-page');
  const communityView = document.getElementById('community-view');
  if (!page) return;
  syncMainNavButtons('community');
  if (communityView) communityView.style.display = 'none';
  page.classList.toggle('user-filter-active', !!activityPageFilterUid);
  page.classList.add('active');
  syncActivityPageQuickActions();
  animateActivityPageOpen(page, originRect);
  loadFullActivityFeed();
  persistUiState();
}

function closeActivityPage() {
  const page = document.getElementById('activity-page');
  const communityView = document.getElementById('community-view');
  activityPageFilterUid = null;
  if (page) {
    page.classList.remove('active');
    page.classList.remove('user-filter-active');
  }
  syncActivityPageQuickActions();
  syncMainNavButtons('community');
  if (communityView) communityView.style.display = 'block';
  setBottomNavVisibility(true);
  if (activeFriendsTab === 'activity') {
    if (isWatchActivitySubTab()) renderActiveWatchActivitySubTab();
    else loadActivityTabFeed();
  }
  persistUiState();
}

function syncActivityPageQuickActions() {
  const actions = document.getElementById('activity-page-quick-actions');
  if (actions) actions.style.display = 'none';
}

async function viewActivityPageScreenList() {
  const uid = activityPageFilterUid;
  if (!uid) return;
  const u = usersMap[uid] || {};
  const page = document.getElementById('activity-page');
  const communityView = document.getElementById('community-view');
  activityPageFilterUid = null;
  if (page) page.classList.remove('active', 'user-filter-active');
  syncActivityPageQuickActions();
  if (communityView) communityView.style.display = 'none';
  await viewUserList(uid, u.name || 'Friend', u.photo || '');
}

function viewActivityPageProfile() {
  const uid = activityPageFilterUid;
  if (!uid) return;
  openUserProfile(uid);
}

async function loadFullActivityFeed() {
  const feed = document.getElementById('activity-page-feed');
  const titleEl = document.querySelector('#activity-page .activity-page-title');
  const subtitleEl = document.querySelector('#activity-page .activity-page-subtitle');
  if (!feed) return;

  const renderFiltered = (activities) => {
    const filterUid = activityPageFilterUid;
    const actor = filterUid ? (usersMap[filterUid] || {}) : null;
    const actorName = filterUid ? getDisplayName(actor, 'Friend') : '';
    const visibleActivities = filterUid ? activities.filter(activity => activity.uid === filterUid) : activities;

    const userStrip = document.getElementById('activity-page-user-strip');
    const avatarEl = document.getElementById('activity-page-user-avatar');
    const titleEl2 = document.getElementById('activity-page-title');
    const subtitleEl2 = document.getElementById('activity-page-subtitle');
    const headerActions = document.getElementById('activity-page-header-actions');

    if (filterUid && actor) {
      if (avatarEl && actor.photo) avatarEl.src = actor.photo;
      if (userStrip) userStrip.classList.add('has-user');
      if (titleEl2) titleEl2.textContent = actorName;
      if (subtitleEl2) subtitleEl2.textContent = 'Recent activity';
      if (headerActions) headerActions.style.display = 'flex';
    } else {
      if (userStrip) userStrip.classList.remove('has-user');
      if (titleEl2) titleEl2.textContent = 'Activity Feed';
      if (subtitleEl2) subtitleEl2.textContent = 'All recent activity from friends';
      if (headerActions) headerActions.style.display = 'none';
    }

    if (!visibleActivities.length) {
      feed.innerHTML = `<div class="discover-message">${filterUid ? 'No activity from this user yet.' : 'No friend activity yet.'}</div>`;
      return;
    }

    renderFriendActivityItems(feed, visibleActivities, {
      hideStories: !!filterUid,
      hideRefresh: !!filterUid,
      hideActorName: !!filterUid,
      hideHeading: !!filterUid,
      hideSharedWatchPill: !!filterUid,
      useUserActivityGroups: !!filterUid,
      heading: filterUid ? 'User Activity Feed' : 'Activity Feed',
      emptyText: filterUid ? 'No activity from this user yet.' : undefined
    });
  };

  if (isPreviewMode()) {
    renderFiltered(await fetchAllFriendActivities(0));
    return;
  }
  if (!currentUser || !friends.length) {
    feed.innerHTML = '<div class="discover-message">Add some friends to see their activity here.</div>';
    return;
  }
  feed.innerHTML = '<div class="discover-message">Loading activity...</div>';
  const activities = await fetchAllFriendActivities(0);
  renderFiltered(activities);
}
