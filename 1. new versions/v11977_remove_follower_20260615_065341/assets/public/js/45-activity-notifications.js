/* =============================================================
   45-activity-notifications.js
   Friends/activity notification writer, listener, renderer,
   backfill, and notification target routing.

   Extracted from 10-activity-feed.js so activity card rendering
   and notification plumbing can evolve independently.
   ============================================================= */

/* =============================================================================
   v10.145: NOTIFICATIONS MODULE — clean rebuild from scratch.

   Replaces the prior ~800-line implementation that had hydration races,
   multi-source backfills, signature-cached renders, and false empty states.

   Architecture:
     collection:  notifications/{recipientUid}/items/{notificationId}
     window:      last 11 days (1.5 weeks)
     storage:     one module-scoped array `activityNotificationsList`
     live update: one onSnapshot listener, attached when the tab is opened
     render:      one renderNotificationsList() — draws the full array

   Supported types:
     - activity_like      (friend liked your activity card)
     - activity_comment   (friend commented on your activity card)
     - friend_review_posted (friend posted a full review)
     - friend_request     (friend sent you a friend request)
     - friend_accept      (friend accepted your friend request)
     - shared_watch_request (friend requested Shared Watch approval)

   Deterministic doc IDs prevent duplicates:
     activity_like:{activityId}:{actorUid}
     activity_comment:{activityId}:{commentId|actorUid}
     friend_review_posted:{activityId}:{actorUid}
     friend_request:{actorUid}
     friend_accept:{actorUid}
     shared_watch_request:{groupId}:{actorUid}
   (recipientUid is the parent doc ID, so it doesn't need to be in the
   child ID.)
   ============================================================================= */

const SHELFD_NOTIFICATIONS_WINDOW_MS = 11 * 24 * 60 * 60 * 1000;
const SHELFD_NOTIFICATIONS_LISTENER_LIMIT = 80;
const SHELFD_NOTIFICATIONS_VALID_TYPES = ['activity_like', 'activity_comment', 'friend_review_posted', 'friend_highlight_posted', 'friend_request', 'friend_accept', 'shared_watch_request'];
/* v11.606: types that still WRITE a notification doc (so the push fan-out — which
   is gated behind that write — still fires) but are HIDDEN from the in-app
   Notifications tab. The Notifications tab is for things that interacted with
   YOUR account (likes/comments on your posts, friend requests/accepts, watch
   requests). A friend posting a full review is content, not an interaction with
   you — you still get the push, but it doesn't clutter the tab or the unread
   badge. (Keep these IN SHELFD_NOTIFICATIONS_VALID_TYPES so the doc write/push
   are unaffected; this list only controls DISPLAY.) */
const SHELFD_NOTIFICATIONS_HIDDEN_FROM_TAB = ['friend_review_posted'];

let activityNotificationsList = [];
let activityNotificationsLoadedOnce = false;
let activityNotificationsUnsubscribe = null;
let activityNotificationsListenerUid = '';
let activityNotificationsBackfillRanForUid = '';
let activityNotificationsUnreadCount = 0;

function getShelfdNotificationCutoffMs() {
  return Date.now() - SHELFD_NOTIFICATIONS_WINDOW_MS;
}

function sanitizeShelfdNotifIdPart(value = '') {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean ? clean.slice(0, 96) : 'x';
}

function buildShelfdNotificationDocId(options = {}) {
  const type = String(options.type || '').trim();
  const activity = sanitizeShelfdNotifIdPart(options.targetActivityId || '');
  const actor = sanitizeShelfdNotifIdPart(options.actorUid || '');
  if (type === 'activity_like') return `activity_like:${activity}:${actor}`;
  if (type === 'activity_comment') {
    const comment = sanitizeShelfdNotifIdPart(options.targetCommentId || options.actorUid || '');
    return `activity_comment:${activity}:${comment}`;
  }
  if (type === 'friend_review_posted') return `friend_review_posted:${activity}:${actor}`;
  if (type === 'friend_highlight_posted') return `friend_highlight_posted:${activity}:${actor}`;
  if (type === 'friend_request') return `friend_request:${actor}`;
  if (type === 'friend_accept') return `friend_accept:${actor}`;
  if (type === 'shared_watch_request') return `shared_watch_request:${activity}:${actor}`;
  return `${sanitizeShelfdNotifIdPart(type)}:${activity}:${actor}`;
}

function getShelfdNotificationActorProfile(actorUid = '') {
  const uid = String(actorUid || '').trim();
  const isSelf = currentUser && currentUser.uid === uid;
  const fromMap = (typeof usersMap === 'object' && usersMap && uid && usersMap[uid]) ? usersMap[uid] : {};
  const fromSelf = isSelf ? (userProfile || currentUser || {}) : {};
  const merged = { ...fromSelf, ...fromMap };
  const actorName = (typeof getDisplayName === 'function')
    ? getDisplayName(merged, merged.displayName || merged.name || (isSelf ? (currentUser && currentUser.displayName) : '') || 'Shelfd user')
    : (merged.displayName || merged.name || 'Shelfd user');
  const rawHandle = String(
    merged.usernameHandle ||
    merged.userHandle ||
    merged.handle ||
    merged.username ||
    merged.usernameHandleLower ||
    merged.handleLower ||
    merged.usernameLower ||
    ''
  ).trim().replace(/^@+/, '');
  const actorHandle = rawHandle ? '@' + rawHandle : '';
  const actorPhoto = merged.photo || merged.photoURL || (isSelf && currentUser ? currentUser.photoURL : '') || '';
  return { actorName, actorPhoto, actorHandle };
}

function getShelfdNotificationActivityMedia(activity = {}) {
  if (!activity || typeof activity !== 'object') return { mediaTitle: '', mediaPoster: '' };
  const item = activity.item || {};
  const content = activity.content || {};
  const title = String(
    item.title ||
    item.name ||
    content.mediaTitle ||
    content.trailerTitle ||
    content.text ||
    activity.commentText ||
    ''
  ).trim();
  let poster = '';
  if (typeof getScreenListActivityItemCover === 'function') {
    try { poster = getScreenListActivityItemCover(item) || ''; } catch (e) {}
  }
  if (!poster) poster = item.cover || item.poster || content.trailerCover || content.poster || content.thumbnail || '';
  return { mediaTitle: title, mediaPoster: poster };
}

function getActivityNotificationOwnerUid(activity = {}) {
  if (!activity || typeof activity !== 'object') return '';
  return String(activity.uid || activity.ownerUid || activity.userId || '').trim();
}

function parseShelfdNotificationMs(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof parseFriendActivityTime === 'function') {
    try {
      const ms = parseFriendActivityTime(value);
      if (ms) return ms;
    } catch (e) {}
  }
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ---------- Central writer ----------
   Single source of truth for creating a notification doc. Used by both
   live trigger paths (like / comment / friend events) and the one-shot
   backfill. Self-notifications are blocked at the door; duplicate writes
   are no-ops because doc IDs are deterministic and we use set+merge. */
async function createActivityNotification(options = {}) {
  if (!currentUser || !db) return false;
  const recipientUid = String(options.recipientUid || '').trim();
  const actorUid = String(options.actorUid || currentUser.uid || '').trim();
  let type = String(options.type || '').trim();

  /* v10.145: Type normalization — older trigger sites passed 'feed_like',
     'comment_reply', or 'comment_like'. Collapse legacy aliases to the
     canonical types or drop the write. */
  if (type === 'feed_like') type = 'activity_like';
  if (type === 'comment_reply') type = 'activity_comment';
  if (!SHELFD_NOTIFICATIONS_VALID_TYPES.includes(type)) return false;

  if (!recipientUid || !actorUid) return false;
  if (recipientUid === actorUid) return false;
  if (typeof window.isShelfdNotificationTypeEnabledForRecipient === 'function') {
    try {
      const allowed = await window.isShelfdNotificationTypeEnabledForRecipient(recipientUid, type);
      if (allowed === false) return false;
    } catch (_) {}
  }

  const activity = options.activity || {};
  const media = { ...getShelfdNotificationActivityMedia(activity), ...(options.media || {}) };
  /* v11.392: capture the liked post's kind so a "like" notification can read
     "liked your highlight" / "liked your review of {media}" instead of the
     generic "liked your activity." Only highlight + review get special copy. */
  const likedPostEventType = String(activity.eventType || activity.type || '').trim().toLowerCase();
  const postEventType = (likedPostEventType === 'highlight' || likedPostEventType === 'review' || likedPostEventType === 'media-review')
    ? (likedPostEventType === 'media-review' ? 'review' : likedPostEventType)
    : '';
  const actor = getShelfdNotificationActorProfile(actorUid);
  const docId = buildShelfdNotificationDocId({ ...options, recipientUid, actorUid, type });
  const nowMs = Date.now();
  const eventMs = Number(options.createdAtMs || nowMs) || nowMs;

  const payload = {
    notificationId: docId,
    recipientUid,
    actorUid,
    actorName: String(options.actorName || (type === 'friend_request' ? (actor.actorHandle || actor.actorName) : actor.actorName) || 'Shelfd user').trim(),
    actorPhoto: String(options.actorPhoto || actor.actorPhoto || '').trim(),
    type,
    targetActivityId: String(options.targetActivityId || '').trim(),
    targetCommentId: String(options.targetCommentId || '').trim(),
    /* v11.408: distinguishes review-page comment notifications so the copy can
       read "commented on your review" (commentContext:'review', recipient = the
       review owner) vs "replied to your comment" (commentContext:'reply',
       recipient = the parent comment's author). Empty for all other comments. */
    commentContext: String(options.commentContext || '').trim(),
    parentCommentId: String(options.parentCommentId || '').trim(),
    targetKind: String(options.targetKind || (type.startsWith('activity_') ? 'activity' : 'friend_request')).trim(),
    targetCollection: String(options.targetCollection || '').trim(),
    postEventType,
    watchTogetherGroupId: String(options.watchTogetherGroupId || '').trim(),
    watchTogetherMode: String(options.watchTogetherMode || '').trim(),
    watchTogetherSection: String(options.watchTogetherSection || '').trim(),
    mediaTitle: String(media.mediaTitle || '').trim(),
    mediaPoster: String(media.mediaPoster || '').trim(),
    textSnippet: String(options.textSnippet || '').trim().slice(0, 180),
    createdAtMs: eventMs,
    updatedAtMs: nowMs,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  /* v10.293: only stamp `read: false` on FRESH writes (non-backfill). The
     backfill runs on every session and was re-writing `read: false` over
     notifications the user had previously marked read — so dismissed
     notifications kept resurfacing. By omitting `read` from backfill
     payloads, the existing read state (true OR false) is preserved by
     Firestore's merge. Live triggers (new likes/comments) still set
     `read: false` because the doc didn't exist yet — set+merge creates
     it with that initial value. */
  if (options.backfilled) {
    payload.backfilled = true;
    payload.backfilledAtMs = nowMs;
  } else {
    payload.read = false;
  }

  try {
    const ref = db.collection('notifications').doc(recipientUid).collection('items').doc(docId);
    await ref.set(payload, { merge: true });
    /* v10.275: fire push notification via the Cloudflare Worker. Fire-and-forget;
       failures are non-fatal and just log. Skip pushes for backfilled docs
       (those represent past events the user has already seen in-app). */
    if (!options.backfilled) {
      try {
        /* v11.588: two-line lock-screen layout. iOS renders the push title
           BOLD on line 1 and the body on line 2, so the actor's NAME goes in
           the title ALONE (bold) and the action goes in the body:
             SALLY MAY                 ← line 1 (bold)
             Posted a review of …      ← line 2
           getShelfdNotificationPushBody builds the action WITHOUT the name
           (comment pushes also append the comment text). Previously the whole
           "Name + action" sentence was crammed into the title with an empty
           body, so it rendered as one bold line. */
        const pushTitle = String(payload.actorName || '').trim() || 'Shelfd';
        const pushBody = getShelfdNotificationPushBody(payload);
        fetch('/api/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          body: JSON.stringify({
            recipientUid,
            notificationId: docId,
            title: pushTitle,
            body: pushBody,
            data: {
              notificationId: docId,
              type,
              targetActivityId: payload.targetActivityId || '',
              targetCommentId: payload.targetCommentId || '',
              targetKind: payload.targetKind || '',
              targetCollection: payload.targetCollection || '',
              watchTogetherGroupId: payload.watchTogetherGroupId || '',
              watchTogetherMode: payload.watchTogetherMode || '',
              watchTogetherSection: payload.watchTogetherSection || ''
            }
          })
        }).catch(() => {});
      } catch (_) {}
    }
    return true;
  } catch (error) {
    console.warn('[shelfd notifications] create failed:', error && error.message ? error.message : error);
    return false;
  }
}

async function markActivityNotificationRead(notificationId = '') {
  if (!currentUser || !db || !notificationId) return;
  try {
    await db.collection('notifications').doc(currentUser.uid).collection('items').doc(String(notificationId)).set({
      read: true,
      updatedAtMs: Date.now(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.warn('[shelfd notifications] mark read failed:', error && error.message ? error.message : error);
  }
}

/* ---------- Live listener ---------- */

function applyShelfdNotificationsSnapshot(snapshot) {
  const cutoffMs = getShelfdNotificationCutoffMs();
  const docs = (snapshot && snapshot.docs ? snapshot.docs : []).map(doc => {
    const data = doc.data() || {};
    return { notificationId: doc.id, ...data };
  });
  /* Filter by supported types + 11-day window, then dedupe by
     (type|actor|target|comment) so older docs with the legacy ID format
     don't render alongside the new deterministic IDs. */
  const filtered = docs
    .filter(item => SHELFD_NOTIFICATIONS_VALID_TYPES.includes(String(item.type || '')))
    /* v11.606: hide doc-only types (e.g. friend_review_posted) from the tab +
       unread badge — the push already fired; the tab is for interactions with
       your account, not friends' posted content. */
    .filter(item => !SHELFD_NOTIFICATIONS_HIDDEN_FROM_TAB.includes(String(item.type || '')))
    .filter(item => Number(item.createdAtMs || 0) >= cutoffMs);
  filtered.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  const seenKeys = new Set();
  activityNotificationsList = filtered.filter(item => {
    const key = `${item.type}|${item.actorUid}|${item.targetActivityId || ''}|${item.targetCommentId || ''}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  activityNotificationsLoadedOnce = true;
  /* v11.975: track every unresolved-looking friend_request actor so the shelf
     Confirm/Delete banner works even when you open a requester's profile without
     a push (the determiner consults this set as a reliable signal). */
  try {
    activityNotificationsList.forEach(n => {
      if (n && String(n.type || '') === 'friend_request' && String(n.targetKind || '') !== 'creator_auto_add') {
        rememberShelfdFollowRequestUid(String(n.actorUid || ''));
      }
    });
  } catch (e) {}
  updateShelfdNotificationsUnreadBadge();
  /* v11.848: a friend_accept here is an independent signal that someone accepted
     my follow request. Reconcile so a stuck "Requested" flips into the friends
     list even if the realtime friend listener lagged or the webview was
     suspended. No-op in steady state (they're already promoted). */
  if (typeof reconcileFriendAcceptsFromNotifications === 'function') {
    try {
      const acceptUids = activityNotificationsList
        .filter(n => String(n.type || '') === 'friend_accept')
        .map(n => String(n.actorUid || '').trim())
        .filter(Boolean);
      if (acceptUids.length) reconcileFriendAcceptsFromNotifications(acceptUids);
    } catch (e) { console.warn('[shelfd] friend_accept reconcile failed:', e && e.message ? e.message : e); }
  }
  /* v11.590: live-re-render the list when the Notifications Friends-tab is open
     (it used to be gated on the Activity 'notifications' sub-tab). */
  if (typeof activeFriendsTab !== 'undefined' && activeFriendsTab === 'notifications') {
    renderActivityNotificationsList();
  }
}

function attachShelfdNotificationsListener() {
  if (!currentUser || !db) return;
  const uid = String(currentUser.uid || '').trim();
  if (!uid) return;
  if (activityNotificationsUnsubscribe && activityNotificationsListenerUid === uid) return;
  if (activityNotificationsUnsubscribe && activityNotificationsListenerUid !== uid) stopActivityNotificationsLiveListener();
  activityNotificationsListenerUid = uid;
  try {
    activityNotificationsUnsubscribe = db.collection('notifications')
      .doc(uid)
      .collection('items')
      .orderBy('createdAtMs', 'desc')
      .limit(SHELFD_NOTIFICATIONS_LISTENER_LIMIT)
      .onSnapshot(applyShelfdNotificationsSnapshot, error => {
        console.warn('[shelfd notifications] listener error:', error && error.message ? error.message : error);
      });
  } catch (error) {
    console.warn('[shelfd notifications] listener setup failed:', error && error.message ? error.message : error);
  }
}

function stopActivityNotificationsLiveListener() {
  if (activityNotificationsUnsubscribe) {
    try { activityNotificationsUnsubscribe(); } catch (e) {}
  }
  activityNotificationsUnsubscribe = null;
  activityNotificationsListenerUid = '';
}

function updateShelfdNotificationsUnreadBadge() {
  const unreadItems = activityNotificationsList.filter(item => item.read !== true);
  activityNotificationsUnreadCount = unreadItems.length;
  window.activityNotificationsUnreadCount = activityNotificationsUnreadCount;
  /* v11.965: split friend-request notifications out of the Notifications-tab
     count. Incoming friend requests render inline at the top of the FRIENDS
     list, so they ping the Friends tab — not Notifications. The Notifications
     tab badge uses the non-request count; the bottom-nav union keeps the full
     count so a request still pings the nav even if the friends doc lags. */
  const friendRequestUnread = unreadItems.filter(item => String(item && item.type || '') === 'friend_request').length;
  window.activityNotificationsFriendRequestUnreadCount = friendRequestUnread;
  window.activityNotificationsNonRequestUnreadCount = activityNotificationsUnreadCount - friendRequestUnread;
  if (typeof updateRequestsBadges === 'function') {
    try { updateRequestsBadges(); } catch (e) {}
  }
}

/* ---------- Rendering ---------- */

/* v11.588: action line for the PUSH BODY (line 2 on the lock screen). iOS
   renders the push title bold on line 1, the body on line 2 — the actor name
   now goes in the title ALONE, so this returns the action in natural prose
   WITHOUT the name (e.g. "Posted a review of Obsession"). Comment pushes append
   the actual comment text so the recipient sees what was said. Mirrors the
   in-app card's getShelfdNotificationActionLine vocabulary, in prose form.
   (Replaced the old getShelfdNotificationCopy, which built the full
   "Name + action" sentence used as a single bold title line.) */
function getShelfdNotificationPushBody(notification = {}) {
  const type = String(notification.type || '').trim();
  const targetKind = String(notification.targetKind || '').trim();
  const mediaTitle = String(notification.mediaTitle || '').trim();
  const snippet = String(notification.textSnippet || '').trim();
  const ofMedia = mediaTitle ? ` of ${mediaTitle}` : '';
  if (type === 'activity_like') {
    const pet = String(notification.postEventType || '').trim().toLowerCase();
    if (pet === 'highlight') return 'Liked your highlight';
    if (pet === 'review') return `Liked your review${ofMedia}`;
    return `Liked your activity${ofMedia}`;
  }
  if (type === 'activity_comment') {
    const ctx = String(notification.commentContext || '').trim().toLowerCase();
    let action;
    if (ctx === 'reply') action = 'Replied to your comment';
    else if (ctx === 'review') action = `Commented on your review${ofMedia}`;
    else action = `Commented on your activity${ofMedia}`;
    return snippet ? `${action}: ${snippet}` : action;
  }
  if (type === 'friend_review_posted') return `Posted a review${ofMedia}`;
  if (type === 'friend_highlight_posted') return mediaTitle ? `Shared a new highlight reel from ${mediaTitle}` : 'Shared a new highlight reel';
  if (type === 'friend_request' && targetKind === 'creator_auto_add') return 'Added you as a friend';
  if (type === 'friend_request') return 'requested to add you as a friend';
  if (type === 'friend_accept') return 'Accepted your friend request';
  if (type === 'shared_watch_request') {
    const mode = String(notification.watchTogetherMode || '').trim();
    const mediaPart = mediaTitle || 'this title';
    return mode === 'planned'
      ? `Wants to watch ${mediaPart} with you`
      : `Confirmed you watched ${mediaPart} together`;
  }
  return 'Interacted with your activity';
}

/* v11.550: action line for the in-app notification card. The actor name renders
   on its own bold top line now, so this returns the action WITHOUT the name and
   appends " • {media title}" when the notification carries one — e.g.
   "Liked your review • Obsession". (getShelfdNotificationPushBody above builds
   the prose action used for the PUSH body; the push title is now the actor
   name alone.) */
function getShelfdNotificationActionLine(notification = {}) {
  const type = String(notification.type || '').trim();
  const targetKind = String(notification.targetKind || '').trim();
  const mediaTitle = String(notification.mediaTitle || '').trim();
  const withMedia = (action) => mediaTitle ? `${action} • ${mediaTitle}` : action;
  if (type === 'activity_like') {
    const pet = String(notification.postEventType || '').trim().toLowerCase();
    if (pet === 'highlight') return withMedia('Liked your highlight');
    if (pet === 'review') return withMedia('Liked your review');
    return withMedia('Liked your activity');
  }
  if (type === 'activity_comment') {
    const ctx = String(notification.commentContext || '').trim().toLowerCase();
    if (ctx === 'reply') return 'Replied to your comment';
    if (ctx === 'review') return withMedia('Commented on your review');
    return withMedia('Commented on your activity');
  }
  if (type === 'friend_review_posted') return withMedia('Posted a review');
  if (type === 'friend_highlight_posted') return withMedia('Shared a highlight reel');
  if (type === 'friend_request' && targetKind === 'creator_auto_add') return 'Added you as a friend';
  if (type === 'friend_request') return 'requested to add you as a friend';
  if (type === 'friend_accept') return 'Accepted your friend request';
  if (type === 'shared_watch_request') {
    const mode = String(notification.watchTogetherMode || '').trim();
    const mediaPart = mediaTitle || 'this title';
    return mode === 'planned'
      ? `Wants to watch ${mediaPart} with you`
      : `Confirmed you watched ${mediaPart} together`;
  }
  return 'Interacted with your activity';
}

function getShelfdNotificationRelativeTime(notification = {}) {
  const ms = Number(notification.createdAtMs || 0);
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

/* v11.972: live relationship-list readers. The friend globals live in
   16-friends-requests.js (top-level `let`s — accessible cross-script by name,
   but NOT on window), so read window.* first, then the bare global. */
function notifIncomingRequestsList() {
  if (Array.isArray(window.incomingRequests)) return window.incomingRequests;
  return (typeof incomingRequests !== 'undefined' && Array.isArray(incomingRequests)) ? incomingRequests : [];
}
function notifFriendsList() {
  if (Array.isArray(window.friends)) return window.friends;
  return (typeof friends !== 'undefined' && Array.isArray(friends)) ? friends : [];
}
function notifOutgoingRequestsList() {
  if (Array.isArray(window.outgoingRequests)) return window.outgoingRequests;
  return (typeof outgoingRequests !== 'undefined' && Array.isArray(outgoingRequests)) ? outgoingRequests : [];
}
function notifPendingFollowBackList() {
  if (Array.isArray(window.pendingFollowBackUids)) return window.pendingFollowBackUids;
  return (typeof pendingFollowBackUids !== 'undefined' && Array.isArray(pendingFollowBackUids)) ? pendingFollowBackUids : [];
}
/* v11.974: these two read from MY OWN user doc (the primary realtime listener),
   so they're reliable — unlike incomingRequests, which is derived from a
   cross-user `array-contains` query that lags on iOS suspend/resume. They tell
   me whether I've already ACCEPTED or DECLINED a given requester. */
function notifAcceptedFollowerList() {
  if (Array.isArray(window.ownAcceptedFollowerRequestIds)) return window.ownAcceptedFollowerRequestIds;
  return (typeof ownAcceptedFollowerRequestIds !== 'undefined' && Array.isArray(ownAcceptedFollowerRequestIds)) ? ownAcceptedFollowerRequestIds : [];
}
function notifRejectedRequestsList() {
  if (Array.isArray(window.ownRejectedFriendRequestIds)) return window.ownRejectedFriendRequestIds;
  return (typeof ownRejectedFriendRequestIds !== 'undefined' && Array.isArray(ownRejectedFriendRequestIds)) ? ownRejectedFriendRequestIds : [];
}

/* v11.976: action button(s) for a friend_request notification card.
   Follows are ONE-WAY. A friend_request notification is about THEIR request to
   follow ME, and that request is resolved ONLY by whether I've accepted/declined
   THEM — NOT by whether I follow them. (Critical case: they accepted my request
   so I follow them → they're in my `friends` → but they can still separately
   request to follow me back, which I must be able to Accept/Deny. Gating on
   `friends` here wrongly showed "Following" and hid that pending request.)
   Resolution uses persisted MY-OWN-doc data (reliable, no laggy derived query):
     • I accepted their request (they follow me) → Follow / Requested / Following
       (my follow-back status toward them)
     • I declined their request                  → no buttons
     • otherwise (their request still pending)    → Accept / Deny
   Follow / Requested / Following reuse toggleFriendListFollow so behaviour
   matches every other follow surface in the app. */
function buildNotifFriendRequestActionsHTML(actorUid, notificationId) {
  const u = String(actorUid || '').trim();
  const id = String(notificationId || '').trim();
  if (!u || !currentUser || u === currentUser.uid) return '';
  if (typeof isPreviewMode === 'function' && isPreviewMode()) return '';
  const a = (typeof escAttr === 'function') ? escAttr : (v) => String(v || '');
  /* I've ACCEPTED their request (they follow me) → offer to follow them back,
     showing my live follow status TOWARD them. */
  if (notifAcceptedFollowerList().includes(u) || notifPendingFollowBackList().includes(u)) {
    if (notifFriendsList().includes(u)) {
      return `<button type="button" class="shelfd-notif-request-btn secondary is-following" onclick="event.stopPropagation(); toggleFriendListFollow('${a(u)}')">Following</button>`;
    }
    if (notifOutgoingRequestsList().includes(u)) {
      return `<button type="button" class="shelfd-notif-request-btn secondary is-requested" aria-label="Requested — tap to cancel" onclick="event.stopPropagation(); toggleFriendListFollow('${a(u)}')">Requested</button>`;
    }
    return `<button type="button" class="shelfd-notif-request-btn primary is-follow" onclick="event.stopPropagation(); toggleFriendListFollow('${a(u)}')">Follow</button>`;
  }
  /* I declined their request → no action. */
  if (notifRejectedRequestsList().includes(u)) return '';
  /* Default: their request to follow me is still pending → Accept / Deny. */
  return `<button type="button" class="shelfd-notif-request-btn primary" onclick="event.stopPropagation(); handleShelfdNotificationFriendRequest('${a(u)}','accept','${a(id)}')">Accept</button>`
    + `<button type="button" class="shelfd-notif-request-btn secondary" onclick="event.stopPropagation(); handleShelfdNotificationFriendRequest('${a(u)}','deny','${a(id)}')">Deny</button>`;
}

/* v11.975: uids we KNOW have an unresolved follow request to us, captured the
   instant we see the request — straight from a friend_request PUSH tap (before
   any listener has returned a snapshot) and from every notifications snapshot.
   The shelf Confirm/Delete banner trusts this set so it can't miss a request just
   because the incoming-requests query / notifications list hadn't loaded yet when
   the shelf painted (the exact cold-push-start failure that hid the banner). */
window.shelfdKnownFollowRequestUids = window.shelfdKnownFollowRequestUids || (typeof Set !== 'undefined' ? new Set() : null);
function rememberShelfdFollowRequestUid(uid) {
  const u = String(uid || '').trim();
  if (u && window.shelfdKnownFollowRequestUids) window.shelfdKnownFollowRequestUids.add(u);
}

/* v11.974: shared "does this user have an unresolved follow request to me?"
   determiner for the shelf Confirm/Delete banner. Resolved state comes from my
   OWN user doc (reliable); the "they requested me" signal is, in order: a uid we
   captured from the push/notifications (v11.975), a friend_request notification,
   or the derived incoming list — so the banner can't silently miss a request just
   because the cross-user derived query lagged. */
function shelfdActorRequestedMeUnresolved(uid) {
  const u = String(uid || '').trim();
  if (!u || !currentUser || u === currentUser.uid) return false;
  /* v11.976: resolved ONLY by whether I accepted/declined THEIR request — not by
     whether I follow them. I can follow someone and still owe a response to their
     request to follow me back (one-way follows), so do NOT early-return on friends. */
  if (notifAcceptedFollowerList().includes(u)) return false;
  if (notifPendingFollowBackList().includes(u)) return false;
  if (notifRejectedRequestsList().includes(u)) return false;
  if (window.shelfdKnownFollowRequestUids && window.shelfdKnownFollowRequestUids.has(u)) return true;
  const hasRequestNotif = Array.isArray(activityNotificationsList) && activityNotificationsList.some(n =>
    n && String(n.type || '') === 'friend_request'
    && String(n.actorUid || '') === u
    && String(n.targetKind || '') !== 'creator_auto_add');
  if (hasRequestNotif) return true;
  return notifIncomingRequestsList().includes(u);
}
window.shelfdActorRequestedMeUnresolved = shelfdActorRequestedMeUnresolved;

/* v11.972: repaint a single friend-request card's action slot in place (no list
   rebuild) so the Follow→Requested→Following transitions are flicker-free. Hooked
   into syncFollowButtonsForUid so a follow/cancel from ANY surface stays in sync. */
function refreshNotifFriendRequestActions(uid) {
  const u = String(uid || '').trim();
  if (!u) return;
  const sel = (window.CSS && CSS.escape) ? CSS.escape(u) : u;
  document.querySelectorAll(`.shelfd-notif-request-actions[data-notif-followslot="${sel}"]`).forEach(slot => {
    const card = slot.closest('[data-notification-id]');
    const nid = card ? card.getAttribute('data-notification-id') : '';
    const html = buildNotifFriendRequestActionsHTML(u, nid);
    if (slot.innerHTML !== html) slot.innerHTML = html;
  });
}

/* v11.972: repaint every friend-request action slot from live state. Called from
   updateRequestsBadges (which fires on every friend-data commit) so Accept/Deny
   appear the moment incomingRequests loads — even if the notifications list
   painted before the friends listener's first snapshot arrived. */
function refreshAllNotifFriendRequestActions() {
  document.querySelectorAll('.shelfd-notif-request-actions[data-notif-followslot]').forEach(slot => {
    const u = slot.getAttribute('data-notif-followslot') || '';
    if (!u) return;
    const card = slot.closest('[data-notification-id]');
    const nid = card ? card.getAttribute('data-notification-id') : '';
    const html = buildNotifFriendRequestActionsHTML(u, nid);
    if (slot.innerHTML !== html) slot.innerHTML = html;
  });
}

function buildActivityNotificationRowHTML(notification = {}) {
  const id = String(notification.notificationId || '').trim();
  if (!id) return '';
  const unread = notification.read !== true;
  const type = String(notification.type || '').trim();
  const targetKind = String(notification.targetKind || '').trim();
  const actorUid = String(notification.actorUid || '').trim();
  const photo = String(notification.actorPhoto || '').trim();
  const actorFromMap = (typeof usersMap === 'object' && usersMap && actorUid && usersMap[actorUid]) ? usersMap[actorUid] : {};
  const actorHandle = String(
    actorFromMap.usernameHandle ||
    actorFromMap.userHandle ||
    actorFromMap.handle ||
    actorFromMap.username ||
    actorFromMap.usernameHandleLower ||
    actorFromMap.handleLower ||
    actorFromMap.usernameLower ||
    ''
  ).trim().replace(/^@+/, '');
  /* v11.972: any incoming follow request (not a creator auto-add) is a
     friend-request card with its own action slot — Accept/Deny while pending,
     then Follow/Requested/Following after Accept. The action HTML is computed
     from live relationship state, so it's correct on first paint AND after the
     friends listener loads (the slot repaints in place via updateRequestsBadges). */
  const isFriendRequestCard = type === 'friend_request'
    && targetKind !== 'creator_auto_add'
    && !!actorUid;
  const name = isFriendRequestCard
    ? (actorHandle ? '@' + actorHandle : String(notification.actorName || 'Shelfd user').trim())
    : String(notification.actorName || 'Shelfd user').trim();
  const actionLine = getShelfdNotificationActionLine(notification);
  const time = getShelfdNotificationRelativeTime(notification);
  const snippet = String(notification.textSnippet || '').trim();
  const poster = String(notification.mediaPoster || '').trim();
  const a = (typeof escAttr === 'function') ? escAttr : (v) => String(v || '');
  const h = (typeof escHtml === 'function') ? escHtml : (v) => String(v || '');
  const avatarHtml = photo
    ? `<img src="${a(photo)}" alt="" loading="lazy" decoding="async">`
    : `<span>${h((String(name).replace(/^@+/, '').charAt(0) || 'S').toUpperCase())}</span>`;
  const thumbHtml = poster
    ? `<span class="shelfd-notif-thumb"><img src="${a(poster)}" alt="" loading="lazy" decoding="async"></span>`
    : '';
  /* Unread = a single lavender dot on the RIGHT (only on unread rows), sitting
     just left of the optional poster thumb. */
  const dotHtml = unread ? '<span class="shelfd-notif-dot" aria-hidden="true"></span>' : '';
  if (isFriendRequestCard) {
    const requestActions = buildNotifFriendRequestActionsHTML(actorUid, id);
    return `<div class="shelfd-notif shelfd-notif-friend-request ${unread ? 'unread' : 'read'}" role="button" tabindex="0" onclick="openActivityNotificationTarget('${a(id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openActivityNotificationTarget('${a(id)}');}" data-notification-id="${a(id)}">
    <span class="shelfd-notif-avatar">${avatarHtml}</span>
    <span class="shelfd-notif-body">
      <span class="shelfd-notif-name">${h(name)}</span>
      <span class="shelfd-notif-action">${h(actionLine)}</span>
      <span class="shelfd-notif-time">${h(time)}</span>
    </span>
    <span class="shelfd-notif-request-actions" data-notif-followslot="${a(actorUid)}">${requestActions}</span>
    ${dotHtml}
  </div>`;
  }
  return `<button class="shelfd-notif ${unread ? 'unread' : 'read'}" type="button" onclick="openActivityNotificationTarget('${a(id)}')" data-notification-id="${a(id)}">
    <span class="shelfd-notif-avatar">${avatarHtml}</span>
    <span class="shelfd-notif-body">
      <span class="shelfd-notif-name">${h(name)}</span>
      <span class="shelfd-notif-action">${h(actionLine)}</span>
      ${snippet ? `<span class="shelfd-notif-snippet">${h(snippet)}</span>` : ''}
      <span class="shelfd-notif-time">${h(time)}</span>
    </span>
    ${dotHtml}
    ${thumbHtml}
  </button>`;
}

async function handleShelfdNotificationFriendRequest(actorUid = '', action = 'accept', notificationId = '') {
  const uid = String(actorUid || '').trim();
  if (!uid) return;
  try {
    if (action === 'deny' && typeof rejectFriendRequest === 'function') await rejectFriendRequest(uid);
    else if (typeof acceptFriendRequest === 'function') await acceptFriendRequest(uid);
  } catch (error) {
    console.warn('[shelfd notifications] friend request action failed:', error && error.message ? error.message : error);
    return;
  }
  if (notificationId) markActivityNotificationRead(notificationId);
  /* v11.972: repaint the card's action slot in place. Accept flips Accept/Deny
     to a Follow-back button (Follow → tap → Requested, until they accept); Deny
     clears it. The state is derived live, so a later full re-render stays correct. */
  refreshNotifFriendRequestActions(uid);
}

function renderActivityNotificationsList() {
  const feed = document.getElementById('activity-notifications-feed');
  if (!feed) return;
  /* Loading state shows only while we genuinely have nothing yet. Once a
     Firestore snapshot has arrived, switch to list (≥1) or empty (0). */
  if (!activityNotificationsLoadedOnce && !activityNotificationsList.length) {
    feed.innerHTML = `<div class="shelfd-notif-state"><span>Loading notifications…</span></div>`;
    return;
  }
  if (!activityNotificationsList.length) {
    feed.innerHTML = `<div class="shelfd-notif-state"><strong>No notifications yet</strong><span>Likes, comments, friend events, and Shared Watch requests from the last 11 days will show up here.</span></div>`;
    return;
  }
  feed.innerHTML = `<div class="shelfd-notif-list">${activityNotificationsList.map(buildActivityNotificationRowHTML).join('')}</div>`;
}

/* ---------- Tap-to-open ---------- */

async function openActivityNotificationTarget(notificationId = '') {
  if (!currentUser || !db || !notificationId) return;
  /* Try the local cache first; only hit Firestore if missing. */
  let notification = activityNotificationsList.find(item => String(item.notificationId || '') === String(notificationId)) || null;
  if (!notification) {
    try {
      const snap = await db.collection('notifications').doc(currentUser.uid).collection('items').doc(String(notificationId)).get();
      if (snap.exists) notification = { notificationId: snap.id, ...(snap.data() || {}) };
    } catch (e) {}
  }
  /* Mark read in the background; don't block the open. */
  markActivityNotificationRead(notificationId);
  if (!notification) return;

  const type = String(notification.type || '').trim();
  /* Shared Watch requests -> open the Watch Requests surface. */
  if (type === 'shared_watch_request') {
    const groupId = String(notification.watchTogetherGroupId || notification.targetActivityId || '').trim();
    if (typeof window.routeWatchTogetherNotificationTarget === 'function') {
      try { await window.routeWatchTogetherNotificationTarget(groupId); return; } catch (e) {}
    }
    if (typeof switchActivitySubTab === 'function') {
      try { await switchActivitySubTab('friendWatch'); } catch (e) {}
    }
    return;
  }
  /* Friend events → open the actor's profile / user list. */
  if (type === 'friend_request' || type === 'friend_accept') {
    const actorUid = String(notification.actorUid || '').trim();
    /* v11.975: a friend_request tap means THIS actor wants to follow me — record
       it now (before the shelf paints) so the shelf Confirm/Delete banner shows
       even on a cold push-start where no listener has loaded yet. */
    if (type === 'friend_request' && String(notification.targetKind || '') !== 'creator_auto_add') {
      rememberShelfdFollowRequestUid(actorUid);
    }
    if (actorUid && typeof openActivityUserList === 'function') {
      try { openActivityUserList(actorUid); return; } catch (e) {}
    }
    if (typeof switchActivitySubTab === 'function') {
      try { await switchActivitySubTab('feed'); } catch (e) {}
    }
    return;
  }

  /* v11.587: friend posted a FULL REVIEW → open the Full Page Review for that
     title, NOT the feed-post comment sheet. The notification stores the review
     feed-post id in `targetActivityId`; openSharedMediaReviewRoute loads that
     post (from the in-memory feed cache or a direct Firestore read) and opens
     the full-page review overlay — the same surface the "Full Review" button on
     the activity card opens. This single branch covers BOTH the in-app
     Notifications-row tap and the system push tap (push routes through
     openActivityNotificationTarget when notificationId is present). Falls
     through to the generic deep-link only if the review-route helper is somehow
     unavailable. */
  if (type === 'friend_review_posted') {
    const reviewPostId = String(notification.targetActivityId || '').trim();
    if (reviewPostId && typeof window.openSharedMediaReviewRoute === 'function') {
      try { await window.openSharedMediaReviewRoute({ postId: reviewPostId }); }
      catch (e) { console.warn('[shelfd notifications] review tap open failed:', e && e.message ? e.message : e); }
      return;
    }
  }

  /* Activity events → deep-link to the post. Switch to Activity Feed
     sub-tab first so the deep-link page can layer over it. */
  const targetId = String(notification.targetActivityId || '').trim();
  if (!targetId) return;
  if (typeof switchActivitySubTab === 'function') {
    try { await switchActivitySubTab('feed'); } catch (e) {}
  }
  window.setTimeout(() => {
    const isFeed = String(notification.targetKind || '').trim() === 'feed'
      || String(notification.targetCollection || '').trim() === 'feed';
    try {
      if (isFeed && typeof openFeedPostPage === 'function') openFeedPostPage(targetId);
      else if (typeof openActivityReplyPage === 'function') openActivityReplyPage(targetId);
    } catch (e) {
      console.warn('[shelfd notifications] tap open failed:', e && e.message ? e.message : e);
    }
  }, 120);
}

/* ---------- Backfill (one-shot per signed-in user per session) ----------

   Reconstructs notifications for events that happened before the live
   triggers existed, scoped to the last 11 days. Three sources:

     1. Likes + comments on the user's own feed posts (querying `feed`
        directly — doesn't depend on any in-memory cache).
     2. Likes + comments on the user's own library activity items
        (requires the friend-activity cache; we prefetch it via
        fetchAllFriendActivities if it's empty).
     3. Pending incoming friend requests (best-effort timestamp = now).

   Friend ACCEPT backfill is intentionally skipped because there is no
   reliable timestamp recorded for when a friendship was accepted — it
   would either land all accepts at the current time (misleading) or
   silently drop them. Live triggers cover accepts going forward.
*/
async function backfillRecentActivityNotifications() {
  if (!currentUser || !db) return;
  const uid = String(currentUser.uid || '').trim();
  if (!uid) return;
  if (activityNotificationsBackfillRanForUid === uid) return;
  activityNotificationsBackfillRanForUid = uid;
  const cutoffMs = getShelfdNotificationCutoffMs();
  let feedCreated = 0;
  let libCreated = 0;
  let socialCreated = 0;
  try { feedCreated = await backfillShelfdFeedInteractions(uid, cutoffMs); } catch (e) {}
  try { libCreated = await backfillShelfdLibraryActivityInteractions(uid, cutoffMs); } catch (e) {}
  try { socialCreated = await backfillShelfdIncomingFriendRequests(uid); } catch (e) {}
  try {
    console.info('[shelfd notifications] backfill summary', {
      uid,
      feed: feedCreated,
      library: libCreated,
      friendRequests: socialCreated,
      total: feedCreated + libCreated + socialCreated
    });
  } catch (e) {}
}

async function backfillShelfdFeedInteractions(uid, cutoffMs) {
  let created = 0;
  try {
    const snap = await db.collection('feed')
      .where('uid', '==', uid)
      .orderBy('timestamp', 'desc')
      .limit(60)
      .get();
    for (const doc of snap.docs) {
      const post = { ...doc.data(), id: doc.id, _collection: 'feed' };
      const postMs = parseShelfdNotificationMs(post.timestamp || post.createdAt || post.updatedAt, 0);
      if (postMs && postMs < cutoffMs) continue;
      const targetActivityId = String(post.postId || doc.id || '').trim();
      if (!targetActivityId) continue;
      const likes = Array.isArray(post.likes) ? post.likes : [];
      for (const likeUid of likes) {
        const actorUid = String(likeUid || '').trim();
        if (!actorUid || actorUid === uid) continue;
        if (await createActivityNotification({
          recipientUid: uid,
          actorUid,
          type: 'activity_like',
          targetActivityId,
          targetKind: 'feed',
          targetCollection: 'feed',
          activity: post,
          createdAtMs: postMs || Date.now(),
          backfilled: true
        })) created += 1;
      }
      const replies = Array.isArray(post.replies) ? post.replies : [];
      for (const reply of replies) {
        const actorUid = String((reply && reply.uid) || '').trim();
        if (!actorUid || actorUid === uid) continue;
        const replyMs = parseShelfdNotificationMs(reply && reply.timestamp, postMs || 0);
        if (replyMs && replyMs < cutoffMs) continue;
        if (await createActivityNotification({
          recipientUid: uid,
          actorUid,
          type: 'activity_comment',
          targetActivityId,
          targetCommentId: String((reply && reply.id) || ''),
          targetKind: 'feed',
          targetCollection: 'feed',
          activity: post,
          textSnippet: String((reply && reply.text) || ''),
          createdAtMs: replyMs || postMs || Date.now(),
          backfilled: true
        })) created += 1;
      }
    }
  } catch (error) {
    console.warn('[shelfd notifications] feed interaction backfill failed:', error && error.message ? error.message : error);
  }
  return created;
}

async function backfillShelfdLibraryActivityInteractions(uid, cutoffMs) {
  let created = 0;
  /* Prefetch friend-activity cache if it's empty — without it we have
     no list of the user's library activity entries to look up. */
  try {
    const ready = Array.isArray(friendActivityCache && friendActivityCache.activities) && friendActivityCache.activities.length;
    if (!ready && typeof fetchAllFriendActivities === 'function') {
      try { await fetchAllFriendActivities(typeof FRIEND_ACTIVITY_INITIAL_DAYS !== 'undefined' ? FRIEND_ACTIVITY_INITIAL_DAYS : 7); } catch (e) {}
    }
  } catch (e) {}

  const ownActivities = (friendActivityCache && Array.isArray(friendActivityCache.activities))
    ? friendActivityCache.activities.filter(a => String((a && a.uid) || '') === uid)
    : [];

  for (const activity of ownActivities) {
    const activityMs = parseShelfdNotificationMs(
      activity && (activity.timestamp || (activity.item && (activity.item.dateModified || activity.item.dateAdded))),
      0
    );
    if (activityMs && activityMs < cutoffMs) continue;
    const stableId = (typeof getStableActivityDocId === 'function')
      ? getStableActivityDocId(activity, activity.id || activity.activityId || '')
      : String(activity.id || '');
    if (!stableId) continue;
    try {
      const metaDocId = (typeof getActivityInteractionMetaDocId === 'function') ? getActivityInteractionMetaDocId(stableId) : '';
      if (!metaDocId) continue;
      const snap = await db.collection('meta').doc(metaDocId).get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const merged = { ...activity, ...data, id: stableId, _collection: 'meta' };
      const likes = Array.isArray(data.likes) ? data.likes : [];
      for (const likeUid of likes) {
        const actorUid = String(likeUid || '').trim();
        if (!actorUid || actorUid === uid) continue;
        if (await createActivityNotification({
          recipientUid: uid,
          actorUid,
          type: 'activity_like',
          targetActivityId: stableId,
          targetKind: 'activity',
          targetCollection: 'meta',
          activity: merged,
          createdAtMs: activityMs || Date.now(),
          backfilled: true
        })) created += 1;
      }
      const replies = Array.isArray(data.replies) ? data.replies : [];
      for (const reply of replies) {
        const actorUid = String((reply && reply.uid) || '').trim();
        if (!actorUid || actorUid === uid) continue;
        const replyMs = parseShelfdNotificationMs(reply && reply.timestamp, activityMs || 0);
        if (replyMs && replyMs < cutoffMs) continue;
        if (await createActivityNotification({
          recipientUid: uid,
          actorUid,
          type: 'activity_comment',
          targetActivityId: stableId,
          targetCommentId: String((reply && reply.id) || ''),
          targetKind: 'activity',
          targetCollection: 'meta',
          activity: merged,
          textSnippet: String((reply && reply.text) || ''),
          createdAtMs: replyMs || activityMs || Date.now(),
          backfilled: true
        })) created += 1;
      }
    } catch (error) {
      console.warn('[shelfd notifications] library interaction backfill skipped for', stableId, error && error.message ? error.message : error);
    }
  }
  return created;
}

async function backfillShelfdIncomingFriendRequests(uid) {
  let created = 0;
  try {
    const incoming = (typeof incomingRequests !== 'undefined' && Array.isArray(incomingRequests)) ? incomingRequests : [];
    const nowMs = Date.now();
    for (const requesterUid of incoming) {
      const actorUid = String(requesterUid || '').trim();
      if (!actorUid || actorUid === uid) continue;
      if (await createActivityNotification({
        recipientUid: uid,
        actorUid,
        type: 'friend_request',
        targetActivityId: `friend_request:${actorUid}`,
        targetKind: 'friend_request',
        createdAtMs: nowMs,
        backfilled: true
      })) created += 1;
    }
  } catch (error) {
    console.warn('[shelfd notifications] friend request backfill failed:', error && error.message ? error.message : error);
  }
  return created;
}

/* ---------- Public entry: open the Notifications tab ---------- */

async function renderActivityNotificationsPage() {
  const feed = document.getElementById('activity-notifications-feed');
  if (!feed) return;
  if (!currentUser) {
    feed.innerHTML = `<div class="shelfd-notif-state"><strong>Sign in to see notifications</strong><span>Likes, comments, and friend events appear here once you're signed in.</span></div>`;
    return;
  }
  /* If the signed-in user changed since we last attached, reset state. */
  if (activityNotificationsListenerUid && activityNotificationsListenerUid !== currentUser.uid) {
    stopActivityNotificationsLiveListener();
    activityNotificationsList = [];
    activityNotificationsLoadedOnce = false;
    activityNotificationsBackfillRanForUid = '';
  }
  attachShelfdNotificationsListener();
  renderActivityNotificationsList();
  /* Fire backfill once per session per user; non-blocking. */
  backfillRecentActivityNotifications();
  /* v10.283: auto-mark all unread notifications as read when the user visits
     the Notifications tab. Letting them just SEE the list is enough to clear
     the badge — they shouldn't have to tap each individual row. Slight delay
     so they see the unread count for ~600ms before it drops to zero. */
  window.setTimeout(() => {
    try { markAllActivityNotificationsRead(); } catch (e) {}
  }, 600);
}

/* v10.283: batch-mark every visible unread notification as read in Firestore.
   Uses a single batch write so it's one network round-trip regardless of
   how many notifications are unread. Failures are non-fatal — the next
   snapshot will retry the un-marked ones the next time the user visits. */
async function markAllActivityNotificationsRead() {
  if (!currentUser || !db) return;
  const unread = (activityNotificationsList || []).filter(item => item && item.read !== true);
  if (!unread.length) return;
  try {
    const batch = db.batch();
    const nowMs = Date.now();
    for (const notif of unread) {
      const notifId = String(notif.notificationId || '').trim();
      if (!notifId) continue;
      const ref = db.collection('notifications').doc(currentUser.uid).collection('items').doc(notifId);
      batch.set(ref, {
        read: true,
        readAtMs: nowMs,
        updatedAtMs: nowMs,
        readAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
  } catch (e) {
    console.warn('[shelfd notifications] mark-all-read batch failed:', e && e.message ? e.message : e);
  }
}

window.renderActivityNotificationsPage = renderActivityNotificationsPage;
window.openActivityNotificationTarget = openActivityNotificationTarget;
window.stopActivityNotificationsLiveListener = stopActivityNotificationsLiveListener;
window.createActivityNotification = createActivityNotification;
window.markActivityNotificationRead = markActivityNotificationRead;
window.handleShelfdNotificationFriendRequest = handleShelfdNotificationFriendRequest;