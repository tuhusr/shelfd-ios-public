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
    const normalized = {
      ...event,
      item: cloneFriendActivityItem(event.item),
      eventKey: event.eventKey || buildFriendActivityEventKey(event)
    };
    existing.set(normalized.eventKey, normalized);
  });
  friendActivityLiveEvents = [...existing.values()]
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
    let items = [];
    try {
      items = dataObj[section] ? JSON.parse(dataObj[section]) : [];
    } catch (e) {
      items = [];
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

    if (prevItem && !nextItem) {
      events.push({
        uid,
        name: actor.name || 'Friend',
        photo: actor.photo || '',
        item: cloneFriendActivityItem(prevItem.item),
        timestamp: now,
        eventType: 'removed',
        previousStatus: prevItem.status,
        mediaKey: prevItem.mediaKey
      });
      return;
    }

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

    if (nextRating > 0 && nextRating !== prevRating) {
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

function getLatestFriendItemActivityTimeFromDoc(dataObj = {}) {
  let latest = 0;
  SCREENLIST_SECTIONS.forEach(section => {
    let items = [];
    try { items = dataObj[section] ? JSON.parse(dataObj[section]) : []; } catch(e) { items = []; }
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      latest = Math.max(
        latest,
        parseFriendActivityTime(item?.dateModified),
        parseFriendActivityTime(item?.dateAdded)
      );
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
      else loadActivityTabFeed();
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
    const unsub = db.collection('watchlist').doc(uid).onSnapshot(snap => {
      const nextState = snap.exists ? buildFriendWatchlistLiveState(snap.data() || {}) : {};
      const previousState = friendActivityWatchlistState[uid] || null;
      friendActivityWatchlistState[uid] = nextState;
      const events = buildFriendWatchlistDiffEvents(uid, previousState, nextState);
      pushFriendActivityLiveEvents(events);
      const latest = events.reduce((max, event) => Math.max(max, parseFriendActivityTime(event.timestamp)), 0)
        || getLatestFriendWatchlistNotificationTime(previousState, nextState);
      handleLiveFriendActivity(latest);
    }, err => console.error('Friend activity watchlist listener failed:', err));
    friendActivityWatchlistUnsubscribes.push(unsub);
  });

  friendActivityCommentsUnsubscribe = db.collection('comments').onSnapshot(snapshot => {
    const latest = getLatestRelevantCommentTimeFromSnapshot(snapshot);
    handleLiveFriendActivity(latest);
  }, err => console.error('Friend activity comments listener failed:', err));
}

// Load friends + requests from Firestore
function applyFriendsDataSnapshot(d = {}, opts = {}) {
  const prevIncomingRequests = incomingRequests.slice();
  const prevWatchTogetherIncomingIds = watchTogetherIncomingRequestIds.slice();
  const prevDmIncomingIds = dmIncomingRequestIds.slice();
  const prevDmUnreadCount = getUnreadDirectMessageThreadCount();
  const prevFriendsKey = friends.slice().sort().join('|');

  friends = Array.isArray(d.friends) ? d.friends : [];
  incomingRequests = Array.isArray(d.incomingRequests) ? d.incomingRequests : [];
  outgoingRequests = Array.isArray(d.outgoingRequests) ? d.outgoingRequests : [];
  const prevWatchTogetherIncomingKey = watchTogetherIncomingRequestIds.join('|');
  const prevWatchTogetherOutgoingKey = watchTogetherOutgoingRequestIds.join('|');
  const prevWatchTogetherApprovedKey = watchTogetherApprovedRequestIds.join('|');
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
  dmThreadMap = normalizeDirectMessageMap(d.directMessageThreadMap);
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


  updateRequestsBadges();
  updateFriendsCountBadge();
  if (prevWatchTogetherIncomingKey !== watchTogetherIncomingRequestIds.join('|') || prevWatchTogetherOutgoingKey !== watchTogetherOutgoingRequestIds.join('|') || prevWatchTogetherApprovedKey !== watchTogetherApprovedRequestIds.join('|')) {
    hydrateWatchTogetherMirroredRequests().then(() => {
      const communityActive = document.getElementById('nav-community')?.classList.contains('active');
      if (communityActive && activeFriendsTab === 'requests') renderRequestsList(true);
      if (communityActive && activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
      render();
    });
  }

  if (prevFriendsKey !== friends.slice().sort().join('|')) {
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
    if (activeFriendsTab === 'requests') renderRequestsList();
    if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
    if (activeFriendsTab === 'friends') renderFriendsList();
    if (activeFriendsTab === 'messages' || isDirectMessagesPageOpen()) renderDirectMessagesView();
    if (activeFriendsTab === 'find') refilterPeople();
  } else if (isDirectMessagesPageOpen()) {
    renderDirectMessagesView();
  }

  if (!opts.silent) {
    const newRequests = incomingRequests.filter(uid => !prevIncomingRequests.includes(uid));
    const newWatchTogetherRequests = watchTogetherIncomingRequestIds.filter(id => !prevWatchTogetherIncomingIds.includes(id));
    const newDmRequests = dmIncomingRequestIds.filter(id => !prevDmIncomingIds.includes(id));
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
    } else if (newDmUnreadCount > prevDmUnreadCount) {
      showToast('New direct message');
    }
  }
}

function stopFriendsDataListener() {
  if (friendsDataUnsubscribe) {
    friendsDataUnsubscribe();
    friendsDataUnsubscribe = null;
  }
  stopFriendActivityLiveListeners();
  friendsDataLoadedOnce = false;
}

function resetFriendsDataState() {
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
  allUsersCache = [];
  usersMap = {};
  friendActivityUnread = false;
  friendActivityCache = null;
  friendActivityPromise = null;
  updateRequestsBadges();
  updateFriendsCountBadge();
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
  const tabBadge = document.getElementById('requests-count-badge');
  const activityDot = document.getElementById('activity-unread-badge');
  const navButtons = [
    document.getElementById('nav-community'),
    document.getElementById('mobile-nav-community')
  ].filter(Boolean);
  const sharedWatchIncomingTotal = watchTogetherIncomingRequestIds.length;
  const friendIncomingTotal = incomingRequests.length;
  const directMessageTotal = getDirectMessageNotificationCount();
  const requestTabTotal = friendIncomingTotal + sharedWatchIncomingTotal;
  const communityAlertTotal = requestTabTotal + directMessageTotal;
  const requestsTab = document.getElementById('ftab-requests');

  if (tabBadge) {
    if (requestTabTotal > 0) {
      tabBadge.textContent = String(requestTabTotal);
      tabBadge.style.display = 'inline-flex';
      tabBadge.setAttribute('aria-label', `${requestTabTotal} incoming request${requestTabTotal === 1 ? '' : 's'}`);
    } else {
      tabBadge.style.display = 'none';
      tabBadge.removeAttribute('aria-label');
    }
  }

  if (requestsTab) {
    requestsTab.classList.toggle('has-request-alert', requestTabTotal > 0);
    requestsTab.setAttribute('aria-label', requestTabTotal > 0 ? `Requests, ${requestTabTotal} incoming` : 'Requests');
  }

  if (activityDot) {
    activityDot.style.display = (friendActivityUnread || sharedWatchIncomingTotal > 0 || directMessageTotal > 0) ? 'inline-block' : 'none';
  }

  updateRequestSubtabBadges();
  updateSharedWatchActivityBadge();
  updateDirectMessagesBadge();

  navButtons.forEach(navBtn => {
    let badge = navBtn.querySelector('.nav-badge');
    if (communityAlertTotal > 0 || friendActivityUnread) {
      if (!badge) {
        badge = document.createElement('span');
        navBtn.appendChild(badge);
      }
      badge.className = 'nav-badge friend-activity-dot';
      badge.textContent = '';
      badge.setAttribute('aria-label', communityAlertTotal > 0 ? 'New request, shared watch, or message activity' : 'New friend activity');
    } else if (badge) {
      badge.remove();
    }
  });
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
}

function updateRequestSubtabUi() {
  activeRequestsSubTab = 'friends';
  const friendsBtn = document.getElementById('request-subtab-friends');
  if (friendsBtn) friendsBtn.classList.add('active');
  updateRequestSubtabBadges();
}

function switchRequestsSubTab(tab = 'friends') {
  activeRequestsSubTab = 'friends';
  updateRequestSubtabUi();
  renderRequestsList(true);
  persistUiState();
}

function openFriendsActivityDefault() {
  activeFriendsTab = 'activity';
  activeActivitySubTab = 'feed';
  switchFriendsTab('activity');
}


// Entry point when switching to Friends nav
async function loadCommunity(forceActivity = false) {
  try {
    if (forceActivity) {
      activeFriendsTab = 'activity';
      activeActivitySubTab = 'feed';
    }
    const targetTab = forceActivity ? 'activity' : ((activeFriendsTab === 'find' ? 'friends' : activeFriendsTab) || 'activity');
    if (isPreviewMode()) {
      PREVIEW_COMMUNITY_USERS.forEach(user => { usersMap[user.uid] = user; });
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
  if (tab === 'find') tab = 'friends';
  if (tab === 'activity') {
    activeActivitySubTab = 'feed';
  }
  if (tab === 'messages') {
    document.getElementById('community-view')?.classList.remove('friends-activity-active');
    openDirectMessagesPage();
    activeFriendsTab = activeFriendsTab && activeFriendsTab !== 'messages' ? activeFriendsTab : 'activity';
    persistUiState();
    return;
  }
  activeFriendsTab = tab;
  const activityTabBtn = document.getElementById('ftab-activity');
  const friendsTab = document.getElementById('ftab-friends');
  const requestsTab = document.getElementById('ftab-requests');
  const messagesTab = document.getElementById('ftab-messages');
  const findTab = document.getElementById('ftab-find');
  const activityView = document.getElementById('activity-tab-view');
  const friendsView = document.getElementById('friends-list-view');
  const requestsView = document.getElementById('requests-view');
  const messagesView = document.getElementById('messages-view');
  const findView = document.getElementById('find-people-view');
  if (!friendsTab || !requestsTab || !findTab || !friendsView || !requestsView || !findView || !messagesTab || !messagesView) {
    console.error("Community DOM is incomplete; cannot switch friends tab.");
    return;
  }
  if (activityTabBtn) activityTabBtn.classList.toggle('active', tab === 'activity');
  friendsTab.classList.toggle('active', tab === 'friends');
  requestsTab.classList.toggle('active', tab === 'requests');
  messagesTab.classList.toggle('active', tab === 'messages');
  findTab.classList.toggle('active', tab === 'find');
  const communityView = document.getElementById('community-view');
  if (communityView) communityView.classList.toggle('friends-activity-active', tab === 'activity');
  if (activityView) activityView.style.display = tab === 'activity' ? 'block' : 'none';
  friendsView.style.display = tab === 'friends' ? 'block' : 'none';
  requestsView.style.display = tab === 'requests' ? 'block' : 'none';
  messagesView.style.display = tab === 'messages' ? 'block' : 'none';
  findView.style.display = tab === 'find' ? 'block' : 'none';
  if (tab === 'activity') {
    bindFriendsActivitySwipeNavigation();
    updateActivitySubtabUi();
    initFeedComposer();
    runFriendsTabWorkWhenSmooth(() => {
      if (activeFriendsTab !== 'activity') return;
      if (isWatchActivitySubTab()) {
        renderActiveWatchActivitySubTab();
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
  }
  if (tab === 'requests') runFriendsTabWorkWhenSmooth(() => { if (activeFriendsTab === 'requests') renderRequestsList(); });
  if (tab === 'messages') runFriendsTabWorkWhenSmooth(() => { if (activeFriendsTab === 'messages') renderDirectMessagesView(); });
  if (tab === 'find') runFriendsTabWorkWhenSmooth(() => { if (activeFriendsTab === 'find') initFindPeopleSearchView(); });
  persistUiState();
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

function updateActivitySubtabUi() {
  const feed = document.getElementById('friend-activity-feed');
  const shared = document.getElementById('shared-watch-feed');
  const communityView = document.getElementById('community-view');
  if (feed) feed.style.display = activeActivitySubTab === 'feed' ? 'block' : 'none';
  if (shared) shared.style.display = isWatchActivitySubTab() ? 'block' : 'none';
  if (communityView) {
    communityView.classList.remove('activity-subtab-feed', 'activity-subtab-watch-requests', 'activity-subtab-shared-watch');
    communityView.classList.add(activeActivitySubTab === 'friendWatch' ? 'activity-subtab-watch-requests' : (activeActivitySubTab === 'sharedWatch' ? 'activity-subtab-shared-watch' : 'activity-subtab-feed'));
  }
  updateSharedWatchActivityBadge();
}


function renderCurrentActivitySubTab() {
  updateActivitySubtabUi();
  if (activeActivitySubTab === 'friendWatch') {
    return renderFriendWatchRequestsActivity();
  } else if (activeActivitySubTab === 'sharedWatch') {
    return renderSharedWatchActivity();
  } else {
    friendActivityStorySeenAtSnapshot = getFriendActivitySeenAt();
    loadActivityTabFeed();
    markFriendActivitySeen();
  }
  persistUiState();
  return null;
}

function getActivitySubTabPane(tab = activeActivitySubTab) {
  return tab === 'feed'
    ? document.getElementById('friend-activity-feed')
    : document.getElementById('shared-watch-feed');
}

function getActivitySubTabSpatialOrder(tab = activeActivitySubTab) {
  if (tab === 'friendWatch') return 0;
  if (tab === 'sharedWatch') return 2;
  return 1;
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

function runActivitySubTabSpatialTransition(previousSubTab = 'feed', nextSubTab = 'feed', previousPane = null, nextPane = null) {
  const root = document.getElementById('activity-tab-view');
  if (!root || !previousPane || !nextPane || previousPane === nextPane) return;

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const previousHeight = previousPane.offsetHeight || 0;
  const nextHeight = nextPane.offsetHeight || 0;
  const holdHeight = Math.max(previousHeight, nextHeight, 120);
  const forward = getActivitySubTabSpatialOrder(nextSubTab) > getActivitySubTabSpatialOrder(previousSubTab);

  root.style.setProperty('--activity-subtab-transition-height', `${holdHeight}px`);
  root.classList.add('activity-subtab-transitioning');
  clearActivitySubTabSpatialClasses(previousPane);
  clearActivitySubTabSpatialClasses(nextPane);

  previousPane.style.display = 'block';
  nextPane.style.display = 'block';
  previousPane.classList.add('activity-subtab-leaving', forward ? 'activity-subtab-to-left' : 'activity-subtab-to-right');
  nextPane.classList.add('activity-subtab-entering', forward ? 'activity-subtab-from-right' : 'activity-subtab-from-left');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      previousPane.classList.add('activity-subtab-run');
      nextPane.classList.add('activity-subtab-run');
    });
  });

  window.setTimeout(() => {
    clearActivitySubTabSpatialClasses(previousPane);
    clearActivitySubTabSpatialClasses(nextPane);
    root.classList.remove('activity-subtab-transitioning');
    root.style.removeProperty('--activity-subtab-transition-height');
    updateActivitySubtabUi();
  }, 330);
}

async function switchActivitySubTab(tab = 'feed') {
  const requestedSubTab = tab === 'friendWatch' ? 'friendWatch' : (tab === 'sharedWatch' ? 'sharedWatch' : 'feed');
  if (activeActivitySubTab === requestedSubTab) {
    updateActivitySubtabUi();
    return;
  }

  const previousSubTab = activeActivitySubTab === 'friendWatch' || activeActivitySubTab === 'sharedWatch' ? activeActivitySubTab : 'feed';
  const previousPane = getActivitySubTabPane(previousSubTab);
  activeActivitySubTab = requestedSubTab;

  const renderResult = renderCurrentActivitySubTab();
  if (renderResult && typeof renderResult.then === 'function') {
    try { await renderResult; } catch (error) { console.error('Activity subtab render failed:', error); }
  }

  const nextPane = getActivitySubTabPane(requestedSubTab);
  runActivitySubTabSpatialTransition(previousSubTab, requestedSubTab, previousPane, nextPane);
  persistUiState();
}

function getNextActivitySubTabFromSwipe(current = activeActivitySubTab, dx = 0) {
  const section = current === 'friendWatch' || current === 'sharedWatch' ? current : 'feed';
  if (section === 'feed') return dx > 0 ? 'friendWatch' : 'sharedWatch';
  if (section === 'friendWatch') return dx < 0 ? 'feed' : 'friendWatch';
  if (section === 'sharedWatch') return dx > 0 ? 'feed' : 'sharedWatch';
  return 'feed';
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

async function renderSharedWatchActivity(skipHydrate = false) {
  const feed = document.getElementById('shared-watch-feed');
  if (!feed) return;
  updateActivitySubtabUi();
  const headerHtml = buildActivityFeedHeaderHTML('Shared Watch');
  if (!currentUser) {
    feed.innerHTML = `${headerHtml}<div class="activity-feed-empty"><strong>Sign in required</strong>Your confirmed shared titles will appear here.</div>`;
    return;
  }
  if (!skipHydrate) await hydrateWatchTogetherMirroredRequests();
  const groups = getApprovedSharedWatchGroups();
  const planned = groups.filter(group => group.mode === 'planned');
  const watched = groups.filter(group => group.mode !== 'planned');
  const friendCount = new Set(groups.flatMap(group => getSharedWatchGroupPartners(group).map(profile => profile.uid))).size;
  if (!groups.length) {
    feed.innerHTML = `${headerHtml}<div class="shared-watch-dashboard"><div class="shared-watch-hero"><div><span>Shared Watch</span><strong>Nothing confirmed yet</strong><p>Approve a Watch Request to build shared shelves for plans and watched-together titles.</p></div></div></div>`;
    return;
  }
  feed.innerHTML = `${headerHtml}<div class="shared-watch-dashboard">
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
  if (isPreviewMode()) {
    renderPreviewFriendActivity();
    return;
  }
  if (!currentUser) {
    feed.innerHTML = `${buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })}<div class="activity-feed-empty"><strong>Sign in to see activity</strong></div>`;
    return;
  }
  feed.innerHTML = buildSkeletonHTML();
  const activities = await fetchAllFriendActivities(14);
  if (!activities.length && !friends.length) {
    feed.innerHTML = `${buildActivityFeedHeaderHTML('Activity Feed', { showRefresh: false })}<div class="activity-feed-empty"><strong>Nothing here yet</strong>Add friends or add titles to your list to see activity.</div>`;
    return;
  }
  renderFriendActivityItems(feed, activities);
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
  let html = '';
  docs.forEach(doc => {
    if (!doc.exists) return;
    const u = { uid: doc.id, ...(doc.data() || {}) };
    usersMap[u.uid] = u;
    const avatar = u.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name || '?') + '&background=1e2028&color=60a5fa';
    if (type === 'incoming') {
      html += `<div class="user-card locked" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
          <img class="user-card-avatar" src="${escAttr(avatar)}" alt="">
          <div><div class="user-card-name">${renderDisplayNameHTML(u, 'User')}</div><div class="user-card-stats">wants to be friends</div></div>
        </div>
        <div class="friend-actions-group">
          <button class="friend-action-btn friend-accept-btn" onclick="acceptFriendRequest('${escAttr(u.uid)}')">Accept</button>
          <button class="friend-action-btn friend-remove-btn" onclick="rejectFriendRequest('${escAttr(u.uid)}')">Decline</button>
        </div>
      </div>`;
    } else {
      html += `<div class="user-card locked" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
          <img class="user-card-avatar" src="${escAttr(avatar)}" alt="">
          <div><div class="user-card-name">${renderDisplayNameHTML(u, 'User')}</div><div class="user-card-stats">awaiting response</div></div>
        </div>
        <button class="friend-action-btn friend-remove-btn" onclick="cancelFriendRequest('${escAttr(u.uid)}')">Cancel</button>
      </div>`;
    }
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
  activeRequestsSubTab = 'friends';
  updateRequestSubtabUi();

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

async function renderFriendsList() {
  const grid = document.getElementById('friends-grid');
  const badge = document.getElementById('friends-count-badge');
  if (!grid || !badge) {
    console.error("Friends DOM is incomplete.");
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
  if (friends.length === 0) {
    badge.textContent = '';
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

  function buildFriendsListHtml(profiles) {
    let html = '';
    profiles.forEach(u => {
      if (!u) return;
      usersMap[u.uid] = { ...usersMap[u.uid], ...u };
      const avatar = u.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name || '?') + '&background=1e2028&color=60a5fa';
      html += `<div class="user-card friend-list-card" style="justify-content:space-between;">
        <div class="friend-card-main" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer;" onclick="viewUserFromMap('${u.uid}')">
          <img class="user-card-avatar" src="${avatar}" alt="">
          <div class="friend-card-copy"><div class="user-card-name">${renderDisplayNameHTML(u, 'User')}</div><div class="user-card-stats">Tap to view list</div></div>
        </div>
        <div class="friend-actions-group">
          <button class="friend-action-btn friend-mobile-list-btn friend-screenlist-btn" onclick="event.stopPropagation(); viewUserFromMap('${u.uid}')">Screen List</button>
          <button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button>
          <button class="friend-action-btn friend-profile-btn friend-mobile-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button>
          <button class="friend-action-btn friend-profile-btn friend-profile-desktop-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button>
          <button class="friend-action-btn friend-remove-btn friend-remove-desktop-btn" onclick="event.stopPropagation(); removeFriend('${u.uid}')">Remove</button>
          <button class="friend-mobile-remove-x" type="button" aria-label="Remove friend" onclick="event.stopPropagation(); confirmRemoveFriend('${u.uid}', '${escAttr(u.displayName || u.name || 'this friend')}')">×</button>
        </div>
      </div>`;
    });
    return html || `<div class="friends-empty" style="grid-column:1/-1;"><div class="friends-empty-icon">👥</div><p style="color:#7a6f99;">No friends found</p></div>`;
  }

  if (hasAllCachedProfiles) {
    grid.innerHTML = buildFriendsListHtml(cachedProfiles);
    return;
  }

  grid.innerHTML = '<div class="skeleton-card" style="grid-column:1/-1;"></div>';
  try {
    const profiles = await primeFriendProfiles(true);
    const normalizedProfiles = (profiles || [])
      .map((u, index) => u ? { ...u, uid: u.uid || friends[index] } : null)
      .filter(Boolean);
    grid.innerHTML = buildFriendsListHtml(normalizedProfiles);
  } catch(e) {
    grid.innerHTML = '<div class="app-error" style="grid-column:1/-1;">Failed to load friends. Try again in a moment.</div>';
    console.error(e);
  }
}


let peopleSearchGridOverrideId = '';

function getPeopleSearchGrid() {
  const override = String(peopleSearchGridOverrideId || '').trim();
  if (override) {
    const customGrid = document.getElementById(override);
    if (customGrid) return customGrid;
  }
  return document.getElementById('all-users-grid');
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
  const friendsGrid = document.getElementById('friends-grid');
  if (!resultsGrid || !friendsGrid) return;

  if (!q) {
    peopleSearchGridOverrideId = '';
    clearTimeout(filterInlineFriendSearch._timer);
    resultsGrid.style.display = 'none';
    resultsGrid.innerHTML = '';
    friendsGrid.style.display = '';
    return;
  }

  peopleSearchGridOverrideId = 'inline-friend-search-grid';
  resultsGrid.style.display = 'grid';
  friendsGrid.style.display = 'none';
  clearTimeout(filterInlineFriendSearch._timer);
  filterInlineFriendSearch._timer = setTimeout(() => {
    searchUsersByUsername(q);
  }, 180);
}

async function loadAllUsers() {
  initFindPeopleSearchView();
  return;
  const grid = getPeopleSearchGrid();
  if (!grid) return;
  grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
    <div class="friends-empty-icon">👥</div>
    <p style="color:#7a6f99;font-size:14px;">Loading people...</p>
    <p class="friends-empty-sub">Everyone is visible. Full lists require mutual adds.</p>
  </div>`;

  if (allUsersCache.length === 0) {
    try {
      const snap = await db.collection("users").get();
      allUsersCache = [];
      snap.forEach(doc => {
        const u = doc.data();
        if (u.uid !== currentUser.uid) {
          allUsersCache.push(u);
          usersMap[u.uid] = u;
        }
      });
    } catch (e) {
      console.error("Failed to load users:", e);
      grid.innerHTML = '<div class="friends-empty" style="grid-column:1/-1;"><div class="friends-empty-icon">⚠️</div><p>Could not load users</p><p class="friends-empty-sub">Try again in a moment.</p></div>';
      return;
    }
  }

  renderAllUsers(allUsersCache);
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
    user.usernameLower
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
      if (user.isPublic === false) return;
      if (!userMatchesPeopleSearch(user, normalized)) return;
      results.set(uid, user);
      usersMap[uid] = user;
    };

    const queryFields = ['nameLower', 'displayNameLower', 'customNameLower', 'usernameLower'];
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
    const avatar = u.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(u.name || '?') + '&background=1e2028&color=60a5fa');

    let action = '';
    if (isFriend) {
      action = `<div class="friend-actions-group"><button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button><button class="friend-action-btn friend-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button><button class="friend-action-btn friend-remove-btn" onclick="event.stopPropagation(); removeFriend('${u.uid}')">Remove</button></div>`;
    } else if (sentRequest) {
      action = isPublicCreator
        ? `<div class="friend-actions-group"><button class="friend-action-btn friend-profile-btn friend-message-btn" onclick="event.stopPropagation(); openDirectMessageFromUser('${u.uid}')">Message</button><button class="friend-action-btn friend-profile-btn" onclick="event.stopPropagation(); openUserProfile('${u.uid}')">Profile</button><button class="friend-action-btn friend-pending-btn" onclick="event.stopPropagation(); cancelFriendRequest('${u.uid}')" title="Tap to cancel">Pending</button></div>`
        : `<button class="friend-action-btn friend-pending-btn" onclick="event.stopPropagation(); cancelFriendRequest('${u.uid}')" title="Tap to cancel">Pending</button>`;
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

function legacyFilterPeople(query) {
  const q = (query || '').toLowerCase().trim();
  const grid = getPeopleSearchGrid();
  if (!grid) return;
  if (!q) {
    renderAllUsers(allUsersCache);
    return;
  }
  const filtered = allUsersCache.filter(u => (u.name || '').toLowerCase().includes(q));
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <p style="color:#7a6f99;font-size:14px;">No one found matching "${escHtml(query)}"</p>
      <p class="friends-empty-sub">Try a shorter name or different spelling.</p>
    </div>`;
    return;
  }
  renderAllUsers(filtered);
}

function filterPeople(query) {
  peopleSearchGridOverrideId = '';
  const q = (query || '').trim();
  const grid = getPeopleSearchGrid();
  if (!grid) return;
  if (!q) {
    allUsersCache = [];
    initFindPeopleSearchView();
    return;
  }
  clearTimeout(filterPeople._timer);
  filterPeople._timer = setTimeout(() => {
    searchUsersByUsername(q);
  }, 220);
}

// Re-run the current search (used after add/remove actions to refresh button states)
function refilterPeople() {
  const inlineInput = document.getElementById('friends-inline-search-input');
  const inlineGrid = document.getElementById('inline-friend-search-grid');
  if (inlineInput && inlineGrid && inlineGrid.style.display !== 'none') {
    filterInlineFriendSearch(inlineInput.value || '');
    return;
  }
  const input = document.querySelector('#find-people-view .find-search');
  filterPeople(input ? input.value : '');
}

function updateFriendsCountBadge() {
  const badge = document.getElementById('friends-count-badge');
  if (badge) badge.textContent = friends.length ? '(' + friends.length + ')' : '';
}

// Send a friend request (one-sided until accepted)
async function sendFriendRequest(uid) {
  if (!currentUser || uid === currentUser.uid) return;
  if (friends.includes(uid) || outgoingRequests.includes(uid)) return;
  if (incomingRequests.includes(uid)) { acceptFriendRequest(uid); return; }
  outgoingRequests.push(uid);
  allUsersCache = [];
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    await Promise.all([
      db.collection("users").doc(currentUser.uid).set({ outgoingRequests: arrayUnion(uid) }, { merge: true }),
      db.collection("users").doc(uid).set({ incomingRequests: arrayUnion(currentUser.uid) }, { merge: true })
    ]);
  } catch(e) {
    console.error("sendFriendRequest failed:", e);
    outgoingRequests = outgoingRequests.filter(f => f !== uid);
  }
  if (activeFriendsTab === 'find') refilterPeople();
  refreshProfileSocialModal();
  showToast("Friend request sent");
}

// Cancel a request I sent
async function cancelFriendRequest(uid) {
  outgoingRequests = outgoingRequests.filter(f => f !== uid);
  allUsersCache = [];
  try {
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await Promise.all([
      db.collection("users").doc(currentUser.uid).set({ outgoingRequests: arrayRemove(uid) }, { merge: true }),
      db.collection("users").doc(uid).set({ incomingRequests: arrayRemove(currentUser.uid) }, { merge: true })
    ]);
  } catch(e) { console.error("cancelFriendRequest failed:", e); }
  if (activeFriendsTab === 'requests') renderRequestsList();
  if (activeFriendsTab === 'find') refilterPeople();
  refreshProfileSocialModal();
  showToast("Request canceled");
}

// Accept a request someone sent me — both become friends
async function acceptFriendRequest(uid) {
  incomingRequests = incomingRequests.filter(f => f !== uid);
  if (!friends.includes(uid)) friends.push(uid);
  allUsersCache = [];
  try {
    const arrayUnion = firebase.firestore.FieldValue.arrayUnion;
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await Promise.all([
      db.collection("users").doc(currentUser.uid).set({
        incomingRequests: arrayRemove(uid),
        friends: arrayUnion(uid)
      }, { merge: true }),
      db.collection("users").doc(uid).set({
        outgoingRequests: arrayRemove(currentUser.uid),
        friends: arrayUnion(currentUser.uid)
      }, { merge: true })
    ]);
  } catch(e) { console.error("acceptFriendRequest failed:", e); }
  updateRequestsBadges();
  updateFriendsCountBadge();
  if (activeFriendsTab === 'requests') renderRequestsList();
  if (activeFriendsTab === 'friends') renderFriendsList();
  if (activeFriendsTab === 'find') refilterPeople();
  refreshProfileSocialModal();
  showToast("Friend added");
}

// Decline a request someone sent me
async function rejectFriendRequest(uid) {
  incomingRequests = incomingRequests.filter(f => f !== uid);
  try {
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await Promise.all([
      db.collection("users").doc(currentUser.uid).set({ incomingRequests: arrayRemove(uid) }, { merge: true }),
      db.collection("users").doc(uid).set({ outgoingRequests: arrayRemove(currentUser.uid) }, { merge: true })
    ]);
  } catch(e) { console.error("rejectFriendRequest failed:", e); }
  updateRequestsBadges();
  if (activeFriendsTab === 'requests') renderRequestsList();
  refreshProfileSocialModal();
  showToast("Request declined");
}

function confirmRemoveFriend(uid, name) {
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
  friends = friends.filter(f => f !== uid);
  allUsersCache = [];
  try {
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove;
    await Promise.all([
      db.collection("users").doc(currentUser.uid).set({ friends: arrayRemove(uid) }, { merge: true }),
      db.collection("users").doc(uid).set({ friends: arrayRemove(currentUser.uid) }, { merge: true })
    ]);
  } catch(e) { console.error("removeFriend failed:", e); }
  updateFriendsCountBadge();
  if (activeFriendsTab === 'friends') renderFriendsList();
  else if (activeFriendsTab === 'find') refilterPeople();
  refreshProfileSocialModal();
  showToast("Friend removed");
}

// View another user's list — only allowed if mutually friends
async function viewUserList(uid, name, photo) {
  if (isPreviewMode()) {
    openPreviewCommunityProfile(uid);
    return;
  }
  if (currentUser && uid === currentUser.uid) {
    switchMainNav('mylist');
    return;
  }
  const sourceUser = { ...(usersMap[uid] || {}), uid, name, photo };
  // Privacy: must be in my friends list
  if (!friends.includes(uid)) {
    showPrivateModal();
    return;
  }
  // Defense in depth: confirm they also have me as a friend
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const theirProfileData = userDoc.exists ? (userDoc.data() || {}) : {};
    usersMap[uid] = { ...(usersMap[uid] || {}), ...theirProfileData, uid };
    sourceUser.listTabVisibility = normalizeListTabVisibility(theirProfileData.listTabVisibility);
    sourceUser.ratingPreferences = normalizeRatingPreferences(theirProfileData.ratingPreferences);
    const theirFriends = (userDoc.exists && userDoc.data().friends) || [];
    if (!theirFriends.includes(currentUser.uid)) {
      showPrivateModal();
      return;
    }
  } catch(e) {
    console.error("Privacy check failed:", e);
    return;
  }
  if (!viewingUser) {
    const freshOwnData = await loadOwnDataFromFirestore();
    myData = cloneListData(freshOwnData);
    data = cloneListData(freshOwnData);
    ownDataCache = cloneListData(freshOwnData);
  }
  viewingReturnTab = getActiveMainTab ? getActiveMainTab() : 'community';
  viewingUser = sourceUser;
  let loadFailed = false;
  try {
    friendViewData = await loadWatchlistDataFromDocRef(db.collection("watchlist").doc(uid), getEmptyListData());
  } catch(e) {
    console.error("Failed to load user list:", e);
    friendViewData = getEmptyListData();
    loadFailed = true;
  }
  friendViewData = await autoSortAnimeBuckets(normalizeListData(friendViewData), false);
  await loadWatchTogetherGroupsForOwner(uid);
  clearListSearch();
  
  // Add class to body for viewing user styling
  document.body.classList.add('viewing-other-user');
  
  const communityView = document.getElementById('community-view');
  const myListView = document.getElementById('mylist-view');
  const myListHeader = document.getElementById('mylist-header');
  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');
  if (communityView) communityView.style.display = 'none';
  if (myListView) myListView.style.display = 'block';
  if (myListHeader) myListHeader.style.display = 'block';
  if (addBtn) addBtn.style.display = 'none';
  if (bannerArea) bannerArea.innerHTML = `<div class="viewing-banner friend-list-viewing-banner">
    <div class="viewing-user-profile-center">
      <img src="${photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=1e2028&color=60a5fa'}" class="viewing-user-avatar" alt="">
      <div class="viewing-user-name">${renderDisplayNameHTML(sourceUser, 'Friend', 'creator-name-soft')}</div>
    </div>
    <div class="viewing-banner-divider" aria-hidden="true"></div>
    <div class="viewing-banner-actions">
      <button class="back-btn profile-view-btn" onclick="openUserProfile('${uid}')">View Profile</button>
      <button class="back-btn friend-list-dm-btn" onclick="openDirectMessageFromUser('${uid}')">Direct Message</button>
    </div>
    <button class="friend-list-floating-back-btn" type="button" onclick="backToMyList()" aria-label="Back">‹</button>
  </div>`;
  const initialView = chooseInitialListView(friendViewData);
  activeSection = initialView.section;
  activeTab = normalizeVisibleMyListStatusTab(initialView.tab, activeSection);
  render();
  persistUiState();
  if (loadFailed) {
    const grid = document.getElementById('cards-grid');
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'none';
    if (grid) grid.innerHTML = '<div class="app-error" style="grid-column:1/-1;">This list could not load. Try again in a moment.</div>';
  }
}

async function backToMyList(targetTab = null) {
  const previousFriendData = friendViewData ? cloneListData(friendViewData) : null;
  const returnTab = targetTab || viewingReturnTab || 'mylist';
  if (landingPublicProfileActive && !currentUser && returnTab === 'landing') {
    viewingUser = null;
    friendViewData = null;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    document.body.classList.remove('viewing-other-user', 'landing-public-lists', 'profile-active');
    showLandingPage();
    return;
  }
  viewingUser = null;
  friendViewData = null;
  
  // Remove viewing user styling
  document.body.classList.remove('viewing-other-user');

  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');

  if (addBtn) addBtn.style.display = '';
  if (bannerArea) bannerArea.innerHTML = '';
  setBottomNavVisibility(true);
  syncMainNavButtons(returnTab);
  setMainNavVisibility(returnTab);

  if (isPreviewMode()) {
    const previewOwnData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(DEMO_DATA);
    clearListSearch();
    data = cloneListData(previewOwnData);
    if (returnTab === 'community') {
      loadCommunity();
      loadFriendActivity();
    }
    else if (returnTab === 'discover' || returnTab === 'games-discover') {
      if (returnTab === 'games-discover') activeDiscoveryHub = 'gaming';
      loadActiveDiscoveryHub();
    }
    else {
      activeSection = "shows";
      activeTab = "watching";
      render();
    }
    persistUiState();
    return;
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

  clearListSearch();

  data = cloneListData(freshOwnData);
  ownDataCache = cloneListData(freshOwnData);
  myData = null;
  if (currentUser) localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(freshOwnData));
  if (returnTab === 'community') {
    loadCommunity();
    loadFriendActivity();
  }
  else if (returnTab === 'discover' || returnTab === 'games-discover') {
    if (returnTab === 'games-discover') activeDiscoveryHub = 'gaming';
    loadActiveDiscoveryHub();
  }
  else {
    activeSection = "shows";
    activeTab = "watching";
    render();
  }
  persistUiState();
}
