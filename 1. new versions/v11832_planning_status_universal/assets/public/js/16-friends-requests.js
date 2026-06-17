function getFriendActivitySeenStorageKey() {
  return currentUser ? `screenlist-friend-activity-seen-${currentUser.uid}` : '';
}

function getFriendActivitySeenAt() {
  const key = getFriendActivitySeenStorageKey();
  if (!key) return Date.now();
  const raw = localStorage.getItem(key);
  const parsed = raw ? parseInt(raw, 10) : 0;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const now = Date.now();
  localStorage.setItem(key, String(now));
  return now;
}

function markFriendActivitySeen(timeValue = Date.now()) {
  const key = getFriendActivitySeenStorageKey();
  if (friendActivityUnread && !friendActivityStorySeenAtSnapshot) {
    friendActivityStorySeenAtSnapshot = getFriendActivitySeenAt();
  }
  if (key) localStorage.setItem(key, String(Math.max(Date.now(), timeValue || 0)));
  friendActivityUnread = false;
  updateRequestsBadges();
}

function parseFriendActivityTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function cloneFriendActivityItem(item = {}) {
  return item ? { ...item } : item;
}

function buildFriendActivityEventKey(activity = {}) {
  const eventType = activity.type === 'comment' ? 'commented' : (activity.eventType || 'added');
  const mediaKey = activity.mediaKey || getMediaKey(activity.item || {}) || '';
  const timestamp = parseFriendActivityTime(activity.timestamp || activity.item?.dateModified || activity.item?.dateAdded || Date.now());
  const fromStatus = activity.previousStatus || '';
  const toStatus = activity.nextStatus || activity.item?.status || '';
  const rating = Number(activity.item?.rating || 0);
  const commentId = activity.commentId || '';
  return [activity.uid || '', eventType, mediaKey, timestamp, fromStatus, toStatus, rating, commentId].join('|');
}

function pushFriendActivityLiveEvents(events = []) {
  if (!Array.isArray(events) || !events.length) return;
  const existing = new Map(friendActivityLiveEvents.map(event => [event.eventKey || buildFriendActivityEventKey(event), event]));
  events.forEach(event => {
    if (String(event?.eventType || event?.type || '').trim().toLowerCase() === 'removed') return;
    const normalized = {
      ...event,
      item: cloneFriendActivityItem(event.item),
      eventKey: event.eventKey || buildFriendActivityEventKey(event)
    };
    existing.set(normalized.eventKey, normalized);
  });
  friendActivityLiveEvents = [...existing.values()]
    .filter(event => String(event?.eventType || event?.type || '').trim().toLowerCase() !== 'removed')
    .sort((a, b) => parseFriendActivityTime(b.timestamp || b.item?.dateAdded) - parseFriendActivityTime(a.timestamp || a.item?.dateAdded))
    .slice(0, FRIEND_ACTIVITY_LIVE_MAX);
}

function getFriendLibraryLiveItemKey(item = {}, section = '') {
  return getMediaKey({
    ...item,
    librarySection: item?.librarySection || section,
    mediaCategory: item?.mediaCategory || section
  }) || `${section}:${item?.id || item?.title || Math.random().toString(36).slice(2)}`;
}

function buildFriendWatchlistLiveState(dataObj = {}) {
  const nextState = {};
  SCREENLIST_SECTIONS.forEach(section => {
    /* v10.387: accept either a pre-parsed array (post-schema-v2, from
       loadWatchlistDataForUid) or a legacy JSON string field (pre-migration
       friends still on the old single-doc shape). */
    let items = [];
    const raw = dataObj[section];
    if (Array.isArray(raw)) {
      items = raw;
    } else if (typeof raw === 'string' && raw) {
      try { items = JSON.parse(raw); } catch (e) { items = []; }
    }
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      const key = getFriendLibraryLiveItemKey(item, section);
      nextState[key] = {
        rating: Number(item?.rating || 0),
        status: String(item?.status || ''),
        dateAdded: parseFriendActivityTime(item?.dateAdded),
        dateModified: parseFriendActivityTime(item?.dateModified),
        mediaKey: getMediaKey({
          ...item,
          librarySection: item?.librarySection || section,
          mediaCategory: item?.mediaCategory || section
        }),
        item: {
          ...item,
          librarySection: item?.librarySection || section,
          mediaCategory: item?.mediaCategory || section
        }
      };
    });
  });
  return nextState;
}

function buildFriendWatchlistDiffEvents(uid, previousState = null, nextState = {}) {
  if (!previousState) return [];
  const actor = usersMap[uid] || {};
  const now = Date.now();
  const keys = new Set([...Object.keys(previousState || {}), ...Object.keys(nextState || {})]);
  const events = [];

  keys.forEach(key => {
    const prevItem = previousState[key];
    const nextItem = nextState[key];
    if (!prevItem && nextItem) {
      const timestamp = nextItem.dateAdded || nextItem.dateModified || now;
      events.push({
        uid,
        name: actor.name || 'Friend',
        photo: actor.photo || '',
        item: cloneFriendActivityItem(nextItem.item),
        timestamp,
        eventType: 'added',
        mediaKey: nextItem.mediaKey
      });
      return;
    }

    // Removing a title from a library is private and must never surface as
    // an Activity Feed card or notification.
    if (prevItem && !nextItem) return;

    if (!prevItem || !nextItem) return;

    const eventTime = Math.max(nextItem.dateModified || 0, nextItem.dateAdded || 0, now);
    const nextRating = Number(nextItem.rating || 0);
    const prevRating = Number(prevItem.rating || 0);

    if (prevItem.status !== nextItem.status) {
      events.push({
        uid,
        name: actor.name || 'Friend',
        photo: actor.photo || '',
        item: cloneFriendActivityItem(nextItem.item),
        timestamp: eventTime,
        eventType: 'status-changed',
        previousStatus: prevItem.status,
        nextStatus: nextItem.status,
        mediaKey: nextItem.mediaKey
      });
    }

    // v436: only emit a 'rated' event for a FIRST-TIME rating (prevRating === 0).
    // Editing an already-rated title (prevRating > 0) must not create a new
    // Activity Feed post — that change is private unless the user explicitly
    // taps "Post update" via the rating-edit toast.
    if (nextRating > 0 && prevRating === 0) {
      events.push({
        uid,
        name: actor.name || 'Friend',
        photo: actor.photo || '',
        item: cloneFriendActivityItem(nextItem.item),
        timestamp: eventTime,
        eventType: 'rated',
        mediaKey: nextItem.mediaKey
      });
    }
  });

  return events.map(event => ({
    ...event,
    eventKey: buildFriendActivityEventKey(event)
  }));
}

function getLatestFriendWatchlistNotificationTime(previousState = null, nextState = {}) {
  if (!previousState) return 0;
  let latest = 0;
  Object.entries(nextState).forEach(([key, nextItem]) => {
    const prevItem = previousState[key];
    const eventTime = Math.max(nextItem?.dateModified || 0, nextItem?.dateAdded || 0);
    if (!prevItem) {
      latest = Math.max(latest, eventTime);
      return;
    }
    const nextRating = Number(nextItem?.rating || 0);
    const prevRating = Number(prevItem?.rating || 0);
    if (nextRating !== prevRating && nextRating > 0) {
      latest = Math.max(latest, eventTime);
      return;
    }
    if (nextItem?.status === 'watched' && prevItem?.status !== 'watched') {
      latest = Math.max(latest, eventTime);
    }
  });
  return latest;
}

function getLatestRelevantCommentTimeFromSnapshot(snapshot) {
  if (!currentUser || !snapshot) return 0;
  const friendUidSet = new Set(friends);
  let latest = 0;
  snapshot.docChanges().forEach(change => {
    if (change.type === 'removed') return;
    const comments = Array.isArray(change.doc.data()?.comments) ? change.doc.data().comments : [];
    comments.forEach(comment => {
      if (!comment || comment.uid === currentUser.uid) return;
      const commentTime = parseFriendActivityTime(comment.timestamp);
      if (!commentTime) return;
      const isFriendComment = friendUidSet.has(comment.uid);
      const repliesToMe = comments.some(entry =>
        entry &&
        entry.uid === currentUser.uid &&
        parseFriendActivityTime(entry.timestamp) > 0 &&
        parseFriendActivityTime(entry.timestamp) < commentTime
      );
      if (isFriendComment || repliesToMe) {
        latest = Math.max(latest, commentTime);
      }
    });
  });
  return latest;
}

function scheduleLiveFriendActivityRefresh() {
  clearTimeout(friendActivityRenderTimer);
  friendActivityRenderTimer = setTimeout(() => {
    const communityActive = document.getElementById('nav-community')?.classList.contains('active');
    if (!communityActive) return;
    const activityOpen = !!document.getElementById('activity-page')?.classList.contains('active');
    if (activityOpen) loadFullActivityFeed();
    else if (activeFriendsTab === 'activity') {
      if (isWatchActivitySubTab()) renderActiveWatchActivitySubTab();
      else if (activeActivitySubTab !== 'news') loadActivityTabFeed();
      /* v11.594: skip the feed re-render on a friend-activity tick when the News
         sub-tab is active (News self-refreshes; it would render into a hidden
         pane otherwise). */
    }
  }, 250);
}

function handleLiveFriendActivity(latestTime) {
  if (!currentUser || !latestTime) return;
  friendActivityCache = null;
  friendActivityPromise = null;
  const seenAt = getFriendActivitySeenAt();
  if (latestTime > seenAt) {
    friendActivityUnread = true;
    updateRequestsBadges();
  }
  scheduleLiveFriendActivityRefresh();
}

function stopFriendActivityLiveListeners() {
  friendActivityWatchlistUnsubscribes.forEach(unsub => {
    try { unsub(); } catch(e) {}
  });
  friendActivityWatchlistUnsubscribes = [];
  friendActivityWatchlistState = {};
  if (friendActivityCommentsUnsubscribe) {
    try { friendActivityCommentsUnsubscribe(); } catch(e) {}
    friendActivityCommentsUnsubscribe = null;
  }
  friendActivityLiveKey = '';
  clearTimeout(friendActivityRenderTimer);
  friendActivityLiveEvents = [];
}

function syncFriendActivityLiveListeners() {
  if (!currentUser || !Array.isArray(friends)) return;
  const nextKey = friends.slice().sort().join('|');
  if (friendActivityLiveKey === nextKey) return;
  stopFriendActivityLiveListeners();
  friendActivityLiveKey = nextKey;
  getFriendActivitySeenAt();
  if (!friends.length) {
    friendActivityUnread = false;
    updateRequestsBadges();
    return;
  }

  friends.forEach(uid => {
    /* v10.387: the parent watchlist/{uid} doc no longer carries the JSON
       sections — under schema v2 it's just a heartbeat ({ updatedAt,
       schemaVersion }). When the snapshot fires we fan out to the section
       subdocs to get the actual list data. Legacy un-migrated friends still
       work because loadWatchlistDataForUid falls back to the parent's
       legacy fields when section subdocs are missing. */
    const unsub = db.collection('watchlist').doc(uid).onSnapshot(async snap => {
      try {
        let nextState = {};
        if (snap && snap.exists) {
          const listData = await loadWatchlistDataForUid(uid, { parentSnap: snap });
          setCachedFriendListData(uid, listData);
          nextState = buildFriendWatchlistLiveState(listData);
        }
        const previousState = friendActivityWatchlistState[uid] || null;
        friendActivityWatchlistState[uid] = nextState;
        const events = buildFriendWatchlistDiffEvents(uid, previousState, nextState);
        pushFriendActivityLiveEvents(events);
        const latest = events.reduce((max, event) => Math.max(max, parseFriendActivityTime(event.timestamp)), 0)
          || getLatestFriendWatchlistNotificationTime(previousState, nextState);
        handleLiveFriendActivity(latest);
      } catch (err) {
        console.error('Friend activity watchlist fan-out failed:', err);
      }
    }, err => console.error('Friend activity watchlist listener failed:', err));
    friendActivityWatchlistUnsubscribes.push(unsub);
  });

  friendActivityCommentsUnsubscribe = db.collection('comments').onSnapshot(snapshot => {
    const latest = getLatestRelevantCommentTimeFromSnapshot(snapshot);
    handleLiveFriendActivity(latest);
  }, err => console.error('Friend activity comments listener failed:', err));
}

let ownFriendIds = [];
let ownFriendFollowedAtMs = {};
let ownOutgoingFriendRequestIds = [];
let ownRejectedFriendRequestIds = [];
let ownRemovedFriendIds = [];
let incomingFriendRequestSourceUids = [];
let acceptedFriendSourceUids = [];
let rejectedByFriendUids = [];
let removedByFriendUids = [];
let friendDerivedQueryUnsubscribes = [];
let friendSelfRepairInFlight = false;
let friendSelfRepairSignature = '';

function normalizeFriendUidList(list = []) {
  return [...new Set((Array.isArray(list) ? list : []).map(uid => String(uid || '').trim()).filter(Boolean))];
}

function normalizeFriendFollowedAtMap(value = {}) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  Object.entries(value).forEach(([uid, raw]) => {
    const key = String(uid || '').trim();
    if (!key) return;
    const ms = parseFriendActivityTime(raw);
    if (ms > 0) out[key] = ms;
  });
  return out;
}

function getFriendFollowedAtMs(uid = '') {
  const key = String(uid || '').trim();
  if (!key) return 0;
  const explicit = Number(ownFriendFollowedAtMs[key] || 0);
  if (explicit > 0) return explicit;
  const index = Array.isArray(friends) ? friends.indexOf(key) : -1;
  return index >= 0 ? index + 1 : 0;
}

function captureOwnFriendRawState() {
  return {
    ownFriendIds: ownFriendIds.slice(),
    ownFriendFollowedAtMs: { ...ownFriendFollowedAtMs },
    ownOutgoingFriendRequestIds: ownOutgoingFriendRequestIds.slice(),
    ownRejectedFriendRequestIds: ownRejectedFriendRequestIds.slice(),
    ownRemovedFriendIds: ownRemovedFriendIds.slice()
  };
}

function restoreOwnFriendRawState(snapshot = null) {
  if (!snapshot) return;
  ownFriendIds = normalizeFriendUidList(snapshot.ownFriendIds);
  ownFriendFollowedAtMs = normalizeFriendFollowedAtMap(snapshot.ownFriendFollowedAtMs);
  ownOutgoingFriendRequestIds = normalizeFriendUidList(snapshot.ownOutgoingFriendRequestIds);
  ownRejectedFriendRequestIds = normalizeFriendUidList(snapshot.ownRejectedFriendRequestIds);
  ownRemovedFriendIds = normalizeFriendUidList(snapshot.ownRemovedFriendIds);
}

function primeUsersMapFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.forEach !== 'function') return;
  snapshot.forEach(doc => {
    if (!doc || !doc.exists) return;
    usersMap[doc.id] = { ...(usersMap[doc.id] || {}), ...(doc.data() || {}), uid: doc.id };
  });
}

function captureFriendsCommitSnapshot() {
  return {
    prevIncomingRequests: incomingRequests.slice(),
    prevWatchTogetherIncomingIds: watchTogetherIncomingRequestIds.slice(),
    prevDmIncomingIds: dmIncomingRequestIds.slice(),
    prevDmUnreadCount: getUnreadDirectMessageThreadCount(),
    prevFriendsKey: friends.slice().sort().join('|'),
    prevWatchTogetherIncomingKey: watchTogetherIncomingRequestIds.join('|'),
    prevWatchTogetherOutgoingKey: watchTogetherOutgoingRequestIds.join('|'),
    prevWatchTogetherApprovedKey: watchTogetherApprovedRequestIds.join('|')
  };
}

function computeEffectiveFriendState() {
  const me = String(currentUser?.uid || '').trim();
  const ownFriendsSet = new Set(ownFriendIds);
  const ownOutgoingSet = new Set(ownOutgoingFriendRequestIds);
  const ownRejectedSet = new Set(ownRejectedFriendRequestIds);
  const ownRemovedSet = new Set(ownRemovedFriendIds);
  const acceptedBySet = new Set(acceptedFriendSourceUids);
  const rejectedBySet = new Set(rejectedByFriendUids);
  const removedBySet = new Set(removedByFriendUids);
  const incomingSet = new Set(incomingFriendRequestSourceUids);
  const nextFriends = new Set();

  ownFriendIds.forEach(uid => {
    if (!uid || uid === me) return;
    if (ownRemovedSet.has(uid) || removedBySet.has(uid)) return;
    nextFriends.add(uid);
  });

  acceptedFriendSourceUids.forEach(uid => {
    if (!uid || uid === me) return;
    if (!ownOutgoingSet.has(uid)) return;
    if (ownRemovedSet.has(uid) || removedBySet.has(uid)) return;
    nextFriends.add(uid);
  });

  const nextIncoming = normalizeFriendUidList(incomingFriendRequestSourceUids.filter(uid => {
    if (!uid || uid === me) return false;
    if (nextFriends.has(uid)) return false;
    if (ownRejectedSet.has(uid) || ownRemovedSet.has(uid)) return false;
    return true;
  }));

  const nextOutgoing = normalizeFriendUidList(ownOutgoingFriendRequestIds.filter(uid => {
    if (!uid || uid === me) return false;
    if (nextFriends.has(uid)) return false;
    if (incomingSet.has(uid)) return false;
    if (rejectedBySet.has(uid) || removedBySet.has(uid)) return false;
    return true;
  }));

  return {
    friends: normalizeFriendUidList([...nextFriends]),
    incomingRequests: nextIncoming,
    outgoingRequests: nextOutgoing,
    acceptedBySet,
    rejectedBySet,
    removedBySet,
    incomingSet,
    ownFriendsSet
  };
}

function buildFriendSelfRepairPlan() {
  if (!currentUser || !db || typeof firebase === 'undefined' || !firebase.firestore) return null;
  const acceptedToPromote = acceptedFriendSourceUids.filter(uid => ownOutgoingFriendRequestIds.includes(uid));
  const rejectedToClear = rejectedByFriendUids.filter(uid => ownOutgoingFriendRequestIds.includes(uid));
  const removedToClearOutgoing = removedByFriendUids.filter(uid => ownOutgoingFriendRequestIds.includes(uid));
  const removedToClearFriends = removedByFriendUids.filter(uid => ownFriendIds.includes(uid));
  const staleRejected = ownRejectedFriendRequestIds.filter(uid => !incomingFriendRequestSourceUids.includes(uid) && !ownFriendIds.includes(uid));
  const signatureParts = [];

  const outgoingToClear = normalizeFriendUidList([...rejectedToClear, ...removedToClearOutgoing]);
  const clearOutgoing = normalizeFriendUidList([...acceptedToPromote, ...outgoingToClear]);
  const clearRejected = normalizeFriendUidList([...acceptedToPromote, ...staleRejected]);
  const clearRemoved = normalizeFriendUidList(acceptedToPromote);

  if (acceptedToPromote.length) signatureParts.push(`accept:${acceptedToPromote.sort().join(',')}`);
  if (outgoingToClear.length) signatureParts.push(`out:${outgoingToClear.sort().join(',')}`);
  if (removedToClearFriends.length) signatureParts.push(`friend:${removedToClearFriends.sort().join(',')}`);
  if (staleRejected.length) signatureParts.push(`stale-reject:${staleRejected.sort().join(',')}`);

  if (!signatureParts.length) return null;
  return {
    signature: signatureParts.join('|'),
    addFriends: normalizeFriendUidList(acceptedToPromote),
    removeFriends: normalizeFriendUidList(removedToClearFriends),
    clearOutgoing,
    clearRejected,
    clearRemoved
  };
}

async function maybeRepairOwnFriendDoc() {
  const plan = buildFriendSelfRepairPlan();
  if (!plan) return;
  if (friendSelfRepairInFlight && friendSelfRepairSignature === plan.signature) return;
  friendSelfRepairInFlight = true;
  friendSelfRepairSignature = plan.signature;
  try {
    const ref = db.collection('users').doc(currentUser.uid);
    if (plan.addFriends.length || plan.clearOutgoing.length || plan.clearRejected.length || plan.clearRemoved.length) {
      const patch = {};
      const now = Date.now();
      if (plan.addFriends.length) patch.friends = firebase.firestore.FieldValue.arrayUnion(...plan.addFriends);
      plan.addFriends.forEach(uid => {
        if (uid && !ownFriendFollowedAtMs[uid]) {
          ownFriendFollowedAtMs[uid] = now;
          patch[`friendFollowedAtMs.${uid}`] = now;
        }
      });
      if (plan.clearOutgoing.length) patch.outgoingRequests = firebase.firestore.FieldValue.arrayRemove(...plan.clearOutgoing);
      if (plan.clearRejected.length) patch.rejectedFriendRequests = firebase.firestore.FieldValue.arrayRemove(...plan.clearRejected);
      if (plan.clearRemoved.length) patch.removedFriends = firebase.firestore.FieldValue.arrayRemove(...plan.clearRemoved);
      await ref.set(patch, { merge: true });
    }
    if (plan.removeFriends.length) {
      await ref.set({
        friends: firebase.firestore.FieldValue.arrayRemove(...plan.removeFriends)
      }, { merge: true });
    }
  } catch (error) {
    console.error('friend self-repair failed:', error);
  } finally {
    friendSelfRepairInFlight = false;
    if (friendSelfRepairSignature === plan.signature) friendSelfRepairSignature = '';
  }
}

function commitFriendsDataState(prev = captureFriendsCommitSnapshot(), opts = {}) {
  const nextFriendState = computeEffectiveFriendState();
  friends = nextFriendState.friends;
  incomingRequests = nextFriendState.incomingRequests;
  outgoingRequests = nextFriendState.outgoingRequests;

  updateRequestsBadges();
  updateFriendsCountBadge();
  if (prev.prevWatchTogetherIncomingKey !== watchTogetherIncomingRequestIds.join('|') || prev.prevWatchTogetherOutgoingKey !== watchTogetherOutgoingRequestIds.join('|') || prev.prevWatchTogetherApprovedKey !== watchTogetherApprovedRequestIds.join('|')) {
    hydrateWatchTogetherMirroredRequests().then(() => {
      const communityActive = document.getElementById('nav-community')?.classList.contains('active');
      if (communityActive && activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
      render();
    });
  }

  if (prev.prevFriendsKey !== friends.slice().sort().join('|')) {
    friendActivityCache = null;
    friendActivityPromise = null;
    syncFriendActivityLiveListeners();
    discoverFriendSocialCache = null;
    discoverFriendSocialCacheKey = '';
    discoverFriendSocialPromise = null;
    refreshDiscoverFriendStacks(true);
    primeFriendProfiles(true).then(() => {
      const communityActive = document.getElementById('nav-community')?.classList.contains('active');
      if (communityActive && activeFriendsTab === 'friends') renderFriendsList();
    }).catch(() => {});
  } else {
    syncFriendActivityLiveListeners();
  }

  const communityActive = document.getElementById('nav-community')?.classList.contains('active');
  if (communityActive) {
    if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
    if (activeFriendsTab === 'friends') { renderFriendsList(); refilterPeople(); }
    if (isDirectMessagesPageOpen()) renderDirectMessagesView();
  } else if (isDirectMessagesPageOpen()) {
    renderDirectMessagesView();
  }

  if (!opts.silent) {
    const newRequests = incomingRequests.filter(uid => !prev.prevIncomingRequests.includes(uid));
    const newWatchTogetherRequests = watchTogetherIncomingRequestIds.filter(id => !prev.prevWatchTogetherIncomingIds.includes(id));
    const newDmRequests = dmIncomingRequestIds.filter(id => !prev.prevDmIncomingIds.includes(id));
    const newDmUnreadCount = getUnreadDirectMessageThreadCount();
    if (newRequests.length > 0) {
      showToast(newRequests.length === 1 ? "New friend request" : `${newRequests.length} new friend requests`);
    }
    if (newWatchTogetherRequests.length > 0) {
      showToast(newWatchTogetherRequests.length === 1 ? "New Watch Request" : `${newWatchTogetherRequests.length} new Watch Requests`);
      updateSharedWatchActivityBadge();
    }
    if (newDmRequests.length > 0) {
      showToast(newDmRequests.length === 1 ? "New message request" : `${newDmRequests.length} new message requests`);
    } else if (newDmUnreadCount > prev.prevDmUnreadCount) {
      showToast('New direct message');
    }
  }

  /* v10.762: BELT-AND-SUSPENDERS RE-RENDER on friends data arrival.
     The targeted re-renders earlier in this function (community-active +
     activeFriendsTab switch) miss two surfaces that go blank on cold start:
     – Activity FEED sub-tab (only the watch-activity sub-tab was wired)
     – Discover "What Your Friends Are Watching" row (refreshDiscoverFriendStacks
       targets .discover-friend-stack pills, not the main grid)
     Both depend on friends[] being populated. When the snapshot fires with
     a CHANGED friends list and the user happens to be looking at one of
     these surfaces, force a refresh so they don't have to swap tabs to
     trigger the page-open render path.
     Guarded by prevFriendsKey diff so steady-state snapshots (no change)
     don't trigger redundant work. */
  const friendsKeyChanged = prev.prevFriendsKey !== friends.slice().sort().join('|');
  if (friendsKeyChanged) {
    const communityActive = document.getElementById('nav-community')?.classList.contains('active');
    if (communityActive && activeFriendsTab === 'activity' && activeActivitySubTab === 'feed' && typeof loadActivityTabFeed === 'function') {
      try { loadActivityTabFeed(); } catch (e) { console.warn('[v10.762] activity feed refresh skipped:', e); }
    }
    const discoverActive = document.getElementById('nav-discover')?.classList.contains('active');
    if (discoverActive) {
      const friendsWatchingGrid = document.getElementById('discover-friends-watching-grid');
      if (friendsWatchingGrid && typeof fetchFriendWatchingDiscoverTitles === 'function' && typeof renderFriendWatchingDiscoverCards === 'function') {
        try {
          Promise.resolve(fetchFriendWatchingDiscoverTitles(15))
            .then(items => renderFriendWatchingDiscoverCards(items, 'discover-friends-watching-grid', { row: true }))
            .catch(e => console.warn('[v10.762] discover friends-watching refresh failed:', e?.message || e));
        } catch (e) { console.warn('[v10.762] discover friends-watching refresh sync throw:', e); }
      }
    }
  }

  /* v10.764: BULLETPROOF FRIENDS-GRID REFRESH.
     Reports of "Friends page says 'No friends yet' on cold-tap until I
     swap tabs" indicate the existing render trigger at line 531 — gated
     by `nav-community.active` — can miss on cold start (timing race with
     when the nav class lands). Belt-and-suspenders: if the friends-grid
     element is in the DOM and visible (regardless of nav class state),
     re-render it whenever the friends list changes. offsetParent !== null
     is the cheapest "is this element actually visible" check in DOM land. */
  if (friendsKeyChanged) {
    const friendsGrid = document.getElementById('friends-grid');
    if (friendsGrid && friendsGrid.offsetParent !== null && typeof renderFriendsList === 'function') {
      try { renderFriendsList(); } catch (e) { console.warn('[v10.764] friends grid refresh skipped:', e); }
    }
  }

  if (!opts.skipSelfRepair) {
    maybeRepairOwnFriendDoc();
  }
}

// Load friends + requests from Firestore
function applyFriendsDataSnapshot(d = {}, opts = {}) {
  const prev = captureFriendsCommitSnapshot();
  ownFriendIds = normalizeFriendUidList(d.friends);
  ownFriendFollowedAtMs = normalizeFriendFollowedAtMap(d.friendFollowedAtMs);
  ownOutgoingFriendRequestIds = normalizeFriendUidList(d.outgoingRequests);
  ownRejectedFriendRequestIds = normalizeFriendUidList(d.rejectedFriendRequests);
  ownRemovedFriendIds = normalizeFriendUidList(d.removedFriends);
  watchTogetherIncomingRequestPayloadMap = normalizeWatchTogetherRequestPayloadMap(d.watchTogetherIncomingRequestMap);
  watchTogetherOutgoingRequestPayloadMap = normalizeWatchTogetherRequestPayloadMap(d.watchTogetherOutgoingRequestMap);
  watchTogetherApprovedRequestPayloadMap = normalizeWatchTogetherRequestPayloadMap(d.watchTogetherApprovedGroupMap);
  const incomingArrayIds = normalizeWatchTogetherRequestIds(d.watchTogetherIncomingRequests);
  const outgoingArrayIds = normalizeWatchTogetherRequestIds(d.watchTogetherOutgoingRequests);
  watchTogetherIncomingRequestIds = [...new Set([
    ...incomingArrayIds,
    ...Object.keys(watchTogetherIncomingRequestPayloadMap).filter(id => (watchTogetherIncomingRequestPayloadMap[id]?.pendingUids || []).includes(currentUser?.uid))
  ])].filter(id => {
    const group = watchTogetherIncomingRequestPayloadMap[id];
    return !group || (group.pendingUids || []).includes(currentUser?.uid);
  });
  watchTogetherOutgoingRequestIds = [...new Set([
    ...outgoingArrayIds,
    ...Object.keys(watchTogetherOutgoingRequestPayloadMap).filter(id => (watchTogetherOutgoingRequestPayloadMap[id]?.pendingUids || []).length)
  ])].filter(id => {
    const group = watchTogetherOutgoingRequestPayloadMap[id];
    return !group || (group.pendingUids || []).length;
  });
  watchTogetherApprovedRequestIds = [...new Set([
    ...normalizeWatchTogetherRequestIds(d.watchTogetherApprovedGroups),
    ...Object.keys(watchTogetherApprovedRequestPayloadMap)
  ])];

  dmIncomingRequestMap = normalizeDirectMessageMap(d.directMessageIncomingRequestMap);
  dmOutgoingRequestMap = normalizeDirectMessageMap(d.directMessageOutgoingRequestMap);
  const legacyDmThreadMap = normalizeDirectMessageMap(d.directMessageThreadMap);
  if (typeof mergeDirectMessageThreadCollectionIntoState === 'function') {
    mergeDirectMessageThreadCollectionIntoState(legacyDmThreadMap);
  } else {
    dmThreadMap = legacyDmThreadMap;
  }
  dmIncomingRequestIds = [...new Set([
    ...normalizeDirectMessageIds(d.directMessageIncomingRequests),
    ...Object.keys(dmIncomingRequestMap)
  ])].filter(id => dmIncomingRequestMap[id]?.toUid === currentUser?.uid || !dmIncomingRequestMap[id]);
  dmOutgoingRequestIds = [...new Set([
    ...normalizeDirectMessageIds(d.directMessageOutgoingRequests),
    ...Object.keys(dmOutgoingRequestMap)
  ])].filter(id => dmOutgoingRequestMap[id]?.fromUid === currentUser?.uid || !dmOutgoingRequestMap[id]);
  dmThreadIds = [...new Set([
    ...normalizeDirectMessageIds(d.directMessageThreads),
    ...Object.keys(dmThreadMap)
  ])].filter(id => {
    const thread = dmThreadMap[id];
    return !thread || (thread.participantUids || []).includes(currentUser?.uid);
  });
  commitFriendsDataState(prev, opts);
}

function stopFriendsDataListener() {
  if (friendsDataUnsubscribe) {
    friendsDataUnsubscribe();
    friendsDataUnsubscribe = null;
  }
  friendDerivedQueryUnsubscribes.forEach(unsub => {
    try { if (typeof unsub === 'function') unsub(); } catch (_) {}
  });
  friendDerivedQueryUnsubscribes = [];
  stopFriendActivityLiveListeners();
  /* v10.739: also tear down the shared dmThreads listener on sign-out
     so a stale listener doesn't keep firing under the wrong user. */
  if (typeof stopDirectMessageSharedThreadsListener === 'function') {
    try { stopDirectMessageSharedThreadsListener(); } catch (_) {}
  }
  friendsDataLoadedOnce = false;
}

function resetFriendsDataState() {
  ownFriendIds = [];
  ownFriendFollowedAtMs = {};
  ownOutgoingFriendRequestIds = [];
  ownRejectedFriendRequestIds = [];
  ownRemovedFriendIds = [];
  incomingFriendRequestSourceUids = [];
  acceptedFriendSourceUids = [];
  rejectedByFriendUids = [];
  removedByFriendUids = [];
  friendSelfRepairInFlight = false;
  friendSelfRepairSignature = '';
  friends = [];
  incomingRequests = [];
  outgoingRequests = [];
  watchTogetherIncomingRequestIds = [];
  watchTogetherOutgoingRequestIds = [];
  watchTogetherIncomingRequestPayloadMap = {};
  watchTogetherOutgoingRequestPayloadMap = {};
  watchTogetherApprovedRequestIds = [];
  watchTogetherApprovedRequestPayloadMap = {};
  watchTogetherIncomingRequests = [];
  watchTogetherOutgoingRequests = [];
  dmIncomingRequestIds = [];
  dmOutgoingRequestIds = [];
  dmIncomingRequestMap = {};
  dmOutgoingRequestMap = {};
  dmThreadIds = [];
  dmThreadMap = {};
  activeDmThreadId = '';
  Object.keys(friendListDataCache).forEach(uid => delete friendListDataCache[uid]);
  allUsersCache = [];
  usersMap = {};
  friendActivityUnread = false;
  friendActivityCache = null;
  friendActivityPromise = null;
  updateRequestsBadges();
  updateFriendsCountBadge();
}

function attachDerivedFriendQuery(fieldName = '', assign = () => {}) {
  if (!currentUser || !fieldName) return;
  const unsub = db.collection('users').where(fieldName, 'array-contains', currentUser.uid).onSnapshot(snapshot => {
    const prev = captureFriendsCommitSnapshot();
    primeUsersMapFromSnapshot(snapshot);
    assign(normalizeFriendUidList(snapshot.docs.map(doc => doc.id).filter(uid => uid && uid !== currentUser.uid)));
    commitFriendsDataState(prev, { silent: !friendsDataLoadedOnce });
  }, error => {
    console.error(`friends derived listener failed for ${fieldName}:`, error);
  });
  friendDerivedQueryUnsubscribes.push(unsub);
}

function startFriendsDataListener() {
  if (!currentUser) return;
  stopFriendsDataListener();

  friendsDataUnsubscribe = db.collection("users").doc(currentUser.uid).onSnapshot(doc => {
    const d = doc.exists ? doc.data() : {};
    applyFriendsDataSnapshot(d, { silent: !friendsDataLoadedOnce });
    friendsDataLoadedOnce = true;
  }, e => {
    console.error("friends realtime listener failed:", e);
  });
  attachDerivedFriendQuery('outgoingRequests', next => { incomingFriendRequestSourceUids = next; });
  attachDerivedFriendQuery('friends', next => { acceptedFriendSourceUids = next; });
  attachDerivedFriendQuery('rejectedFriendRequests', next => { rejectedByFriendUids = next; });
  attachDerivedFriendQuery('removedFriends', next => { removedByFriendUids = next; });
}

async function loadFriendsData() {
  if (!currentUser) return;
  if (friendsDataLoadedOnce) {
    updateRequestsBadges();
    return;
  }

  try {
    const doc = await db.collection("users").doc(currentUser.uid).get();
    applyFriendsDataSnapshot(doc.exists ? doc.data() : {}, { silent: true });
  } catch(e) {
    console.error("loadFriendsData failed:", e);
    updateRequestsBadges();
  }
}

function updateRequestsBadges() {
  const sharedWatchIncomingTotal = watchTogetherIncomingRequestIds.length;
  const friendIncomingTotal = incomingRequests.length;
  const activityNotificationTotal = Number(
    window.activityNotificationsUnreadCount ||
    (typeof activityNotificationsUnreadCount !== 'undefined' ? activityNotificationsUnreadCount : 0) ||
    0
  ) || 0;

  /* v11.590: split the two community bottom-nav entries so each pings for what
     actually lives under it.
       • ACTIVITY button (#mobile-nav-community) → new feed activity + incoming
         Shared Watch requests (both live in the Activity tab).
       • FRIENDS button (#mobile-nav-friendslist) → incoming friend requests
         (inline in the Friends list) + unread Notifications (the new
         Friends → Notifications tab).
       • Desktop #nav-community is the single "Friends" main-nav entry → union.
     DMs are intentionally excluded (they surface on the DM icon only, per
     v10.777). */
  const activitySideAlert = !!friendActivityUnread || sharedWatchIncomingTotal > 0;
  const friendsSideTotal = friendIncomingTotal + activityNotificationTotal;
  const communityAlertTotal = friendIncomingTotal + sharedWatchIncomingTotal + activityNotificationTotal;

  const applyNavDot = (navBtn, show, label) => {
    if (!navBtn) return;
    let badge = navBtn.querySelector('.nav-badge');
    if (show) {
      if (!badge) { badge = document.createElement('span'); navBtn.appendChild(badge); }
      badge.className = 'nav-badge friend-activity-dot';
      badge.textContent = '';
      badge.setAttribute('aria-label', label);
    } else if (badge) {
      badge.remove();
    }
  };
  applyNavDot(document.getElementById('nav-community'), communityAlertTotal > 0 || !!friendActivityUnread, 'New community activity');
  applyNavDot(document.getElementById('mobile-nav-community'), activitySideAlert, 'New activity or shared watch');
  applyNavDot(document.getElementById('mobile-nav-friendslist'), friendsSideTotal > 0, 'New friend request or notification');

  /* v11.590: unread-count badge on the Notifications tab in the Friends tab bar
     (the count the old Activity "Notifications" pill used to carry). */
  const notifTabBadge = document.getElementById('notifications-tab-unread-badge');
  if (notifTabBadge) {
    if (activityNotificationTotal > 0) {
      notifTabBadge.textContent = activityNotificationTotal > 9 ? '9+' : String(activityNotificationTotal);
      notifTabBadge.style.display = 'inline-flex';
    } else {
      notifTabBadge.textContent = '';
      notifTabBadge.style.display = 'none';
    }
  }

  /* #activity-unread-badge rides on the (always-hidden) Activity inner tab —
     keep it activity-only for correctness even though it isn't visible. */
  const activityDot = document.getElementById('activity-unread-badge');
  if (activityDot) {
    activityDot.style.display = activitySideAlert ? 'inline-block' : 'none';
  }

  updateRequestSubtabBadges();
  updateSharedWatchActivityBadge();
  updateDirectMessagesBadge();
}


function getFriendRequestTotal() {
  return incomingRequests.length;
}

function getWatchTogetherRequestTotal() {
  return watchTogetherIncomingRequestIds.length + watchTogetherOutgoingRequestIds.length;
}

function setRequestSubtabCount(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = String(count);
    el.style.display = 'inline-flex';
  } else {
    el.style.display = 'none';
  }
}

function updateRequestSubtabBadges() {
  setRequestSubtabCount('request-friends-count', getFriendRequestTotal());
  setRequestSubtabCount('request-watch-count', getWatchTogetherRequestTotal());
}

function updateRequestSubtabUi() {
  const friendsBtn = document.getElementById('request-subtab-friends');
  const watchBtn = document.getElementById('request-subtab-watch');
  if (friendsBtn) friendsBtn.classList.toggle('active', activeRequestsSubTab === 'friends');
  if (watchBtn) watchBtn.classList.toggle('active', activeRequestsSubTab === 'watchTogether');
  updateRequestSubtabBadges();
}

function switchRequestsSubTab(tab = 'friends') {
  activeRequestsSubTab = tab === 'watchTogether' ? 'watchTogether' : 'friends';
  updateRequestSubtabUi();
  renderRequestsList(true);
  persistUiState();
}

function openFriendsActivityDefault() {
  activeFriendsTab = 'activity';
  activeActivitySubTab = 'news';
  switchFriendsTab('activity');
}


// Entry point when switching to Friends nav
async function loadCommunity(forceActivity = false) {
  try {
    if (forceActivity) {
      activeFriendsTab = 'activity';
      activeActivitySubTab = 'news';
    }
    const targetTab = forceActivity ? 'activity' : (activeFriendsTab || 'activity');
    if (isPreviewMode()) {
      PREVIEW_COMMUNITY_USERS.forEach(user => { usersMap[user.uid] = user; });
      switchFriendsTab(targetTab);
      return;
    }
    if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing()) {
      if (typeof hydrateShelfdGuestCreatorFriend === 'function') {
        await hydrateShelfdGuestCreatorFriend();
      }
      switchFriendsTab(targetTab);
      return;
    }

    const hadLocalFriendState = friendsDataLoadedOnce || friends.length || incomingRequests.length || outgoingRequests.length || watchTogetherIncomingRequestIds.length;
    switchFriendsTab(targetTab);

    await loadFriendsData();
    primeFriendProfiles().catch(() => {});

    if (!hadLocalFriendState && document.getElementById('nav-community')?.classList.contains('active')) {
      switchFriendsTab(targetTab);
    }
  } catch(e) {
    console.error("loadCommunity failed:", e);
    const grid = document.getElementById('friends-grid');
    if (grid) grid.innerHTML = '<div class="app-error" style="grid-column:1/-1;">Friends could not load. Try again in a moment.</div>';
  }
}


function runFriendsTabWorkWhenSmooth(fn) {
  if (typeof fn !== 'function') return;
  const run = () => requestAnimationFrame(() => {
    try { fn(); }
    catch (error) { console.error('Friends tab work failed:', error); }
  });
  if (document.body.classList.contains('main-nav-switching')) {
    window.setTimeout(run, 245);
    return;
  }
  run();
}

function switchFriendsTab(tab) {
  if (tab === 'activity' && !isValidActivitySubTab(activeActivitySubTab)) {
    activeActivitySubTab = 'news';
  }
  activeFriendsTab = tab;
  const activityTabBtn = document.getElementById('ftab-activity');
  const friendsTab = document.getElementById('ftab-friends');
  /* v810: new "Add a Friend" tab + view. */
  const addFriendTabBtn = document.getElementById('ftab-add-friend');
  /* v11.590: Notifications is now a Friends-page tab (moved out of Activity). */
  const notificationsTabBtn = document.getElementById('ftab-notifications');
  const activityView = document.getElementById('activity-tab-view');
  const friendsView = document.getElementById('friends-list-view');
  const addFriendView = document.getElementById('add-friend-view');
  const notificationsView = document.getElementById('notifications-view');
  /* v11.589: the Requests tab + view were removed — incoming/sent friend
     requests now render inline at the top of the Friends list. No
     requestsTab/requestsView lookups needed here anymore. */
  if (!friendsTab || !friendsView) {
    console.error("Community DOM is incomplete; cannot switch friends tab.");
    return;
  }
  if (activityTabBtn) activityTabBtn.classList.toggle('active', tab === 'activity');
  friendsTab.classList.toggle('active', tab === 'friends');
  if (addFriendTabBtn) addFriendTabBtn.classList.toggle('active', tab === 'add-friend');
  if (notificationsTabBtn) notificationsTabBtn.classList.toggle('active', tab === 'notifications');
  const communityView = document.getElementById('community-view');
  if (communityView) communityView.classList.toggle('friends-activity-active', tab === 'activity');
  if (activityView) activityView.style.display = tab === 'activity' ? 'block' : 'none';
  /* v11.590: stop the notifications live listener whenever we leave the
     Notifications tab (previously gated on leaving the Activity tab, since
     Notifications used to be an Activity sub-tab). */
  if (tab !== 'notifications' && typeof stopActivityNotificationsLiveListener === 'function') {
    stopActivityNotificationsLiveListener();
  }
  friendsView.style.display = tab === 'friends' ? 'block' : 'none';
  if (addFriendView) addFriendView.style.display = tab === 'add-friend' ? 'block' : 'none';
  if (notificationsView) notificationsView.style.display = tab === 'notifications' ? 'block' : 'none';
  if (tab === 'activity') {
    bindFriendsActivitySwipeNavigation();
    updateActivitySubtabUi();
    initFeedComposer();
    runFriendsTabWorkWhenSmooth(() => {
      if (activeFriendsTab !== 'activity') return;
      if (isWatchActivitySubTab()) {
        renderActiveWatchActivitySubTab();
      } else if (activeActivitySubTab === 'news') {
        /* v11.594: entering the Activity tab while News is the active sub-tab
           (restored session / bottom-nav re-entry) must render the news feed,
           not the activity feed into a hidden pane. */
        if (typeof renderNewsActivityFeed === 'function') renderNewsActivityFeed();
      } else {
        friendActivityStorySeenAtSnapshot = getFriendActivitySeenAt();
        loadActivityTabFeed();
        markFriendActivitySeen();
      }
    });
  }
  if (tab === 'friends') {
    resetInlineFriendSearch();
    runFriendsTabWorkWhenSmooth(() => { if (activeFriendsTab === 'friends') renderFriendsList(); });
    /* v10.764: COLD-TAP FRIENDS RESCUE. If the user opens Friends before
       the realtime listener's first snapshot has populated friends[],
       kick off a direct .get() so the page populates without needing
       a tab-swap-and-back. loadFriendsData() is no-op when
       friendsDataLoadedOnce is already true, so this is free in
       steady state. With Firestore persistence (v10.762), the .get()
       hits the IndexedDB cache and returns ~instantly. */
    if (typeof friendsDataLoadedOnce !== 'undefined'
        && !friendsDataLoadedOnce
        && currentUser
        && typeof loadFriendsData === 'function') {
      try {
        Promise.resolve(loadFriendsData()).catch(e => console.warn('[v10.764] friends tab rescue load failed:', e?.message || e));
      } catch (e) { console.warn('[v10.764] friends tab rescue sync throw:', e); }
    }
  }
  if (tab === 'add-friend') {
    runFriendsTabWorkWhenSmooth(() => {
      if (activeFriendsTab === 'add-friend') openAddFriendDefault();
    });
  }
  if (tab === 'notifications') {
    /* v11.590: render the notifications list (relocated here from the Activity
       sub-tab). renderActivityNotificationsPage attaches the live listener,
       renders the list, backfills, and auto-marks-read after a short beat. */
    runFriendsTabWorkWhenSmooth(() => {
      if (activeFriendsTab === 'notifications' && typeof renderActivityNotificationsPage === 'function') {
        renderActivityNotificationsPage();
      }
    });
  }
  /* v10.755: keep page title in header in sync with sub-tab changes */
  if (typeof window.updateMainHeaderPageTitle === 'function') {
    window.updateMainHeaderPageTitle();
  }
  updateActivityTopLeftButton();
  persistUiState();
}

/* v810/v811: Add a Friend tab default state — surface the creator account
   immediately so the user has a real account to act on before they type.
   The creator is looked up by UID (CREATOR_PUBLIC_UID), not by display
   name, so a rename never breaks the suggestion.

   v811: render synchronously from cache/shell first so the creator is
   visible the instant the tab opens (no "Loading…" flash), then
   async-refresh from Firestore in the background and re-render if the
   user hasn't started typing yet. */
function buildCreatorShellUser() {
  return {
    uid: CREATOR_PUBLIC_UID,
    name: CREATOR_DEFAULT_NAME,
    customName: CREATOR_DEFAULT_NAME,
    photo: '',
    customPhoto: '',
    bio: '',
    profileBio: '',
    emailLower: CREATOR_ADMIN_EMAIL,
    accountEmailLower: CREATOR_ADMIN_EMAIL,
    isCreatorAdmin: true,
    isPublic: true
  };
}

async function openAddFriendDefault() {
  const grid = document.getElementById('inline-friend-search-grid');
  const input = document.getElementById('friends-inline-search-input');
  if (!grid) return;
  peopleSearchGridOverrideId = 'inline-friend-search-grid';
  grid.style.display = 'grid';
  if (input) { input.value = ''; }

  if (isPreviewMode()) {
    PREVIEW_COMMUNITY_USERS.forEach(user => { usersMap[user.uid] = user; });
    renderAllUsers(PREVIEW_COMMUNITY_USERS.slice(0, 3));
    return;
  }

  /* Hide the suggestion if the signed-in user IS the creator. */
  if (currentUser?.uid === CREATOR_PUBLIC_UID) {
    grid.innerHTML =
      '<div class="friends-empty no-search-icon" style="grid-column:1/-1;">' +
        '<p>Search for users by username</p>' +
        '<p class="friends-empty-sub">Type a username to find people.</p>' +
      '</div>';
    return;
  }

  /* 1) Immediate render — use cached creator if available, otherwise a
        synchronous shell built from constants. We never block the UI on
        the Firestore round-trip. */
  let creator = (typeof creatorSearchUserCache !== 'undefined' && creatorSearchUserCache?.uid === CREATOR_PUBLIC_UID)
    ? creatorSearchUserCache
    : null;
  if (!creator && typeof getCachedCreatorPublicUser === 'function') {
    try { creator = getCachedCreatorPublicUser(); } catch (_) { creator = null; }
  }
  if (!creator) creator = buildCreatorShellUser();
  usersMap[creator.uid] = creator;
  allUsersCache = [creator];
  renderAllUsers([creator]);

  /* 2) Async refresh — pull the latest creator doc from Firestore, and if
        the user still hasn't typed anything by the time it arrives,
        re-render with the fresh data (e.g. updated avatar / bio). */
  try {
    const fresh = await loadCreatorSearchUser();
    if (!fresh || fresh.uid !== CREATOR_PUBLIC_UID) return;
    if (activeFriendsTab !== 'add-friend') return;
    const currentQuery = input ? String(input.value || '').trim() : '';
    if (currentQuery) return;
    usersMap[fresh.uid] = fresh;
    allUsersCache = [fresh];
    renderAllUsers([fresh]);
  } catch (e) {
    console.warn('[shelfd-friends] add-friend default refresh failed:', e);
  }
}

function refreshActivityTab() {
  friendActivityCache = null;
  friendActivityPromise = null;
  loadActivityTabFeed();
}

function buildSkeletonHTML() {
  const skeletons = Array.from({ length: 4 }, () => `<div class="activity-skeleton-card"></div>`).join('');
  return `${buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })}<div class="activity-feed-list" style="gap:10px">${skeletons}</div>`;
}

function escActivityFeedFallbackText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasActivityFeedFallbackWrittenReview(activity = {}) {
  const item = activity?.item || {};
  const content = activity?.content || {};
  return String(activity?.reviewText || item?.reviewText || content?.reviewText || content?.text || content?.body || '').trim().length > 0;
}

function getActivityFeedFallbackVerb(activity = {}) {
  const eventType = activity.type === 'comment' ? 'commented on' : (activity.eventType || activity.stackEventType || 'updated');
  if (eventType === 'rated') return 'Rated';
  if (eventType === 'completed' || eventType === 'season-finished') return 'Finished';
  if (eventType === 'episode-watched') return 'Watched';
  if (eventType === 'episode-rated' || eventType === 'season-rated') return 'Rated';
  if (eventType === 'started') return 'Started';
  if (eventType === 'planned' || eventType === 'added') return 'Added';
  if (eventType === 'status-changed') return 'Updated';
  if (eventType === 'review' || activity.type === 'media-review') {
    return hasActivityFeedFallbackWrittenReview(activity) ? 'Wrote a Review' : (Number(activity?.rating || activity?.activityRating || activity?.item?.rating || 0) > 0 ? 'Rated' : 'Updated');
  }
  return String(eventType || 'Updated').replace(/-/g, ' ');
}

function renderActivityFeedFallbackItems(feed, activities = [], options = {}) {
  if (!feed) return;
  const source = Array.isArray(activities) ? activities : [];
  const header = typeof buildActivityFeedHeaderHTML === 'function'
    ? buildActivityFeedHeaderHTML(options.heading || 'Activity Feed', { showSharedWatch: !options.hideSharedWatchPill, showRefresh: !options.hideRefresh, hideHeading: !!options.hideHeading })
    : '<div class="activity-feed-header"><span class="activity-feed-heading">Activity Feed</span></div>';
  if (!source.length) {
    feed.innerHTML = `${header}<div class="activity-feed-empty"><strong>Nothing here yet</strong>Add friends or add titles to your list to see activity.</div>`;
    return;
  }
  const cards = source.slice(0, 60).map(activity => {
    const item = activity.item || {};
    const name = activity.name || usersMap?.[activity.uid]?.name || (activity.uid === currentUser?.uid ? 'You' : 'Friend');
    const title = item.title || item.name || activity.title || 'this title';
    const verb = getActivityFeedFallbackVerb(activity);
    const timestamp = activity.timestamp || item.dateAdded || item.dateModified || '';
    const timeLabel = timestamp ? new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    return `<article class="activity-card shelfd-social-card activity-card-fallback">
      <div class="activity-content-col">
        <div class="activity-card-time">${escActivityFeedFallbackText(timeLabel)}</div>
        <div class="sl-activity-action-line sl-activity-action-line-composed">
          <span class="sl-activity-composed-prefix">${escActivityFeedFallbackText(verb)} </span>
          <span class="sl-activity-composed-title">${escActivityFeedFallbackText(title)}</span>
        </div>
        <div class="activity-card-bottom"><span class="activity-card-name">${escActivityFeedFallbackText(name)}</span></div>
      </div>
    </article>`;
  }).join('');
  feed.innerHTML = `${header}<div class="activity-feed-list">${cards}</div>`;
}

function getSharedWatchActivityTotal() {
  return watchTogetherIncomingRequestIds.length;
}

function updateSharedWatchActivityBadge() {
  const count = getSharedWatchActivityTotal();
  const badges = Array.from(document.querySelectorAll('[data-shared-watch-count], #shared-watch-count'));
  badges.forEach(badge => {
    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  });
}

function isWatchActivitySubTab(tab = activeActivitySubTab) {
  return tab === 'friendWatch' || tab === 'sharedWatch';
}

function isValidActivitySubTab(tab = activeActivitySubTab) {
  /* v11.590: 'notifications' is no longer an Activity sub-tab — it moved to the
     Friends page tab bar (switchFriendsTab('notifications')).
     v11.592: 'news' added as a sibling Activity sub-tab. */
  return ['feed', 'sharedWatch', 'friendWatch', 'news'].includes(tab);
}

function renderActiveWatchActivitySubTab(skipHydrate = false) {
  if (activeActivitySubTab === 'friendWatch') return renderFriendWatchRequestsActivity(skipHydrate);
  if (activeActivitySubTab === 'sharedWatch') return renderSharedWatchActivity(skipHydrate);
}

function getApprovedSharedWatchGroups() {
  if (!currentUser) return [];
  const groups = mergeWatchTogetherGroupsById(
    watchTogetherGroups,
    getWatchTogetherMirroredPayloadGroups()
  );
  return groups
    .filter(group => {
      const approved = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
      return approved.includes(currentUser.uid) && approved.some(uid => uid !== currentUser.uid);
    })
    .sort((a, b) => Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0));
}

function getSharedWatchGroupPartners(group = {}) {
  const approved = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
  return approved
    .filter(uid => uid && uid !== currentUser?.uid)
    .map(uid => getWatchTogetherProfile(uid, group));
}

function formatSharedWatchTimeAgo(timestamp = 0) {
  const ts = Number(timestamp || 0);
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))}h ago`;
  if (diff < day * 7) return `${Math.max(1, Math.round(diff / day))}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


function buildSharedWatchDashboardStack(group = {}) {
  const partners = getSharedWatchGroupPartners(group);
  const visible = partners.slice(0, 4);
  if (!visible.length) return '';
  return `<div class="shared-watch-dashboard-stack">${visible.map(profile => `<img src="${escAttr(getWatchTogetherAvatar(profile))}" alt="${escAttr(profile.name || 'User')}" loading="lazy">`).join('')}${partners.length > 4 ? `<span>+${partners.length - 4}</span>` : ''}</div>`;
}

function buildSharedWatchDashboardCards(groups = []) {
  if (!groups.length) return `<div class="shared-watch-dashboard-empty-card">Nothing here yet.</div>`;
  return groups.map(group => {
    const partners = getSharedWatchGroupPartners(group);
    const section = group.section || group.librarySection || group.mediaCategory || '';
    const sectionLabel = getSectionLabel(section, true);
    const modeLabel = group.mode === 'planned' ? 'Planning' : 'Watched';
    const peopleLabel = partners.length === 1 ? partners[0].name || '1 friend' : `${partners.length} friends`;
    const updated = Number(group.updatedAtMs || group.createdAtMs || 0);
    const updatedLabel = updated ? formatSharedWatchTimeAgo(updated) : '';
    return `<div class="shared-watch-dashboard-card">
      <div class="shared-watch-dashboard-poster">${group.cover ? `<img src="${escAttr(group.cover)}" alt="${escAttr(group.title || 'Title')}" loading="lazy">` : `<span>${escHtml(getSectionIcon(section))}</span>`}</div>
      <div class="shared-watch-dashboard-copy">
        <div class="shared-watch-dashboard-kicker"><span>${escHtml(modeLabel)}</span>${sectionLabel ? `<em>${escHtml(sectionLabel)}</em>` : ''}</div>
        <div class="shared-watch-dashboard-title">${escHtml(group.title || 'Untitled')}</div>
        <div class="shared-watch-dashboard-people">${buildSharedWatchDashboardStack(group)}<strong>${partners.length === 1 ? renderDisplayNameHTML(partners[0], '1 friend') : escHtml(peopleLabel)}</strong></div>
        <div class="shared-watch-dashboard-meta">${updatedLabel ? `Updated ${escHtml(updatedLabel)}` : 'Shared list'}</div>
      </div>
    </div>`;
  }).join('');
}

/* v11.624: Activity sub-tab slide-transition state. The horizontal cross-slide
   between Activity Feed · Shared Watch · News is owned by the transition runner
   below; while it runs, `activitySubTabTransitioning` is true so a mid-slide
   pane-render's updateActivitySubtabUi() can't clobber pane display (both the
   leaving + entering pane must stay display:block for the whole slide). The
   token guards against rapid taps stranding a pane mid-slide. */
let activitySubTabTransitioning = false;
let activitySubTabTransitionToken = 0;
let activitySubTabTeardown = null;   // removes the in-flight slide's transitionend listener (flushed on the next switch)
let activitySubTabQueuedTab = '';    // latest tab tapped during an in-flight slide; flushed after the current slide settles
let activityFeedLoadToken = 0;       // invalidates stale async Activity Feed loads when the user leaves the pane

/* Page chrome that is NOT part of the sliding panes — the feed composer (shown
   only on Feed, via the community-view subtab class), the shared-watch badge.
   Set this at the START of a switch so the slide runs on a STABLE layout (the
   composer toggles once, up front, instead of popping mid-slide). */
function applyActivitySubTabChrome() {
  const communityView = document.getElementById('community-view');
  if (communityView) {
    communityView.classList.remove('activity-subtab-feed', 'activity-subtab-notifications', 'activity-subtab-watch-requests', 'activity-subtab-shared-watch', 'activity-subtab-news');
    communityView.classList.add(activeActivitySubTab === 'friendWatch'
      ? 'activity-subtab-watch-requests'
      : (activeActivitySubTab === 'sharedWatch'
        ? 'activity-subtab-shared-watch'
        : (activeActivitySubTab === 'news'
          ? 'activity-subtab-news'
          : 'activity-subtab-feed')));
  }
  updateActivityTopLeftButton();   // v11.648: top-left + becomes Tailor on the News tab
  updateSharedWatchActivityBadge();
}

/* v11.648: the top-left header button (#activity-compose-btn) is shared across
   the Activity sub-tabs. On the NEWS tab it becomes the "Tailor" (news follow)
   button; on Activity Feed / Shared Watch it stays the "+" create-post button.
   We swap the icon + label + action in place — one button, no layout change. */
var ACTIVITY_COMPOSE_PLUS_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
var ACTIVITY_TAILOR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 17h16"></path><circle cx="9" cy="7" r="2.6"></circle><circle cx="15" cy="17" r="2.6"></circle></svg>';
function updateActivityTopLeftButton() {
  const btn = document.getElementById('activity-compose-btn');
  if (!btn) return;
  const shouldShow = activeFriendsTab === 'activity' && activeActivitySubTab === 'news';
  if (!shouldShow) {
    btn.style.display = 'none';
    btn.setAttribute('aria-hidden', 'true');
    btn.tabIndex = -1;
    btn.setAttribute('data-tl-mode', 'hidden');
    btn.classList.remove('activity-compose-btn-tailor');
    btn.innerHTML = ACTIVITY_COMPOSE_PLUS_SVG;
    btn.setAttribute('aria-label', 'Create a post');
    btn.setAttribute('title', 'Create a post');
    return;
  }
  btn.style.removeProperty('display');
  btn.removeAttribute('aria-hidden');
  btn.removeAttribute('tabindex');
  const wantTailor = activeActivitySubTab === 'news';
  const mode = wantTailor ? 'tailor' : 'compose';
  if (btn.getAttribute('data-tl-mode') === mode) return;   // already in the right mode
  btn.setAttribute('data-tl-mode', mode);
  if (wantTailor) {
    btn.innerHTML = ACTIVITY_TAILOR_SVG;
    btn.setAttribute('aria-label', 'Tailor your news');
    btn.setAttribute('title', 'Tailor your news');
    btn.classList.add('activity-compose-btn-tailor');
  } else {
    btn.innerHTML = ACTIVITY_COMPOSE_PLUS_SVG;
    btn.setAttribute('aria-label', 'Create a post');
    btn.setAttribute('title', 'Create a post');
    btn.classList.remove('activity-compose-btn-tailor');
  }
}
window.shelfdActivityTopLeftAction = function (event) {
  if (activeFriendsTab === 'activity' && activeActivitySubTab === 'news' && typeof window.shelfdNewsOpenManage === 'function') {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    window.shelfdNewsOpenManage();
    return;
  }
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
};

function updateActivitySubtabUi() {
  /* v11.590: notifications removed from the Activity sub-tabs. The Activity tab
     now only toggles between the feed and the shared-watch pane. */
  const feed = document.getElementById('friend-activity-feed');
  const shared = document.getElementById('shared-watch-feed');
  const news = document.getElementById('activity-news-feed');
  /* Pane display is OWNED by the slide transition while it runs — skip it here so
     a mid-slide content re-render can't snap a pane on/off and break the slide. */
  if (!activitySubTabTransitioning) {
    if (feed) feed.style.display = activeActivitySubTab === 'feed' ? 'block' : 'none';
    if (shared) shared.style.display = isWatchActivitySubTab() ? 'block' : 'none';
    if (news) news.style.display = activeActivitySubTab === 'news' ? 'block' : 'none';
  }
  applyActivitySubTabChrome();
}

function normalizeActivitySubTab(tab = 'feed') {
  return tab === 'friendWatch'
    ? 'friendWatch'
    : (tab === 'sharedWatch' ? 'sharedWatch' : (tab === 'news' ? 'news' : 'feed'));
}

function isActivityFeedPaneActive(subTab = activeActivitySubTab, friendsTab = activeFriendsTab) {
  return friendsTab === 'activity' && normalizeActivitySubTab(subTab) === 'feed';
}

function cancelPendingActivityFeedLoad() {
  activityFeedLoadToken += 1;
}

function flushQueuedActivitySubTabSwitch() {
  if (activitySubTabTransitioning) return;
  const nextTab = String(activitySubTabQueuedTab || '').trim();
  activitySubTabQueuedTab = '';
  if (!nextTab || nextTab === activeActivitySubTab || activeFriendsTab !== 'activity') return;
  requestAnimationFrame(() => {
    if (activeFriendsTab !== 'activity') return;
    switchActivitySubTab(nextTab);
  });
}


function renderCurrentActivitySubTab() {
  updateActivitySubtabUi();
  if (activeActivitySubTab === 'friendWatch') {
    return renderFriendWatchRequestsActivity();
  } else if (activeActivitySubTab === 'sharedWatch') {
    return renderSharedWatchActivity();
  } else if (activeActivitySubTab === 'news') {
    return (typeof renderNewsActivityFeed === 'function') ? renderNewsActivityFeed() : null;
  } else {
    friendActivityStorySeenAtSnapshot = getFriendActivitySeenAt();
    loadActivityTabFeed();
    markFriendActivitySeen();
  }
  persistUiState();
  return null;
}

function getActivitySubTabPane(tab = activeActivitySubTab) {
  if (tab === 'news') return document.getElementById('activity-news-feed');
  return tab === 'feed'
    ? document.getElementById('friend-activity-feed')
    : document.getElementById('shared-watch-feed');
}

function getActivitySubTabSpatialOrder(tab = activeActivitySubTab) {
  if (tab === 'friendWatch') return 0;
  if (tab === 'news') return 1;          // v11.671: News is the MIDDLE pill now
  if (tab === 'sharedWatch') return 2;   // Shared Watch moved to the right
  return 0;                              // 'feed' (Friends Feed) stays leftmost
}

function clearActivitySubTabSpatialClasses(pane) {
  if (!pane) return;
  pane.classList.remove(
    'activity-subtab-entering',
    'activity-subtab-leaving',
    'activity-subtab-from-left',
    'activity-subtab-from-right',
    'activity-subtab-to-left',
    'activity-subtab-to-right',
    'activity-subtab-run'
  );
}

const ACTIVITY_SUBTAB_PANE_IDS = ['friend-activity-feed', 'activity-news-feed', 'shared-watch-feed'];  // v11.671: feed · news · sharedWatch

/* End the slide: drop the transition state + spatial classes off every pane and
   hand final per-pane display back to updateActivitySubtabUi. Idempotent. */
function settleActivitySubTabTransition() {
  activitySubTabTransitioning = false;
  const root = document.getElementById('activity-tab-view');
  if (root) {
    root.classList.remove('activity-subtab-transitioning');
    root.style.removeProperty('--activity-subtab-transition-height');
  }
  for (const id of ACTIVITY_SUBTAB_PANE_IDS) {
    const el = document.getElementById(id);
    if (el) clearActivitySubTabSpatialClasses(el);
  }
  updateActivitySubtabUi();
  flushQueuedActivitySubTabSwitch();
}

/* The Activity sub-tab cross-slide (Feed · Shared Watch · News), rebuilt v11.624.
   Smooth + identical for all six directions: a single 360ms transform+opacity
   slide (CSS owns the curve/distance), GPU-composited, with NO layout animation.
   Started immediately on tap (the caller does NOT await content), finished by the
   entering pane's transform `transitionend` with a safety-net timeout, and
   interrupt-safe via a token so fast tab taps can't strand a pane mid-slide. */
function runActivitySubTabSpatialTransition(previousSubTab = 'feed', nextSubTab = 'feed', previousPane = null, nextPane = null) {
  /* Flush any prior slide's lingering transitionend listener (rapid tab taps). */
  if (typeof activitySubTabTeardown === 'function') { try { activitySubTabTeardown(); } catch (e) {} activitySubTabTeardown = null; }
  const root = document.getElementById('activity-tab-view');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!root || !previousPane || !nextPane || previousPane === nextPane || reduceMotion) {
    activitySubTabTransitioning = false;
    updateActivitySubtabUi();
    return;
  }

  const token = ++activitySubTabTransitionToken;
  activitySubTabTransitioning = true;
  const forward = getActivitySubTabSpatialOrder(nextSubTab) > getActivitySubTabSpatialOrder(previousSubTab);

  /* Clear leftovers from any interrupted slide; hide any 3rd pane so a fast
     double-tap can't stack a stale pane into flow. Only the two panes in play
     stay visible. */
  for (const id of ACTIVITY_SUBTAB_PANE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    clearActivitySubTabSpatialClasses(el);
    if (el !== previousPane && el !== nextPane) el.style.display = 'none';
  }

  /* Show both panes BEFORE measuring so the height hold is correct, then pin the
     container height (min-height is a floor — the entering pane still grows it if
     its async content lands taller; overflow:hidden clips the overlaid leaver). */
  previousPane.style.display = 'block';
  nextPane.style.display = 'block';
  const holdHeight = Math.max(previousPane.offsetHeight || 0, nextPane.offsetHeight || 0, 160);
  root.style.setProperty('--activity-subtab-transition-height', `${holdHeight}px`);
  root.classList.add('activity-subtab-transitioning');

  previousPane.classList.add('activity-subtab-leaving', forward ? 'activity-subtab-to-left' : 'activity-subtab-to-right');
  nextPane.classList.add('activity-subtab-entering', forward ? 'activity-subtab-from-right' : 'activity-subtab-from-left');

  /* Commit the start frame, then flip on .run (next frame) to animate to neutral. */
  requestAnimationFrame(() => {
    if (token !== activitySubTabTransitionToken) return;
    requestAnimationFrame(() => {
      if (token !== activitySubTabTransitionToken) return;
      previousPane.classList.add('activity-subtab-run');
      nextPane.classList.add('activity-subtab-run');
    });
  });

  /* Finish on the entering pane's transform transitionend (exact, frame-perfect),
     with a safety timeout in case the event is dropped (e.g. WKWebView
     backgrounded mid-slide). Whichever fires first wins; both are token-guarded. */
  let finished = false;
  const finish = () => {
    if (finished || token !== activitySubTabTransitionToken) return;
    finished = true;
    nextPane.removeEventListener('transitionend', onTransitionEnd);
    activitySubTabTeardown = null;
    settleActivitySubTabTransition();
  };
  const onTransitionEnd = (event) => {
    if (event && event.target === nextPane && event.propertyName === 'transform') finish();
  };
  nextPane.addEventListener('transitionend', onTransitionEnd);
  activitySubTabTeardown = () => { try { nextPane.removeEventListener('transitionend', onTransitionEnd); } catch (e) {} };
  window.setTimeout(finish, 420);   // 360ms transition + safety buffer
}

async function switchActivitySubTab(tab = 'feed') {
  const requestedSubTab = normalizeActivitySubTab(tab);
  if (activitySubTabTransitioning) {
    if (requestedSubTab !== 'feed') cancelPendingActivityFeedLoad();
    activitySubTabQueuedTab = requestedSubTab === activeActivitySubTab ? '' : requestedSubTab;
    persistUiState();
    return;
  }
  activitySubTabQueuedTab = '';
  if (activeActivitySubTab === requestedSubTab) {
    updateActivitySubtabUi();
    persistUiState();
    return;
  }

  const previousSubTab = isValidActivitySubTab(activeActivitySubTab) ? activeActivitySubTab : 'feed';
  const previousPane = getActivitySubTabPane(previousSubTab);
  activeActivitySubTab = requestedSubTab;
  const nextPane = getActivitySubTabPane(requestedSubTab);
  if (requestedSubTab !== 'feed') cancelPendingActivityFeedLoad();

  /* 1) Page chrome up front (composer show/hide via the community-view subtab
        class) so the slide runs on a STABLE layout — no mid-slide vertical jump. */
  applyActivitySubTabChrome();

  /* 2) START THE SLIDE IMMEDIATELY — do NOT await content. This is the core fix:
        the old flow awaited an async network render BEFORE animating, which is
        what made tab switches feel laggy/clunky. The pane's content now renders
        under/into the slide while it plays. */
  runActivitySubTabSpatialTransition(previousSubTab, requestedSubTab, previousPane, nextPane);

  /* 3) Render the now-active pane's content (async fine — guarded so its own
        updateActivitySubtabUi() can't clobber the in-flight slide). */
  try {
    const renderResult = renderCurrentActivitySubTab();
    if (renderResult && typeof renderResult.then === 'function') await renderResult;
  } catch (error) {
    console.error('Activity subtab render failed:', error);
  }
  persistUiState();
}

function bindFriendsActivitySwipeNavigation() {
  const view = document.getElementById('activity-tab-view');
  if (!view) return;
  view.dataset.friendsActivitySwipeBound = 'disabled';
}


async function renderFriendWatchRequestsActivity(skipHydrate = false) {
  const feed = document.getElementById('shared-watch-feed');
  if (!feed) return;
  updateActivitySubtabUi();
  const headerHtml = buildActivityFeedHeaderHTML('Watch Requests');
  if (!currentUser) {
    feed.innerHTML = `${headerHtml}<div class="activity-feed-empty"><strong>Sign in required</strong>Watch Requests will appear here.</div>`;
    return;
  }
  if (!skipHydrate) await hydrateWatchTogetherMirroredRequests();
  const incomingTogether = watchTogetherIncomingRequests.slice();
  const outgoingTogether = watchTogetherOutgoingRequests.slice();
  const hasIncoming = incomingTogether.length > 0;
  const hasOutgoing = outgoingTogether.length > 0;
  const incomingCount = incomingTogether.length;
  const outgoingCount = outgoingTogether.length;

  if (!hasIncoming && !hasOutgoing) {
    feed.innerHTML = `${headerHtml}<div class="friend-watch-clean-shell empty">
      <div class="friend-watch-clean-hero">
        <div class="friend-watch-clean-icon">🎬</div>
        <div><span>Watch Requests</span><strong>No requests right now</strong><p>Requests to plan or confirm watching together will show here with clear Accept and Decline buttons.</p></div>
      </div>
    </div>`;
    return;
  }

  feed.innerHTML = `${headerHtml}<div class="friend-watch-clean-shell">
    <div class="friend-watch-clean-hero">
      <div class="friend-watch-clean-icon">🎬</div>
      <div><span>Watch Requests</span><strong>${incomingCount ? `${incomingCount} request${incomingCount === 1 ? '' : 's'} need${incomingCount === 1 ? 's' : ''} approval` : 'No approvals needed'}</strong><p>${incomingCount ? 'Accept or decline shared watch requests sent to you.' : 'Your sent requests are below so you can remove them anytime.'}</p></div>
    </div>
    ${hasIncoming ? `<section class="friend-watch-clean-section priority"><div class="friend-watch-clean-section-head"><span>Needs your response</span><em>${incomingCount}</em></div>${renderWatchTogetherRequestCards(incomingTogether, 'incoming')}</section>` : ''}
    ${hasOutgoing ? `<section class="friend-watch-clean-section"><div class="friend-watch-clean-section-head"><span>Sent by you</span><em>${outgoingCount}</em></div>${renderWatchTogetherRequestCards(outgoingTogether, 'outgoing')}</section>` : ''}
  </div>`;
}


function buildSharedWatchDescriptionCard() {
  return `<section class="shared-watch-description-card collapsed" data-shared-watch-description-card>
    <button class="shared-watch-description-toggle" type="button" onclick="toggleSharedWatchDescriptionCard(this)" aria-expanded="false">
      <span>What is Shared Watch?</span>
      <em>Expand</em>
    </button>
    <div class="shared-watch-description-body">
      <section class="shared-watch-description-section">
        <h4>Overview</h4>
        <p><strong>Shared Watch</strong> lets you connect friends to movies, TV shows, and anime that you plan to watch together or already watched together.</p>
      </section>
      <section class="shared-watch-description-section">
        <h4>How it works</h4>
        <p>If a title has not released yet, or you have not watched it yet, you can add someone as a reminder that you want to watch it together.</p>
        <p>If you already watched a title together, you can tag the people you watched it with so the title card keeps that shared watch connection visible.</p>
      </section>
      <section class="shared-watch-description-section">
        <h4>How to start</h4>
        <p>Tap the two-person Shared Watch icon on a title card to invite someone to watch together.</p>
      </section>
      <section class="shared-watch-description-section">
        <h4>Privacy</h4>
        <p>Planning tags stay private to you. Confirmed watched-together tags can be shared so people can see who watched that title together.</p>
      </section>
    </div>
  </section>`;
}

function toggleSharedWatchDescriptionCard(btn) {
  const card = btn?.closest?.('[data-shared-watch-description-card]');
  if (!card) return;
  const collapsed = card.classList.toggle('collapsed');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const label = btn.querySelector('em');
  if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
}

async function renderSharedWatchActivity(skipHydrate = false) {
  const feed = document.getElementById('shared-watch-feed');
  if (!feed) return;
  updateActivitySubtabUi();
  const headerHtml = buildActivityFeedHeaderHTML('Shared Watch');
  const sharedWatchDescriptionHtml = buildSharedWatchDescriptionCard();
  if (!currentUser) {
    feed.innerHTML = `${headerHtml}${sharedWatchDescriptionHtml}<div class="activity-feed-empty"><strong>Sign in required</strong>Your confirmed shared titles will appear here.</div>`;
    return;
  }
  if (!skipHydrate) await hydrateWatchTogetherMirroredRequests();
  const groups = getApprovedSharedWatchGroups();
  const planned = groups.filter(group => group.mode === 'planned');
  const watched = groups.filter(group => group.mode !== 'planned');
  const friendCount = new Set(groups.flatMap(group => getSharedWatchGroupPartners(group).map(profile => profile.uid))).size;
  if (!groups.length) {
    feed.innerHTML = `${headerHtml}${sharedWatchDescriptionHtml}<div class="shared-watch-dashboard"><div class="shared-watch-hero"><div><span>Shared Watch</span><strong>Nothing confirmed yet</strong><p>Approve a Watch Request to build shared shelves for plans and watched-together titles.</p></div></div></div>`;
    return;
  }
  feed.innerHTML = `${headerHtml}${sharedWatchDescriptionHtml}<div class="shared-watch-dashboard">
    <div class="shared-watch-hero">
      <div><span>Shared Watch</span><strong>${groups.length} shared ${groups.length === 1 ? 'title' : 'titles'}</strong><p>${friendCount} ${friendCount === 1 ? 'friend' : 'friends'} connected through movies, TV, and anime.</p></div>
      <div class="shared-watch-hero-stats"><em>${planned.length}</em><small>Planned</small><em>${watched.length}</em><small>Watched</small></div>
    </div>
    <div class="shared-watch-dashboard-lane planned"><div class="shared-watch-lane-title"><span>🍿 Planning Together</span><em>${planned.length}</em></div>${buildSharedWatchDashboardCards(planned)}</div>
    <div class="shared-watch-dashboard-lane watched"><div class="shared-watch-lane-title"><span>✨ Watched Together</span><em>${watched.length}</em></div>${buildSharedWatchDashboardCards(watched)}</div>
  </div>`;
}

async function loadActivityTabFeed() {
  const feed = document.getElementById('friend-activity-feed');
  if (!feed) return;
  const loadToken = ++activityFeedLoadToken;
  const isStaleLoad = () => loadToken !== activityFeedLoadToken || !isActivityFeedPaneActive();
  try {
    if (isPreviewMode()) {
      if (isStaleLoad()) return;
      renderPreviewFriendActivity();
      return;
    }
    if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing()) {
      if (isStaleLoad()) return;
      if (!feed.querySelector('.activity-feed-list, .activity-feed-empty')) feed.innerHTML = buildSkeletonHTML();
      if (typeof hydrateShelfdGuestCreatorFriend === 'function') {
        await hydrateShelfdGuestCreatorFriend();
      }
      if (isStaleLoad()) return;
      const dayLimit = (typeof getFriendActivityDayLimit === 'function') ? getFriendActivityDayLimit() : 7;
      const activities = await fetchAllFriendActivities(dayLimit);
      if (isStaleLoad()) return;
      if (!activities.length) {
        feed.innerHTML = `${buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })}<div class="activity-feed-empty"><strong>No creator activity yet</strong></div>`;
        return;
      }
      renderFriendActivityItems(feed, activities, { showLoadMore: true });
      return;
    }
    if (isStaleLoad()) return;
    if (!currentUser) {
      feed.innerHTML = `${buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })}<div class="activity-feed-empty"><strong>Sign in to see activity</strong></div>`;
      return;
    }
    /* v11.625: keep an already-rendered feed visible while it refreshes in the
       BACKGROUND instead of blanking it to a skeleton. That skeleton flash on tab
       re-entry was the "brief delay" felt when switching TO Activity Feed — News
       is cached and Shared Watch keeps its content, so neither blanked, which is
       why only Feed felt laggy. Skeleton shows only on a cold load (empty feed). */
    if (isStaleLoad()) return;
    if (!feed.querySelector('.activity-feed-list, .activity-feed-empty')) feed.innerHTML = buildSkeletonHTML();
    const dayLimit = (typeof getFriendActivityDayLimit === 'function') ? getFriendActivityDayLimit() : 7;
    const activities = await fetchAllFriendActivities(dayLimit);
    if (isStaleLoad()) return;
    const friendCount = Array.isArray(friends) ? friends.length : 0;
    if (!activities.length && !friendCount) {
      feed.innerHTML = `${buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })}<div class="activity-feed-empty"><strong>Nothing here yet</strong>Add friends or add titles to your list to see activity.</div>`;
      return;
    }
    renderFriendActivityItems(feed, activities, { showLoadMore: true });
  } catch (error) {
    if (isStaleLoad()) return;
    window.__shelfdLastActivityFeedError = {
      phase: 'load',
      message: error?.message || String(error || ''),
      stack: error?.stack || '',
      at: new Date().toISOString()
    };
    console.error('Activity feed load failed:', error);
    const header = typeof buildActivityFeedHeaderHTML === 'function'
      ? buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })
      : '<div class="activity-feed-header"><span class="activity-feed-heading">Activity Feed</span></div>';
    const diagnostic = escActivityFeedFallbackText(error?.message || String(error || 'unknown error')).slice(0, 120);
    feed.innerHTML = `${header}<div class="activity-feed-empty"><strong>Activity is still syncing</strong>Close and reopen the app. If this stays here, send this code: ${diagnostic}</div>`;
    return;
  }
}

function getShelfdFriendHandle(user = {}, fallback = 'User') {
  const raw = String(
    user.usernameHandle
    || user.userHandle
    || user.handle
    || user.username
    || user.usernameHandleLower
    || user.usernameLower
    || ''
  ).trim().replace(/^@+/, '');
  return raw || String(fallback || 'User').trim();
}

function getShelfdFriendDisplayName(user = {}, fallback = '') {
  return String(
    user.customName
    || user.fullName
    || user.displayName
    || user.name
    || fallback
    || ''
  ).trim();
}

async function buildFriendRequestCards(uids = [], type = 'incoming') {
  if (!uids.length) return '';
  let docs = [];
  try {
    docs = await Promise.all(uids.map(uid => db.collection("users").doc(uid).get()));
  } catch(e) {
    console.error(type === 'incoming' ? "Incoming requests load failed:" : "Outgoing requests load failed:", e);
    throw e;
  }
  /* v10.224: requests page rebuilt in the same IG row style as the Friends
     tab — circular avatar, handle line + display name underneath, trailing
     action buttons. Incoming = Confirm + Delete; outgoing = Cancel. */
  let html = '';
  docs.forEach(doc => {
    if (!doc.exists) return;
    const u = { uid: doc.id, ...(doc.data() || {}) };
    usersMap[u.uid] = u;
    const fallbackAvatar = '/default-avatar.svg#' + encodeURIComponent(u.name || '?') + '&background=1e2028&color=60a5fa';
    const avatar = u.photo || fallbackAvatar;
    const displayName = getShelfdFriendDisplayName(u, '');
    const handle = getShelfdFriendHandle(u, displayName || 'User');
    const displayNameHtml = displayName && displayName.toLowerCase() !== handle.toLowerCase()
      ? `<span class="shelfd-friend-name">${escHtml(displayName)}</span>`
      : '';
    const uidAttr = escAttr(u.uid);
    const actionsHtml = type === 'incoming'
      ? `<div class="shelfd-friend-req-actions">
           <button type="button" class="shelfd-friend-req-btn primary" onclick="event.stopPropagation(); acceptFriendRequest('${uidAttr}')">Confirm</button>
           <button type="button" class="shelfd-friend-req-btn secondary" onclick="event.stopPropagation(); rejectFriendRequest('${uidAttr}')">Delete</button>
         </div>`
      : `<div class="shelfd-friend-req-actions">
           <button type="button" class="shelfd-friend-req-btn secondary shelfd-friend-req-btn-requested" aria-label="Requested — tap to cancel friend request" onclick="event.stopPropagation(); cancelFriendRequest('${uidAttr}')">Requested</button>
         </div>`;
    html += `<div class="shelfd-friend-row shelfd-friend-req-row" data-friend-uid="${uidAttr}" onclick="openUserProfile('${uidAttr}')">
      <img class="shelfd-friend-avatar" src="${escAttr(avatar)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escAttr(fallbackAvatar)}'">
      <div class="shelfd-friend-text">
        <strong class="shelfd-friend-handle">${escHtml(handle)}</strong>
        ${displayNameHtml}
      </div>
      ${actionsHtml}
    </div>`;
  });
  return html;
}

async function renderRequestsList(skipWatchTogetherHydrate = false) {
  const inGrid = document.getElementById('incoming-grid');
  const outGrid = document.getElementById('outgoing-grid');
  const inSec = document.getElementById('incoming-section');
  const outSec = document.getElementById('outgoing-section');
  if (!inGrid || !outGrid || !inSec || !outSec) {
    console.error("Requests DOM is incomplete.");
    return;
  }
  // Do NOT force activeRequestsSubTab here — preserve whatever tab the user chose.
  updateRequestSubtabUi();

  // ── Watch Together subtab ──────────────────────────────────────────────────
  if (activeRequestsSubTab === 'watchTogether') {
    const incomingGroups = Array.isArray(watchTogetherIncomingRequests) ? watchTogetherIncomingRequests : [];
    const outgoingGroups = Array.isArray(watchTogetherOutgoingRequests) ? watchTogetherOutgoingRequests : [];
    const incomingHeading = inSec.querySelector('h3');
    const outgoingHeading = outSec.querySelector('h3');
    if (incomingHeading) { incomingHeading.textContent = 'Incoming Watch Together Requests'; incomingHeading.style.display = ''; }
    if (outgoingHeading) { outgoingHeading.textContent = 'Sent Watch Together Requests'; outgoingHeading.style.display = ''; }
    if (incomingGroups.length) {
      inSec.style.display = 'block';
      inGrid.innerHTML = typeof renderWatchTogetherRequestCards === 'function'
        ? renderWatchTogetherRequestCards(incomingGroups, 'incoming')
        : '';
    } else {
      inSec.style.display = 'none';
      inGrid.innerHTML = '';
    }
    if (outgoingGroups.length) {
      outSec.style.display = 'block';
      outGrid.innerHTML = typeof renderWatchTogetherRequestCards === 'function'
        ? renderWatchTogetherRequestCards(outgoingGroups, 'outgoing')
        : '';
    } else {
      outSec.style.display = 'none';
      outGrid.innerHTML = '';
    }
    if (!incomingGroups.length && !outgoingGroups.length) {
      inSec.style.display = 'none';
      outSec.style.display = 'block';
      if (outgoingHeading) outgoingHeading.style.display = 'none';
      inGrid.innerHTML = '';
      outGrid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
        <div class="friends-empty-icon">🎬</div>
        <p style="color:#7a6f99;font-size:14px;">No Watch Together requests</p>
        <p class="friends-empty-sub">Incoming and sent Watch Together invites will appear here.</p>
      </div>`;
    }
    return;
  }

  const incomingHeading = inSec.querySelector('h3');
  const outgoingHeading = outSec.querySelector('h3');

  if (isPreviewMode()) {
    inSec.style.display = 'none';
    outSec.style.display = 'block';
    if (outgoingHeading) outgoingHeading.style.display = 'none';
    inGrid.innerHTML = '';
    outGrid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">📬</div>
      <p style="color:#7a6f99;font-size:14px;">Preview requests are simulated only</p>
      <p class="friends-empty-sub">Sign in to send, accept, and manage real requests.</p>
    </div>`;
    return;
  }

  const incomingItems = incomingRequests.slice();
  const outgoingItems = outgoingRequests.slice();
  const hasIncoming = incomingItems.length > 0;
  const hasOutgoing = outgoingItems.length > 0;

  if (incomingHeading) {
    incomingHeading.textContent = 'Incoming Friend Requests';
    incomingHeading.style.display = '';
  }
  if (outgoingHeading) {
    outgoingHeading.textContent = 'Sent Friend Requests';
    outgoingHeading.style.display = '';
  }

  if (!hasIncoming && !hasOutgoing) {
    inSec.style.display = 'none';
    outSec.style.display = 'block';
    if (outgoingHeading) outgoingHeading.style.display = 'none';
    inGrid.innerHTML = '';
    outGrid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">📭</div>
      <p style="color:#7a6f99;font-size:14px;">No friend requests</p>
      <p class="friends-empty-sub">Incoming and sent friend invites will appear here.</p>
    </div>`;
    return;
  }

  if (hasIncoming) {
    inSec.style.display = 'block';
    inGrid.innerHTML = '<div class="skeleton-card" style="grid-column:1/-1;"></div>';
    try {
      inGrid.innerHTML = await buildFriendRequestCards(incomingItems, 'incoming');
    } catch(e) {
      inGrid.innerHTML = '<div class="app-error" style="grid-column:1/-1;">Requests could not load. Try again in a moment.</div>';
    }
  } else {
    inSec.style.display = 'none';
    inGrid.innerHTML = '';
  }

  if (hasOutgoing) {
    outSec.style.display = 'block';
    outGrid.innerHTML = '<div class="skeleton-card" style="grid-column:1/-1;"></div>';
    try {
      outGrid.innerHTML = await buildFriendRequestCards(outgoingItems, 'outgoing');
    } catch(e) {
      outGrid.innerHTML = '<div class="app-error" style="grid-column:1/-1;">Sent requests could not load. Try again in a moment.</div>';
    }
  } else {
    outSec.style.display = 'none';
    outGrid.innerHTML = '';
  }
}

/* v11.589: render incoming + sent friend requests inline at the top of the
   Friends list (above the sort row). Replaces the standalone Requests tab.
   Incoming requests show Confirm/Delete, sent requests show Cancel — the exact
   same actionable cards the old Requests page used (buildFriendRequestCards).
   Async because each card reads the requester's profile from Firestore. Runs on
   every renderShelfdFriendsLayout() and re-runs on every friend-data commit
   (commitFriendsDataState → renderFriendsList → renderShelfdFriendsLayout). */
async function hydrateInlineFriendRequests() {
  const grid = document.getElementById('friends-grid');
  if (!grid) return;
  const host = grid.querySelector('[data-shelfd-friends-requests]');
  if (!host) return;
  if (typeof isPreviewMode === 'function' && isPreviewMode()) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const incomingItems = Array.isArray(incomingRequests) ? incomingRequests.slice() : [];
  const outgoingItems = Array.isArray(outgoingRequests) ? outgoingRequests.slice() : [];
  if (!incomingItems.length && !outgoingItems.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  let incomingCards = '';
  let outgoingCards = '';
  try { if (incomingItems.length) incomingCards = await buildFriendRequestCards(incomingItems, 'incoming'); } catch (_) { incomingCards = ''; }
  try { if (outgoingItems.length) outgoingCards = await buildFriendRequestCards(outgoingItems, 'outgoing'); } catch (_) { outgoingCards = ''; }
  /* A newer renderFriendsList() may have replaced the container while we awaited
     the Firestore reads — bail so we don't write stale cards into a detached node
     (the newer render runs its own hydrate against the fresh container). */
  if (!host.isConnected) return;
  let html = '';
  if (incomingCards) {
    html += `<div class="shelfd-friends-req-group">
      <div class="shelfd-friends-req-heading">Friend requests<span class="shelfd-friends-req-count">${incomingItems.length}</span></div>
      <div class="shelfd-friends-req-list">${incomingCards}</div>
    </div>`;
  }
  if (outgoingCards) {
    html += `<div class="shelfd-friends-req-group">
      <div class="shelfd-friends-req-heading">Sent</div>
      <div class="shelfd-friends-req-list">${outgoingCards}</div>
    </div>`;
  }
  if (!html) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.innerHTML = html;
  host.hidden = false;
}
window.hydrateInlineFriendRequests = hydrateInlineFriendRequests;

async function renderFriendsList() {
  const grid = document.getElementById('friends-grid');
  const badge = document.getElementById('friends-count-badge');
  if (!grid || !badge) {
    console.error("Friends DOM is incomplete.");
    return;
  }
  /* v11365: when returning to the friends list via the back-swipe, the page is
     already revealed and current — skip the innerHTML re-render so it doesn't
     visibly "refresh"/flash the instant the shelf finishes sliding off. The
     realtime friends listener re-renders normally once the brief suppression
     window clears (or immediately if the grid is empty). */
  if (window.__shelfdSuppressFriendsListRender && grid.children && grid.children.length > 0) {
    return;
  }
  if (isPreviewMode()) {
    renderPreviewCommunityUsers(
      PREVIEW_COMMUNITY_USERS,
      'No preview friends available',
      'Preview friends help demonstrate the shared list experience.'
    );
    return;
  }
  if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing()) {
    const context = typeof hydrateShelfdGuestCreatorFriend === 'function'
      ? await hydrateShelfdGuestCreatorFriend()
      : { creator: usersMap[CREATOR_PUBLIC_UID] || { uid: CREATOR_PUBLIC_UID, name: CREATOR_DEFAULT_NAME, photo: '' } };
    const creator = context.creator || usersMap[CREATOR_PUBLIC_UID] || { uid: CREATOR_PUBLIC_UID, name: CREATOR_DEFAULT_NAME, photo: '' };
    usersMap[CREATOR_PUBLIC_UID] = { ...(usersMap[CREATOR_PUBLIC_UID] || {}), ...creator };
    const avatar = creator.photo || '/default-avatar.svg#' + encodeURIComponent(creator.name || CREATOR_DEFAULT_NAME) + '&background=1e2028&color=60a5fa';
    badge.textContent = '(1)';
    grid.innerHTML = `<div class="user-card friend-list-card" style="justify-content:space-between;">
      <div class="friend-card-main" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer;" onclick="openGuestCreatorListsView({ returnTab: 'community' })">
        <img class="user-card-avatar" src="${escAttr(avatar)}" alt="">
        <div class="friend-card-copy"><div class="user-card-name">${renderDisplayNameHTML(creator, CREATOR_DEFAULT_NAME)}</div></div>
      </div>
      <div class="friend-actions-group">
        <button class="friend-action-btn friend-mobile-list-btn friend-screenlist-btn" onclick="event.stopPropagation(); openGuestCreatorListsView({ returnTab: 'community' })">View Shelf</button>
        <button class="friend-action-btn friend-profile-btn friend-mobile-profile-btn" onclick="event.stopPropagation(); openUserProfile('${CREATOR_PUBLIC_UID}')">Profile</button>
        <button class="friend-action-btn friend-profile-btn friend-profile-desktop-btn" onclick="event.stopPropagation(); openUserProfile('${CREATOR_PUBLIC_UID}')">Profile</button>
      </div>
    </div>`;
    return;
  }
  if (friends.length === 0) {
    badge.textContent = '';
    /* v11.589: with the Requests tab gone, a user who has pending friend
       requests but no accepted friends yet must STILL see those requests.
       Render the full layout (requests inline at top + empty friend list) when
       anything is pending; otherwise fall back to the plain "No friends" state. */
    const hasPendingRequests = (Array.isArray(incomingRequests) && incomingRequests.length > 0)
      || (Array.isArray(outgoingRequests) && outgoingRequests.length > 0);
    if (hasPendingRequests) {
      renderShelfdFriendsLayout([]);
      return;
    }
    grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">👥</div>
      <p style="color:#7a6f99;font-size:14px;">No friends yet</p>
      <p class="friends-empty-sub">Search for people you know and build a shared discovery shelf.</p>
    </div>`;
    return;
  }
  badge.textContent = '(' + friends.length + ')';
  const cachedProfiles = friends
    .map(uid => usersMap[uid] ? { ...usersMap[uid], uid: usersMap[uid].uid || uid } : null)
    .filter(Boolean);
  const hasAllCachedProfiles = cachedProfiles.length === friends.length && cachedProfiles.every(profile => profile.name);

  /* v10.222: IG-style remodel of the friends list — search bar, follow
     requests preview row, categories block, sort header, vertical user rows
     (avatar + handle + name + X only). The header (tabs/title) above is
     untouched. No Message button, per the spec. */
  function sortShelfdFriendProfiles(profiles, mode = shelfdFriendsSortMode) {
    return (profiles || []).filter(Boolean).slice().sort((a, b) => {
      if (mode === 'alpha') {
        const ha = getShelfdFriendHandle(a, getShelfdFriendDisplayName(a, '')).toLowerCase();
        const hb = getShelfdFriendHandle(b, getShelfdFriendDisplayName(b, '')).toLowerCase();
        return ha.localeCompare(hb);
      }
      const ta = getFriendFollowedAtMs(a.uid);
      const tb = getFriendFollowedAtMs(b.uid);
      return mode === 'oldest' ? ta - tb : tb - ta;
    });
  }

  function buildFriendsListHtml(profiles) {
    const safeProfiles = sortShelfdFriendProfiles(profiles);
    let listHtml = '';
    safeProfiles.forEach(u => {
      if (!u || !u.uid) return;
      usersMap[u.uid] = { ...usersMap[u.uid], ...u };
      const fallbackAvatar = '/default-avatar.svg#' + encodeURIComponent(u.name || '?') + '&background=1e2028&color=60a5fa';
      const avatar = u.photo || fallbackAvatar;
      const displayName = getShelfdFriendDisplayName(u, '');
      const handle = getShelfdFriendHandle(u, displayName || 'User');
      const displayNameHtml = displayName && displayName.toLowerCase() !== handle.toLowerCase()
        ? `<span class="shelfd-friend-name">${escHtml(displayName)}</span>`
        : '';
      const filterTokens = [handle, displayName, u.name || ''].map(s => String(s || '').toLowerCase()).join(' ');
      const removeLabel = escAttr(displayName || handle || 'this friend');
      const followedAtMs = getFriendFollowedAtMs(u.uid);
      listHtml += `<div class="shelfd-friend-row" data-friend-uid="${escAttr(u.uid)}" data-friend-followed-at-ms="${escAttr(followedAtMs)}" data-friend-filter="${escAttr(filterTokens)}" onclick="viewUserFromMap('${escAttr(u.uid)}')">
        <img class="shelfd-friend-avatar" src="${escAttr(avatar)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escAttr(fallbackAvatar)}'">
        <div class="shelfd-friend-text">
          <strong class="shelfd-friend-handle">${escHtml(handle)}</strong>
          ${displayNameHtml}
        </div>
        <button class="shelfd-friend-x" type="button" aria-label="Remove friend" onclick="event.stopPropagation(); confirmRemoveFriend('${escAttr(u.uid)}','${removeLabel}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
      </div>`;
    });
    const emptyHtml = `<div class="shelfd-friends-empty"><div class="friends-empty-icon">👥</div><p>No friends found</p></div>`;
    return listHtml || emptyHtml;
  }

  /* v11.589: buildFollowRequestsRowHtml() (the compact preview row that linked
     to the old Requests tab) was removed. Incoming/sent friend requests now
     render as full actionable cards inline via hydrateInlineFriendRequests(). */

  function buildCategoriesHtml(profiles) {
    // Compute lightweight previews for each category. These are best-effort
    // signals over current cached profile data — Shelfd is a symmetric-friend
    // model so "people you don't follow back" is structurally empty, but the
    // row is preserved to mirror the IG layout the user referenced.
    const safe = (profiles || []).filter(Boolean);
    const deactivated = safe.filter(u => !u || !u.name || u.deactivated === true || u.disabled === true);
    const interactionCount = uid => {
      if (typeof getDirectMessageThreadMessageCount === 'function') {
        try { return Number(getDirectMessageThreadMessageCount(uid) || 0); } catch (_) {}
      }
      return 0;
    };
    const sortedByInteraction = safe.slice().sort((a, b) => interactionCount(a.uid) - interactionCount(b.uid));
    const leastInteracted = sortedByInteraction.slice(0, Math.min(5, sortedByInteraction.length));

    const renderRow = (key, label, sampleList, fallbackText) => {
      const sample = sampleList[0] || null;
      const sampleHandle = sample ? getShelfdFriendHandle(sample, getShelfdFriendDisplayName(sample, 'user')) : '';
      const sampleAvatar = sample ? (sample.photo || '/default-avatar.svg#' + encodeURIComponent(sample.name || '?') + '&background=1e2028&color=60a5fa') : '';
      const others = Math.max(0, sampleList.length - 1);
      const sub = sample
        ? `${escHtml(sampleHandle)} and ${others} other${others === 1 ? '' : 's'}`
        : escHtml(fallbackText);
      return `<button class="shelfd-friends-cat-row" type="button" data-category="${escAttr(key)}" onclick="handleFriendsCategoryOpen && handleFriendsCategoryOpen('${escAttr(key)}')">
        <span class="shelfd-friends-cat-avatar${sample ? '' : ' is-empty'}">
          ${sampleAvatar ? `<img src="${escAttr(sampleAvatar)}" alt="" loading="lazy" decoding="async">` : `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`}
        </span>
        <span class="shelfd-friends-cat-text">
          <strong>${escHtml(label)}</strong>
          <span>${sub}</span>
        </span>
      </button>`;
    };

    return `<div class="shelfd-friends-cat-block">
      <div class="shelfd-friends-cat-heading">Categories</div>
      ${renderRow("dont-follow-back", "People you don't follow back", [], 'No suggestions yet')}
      ${renderRow('least-interacted', 'Least interacted with', leastInteracted, 'Start chatting to see suggestions')}
      ${renderRow('deactivated', 'Deactivated accounts', deactivated, 'No deactivated accounts')}
    </div>`;
  }

  function renderShelfdFriendsLayout(profiles) {
    const listHtml = buildFriendsListHtml(profiles);
    /* v11.589: search bar → inline friend requests → sort header → friend list.
       The requests container starts hidden; hydrateInlineFriendRequests() fills
       it asynchronously (each request card reads the requester's profile from
       Firestore, so it can't be built synchronously here). */
    grid.innerHTML = `
      <section class="shelfd-friends-vstack" data-shelfd-friends-vstack>
        <label class="shelfd-friends-search-bar" for="shelfd-friends-search-input">
          <svg class="shelfd-friends-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.4"/><path d="M16.2 16.2 21 21"/></svg>
          <input id="shelfd-friends-search-input" class="shelfd-friends-search-input" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search" oninput="filterShelfdFriendsList(this.value)">
        </label>
        <div class="shelfd-friends-requests" data-shelfd-friends-requests hidden></div>
        <div class="shelfd-friends-sort-row">
          <span class="shelfd-friends-sort-label">Sort by <strong data-shelfd-friends-sort-label">Date followed: newest</strong></span>
          <button class="shelfd-friends-sort-btn" type="button" aria-label="Change sort" onclick="cycleShelfdFriendsSort()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="8 4 8 20"/><polyline points="4 8 8 4 12 8"/><polyline points="16 4 16 20"/><polyline points="12 16 16 20 20 16"/></svg>
          </button>
        </div>
        <div class="shelfd-friends-userlist" data-shelfd-friends-list>${listHtml}</div>
      </section>`;
    hydrateInlineFriendRequests();
  }

  if (hasAllCachedProfiles) {
    renderShelfdFriendsLayout(cachedProfiles);
    return;
  }

  grid.innerHTML = '<div class="skeleton-card"></div>';
  try {
    const profiles = await primeFriendProfiles(true);
    const normalizedProfiles = (profiles || [])
      .map((u, index) => u ? { ...u, uid: u.uid || friends[index] } : null)
      .filter(Boolean);
    renderShelfdFriendsLayout(normalizedProfiles);
  } catch(e) {
    grid.innerHTML = '<div class="app-error">Failed to load friends. Try again in a moment.</div>';
    console.error(e);
  }
}

/* v10.222: live search filter for the IG-style friends list. Toggles
   display:none on rows whose handle/name don't match — no full re-render.
   v10.763: query strips a leading '@' so typing "@johndoe" matches the
   same as "johndoe" — what every other social app does. The data-friend-filter
   on each row already includes handle, displayName, AND name fields
   (see buildFriendsListHtml), so searching by either the account name or
   the username works. */
window.filterShelfdFriendsList = function(value = '') {
  const raw = String(value || '').trim();
  const q = raw.replace(/^@+/, '').toLowerCase();
  const rows = document.querySelectorAll('[data-shelfd-friends-list] .shelfd-friend-row');
  rows.forEach(row => {
    if (!q) { row.style.display = ''; return; }
    const filter = String(row.getAttribute('data-friend-filter') || '').toLowerCase();
    row.style.display = filter.includes(q) ? '' : 'none';
  });
};

/* v10.222: cycle sort order for the friends list. Order modes: newest /
   oldest / a–z. The friends array is reordered then re-rendered. */
let shelfdFriendsSortMode = 'newest';
const SHELFD_FRIENDS_SORT_LABELS = {
  newest: 'Date followed: newest',
  oldest: 'Date followed: oldest',
  alpha: 'Alphabetical (A–Z)'
};
window.cycleShelfdFriendsSort = function() {
  shelfdFriendsSortMode = shelfdFriendsSortMode === 'newest'
    ? 'oldest'
    : (shelfdFriendsSortMode === 'oldest' ? 'alpha' : 'newest');
  const label = document.querySelector('[data-shelfd-friends-sort-label]');
  if (label) label.textContent = SHELFD_FRIENDS_SORT_LABELS[shelfdFriendsSortMode] || '';
  const list = document.querySelector('[data-shelfd-friends-list]');
  if (!list) return;
  const rows = Array.from(list.querySelectorAll('.shelfd-friend-row'));
  rows.sort((a, b) => {
    if (shelfdFriendsSortMode === 'alpha') {
      const ha = String(a.querySelector('.shelfd-friend-handle')?.textContent || '').toLowerCase();
      const hb = String(b.querySelector('.shelfd-friend-handle')?.textContent || '').toLowerCase();
      return ha.localeCompare(hb);
    }
    // Prefer the explicit follow timestamp; fall back to friends[] order for
    // accounts created before the timestamp map existed.
    const ua = a.getAttribute('data-friend-uid') || '';
    const ub = b.getAttribute('data-friend-uid') || '';
    const ta = Number(a.getAttribute('data-friend-followed-at-ms') || getFriendFollowedAtMs(ua) || 0);
    const tb = Number(b.getAttribute('data-friend-followed-at-ms') || getFriendFollowedAtMs(ub) || 0);
    return shelfdFriendsSortMode === 'oldest' ? ta - tb : tb - ta;
  });
  rows.forEach(r => list.appendChild(r));
};

/* v10.222: stub category opener — UI rows are rendered to match the
   reference design; full per-category filtering ships in a follow-up. */
window.handleFriendsCategoryOpen = function(key) {
  if (typeof showToast === 'function') showToast('Category coming soon');
};


let peopleSearchGridOverrideId = '';
const FRIEND_HOME_ENTER_TRANSITION_MS = 360;
const FRIEND_PROFILE_LIST_ENTER_TRANSITION_MS = 360;
const FRIEND_PROFILE_LIST_ENTER_FPS = 120;
const FRIEND_LIST_DATA_CACHE_TTL_MS = 2 * 60 * 1000;
let friendHomeTransitionTimer = 0;
let friendHomeExitPromise = null;
let friendHomeExitToken = 0;
/* v11380: monotonically-increasing token for friend-shelf opens. Each
   viewUserList() call and each backToMyList() bumps it; an in-flight
   viewUserList whose token is no longer current aborts before mutating shelf
   state, so a stale friend load can never overwrite my own shelf after I've
   navigated away or opened a different user. */
let friendShelfLoadToken = 0;
const friendListDataCache = {};

function cloneFriendRouteState(state = null) {
  if (!state || typeof state !== 'object') return null;
  return { ...state };
}

function captureCommunityReturnState(source = 'community') {
  return {
    kind: 'community',
    source,
    mainTab: 'community',
    friendsTab: ['friends', 'activity', 'notifications'].includes(activeFriendsTab) ? activeFriendsTab : 'activity',
    requestsSubTab: activeRequestsSubTab === 'friends' ? 'friends' : 'friends',
    activitySubTab: ['feed', 'friendWatch', 'sharedWatch', 'news'].includes(activeActivitySubTab) ? activeActivitySubTab : 'feed',
    messagesSubTab: ['chats', 'requests'].includes(activeMessagesSubTab) ? activeMessagesSubTab : 'chats',
    friendsListMode: document.body.classList.contains('shelfd-friends-list-mode') || activeFriendsTab === 'friends' || activeFriendsTab === 'notifications'
  };
}

function normalizeCommunityReturnState(state = null) {
  const fallback = captureCommunityReturnState();
  const next = cloneFriendRouteState(state) || {};
  return {
    kind: 'community',
    source: next.source || fallback.source,
    mainTab: 'community',
    friendsTab: ['friends', 'activity', 'notifications'].includes(next.friendsTab) ? next.friendsTab : fallback.friendsTab,
    requestsSubTab: next.requestsSubTab === 'friends' ? 'friends' : fallback.requestsSubTab,
    activitySubTab: ['feed', 'friendWatch', 'sharedWatch', 'news'].includes(next.activitySubTab) ? next.activitySubTab : fallback.activitySubTab,
    messagesSubTab: ['chats', 'requests'].includes(next.messagesSubTab) ? next.messagesSubTab : fallback.messagesSubTab,
    friendsListMode: typeof next.friendsListMode === 'boolean' ? next.friendsListMode : fallback.friendsListMode
  };
}

function clearFriendHomeChrome() {
  document.body.classList.remove('viewing-other-user');
  syncViewingUserHeaderBackButton(false);
  /* v10.763: restore the header to the per-tab default (logo or page title)
     now that we're no longer viewing a friend's list. The function reads
     the body class so call AFTER the remove above. */
  if (typeof window.updateMainHeaderPageTitle === 'function') {
    try { window.updateMainHeaderPageTitle(); } catch (e) { /* non-fatal */ }
  }
  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');
  if (addBtn) addBtn.style.display = '';
  if (bannerArea) bannerArea.innerHTML = '';
  clearListSearch();
}

function restoreOwnLibraryFromFriendViewCache() {
  if (isPreviewMode()) {
    const previewOwnData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(DEMO_DATA);
    data = cloneListData(previewOwnData);
    ownDataCache = cloneListData(previewOwnData);
    myData = null;
    return previewOwnData;
  }

  const cachedOwnData = myData
    ? cloneListData(myData)
    : (ownDataCache ? cloneListData(ownDataCache) : cloneListData(data || getEmptyListData()));

  data = cloneListData(cachedOwnData);
  ownDataCache = cloneListData(cachedOwnData);
  myData = null;
  return cachedOwnData;
}

function getCachedFriendListData(uid = '') {
  const key = String(uid || '').trim();
  const entry = key ? friendListDataCache[key] : null;
  if (!entry || !entry.data || Date.now() - Number(entry.at || 0) > FRIEND_LIST_DATA_CACHE_TTL_MS) return null;
  return cloneListData(entry.data);
}

function setCachedFriendListData(uid = '', listData = null) {
  const key = String(uid || '').trim();
  if (!key || !listData) return null;
  const safeData = cloneListData(listData);
  friendListDataCache[key] = { data: safeData, at: Date.now() };
  return safeData;
}

async function restoreOwnLibraryAfterFriendView(previousFriendData = null) {
  if (isPreviewMode()) {
    const previewOwnData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(DEMO_DATA);
    data = cloneListData(previewOwnData);
    ownDataCache = cloneListData(previewOwnData);
    myData = null;
    return previewOwnData;
  }

  let freshOwnData = await loadOwnDataFromFirestore();
  if (previousFriendData && isSameListData(freshOwnData, previousFriendData)) {
    const backup = readOwnLocalBackup(previousFriendData);
    if (backup) {
      freshOwnData = await writeOwnDataDirect(backup);
      showToast("Restored your library");
    }
  }
  freshOwnData = await autoSortAnimeBuckets(freshOwnData, true);
  data = cloneListData(freshOwnData);
  ownDataCache = cloneListData(freshOwnData);
  myData = null;
  if (currentUser) {
    localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(freshOwnData));
  }
  return freshOwnData;
}

async function restoreCommunityReturnState(state = null) {
  const nextState = normalizeCommunityReturnState(state);
  activeFriendsTab = nextState.friendsTab;
  activeRequestsSubTab = nextState.requestsSubTab;
  activeActivitySubTab = nextState.activitySubTab;
  activeMessagesSubTab = nextState.messagesSubTab;
  document.body.classList.toggle('shelfd-friends-list-mode', nextState.friendsListMode || nextState.friendsTab === 'friends' || nextState.friendsTab === 'notifications');
  setBottomNavVisibility(true);
  syncMainNavButtons('community');
  setMainNavVisibility('community');
  await loadCommunity(false);
  if (nextState.friendsTab === 'activity') {
    loadFriendActivity();
  }
  persistUiState();
  return nextState;
}

function showImmediateCommunityReturnState(state = null) {
  const nextState = normalizeCommunityReturnState(state);
  activeFriendsTab = nextState.friendsTab;
  activeRequestsSubTab = nextState.requestsSubTab;
  activeActivitySubTab = nextState.activitySubTab;
  activeMessagesSubTab = nextState.messagesSubTab;
  document.body.classList.toggle('shelfd-friends-list-mode', nextState.friendsListMode || nextState.friendsTab === 'friends' || nextState.friendsTab === 'notifications');
  setBottomNavVisibility(true);
  syncMainNavButtons('community');
  setMainNavVisibility('community');
  switchFriendsTab(nextState.friendsTab);
  return nextState;
}

window.captureCommunityReturnState = captureCommunityReturnState;
window.restoreCommunityReturnState = restoreCommunityReturnState;

function getPeopleSearchGrid() {
  const override = String(peopleSearchGridOverrideId || '').trim();
  if (override) {
    const customGrid = document.getElementById(override);
    if (customGrid) return customGrid;
  }
  return null;
}

function resetInlineFriendSearch() {
  const input = document.getElementById('friends-inline-search-input');
  const resultsGrid = document.getElementById('inline-friend-search-grid');
  const friendsGrid = document.getElementById('friends-grid');
  peopleSearchGridOverrideId = '';
  if (input && !input.value.trim()) {
    if (resultsGrid) {
      resultsGrid.style.display = 'none';
      resultsGrid.innerHTML = '';
    }
    if (friendsGrid) friendsGrid.style.display = '';
  }
}

function filterInlineFriendSearch(query = '') {
  const q = String(query || '').trim();
  const resultsGrid = document.getElementById('inline-friend-search-grid');
  if (!resultsGrid) return;
  const friendsGrid = document.getElementById('friends-grid');

  if (!q) {
    clearTimeout(filterInlineFriendSearch._timer);
    /* v810: in the Add a Friend tab, an empty search field shows the
       creator account as the default suggestion. */
    if (activeFriendsTab === 'add-friend') {
      openAddFriendDefault();
      return;
    }
    peopleSearchGridOverrideId = '';
    resultsGrid.style.display = 'none';
    resultsGrid.innerHTML = '';
    if (friendsGrid) friendsGrid.style.display = '';
    return;
  }

  peopleSearchGridOverrideId = 'inline-friend-search-grid';
  resultsGrid.style.display = 'grid';
  /* The friends-grid only lives inside #friends-list-view now (search was
     moved into #add-friend-view); only hide it if it actually exists in
     the current view to avoid touching unrelated state. */
  if (friendsGrid && activeFriendsTab !== 'add-friend') friendsGrid.style.display = 'none';
  clearTimeout(filterInlineFriendSearch._timer);
  filterInlineFriendSearch._timer = setTimeout(() => {
    searchUsersByUsername(q);
  }, 180);
}

async function initFindPeopleSearchView() {
  const grid = getPeopleSearchGrid();
  if (!grid) return;
  if (isPreviewMode()) {
    grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">Search</div>
      <p style="color:#7a6f99;font-size:14px;">Search preview community members</p>
      <p class="friends-empty-sub">Type 1 or more characters to explore demo profiles. Friend actions stay preview-only.</p>
    </div>`;
    return;
  }
  grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
    <div class="friends-empty-icon">Search</div>
    <p style="color:#7a6f99;font-size:14px;">Search for friends</p>
    <p class="friends-empty-sub">Type 1 character or more and matching users will appear automatically.</p>
  </div>`;
  const creatorUser = await loadCreatorSearchUser();
  if (!creatorUser || creatorUser.uid === currentUser?.uid) {
    grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">Search</div>
      <p style="color:#7a6f99;font-size:14px;">Search for friends</p>
      <p class="friends-empty-sub">Type 1 character or more and matching users will appear automatically.</p>
    </div>`;
    return;
  }
  allUsersCache = [creatorUser];
  renderAllUsers([creatorUser]);
}

function getUserSearchNameValues(user = {}) {
  return [
    user.name,
    user.displayName,
    user.customName,
    user.username,
    user.handle,
    user.nameLower,
    user.displayNameLower,
    user.customNameLower,
    user.usernameLower,
    /* v923: fields actually written by the signup flow */
    user.usernameHandle,
    user.usernameHandleLower,
    /* v923: email search */
    user.emailLower,
    user.accountEmailLower
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function userMatchesPeopleSearch(user = {}, normalized = '') {
  if (!normalized) return false;
  return getUserSearchNameValues(user).some(value => value.includes(normalized));
}

function rankPeopleSearchResult(user = {}, normalized = '') {
  const names = getUserSearchNameValues(user);
  if (names.some(value => value === normalized)) return 0;
  if (names.some(value => value.startsWith(normalized))) return 1;
  if (names.some(value => value.split(/\s+/).some(part => part.startsWith(normalized)))) return 2;
  return 3;
}

async function searchUsersByUsername(query) {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) {
    allUsersCache = [];
    initFindPeopleSearchView();
    return;
  }

  const grid = getPeopleSearchGrid();
  if (!grid) return;
  if (isPreviewMode()) {
    const previewMatches = PREVIEW_COMMUNITY_USERS.filter(user => userMatchesPeopleSearch(user, normalized));
    allUsersCache = previewMatches.slice();
    renderAllUsers(previewMatches, query);
    return;
  }
  grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
    <div class="friends-empty-icon">Search</div>
    <p style="color:#7a6f99;font-size:14px;">Searching...</p>
    <p class="friends-empty-sub">Looking for users matching "${escHtml(query)}".</p>
  </div>`;

  try {
    const results = new Map();
    const addUserDoc = (doc) => {
      const raw = doc.data() || {};
      const uid = String(raw.uid || doc.id || '').trim();
      if (!uid || uid === currentUser?.uid) return;
      const user = { ...raw, uid };
      /* v924: removed `if (user.isPublic === false) return` — saveUserProfile
         was writing isPublic:false for every non-creator on every login so
         ALL regular users were invisible to search. isPublic is now true for
         everyone; actual profile privacy uses profileVisibility settings. */
      if (!userMatchesPeopleSearch(user, normalized)) return;
      results.set(uid, user);
      usersMap[uid] = user;
    };

    /* v923: added usernameHandleLower (the actual field written by the
       signup flow — the old 'usernameLower' key was never stored),
       plus emailLower and accountEmailLower so users can be found
       by the email address attached to their account. */
    const queryFields = [
      'nameLower',
      'displayNameLower',
      'customNameLower',
      'usernameLower',
      'usernameHandleLower',
      'emailLower',
      'accountEmailLower'
    ];
    await Promise.all(queryFields.map(async field => {
      try {
        const snap = await db.collection('users')
          .where(field, '>=', normalized)
          .where(field, '<=', normalized + '\uf8ff')
          .limit(20)
          .get();
        snap.forEach(addUserDoc);
      } catch (fieldError) {
        // Some older profiles may not have this field indexed. The fallback scan below catches them.
      }
    }));

    if (normalized.length === 1 || results.size < 8) {
      const fallbackSnap = await db.collection('users').limit(150).get();
      fallbackSnap.forEach(addUserDoc);
    }

    allUsersCache = [...results.values()].sort((a, b) => {
      const rankDiff = rankPeopleSearchResult(a, normalized) - rankPeopleSearchResult(b, normalized);
      if (rankDiff) return rankDiff;
      return getDisplayName(a, '').localeCompare(getDisplayName(b, ''));
    }).slice(0, 30);

    renderAllUsers(allUsersCache, query);
  } catch (e) {
    console.error("Failed to search users:", e);
    grid.innerHTML = '<div class="friends-empty" style="grid-column:1/-1;"><div class="friends-empty-icon">Error</div><p>Could not search users</p><p class="friends-empty-sub">Try again in a moment.</p></div>';
  }
}

function renderAllUsers(users, query = '') {
  const grid = getPeopleSearchGrid();
  if (!grid) return;
  if (isPreviewMode()) {
    if (!users || users.length === 0) {
      grid.innerHTML = `<div class="friends-empty no-search-icon" style="grid-column:1/-1;">
        <p>No preview users found for "${escHtml((query || '').trim())}"</p>
        <p class="friends-empty-sub">Try a different name or sign in to search the live community.</p>
      </div>`;
      return;
    }
    grid.innerHTML = users.map(user => `
      <div class="user-card" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer;" onclick="openPreviewCommunityProfile('${user.uid}')">
          <img class="user-card-avatar" src="${user.photo}" alt="">
          <div style="min-width:0;">
            <div class="user-card-name">${renderDisplayNameHTML(user, 'Preview User')}</div>
            <div class="user-card-stats">${escHtml(user.findStats || user.stats || 'Preview profile')}</div>
          </div>
        </div>
        <div class="friend-actions-group">
          <button class="friend-action-btn friend-profile-btn" type="button" onclick="event.stopPropagation(); openPreviewUserProfile('${user.uid}')">Profile</button>
          <button class="friend-action-btn friend-pending-btn" type="button" disabled>Preview</button>
        </div>
      </div>
    `).join('');
    return;
  }
  const safeQuery = escHtml((query || '').trim());
  if (false && (!users || users.length === 0)) {
    grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">Search</div>
      <p>${safeQuery ? `No user found for "${safeQuery}"` : 'Search by username'}</p>
      <p class="friends-empty-sub">${safeQuery ? 'Try a different spelling or a shorter username.' : 'People only appear here after you search for a username.'}</p>
    </div>`;
    return;
  }

  if (!users || users.length === 0) {
    grid.innerHTML = '<div class="friends-empty no-search-icon" style="grid-column:1/-1;"><p>No other users found</p><p class="friends-empty-sub">Try a different name or spelling.</p></div>';
    return;
  }

  let html = '';
  users.forEach(u => {
    const isFriend = friends.includes(u.uid);
    const sentRequest = outgoingRequests.includes(u.uid);
    const receivedRequest = incomingRequests.includes(u.uid);
    const isPublicCreator = shouldExposeInUserSearch(u);
    const avatar = u.photo || ('/default-avatar.svg#' + encodeURIComponent(u.name || '?') + '&background=1e2028&color=60a5fa');

    let action = '';
    if (isFriend) {
      action = `<div class="friend-actions-group"><button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button><button class="friend-action-btn friend-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button><button class="friend-action-btn friend-remove-btn" onclick="event.stopPropagation(); removeFriend('${u.uid}')">Remove</button></div>`;
    } else if (sentRequest) {
      action = isPublicCreator
        ? `<div class="friend-actions-group"><button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button><button class="friend-action-btn friend-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button><button class="friend-action-btn friend-pending-btn" onclick="event.stopPropagation(); cancelFriendRequest('${u.uid}')" title="Tap to cancel">Requested</button></div>`
        : `<button class="friend-action-btn friend-pending-btn" onclick="event.stopPropagation(); cancelFriendRequest('${u.uid}')" title="Tap to cancel">Requested</button>`;
    } else if (receivedRequest) {
      action = isPublicCreator
        ? `<div class="friend-actions-group"><button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button><button class="friend-action-btn friend-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button><button class="friend-action-btn friend-accept-btn" onclick="event.stopPropagation(); acceptFriendRequest('${u.uid}')">Accept</button></div>`
        : `<button class="friend-action-btn friend-accept-btn" onclick="event.stopPropagation(); acceptFriendRequest('${u.uid}')">Accept</button>`;
    } else {
      action = isPublicCreator
        ? `<div class="friend-actions-group"><button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button><button class="friend-action-btn friend-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button><button class="friend-action-btn friend-add-btn" onclick="event.stopPropagation(); sendFriendRequest('${u.uid}')">+ Add</button></div>`
        : `<button class="friend-action-btn friend-add-btn" onclick="event.stopPropagation(); sendFriendRequest('${u.uid}')">+ Add</button>`;
    }

      html += `
        <div class="user-card${(!isFriend && !isCreatorAdmin(u)) ? ' locked' : ''}" style="justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer;" onclick="${isPublicCreator ? `openUserProfile('${u.uid}')` : `viewUserFromMap('${u.uid}')`}">
            <img class="user-card-avatar" src="${avatar}" alt="">
            <div style="min-width:0;">
              <div class="user-card-name">${renderDisplayNameHTML(u, 'Unknown User')}</div>
              <div class="user-card-stats">${isFriend ? 'Tap to view full shelf' : (isPublicCreator ? 'Public creator profile · add to connect' : 'Add to connect and view full shelf')}</div>
            </div>
        </div>
        ${action}
      </div>`;
  });

  grid.innerHTML = html;
}

function viewUserFromMap(uid) {
  if (isPreviewMode()) {
    openPreviewCommunityProfile(uid);
    return;
  }
  if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing() && uid === CREATOR_PUBLIC_UID) {
    if (typeof openGuestCreatorListsView === 'function') openGuestCreatorListsView({ returnTab: 'community' });
    return;
  }
  const u = usersMap[uid];
  if (!u) {
    showToast("Could not open that profile");
    return;
  }
  if (shouldExposeInUserSearch(u) && !friends.includes(uid)) {
    openUserProfile(uid, u.name, u.photo || '');
    return;
  }
  viewUserList(uid, u.name, u.photo || '');
}

function showPrivateModal() {
  const modal = document.getElementById('private-modal');
  if (modal) modal.style.display = 'flex';
}
function closePrivateModal() {
  const modal = document.getElementById('private-modal');
  if (modal) modal.style.display = 'none';
}

function openSignOutModal() {
  const modal = document.getElementById('signout-modal');
  if (modal) modal.style.display = 'flex';
}

function closeSignOutModal() {
  const modal = document.getElementById('signout-modal');
  if (modal) modal.style.display = 'none';
}

// Re-run the current search (used after add/remove actions to refresh button states)
function refilterPeople() {
  const inlineInput = document.getElementById('friends-inline-search-input');
  const inlineGrid = document.getElementById('inline-friend-search-grid');
  if (inlineInput && inlineGrid && inlineGrid.style.display !== 'none') {
    filterInlineFriendSearch(inlineInput.value || '');
  }
}

function updateFriendsCountBadge() {
  const badge = document.getElementById('friends-count-badge');
  if (badge) badge.textContent = friends.length ? '(' + friends.length + ')' : '';
}

// Send a friend request (one-sided until accepted)
async function sendFriendRequest(uid) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (!currentUser || uid === currentUser.uid) return;
  /* v811: creator account is public — tapping +Add bypasses the pending
     state and immediately marks the friendship as active so the user can
     view the creator's profile and lists right away. Hard-scoped to
     CREATOR_PUBLIC_UID; no other accounts get this auto-accept path. */
  if (uid === CREATOR_PUBLIC_UID) return autoAddCreatorFriend();
  if (friends.includes(uid) || outgoingRequests.includes(uid)) return;
  if (incomingRequests.includes(uid)) { acceptFriendRequest(uid); return; }
  const rawBefore = captureOwnFriendRawState();
  const prev = captureFriendsCommitSnapshot();
  ownOutgoingFriendRequestIds = normalizeFriendUidList([...ownOutgoingFriendRequestIds, uid]);
  ownRejectedFriendRequestIds = ownRejectedFriendRequestIds.filter(id => id !== uid);
  ownRemovedFriendIds = ownRemovedFriendIds.filter(id => id !== uid);
  commitFriendsDataState(prev, { silent: true, skipSelfRepair: true });
  allUsersCache = [];
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await db.collection("users").doc(currentUser.uid).set({
      outgoingRequests: arrayUnion(uid),
      rejectedFriendRequests: arrayRemove(uid),
      removedFriends: arrayRemove(uid)
    }, { merge: true });
  } catch(e) {
    console.error("sendFriendRequest failed:", e);
    const rollback = captureFriendsCommitSnapshot();
    restoreOwnFriendRawState(rawBefore);
    commitFriendsDataState(rollback, { silent: true, skipSelfRepair: true });
    showToast("Couldn't send that friend request. Try again.");
    return;
  }
  /* v10.145: live notification trigger — recipient gets a notification
     the moment the friend request lands. Deterministic doc ID
     `friend_request:{actorUid}` so re-sending after a reject/remove
     overwrites the same doc instead of creating a duplicate. Fire-and-
     forget; failures are logged inside createActivityNotification but
     don't roll back the request itself. */
  if (typeof createActivityNotification === 'function') {
    try {
      createActivityNotification({
        recipientUid: uid,
        actorUid: currentUser.uid,
        type: 'friend_request',
        targetActivityId: `friend_request:${currentUser.uid}`,
        targetKind: 'friend_request',
        createdAtMs: Date.now()
      });
    } catch (notifError) { console.warn('Friend request notification failed:', notifError); }
  }
  refilterPeople();
  refreshProfileSocialModal();
  /* v11437: no success toast — the Follow → Pending button state change is the
     visual confirmation. (Error toasts above are kept for failures.) */
}

/* v811: One-sided auto-friend for the creator account.
   Only writes to the CURRENT USER's own users/{uid} doc (allowed by the
   existing rule `allow write: if isSignedIn() && request.auth.uid == uid`).
   We do NOT write to /users/CREATOR_UID — that would be a cross-user
   write and Firestore rules block it. The creator's data is already
   publicly readable per the existing rule
     `allow read: if isSignedIn() || isCreatorPreviewUid(uid)`
   so adding the creator's UID to our own `friends` array is enough to:
     • have the Friends tab list the creator
     • unlock "Tap to view full shelf" and the creator's profile/lists
     • flip the +Add button into the Message/Profile/Remove friend state
   The creator's friends array intentionally won't include this user —
   that's fine for the use case (one-sided "follow the creator"). */
async function autoAddCreatorFriend() {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (!currentUser) return;
  if (currentUser.uid === CREATOR_PUBLIC_UID) return;
  if (friends.includes(CREATOR_PUBLIC_UID)) return; // idempotent — already a friend
  /* Optimistic local update */
  const rawBefore = captureOwnFriendRawState();
  const prev = captureFriendsCommitSnapshot();
  const followedAtMs = Date.now();
  ownFriendIds = normalizeFriendUidList([...ownFriendIds, CREATOR_PUBLIC_UID]);
  ownFriendFollowedAtMs[CREATOR_PUBLIC_UID] = followedAtMs;
  ownOutgoingFriendRequestIds = ownOutgoingFriendRequestIds.filter(id => id !== CREATOR_PUBLIC_UID);
  ownRejectedFriendRequestIds = ownRejectedFriendRequestIds.filter(id => id !== CREATOR_PUBLIC_UID);
  ownRemovedFriendIds = ownRemovedFriendIds.filter(id => id !== CREATOR_PUBLIC_UID);
  commitFriendsDataState(prev, { silent: true, skipSelfRepair: true });
  allUsersCache = [];
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await db.collection("users").doc(currentUser.uid).set({
      friends: arrayUnion(CREATOR_PUBLIC_UID),
      [`friendFollowedAtMs.${CREATOR_PUBLIC_UID}`]: followedAtMs,
      outgoingRequests: arrayRemove(CREATOR_PUBLIC_UID),
      rejectedFriendRequests: arrayRemove(CREATOR_PUBLIC_UID),
      removedFriends: arrayRemove(CREATOR_PUBLIC_UID)
    }, { merge: true });
  } catch (e) {
    console.error('[shelfd-friends] autoAddCreatorFriend failed:', e);
    /* Roll back local state */
    const rollback = captureFriendsCommitSnapshot();
    restoreOwnFriendRawState(rawBefore);
    commitFriendsDataState(rollback, { silent: true, skipSelfRepair: true });
    showToast("Couldn't add the creator. Try again.");
    refilterPeople();
    return;
  }
  /* Creator auto-add bypasses the normal pending request flow, so create a
     creator-side notification here. Reuses the existing friend_request type
     to avoid Firestore rules changes, while targetKind lets notification
     copy distinguish this from a normal pending request. */
  if (typeof createActivityNotification === 'function') {
    try {
      createActivityNotification({
        recipientUid: CREATOR_PUBLIC_UID,
        actorUid: currentUser.uid,
        type: 'friend_request',
        targetActivityId: `creator_auto_add:${currentUser.uid}`,
        targetKind: 'creator_auto_add',
        createdAtMs: Date.now()
      });
    } catch (notifError) { console.warn('Creator auto-add notification failed:', notifError); }
  }
  updateFriendsCountBadge();
  refilterPeople();
  refreshProfileSocialModal();
  if (activeFriendsTab === 'friends') renderFriendsList();
  showToast("Added — you can now view King Kooom's shelf.");
}

// Cancel a request I sent
async function cancelFriendRequest(uid) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const rawBefore = captureOwnFriendRawState();
  const prev = captureFriendsCommitSnapshot();
  ownOutgoingFriendRequestIds = ownOutgoingFriendRequestIds.filter(id => id !== uid);
  commitFriendsDataState(prev, { silent: true, skipSelfRepair: true });
  allUsersCache = [];
  try {
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await db.collection("users").doc(currentUser.uid).set({ outgoingRequests: arrayRemove(uid) }, { merge: true });
  } catch(e) {
    console.error("cancelFriendRequest failed:", e);
    const rollback = captureFriendsCommitSnapshot();
    restoreOwnFriendRawState(rawBefore);
    commitFriendsDataState(rollback, { silent: true, skipSelfRepair: true });
    showToast("Couldn't cancel that request. Try again.");
    return;
  }
  if (activeFriendsTab === 'requests') renderRequestsList();
  refilterPeople();
  refreshProfileSocialModal();
  /* v11437: no success toast — the Pending → Follow button state change is the
     visual confirmation. */
}

// Accept a request someone sent me — both become friends
async function acceptFriendRequest(uid) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const rawBefore = captureOwnFriendRawState();
  const prev = captureFriendsCommitSnapshot();
  const followedAtMs = Date.now();
  ownFriendIds = normalizeFriendUidList([...ownFriendIds, uid]);
  ownFriendFollowedAtMs[uid] = followedAtMs;
  ownRejectedFriendRequestIds = ownRejectedFriendRequestIds.filter(id => id !== uid);
  ownRemovedFriendIds = ownRemovedFriendIds.filter(id => id !== uid);
  ownOutgoingFriendRequestIds = ownOutgoingFriendRequestIds.filter(id => id !== uid);
  commitFriendsDataState(prev, { silent: true, skipSelfRepair: true });
  allUsersCache = [];
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await db.collection("users").doc(currentUser.uid).set({
      friends: arrayUnion(uid),
      [`friendFollowedAtMs.${uid}`]: followedAtMs,
      outgoingRequests: arrayRemove(uid),
      rejectedFriendRequests: arrayRemove(uid),
      removedFriends: arrayRemove(uid)
    }, { merge: true });
  } catch(e) {
    console.error("acceptFriendRequest failed:", e);
    const rollback = captureFriendsCommitSnapshot();
    restoreOwnFriendRawState(rawBefore);
    commitFriendsDataState(rollback, { silent: true, skipSelfRepair: true });
    showToast("Couldn't accept that request. Try again.");
    return;
  }
  /* v10.145: live notification trigger — original requester gets a
     notification the moment we accept. Deterministic doc ID
     `friend_accept:{actorUid}` (actorUid = our uid here since we're
     the acceptor) so repeated accept/remove/re-accept cycles keep
     overwriting the same doc instead of stacking. */
  if (typeof createActivityNotification === 'function') {
    try {
      createActivityNotification({
        recipientUid: uid,
        actorUid: currentUser.uid,
        type: 'friend_accept',
        targetActivityId: `friend_accept:${currentUser.uid}`,
        targetKind: 'friend_request',
        createdAtMs: Date.now()
      });
    } catch (notifError) { console.warn('Friend accept notification failed:', notifError); }
  }
  updateRequestsBadges();
  updateFriendsCountBadge();
  if (activeFriendsTab === 'requests') renderRequestsList();
  if (activeFriendsTab === 'friends') renderFriendsList();
  refilterPeople();
  refreshProfileSocialModal();
  /* v11437: no success toast — the Follow Back → Following button state change
     is the visual confirmation. */
}

// Decline a request someone sent me
async function rejectFriendRequest(uid) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const rawBefore = captureOwnFriendRawState();
  const prev = captureFriendsCommitSnapshot();
  ownRejectedFriendRequestIds = normalizeFriendUidList([...ownRejectedFriendRequestIds, uid]);
  ownFriendIds = ownFriendIds.filter(id => id !== uid);
  delete ownFriendFollowedAtMs[uid];
  ownOutgoingFriendRequestIds = ownOutgoingFriendRequestIds.filter(id => id !== uid);
  commitFriendsDataState(prev, { silent: true, skipSelfRepair: true });
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await db.collection("users").doc(currentUser.uid).set({
      rejectedFriendRequests: arrayUnion(uid),
      friends: arrayRemove(uid),
      [`friendFollowedAtMs.${uid}`]: firebase.firestore.FieldValue.delete(),
      outgoingRequests: arrayRemove(uid)
    }, { merge: true });
  } catch(e) {
    console.error("rejectFriendRequest failed:", e);
    const rollback = captureFriendsCommitSnapshot();
    restoreOwnFriendRawState(rawBefore);
    commitFriendsDataState(rollback, { silent: true, skipSelfRepair: true });
    showToast("Couldn't decline that request. Try again.");
    return;
  }
  updateRequestsBadges();
  if (activeFriendsTab === 'requests') renderRequestsList();
  refreshProfileSocialModal();
  showToast("Request declined");
}

function confirmRemoveFriend(uid, name) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const existing = document.getElementById('remove-friend-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'remove-friend-modal';
  modal.className = 'plm-overlay';
  modal.innerHTML = `
    <div class="plm-sheet">
      <div class="plm-header">
        <span class="plm-title">Remove Friend</span>
        <button class="plm-close" onclick="closeRemoveFriendModal()">✕</button>
      </div>
      <p style="color:#a9a0c6;font-size:13px;line-height:1.5;">Remove <strong style="color:#f7f3ff;">${escHtml(name)}</strong> from your friends? They won't be notified.</p>
      <div class="plm-actions">
        <button class="plm-remove-btn" style="flex:1;" onclick="removeFriend('${escAttr(uid)}'); closeRemoveFriendModal();">Remove</button>
        <button class="plm-save-btn" onclick="closeRemoveFriendModal()">Cancel</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) closeRemoveFriendModal(); });
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('plm-open'));
}

function closeRemoveFriendModal() {
  const modal = document.getElementById('remove-friend-modal');
  if (!modal) return;
  modal.classList.remove('plm-open');
  setTimeout(() => modal.remove(), 230);
}

// Remove a confirmed friend (mutual)
async function removeFriend(uid) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  const rawBefore = captureOwnFriendRawState();
  const prev = captureFriendsCommitSnapshot();
  ownFriendIds = ownFriendIds.filter(id => id !== uid);
  delete ownFriendFollowedAtMs[uid];
  ownOutgoingFriendRequestIds = ownOutgoingFriendRequestIds.filter(id => id !== uid);
  ownRemovedFriendIds = normalizeFriendUidList([...ownRemovedFriendIds, uid]);
  ownRejectedFriendRequestIds = ownRejectedFriendRequestIds.filter(id => id !== uid);
  commitFriendsDataState(prev, { silent: true, skipSelfRepair: true });
  allUsersCache = [];
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await db.collection("users").doc(currentUser.uid).set({
      friends: arrayRemove(uid),
      [`friendFollowedAtMs.${uid}`]: firebase.firestore.FieldValue.delete(),
      outgoingRequests: arrayRemove(uid),
      removedFriends: arrayUnion(uid),
      rejectedFriendRequests: arrayRemove(uid)
    }, { merge: true });
  } catch(e) {
    console.error("removeFriend failed:", e);
    const rollback = captureFriendsCommitSnapshot();
    restoreOwnFriendRawState(rawBefore);
    commitFriendsDataState(rollback, { silent: true, skipSelfRepair: true });
    showToast("Couldn't remove that friend. Try again.");
    return;
  }
  updateFriendsCountBadge();
  if (activeFriendsTab === 'friends') renderFriendsList();
  refilterPeople();
  refreshProfileSocialModal();
  /* v11437: no success toast — the Following → Follow button state change is the
     visual confirmation. */
}

/* v11344: Follow / Follow Back button shown on the friend-list viewing banner.
   States:
     • none           → "Follow"       (sendFriendRequest)
     • they added you → "Follow Back"   (acceptFriendRequest → instant mutual)
     • you requested  → "Requested"     (cancelFriendRequest, tap to cancel)
     • mutual         → "Following"     (removeFriend, tap to unfollow)
   Reuses the existing friends / incomingRequests / outgoingRequests globals so
   it always reflects the live relationship state. */
/* "They added/follow me" signal. `incomingRequests` is the filtered view;
   `incomingFriendRequestSourceUids` is the raw derived-query result (every user
   who has me in their outgoingRequests). Check both so "Follow Back" shows
   whenever someone follows me and we aren't already mutually following. */
function friendListUserFollowsMe(u) {
  if (incomingRequests.includes(u)) return true;
  if (typeof incomingFriendRequestSourceUids !== 'undefined'
      && Array.isArray(incomingFriendRequestSourceUids)
      && incomingFriendRequestSourceUids.includes(u)) return true;
  return false;
}

function getFriendListFollowButtonHTML(uid) {
  const u = String(uid || '').trim();
  if (!currentUser || !u || u === currentUser.uid) return '';
  if (typeof isPreviewMode === 'function' && isPreviewMode()) return '';
  if (friends.includes(u)) {
    return `<button type="button" class="friend-list-follow-btn is-following" onclick="toggleFriendListFollow('${escAttr(u)}')">Following</button>`;
  }
  /* If they already follow me, it's always a "Follow Back" — even if I also
     have a pending outgoing request to them. */
  if (friendListUserFollowsMe(u)) {
    return `<button type="button" class="friend-list-follow-btn is-followback" onclick="toggleFriendListFollow('${escAttr(u)}')">Follow Back</button>`;
  }
  if (outgoingRequests.includes(u)) {
    return `<button type="button" class="friend-list-follow-btn is-requested" onclick="toggleFriendListFollow('${escAttr(u)}')">Pending</button>`;
  }
  return `<button type="button" class="friend-list-follow-btn is-follow" onclick="toggleFriendListFollow('${escAttr(u)}')">Follow</button>`;
}

async function toggleFriendListFollow(uid) {
  const u = String(uid || '').trim();
  if (!u) return;
  /* v11376: on the shelf/profile banner, tapping "Following" must NOT instantly
     unfollow — it opens an Instagram-style confirm sheet whose only action is
     Unfollow. (The mutual/followers/following list rows still instant-unfollow;
     that path lives in 15-profile-settings.js and is unchanged.) */
  if (friends.includes(u)) {
    showFriendListUnfollowSheet(u);
    return;
  }
  /* v11435: paint the button INSTANTLY from the synchronously-updated globals,
     then reconcile after the write resolves. Previously this awaited the full
     network round-trip before repainting, so Follow/Pending felt unresponsive.
     A shared busy-set guards against double-taps / rapid race conditions. */
  const busy = (typeof shelfdFollowBusySet === 'function') ? shelfdFollowBusySet() : null;
  if (busy) { if (busy.has(u)) return; busy.add(u); }
  let action = null;
  if (friendListUserFollowsMe(u)) action = (typeof acceptFriendRequest === 'function') ? acceptFriendRequest : null; // Follow Back → instant mutual
  else if (outgoingRequests.includes(u)) action = (typeof cancelFriendRequest === 'function') ? cancelFriendRequest : null;
  else action = (typeof sendFriendRequest === 'function') ? sendFriendRequest : null;
  let p = Promise.resolve();
  try { if (action) p = action(u) || Promise.resolve(); } catch (e) { p = Promise.reject(e); }
  if (typeof syncFollowButtonsForUid === 'function') syncFollowButtonsForUid(u);
  else refreshFriendListFollowButton(u);
  try { await p; } catch (e) { console.warn('toggleFriendListFollow failed:', e); }
  if (busy) busy.delete(u);
  if (typeof syncFollowButtonsForUid === 'function') syncFollowButtonsForUid(u);
  else refreshFriendListFollowButton(u);
}

function refreshFriendListFollowButton(uid) {
  const u = String(uid || '').trim();
  if (!viewingUser || String(viewingUser.uid) !== u) return;
  const slot = document.querySelector('.friend-list-viewing-banner .friend-list-follow-slot');
  if (slot) slot.innerHTML = getFriendListFollowButtonHTML(u);
}

/* v11376: Instagram-style unfollow confirm sheet for the shelf/profile banner's
   Following button. Slides up with the target's @handle + a single Unfollow
   action; tap the backdrop to dismiss without unfollowing. */
function getFollowSheetTargetName(uid) {
  const u = String(uid || '').trim();
  const src = (viewingUser && String(viewingUser.uid) === u) ? viewingUser : (usersMap[u] || {});
  const handle = String(
    src.usernameHandle || src.userHandle || src.handle || src.username
    || src.usernameHandleLower || src.handleLower || src.usernameLower
    || src.profileData?.usernameHandle || src.profileData?.userHandle
    || src.profileData?.handle || src.profileData?.username || ''
  ).trim().replace(/^@+/, '');
  if (handle) return '@' + handle;
  return String(src.customName || src.displayName || src.name || 'this user').trim() || 'this user';
}

function closeFriendListUnfollowSheet() {
  const sheet = document.getElementById('friend-unfollow-sheet');
  if (!sheet) return;
  sheet.classList.remove('is-open');
  window.setTimeout(() => { if (sheet.isConnected) sheet.remove(); }, 260);
}

function showFriendListUnfollowSheet(uid) {
  const u = String(uid || '').trim();
  if (!u) return;
  const existing = document.getElementById('friend-unfollow-sheet');
  if (existing) existing.remove();
  const name = escHtml(getFollowSheetTargetName(u));
  const sheet = document.createElement('div');
  sheet.id = 'friend-unfollow-sheet';
  sheet.className = 'friend-unfollow-sheet-overlay';
  sheet.setAttribute('role', 'dialog');
  sheet.innerHTML = `
    <div class="friend-unfollow-sheet">
      <div class="friend-unfollow-sheet-grip" aria-hidden="true"></div>
      <div class="friend-unfollow-sheet-title">${name}</div>
      <button type="button" class="friend-unfollow-sheet-action" onclick="confirmFriendListUnfollow('${escAttr(u)}')">Unfollow</button>
    </div>`;
  sheet.addEventListener('click', e => { if (e.target === sheet) closeFriendListUnfollowSheet(); });
  document.body.appendChild(sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
}

async function confirmFriendListUnfollow(uid) {
  const u = String(uid || '').trim();
  closeFriendListUnfollowSheet();
  if (!u) return;
  /* v11435: instant repaint (removeFriend updates the globals synchronously),
     then reconcile, mirroring the rest of the follow flow. */
  let p = Promise.resolve();
  try { if (typeof removeFriend === 'function') p = removeFriend(u) || Promise.resolve(); } catch (e) { p = Promise.reject(e); }
  if (typeof syncFollowButtonsForUid === 'function') syncFollowButtonsForUid(u);
  else refreshFriendListFollowButton(u);
  try { await p; } catch (e) { console.warn('confirmFriendListUnfollow failed:', e); }
  if (typeof syncFollowButtonsForUid === 'function') syncFollowButtonsForUid(u);
  else refreshFriendListFollowButton(u);
}

// View another user's list — open to everyone (v11344; was mutual-friends only)
async function viewUserList(uid, name, photo, options = {}) {
  if (isPreviewMode()) {
    openPreviewCommunityProfile(uid);
    return;
  }
  if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing()) {
    if (uid === CREATOR_PUBLIC_UID && typeof openGuestCreatorListsView === 'function') {
      await openGuestCreatorListsView({ returnTab: getActiveMainTab ? getActiveMainTab() : 'community' });
      return;
    }
    if (typeof openShelfdGuestAuthModal === 'function') openShelfdGuestAuthModal();
    return;
  }
  if (currentUser && uid === currentUser.uid) {
    switchMainNav('mylist');
    return;
  }
  const sourceUser = { ...(usersMap[uid] || {}), uid, name, photo };
  /* v11380: claim this open. If the owner changes (back out / open another user)
     before the async reads below resolve, the token won't match and we abort. */
  const loadToken = ++friendShelfLoadToken;
  /* v11344: private-profile gate removed — every signed-in user can view any
     user's lists (Firestore rules already allow reading any users/{uid} +
     watchlist/{uid} doc). Tapping an "added you" notification now opens the
     actor's My List with a Follow / Follow Back button instead of a dead-end
     "this user is private" modal. */
  const cachedFriendData = getCachedFriendListData(uid);
  const profilePromise = db.collection("users").doc(uid).get();
  const listPromise = cachedFriendData
    ? Promise.resolve(cachedFriendData)
    : loadWatchlistDataFromDocRef(db.collection("watchlist").doc(uid), getEmptyListData())
        .then(listData => setCachedFriendListData(uid, listData));

  // Load their profile + list in parallel. No friendship gate — lists are
  // viewable by everyone (v11344).
  let userDoc = null;
  let loadedFriendData = cachedFriendData || null;
  try {
    [userDoc, loadedFriendData] = await Promise.all([profilePromise, listPromise]);
    const theirProfileData = userDoc.exists ? (userDoc.data() || {}) : {};
    usersMap[uid] = { ...(usersMap[uid] || {}), ...theirProfileData, uid };
    Object.assign(sourceUser, {
      ...theirProfileData,
      uid,
      name: name || theirProfileData.name || theirProfileData.displayName || sourceUser.name || 'Friend',
      photo: photo || theirProfileData.photo || sourceUser.photo || ''
    });
    sourceUser.profileData = theirProfileData;
    sourceUser.listTabVisibility = normalizeListTabVisibility(theirProfileData.listTabVisibility);
    sourceUser.ratingPreferences = normalizeRatingPreferences(theirProfileData.ratingPreferences);
  } catch(e) {
    console.error("Friend list load failed:", e);
    return;
  }
  /* v11380: bail if a newer open / a back-out happened during the load above —
     before we touch any ownership/render state. */
  if (friendShelfLoadToken !== loadToken) return;
  if (!viewingUser) {
    const cachedOwnData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(data || getEmptyListData());
    myData = cloneListData(cachedOwnData);
    data = cloneListData(cachedOwnData);
    ownDataCache = cloneListData(cachedOwnData);
    if (typeof loadOwnDataFromFirestore === 'function') {
      loadOwnDataFromFirestore()
        .then(freshOwnData => {
          if (viewingUser?.uid !== uid) return;
          myData = cloneListData(freshOwnData);
          ownDataCache = cloneListData(freshOwnData);
        })
        .catch(error => console.warn('Own library background refresh skipped before friend shelf:', error));
    }
  }
  viewingReturnTab = getActiveMainTab ? getActiveMainTab() : 'community';
  viewingReturnState = !viewingUser
    ? captureCommunityReturnState('friend-home')
    : (cloneFriendRouteState(viewingReturnState) || captureCommunityReturnState('friend-home'));
  viewingUser = sourceUser;
  let loadFailed = false;
  try {
    friendViewData = setCachedFriendListData(uid, loadedFriendData || getEmptyListData());
  } catch(e) {
    console.error("Failed to load user list:", e);
    friendViewData = getEmptyListData();
    loadFailed = true;
  }
  friendViewData = await autoSortAnimeBuckets(normalizeListData(friendViewData), false);
  /* v11380: a back-out / different open during the sort above invalidates this
     load — abort before painting the friend shelf so it can't override the own
     shelf that backToMyList already restored. */
  if (friendShelfLoadToken !== loadToken) return;
  clearListSearch();

  // Add class to body for viewing user styling
  document.body.classList.add('viewing-other-user');
  syncViewingUserHeaderBackButton(true);
  /* v10.763: refresh the top-of-screen header so it shows this friend's
     display name in place of the Shelfd logo. The avatar banner below
     now carries their @username instead. */
  if (typeof window.updateMainHeaderPageTitle === 'function') {
    try { window.updateMainHeaderPageTitle(); } catch (e) { /* non-fatal */ }
  }

  const communityView = document.getElementById('community-view');
  const myListView = document.getElementById('mylist-view');
  const myListHeader = document.getElementById('mylist-header');
  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');
  const isBlockedUser = typeof window.isShelfdUserBlocked === 'function'
    ? window.isShelfdUserBlocked(uid)
    : !!(window.shelfdBlockedUids && window.shelfdBlockedUids.has(String(uid)));
  /* v10.987: top header now shows @username; this banner shows display
     name under the profile picture. Keep extracting the handle here so
     updateMainHeaderPageTitle can read the same normalized fields from
     viewingUser. */
  const friendHandle = String(
    sourceUser.usernameHandle
    || sourceUser.userHandle
    || sourceUser.handle
    || sourceUser.username
    || sourceUser.usernameHandleLower
    || sourceUser.handleLower
    || sourceUser.usernameLower
    || sourceUser.profileData?.usernameHandle
    || sourceUser.profileData?.userHandle
    || sourceUser.profileData?.handle
    || sourceUser.profileData?.username
    || ''
  ).trim().replace(/^@+/, '');
  if (friendHandle) {
    sourceUser.usernameHandle = sourceUser.usernameHandle || friendHandle;
    if (viewingUser === sourceUser) viewingUser.usernameHandle = viewingUser.usernameHandle || friendHandle;
    if (typeof window.updateMainHeaderPageTitle === 'function') {
      try { window.updateMainHeaderPageTitle(); } catch (e) { /* non-fatal */ }
    }
  }
  const friendDisplayName = String(
    sourceUser.customName
    || sourceUser.fullName
    || sourceUser.displayName
    || sourceUser.name
    || name
    || 'Friend'
  ).trim();
  if (myListView) myListView.style.display = 'block';
  if (myListHeader) myListHeader.style.display = 'block';
  if (addBtn) addBtn.style.display = 'none';
  /* v11378: tappable followers/following counts under the name (same resolver
     the followers/following page uses, so the numbers match). */
  const followersCount = (typeof getSocialIdsForProfile === 'function') ? getSocialIdsForProfile(sourceUser, 'followers').length : 0;
  const followingCount = (typeof getSocialIdsForProfile === 'function') ? getSocialIdsForProfile(sourceUser, 'following').length : 0;
  /* v11.391: private-account gate. When the viewer is NOT a confirmed friend
     (and it isn't a public creator), the followers/following counts and the
     View Profile button become non-interactive, and the list area is locked. */
  const shelfPrivate = (typeof isShelfUserShelfPrivate === 'function')
    ? isShelfUserShelfPrivate(uid)
    : !(Array.isArray(friends) && friends.includes(uid));
  const socialCountsHtml = shelfPrivate
    ? `<span class="friend-list-social-count is-locked"><strong>${followersCount.toLocaleString('en-US')}</strong> followers</span>
        <span class="friend-list-social-sep" aria-hidden="true">·</span>
        <span class="friend-list-social-count is-locked"><strong>${followingCount.toLocaleString('en-US')}</strong> following</span>`
    : `<button type="button" class="friend-list-social-count" onclick="openShelfUserSocialPage('${uid}','followers')"><strong>${followersCount.toLocaleString('en-US')}</strong> followers</button>
        <span class="friend-list-social-sep" aria-hidden="true">·</span>
        <button type="button" class="friend-list-social-count" onclick="openShelfUserSocialPage('${uid}','following')"><strong>${followingCount.toLocaleString('en-US')}</strong> following</button>`;
  if (bannerArea) bannerArea.innerHTML = `<div class="viewing-banner friend-list-viewing-banner">
    <div class="viewing-user-profile-center">
      <img src="${sourceUser.photo || '/default-avatar.svg#' + encodeURIComponent(friendDisplayName) + '&background=1e2028&color=60a5fa'}" class="viewing-user-avatar" alt="">
      ${friendDisplayName ? `<div class="viewing-user-display-name">${escHtml(friendDisplayName)}</div>` : ''}
      <div class="friend-list-social-counts">
        ${socialCountsHtml}
      </div>
    </div>
    <div class="blocked-user-notice friend-list-blocked-notice" style="${isBlockedUser ? '' : 'display:none;'}">You blocked this user.</div>
    <div class="viewing-banner-divider" aria-hidden="true"></div>
    <div class="viewing-banner-actions">
      <span class="friend-list-follow-slot">${getFriendListFollowButtonHTML(uid)}</span>
      ${shelfPrivate
        ? `<button class="back-btn friend-list-viewprofile-btn is-locked" type="button" disabled aria-disabled="true">View Profile</button>`
        : `<button class="back-btn friend-list-viewprofile-btn" onclick="openUserProfile('${uid}')">View Profile</button>`}
      <button class="back-btn friend-list-dm-btn" onclick="openDirectMessageFromUser('${uid}')">Direct Message</button>
    </div>
    <button class="friend-list-floating-back-btn" type="button" onclick="backToMyList()" aria-label="Back">‹</button>
  </div>`;
  const initialView = chooseInitialListView(friendViewData);
  activeSection = initialView.section;
  activeTab = normalizeVisibleMyListStatusTab(initialView.tab, activeSection);
  render();
  bindFriendShelfSwipeBack();
  await startFriendHomeEnterTransition(options);
  persistUiState();
  if (typeof loadWatchTogetherGroupsForOwner === 'function') {
    loadWatchTogetherGroupsForOwner(uid)
      .then(() => {
        if (viewingUser?.uid !== uid) return;
        try { render(); } catch (e) { console.warn('Friend shelf Shared Watch refresh skipped:', e); }
      })
      .catch(error => console.warn('Shared Watch owner groups background load failed:', error));
  }
  if (loadFailed) {
    const grid = document.getElementById('cards-grid');
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'none';
    if (grid) grid.innerHTML = '<div class="app-error" style="grid-column:1/-1;">This list could not load. Try again in a moment.</div>';
  }
}

window.updateViewingUserBlockedNotice = function() {
  const notice = document.querySelector('.friend-list-blocked-notice');
  if (!notice || !viewingUser?.uid) return;
  const blocked = typeof window.isShelfdUserBlocked === 'function'
    ? window.isShelfdUserBlocked(viewingUser.uid)
    : !!(window.shelfdBlockedUids && window.shelfdBlockedUids.has(String(viewingUser.uid)));
  notice.style.display = blocked ? '' : 'none';
};

/* v11360: dedicated, finger-tracking left-edge swipe-back for the friend's
   shelf page. Replaces the generic edge-swipe engine (31-edge-swipe-back.js),
   which only painted a thin purple indicator line and never moved the page.
   Modeled on the canonical bindDiscoverMediaProfileSwipeBack:
     • left-edge (≤28px) engage, 14px horizontal threshold (beats vertical 1.3×)
     • rAF-batched composited translate3d (ProMotion/120Hz-safe)
     • pins #mylist-view as a fixed overlay + reveals the friends page behind it
     • commit at 34% width OR a fast flick → slide off + backToMyList(skipSlide)
     • otherwise spring back to rest
   Bound once on #mylist-view (idempotent via dataset guard). */
function bindFriendShelfSwipeBack() {
  const myListView = document.getElementById('mylist-view');
  if (!myListView || myListView.dataset.friendSwipeBound === 'true') return;
  myListView.dataset.friendSwipeBound = 'true';

  let startX = 0, startY = 0, lastX = 0, lastTime = 0, velocityX = 0;
  let viewportW = 0, armed = false, engaged = false;
  let activePointerId = null, rafId = 0, pendingX = 0;
  let edgeZone = false, anywhereFired = false;

  const canSwipe = () =>
    document.body.classList.contains('viewing-other-user') &&
    !document.body.classList.contains('friend-home-transitioning') &&
    !friendHomeExitPromise;

  /* SMOOTHNESS NOTE (v11361 rebuild): the previous version pinned #mylist-view
     position:fixed on engage — that forced a synchronous reflow AND a vertical
     scroll-jump (fixed detaches from document scroll), and animated the
     community page's opacity every frame. All three janked the first ~150ms.
     This version translates #mylist-view IN PLACE (it stays in normal flow):
     a pure composited transform — no reflow, no scroll jump, no per-frame
     paint. The layer is promoted on pointerdown so the first move frame is
     already on the GPU. Reveal is the dark base (#0E0E0E html bg), matching
     the tap-back exit slide. */
  const renderFrame = () => {
    rafId = 0;
    myListView.style.transform = `translate3d(${pendingX}px, 0, 0)`;
  };
  const requestFrame = () => { if (!rafId) rafId = requestAnimationFrame(renderFrame); };
  const clearFrame = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

  /* Reveal WHATEVER page you came from behind the sliding shelf (universal —
     friends list, activity, discover, games/anime/music discover, …), resolved
     from viewingReturnTab. Placed ONCE as a static fixed backdrop at z-index:-1
     (below the in-flow shelf, above the dark canvas), starting just under the
     header so it never covers it. No per-frame work touches it, so the drag
     stays a pure composited transform. */
  const resolveReturnView = () => {
    const tab = (typeof viewingReturnTab === 'string' && viewingReturnTab) ? viewingReturnTab : 'community';
    const hub = (typeof activeDiscoveryHub !== 'undefined') ? activeDiscoveryHub : '';
    let id = 'community-view';
    if (tab === 'games-discover') id = 'games-discover-view';
    else if (tab === 'discover') {
      id = hub === 'gaming' ? 'games-discover-view'
        : hub === 'anime' ? 'anime-discover-view'
        : hub === 'music' ? 'music-discover-view'
        : 'discover-view';
    } else if (tab === 'community') id = 'community-view';
    let el = document.getElementById(id);
    if (!el) el = document.getElementById('community-view');
    return el;
  };
  const showReturnViewBehind = () => {
    const el = resolveReturnView();
    if (!el) return;
    const headerEl = document.querySelector('.header');
    const top = headerEl ? Math.max(0, Math.round(headerEl.getBoundingClientRect().bottom)) : 0;
    el.dataset.friendShelfBackdrop = 'true';
    el.style.display = 'block';
    el.style.position = 'fixed';
    el.style.top = top + 'px';
    el.style.left = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    /* positive z (NOT -1): the views live inside an opaque #app-container, so a
       negative z hides behind its base. z:1 sits above the base; the shelf gets
       z:2 below so it covers this until swiped away. */
    el.style.zIndex = '1';
    el.style.opacity = '1';
    el.style.pointerEvents = 'none';
    el.style.overflow = 'hidden';
  };
  const hideReturnViewBehind = () => {
    const el = document.querySelector('[data-friend-shelf-backdrop]');
    if (!el) return;
    ['position','top','left','right','bottom','zIndex','opacity','pointerEvents','overflow']
      .forEach(p => { el.style[p] = ''; });
    delete el.dataset.friendShelfBackdrop;
    if (document.body.classList.contains('viewing-other-user')) el.style.display = 'none';
  };

  const beginDrag = () => {
    showReturnViewBehind();
    /* shelf stays IN FLOW (relative, no offset → no scroll-jump) but gets z:2 so
       it paints above the revealed previous view (z:1). opaque base so that view
       only shows where the shelf has moved away (not through the card gaps). */
    myListView.style.position = 'relative';
    myListView.style.zIndex = '2';
    myListView.style.background = '#0E0E0E';
    myListView.style.transition = 'none';
    myListView.style.boxShadow = '-14px 0 34px rgba(0, 0, 0, 0.32)';
    document.body.classList.add('friend-shelf-swiping');
  };

  const endDragStyles = () => {
    clearFrame();
    myListView.style.transition = '';
    myListView.style.transform = '';
    myListView.style.boxShadow = '';
    myListView.style.background = '';
    myListView.style.position = '';
    myListView.style.zIndex = '';
    myListView.style.willChange = '';
    myListView.style.backfaceVisibility = '';
    hideReturnViewBehind();
    document.body.classList.remove('friend-shelf-swiping');
  };

  /* swallow the click the swipe would otherwise synthesize on a card/button it
     passed over, so an anywhere-swipe never also opens a title. */
  const suppressNextClick = () => {
    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('click', onClick, true);
      window.clearTimeout(timer);
    };
    document.addEventListener('click', onClick, true);
    const timer = window.setTimeout(() => {
      document.removeEventListener('click', onClick, true);
    }, 700);
  };

  /* Anywhere-swipe back: NOT finger-tracked. Once a clear left→right swipe is
     detected we just PLAY the back animation from rest (reveal + slide off). */
  const commitBackFromRest = () => {
    clearFrame();
    beginDrag();
    myListView.style.transform = 'translate3d(0, 0, 0)';
    void myListView.offsetWidth; // commit the rest state before animating off
    myListView.style.transition = 'transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)';
    myListView.style.transform = 'translate3d(100vw, 0, 0)';
    window.setTimeout(() => {
      if (typeof backToMyList === 'function') backToMyList(null, { skipSlide: true });
    }, 350);
  };

  const handleDown = (event) => {
    if (!canSwipe()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    /* never hijack text inputs. Buttons/links/cards are allowed — a tap still
       fires (we don't preventDefault until a drag engages), and a real swipe
       across one suppresses its click. */
    const formControl = event.target && event.target.closest
      ? event.target.closest('input, textarea, select, [contenteditable="true"]')
      : null;
    if (formControl) return;
    startX = event.clientX;
    startY = event.clientY;
    lastX = startX;
    lastTime = performance.now();
    velocityX = 0;
    viewportW = window.innerWidth || document.documentElement.clientWidth || 390;
    armed = true;
    engaged = false;
    anywhereFired = false;
    edgeZone = startX <= 26;
    activePointerId = event.pointerId != null ? event.pointerId : null;
    if (edgeZone) {
      /* promote the layer NOW so the first finger-tracked frame is composited. */
      myListView.style.willChange = 'transform';
      myListView.style.backfaceVisibility = 'hidden';
    }
  };

  const handleMove = (event) => {
    if (!armed) return;
    if (activePointerId !== null && event.pointerId !== undefined && event.pointerId !== activePointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    const now = performance.now();
    const dt = Math.max(1, now - lastTime);
    velocityX = (event.clientX - lastX) / dt;
    lastX = event.clientX;
    lastTime = now;

    if (!engaged) {
      if (edgeZone) {
        /* LEFT-EDGE: finger-tracking drag. */
        if (dx > 12 && Math.abs(dx) > Math.abs(dy) * 1.25) {
          engaged = true;
          beginDrag();
          try { myListView.setPointerCapture && myListView.setPointerCapture(event.pointerId); } catch (e) {}
        } else if (Math.abs(dy) > Math.abs(dx)) {
          armed = false;
          myListView.style.willChange = '';
          myListView.style.backfaceVisibility = '';
          return;
        } else {
          return;
        }
      } else {
        /* ANYWHERE: not finger-tracked — a clear left→right swipe (distance or a
           quick flick) just triggers the back animation. */
        const triggered = (dx > 72 && dx > Math.abs(dy) * 1.4)
          || (dx > 40 && velocityX > 0.5 && dx > Math.abs(dy) * 1.2);
        if (triggered) {
          anywhereFired = true;
          armed = false;
          suppressNextClick();
          try { if (event.cancelable) event.preventDefault(); } catch (e) {}
          commitBackFromRest();
        } else if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 14) {
          armed = false; // vertical → leave it to native scroll
        }
        return;
      }
    }
    /* engaged finger-track frame */
    if (event.cancelable) event.preventDefault();
    pendingX = Math.max(0, Math.min(viewportW, dx));
    requestFrame();
  };

  const handleUp = (event) => {
    if (anywhereFired) { anywhereFired = false; armed = false; engaged = false; activePointerId = null; return; }
    if (!armed && !engaged) return;
    const endX = (event && typeof event.clientX === 'number') ? event.clientX : (startX + pendingX);
    const dx = endX - startX;
    const wasEngaged = engaged;
    armed = false;
    engaged = false;
    try { if (activePointerId !== null) myListView.releasePointerCapture && myListView.releasePointerCapture(activePointerId); } catch (e) {}
    activePointerId = null;
    if (!wasEngaged) {
      myListView.style.willChange = '';
      myListView.style.backfaceVisibility = '';
      return;
    }
    clearFrame();
    const shouldClose = dx >= viewportW * 0.32 || (dx > 48 && velocityX > 0.4);
    if (shouldClose) {
      myListView.style.transition = 'transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)';
      myListView.style.transform = 'translate3d(100vw, 0, 0)';
      window.setTimeout(() => {
        if (typeof backToMyList === 'function') backToMyList(null, { skipSlide: true });
      }, 350);
    } else {
      myListView.style.transition = 'transform 0.2s cubic-bezier(0.33, 1, 0.68, 1)';
      myListView.style.transform = 'translate3d(0, 0, 0)';
      window.setTimeout(endDragStyles, 215);
    }
  };

  const handleCancel = () => {
    if (engaged) {
      myListView.style.transition = 'transform 0.18s ease';
      myListView.style.transform = 'translate3d(0, 0, 0)';
      window.setTimeout(endDragStyles, 190);
    } else {
      myListView.style.willChange = '';
      myListView.style.backfaceVisibility = '';
    }
    armed = false;
    engaged = false;
    anywhereFired = false;
    activePointerId = null;
  };

  myListView.addEventListener('pointerdown', handleDown, { passive: true });
  myListView.addEventListener('pointermove', handleMove, { passive: false });
  myListView.addEventListener('pointerup', handleUp, { passive: true });
  myListView.addEventListener('pointercancel', handleCancel, { passive: true });
}

/* v10.995: smooth 400ms slide-off-right when leaving someone's My List.
   Previously there was NO exit animation — the friend view just snapped
   away the moment state finished restoring. That created the perception
   of "back button frozen, had to tap twice" because the user couldn't
   tell whether their first tap registered.
   The friend's #mylist-view gets pinned fixed, transform-animated to
   translateX(100%) over 400ms (cubic-bezier matches iOS pop animation),
   then display:none'd so the underlying state-restore + render() can
   refill it with own data invisibly before the rest of the back flow
   restores visibility. Transform + opacity only → ProMotion/120Hz-safe
   per the project animation rules. */
function startFriendHomeExitSlide() {
  const myListView = document.getElementById('mylist-view');
  if (!myListView || !shouldAnimateFriendHomeEnterTransition()) return Promise.resolve();
  return new Promise(resolve => {
    myListView.style.position = 'fixed';
    myListView.style.inset = '0';
    myListView.style.zIndex = '2400';
    myListView.style.overflowY = 'hidden';
    myListView.style.background = '#0E0E0E';
    myListView.style.willChange = 'transform';
    myListView.style.contain = 'paint';
    myListView.style.backfaceVisibility = 'hidden';
    myListView.style.transition = 'none';
    myListView.style.transform = 'translate3d(0, 0, 0)';
    myListView.style.pointerEvents = 'none';
    /* Force layout so the browser commits the pinned 0% before the
       next transform change kicks off the transition. */
    void myListView.offsetWidth;
    myListView.style.transition = 'transform 0.36s cubic-bezier(0.18, 0.92, 0.18, 1)';
    myListView.style.transform = 'translate3d(100%, 0, 0)';
    window.setTimeout(() => {
      /* Hide the view while render() repopulates it with own data so
         the user never sees the friend's content snap back into place.
         setMainNavVisibility('mylist') later in backToMyList restores
         display: block. */
      myListView.style.display = 'none';
      myListView.style.position = '';
      myListView.style.inset = '';
      myListView.style.zIndex = '';
      myListView.style.overflowY = '';
      myListView.style.background = '';
      myListView.style.willChange = '';
      myListView.style.contain = '';
      myListView.style.backfaceVisibility = '';
      myListView.style.transition = '';
      myListView.style.transform = '';
      myListView.style.pointerEvents = '';
      resolve();
    }, 370);
  });
}

async function backToMyList(targetTab = null, options = {}) {
  if (friendHomeExitPromise) return friendHomeExitPromise;
  const exitToken = ++friendHomeExitToken;
  /* v11380: invalidate any in-flight friend-shelf load so a late response can't
     repaint the friend shelf after we've returned to the own shelf. */
  friendShelfLoadToken++;
  const skipSlide = !!(options && options.skipSlide);
  let slidePromise;
  if (skipSlide) {
    /* v11359: the left-edge swipe-back gesture (31-edge-swipe-back.js) already
       dragged #mylist-view off-screen and finished its own slide. Skip the
       button-path slide and instead hide the view + strip every inline style
       the gesture left on it, so resetFriendHomeEnterTransition() below can't
       snap the friend's content back into view for a frame. */
    const mv = document.getElementById('mylist-view');
    if (mv) {
      mv.style.display = 'none';
      ['transition','transform','position','inset','top','left','right','bottom',
       'zIndex','background','overflowY','overflow','borderRadius',
       'borderTopLeftRadius','borderBottomLeftRadius','boxShadow','willChange',
       'contain','backfaceVisibility','pointerEvents','touchAction','animation'
      ].forEach(p => { mv.style[p] = ''; });
    }
    /* the swipe revealed the previous page as a fixed z-index:-1 backdrop — strip
       those inline styles so the teardown can show it as the normal in-flow view
       (display is left to setMainNavVisibility below). */
    const backdropView = document.querySelector('[data-friend-shelf-backdrop]');
    if (backdropView) {
      ['position','top','left','right','bottom','zIndex','opacity','pointerEvents','overflow']
        .forEach(p => { backdropView.style[p] = ''; });
      delete backdropView.dataset.friendShelfBackdrop;
    }
    document.body.classList.remove('friend-shelf-swiping');
    /* v11365: the revealed page is already current — suppress the friends-list
       re-render during the back-finalize window so it doesn't flash. Cleared
       shortly after so the realtime listener resumes normal renders. */
    window.__shelfdSuppressFriendsListRender = true;
    window.clearTimeout(window.__shelfdSuppressFriendsListRenderTimer);
    window.__shelfdSuppressFriendsListRenderTimer = window.setTimeout(() => {
      window.__shelfdSuppressFriendsListRender = false;
    }, 900);
    slidePromise = Promise.resolve();
  } else {
    /* v10.995: fire the slide-off animation FIRST so the user gets
       instant visual feedback that the tap registered (eliminates the
       perceived "needs two taps" feel). The state-restore awaits the
       slide before running so the underlying view is fresh when
       visibility is restored. */
    slidePromise = startFriendHomeExitSlide();
  }
  const exitTask = (async () => {
    await slidePromise;
    resetFriendHomeEnterTransition();
    const previousFriendData = friendViewData ? cloneListData(friendViewData) : null;
    const savedReturnState = !targetTab ? cloneFriendRouteState(viewingReturnState) : null;
    const returnTab = targetTab || viewingReturnTab || 'mylist';
    const navReturnTab = returnTab === 'games-discover' ? 'discover' : returnTab;
    if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing() && !currentUser) {
      viewingUser = null;
      friendViewData = null;
      viewingReturnState = null;
      viewingReturnTab = 'mylist';
      profileViewingUser = null;
      profileViewingProfile = null;
      profileViewingData = null;
      document.body.classList.remove('viewing-other-user', 'landing-public-lists', 'profile-active', 'guest-creator-lists');
      syncViewingUserHeaderBackButton(false);
      /* v10.763: revert header from friend-name back to default after leaving. */
      if (typeof window.updateMainHeaderPageTitle === 'function') {
        try { window.updateMainHeaderPageTitle(); } catch (e) { /* non-fatal */ }
      }
      const addBtn = document.getElementById('add-btn');
      const bannerArea = document.getElementById('viewing-banner-area');
      if (addBtn) addBtn.style.display = '';
      if (bannerArea) bannerArea.innerHTML = '';
      clearListSearch();
      if (returnTab === 'mylist') {
        if (typeof openGuestCreatorListsView === 'function') await openGuestCreatorListsView({ returnTab: 'discover' });
        return;
      }
      setBottomNavVisibility(true);
      syncMainNavButtons(navReturnTab);
      setMainNavVisibility(returnTab);
      if (returnTab === 'community') {
        loadCommunity(true);
        loadFriendActivity();
      } else if (returnTab === 'discover' || returnTab === 'games-discover') {
        if (returnTab === 'games-discover') activeDiscoveryHub = 'gaming';
        loadActiveDiscoveryHub();
      }
      persistUiState();
      return;
    }
    if (landingPublicProfileActive && !currentUser && returnTab === 'landing') {
      viewingUser = null;
      friendViewData = null;
      viewingReturnState = null;
      viewingReturnTab = 'mylist';
      profileViewingUser = null;
      profileViewingProfile = null;
      profileViewingData = null;
      document.body.classList.remove('viewing-other-user', 'landing-public-lists', 'profile-active');
      syncViewingUserHeaderBackButton(false);
      /* v10.763: revert header from friend-name back to default after leaving. */
      if (typeof window.updateMainHeaderPageTitle === 'function') {
        try { window.updateMainHeaderPageTitle(); } catch (e) { /* non-fatal */ }
      }
      showLandingPage();
      return;
    }
    viewingUser = null;
    friendViewData = null;
    viewingReturnState = null;
    viewingReturnTab = 'mylist';
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    clearFriendHomeChrome();
    setBottomNavVisibility(true);
    restoreOwnLibraryFromFriendViewCache();
    /* v11380 — OWNERSHIP FIX: repaint #mylist-view with MY OWN data right now,
       no matter which tab we return to. Root cause of the bug: when returning to
       community/discover (the usual case), nothing re-rendered #mylist-view, so
       the friend's last-rendered cards stayed in its DOM. Tapping My List then
       showed the friend's shelf until a manual category switch forced render().
       viewingUser is already null + data is restored to mine above, so this
       render paints the signed-in user's own shelf and clears the stale cards. */
    activeSection = "shows";
    activeTab = "watching";
    if (typeof render === 'function') render();

    if (!targetTab && savedReturnState?.kind === 'community') {
      showImmediateCommunityReturnState(savedReturnState);
      loadCommunity(false).catch(e => console.error('Friend home community restore failed:', e));
      if (savedReturnState.friendsTab === 'activity') loadFriendActivity();
      persistUiState();
    } else {
      if (returnTab === 'games-discover') activeDiscoveryHub = 'gaming';
      syncMainNavButtons(navReturnTab);
      setMainNavVisibility(returnTab);
      if (returnTab === 'community') {
        loadCommunity();
        loadFriendActivity();
      } else if (returnTab === 'discover' || returnTab === 'games-discover') {
        loadActiveDiscoveryHub();
      } else {
        activeSection = "shows";
        activeTab = "watching";
        render();
      }
      persistUiState();
    }

    if (!isPreviewMode()) {
      try {
        await restoreOwnLibraryAfterFriendView(previousFriendData);
      } catch (e) {
        console.error('Failed to refresh own library after friend view close:', e);
      }
    }

    if (exitToken !== friendHomeExitToken || viewingUser) return;
    if (getActiveMainTab() === 'mylist') render();
    persistUiState();
  })();
  friendHomeExitPromise = exitTask;
  try {
    await exitTask;
  } finally {
    if (friendHomeExitPromise === exitTask) friendHomeExitPromise = null;
  }
}

function syncViewingUserHeaderBackButton(enabled = false) {
  const importBtn = document.querySelector('.header-import-btn');
  if (!importBtn) return;
  if (enabled) {
    if (!importBtn.dataset.defaultLabel) importBtn.dataset.defaultLabel = importBtn.textContent || 'Import';
    if (!importBtn.dataset.defaultHtml) importBtn.dataset.defaultHtml = importBtn.innerHTML || '';
    if (!importBtn.dataset.defaultTitle) importBtn.dataset.defaultTitle = importBtn.getAttribute('title') || '';
    if (!importBtn.dataset.defaultAriaLabel) importBtn.dataset.defaultAriaLabel = importBtn.getAttribute('aria-label') || '';
    if (!importBtn.dataset.defaultOnclick) importBtn.dataset.defaultOnclick = importBtn.getAttribute('onclick') || 'openImportPage()';
    /* v10.266: instead of just text-swapping the cyan Import pill, also add
       a back-mode class so the CSS in 17-auth-flow-setup.css overrides the
       cyan look. v10.995: dropped the "Back" text label — match the
       40×40 circle arrow-only back button used on the viewing-other
       profile page (per user spec: both surfaces should use the same
       back-button visual). */
    importBtn.innerHTML = '<svg class="header-back-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4 6 10l6.5 6"></path></svg>';
    importBtn.classList.add('header-import-btn--back-mode');
    importBtn.setAttribute('title', 'Go back');
    importBtn.setAttribute('aria-label', 'Go back');
    importBtn.setAttribute('onclick', 'backToMyList()');
    return;
  }
  importBtn.classList.remove('header-import-btn--back-mode');
  if (importBtn.dataset.defaultHtml) importBtn.innerHTML = importBtn.dataset.defaultHtml;
  else if (importBtn.dataset.defaultLabel) importBtn.textContent = importBtn.dataset.defaultLabel;
  if (Object.prototype.hasOwnProperty.call(importBtn.dataset, 'defaultTitle')) {
    if (importBtn.dataset.defaultTitle) importBtn.setAttribute('title', importBtn.dataset.defaultTitle);
    else importBtn.removeAttribute('title');
  }
  if (Object.prototype.hasOwnProperty.call(importBtn.dataset, 'defaultAriaLabel')) {
    if (importBtn.dataset.defaultAriaLabel) importBtn.setAttribute('aria-label', importBtn.dataset.defaultAriaLabel);
    else importBtn.removeAttribute('aria-label');
  }
  if (importBtn.dataset.defaultOnclick) importBtn.setAttribute('onclick', importBtn.dataset.defaultOnclick);
}

function shouldAnimateFriendHomeEnterTransition() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!window.matchMedia('(max-width: 700px)').matches) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

function easeFriendProfileListEnter(t) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  return 1 - Math.pow(1 - clamped, 4);
}

function resetFriendHomeEnterTransition() {
  window.clearTimeout(friendHomeTransitionTimer);
  friendHomeTransitionTimer = 0;
  document.body.classList.remove('friend-home-transitioning');
  const myListView = document.getElementById('mylist-view');
  if (myListView) {
    myListView.classList.remove('friend-home-enter-active');
    myListView.style.position = '';
    myListView.style.inset = '';
    myListView.style.removeProperty('top'); /* v11358: clear the slide-in header offset */
    myListView.style.zIndex = '';
    myListView.style.overflowY = '';
    myListView.style.background = '';
    myListView.style.transform = '';
    myListView.style.opacity = '';
    myListView.style.willChange = '';
    myListView.style.pointerEvents = '';
    myListView.style.contain = '';
    myListView.style.backfaceVisibility = '';
    myListView.style.transition = '';
  }
}

function startFriendProfileListEnterTransition() {
  const profilePage = document.getElementById('profile-page');
  const myListView = document.getElementById('mylist-view');
  if (!myListView || !profilePage || !shouldAnimateFriendHomeEnterTransition()) {
    syncMainNavButtons('mylist');
    setMainNavVisibility('mylist');
    document.body.classList.remove('profile-active');
    setBottomNavVisibility(true);
    if (profilePage) {
      profilePage.classList.remove('profile-page-open', 'profile-page-closing');
      profilePage.style.display = 'none';
    }
    return Promise.resolve();
  }

  window.clearTimeout(friendHomeTransitionTimer);
  friendHomeTransitionTimer = 0;
  document.body.classList.remove('friend-home-transitioning');
  myListView.classList.remove('friend-home-enter-active');
  myListView.style.display = 'block';
  myListView.style.position = 'fixed';
  myListView.style.inset = '0';
  myListView.style.zIndex = '2400';
  myListView.style.overflowY = 'auto';
  myListView.style.background = '#0E0E0E';
  myListView.style.opacity = '1';
  myListView.style.willChange = 'transform';
  myListView.style.pointerEvents = 'none';
  myListView.style.contain = 'paint';
  myListView.style.backfaceVisibility = 'hidden';
  myListView.style.transition = 'none';
  myListView.style.transform = 'translate3d(-100%, 0, 0)';

  return new Promise(resolve => {
    const duration = FRIEND_PROFILE_LIST_ENTER_TRANSITION_MS;
    const frameMs = 1000 / FRIEND_PROFILE_LIST_ENTER_FPS;
    const start = performance.now();
    let lastFrame = -1;
    const finish = () => {
      myListView.style.transform = '';
      myListView.style.position = '';
      myListView.style.inset = '';
      myListView.style.zIndex = '';
      myListView.style.overflowY = '';
      myListView.style.background = '';
      myListView.style.opacity = '';
      myListView.style.willChange = '';
      myListView.style.pointerEvents = '';
      myListView.style.contain = '';
      myListView.style.backfaceVisibility = '';
      myListView.style.transition = '';
      profilePage.classList.remove('profile-page-open', 'profile-page-closing');
      profilePage.style.display = 'none';
      syncMainNavButtons('mylist');
      setMainNavVisibility('mylist');
      document.body.classList.remove('profile-active');
      setBottomNavVisibility(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
      resolve();
    };
    function tick(now) {
      const elapsed = Math.min(duration, Math.max(0, now - start));
      const frame = Math.floor(elapsed / frameMs);
      if (frame !== lastFrame) {
        lastFrame = frame;
        const eased = easeFriendProfileListEnter(elapsed / duration);
        const x = -100 + (100 * eased);
        myListView.style.transform = `translate3d(${x.toFixed(3)}%, 0, 0)`;
      }
      if (elapsed < duration) requestAnimationFrame(tick);
      else finish();
    }
    requestAnimationFrame(tick);
  });
}

function startFriendHomeEnterTransition(options = {}) {
  if (options?.transitionOrigin === 'profile-left') {
    return startFriendProfileListEnterTransition();
  }
  const communityView = document.getElementById('community-view');
  const myListView = document.getElementById('mylist-view');
  if (!communityView || !myListView) return Promise.resolve();
  resetFriendHomeEnterTransition();
  if (!shouldAnimateFriendHomeEnterTransition()) {
    communityView.style.display = 'none';
    return Promise.resolve();
  }
  communityView.style.display = 'block';
  /* v11358: the slide-in pins #mylist-view position:fixed, which detaches it
     from the top header and the body's safe-area padding — so its content
     rendered behind the notch ("loads too high", then snapped down on cleanup).
     Offset the fixed layer to start at the header's bottom edge so the shelf
     content lands exactly where the settled layout puts it. Measured live so it
     stays correct across every iPhone size + the notch/Dynamic Island. */
  try {
    const headerEl = document.querySelector('.header');
    const headerBottom = headerEl ? Math.max(0, Math.round(headerEl.getBoundingClientRect().bottom)) : 0;
    if (headerBottom > 0) myListView.style.setProperty('top', headerBottom + 'px', 'important');
  } catch (e) { /* non-fatal */ }
  document.body.classList.add('friend-home-transitioning');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      myListView.classList.add('friend-home-enter-active');
    });
  });
  friendHomeTransitionTimer = window.setTimeout(() => {
    communityView.style.display = 'none';
    resetFriendHomeEnterTransition();
  }, FRIEND_HOME_ENTER_TRANSITION_MS + 60);
  return Promise.resolve();
}
