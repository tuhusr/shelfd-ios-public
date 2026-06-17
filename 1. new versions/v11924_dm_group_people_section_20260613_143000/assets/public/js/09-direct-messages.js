// Direct Messages: request-first lightweight messaging stored through users docs.
let dmIncomingRequestIds = [];
let dmOutgoingRequestIds = [];
let dmIncomingRequestMap = {};
let dmOutgoingRequestMap = {};
let dmThreadIds = [];
let dmThreadMap = {};
/* v11.776: thread ids whose messages have been CONFIRMED from Firestore (the
   live listener or a direct fetch) — as opposed to the inbox cache, which seeds
   message-LESS stubs. Used so we show a loading state (not the empty "Chat
   accepted" state) until a thread's messages are actually hydrated. */
const dmHydratedThreadIds = (typeof Set !== 'undefined') ? new Set() : { has() { return false; }, add() {} };
let activeMessagesSubTab = 'chats';
let activeDmThreadId = '';
let dmSearchTimer = null;
let dmSearchResults = [];
let dmNewChatOpen = false;
let dmNewChatMode = 'direct';
let dmNewChatSelectedUids = [];
let dmNewChatGroupPhotoData = '';
let dmNewChatGroupName = '';
let activeDmGroupEditThreadId = '';
let dmGroupEditPhotoData = '';
let dmGroupEditCropState = null;
let dmGroupEditCropImage = null;
let dmGroupEditCropImageSrc = '';
let dmGroupEditAddSelectedUids = [];
let dmGroupEditRemovedUids = [];
const dmGroupEditCropPointers = new Map();
let dmGroupEditCropGesture = null;
let dmGroupDetailsOptionsOutsideHandler = null;
let dmGroupInfoPhotoData = '';

let dmActiveThreadAppStateBound = false;

function getDirectMessageVisibleActiveThreadId() {
  const id = String(activeDmThreadId || '').trim();
  if (!id || activeDmGroupEditThreadId) return '';
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return '';
  if (typeof isDirectMessagesPageOpen === 'function' && !isDirectMessagesPageOpen()) return '';
  return id;
}

function syncDirectMessageActiveThreadState(reason = '') {
  const id = getDirectMessageVisibleActiveThreadId();
  try {
    window.__shelfdActiveDmThreadId = id;
    window.__shelfdActiveDmThreadSyncedAtMs = Date.now();
  } catch (_) {}
  try {
    if (window.__shelfdPush && typeof window.__shelfdPush.setActiveDmThread === 'function') {
      window.__shelfdPush.setActiveDmThread(id, reason || 'dm-state');
    }
  } catch (_) {}
  return id;
}

function clearDirectMessageActiveThreadState(reason = '') {
  try {
    window.__shelfdActiveDmThreadId = '';
    window.__shelfdActiveDmThreadSyncedAtMs = Date.now();
  } catch (_) {}
  try {
    if (window.__shelfdPush && typeof window.__shelfdPush.setActiveDmThread === 'function') {
      window.__shelfdPush.setActiveDmThread('', reason || 'dm-clear');
    }
  } catch (_) {}
}

function bindDirectMessageActiveThreadAppState() {
  if (dmActiveThreadAppStateBound || typeof window === 'undefined' || typeof document === 'undefined') return;
  dmActiveThreadAppStateBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearDirectMessageActiveThreadState('visibility-hidden');
    else syncDirectMessageActiveThreadState('visibility-visible');
  });
  try {
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && typeof App.addListener === 'function') {
      App.addListener('appStateChange', (event) => {
        if (event && event.isActive === false) clearDirectMessageActiveThreadState('app-background');
        else if (event && event.isActive) syncDirectMessageActiveThreadState('app-foreground');
      });
    }
  } catch (_) {}
}

bindDirectMessageActiveThreadAppState();
if (typeof window !== 'undefined') {
  window.__shelfdSyncActiveDmThreadState = syncDirectMessageActiveThreadState;
  window.__shelfdClearActiveDmThreadState = clearDirectMessageActiveThreadState;
  window.__shelfdGetVisibleActiveDmThreadId = getDirectMessageVisibleActiveThreadId;
}

/* v10.739: Shared dmThreads collection — the new canonical store for
   DM data. Replaces the per-user `users/{uid}.directMessageThreadMap`
   mirror approach which fundamentally cannot deliver cross-user because
   Firestore rules block writes to other users' docs. The shared doc at
   `dmThreads/{threadId}` carries `participantUids: [...]`; both
   participants can read/write because they're in that array (see the
   v10.739 rule block in FIRESTORE_RULES_CREATOR_PUBLIC_READ.txt).
   Same architecture as Instagram / Discord / WhatsApp / iMessage / etc. */
let dmSharedThreadsUnsubscribe = null;
let dmSharedThreadsMigrationDone = false;

function normalizeDirectMessageIds(value) {
  return Array.isArray(value) ? value.map(id => String(id || '').trim()).filter(Boolean) : [];
}

/* v10.761: isDirectMessageEncryptedRecord() now lives in 02-messages-e2ee.js
   (single source of truth). It is loaded before this file so it's available
   to all references below — same identical implementation, just deduped. */

function normalizeDirectMessageMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [id, raw]) => {
    if (!id || !raw || typeof raw !== 'object') return acc;
    const normalized = { ...raw, id: raw.id || id };
    acc[id] = Array.isArray(normalized.messages) ? normalizeDirectMessageThread(normalized) : normalized;
    return acc;
  }, {});
}

function buildDirectMessagePairId(prefix = 'dm', uidA = '', uidB = '') {
  const a = String(uidA || '').trim();
  const b = String(uidB || '').trim();
  if (!a || !b) return '';
  return `${prefix}_${[a, b].sort().join('_')}`;
}

function getCurrentUserDirectMessageProfile() {
  return {
    uid: currentUser?.uid || '',
    name: userProfile?.name || currentUser?.displayName || currentUser?.email || 'User',
    photo: userProfile?.photo || currentUser?.photoURL || ''
  };
}

function getDirectMessageProfile(uid = '', fallback = {}) {
  const cached = usersMap[uid] || {};
  return {
    uid,
    name: cached.name || cached.customName || fallback.name || fallback.displayName || 'User',
    username: cached.username || cached.handle || fallback.username || fallback.handle || '',
    handle: cached.handle || cached.username || fallback.handle || fallback.username || '',
    photo: cached.photo || fallback.photo || fallback.photoURL || ''
  };
}

function getDirectMessageUsernameLabel(uid = '', profile = {}) {
  const cached = usersMap[uid] || {};
  const username = String(cached.username || cached.handle || profile.username || profile.handle || '').trim();
  if (username) return username.startsWith('@') ? username : `@${username}`;
  return String(profile.name || cached.name || cached.customName || 'User').trim();
}

function getDirectMessageAvatar(profile = {}) {
  return profile.photo || `/default-avatar.svg#${encodeURIComponent(profile.name || 'User')}&background=1e2028&color=a78bfa`;
}

function isDirectMessageGroupThread(thread = {}) {
  return thread?.isGroup === true || thread?.type === 'group' || (Array.isArray(thread?.participantUids) && thread.participantUids.length > 2);
}

function getDirectMessageOtherUid(thread = {}) {
  if (isDirectMessageGroupThread(thread)) return '';
  const participants = Array.isArray(thread.participantUids) ? thread.participantUids : [];
  return participants.find(uid => uid && uid !== currentUser?.uid) || '';
}

function getDirectMessageOtherProfile(thread = {}) {
  if (isDirectMessageGroupThread(thread)) return getDirectMessageThreadProfile(thread);
  const otherUid = getDirectMessageOtherUid(thread);
  return getDirectMessageProfile(otherUid, thread.participants?.[otherUid] || {});
}

function getDirectMessageThreadTitle(thread = {}) {
  if (!isDirectMessageGroupThread(thread)) return getDisplayName(getDirectMessageOtherProfile(thread), 'User');
  const explicitName = String(thread.groupName || '').trim();
  if (explicitName) return explicitName;
  const names = (thread.participantUids || [])
    .filter(uid => uid && uid !== currentUser?.uid)
    .map(uid => getDisplayName(getDirectMessageProfile(uid, thread.participants?.[uid] || {}), 'User'))
    .filter(Boolean)
    .slice(0, 3);
  return names.length ? names.join(', ') : 'Group Chat';
}

/* v11.883: the chat thread HEADER shows the other user's USERNAME (no @), not their display
   name, and no subtitle. Groups keep their group name. Falls back to the display name only if
   the user has no username/handle on record. */
function getDirectMessageHeaderName(thread = {}) {
  if (isDirectMessageGroupThread(thread)) return getDirectMessageThreadTitle(thread);
  const profile = getDirectMessageOtherProfile(thread);
  const uname = String((profile && (profile.username || profile.handle)) || '').trim().replace(/^@+/, '');
  return uname || getDisplayName(profile, 'User');
}

function getDirectMessageInboxName(profile = {}) {
  const uid = String(profile?.uid || '').trim();
  const cached = uid ? (usersMap[uid] || {}) : {};
  const username = String(
    cached.username ||
    cached.handle ||
    profile.username ||
    profile.handle ||
    ''
  ).trim().replace(/^@+/, '');
  return username || getDisplayName({ ...profile, ...cached }, 'User');
}

function renderDirectMessageInboxNameHTML(profile = {}) {
  const nameHtml = `<span class="creator-name dm-chat-username">${escHtml(getDirectMessageInboxName(profile))}</span>`;
  if (typeof isOwnerBadgeAccount === 'function' && isOwnerBadgeAccount(profile)) {
    return `<span class="creator-name-wrap user-badged-name-wrap dm-chat-username-wrap">${nameHtml}<button type="button" class="creator-role creator-role-compact creator-role-owner" onclick="event.stopPropagation();toggleCreatorRoleTooltip(this)" aria-label="Creator and Developer"><img class="creator-owner-badge-img" src="/badges/owner-badge.svg" width="12" height="15" alt="" decoding="async"><span class="creator-role-tooltip creator-owner-tooltip" role="status" aria-hidden="true">Creator and Developer</span></button></span>`;
  }
  return nameHtml;
}

function renderDirectMessageHeaderNameHTML(thread = {}) {
  const profile = getDirectMessageThreadProfile(thread);
  const nameHtml = `<span class="creator-name dm-thread-username">${escHtml(getDirectMessageHeaderName(thread))}</span>`;
  if (!isDirectMessageGroupThread(thread) && typeof isOwnerBadgeAccount === 'function' && isOwnerBadgeAccount(profile)) {
    return `<span class="creator-name-wrap user-badged-name-wrap dm-thread-username-wrap">${nameHtml}<button type="button" class="creator-role creator-role-compact creator-role-owner" onclick="event.stopPropagation();toggleCreatorRoleTooltip(this)" aria-label="Creator and Developer"><img class="creator-owner-badge-img" src="/badges/owner-badge.svg" width="12" height="15" alt="" decoding="async"><span class="creator-role-tooltip creator-owner-tooltip" role="status" aria-hidden="true">Creator and Developer</span></button></span>`;
  }
  return nameHtml;
}

function getDirectMessageThreadProfile(thread = {}) {
  if (!isDirectMessageGroupThread(thread)) return getDirectMessageOtherProfile(thread);
  const title = getDirectMessageThreadTitle(thread);
  return {
    uid: thread.id || '',
    name: title,
    photo: thread.groupPhoto || `/default-avatar.svg#${encodeURIComponent(title || 'Group')}&background=1e2028&color=a78bfa`
  };
}

function getDirectMessageThreadSubtitle(thread = {}) {
  if (!isDirectMessageGroupThread(thread)) return '';   // v11.883: no "Direct Message" subtitle on 1:1 chats
  const count = Array.isArray(thread.participantUids) ? thread.participantUids.length : 0;
  return `${count || 0} member${count === 1 ? '' : 's'}`;
}

function getDirectMessageRequestOtherProfile(req = {}, direction = 'incoming') {
  const otherUid = direction === 'incoming' ? req.fromUid : req.toUid;
  const fallback = direction === 'incoming' ? req.fromProfile : req.toProfile;
  return getDirectMessageProfile(otherUid, fallback || {});
}

function getDirectMessageThreadWithUser(uid = '') {
  return Object.values(dmThreadMap || {}).find(thread => {
    if (isDirectMessageGroupThread(thread)) return false;
    const participants = Array.isArray(thread.participantUids) ? thread.participantUids : [];
    return participants.includes(currentUser?.uid) && participants.includes(uid);
  }) || null;
}

function isDirectMessageFriend(uid = '') {
  return !!uid && Array.isArray(friends) && friends.includes(uid);
}

function getDirectMessageRequestWithUser(uid = '', direction = '') {
  const maps = direction === 'incoming'
    ? [dmIncomingRequestMap]
    : direction === 'outgoing'
      ? [dmOutgoingRequestMap]
      : [dmIncomingRequestMap, dmOutgoingRequestMap];
  for (const map of maps) {
    const req = Object.values(map || {}).find(item => item && (item.fromUid === uid || item.toUid === uid));
    if (req) return req;
  }
  return null;
}

function getDirectMessageParticipantUids(thread = {}) {
  const fromArray = Array.isArray(thread.participantUids) ? thread.participantUids : [];
  const fromParticipants = thread.participants && typeof thread.participants === 'object'
    ? Object.keys(thread.participants)
    : [];
  const fromId = String(thread.id || '')
    .replace(/^dm_/, '')
    .split('_')
    .filter(part => part && part.length >= 8);
  return [...new Set([...fromArray, ...fromParticipants, ...fromId].map(uid => String(uid || '').trim()).filter(Boolean))];
}

function getUnreadDirectMessageThreadCount() {
  return Object.values(dmThreadMap || {}).filter(thread => Array.isArray(thread.unreadUids) && thread.unreadUids.includes(currentUser?.uid)).length;
}

function getDirectMessageNotificationCount() {
  return dmIncomingRequestIds.length + getUnreadDirectMessageThreadCount();
}

function updateDirectMessagesBadge() {
  const count = getDirectMessageNotificationCount();
  const badges = Array.from(document.querySelectorAll('#messages-count-badge, #header-dm-badge, #header-discover-dm-badge'));
  const headerBtns = [
    document.getElementById('header-dm-btn'),
    document.getElementById('header-discover-dm-btn')
  ].filter(Boolean);
  badges.forEach(badge => {
    /* v10.786: badge is now a numberless red DOT. Don't write the
       count to textContent — just toggle visibility. The CSS sizes it
       as a fixed 9x9 circle so any inline-flex/text positioning is
       irrelevant; use plain `inline-block` for the on-state. */
    badge.textContent = '';
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  });
  headerBtns.forEach(headerBtn => {
    /* aria-label still conveys the precise unread count to screen
       readers — only the visual badge dropped the number. */
    headerBtn.classList.toggle('has-ping', count > 0);
    headerBtn.setAttribute('aria-label', count > 0 ? 'Open messages, ' + count + ' new' : 'Open messages');
    headerBtn.title = count > 0 ? count + ' new message activity' : 'Messages';
  });
}

function isDirectMessagesPageOpen() {
  const page = document.getElementById('direct-messages-page');
  return !!(page && page.style.display !== 'none');
}

function updateDirectMessagesTopbar() {
  const page = document.getElementById('direct-messages-page');
  const topbar = page ? page.querySelector('.direct-messages-topbar') : null;
  const title = document.getElementById('direct-messages-title');
  const subtitle = document.getElementById('direct-messages-subtitle');
  const avatar = document.getElementById('direct-messages-top-avatar');
  const backBtn = document.getElementById('direct-messages-back-btn');
  const editingThread = activeDmGroupEditThreadId ? dmThreadMap[activeDmGroupEditThreadId] : null;
  const thread = !editingThread && activeDmThreadId ? dmThreadMap[activeDmThreadId] : null;
  const visibleThread = editingThread || thread;
  const isGroup = isDirectMessageGroupThread(visibleThread);
  const isGroupEdit = !!editingThread;
  /* v11.879: during the CLOSE slide (state 'closing'), treat the page as the INBOX for the
     geometry class. That lands the inbox's :not(.dm-thread-open) padding-top WHILE the panel
     still covers the screen, so the inbox is revealed already in its final position instead of
     settling down ~8px AFTER the slide ("shifts down on back"). The title/avatar block below
     still keys off visibleThread (the legacy topbar is display:none anyway). */
  const dmClosing = !!((typeof dmThreadNav === 'object' && dmThreadNav && dmThreadNav.state === 'closing')
    || (page && page.classList && page.classList.contains('dm-thread-swiping')));
  const isThread = !!visibleThread && !dmClosing;
  if (page) {
    page.classList.toggle('dm-thread-open', isThread);
    page.classList.toggle('dm-group-edit-open', isGroupEdit);
    page.classList.toggle('dm-new-chat-modal-open', !!dmNewChatOpen);
  }
  if (topbar) topbar.classList.toggle('dm-thread-topbar', isThread);
  if (visibleThread) {
    const profile = getDirectMessageThreadProfile(visibleThread);
    const threadTitle = getDirectMessageThreadTitle(visibleThread);
    if (title) {
      title.textContent = isGroupEdit ? 'Edit group' : threadTitle;
      title.title = isGroup && !isGroupEdit ? 'Edit group chat' : (isGroupEdit ? threadTitle : threadTitle);
      title.classList.toggle('dm-group-title-clickable', isGroup && !isGroupEdit);
      if (isGroup && !isGroupEdit) {
        title.setAttribute('role', 'button');
        title.setAttribute('tabindex', '0');
        title.onclick = () => openDirectMessageGroupDetails(visibleThread.id);
        title.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDirectMessageGroupDetails(visibleThread.id);
          }
        };
      } else {
        title.removeAttribute('role');
        title.removeAttribute('tabindex');
        title.onclick = null;
        title.onkeydown = null;
      }
    }
    if (subtitle) subtitle.textContent = isGroupEdit ? threadTitle : getDirectMessageThreadSubtitle(visibleThread);
    if (avatar) {
      avatar.src = getDirectMessageAvatar(profile);
      avatar.style.display = 'block';
      avatar.classList.toggle('editable-group-avatar', isGroup);
      avatar.onclick = isGroup ? () => openDirectMessageGroupDetails(visibleThread.id) : null;
      avatar.title = isGroup ? 'Edit group chat' : '';
    }
    if (backBtn) backBtn.setAttribute('aria-label', isGroupEdit ? 'Back to group chat' : 'Back to messages');
  } else {
    if (title) {
      title.textContent = 'Messages';
      title.title = 'Messages';
      title.classList.remove('dm-group-title-clickable');
      title.removeAttribute('role');
      title.removeAttribute('tabindex');
      title.onclick = null;
      title.onkeydown = null;
    }
    if (subtitle) subtitle.textContent = '';
    if (avatar) {
      avatar.removeAttribute('src');
      avatar.style.display = 'none';
      avatar.classList.remove('editable-group-avatar');
      avatar.onclick = null;
      avatar.title = '';
    }
    if (backBtn) backBtn.setAttribute('aria-label', 'Close messages');
  }
}

function openDirectMessageHeaderProfile(uid = '') {
  const targetUid = String(uid || '').trim();
  if (!targetUid) return;
  closeDirectMessagesPage(true);
  setTimeout(() => {
    try { openUserProfile(targetUid); }
    catch (error) {
      console.warn('[dm] open profile from header failed:', error);
      if (typeof showToast === 'function') showToast('Could not open profile');
    }
  }, 0);
}
window.openDirectMessageHeaderProfile = openDirectMessageHeaderProfile;

function getDirectMessageRequestPayload(targetUser = {}, requestId = '') {
  const targetUid = targetUser.uid || '';
  const fromProfile = getCurrentUserDirectMessageProfile();
  const toProfile = getDirectMessageProfile(targetUid, targetUser);
  const threadId = buildDirectMessagePairId('dm', fromProfile.uid, targetUid);
  const now = Date.now();
  return {
    id: requestId || buildDirectMessagePairId('dmreq', fromProfile.uid, targetUid),
    threadId,
    fromUid: fromProfile.uid,
    toUid: targetUid,
    fromProfile,
    toProfile,
    participantUids: [fromProfile.uid, targetUid].filter(Boolean),
    participants: {
      [fromProfile.uid]: fromProfile,
      [targetUid]: toProfile
    },
    status: 'pending',
    createdAtMs: now,
    updatedAtMs: now
  };
}

async function setDirectMessageRequestMirror(uid = '', direction = 'incoming', requestId = '', payload = {}, include = true) {
  if (!uid || !requestId) return;
  const isIncoming = direction === 'incoming';
  const idsField = isIncoming ? 'directMessageIncomingRequests' : 'directMessageOutgoingRequests';
  const mapField = isIncoming ? 'directMessageIncomingRequestMap' : 'directMessageOutgoingRequestMap';
  await db.collection('users').doc(uid).set({
    [idsField]: include ? firebase.firestore.FieldValue.arrayUnion(requestId) : firebase.firestore.FieldValue.arrayRemove(requestId),
    [mapField]: { [requestId]: { ...payload, id: requestId, updatedAtMs: Date.now() } }
  }, { merge: true });
}

async function clearDirectMessageRequestMirror(uid = '', direction = 'incoming', requestId = '') {
  if (!uid || !requestId) return;
  const isIncoming = direction === 'incoming';
  const idsField = isIncoming ? 'directMessageIncomingRequests' : 'directMessageOutgoingRequests';
  const mapField = isIncoming ? 'directMessageIncomingRequestMap' : 'directMessageOutgoingRequestMap';
  const ref = db.collection('users').doc(uid);
  await ref.set({ [idsField]: firebase.firestore.FieldValue.arrayRemove(requestId) }, { merge: true });
  try {
    await ref.update({ [`${mapField}.${requestId}`]: firebase.firestore.FieldValue.delete() });
  } catch (error) {
    console.warn('Direct Message request cleanup skipped:', error);
  }
}

function getDirectMessageLastPreviewFromMessages(messages = [], fallback = '') {
  const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
  if (!last) return String(fallback || '').replace(/^(Encrypted|Secure)\s+(message|photo|share)$/i, '').trim();
  if (last.imageData) return 'Photo';
  if (last.shareMedia) return 'Shared media';
  return String(last.text || fallback || '').trim();
}

function normalizeDirectMessageThread(thread = {}) {
  const participantUids = getDirectMessageParticipantUids(thread);
  const rawMessages = Array.isArray(thread.messages) ? thread.messages.filter(Boolean) : [];
  const removedEncryptedCount = rawMessages.filter(isDirectMessageEncryptedRecord).length;
  const messages = rawMessages
    .filter(message => !isDirectMessageEncryptedRecord(message))
    .slice(-80)
    .map(message => {
      const nextMessage = { ...(message || {}), isEncrypted: false };
      delete nextMessage.dmE2ee;
      delete nextMessage.encryptedPayload;
      delete nextMessage.ciphertext;
      if (nextMessage.shareMedia) {
        nextMessage.shareMedia = normalizeSharedMediaPayload(nextMessage.shareMedia);
      }
      return nextMessage;
    });
  const isGroup = thread.isGroup === true || thread.type === 'group' || participantUids.length > 2;
  const lastMessage = getDirectMessageLastPreviewFromMessages(messages, thread.lastMessage || '');
  const cleanThread = {
    id: thread.id || '',
    type: isGroup ? 'group' : 'direct',
    isGroup,
    groupName: thread.groupName || '',
    groupPhoto: thread.groupPhoto || '',
    groupDescription: thread.groupDescription || '',
    ownerUid: thread.ownerUid || '',
    adminUids: Array.isArray(thread.adminUids) ? [...new Set(thread.adminUids.filter(Boolean))] : [],
    participantUids,
    participants: thread.participants || {},
    messages,
    lastMessage,
    lastMessageFromUid: thread.lastMessageFromUid || (messages.length ? messages[messages.length - 1].fromUid : ''),
    lastMessageAtMs: Number(thread.lastMessageAtMs || (messages.length ? messages[messages.length - 1].createdAtMs : 0) || Date.now()),
    unreadUids: Array.isArray(thread.unreadUids) ? thread.unreadUids.filter(Boolean) : [],
    /* v10.900: per-uid read timestamps. Written by markDirectMessageThreadRead
       when a participant opens the thread and clears their unread state.
       The sender reads `readAtMsByUid[otherUid]` to render the
       "Read {time}" receipt under their last sent message. Old threads
       without this field surface as `{}`; render falls back to
       thread.updatedAtMs so the receipt still renders gracefully. */
    readAtMsByUid: (thread.readAtMsByUid && typeof thread.readAtMsByUid === 'object' && !Array.isArray(thread.readAtMsByUid))
      ? Object.fromEntries(
          Object.entries(thread.readAtMsByUid)
            .filter(([k, v]) => k && Number(v) > 0)
            .map(([k, v]) => [k, Number(v)])
        )
      : {},
    createdAtMs: Number(thread.createdAtMs || Date.now()),
    updatedAtMs: Number(thread.updatedAtMs || thread.lastMessageAtMs || Date.now())
  };
  if (removedEncryptedCount) cleanThread._removedEncryptedMessages = removedEncryptedCount;
  return cleanThread;
}

function getDirectMessageMessageKey(message = {}) {
  const explicitId = String(message?.id || message?.clientId || '').trim();
  if (explicitId) return explicitId;
  return [
    String(message?.fromUid || '').trim(),
    String(Number(message?.createdAtMs || 0)),
    String(message?.text || '').trim(),
    message?.imageData ? 'photo' : '',
    message?.shareMedia?.url || ''
  ].join('|');
}

function getDirectMessageMessageTime(message = {}) {
  return Number(message?.createdAtMs || message?.sentAtMs || message?.updatedAtMs || 0);
}

function mergeDirectMessageMessages(...messageLists) {
  const byKey = new Map();
  messageLists.flat().filter(Boolean).forEach(rawMessage => {
    if (isDirectMessageEncryptedRecord(rawMessage)) return;
    const message = { ...(rawMessage || {}), isEncrypted: false };
    delete message.dmE2ee;
    delete message.encryptedPayload;
    delete message.ciphertext;
    if (message.shareMedia) message.shareMedia = normalizeSharedMediaPayload(message.shareMedia);
    const key = getDirectMessageMessageKey(message);
    if (!key) return;
    const previous = byKey.get(key);
    byKey.set(key, previous ? {
      ...previous,
      ...message,
      text: message.text || previous.text || '',
      imageData: message.imageData || previous.imageData || '',
      imageName: message.imageName || previous.imageName || '',
      shareMedia: message.shareMedia || previous.shareMedia || null
    } : message);
  });
  return [...byKey.values()]
    .sort((a, b) => {
      const timeDelta = getDirectMessageMessageTime(a) - getDirectMessageMessageTime(b);
      if (timeDelta) return timeDelta;
      return getDirectMessageMessageKey(a).localeCompare(getDirectMessageMessageKey(b));
    })
    .slice(-80);
}

function getDirectMessageThreadClock(thread = {}) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const latestMessageMs = messages.reduce((max, message) => Math.max(max, getDirectMessageMessageTime(message)), 0);
  return Math.max(
    Number(thread.updatedAtMs || 0),
    Number(thread.lastMessageAtMs || 0),
    latestMessageMs
  );
}

function mergeDirectMessageThreadState(existingThread = {}, incomingThread = {}) {
  const existing = normalizeDirectMessageThread(existingThread);
  const incoming = normalizeDirectMessageThread(incomingThread);
  if (!existing.id) return incoming;
  if (!incoming.id) return existing;
  const existingClock = getDirectMessageThreadClock(existing);
  const incomingClock = getDirectMessageThreadClock(incoming);
  const newest = incomingClock >= existingClock ? incoming : existing;
  const older = newest === incoming ? existing : incoming;
  const messages = mergeDirectMessageMessages(existing.messages || [], incoming.messages || []);
  const participantUids = [...new Set([
    ...(existing.participantUids || []),
    ...(incoming.participantUids || [])
  ].filter(Boolean))];
  const participants = { ...(older.participants || {}), ...(newest.participants || {}) };
  const lastMessageRecord = messages.length ? messages[messages.length - 1] : null;
  const lastMessageAtMs = Math.max(
    Number(existing.lastMessageAtMs || 0),
    Number(incoming.lastMessageAtMs || 0),
    lastMessageRecord ? getDirectMessageMessageTime(lastMessageRecord) : 0
  );
  return normalizeDirectMessageThread({
    ...older,
    ...newest,
    participantUids,
    participants,
    messages,
    lastMessage: lastMessageRecord
      ? getDirectMessageLastPreviewFromMessages(messages, newest.lastMessage || older.lastMessage || '')
      : (newest.lastMessage || older.lastMessage || ''),
    lastMessageFromUid: lastMessageRecord
      ? (lastMessageRecord.fromUid || newest.lastMessageFromUid || older.lastMessageFromUid || '')
      : (newest.lastMessageFromUid || older.lastMessageFromUid || ''),
    lastMessageAtMs: lastMessageAtMs || newest.lastMessageAtMs || older.lastMessageAtMs || Date.now(),
    unreadUids: Array.isArray(newest.unreadUids) ? newest.unreadUids.filter(Boolean) : [],
    createdAtMs: Math.min(
      Number(existing.createdAtMs || incoming.createdAtMs || Date.now()),
      Number(incoming.createdAtMs || existing.createdAtMs || Date.now())
    ),
    updatedAtMs: Math.max(
      Number(existing.updatedAtMs || 0),
      Number(incoming.updatedAtMs || 0),
      lastMessageAtMs || 0
    ) || Date.now()
  });
}

function mergeDirectMessageThreadIntoState(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  if (!cleanThread.id) return null;
  if (currentUser?.uid && cleanThread.participantUids.length && !cleanThread.participantUids.includes(currentUser.uid)) {
    return dmThreadMap[cleanThread.id] || null;
  }
  const existingThread = dmThreadMap[cleanThread.id];
  const mergedThread = existingThread ? mergeDirectMessageThreadState(existingThread, cleanThread) : cleanThread;
  dmThreadMap[cleanThread.id] = mergedThread;
  if (!dmThreadIds.includes(cleanThread.id)) dmThreadIds.push(cleanThread.id);
  return mergedThread;
}

function mergeDirectMessageThreadCollectionIntoState(threadMap = {}) {
  Object.values(threadMap || {}).forEach(thread => mergeDirectMessageThreadIntoState(thread));
  dmThreadIds = [...new Set([
    ...dmThreadIds,
    ...Object.keys(dmThreadMap || {})
  ])].filter(id => {
    const thread = dmThreadMap[id];
    return !thread || !currentUser?.uid || (thread.participantUids || []).includes(currentUser.uid);
  });
  /* v10.761: refresh device-cached inbox snapshot for instant cold-start
     paint on the next launch. Debounced inside scheduleDmInboxCacheWrite()
     so a burst of snapshot updates becomes a single write. See 09b-dm-inbox-cache.js. */
  if (typeof scheduleDmInboxCacheWrite === 'function') {
    try { scheduleDmInboxCacheWrite(); } catch (e) { /* never block a merge */ }
  }
}

let directMessageEncryptedPruneInFlight = false;
async function pruneEncryptedDirectMessageThreadsForCurrentUser() {
  if (!currentUser || directMessageEncryptedPruneInFlight) return;
  const dirty = Object.values(dmThreadMap || {}).filter(thread => Number(thread?._removedEncryptedMessages || 0) > 0);
  if (!dirty.length) return;
  directMessageEncryptedPruneInFlight = true;
  try {
    /* v10.771: was rewriting cleaned threads back into the legacy
       directMessageThreadMap field on the user doc — but that field is
       the very bloat source we're trying to retire (see setDirectMessageThreadMirror
       v10.771). Now we only update the LOCAL dmThreadMap so the UI
       drops the encrypted records; no server write. The canonical
       dmThreads/{threadId} doc is left untouched (it's where the real
       messages live and the existing record-skipping renderers already
       hide encrypted ones). */
    dirty.forEach(thread => {
      const cleanThread = { ...thread };
      delete cleanThread._removedEncryptedMessages;
      dmThreadMap[cleanThread.id] = cleanThread;
    });
  } catch (error) {
    console.warn('Direct Message encrypted-message local cleanup skipped:', error);
  } finally {
    directMessageEncryptedPruneInFlight = false;
  }
}
async function setDirectMessageThreadMirror(uid = '', thread = {}) {
  /* v10.771: LEGACY USER-DOC MIRROR DISABLED. This used to write the
     full thread (messages array and all) to /users/{uid}.directMessageThreadMap
     as a backward-compat path for clients that didn't yet have the
     v10.739 dmThreads listener. Every client is on v10.762+ now (which
     attaches that listener immediately at sign-in), so the mirror is
     dead weight — every DM was bloating the user doc with KB of message
     history, eventually pushing it past Firestore's 1 MiB per-doc cap
     and breaking ALL user-doc writes (username saves, profile updates,
     etc — the v10.770 1 MiB rescue logs were the smoking gun).
     Kept as a no-op stub so callers don't need restructuring.
     The canonical dmThreads/{threadId} write in mirrorDirectMessageThreadToParticipants
     handles real-time delivery and inbox state for everyone. */
  return;
}

/* v10.739: Write the thread to the SHARED dmThreads/{threadId} collection.
   This is the new canonical store — both participants can read/write because
   they're in participantUids (per the v10.739 Firestore rule). Used by
   mirrorDirectMessageThreadToParticipants as the PRIMARY write so the message
   is actually delivered cross-user. */
async function writeSharedDmThread(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  if (!cleanThread.id) throw new Error('writeSharedDmThread: missing thread id');
  delete cleanThread._removedEncryptedMessages;
  await db.collection('dmThreads').doc(cleanThread.id).set(cleanThread, { merge: true });
}

async function mirrorDirectMessageThreadToParticipants(thread = {}) {
  const cleanThread = normalizeDirectMessageThread(thread);
  const participants = cleanThread.participantUids.filter(Boolean);
  /* v10.739: PRIMARY write goes to the shared `dmThreads/{id}` doc. Both
     participants can read this in real time (their dmThreads listener fires
     immediately on any change). If this throws, the message did NOT deliver
     — caller's catch reverts the optimistic local state. This is the path
     that actually fixes the "recipient never gets the message" bug.

     The legacy per-user mirror writes below are best-effort during the
     transition (Deploy 1). The sender's OWN doc mirror still needs to land
     so the legacy friendsDataListener continues to surface threads on
     existing clients that haven't loaded the new dmThreads listener yet.
     Recipient mirror writes WILL fail (Firestore rules block cross-user
     writes to users docs — that's the original bug). We catch + swallow
     those expected failures so they don't tear down the shared write.

     Once Deploy 2 cuts reads over to dmThreads exclusively, the legacy
     per-user mirror writes can be removed entirely. */
  await writeSharedDmThread(cleanThread);
  await Promise.all(participants.map(uid =>
    setDirectMessageThreadMirror(uid, cleanThread).catch(error => {
      if (uid === currentUser?.uid) {
        /* self-mirror failure is unexpected — log loudly */
        console.warn('[v10.739] legacy self user-doc mirror failed:', error?.code || error?.message);
      }
      /* recipient mirror failure is EXPECTED under the standard rules.
         Silent swallow — the shared write above already delivered. */
    })
  ));
}

/* v10.739: Real-time listener on the shared dmThreads collection. Fires
   whenever ANY thread the current user participates in is created or
   updated. Populates dmThreadMap so the UI shows new messages instantly
   on the recipient side — finally fixing the "recipient never gets it"
   bug.

   Runs in parallel with the legacy `friendsDataListener` (which reads
   directMessageThreadMap from the user's own doc) during Deploy 1.
   Both can coexist because incoming thread snapshots are merged into
   local state by message id + timestamp instead of replacing the active
   thread. That keeps an optimistic just-sent message visible while the
   shared write and legacy mirror catch up. */
function startDirectMessageSharedThreadsListener() {
  if (!currentUser || typeof db === 'undefined' || !db) return;
  stopDirectMessageSharedThreadsListener();
  try {
    dmSharedThreadsUnsubscribe = db.collection('dmThreads')
      .where('participantUids', 'array-contains', currentUser.uid)
      .onSnapshot(snap => {
        const incoming = {};
        snap.forEach(doc => {
          const raw = doc.data() || {};
          const cleanThread = normalizeDirectMessageThread({ ...raw, id: doc.id });
          if (cleanThread.id && (cleanThread.participantUids || []).includes(currentUser.uid)) {
            incoming[cleanThread.id] = cleanThread;
            dmHydratedThreadIds.add(cleanThread.id);   // v11.776: server-confirmed → genuine empty distinguishable from loading
          }
        });
        mergeDirectMessageThreadCollectionIntoState(incoming);
        const visibleActiveThreadId = getDirectMessageVisibleActiveThreadId();
        if (visibleActiveThreadId && incoming[visibleActiveThreadId]) {
          markDirectMessageThreadRead(visibleActiveThreadId);
        }
        try { if (typeof renderDirectMessagesView === 'function') renderDirectMessagesView(); } catch (_) {}
        try { if (typeof updateDirectMessagesBadge === 'function') updateDirectMessagesBadge(); } catch (_) {}
        /* One-shot migration: copy any legacy thread that exists ONLY in
           the user's own doc mirror (and not yet in shared) into the shared
           collection so future writes can update it there. */
        if (!dmSharedThreadsMigrationDone) {
          dmSharedThreadsMigrationDone = true;
          migrateLegacyDirectMessageThreadsToShared(incoming).catch(error => {
            console.warn('[v10.739] legacy DM migration skipped:', error?.code || error?.message);
          });
        }
      }, error => {
        console.warn('[v10.739] dmThreads listener error:', error?.code || error?.message);
        /* If the listener fails (likely because the Firestore rule for
           dmThreads hasn't been published yet), don't throw — the legacy
           friendsDataListener path still surfaces threads from the
           sender's own doc, so the UI degrades gracefully. */
      });
  } catch (error) {
    console.warn('[v10.739] startDirectMessageSharedThreadsListener failed:', error?.code || error?.message);
  }
}

function stopDirectMessageSharedThreadsListener() {
  if (dmSharedThreadsUnsubscribe) {
    try { dmSharedThreadsUnsubscribe(); } catch (_) {}
    dmSharedThreadsUnsubscribe = null;
  }
  dmSharedThreadsMigrationDone = false;
}

/* v10.739: One-shot migration — for users with existing threads on their
   user-doc mirror that aren't yet in the shared dmThreads collection, copy
   them over so subsequent writes (which go to dmThreads as primary) update
   the same doc rather than creating an orphan. Fire-and-forget; per-thread
   failures are swallowed so one bad thread can't block the rest. */
async function migrateLegacyDirectMessageThreadsToShared(sharedSnapshot = {}) {
  if (!currentUser || typeof db === 'undefined' || !db) return;
  const sharedIds = new Set(Object.keys(sharedSnapshot || {}));
  const legacyThreads = Object.values(dmThreadMap || {}).filter(thread =>
    thread
    && thread.id
    && !sharedIds.has(thread.id)
    && Array.isArray(thread.participantUids)
    && thread.participantUids.includes(currentUser.uid)
    /* v11.776: NEVER migrate a message-LESS thread. The inbox cache seeds stubs
       with messages:[] for instant paint; if the listener's first snapshot is
       empty/partial (Firestore can emit a cached-empty snapshot first on a cold
       start), every cached stub would look "legacy" and get written to dmThreads
       as an empty thread — wiping the real messages server-side. Only ever copy
       threads that actually carry content. */
    && Array.isArray(thread.messages) && thread.messages.length > 0
  );
  if (!legacyThreads.length) return;
  let migrated = 0;
  for (const thread of legacyThreads) {
    try {
      await writeSharedDmThread(thread);
      migrated += 1;
    } catch (error) {
      console.warn('[v10.739] migrate thread', thread.id, 'failed:', error?.code || error?.message);
    }
  }
  if (migrated) console.info(`[v10.739] migrated ${migrated} legacy DM threads to dmThreads collection`);
}

if (typeof window !== 'undefined') {
  window.startDirectMessageSharedThreadsListener = startDirectMessageSharedThreadsListener;
  window.stopDirectMessageSharedThreadsListener = stopDirectMessageSharedThreadsListener;
}

async function searchDirectMessageUsers(query = '') {
  const q = typeof normalizeShelfdUserSearchQuery === 'function'
    ? normalizeShelfdUserSearchQuery(query)
    : String(query || '').trim().replace(/^@+/, '').toLowerCase();
  const resultsEl = document.getElementById('dm-search-results');
  const suggestedEl = document.getElementById('dm-new-suggested');
  if (!resultsEl) return;
  if (!q) {
    dmSearchResults = [];
    resultsEl.innerHTML = '';
    if (suggestedEl) suggestedEl.style.display = '';
    return;
  }
  if (suggestedEl) suggestedEl.style.display = 'none';
  resultsEl.innerHTML = `<div class="dm-search-empty">Searching...</div>`;
  try {
    const results = new Map();
    const addUser = (raw = {}, fallbackUid = '') => {
      const uid = String(raw.uid || fallbackUid || '').trim();
      if (!uid || uid === currentUser?.uid || results.has(uid)) return;
      const user = { ...raw, uid };
      results.set(uid, user);
      usersMap[uid] = { ...(usersMap[uid] || {}), ...user };
    };

    try {
      const handleMatches = typeof fetchShelfdUsersByHandlePrefix === 'function'
        ? await fetchShelfdUsersByHandlePrefix(q, { limit: 10, excludeUid: currentUser?.uid })
        : [];
      handleMatches.forEach(user => addUser(user, user?.uid || ''));
    } catch (handleError) {
      console.warn('DM handle search lookup failed:', handleError);
    }

    const snap = await db.collection('users')
      .where('nameLower', '>=', q)
      .where('nameLower', '<=', q + '\uf8ff')
      .limit(10)
      .get();
    snap.forEach(doc => {
      addUser(doc.data() || {}, doc.id || '');
    });
    dmSearchResults = [...results.values()].sort((a, b) => {
      const aHandle = String(a.usernameHandleLower || a.usernameHandle || a.username || '').trim().replace(/^@+/, '').toLowerCase();
      const bHandle = String(b.usernameHandleLower || b.usernameHandle || b.username || '').trim().replace(/^@+/, '').toLowerCase();
      const aName = String(a.nameLower || a.customNameLower || a.displayNameLower || a.name || a.customName || a.displayName || '').trim().toLowerCase();
      const bName = String(b.nameLower || b.customNameLower || b.displayNameLower || b.name || b.customName || b.displayName || '').trim().toLowerCase();
      const aRank = aHandle === q ? 0 : aHandle.startsWith(q) ? 1 : aName === q ? 2 : aName.startsWith(q) ? 3 : 4;
      const bRank = bHandle === q ? 0 : bHandle.startsWith(q) ? 1 : bName === q ? 2 : bName.startsWith(q) ? 3 : 4;
      if (aRank !== bRank) return aRank - bRank;
      return aName.localeCompare(bName);
    }).slice(0, 10);
    renderDirectMessageSearchResults(q);
  } catch (error) {
    console.error('Direct Message search failed:', error);
    resultsEl.innerHTML = `<div class="dm-search-empty">Could not search right now.</div>`;
  }
}

function onDirectMessageSearchInput(value = '') {
  clearTimeout(dmSearchTimer);
  dmSearchTimer = setTimeout(() => searchDirectMessageUsers(value), 220);
}

function renderDirectMessageSearchResults(query = '') {
  const resultsEl = document.getElementById('dm-search-results');
  if (!resultsEl) return;
  if (!dmSearchResults.length) {
    resultsEl.innerHTML = `<div class="dm-search-empty">No users found for "${escHtml(query)}".</div>`;
    return;
  }
  resultsEl.innerHTML = dmSearchResults
    .map(user => dmComposerUserRowHTML(getDirectMessageProfile(user.uid, user)))
    .join('');
}
function openDirectMessageComposer(mode = 'direct') {
  dmNewChatOpen = true;
  dmNewChatMode = mode === 'group' ? 'group' : 'direct';
  dmNewChatSelectedUids = [];
  dmNewChatGroupPhotoData = '';
  dmNewChatGroupName = '';
  dmSearchResults = [];
  clearTimeout(dmSearchTimer);
  renderDirectMessagesView();
  requestAnimationFrame(() => {
    const input = document.getElementById('dm-user-search');
    if (!input) return;
    try { input.focus({ preventScroll: true }); }
    catch (_) { input.focus(); }
  });
}

function closeDirectMessageComposer() {
  dmNewChatOpen = false;
  dmNewChatSelectedUids = [];
  dmNewChatGroupPhotoData = '';
  dmNewChatGroupName = '';
  dmSearchResults = [];
  clearTimeout(dmSearchTimer);
  renderDirectMessagesView();
}

function switchDirectMessageComposerMode(mode = 'direct') {
  dmNewChatMode = mode === 'group' ? 'group' : 'direct';
  dmNewChatSelectedUids = [];
  dmSearchResults = [];
  renderDirectMessagesView();
}

function toggleDirectMessageGroupUser(uid = '') {
  if (!uid || uid === currentUser?.uid) return;
  const query = String(document.getElementById('dm-user-search')?.value || '').trim();
  dmNewChatGroupName = String(document.getElementById('dm-group-name-input')?.value || dmNewChatGroupName || '').trim();
  if (dmNewChatSelectedUids.includes(uid)) {
    dmNewChatSelectedUids = dmNewChatSelectedUids.filter(id => id !== uid);
  } else {
    dmNewChatSelectedUids = [...dmNewChatSelectedUids, uid];
  }
  renderDirectMessagesView();
  const input = document.getElementById('dm-user-search');
  if (input) input.value = query;
  if (dmSearchResults.length) renderDirectMessageSearchResults(query);
}
function renderDirectMessageComposerPanel() {
  const selectedProfiles = dmNewChatSelectedUids.map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}));
  return `<div class="dm-new-chat-panel">
    <div class="dm-new-chat-head">
      <div><strong>New Message</strong>${dmNewChatMode === 'group' ? '<span>Create a group chat</span>' : ''}</div>
      <button type="button" onclick="closeDirectMessageComposer()" aria-label="Close new message">×</button>
    </div>
    <div class="dm-new-chat-tabs">
      <button class="${dmNewChatMode === 'direct' ? 'active' : ''}" type="button" onclick="switchDirectMessageComposerMode('direct')">1:1</button>
      <button class="${dmNewChatMode === 'group' ? 'active' : ''}" type="button" onclick="switchDirectMessageComposerMode('group')">Group</button>
    </div>
    ${dmNewChatMode === 'group' ? `<div class="dm-group-setup-row">
      <button class="dm-group-photo-btn" type="button" onclick="triggerDirectMessageNewGroupPhotoInput()">
        ${dmNewChatGroupPhotoData ? `<img src="${escAttr(dmNewChatGroupPhotoData)}" alt="" loading="lazy">` : '<span>＋</span>'}
      </button>
      <input id="dm-new-group-photo-input" type="file" accept="image/*" style="display:none" onchange="handleDirectMessageNewGroupPhoto(this.files && this.files[0])">
      <input id="dm-group-name-input" type="text" maxlength="48" placeholder="Group name" autocomplete="off" value="${escAttr(dmNewChatGroupName)}" oninput="dmNewChatGroupName=this.value">
    </div>
    <div class="dm-group-selected" id="dm-group-selected-count">${dmNewChatSelectedUids.length} selected</div>
    ${selectedProfiles.length ? `<div class="dm-group-selected-list">${selectedProfiles.map(profile => `<button type="button" onclick="toggleDirectMessageGroupUser('${escAttr(profile.uid)}')"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt=""><span>${renderDisplayNameHTML(profile, 'User', '', { suppressCreativeTeamTag: true })}</span>×</button>`).join('')}</div>` : ''}
    <button class="dm-create-group-btn" type="button" onclick="createDirectMessageGroupChat()" ${dmNewChatSelectedUids.length ? '' : 'disabled'}>Create Group Chat</button>` : ''}
    <div class="dm-search-strip dm-new-search-strip"><input id="dm-user-search" type="text" placeholder="Search users" autocomplete="off" oninput="onDirectMessageSearchInput(this.value)"><div id="dm-search-results"></div></div>
  </div>`;
}

function triggerDirectMessageNewGroupPhotoInput() {
  document.getElementById('dm-new-group-photo-input')?.click();
}

/* v11.389: full-page Instagram-style new-message flow.
     • Direct mode → "New message": back chevron + centered title, a "To: Search"
       field, a "Group chat" entry row, then a "Suggested" people list. (No
       AI-chats row.)
     • Group mode → "New group chat": back chevron + title + Create action, a
       "Group name (optional)" field, a search bar, then the "Suggested" people
       list with circular checkboxes on the right for multi-select.
   The legacy modal renderer above is kept for rollback history; this later
   declaration owns the active UI at runtime. */
function renderDirectMessageComposerPanel() {
  const suggestedHtml = renderDmComposerSuggestedUsers();
  const suggestedBlock = suggestedHtml
    ? `<div class="dm-new-suggested" id="dm-new-suggested"><div class="dm-new-suggested-head">Suggested</div>${suggestedHtml}</div>`
    : `<div class="dm-new-suggested" id="dm-new-suggested"></div>`;

  if (dmNewChatMode === 'group') {
    const selectedProfiles = dmNewChatSelectedUids.map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}));
    return `<div class="dm-new-chat-page dm-new-chat-group" role="dialog" aria-modal="true" aria-label="New group chat">
      <header class="dm-new-chat-topbar">
        <button class="dm-new-chat-back" type="button" onclick="switchDirectMessageComposerMode('direct')" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
        </button>
        <span class="dm-new-chat-title">New group chat</span>
        <button class="dm-new-chat-create" type="button" onclick="createDirectMessageGroupChat()" ${dmNewChatSelectedUids.length ? '' : 'disabled'}>Create</button>
      </header>
      <div class="dm-new-chat-body">
        <input class="dm-group-name-field" id="dm-group-name-input" type="text" maxlength="48" placeholder="Group name (optional)" autocomplete="off" value="${escAttr(dmNewChatGroupName)}" oninput="dmNewChatGroupName=this.value">
        <div class="dm-new-search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="dm-user-search" type="text" placeholder="Search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="onDirectMessageSearchInput(this.value)">
        </div>
        ${selectedProfiles.length ? `<div class="dm-group-selected-list">${selectedProfiles.map(profile => `<button type="button" class="dm-group-selected-chip" onclick="toggleDirectMessageGroupUser('${escAttr(profile.uid)}')"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt=""><span>${renderDisplayNameHTML(profile, 'User', '', { suppressCreativeTeamTag: true })}</span><em aria-hidden="true">&times;</em></button>`).join('')}</div>` : ''}
        <div id="dm-search-results" class="dm-new-search-results"></div>
        ${suggestedBlock}
      </div>
    </div>`;
  }

  return `<div class="dm-new-chat-page dm-new-chat-direct" role="dialog" aria-modal="true" aria-label="New message">
    <header class="dm-new-chat-topbar">
      <button class="dm-new-chat-back" type="button" onclick="closeDirectMessageComposer()" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
      </button>
      <span class="dm-new-chat-title">New message</span>
      <span class="dm-new-chat-topbar-spacer" aria-hidden="true"></span>
    </header>
    <div class="dm-new-chat-body">
      <div class="dm-new-to-row">
        <span class="dm-new-to-label">To:</span>
        <input id="dm-user-search" type="text" placeholder="Search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="onDirectMessageSearchInput(this.value)">
      </div>
      <button class="dm-new-group-entry" type="button" onclick="switchDirectMessageComposerMode('group')">
        <span class="dm-new-group-entry-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
        <span class="dm-new-group-entry-label">Group chat</span>
        <span class="dm-new-group-entry-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </button>
      <div id="dm-search-results" class="dm-new-search-results"></div>
      ${suggestedBlock}
    </div>
  </div>`;
}

/* Suggested people = the user's confirmed friends. Shown by default (before any
   search). Group mode renders the same rows but with a circular checkbox. */
function renderDmComposerSuggestedUsers() {
  const uids = (Array.isArray(friends) ? friends : []).filter(uid => uid && uid !== currentUser?.uid);
  if (!uids.length) return '';
  const rows = uids.map(uid => dmComposerUserRowHTML(getDirectMessageProfile(uid, usersMap[uid] || {}))).join('');
  return `<div class="dm-new-suggested-list">${rows}</div>`;
}

/* One person row, used by both the Suggested list and live search results. */
function dmComposerUserRowHTML(profile = {}) {
  const uid = String(profile.uid || '');
  const username = String(usersMap[uid]?.username || usersMap[uid]?.handle || '').trim();
  const sub = username ? `<span class="dm-new-user-sub">${escHtml(username)}</span>` : '';
  const nameHtml = `<span class="dm-new-user-name">${renderDisplayNameHTML(profile, 'User', '', { suppressCreativeTeamTag: true })}</span>`;
  const avatar = `<img class="dm-new-user-avatar" src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">`;
  if (dmNewChatMode === 'group') {
    const isSelected = dmNewChatSelectedUids.includes(uid);
    const check = isSelected
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
      : '';
    return `<button type="button" class="dm-new-user-row ${isSelected ? 'is-selected' : ''}" onclick="toggleDirectMessageGroupUser('${escAttr(uid)}')">
      ${avatar}
      <span class="dm-new-user-text">${nameHtml}${sub}</span>
      <span class="dm-new-user-check ${isSelected ? 'is-checked' : ''}" aria-hidden="true">${check}</span>
    </button>`;
  }
  const thread = getDirectMessageThreadWithUser(uid);
  const isFriend = isDirectMessageFriend(uid);
  let hint = '';
  if (!thread && !isFriend) {
    const outgoing = getDirectMessageRequestWithUser(uid, 'outgoing');
    const incoming = getDirectMessageRequestWithUser(uid, 'incoming');
    hint = outgoing ? 'Requested' : incoming ? 'Accept' : 'Request';
  }
  const hintHtml = hint ? `<span class="dm-new-user-hint ${hint === 'Requested' ? 'is-muted' : ''}">${hint}</span>` : '';
  return `<button type="button" class="dm-new-user-row" onclick="dmComposerPickUser('${escAttr(uid)}')">
    ${avatar}
    <span class="dm-new-user-text">${nameHtml}${sub}</span>
    ${hintHtml}
  </button>`;
}

/* Direct-mode row tap: open existing thread, message a friend, accept an
   incoming request, or send a new message request. */
function dmComposerPickUser(uid = '') {
  if (!uid) return;
  const thread = getDirectMessageThreadWithUser(uid);
  if (thread) { openDirectMessageThread(thread.id); return; }
  if (isDirectMessageFriend(uid)) { openOrCreateDirectMessageThreadForUser(uid); return; }
  const incoming = getDirectMessageRequestWithUser(uid, 'incoming');
  if (incoming) { acceptDirectMessageRequest(incoming.id); return; }
  const outgoing = getDirectMessageRequestWithUser(uid, 'outgoing');
  if (outgoing) { if (typeof showToast === 'function') showToast('Message request already sent'); return; }
  sendDirectMessageRequest(uid);
}

async function handleDirectMessageNewGroupPhoto(file) {
  if (!file) return;
  try {
    dmNewChatGroupPhotoData = await resizeDirectMessageImageFile(file, 420, 0.78);
    renderDirectMessagesView();
  } catch (error) {
    console.error('Group photo load failed:', error);
    showToast('Could not use that photo');
  }
}

async function createDirectMessageGroupChat() {
  if (!currentUser || !dmNewChatSelectedUids.length) return;
  const selected = [...new Set(dmNewChatSelectedUids.filter(uid => uid && uid !== currentUser.uid))];
  if (!selected.length) return;
  const nameInput = document.getElementById('dm-group-name-input');
  dmNewChatGroupName = String(nameInput?.value || dmNewChatGroupName || '').trim();
  const now = Date.now();
  const selfProfile = getCurrentUserDirectMessageProfile();
  const participants = { [currentUser.uid]: selfProfile };
  selected.forEach(uid => {
    participants[uid] = getDirectMessageProfile(uid, usersMap[uid] || {});
  });
  const defaultName = selected.map(uid => getDisplayName(participants[uid], 'User')).filter(Boolean).slice(0, 3).join(', ');
  const thread = normalizeDirectMessageThread({
    id: `dmgroup_${currentUser.uid}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'group',
    isGroup: true,
    groupName: dmNewChatGroupName || defaultName || 'Group Chat',
    groupPhoto: dmNewChatGroupPhotoData || '',
    ownerUid: currentUser.uid,
    adminUids: [currentUser.uid],
    participantUids: [currentUser.uid, ...selected],
    participants,
    messages: [],
    lastMessage: 'Group chat created',
    lastMessageFromUid: currentUser.uid,
    lastMessageAtMs: now,
    unreadUids: selected,
    createdAtMs: now,
    updatedAtMs: now
  });
  try {
    await mirrorDirectMessageThreadToParticipants(thread);
    dmThreadIds = [...new Set([...dmThreadIds, thread.id])];
    dmThreadMap[thread.id] = thread;
    dmNewChatOpen = false;
    dmNewChatSelectedUids = [];
    dmNewChatGroupPhotoData = '';
    dmNewChatGroupName = '';
    activeMessagesSubTab = 'chats';
    activeDmThreadId = thread.id;
    syncDirectMessageActiveThreadState('group-created');
    renderDirectMessagesView();
    showToast('Group chat created');
  } catch (error) {
    console.error('createDirectMessageGroupChat failed:', error);
    showToast('Could not create group chat');
  }
}

function triggerDirectMessageGroupPhotoInput(threadId = activeDmThreadId) {
  if (!threadId || !isDirectMessageGroupThread(dmThreadMap[threadId])) return;
  const input = document.getElementById('dm-group-photo-input') || (() => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/*';
    el.id = 'dm-group-photo-input';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  })();
  input.onchange = () => handleDirectMessageGroupPhotoUpload(threadId, input.files && input.files[0]);
  input.click();
}

async function handleDirectMessageGroupPhotoUpload(threadId = activeDmThreadId, file) {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !file || !isDirectMessageGroupThread(thread)) return;
  try {
    const groupPhoto = await resizeDirectMessageImageFile(file, 420, 0.78);
    const nextThread = normalizeDirectMessageThread({ ...thread, groupPhoto, updatedAtMs: Date.now() });
    dmThreadMap[threadId] = nextThread;
    renderDirectMessagesView();
    await mirrorDirectMessageThreadToParticipants(nextThread);
    showToast('Group photo updated');
  } catch (error) {
    console.error('Group photo update failed:', error);
    showToast('Could not update group photo');
  }
}

function resizeDirectMessageImageFile(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('Not an image'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = String(reader.result || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function triggerDirectMessagePhotoUpload(threadId = activeDmThreadId) {
  const input = document.getElementById(`dm-photo-input-${threadId}`);
  input?.click();
}

async function handleDirectMessagePhotoUpload(threadId = activeDmThreadId, file) {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !file) return;
  try {
    const imageData = await resizeDirectMessageImageFile(file, 720, 0.74);
    await appendDirectMessageToThread(threadId, '', null, { imageData, name: file.name || 'Photo' });
  } catch (error) {
    console.error('Direct Message photo upload failed:', error);
    showToast('Could not send photo');
  }
}

async function openOrCreateDirectMessageThreadForUser(uid = '') {
  if (!currentUser || !uid || uid === currentUser.uid) return null;
  const existingThread = getDirectMessageThreadWithUser(uid);
  if (existingThread) {
    openDirectMessageThread(existingThread.id);
    return existingThread;
  }

  try {
    const targetSnap = await db.collection('users').doc(uid).get();
    const targetUser = targetSnap.exists ? { uid: targetSnap.id, ...(targetSnap.data() || {}) } : { uid, ...(usersMap[uid] || {}) };
    if (!targetUser.uid) throw new Error('Missing target user');
    usersMap[uid] = { ...(usersMap[uid] || {}), ...targetUser };

    const selfProfile = getCurrentUserDirectMessageProfile();
    const targetProfile = getDirectMessageProfile(uid, targetUser);
    const now = Date.now();
    const thread = normalizeDirectMessageThread({
      id: buildDirectMessagePairId('dm', currentUser.uid, uid),
      participantUids: [currentUser.uid, uid].filter(Boolean),
      participants: {
        [currentUser.uid]: selfProfile,
        [uid]: targetProfile
      },
      messages: [],
      lastMessage: '',
      lastMessageFromUid: '',
      lastMessageAtMs: now,
      unreadUids: [],
      createdAtMs: now,
      updatedAtMs: now
    });

    const requestId = buildDirectMessagePairId('dmreq', currentUser.uid, uid);
    await Promise.all([
      mirrorDirectMessageThreadToParticipants(thread),
      clearDirectMessageRequestMirror(currentUser.uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(currentUser.uid, 'outgoing', requestId),
      clearDirectMessageRequestMirror(uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(uid, 'outgoing', requestId)
    ]);

    dmIncomingRequestIds = dmIncomingRequestIds.filter(id => id !== requestId);
    dmOutgoingRequestIds = dmOutgoingRequestIds.filter(id => id !== requestId);
    delete dmIncomingRequestMap[requestId];
    delete dmOutgoingRequestMap[requestId];
    dmThreadIds = [...new Set([...dmThreadIds, thread.id])];
    dmThreadMap[thread.id] = thread;
    activeMessagesSubTab = 'chats';
    activeDmThreadId = thread.id;
    syncDirectMessageActiveThreadState('thread-created');
    updateDirectMessagesBadge();
    if (isDirectMessagesPageOpen()) renderDirectMessagesView();
    return thread;
  } catch (error) {
    console.error('openOrCreateDirectMessageThreadForUser failed:', error);
    showToast('Could not open message');
    return null;
  }
}

async function sendDirectMessageRequest(uid = '') {
  if (!currentUser || !uid || uid === currentUser.uid) return;
  const existingThread = getDirectMessageThreadWithUser(uid);
  if (existingThread) {
    openDirectMessageThread(existingThread.id);
    return;
  }
  if (isDirectMessageFriend(uid)) {
    await openOrCreateDirectMessageThreadForUser(uid);
    return;
  }
  const incoming = getDirectMessageRequestWithUser(uid, 'incoming');
  if (incoming) {
    await acceptDirectMessageRequest(incoming.id);
    return;
  }
  const outgoing = getDirectMessageRequestWithUser(uid, 'outgoing');
  if (outgoing) {
    showToast('Message request already sent');
    return;
  }
  try {
    const targetSnap = await db.collection('users').doc(uid).get();
    const targetUser = targetSnap.exists ? { uid: targetSnap.id, ...(targetSnap.data() || {}) } : { uid, ...(usersMap[uid] || {}) };
    if (!targetUser.uid) throw new Error('Missing target user');
    usersMap[uid] = { ...(usersMap[uid] || {}), ...targetUser };
    const requestId = buildDirectMessagePairId('dmreq', currentUser.uid, uid);
    const payload = getDirectMessageRequestPayload(targetUser, requestId);
    dmOutgoingRequestIds = [...new Set([...dmOutgoingRequestIds, requestId])];
    dmOutgoingRequestMap[requestId] = payload;
    await Promise.all([
      setDirectMessageRequestMirror(currentUser.uid, 'outgoing', requestId, payload, true),
      setDirectMessageRequestMirror(uid, 'incoming', requestId, payload, true)
    ]);
    dmNewChatOpen = false;
    activeMessagesSubTab = 'requests';
    updateDirectMessagesBadge();
    if (isDirectMessagesPageOpen()) renderDirectMessagesView();
    showToast('Message request sent');
  } catch (error) {
    console.error('sendDirectMessageRequest failed:', error);
    showToast('Could not send message request');
  }
}

async function acceptDirectMessageRequest(requestId = '') {
  const request = dmIncomingRequestMap[requestId];
  if (!currentUser || !request) {
    showToast('Request not found');
    return;
  }
  try {
    const now = Date.now();
    const thread = normalizeDirectMessageThread({
      id: request.threadId || buildDirectMessagePairId('dm', request.fromUid, request.toUid),
      participantUids: [request.fromUid, request.toUid].filter(Boolean),
      participants: request.participants || {
        [request.fromUid]: request.fromProfile || {},
        [request.toUid]: request.toProfile || {}
      },
      messages: [],
      lastMessage: 'Messages unlocked',
      lastMessageFromUid: currentUser.uid,
      lastMessageAtMs: now,
      unreadUids: [request.fromUid].filter(Boolean),
      createdAtMs: request.createdAtMs || now,
      updatedAtMs: now
    });
    await Promise.all([
      clearDirectMessageRequestMirror(currentUser.uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(request.fromUid, 'outgoing', requestId),
      mirrorDirectMessageThreadToParticipants(thread)
    ]);
    dmIncomingRequestIds = dmIncomingRequestIds.filter(id => id !== requestId);
    delete dmIncomingRequestMap[requestId];
    dmThreadIds = [...new Set([...dmThreadIds, thread.id])];
    dmThreadMap[thread.id] = thread;
    activeMessagesSubTab = 'chats';
    activeDmThreadId = thread.id;
    syncDirectMessageActiveThreadState('request-accepted');
    updateDirectMessagesBadge();
    renderDirectMessagesView();
    showToast('Message request accepted');
  } catch (error) {
    console.error('acceptDirectMessageRequest failed:', error);
    showToast('Could not accept request');
  }
}

async function declineDirectMessageRequest(requestId = '') {
  const request = dmIncomingRequestMap[requestId];
  if (!currentUser || !request) return;
  try {
    await Promise.all([
      clearDirectMessageRequestMirror(currentUser.uid, 'incoming', requestId),
      clearDirectMessageRequestMirror(request.fromUid, 'outgoing', requestId)
    ]);
    dmIncomingRequestIds = dmIncomingRequestIds.filter(id => id !== requestId);
    delete dmIncomingRequestMap[requestId];
    updateDirectMessagesBadge();
    renderDirectMessagesView();
    showToast('Message request declined');
  } catch (error) {
    console.error('declineDirectMessageRequest failed:', error);
    showToast('Could not decline request');
  }
}

async function cancelDirectMessageRequest(requestId = '') {
  const request = dmOutgoingRequestMap[requestId];
  if (!currentUser || !request) return;
  try {
    await Promise.all([
      clearDirectMessageRequestMirror(currentUser.uid, 'outgoing', requestId),
      clearDirectMessageRequestMirror(request.toUid, 'incoming', requestId)
    ]);
    dmOutgoingRequestIds = dmOutgoingRequestIds.filter(id => id !== requestId);
    delete dmOutgoingRequestMap[requestId];
    updateDirectMessagesBadge();
    renderDirectMessagesView();
    showToast('Message request removed');
  } catch (error) {
    console.error('cancelDirectMessageRequest failed:', error);
    showToast('Could not remove request');
  }
}

function switchMessagesSubTab(tab = 'chats') {
  activeMessagesSubTab = tab === 'requests' ? 'requests' : 'chats';
  if (activeMessagesSubTab !== 'chats') {
    activeDmThreadId = '';
    clearDirectMessageActiveThreadState('messages-subtab');
  }
  renderDirectMessagesView();
  persistUiState();
}

function getSortedDirectMessageThreads() {
  return Object.values(dmThreadMap || {})
    .filter(thread => thread && thread.id && Array.isArray(thread.participantUids) && thread.participantUids.includes(currentUser?.uid))
    .sort((a, b) => Number(b.lastMessageAtMs || b.updatedAtMs || 0) - Number(a.lastMessageAtMs || a.updatedAtMs || 0));
}

function formatDirectMessageTime(ts = 0) {
  const n = Number(ts || 0);
  if (!n) return '';
  const diff = Math.max(0, Date.now() - n);
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m`;
  if (diff < 86400000) return `${Math.max(1, Math.round(diff / 3600000))}h`;
  return new Date(n).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDirectMessageSentTime(ts = 0) {
  const n = Number(ts || 0);
  if (!n) return '';
  const diff = Math.max(0, Date.now() - n);
  if (diff < 60000) return 'now';
  if (diff < 3600000) {
    const mins = Math.max(1, Math.round(diff / 60000));
    return `${mins} min ago`;
  }
  if (diff < 86400000) return `${Math.max(1, Math.round(diff / 3600000))}h`;
  return new Date(n).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDirectMessageChatPreviewText(thread = {}) {
  const msg = thread.lastMessage || (isDirectMessageGroupThread(thread) ? 'Group chat created' : 'Messages unlocked');
  return msg;
}

function getDirectMessageUnreadMessageCount(thread = {}) {
  if (!currentUser?.uid || !Array.isArray(thread.unreadUids) || !thread.unreadUids.includes(currentUser.uid)) return 0;
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  if (!messages.length) return 0;
  const readAt = Number(thread.readAtMsByUid?.[currentUser.uid] || 0);
  const count = messages.filter(message => {
    if (!message || message.fromUid === currentUser.uid) return false;
    const ts = Number(message.createdAtMs || message.sentAtMs || message.updatedAtMs || 0);
    return readAt > 0 ? ts > readAt : true;
  }).length;
  return count;
}

function renderDirectMessageInboxLine2HTML(thread = {}) {
  const timeMs = thread.lastMessageAtMs || thread.updatedAtMs;
  if (thread.lastMessageFromUid && thread.lastMessageFromUid === currentUser?.uid) {
    const sentTime = formatDirectMessageSentTime(timeMs);
    return `<div class="dm-chat-line2"><span class="dm-chat-preview dm-chat-preview-sent">Sent${sentTime ? ` ${escHtml(sentTime)}` : ''}</span></div>`;
  }
  const unreadCount = getDirectMessageUnreadMessageCount(thread);
  if (unreadCount > 1) {
    return `<div class="dm-chat-line2"><span class="dm-chat-preview dm-chat-preview-unread-count">${unreadCount} new messages</span><span class="dm-chat-time">${formatDirectMessageTime(timeMs)}</span></div>`;
  }
  return `<div class="dm-chat-line2"><span class="dm-chat-preview">${escHtml(getDirectMessageChatPreviewText(thread))}</span><span class="dm-chat-time">${formatDirectMessageTime(timeMs)}</span></div>`;
}

function renderDirectMessageRequests() {
  const incoming = dmIncomingRequestIds.map(id => dmIncomingRequestMap[id]).filter(Boolean)
    .sort((a, b) => Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0));
  const outgoing = dmOutgoingRequestIds.map(id => dmOutgoingRequestMap[id]).filter(Boolean)
    .sort((a, b) => Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0));
  if (!incoming.length && !outgoing.length) {
    return `<div class="dm-empty-card"><strong>No message requests</strong><span>Message requests appear here.</span></div>`;
  }
  const renderCard = (req, direction) => {
    const profile = getDirectMessageRequestOtherProfile(req, direction);
    const incomingCard = direction === 'incoming';
    return `<article class="dm-request-card ${incomingCard ? 'incoming' : 'outgoing'}">
      <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
      <div class="dm-request-copy">
        <span>${incomingCard ? 'Wants to message you' : 'Request sent'}</span>
        <strong>${renderDisplayNameHTML(profile, 'User', '', { suppressCreativeTeamTag: true })}</strong>
        <em>${incomingCard ? 'Accept to unlock a private direct message thread.' : 'Waiting for them to accept. You can remove it anytime.'}</em>
      </div>
      <div class="dm-request-actions">
        ${incomingCard
          ? `<button class="dm-action accept" type="button" onclick="acceptDirectMessageRequest('${escAttr(req.id)}')">Accept</button><button class="dm-action decline" type="button" onclick="declineDirectMessageRequest('${escAttr(req.id)}')">Decline</button>`
          : `<button class="dm-action decline" type="button" onclick="cancelDirectMessageRequest('${escAttr(req.id)}')">Remove</button>`}
      </div>
    </article>`;
  };
  return `<div class="dm-requests-list">
    ${incoming.length ? `<section><div class="dm-section-label">Needs your response</div>${incoming.map(req => renderCard(req, 'incoming')).join('')}</section>` : ''}
    ${outgoing.length ? `<section><div class="dm-section-label">Sent by you</div>${outgoing.map(req => renderCard(req, 'outgoing')).join('')}</section>` : ''}
  </div>`;
}

function renderDirectMessageChats() {
  const threads = getSortedDirectMessageThreads();
  if (!threads.length) {
    return `<div class="dm-empty-card"><strong>No chats yet</strong><span>Tap the pencil to start a message.</span></div>`;
  }
  return `<div class="dm-chat-list">${threads.map(thread => {
    const profile = getDirectMessageThreadProfile(thread);
    const unread = Array.isArray(thread.unreadUids) && thread.unreadUids.includes(currentUser?.uid);
    return `<div class="dm-chat-swipe-item" data-dm-thread-id="${escAttr(thread.id)}">
      <button class="dm-chat-delete-action" type="button" onclick="event.stopPropagation();deleteDirectMessageThreadForMe('${escAttr(thread.id)}')" aria-label="Delete chat" title="Delete chat">🗑</button>
      <button class="dm-chat-row ${unread ? 'unread' : ''}" type="button" onclick="handleDirectMessageChatRowClick(event, '${escAttr(thread.id)}')">
        <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" decoding="sync">
        <div class="dm-chat-copy">
          <strong>${renderDirectMessageInboxNameHTML(profile)}</strong>
          ${renderDirectMessageInboxLine2HTML(thread)}
        </div>
        ${unread ? '<span class="dm-chat-unread-dot" aria-hidden="true"></span>' : ''}
      </button>
    </div>`;
  }).join('')}</div>`;
}


function closeDirectMessageChatSwipeRows(exceptItem = null) {
  document.querySelectorAll('.dm-chat-swipe-item.swipe-open').forEach(item => {
    if (exceptItem && item === exceptItem) return;
    item.classList.remove('swipe-open');
    item.style.setProperty('--dm-chat-swipe-x', '0px');
  });
}

function handleDirectMessageChatRowClick(event, threadId = '') {
  const item = event?.currentTarget?.closest?.('.dm-chat-swipe-item');
  if (item && item.classList.contains('swipe-open')) {
    event.preventDefault();
    event.stopPropagation();
    closeDirectMessageChatSwipeRows();
    return;
  }
  openDirectMessageThread(threadId);
}

async function deleteDirectMessageThreadForMe(threadId = '') {
  if (!currentUser || !threadId) return;
  const thread = dmThreadMap[threadId];
  delete dmThreadMap[threadId];
  dmThreadIds = dmThreadIds.filter(id => id !== threadId);
  if (activeDmThreadId === threadId) {
    activeDmThreadId = '';
    clearDirectMessageActiveThreadState('thread-delete');
  }
  closeDirectMessageChatSwipeRows();
  updateDirectMessagesBadge();
  renderDirectMessagesView();
  try {
    const ref = db.collection('users').doc(currentUser.uid);
    await ref.set({
      directMessageThreads: firebase.firestore.FieldValue.arrayRemove(threadId)
    }, { merge: true });
    try {
      await ref.update({ [`directMessageThreadMap.${threadId}`]: firebase.firestore.FieldValue.delete() });
    } catch (mapError) {
      console.warn('Direct Message thread map cleanup skipped:', mapError);
    }
    showToast('Chat deleted');
  } catch (error) {
    console.error('deleteDirectMessageThreadForMe failed:', error);
    if (thread) dmThreadMap[threadId] = thread;
    dmThreadIds = [...new Set([...dmThreadIds, threadId])];
    renderDirectMessagesView();
    showToast('Could not delete chat');
  }
}

let dmChatSwipeState = null;
let dmChatSwipeRaf = 0;

function applyDirectMessageChatSwipe(item, x) {
  if (!item) return;
  const clamped = Math.max(-88, Math.min(0, x));
  item.style.setProperty('--dm-chat-swipe-x', clamped + 'px');
}

function scheduleDirectMessageChatSwipe(item, x) {
  if (dmChatSwipeRaf) cancelAnimationFrame(dmChatSwipeRaf);
  dmChatSwipeRaf = requestAnimationFrame(() => {
    dmChatSwipeRaf = 0;
    applyDirectMessageChatSwipe(item, x);
  });
}

function initDirectMessageChatSwipeActions() {
  if (window.__screenListDmChatSwipeActionsReady) return;
  window.__screenListDmChatSwipeActionsReady = true;

  document.addEventListener('touchstart', event => {
    const item = event.target?.closest?.('.dm-chat-swipe-item');
    if (!item || activeDmThreadId || activeDmGroupEditThreadId || event.touches.length !== 1) return;
    if (event.target?.closest?.('.dm-chat-delete-action')) return;
    const touch = event.touches[0];
    dmChatSwipeState = {
      item,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      swiping: false,
      verticalLocked: false
    };
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    const state = dmChatSwipeState;
    if (!state || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    state.lastX = touch.clientX;

    if (!state.swiping) {
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 1.05) {
        state.verticalLocked = true;
        return;
      }
      if (state.verticalLocked) return;
      if (dx > -12 || Math.abs(dx) < Math.abs(dy) * 1.12) return;
      state.swiping = true;
      closeDirectMessageChatSwipeRows(state.item);
      state.item.classList.add('is-swiping');
    }

    if (state.swiping) {
      event.preventDefault();
      scheduleDirectMessageChatSwipe(state.item, dx);
    }
  }, { passive: false });

  const finishSwipe = () => {
    const state = dmChatSwipeState;
    dmChatSwipeState = null;
    if (!state) return;
    if (dmChatSwipeRaf) {
      cancelAnimationFrame(dmChatSwipeRaf);
      dmChatSwipeRaf = 0;
    }
    state.item.classList.remove('is-swiping');
    if (!state.swiping) return;
    const distance = state.lastX - state.startX;
    if (distance <= -42) {
      state.item.classList.add('swipe-open');
      state.item.style.setProperty('--dm-chat-swipe-x', '-88px');
    } else {
      state.item.classList.remove('swipe-open');
      state.item.style.setProperty('--dm-chat-swipe-x', '0px');
    }
  };

  document.addEventListener('touchend', finishSwipe, { passive: true });
  document.addEventListener('touchcancel', finishSwipe, { passive: true });
  document.addEventListener('click', event => {
    if (event.target?.closest?.('.dm-chat-swipe-item, .dm-chat-delete-action')) return;
    closeDirectMessageChatSwipeRows();
  }, { passive: true });
}

initDirectMessageChatSwipeActions();
function openDirectMessageGroupEdit(threadId = activeDmThreadId) {
  const thread = dmThreadMap[threadId];
  if (!thread || !isDirectMessageGroupThread(thread)) return;
  activeDmGroupEditThreadId = threadId;
  dmGroupEditPhotoData = thread.groupPhoto || '';
  dmGroupEditAddSelectedUids = [];
  dmGroupEditRemovedUids = [];
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  dmGroupEditCropPointers.clear();
  dmGroupEditCropGesture = null;
  renderDirectMessagesView();
}

function closeDirectMessageGroupEdit() {
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  dmGroupEditAddSelectedUids = [];
  dmGroupEditRemovedUids = [];
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  dmGroupEditCropPointers.clear();
  dmGroupEditCropGesture = null;
  renderDirectMessagesView();
}

function triggerDirectMessageGroupEditPhotoInput() {
  document.getElementById('dm-group-edit-photo-input')?.click();
}

function clampDirectMessageCropValue(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function getDirectMessageCropDrawMetrics(img, size, crop = {}) {
  const naturalWidth = Math.max(1, img?.naturalWidth || img?.width || 1);
  const naturalHeight = Math.max(1, img?.naturalHeight || img?.height || 1);
  const zoom = clampDirectMessageCropValue(crop.zoom, 1, 3, 1);
  const x = clampDirectMessageCropValue(crop.x, -100, 100, 0);
  const y = clampDirectMessageCropValue(crop.y, -100, 100, 0);
  const baseScale = Math.max(size / naturalWidth, size / naturalHeight);
  const drawWidth = naturalWidth * baseScale * zoom;
  const drawHeight = naturalHeight * baseScale * zoom;
  const extraX = Math.max(0, (drawWidth - size) / 2);
  const extraY = Math.max(0, (drawHeight - size) / 2);
  return {
    dx: (size - drawWidth) / 2 + (x / 100) * extraX,
    dy: (size - drawHeight) / 2 + (y / 100) * extraY,
    drawWidth,
    drawHeight
  };
}

function primeDirectMessageGroupEditCropImage(sourceData = '') {
  if (!sourceData) return;
  if (dmGroupEditCropImage && dmGroupEditCropImageSrc === sourceData) {
    requestAnimationFrame(renderDirectMessageGroupEditCropCanvas);
    return;
  }
  const image = new Image();
  dmGroupEditCropImage = image;
  dmGroupEditCropImageSrc = sourceData;
  image.onload = () => requestAnimationFrame(renderDirectMessageGroupEditCropCanvas);
  image.onerror = () => showToast('Could not preview that photo');
  image.src = sourceData;
}

function renderDirectMessageGroupEditCropCanvas() {
  const canvas = document.getElementById('dm-group-edit-crop-canvas');
  const state = dmGroupEditCropState;
  const image = dmGroupEditCropImage;
  if (!canvas || !state || !image || !image.complete) return;
  const size = canvas.width || 260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  const metrics = getDirectMessageCropDrawMetrics(image, size, state);
  ctx.drawImage(image, metrics.dx, metrics.dy, metrics.drawWidth, metrics.drawHeight);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  [size / 3, (size * 2) / 3].forEach(pos => {
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  ctx.restore();
}

function updateDirectMessageGroupEditCrop(field, value) {
  if (!dmGroupEditCropState) return;
  if (field === 'zoom') dmGroupEditCropState.zoom = clampDirectMessageCropValue(value, 1, 3, 1);
  if (field === 'x') dmGroupEditCropState.x = clampDirectMessageCropValue(value, -100, 100, 0);
  if (field === 'y') dmGroupEditCropState.y = clampDirectMessageCropValue(value, -100, 100, 0);
  renderDirectMessageGroupEditCropCanvas();
}

function getDirectMessagePointerDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
}

function getDirectMessagePointerCenter(a, b) {
  return {
    x: ((a?.x || 0) + (b?.x || 0)) / 2,
    y: ((a?.y || 0) + (b?.y || 0)) / 2
  };
}

function beginDirectMessageGroupEditCropGesture() {
  const points = Array.from(dmGroupEditCropPointers.values());
  const state = dmGroupEditCropState;
  const image = dmGroupEditCropImage;
  const canvas = document.getElementById('dm-group-edit-crop-canvas');
  if (!points.length || !state || !image || !canvas) {
    dmGroupEditCropGesture = null;
    return;
  }
  const size = canvas.width || 260;
  const metrics = getDirectMessageCropDrawMetrics(image, size, state);
  const center = points.length > 1 ? getDirectMessagePointerCenter(points[0], points[1]) : points[0];
  dmGroupEditCropGesture = {
    startX: state.x || 0,
    startY: state.y || 0,
    startZoom: state.zoom || 1,
    startCenter: center,
    startDistance: points.length > 1 ? Math.max(1, getDirectMessagePointerDistance(points[0], points[1])) : 0,
    extraX: Math.max(1, (metrics.drawWidth - size) / 2),
    extraY: Math.max(1, (metrics.drawHeight - size) / 2)
  };
}

function moveDirectMessageGroupEditCropGesture() {
  const state = dmGroupEditCropState;
  const gesture = dmGroupEditCropGesture;
  if (!state || !gesture || !dmGroupEditCropPointers.size) return;
  const points = Array.from(dmGroupEditCropPointers.values());
  const center = points.length > 1 ? getDirectMessagePointerCenter(points[0], points[1]) : points[0];
  if (!center) return;
  if (points.length > 1 && gesture.startDistance) {
    const distance = Math.max(1, getDirectMessagePointerDistance(points[0], points[1]));
    state.zoom = clampDirectMessageCropValue(gesture.startZoom * (distance / gesture.startDistance), 1, 4, 1);
  }
  state.x = clampDirectMessageCropValue(gesture.startX + ((center.x - gesture.startCenter.x) / gesture.extraX) * 100, -100, 100, 0);
  state.y = clampDirectMessageCropValue(gesture.startY + ((center.y - gesture.startCenter.y) / gesture.extraY) * 100, -100, 100, 0);
  renderDirectMessageGroupEditCropCanvas();
}

window.startDirectMessageGroupEditCropPointer = function(event) {
  if (!dmGroupEditCropState) return;
  event.preventDefault();
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
  dmGroupEditCropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  beginDirectMessageGroupEditCropGesture();
};

window.moveDirectMessageGroupEditCropPointer = function(event) {
  if (!dmGroupEditCropPointers.has(event.pointerId)) return;
  event.preventDefault();
  dmGroupEditCropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  moveDirectMessageGroupEditCropGesture();
};

window.endDirectMessageGroupEditCropPointer = function(event) {
  dmGroupEditCropPointers.delete(event.pointerId);
  if (dmGroupEditCropPointers.size) beginDirectMessageGroupEditCropGesture();
  else dmGroupEditCropGesture = null;
};

function cropDirectMessageGroupEditPhoto(size = 520, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const state = dmGroupEditCropState;
    if (!state?.sourceData) {
      reject(new Error('Missing crop source'));
      return;
    }
    const finish = (image) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const metrics = getDirectMessageCropDrawMetrics(image, size, state);
        ctx.drawImage(image, metrics.dx, metrics.dy, metrics.drawWidth, metrics.drawHeight);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (error) {
        reject(error);
      }
    };
    if (dmGroupEditCropImage && dmGroupEditCropImageSrc === state.sourceData && dmGroupEditCropImage.complete) {
      finish(dmGroupEditCropImage);
      return;
    }
    const image = new Image();
    image.onload = () => finish(image);
    image.onerror = reject;
    image.src = state.sourceData;
  });
}

async function handleDirectMessageGroupEditPhoto(file) {
  if (!file) return;
  try {
    const sourceData = await resizeDirectMessageImageFile(file, 1400, 0.9);
    dmGroupEditCropState = { sourceData, zoom: 1, x: 0, y: 0 };
    primeDirectMessageGroupEditCropImage(sourceData);
    renderDirectMessagesView();
  } catch (error) {
    console.error('Group edit photo load failed:', error);
    showToast('Could not use that photo');
  }
}

async function applyDirectMessageGroupEditCrop() {
  if (!dmGroupEditCropState) return;
  try {
    dmGroupEditPhotoData = await cropDirectMessageGroupEditPhoto(520, 0.86);
    dmGroupEditCropState = null;
    dmGroupEditCropImage = null;
    dmGroupEditCropImageSrc = '';
    dmGroupEditCropPointers.clear();
    dmGroupEditCropGesture = null;
    renderDirectMessagesView();
  } catch (error) {
    console.error('Group edit crop failed:', error);
    showToast('Could not crop that photo');
  }
}

function cancelDirectMessageGroupEditCrop() {
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  dmGroupEditCropPointers.clear();
  dmGroupEditCropGesture = null;
  renderDirectMessagesView();
}

function canEditDirectMessageGroupMembers(thread = {}) {
  if (!currentUser?.uid || !thread) return false;
  const admins = Array.isArray(thread.adminUids) ? thread.adminUids : [];
  return thread.ownerUid === currentUser.uid || admins.includes(currentUser.uid);
}

/* v11.924: group-chat OWNER only (creator), not admins. Gates the People-section
   member removal on the group details page. */
function isDirectMessageGroupOwner(thread = {}) {
  if (!currentUser?.uid || !thread) return false;
  return thread.ownerUid === currentUser.uid;
}

function getDirectMessageGroupAddableProfiles(thread = {}) {
  const existing = new Set((Array.isArray(thread.participantUids) ? thread.participantUids : []).filter(uid => !dmGroupEditRemovedUids.includes(uid)));
  return (Array.isArray(friends) ? friends : [])
    .filter(uid => uid && uid !== currentUser?.uid && !existing.has(uid))
    .map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}))
    .filter(profile => profile.uid);
}

window.toggleDirectMessageGroupEditAddUser = function(uid = '') {
  const id = String(uid || '').trim();
  if (!id) return;
  if (dmGroupEditAddSelectedUids.includes(id)) {
    dmGroupEditAddSelectedUids = dmGroupEditAddSelectedUids.filter(value => value !== id);
  } else {
    dmGroupEditAddSelectedUids = [...dmGroupEditAddSelectedUids, id];
  }
  renderDirectMessagesView();
};

window.removeDirectMessageGroupEditMember = function(uid = '') {
  const id = String(uid || '').trim();
  const thread = dmThreadMap[activeDmGroupEditThreadId];
  if (!id || !thread || !canEditDirectMessageGroupMembers(thread)) return;
  if (id === currentUser?.uid) {
    showToast('You cannot remove yourself here');
    return;
  }
  const nextUids = (thread.participantUids || []).filter(value => value !== id && !dmGroupEditRemovedUids.includes(value));
  const futureUids = [...new Set([...nextUids, ...dmGroupEditAddSelectedUids].filter(Boolean))];
  if (futureUids.length < 2) {
    showToast('A group needs at least two members');
    return;
  }
  dmGroupEditRemovedUids = [...new Set([...dmGroupEditRemovedUids, id])];
  dmGroupEditAddSelectedUids = dmGroupEditAddSelectedUids.filter(value => value !== id);
  renderDirectMessagesView();
};

function getDirectMessageGroupEditDefaultName(thread = {}) {
  return (thread.participantUids || [])
    .filter(uid => uid && uid !== currentUser?.uid)
    .map(uid => getDisplayName(getDirectMessageProfile(uid, thread.participants?.[uid] || {}), 'User'))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ') || 'Group Chat';
}

function getDirectMessageSystemActorName() {
  const profile = getCurrentUserDirectMessageProfile();
  const username = String(
    userProfile?.username ||
    userProfile?.handle ||
    userProfile?.usernameHandle ||
    userProfile?.userHandle ||
    currentUser?.displayName ||
    profile.name ||
    'Someone'
  ).trim().replace(/^@+/, '');
  return username || 'Someone';
}

function buildDirectMessageGroupChangeMessages(thread = {}, nextName = '', nextPhoto = '') {
  const actor = getDirectMessageSystemActorName();
  const now = Date.now();
  const messages = [];
  const oldName = String(thread.groupName || getDirectMessageGroupEditDefaultName(thread) || '').trim();
  const cleanName = String(nextName || '').trim();
  if (cleanName && cleanName !== oldName) {
    messages.push({
      id: `sys-${now}-group-name-${Math.random().toString(36).slice(2, 8)}`,
      type: 'system',
      systemType: 'group_name_changed',
      text: `${actor} changed groupchat name`,
      fromUid: currentUser?.uid || '',
      createdAtMs: now
    });
  }
  const oldPhoto = String(thread.groupPhoto || '').trim();
  const cleanPhoto = String(nextPhoto || '').trim();
  if (cleanPhoto !== oldPhoto) {
    messages.push({
      id: `sys-${now}-group-photo-${Math.random().toString(36).slice(2, 8)}`,
      type: 'system',
      systemType: 'group_photo_changed',
      text: `${actor} changed groupchat photo`,
      fromUid: currentUser?.uid || '',
      createdAtMs: now + messages.length
    });
  }
  return messages;
}

function renderDirectMessageGroupDetailsActionIcon(kind = '') {
  if (kind === 'add') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 19a6 6 0 0 0-12 0"/><circle cx="9" cy="8" r="4"/><path d="M19 8v6"/><path d="M16 11h6"/></svg>';
  }
  if (kind === 'mute') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 21h4"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="19" cy="12" r="1.75"/></svg>';
}

function renderDirectMessageGroupDetailsRowIcon(kind = '') {
  if (kind === 'people') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  }
  return '<span class="dm-group-details-theme-dot" aria-hidden="true"></span>';
}

function renderDirectMessageGroupDetailsPage(thread = {}) {
  const title = getDirectMessageThreadTitle(thread);
  const photoProfile = { name: title, photo: thread.groupPhoto || '' };
  const threadId = escAttr(thread.id || '');
  const isOwner = isDirectMessageGroupOwner(thread);
  const peopleProfiles = (thread.participantUids || [])
    .filter(Boolean)
    .map(uid => getDirectMessageProfile(uid, thread.participants?.[uid] || usersMap[uid] || {}))
    .filter(profile => profile.uid);
  const peopleRows = peopleProfiles.map(profile => {
    const isSelf = profile.uid === currentUser?.uid;
    const showMenu = isOwner && !isSelf;
    return `<div class="dm-group-people-row">
      <img class="dm-group-people-avatar" src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
      <span class="dm-group-people-name">${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}${isSelf ? '<em>You</em>' : ''}</span>
      ${showMenu ? `<button class="dm-group-people-menu" type="button" aria-label="Member options" onclick="openDirectMessageGroupPeopleRemove('${threadId}','${escAttr(profile.uid)}')">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.85"/><circle cx="12" cy="12" r="1.85"/><circle cx="12" cy="19" r="1.85"/></svg>
      </button>` : ''}
    </div>`;
  }).join('');
  return `<div class="dm-group-details-page" role="dialog" aria-modal="true" aria-label="Edit group chat" data-dm-thread-id="${threadId}">
    <header class="dm-group-details-topbar">
      <button class="dm-group-details-back" type="button" onclick="closeDirectMessageGroupDetails()" aria-label="Back to group chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 19 8.5 12l7-7"/></svg>
      </button>
    </header>
    <main class="dm-group-details-body">
      <section class="dm-group-details-hero" aria-label="Group chat">
        <img class="dm-group-details-photo" src="${escAttr(getDirectMessageAvatar(photoProfile))}" alt="" loading="lazy">
        <h2>${escHtml(title)}</h2>
        <button class="dm-group-details-change" type="button" onclick="openDirectMessageGroupDetailsEditor('${threadId}')">Change Name and Image</button>
      </section>
      <section class="dm-group-details-actions" aria-label="Group chat actions">
        <button type="button" onclick="handleDirectMessageGroupDetailsAdd('${threadId}')">
          <span>${renderDirectMessageGroupDetailsActionIcon('add')}</span>
          <strong>Add</strong>
        </button>
        <button type="button" onclick="openDirectMessageGroupMuteSheet('${threadId}')">
          <span>${renderDirectMessageGroupDetailsActionIcon('mute')}</span>
          <strong>Mute</strong>
        </button>
        <button class="dm-group-details-options-button" type="button" onclick="toggleDirectMessageGroupOptionsPopover(event, '${threadId}')">
          <span>${renderDirectMessageGroupDetailsActionIcon('options')}</span>
          <strong>Options</strong>
        </button>
      </section>
      <section class="dm-group-details-rows" aria-label="Group chat settings">
        <button type="button" onclick="showToast('Theme coming soon')">
          <span class="dm-group-details-row-icon">${renderDirectMessageGroupDetailsRowIcon('theme')}</span>
          <span class="dm-group-details-row-copy"><strong>Theme</strong><em>Default</em></span>
          <svg class="dm-group-details-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </section>
      <section class="dm-group-people" aria-label="People in this group">
        <h3 class="dm-group-people-subheader">People</h3>
        <div class="dm-group-people-list">${peopleRows}</div>
      </section>
    </main>
    <div class="dm-group-details-options-popover" id="dm-group-details-options-popover" hidden>
      <button type="button" onclick="handleDirectMessageGroupDetailsLeave('${threadId}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        <span>Leave</span>
      </button>
      <button type="button" onclick="handleDirectMessageGroupDetailsReport('${threadId}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M12 7v5"/><path d="M12 15h.01"/></svg>
        <span>Report</span>
      </button>
    </div>
    <div class="dm-group-details-sheet-backdrop" id="dm-group-details-mute-backdrop" onclick="closeDirectMessageGroupMuteSheet()" hidden></div>
    <section class="dm-group-details-mute-sheet" id="dm-group-details-mute-sheet" role="dialog" aria-modal="true" aria-labelledby="dm-group-details-mute-title" hidden>
      <div class="dm-group-details-sheet-handle" aria-hidden="true"></div>
      <h3 id="dm-group-details-mute-title">Notifications</h3>
      <button type="button" onclick="handleDirectMessageGroupMuteMessages('${threadId}')">
        <span>Mute Messages</span>
        <em aria-hidden="true"></em>
      </button>
    </section>
    <div class="dm-group-details-sheet-backdrop" id="dm-group-people-remove-backdrop" onclick="closeDirectMessageGroupPeopleRemove()" hidden></div>
    <section class="dm-group-people-remove-sheet" id="dm-group-people-remove-sheet" role="dialog" aria-modal="true" aria-labelledby="dm-group-people-remove-title" hidden>
      <div class="dm-group-details-sheet-handle" aria-hidden="true"></div>
      <h3 id="dm-group-people-remove-title">Remove user</h3>
      <p id="dm-group-people-remove-copy"></p>
      <button class="dm-group-people-remove-confirm" type="button" onclick="confirmDirectMessageGroupPeopleRemove()">Remove user</button>
      <button class="dm-group-people-remove-cancel" type="button" onclick="closeDirectMessageGroupPeopleRemove()">Cancel</button>
    </section>
  </div>`;
}

function openDirectMessageGroupDetails(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  const thread = dmThreadMap[id];
  if (!thread || !isDirectMessageGroupThread(thread)) return;
  closeDirectMessageGroupDetails(true);
  const overlay = document.createElement('div');
  overlay.id = 'dm-group-details-overlay';
  overlay.className = 'dm-group-details-overlay';
  overlay.innerHTML = renderDirectMessageGroupDetailsPage(thread);
  document.body.appendChild(overlay);
  bindDirectMessageGroupDetailsSwipeBack(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function bindDirectMessageGroupDetailsSwipeBack(overlay = document.getElementById('dm-group-details-overlay')) {
  const page = overlay?.querySelector?.('.dm-group-details-page');
  if (!overlay || !page || page.dataset.dmGroupDetailsSwipeBound === 'true') return;
  page.dataset.dmGroupDetailsSwipeBound = 'true';
  const EDGE_WIDTH = 42;
  const START_THRESHOLD = 10;
  const DIRECTION_RATIO = 1.25;
  const CLOSE_RATIO = 0.34;
  const VELOCITY_CLOSE_PX_PER_MS = 0.72;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastT = 0;
  let velocityX = 0;
  let viewportW = 0;
  let armed = false;
  let dragging = false;
  let closing = false;
  let pointerId = null;
  let rafId = 0;
  let pendingX = 0;

  const clearFrame = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };
  const applyFrame = () => {
    rafId = 0;
    const x = Math.max(0, Math.min(pendingX, viewportW || window.innerWidth || 390));
    page.style.transform = `translate3d(${x}px, 0, 0)`;
  };
  const scheduleFrame = () => {
    if (!rafId) rafId = requestAnimationFrame(applyFrame);
  };
  const hasOpenChildSurface = () => (
    !!document.getElementById('dm-group-info-overlay') ||
    !!document.getElementById('dm-group-add-people-overlay') ||
    !!(document.getElementById('dm-group-details-mute-sheet') && !document.getElementById('dm-group-details-mute-sheet').hidden) ||
    !!(document.getElementById('dm-group-people-remove-sheet') && !document.getElementById('dm-group-people-remove-sheet').hidden) ||
    !!(document.getElementById('dm-group-details-options-popover') && !document.getElementById('dm-group-details-options-popover').hidden)
  );
  const reset = () => {
    clearFrame();
    armed = false;
    dragging = false;
    closing = false;
    pointerId = null;
    pendingX = 0;
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.touchAction = '';
    page.classList.remove('is-swiping-back', 'is-swipe-snapping');
  };
  const beginDrag = () => {
    if (dragging || closing) return;
    dragging = true;
    page.classList.add('is-swiping-back');
    page.style.transition = 'none';
    page.style.willChange = 'transform';
    page.style.touchAction = 'none';
  };
  const snapBack = () => {
    clearFrame();
    page.classList.add('is-swipe-snapping');
    page.style.transition = 'transform 220ms cubic-bezier(0.2, 1, 0.3, 1)';
    page.style.transform = 'translate3d(0, 0, 0)';
    setTimeout(reset, 240);
  };
  const finishClose = () => {
    if (closing) return;
    closing = true;
    clearFrame();
    page.classList.add('is-swipe-snapping');
    page.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
    page.style.transform = `translate3d(${Math.max(viewportW || 0, window.innerWidth || 390)}px, 0, 0)`;
    setTimeout(() => closeDirectMessageGroupDetails(true), 250);
  };
  const start = event => {
    const point = event.touches?.[0] || event;
    if (!point || closing || hasOpenChildSurface()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.touches && event.touches.length !== 1) return;
    if (point.clientX > EDGE_WIDTH) return;
    if (event.target?.closest?.('button, a, input, textarea, select, [contenteditable="true"], [role="button"]')) return;
    viewportW = window.innerWidth || 390;
    startX = point.clientX;
    startY = point.clientY;
    lastX = startX;
    lastT = performance.now();
    velocityX = 0;
    armed = true;
    dragging = false;
    pointerId = event.pointerId ?? null;
  };
  const move = event => {
    if (!armed) return;
    const point = event.touches?.[0] || event;
    if (!point) return;
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (!dragging) {
      if (dx < -4 || absDy > Math.max(16, absDx * DIRECTION_RATIO)) {
        reset();
        return;
      }
      if (dx < START_THRESHOLD || absDx < absDy * DIRECTION_RATIO) return;
      beginDrag();
    }
    if (!dragging) return;
    if (event.cancelable) event.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocityX = (point.clientX - lastX) / dt;
    lastX = point.clientX;
    lastT = now;
    pendingX = Math.max(0, dx);
    scheduleFrame();
  };
  const end = () => {
    if (!armed) return;
    if (!dragging) {
      reset();
      return;
    }
    const shouldClose = pendingX >= (viewportW || window.innerWidth || 390) * CLOSE_RATIO
      || (pendingX > 52 && velocityX > VELOCITY_CLOSE_PX_PER_MS);
    if (shouldClose) finishClose();
    else snapBack();
  };

  if (window.PointerEvent) {
    page.addEventListener('pointerdown', start, { passive: true });
    page.addEventListener('pointermove', move, { passive: false });
    page.addEventListener('pointerup', end, { passive: true });
    page.addEventListener('pointercancel', reset, { passive: true });
  } else {
    page.addEventListener('touchstart', start, { passive: true });
    page.addEventListener('touchmove', move, { passive: false });
    page.addEventListener('touchend', end, { passive: true });
    page.addEventListener('touchcancel', reset, { passive: true });
  }
}

function closeDirectMessageGroupDetails(immediate = false) {
  try { if (typeof closeDirectMessageGroupAddPeople === 'function') closeDirectMessageGroupAddPeople(true); } catch (_) {}
  try { if (typeof closeDirectMessageGroupInfoEdit === 'function') closeDirectMessageGroupInfoEdit(true); } catch (_) {}
  if (dmGroupDetailsOptionsOutsideHandler) {
    document.removeEventListener('click', dmGroupDetailsOptionsOutsideHandler, true);
    document.removeEventListener('touchstart', dmGroupDetailsOptionsOutsideHandler, true);
    dmGroupDetailsOptionsOutsideHandler = null;
  }
  const overlay = document.getElementById('dm-group-details-overlay');
  if (!overlay) return;
  if (immediate) {
    overlay.remove();
    return;
  }
  overlay.classList.add('is-closing');
  setTimeout(() => overlay.remove(), 260);
}

function openDirectMessageGroupDetailsEditor(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  openDirectMessageGroupInfoEdit(id);
}

function renderDirectMessageGroupInfoEditPage(thread = {}) {
  const title = getDirectMessageThreadTitle(thread);
  const description = String(thread.groupDescription || '').trim();
  const photoProfile = { name: title, photo: dmGroupInfoPhotoData || thread.groupPhoto || '' };
  const threadId = escAttr(thread.id || '');
  return `<div class="dm-group-info-page" role="dialog" aria-modal="true" aria-label="Edit group info" data-dm-thread-id="${threadId}">
    <header class="dm-group-info-topbar">
      <button class="dm-group-info-cancel" type="button" onclick="closeDirectMessageGroupInfoEdit()" aria-label="Cancel editing group info">Cancel</button>
      <h2>Edit group info</h2>
      <button class="dm-group-info-save" type="button" onclick="saveDirectMessageGroupInfoEdit('${threadId}')">Save</button>
    </header>
    <main class="dm-group-info-body">
      <section class="dm-group-info-photo-section" aria-label="Group photo">
        <img class="dm-group-info-photo" id="dm-group-info-photo-preview" src="${escAttr(getDirectMessageAvatar(photoProfile))}" alt="" loading="lazy">
        <button class="dm-group-info-change-photo" type="button" onclick="openDirectMessageGroupInfoPhotoSheet()">Change photo</button>
        <input id="dm-group-info-camera-input" type="file" accept="image/*" capture="environment" style="display:none" onchange="handleDirectMessageGroupInfoPhoto(this.files && this.files[0]); this.value='';">
        <input id="dm-group-info-photo-input" type="file" accept="image/*" style="display:none" onchange="handleDirectMessageGroupInfoPhoto(this.files && this.files[0]); this.value='';">
      </section>
      <section class="dm-group-info-form" aria-label="Group information">
        <label for="dm-group-info-name">Name</label>
        <input id="dm-group-info-name" type="text" maxlength="48" autocomplete="off" value="${escAttr(title)}">
        <label for="dm-group-info-description">Description</label>
        <textarea id="dm-group-info-description" maxlength="180" autocomplete="off" placeholder="Enter description">${escHtml(description)}</textarea>
      </section>
    </main>
    <div class="dm-group-info-photo-backdrop" id="dm-group-info-photo-backdrop" onclick="closeDirectMessageGroupInfoPhotoSheet()" hidden></div>
    <section class="dm-group-info-photo-sheet" id="dm-group-info-photo-sheet" role="dialog" aria-modal="true" aria-label="Change group photo" hidden>
      <div class="dm-group-info-sheet-handle" aria-hidden="true"></div>
      <button type="button" onclick="chooseDirectMessageGroupInfoPhotoSource('camera')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5l-2 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5l-2-2z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>Take Photo</span>
      </button>
      <button type="button" onclick="chooseDirectMessageGroupInfoPhotoSource('photos')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        <span>Choose From Photos</span>
      </button>
      <button class="dm-group-info-photo-sheet-cancel" type="button" onclick="closeDirectMessageGroupInfoPhotoSheet()">Cancel</button>
    </section>
  </div>`;
}

function openDirectMessageGroupInfoEdit(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  const thread = dmThreadMap[id];
  if (!thread || !isDirectMessageGroupThread(thread)) return;
  closeDirectMessageGroupInfoEdit(true);
  dmGroupInfoPhotoData = thread.groupPhoto || '';
  const overlay = document.createElement('div');
  overlay.id = 'dm-group-info-overlay';
  overlay.className = 'dm-group-info-overlay';
  overlay.innerHTML = renderDirectMessageGroupInfoEditPage(thread);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function closeDirectMessageGroupInfoEdit(immediate = false) {
  closeDirectMessageGroupInfoPhotoSheet(true);
  const overlay = document.getElementById('dm-group-info-overlay');
  if (!overlay) {
    dmGroupInfoPhotoData = '';
    return;
  }
  if (immediate) {
    overlay.remove();
    dmGroupInfoPhotoData = '';
    return;
  }
  overlay.classList.add('is-closing');
  setTimeout(() => {
    overlay.remove();
    dmGroupInfoPhotoData = '';
  }, 260);
}

function openDirectMessageGroupInfoPhotoSheet() {
  const sheet = document.getElementById('dm-group-info-photo-sheet');
  const backdrop = document.getElementById('dm-group-info-photo-backdrop');
  if (!sheet || !backdrop) return;
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  });
}

function closeDirectMessageGroupInfoPhotoSheet(immediate = false) {
  const sheet = document.getElementById('dm-group-info-photo-sheet');
  const backdrop = document.getElementById('dm-group-info-photo-backdrop');
  if (!sheet || !backdrop) return;
  if (immediate) {
    sheet.hidden = true;
    backdrop.hidden = true;
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    return;
  }
  sheet.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  setTimeout(() => {
    if (!sheet.classList.contains('is-open')) sheet.hidden = true;
    if (!backdrop.classList.contains('is-open')) backdrop.hidden = true;
  }, 220);
}

function chooseDirectMessageGroupInfoPhotoSource(source = '') {
  closeDirectMessageGroupInfoPhotoSheet();
  const inputId = source === 'camera' ? 'dm-group-info-camera-input' : 'dm-group-info-photo-input';
  setTimeout(() => document.getElementById(inputId)?.click(), 90);
}

async function handleDirectMessageGroupInfoPhoto(file) {
  if (!file) return;
  try {
    dmGroupInfoPhotoData = await resizeDirectMessageImageFile(file, 900, 0.88);
    const preview = document.getElementById('dm-group-info-photo-preview');
    if (preview) preview.src = dmGroupInfoPhotoData;
  } catch (error) {
    console.error('Group info photo load failed:', error);
    showToast('Could not use that photo');
  }
}

async function saveDirectMessageGroupInfoEdit(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  const thread = dmThreadMap[id];
  if (!currentUser || !thread || !isDirectMessageGroupThread(thread)) return;
  const nameInput = document.getElementById('dm-group-info-name');
  const descriptionInput = document.getElementById('dm-group-info-description');
  const cleanName = String(nameInput?.value || '').trim().slice(0, 48) || getDirectMessageGroupEditDefaultName(thread);
  const cleanDescription = String(descriptionInput?.value || '').trim().slice(0, 180);
  const systemMessages = buildDirectMessageGroupChangeMessages(thread, cleanName, dmGroupInfoPhotoData || '');
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    groupName: cleanName,
    groupPhoto: dmGroupInfoPhotoData || '',
    groupDescription: cleanDescription,
    messages: [...(Array.isArray(thread.messages) ? thread.messages : []), ...systemMessages],
    lastMessage: systemMessages.length ? systemMessages[systemMessages.length - 1].text : thread.lastMessage,
    lastMessageFromUid: systemMessages.length ? currentUser.uid : thread.lastMessageFromUid,
    lastMessageAtMs: systemMessages.length ? systemMessages[systemMessages.length - 1].createdAtMs : thread.lastMessageAtMs,
    updatedAtMs: Date.now()
  });
  dmThreadMap[id] = nextThread;
  closeDirectMessageGroupInfoEdit(true);
  const detailsOverlay = document.getElementById('dm-group-details-overlay');
  if (detailsOverlay) {
    detailsOverlay.innerHTML = renderDirectMessageGroupDetailsPage(nextThread);
    detailsOverlay.classList.add('is-open');
    bindDirectMessageGroupDetailsSwipeBack(detailsOverlay);
  }
  renderDirectMessagesView();
  try {
    await mirrorDirectMessageThreadToParticipants(nextThread);
    showToast('Group info updated');
  } catch (error) {
    console.error('saveDirectMessageGroupInfoEdit failed:', error);
    showToast('Could not update group info');
  }
}

window.openDirectMessageGroupInfoEdit = openDirectMessageGroupInfoEdit;
window.closeDirectMessageGroupInfoEdit = closeDirectMessageGroupInfoEdit;
window.openDirectMessageGroupInfoPhotoSheet = openDirectMessageGroupInfoPhotoSheet;
window.closeDirectMessageGroupInfoPhotoSheet = closeDirectMessageGroupInfoPhotoSheet;
window.chooseDirectMessageGroupInfoPhotoSource = chooseDirectMessageGroupInfoPhotoSource;
window.handleDirectMessageGroupInfoPhoto = handleDirectMessageGroupInfoPhoto;
window.saveDirectMessageGroupInfoEdit = saveDirectMessageGroupInfoEdit;

function renderDirectMessageGroupAddPeopleRows(thread = {}, query = '') {
  const search = String(query || '').trim().toLowerCase();
  const profiles = getDirectMessageGroupAddableProfiles(thread)
    .filter(profile => {
      if (!search) return true;
      const username = getDirectMessageUsernameLabel(profile.uid, profile).toLowerCase();
      const display = String(profile.name || profile.displayName || '').toLowerCase();
      return username.includes(search) || display.includes(search);
    });
  if (!profiles.length) {
    return `<div class="dm-group-add-people-empty">${search ? 'No suggested friends found.' : 'No friends available to add.'}</div>`;
  }
  return profiles.map(profile => {
    const username = getDirectMessageUsernameLabel(profile.uid, profile);
    const display = String(profile.name || profile.displayName || '').trim();
    const subtitle = display && display.toLowerCase() !== username.toLowerCase() ? `<span>${escHtml(display)}</span>` : '';
    return `<button class="dm-group-add-people-row" type="button" onclick="addDirectMessageGroupSuggestedPerson('${escAttr(thread.id)}', '${escAttr(profile.uid)}')">
      <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
      <span class="dm-group-add-people-copy">
        <strong>${escHtml(username)}</strong>
        ${subtitle}
      </span>
      <em>Add</em>
    </button>`;
  }).join('');
}

function renderDirectMessageGroupAddPeoplePage(thread = {}) {
  const threadId = escAttr(thread.id || '');
  return `<div class="dm-group-add-people-page" role="dialog" aria-modal="true" aria-label="Add people" data-dm-thread-id="${threadId}">
    <header class="dm-group-add-people-topbar">
      <button class="dm-group-add-people-back" type="button" data-dm-group-add-people-back aria-label="Back to group settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 19 8.5 12l7-7"/></svg>
      </button>
      <h2>Add people</h2>
    </header>
    <main class="dm-group-add-people-body">
      <label class="dm-group-add-people-search" for="dm-group-add-people-search-input">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="dm-group-add-people-search-input" type="search" autocomplete="off" placeholder="Search" oninput="filterDirectMessageGroupAddPeople(this.value)">
      </label>
      <section class="dm-group-add-people-section" aria-label="Suggested friends">
        <h3>Suggested</h3>
        <div class="dm-group-add-people-list" id="dm-group-add-people-list">${renderDirectMessageGroupAddPeopleRows(thread)}</div>
      </section>
    </main>
  </div>`;
}

function openDirectMessageGroupAddPeople(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  const thread = dmThreadMap[id];
  if (!thread || !isDirectMessageGroupThread(thread)) return;
  closeDirectMessageGroupAddPeople(true);
  const overlay = document.createElement('div');
  overlay.id = 'dm-group-add-people-overlay';
  overlay.className = 'dm-group-add-people-overlay';
  overlay.innerHTML = renderDirectMessageGroupAddPeoplePage(thread);
  document.body.appendChild(overlay);
  bindDirectMessageGroupAddPeopleControls(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function bindDirectMessageGroupAddPeopleControls(overlay = document.getElementById('dm-group-add-people-overlay')) {
  const backButton = overlay?.querySelector?.('[data-dm-group-add-people-back]');
  if (!overlay || !backButton || backButton.dataset.dmAddPeopleBackBound === 'true') return;
  backButton.dataset.dmAddPeopleBackBound = 'true';
  let closeStarted = false;
  const goBack = (event) => {
    if (event) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    }
    if (closeStarted) return;
    closeStarted = true;
    closeDirectMessageGroupAddPeople();
  };
  if (window.PointerEvent) {
    backButton.addEventListener('pointerup', goBack, { passive: false });
  } else {
    backButton.addEventListener('touchend', goBack, { passive: false });
  }
  backButton.addEventListener('click', goBack);
}

function closeDirectMessageGroupAddPeople(immediate = false) {
  const overlay = document.getElementById('dm-group-add-people-overlay');
  if (!overlay) return;
  if (immediate) {
    overlay.remove();
    return;
  }
  if (overlay.dataset.closing === 'true') return;
  overlay.dataset.closing = 'true';
  overlay.style.pointerEvents = 'none';
  overlay.classList.remove('is-open');
  overlay.classList.add('is-closing');
  setTimeout(() => overlay.remove(), 260);
}

function filterDirectMessageGroupAddPeople(query = '') {
  const overlay = document.getElementById('dm-group-add-people-overlay');
  const list = document.getElementById('dm-group-add-people-list');
  const id = String(overlay?.querySelector('.dm-group-add-people-page')?.dataset?.dmThreadId || '').trim();
  const thread = dmThreadMap[id];
  if (!list || !thread) return;
  list.innerHTML = renderDirectMessageGroupAddPeopleRows(thread, query);
}

async function addDirectMessageGroupSuggestedPerson(threadId = activeDmThreadId, uid = '') {
  const id = String(threadId || '').trim();
  const addUid = String(uid || '').trim();
  const thread = dmThreadMap[id];
  if (!currentUser || !thread || !isDirectMessageGroupThread(thread) || !addUid) return;
  if (!canEditDirectMessageGroupMembers(thread)) {
    showToast('Only group admins can add people');
    return;
  }
  if ((thread.participantUids || []).includes(addUid)) {
    showToast('Already in this group');
    return;
  }
  const participantUids = [...new Set([...(thread.participantUids || []), addUid].filter(Boolean))];
  const participants = { ...(thread.participants || {}) };
  if (!participants[currentUser.uid]) participants[currentUser.uid] = getCurrentUserDirectMessageProfile();
  participantUids.forEach(participantUid => {
    participants[participantUid] = getDirectMessageProfile(participantUid, participants[participantUid] || usersMap[participantUid] || {});
  });
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    participantUids,
    participants,
    unreadUids: [...new Set([...(thread.unreadUids || []), addUid].filter(value => value && value !== currentUser.uid))],
    updatedAtMs: Date.now()
  });
  dmThreadMap[id] = nextThread;
  renderDirectMessagesView();
  const detailsOverlay = document.getElementById('dm-group-details-overlay');
  if (detailsOverlay) {
    detailsOverlay.innerHTML = renderDirectMessageGroupDetailsPage(nextThread);
    detailsOverlay.classList.add('is-open');
    bindDirectMessageGroupDetailsSwipeBack(detailsOverlay);
  }
  const searchValue = document.getElementById('dm-group-add-people-search-input')?.value || '';
  const list = document.getElementById('dm-group-add-people-list');
  if (list) list.innerHTML = renderDirectMessageGroupAddPeopleRows(nextThread, searchValue);
  try {
    await mirrorDirectMessageThreadToParticipants(nextThread);
    const addedProfile = getDirectMessageProfile(addUid, usersMap[addUid] || {});
    showToast(`Added ${getDirectMessageUsernameLabel(addUid, addedProfile)}`);
  } catch (error) {
    console.error('addDirectMessageGroupSuggestedPerson failed:', error);
    showToast('Could not add person');
  }
}

function handleDirectMessageGroupDetailsAdd(threadId = activeDmThreadId) {
  openDirectMessageGroupAddPeople(threadId);
}

function openDirectMessageGroupMuteSheet() {
  const sheet = document.getElementById('dm-group-details-mute-sheet');
  const backdrop = document.getElementById('dm-group-details-mute-backdrop');
  if (!sheet || !backdrop) return;
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  });
}

function closeDirectMessageGroupMuteSheet() {
  const sheet = document.getElementById('dm-group-details-mute-sheet');
  const backdrop = document.getElementById('dm-group-details-mute-backdrop');
  if (!sheet || !backdrop) return;
  sheet.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  setTimeout(() => {
    if (!sheet.classList.contains('is-open')) sheet.hidden = true;
    if (!backdrop.classList.contains('is-open')) backdrop.hidden = true;
  }, 220);
}

function handleDirectMessageGroupMuteMessages() {
  showToast('Mute messages coming soon');
  closeDirectMessageGroupMuteSheet();
}

function closeDirectMessageGroupOptionsPopover() {
  const popover = document.getElementById('dm-group-details-options-popover');
  if (popover) popover.hidden = true;
  if (dmGroupDetailsOptionsOutsideHandler) {
    document.removeEventListener('click', dmGroupDetailsOptionsOutsideHandler, true);
    document.removeEventListener('touchstart', dmGroupDetailsOptionsOutsideHandler, true);
    dmGroupDetailsOptionsOutsideHandler = null;
  }
}

function toggleDirectMessageGroupOptionsPopover(event, threadId = activeDmThreadId) {
  event?.stopPropagation?.();
  const popover = document.getElementById('dm-group-details-options-popover');
  if (!popover) return;
  if (!popover.hidden) {
    closeDirectMessageGroupOptionsPopover();
    return;
  }
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  if (rect) {
    const width = 174;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const top = Math.min(window.innerHeight - 132, rect.bottom + 10);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }
  popover.dataset.dmThreadId = String(threadId || '');
  popover.hidden = false;
  dmGroupDetailsOptionsOutsideHandler = (tapEvent) => {
    if (tapEvent.target?.closest?.('.dm-group-details-options-popover, .dm-group-details-options-button')) return;
    closeDirectMessageGroupOptionsPopover();
  };
  setTimeout(() => {
    document.addEventListener('click', dmGroupDetailsOptionsOutsideHandler, true);
    document.addEventListener('touchstart', dmGroupDetailsOptionsOutsideHandler, true);
  }, 0);
}

function handleDirectMessageGroupDetailsLeave() {
  closeDirectMessageGroupOptionsPopover();
  showToast('Leave group coming soon');
}

function handleDirectMessageGroupDetailsReport(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  closeDirectMessageGroupOptionsPopover();
  if (typeof window.openReportSheet === 'function') {
    window.openReportSheet('dm_group', '', id, 'this group chat');
  } else {
    showToast('Report coming soon');
  }
}

/* v11.924: People-section member removal (group details page). Owner-only.
   Tapping a member's 3-dot opens the "Remove user" sheet; confirm removes the
   member immediately and mirrors the updated thread to the remaining members
   (mirrors the addDirectMessageGroupSuggestedPerson flow). */
function openDirectMessageGroupPeopleRemove(threadId = activeDmThreadId, uid = '') {
  const thread = dmThreadMap[String(threadId || '').trim()];
  const removeUid = String(uid || '').trim();
  if (!thread || !isDirectMessageGroupOwner(thread) || !removeUid || removeUid === currentUser?.uid) return;
  const sheet = document.getElementById('dm-group-people-remove-sheet');
  const backdrop = document.getElementById('dm-group-people-remove-backdrop');
  if (!sheet || !backdrop) return;
  const profile = getDirectMessageProfile(removeUid, thread.participants?.[removeUid] || usersMap[removeUid] || {});
  const label = getDirectMessageUsernameLabel(removeUid, profile);
  sheet.dataset.threadId = String(threadId || '');
  sheet.dataset.uid = removeUid;
  const copy = document.getElementById('dm-group-people-remove-copy');
  if (copy) copy.textContent = `Remove ${label} from this group? They will lose access to the conversation.`;
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  });
}

function closeDirectMessageGroupPeopleRemove() {
  const sheet = document.getElementById('dm-group-people-remove-sheet');
  const backdrop = document.getElementById('dm-group-people-remove-backdrop');
  if (!sheet || !backdrop) return;
  sheet.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  setTimeout(() => {
    if (!sheet.classList.contains('is-open')) sheet.hidden = true;
    if (!backdrop.classList.contains('is-open')) backdrop.hidden = true;
  }, 220);
}

async function confirmDirectMessageGroupPeopleRemove() {
  const sheet = document.getElementById('dm-group-people-remove-sheet');
  const threadId = sheet?.dataset.threadId || '';
  const removeUid = sheet?.dataset.uid || '';
  closeDirectMessageGroupPeopleRemove();
  await removeDirectMessageGroupMemberNow(threadId, removeUid);
}

async function removeDirectMessageGroupMemberNow(threadId = activeDmThreadId, uid = '') {
  const id = String(threadId || '').trim();
  const removeUid = String(uid || '').trim();
  const thread = dmThreadMap[id];
  if (!currentUser || !thread || !isDirectMessageGroupThread(thread) || !removeUid) return;
  if (!isDirectMessageGroupOwner(thread)) {
    showToast('Only the group owner can remove people');
    return;
  }
  if (removeUid === currentUser.uid) {
    showToast('You cannot remove yourself here');
    return;
  }
  if (!(thread.participantUids || []).includes(removeUid)) return;
  const participantUids = (thread.participantUids || []).filter(value => value && value !== removeUid);
  if (participantUids.length < 2) {
    showToast('A group needs at least two members');
    return;
  }
  const removedProfile = getDirectMessageProfile(removeUid, thread.participants?.[removeUid] || usersMap[removeUid] || {});
  const participants = { ...(thread.participants || {}) };
  delete participants[removeUid];
  participantUids.forEach(participantUid => {
    participants[participantUid] = getDirectMessageProfile(participantUid, participants[participantUid] || usersMap[participantUid] || {});
  });
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    participantUids,
    participants,
    adminUids: (thread.adminUids || []).filter(value => participantUids.includes(value)),
    unreadUids: (thread.unreadUids || []).filter(value => value !== removeUid),
    updatedAtMs: Date.now()
  });
  dmThreadMap[id] = nextThread;
  renderDirectMessagesView();
  const detailsOverlay = document.getElementById('dm-group-details-overlay');
  if (detailsOverlay) {
    detailsOverlay.innerHTML = renderDirectMessageGroupDetailsPage(nextThread);
    detailsOverlay.classList.add('is-open');
    bindDirectMessageGroupDetailsSwipeBack(detailsOverlay);
  }
  try {
    await mirrorDirectMessageThreadToParticipants(nextThread);
    showToast(`Removed ${getDirectMessageUsernameLabel(removeUid, removedProfile)}`);
  } catch (error) {
    console.error('removeDirectMessageGroupMemberNow failed:', error);
    showToast('Could not remove person');
  }
}

window.openDirectMessageGroupDetails = openDirectMessageGroupDetails;
window.closeDirectMessageGroupDetails = closeDirectMessageGroupDetails;
window.openDirectMessageGroupDetailsEditor = openDirectMessageGroupDetailsEditor;
window.openDirectMessageGroupAddPeople = openDirectMessageGroupAddPeople;
window.closeDirectMessageGroupAddPeople = closeDirectMessageGroupAddPeople;
window.filterDirectMessageGroupAddPeople = filterDirectMessageGroupAddPeople;
window.addDirectMessageGroupSuggestedPerson = addDirectMessageGroupSuggestedPerson;
window.openDirectMessageGroupMuteSheet = openDirectMessageGroupMuteSheet;
window.closeDirectMessageGroupMuteSheet = closeDirectMessageGroupMuteSheet;
window.toggleDirectMessageGroupOptionsPopover = toggleDirectMessageGroupOptionsPopover;
window.handleDirectMessageGroupDetailsAdd = handleDirectMessageGroupDetailsAdd;
window.handleDirectMessageGroupMuteMessages = handleDirectMessageGroupMuteMessages;
window.handleDirectMessageGroupDetailsLeave = handleDirectMessageGroupDetailsLeave;
window.handleDirectMessageGroupDetailsReport = handleDirectMessageGroupDetailsReport;
window.openDirectMessageGroupPeopleRemove = openDirectMessageGroupPeopleRemove;
window.closeDirectMessageGroupPeopleRemove = closeDirectMessageGroupPeopleRemove;
window.confirmDirectMessageGroupPeopleRemove = confirmDirectMessageGroupPeopleRemove;

async function saveDirectMessageGroupEdit(threadId = activeDmGroupEditThreadId) {
  if (dmGroupEditCropState) await applyDirectMessageGroupEditCrop();
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !isDirectMessageGroupThread(thread)) return;
  const nameInput = document.getElementById('dm-group-edit-name');
  const cleanName = String(nameInput?.value || '').trim().slice(0, 48) || getDirectMessageGroupEditDefaultName(thread);
  const canManageMembers = canEditDirectMessageGroupMembers(thread);
  const removed = canManageMembers ? new Set(dmGroupEditRemovedUids) : new Set();
  const participantUids = [...new Set([
    ...(thread.participantUids || []).filter(uid => !removed.has(uid)),
    ...(canManageMembers ? dmGroupEditAddSelectedUids : [])
  ].filter(Boolean))];
  const systemMessages = buildDirectMessageGroupChangeMessages(thread, cleanName, dmGroupEditPhotoData || '');
  const participants = { ...(thread.participants || {}) };
  if (!participants[currentUser.uid]) participants[currentUser.uid] = getCurrentUserDirectMessageProfile();
  participantUids.forEach(uid => {
    participants[uid] = getDirectMessageProfile(uid, participants[uid] || usersMap[uid] || {});
  });
  Object.keys(participants).forEach(uid => {
    if (!participantUids.includes(uid)) delete participants[uid];
  });
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    groupName: cleanName,
    groupPhoto: dmGroupEditPhotoData || '',
    participantUids,
    participants,
    adminUids: (thread.adminUids || []).filter(uid => participantUids.includes(uid)),
    messages: [...(Array.isArray(thread.messages) ? thread.messages : []), ...systemMessages],
    lastMessage: systemMessages.length ? systemMessages[systemMessages.length - 1].text : thread.lastMessage,
    lastMessageFromUid: systemMessages.length ? currentUser.uid : thread.lastMessageFromUid,
    lastMessageAtMs: systemMessages.length ? systemMessages[systemMessages.length - 1].createdAtMs : thread.lastMessageAtMs,
    unreadUids: [...new Set([...(thread.unreadUids || []), ...(canManageMembers ? dmGroupEditAddSelectedUids : [])].filter(uid => uid && uid !== currentUser.uid))],
    updatedAtMs: Date.now()
  });
  dmThreadMap[threadId] = nextThread;
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  dmGroupEditAddSelectedUids = [];
  dmGroupEditRemovedUids = [];
  dmGroupEditCropState = null;
  dmGroupEditCropImage = null;
  dmGroupEditCropImageSrc = '';
  renderDirectMessagesView();
  try {
    await mirrorDirectMessageThreadToParticipants(nextThread);
    showToast('Group updated');
  } catch (error) {
    console.error('saveDirectMessageGroupEdit failed:', error);
    showToast('Could not update group');
  }
}

function renderDirectMessageGroupEditPage(threadId = activeDmGroupEditThreadId) {
  const thread = dmThreadMap[threadId];
  if (!thread || !isDirectMessageGroupThread(thread)) {
    activeDmGroupEditThreadId = '';
    return renderDirectMessageChats();
  }
  const currentName = thread.groupName || getDirectMessageGroupEditDefaultName(thread);
  const photoProfile = { name: currentName, photo: dmGroupEditPhotoData || thread.groupPhoto || '' };
  const canManageMembers = canEditDirectMessageGroupMembers(thread);
  const removed = new Set(dmGroupEditRemovedUids);
  const members = (thread.participantUids || [])
    .filter(uid => uid && !removed.has(uid))
    .map(uid => getDirectMessageProfile(uid, thread.participants?.[uid] || {}))
    .filter(profile => profile.uid);
  const addableProfiles = canManageMembers ? getDirectMessageGroupAddableProfiles(thread) : [];
  const pendingAddProfiles = dmGroupEditAddSelectedUids
    .map(uid => getDirectMessageProfile(uid, usersMap[uid] || {}))
    .filter(profile => profile.uid);
  const cropUi = dmGroupEditCropState?.sourceData ? `<div class="dm-group-edit-crop-panel">
      <div class="dm-group-edit-crop-stage">
        <canvas id="dm-group-edit-crop-canvas" width="300" height="300" aria-label="Crop group photo preview" onpointerdown="startDirectMessageGroupEditCropPointer(event)" onpointermove="moveDirectMessageGroupEditCropPointer(event)" onpointerup="endDirectMessageGroupEditCropPointer(event)" onpointercancel="endDirectMessageGroupEditCropPointer(event)" onpointerleave="endDirectMessageGroupEditCropPointer(event)"></canvas>
      </div>
      <div class="dm-group-edit-crop-actions">
        <button type="button" onclick="cancelDirectMessageGroupEditCrop()">Cancel</button>
        <button type="button" onclick="applyDirectMessageGroupEditCrop()">Use photo</button>
      </div>
    </div>` : '';
  return `<div class="dm-group-edit-page">
    <header class="dm-group-edit-topbar">
      <button class="dm-group-edit-back" type="button" onclick="closeDirectMessageGroupEdit()" aria-label="Back to group chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
      </button>
      <span class="dm-group-edit-title">Edit Group</span>
      <button class="dm-group-edit-save" type="button" onclick="saveDirectMessageGroupEdit('${escAttr(thread.id)}')">Save</button>
    </header>
    <div class="dm-group-edit-body">
      <div class="dm-group-edit-hero">
        <button class="dm-group-edit-photo" type="button" onclick="triggerDirectMessageGroupEditPhotoInput()" aria-label="Change group photo">
          <img src="${escAttr(getDirectMessageAvatar(photoProfile))}" alt="" loading="lazy">
          <span>Change</span>
        </button>
        <input id="dm-group-edit-photo-input" type="file" accept="image/*" style="display:none" onchange="handleDirectMessageGroupEditPhoto(this.files && this.files[0]); this.value='';">
        ${cropUi}
        <div class="dm-group-edit-name-wrap">
          <label for="dm-group-edit-name">Group name</label>
          <input id="dm-group-edit-name" type="text" maxlength="48" autocomplete="off" value="${escAttr(currentName)}" placeholder="Group name">
        </div>
      </div>
      ${canManageMembers ? `<section class="dm-group-edit-add">
        <div class="dm-group-edit-section-title">Add Members <span>${dmGroupEditAddSelectedUids.length}</span></div>
        ${pendingAddProfiles.length ? `<div class="dm-group-edit-pending-adds">${pendingAddProfiles.map(profile => `<button type="button" onclick="toggleDirectMessageGroupEditAddUser('${escAttr(profile.uid)}')"><img src="${escAttr(getDirectMessageAvatar(profile))}" alt=""><span>${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}</span></button>`).join('')}</div>` : ''}
        <div class="dm-group-edit-add-list">
          ${addableProfiles.length ? addableProfiles.map(profile => {
            const selected = dmGroupEditAddSelectedUids.includes(profile.uid);
            return `<button class="dm-group-edit-add-row ${selected ? 'is-selected' : ''}" type="button" onclick="toggleDirectMessageGroupEditAddUser('${escAttr(profile.uid)}')">
              <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
              <span>${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}</span>
              <em>${selected ? 'Added' : 'Add'}</em>
            </button>`;
          }).join('') : '<div class="dm-group-edit-empty">No friends available to add.</div>'}
        </div>
      </section>` : ''}
      <section class="dm-group-edit-members">
        <div class="dm-group-edit-section-title">Members <span>${members.length}</span></div>
        ${members.map(profile => `<div class="dm-group-edit-member">
          <img src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
          <span>${escHtml(getDirectMessageUsernameLabel(profile.uid, profile))}</span>
          ${profile.uid === currentUser?.uid ? '<em>You</em>' : ''}
          ${canManageMembers && profile.uid !== currentUser?.uid ? `<button type="button" onclick="removeDirectMessageGroupEditMember('${escAttr(profile.uid)}')">Remove</button>` : ''}
        </div>`).join('')}
      </section>
    </div>
  </div>`;
}
/* v10.467: Instagram-style DM rebuild.
   - Header: back chevron + avatar + name/handle + 3-dot overflow menu
   - Messages: date dividers between conversational sessions, per-sender
     bubble grouping (avatar only on first incoming in a run), mine
     bubbles in Shelfd lavender, theirs in dark gray, emoji-only renders
     without bubble background, "Seen" indicator under last sent bubble
   - Composer: round purple camera button + pill input + mic + gallery
     icons inside the pill (no separate Send button — Enter or tap-send)
   Critical DOM hooks retained for legacy JS (keyboard lift, photo
   upload, scroll, focus): `.dm-compose-row`, `#dm-message-input`,
   `#dm-message-list`, `#dm-photo-input-{threadId}`. */
/* v11.781: the chat message-list INNER HTML (bubbles + date dividers + per-sender
   grouping + the inline "Read {time}" receipt, or the v11.776 loading-vs-empty
   gate). Pulled out of renderDirectMessageThread so a hydrate/snapshot re-render of
   an ALREADY-OPEN thread can swap ONLY #dm-message-list.innerHTML in place, leaving
   the sliding .dm-v2-panel element untouched. Self-contained (recomputes its own
   read-state) so the patched list and a full panel rebuild are byte-identical. */
function buildDirectMessageListHTML(thread, threadId = activeDmThreadId) {
  if (!thread) return '';
  const isGroup = isDirectMessageGroupThread(thread);
  const otherUid = isGroup ? '' : getDirectMessageOtherUid(thread);
  const myUid = currentUser?.uid || '';
  /* v11.882: render only the latest WINDOW of messages (dmThreadWindowStart..end). The window
     only grows as the user scrolls up, so the latest message is always included (bottom-lock /
     open-anchor still land on it). winStart is added to each row as data-dm-i (absolute message
     index) so the pagination grow can preserve the reading position. */
  const allMessages = Array.isArray(thread.messages) ? thread.messages : [];
  const winStart = (typeof dmThreadWindowStart === 'number' && dmThreadWindowStart > 0 && dmThreadWindowStart < allMessages.length) ? dmThreadWindowStart : 0;
  const messages = winStart > 0 ? allMessages.slice(winStart) : allMessages;
  /* Identify whether the LAST mine message has been seen by the recipient.
     1:1: the other party has read everything if they're no longer in unreadUids.
     Groups skip the indicator (multi-reader semantics need their own treatment). */
  const otherReadAll = !isGroup && otherUid && !(Array.isArray(thread.unreadUids) ? thread.unreadUids : []).includes(otherUid);
  let lastMineIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].fromUid === myUid) { lastMineIndex = i; break; }
  }
  /* v10.900: the time the recipient actually marked the thread read. Fall back to
     thread.updatedAtMs for legacy threads without the per-uid map. */
  const otherReadAtMs = (otherReadAll && otherUid)
    ? Number((thread.readAtMsByUid || {})[otherUid] || thread.updatedAtMs || 0)
    : 0;
  function formatDmReadReceiptTime(ms) {
    const n = Number(ms || 0);
    if (!n) return '';
    const d = new Date(n);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m}${ampm}`;
  }
  const DM_DIVIDER_GAP_MS = 30 * 60 * 1000;
  const DM_GROUPING_GAP_MS = 5 * 60 * 1000;
  return messages.length ? messages.map((message, idx) => {
    const ts = Number(message.createdAtMs || 0);
    const prev = idx > 0 ? messages[idx - 1] : null;
    const prevTs = prev ? Number(prev.createdAtMs || 0) : 0;
    const showDivider = !prev || (ts - prevTs > DM_DIVIDER_GAP_MS);
    const dividerHtml = showDivider
      ? `<div class="dm-v2-day-divider">${escHtml(formatDmV2DayDivider(ts))}</div>`
      : '';
    if (message.type === 'system' || message.systemType) {
      const systemText = String(message.text || '').trim();
      return `${dividerHtml}${systemText ? `<div class="dm-v2-system-message">${escHtml(systemText)}</div>` : ''}`;
    }
    const mine = message.fromUid === myUid;
    const sameSenderAsPrev = prev && prev.fromUid === message.fromUid && (ts - prevTs <= DM_GROUPING_GAP_MS);
    const showAvatar = !mine && (!sameSenderAsPrev || showDivider);
    const senderProfile = !mine
      ? getDirectMessageProfile(message.fromUid || '', thread.participants?.[message.fromUid] || {})
      : null;
    const senderAvatar = senderProfile ? getDirectMessageAvatar(senderProfile) : '';
    const payload = getDirectMessagePlainPayload(message);
    const isEmojiOnly = isDmV2EmojiOnly(payload.text) && !payload.imageData && !payload.shareMedia;
    const mediaHtml = getDirectMessageMediaHtml(payload);
    const textHtml = getDirectMessageTextHtml(payload);
    const hasMedia = !!mediaHtml;
    const hasText = !!textHtml;
    const senderNameHtml = (isGroup && !mine && (!sameSenderAsPrev || showDivider) && senderProfile)
      ? `<span class="dm-v2-sender-name">${renderDisplayNameHTML(senderProfile, 'User', '', { suppressCreativeTeamTag: true })}</span>`
      : '';
    const readTimeLabel = formatDmReadReceiptTime(otherReadAtMs);
    const seenHtml = (mine && idx === lastMineIndex && otherReadAll && !isGroup)
      ? `<div class="dm-v2-seen">Read${readTimeLabel ? ' ' + escHtml(readTimeLabel) : ''}</div>`
      : '';
    const bubbleClass = `dm-v2-bubble${isEmojiOnly ? ' dm-v2-bubble-emoji' : ''}${sameSenderAsPrev && !showDivider ? ' dm-v2-bubble-grouped' : ''}`;
    const rowClass = `dm-v2-bubble-row ${mine ? 'mine' : 'theirs'}${sameSenderAsPrev && !showDivider ? ' grouped' : ''}`;
    const avatarHtml = showAvatar
      ? `<img class="dm-v2-bubble-avatar" src="${escAttr(senderAvatar)}" alt="" loading="lazy">`
      : (!mine ? '<span class="dm-v2-bubble-avatar dm-v2-bubble-avatar-spacer" aria-hidden="true"></span>' : '');
    let stackInner = senderNameHtml;
    if (hasMedia && hasText) {
      stackInner += `<div class="dm-v2-media-standalone">${mediaHtml}</div><div class="${bubbleClass}">${textHtml}</div>`;
    } else if (hasMedia) {
      stackInner += `<div class="dm-v2-media-standalone">${mediaHtml}</div>`;
    } else {
      stackInner += `<div class="${bubbleClass}">${textHtml}</div>`;
    }
    return `${dividerHtml}<div class="${rowClass}" data-dm-i="${winStart + idx}">${avatarHtml}<div class="dm-v2-bubble-stack">${stackInner}</div></div>${seenHtml}`;
  }).join('') : (dmHydratedThreadIds.has(threadId)
    /* genuinely empty (server-confirmed) → the real empty state */
    ? `<div class="dm-v2-empty">Chat accepted. Send the first message.</div>`
    /* messages not hydrated yet (e.g. opened from a notification before the
       dmThreads doc loaded) → show loading, NOT the empty state. v11.776 */
    : `<div class="dm-v2-loading"><span class="dm-v2-spinner" aria-hidden="true"></span></div>`);
}

function renderDirectMessageThread(threadId = activeDmThreadId) {
  const thread = dmThreadMap[threadId];
  if (!thread) {
    activeDmThreadId = '';
    clearDirectMessageActiveThreadState('thread-missing');
    return renderDirectMessageChats();
  }
  const profile = getDirectMessageThreadProfile(thread);
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const isGroup = isDirectMessageGroupThread(thread);
  const title = getDirectMessageThreadTitle(thread);
  const subtitle = getDirectMessageThreadSubtitle(thread);
  const otherUid = isGroup ? '' : getDirectMessageOtherUid(thread);
  const myUid = currentUser?.uid || '';

  /* v11.781: the message-list BODY is built by buildDirectMessageListHTML so a
     hydrate/snapshot re-render of an already-open thread can patch ONLY
     #dm-message-list in place — never rebuilding the sliding .dm-v2-panel (the
     double-animation root cause). renderDirectMessagesView's patch branch reuses
     the very same builder, so the patched and full-rebuilt list are identical. */
  const messageHtml = buildDirectMessageListHTML(thread, threadId);

  /* Identity button — tapping the avatar/name area opens the profile
     (1:1) or the group-edit page (group). The 3-dot overflow opens a
     small action menu anchored to the button. */
  const identityClick = isGroup
    ? `openDirectMessageGroupDetails('${escAttr(thread.id)}')`
    : (otherUid ? `openDirectMessageHeaderProfile('${escAttr(otherUid)}')` : '');
  const otherBlocked = !!(otherUid && (
    (typeof window.isShelfdUserBlocked === 'function' && window.isShelfdUserBlocked(otherUid)) ||
    (window.shelfdBlockedUids && window.shelfdBlockedUids.has(String(otherUid)))
  ));
  const blockActionLabel = otherBlocked ? 'Unblock user' : 'Block';
  const blockActionClass = otherBlocked ? '' : 'dm-overflow-report';
  const overflowMenuItems = isGroup
    ? `<button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); openDirectMessageGroupDetails('${escAttr(thread.id)}')">Edit group chat</button>
       <button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); markDirectMessageThreadRead('${escAttr(thread.id)}')">Mark as read</button>`
    : `<button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); ${otherUid ? `openUserProfile('${escAttr(otherUid)}')` : 'showToast(\'No profile available\')'}">View profile</button>
       <button type="button" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); markDirectMessageThreadRead('${escAttr(thread.id)}')">Mark as read</button>
       ${otherUid ? `<button type="button" class="dm-overflow-report" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); if(typeof window.openReportSheet==='function') window.openReportSheet('dm_user','${escAttr(otherUid)}','${escAttr(thread.id)}','this user')">Report</button>` : ''}
       ${otherUid ? `<button type="button" class="${blockActionClass}" onclick="closeDmV2OverflowMenu('${escAttr(thread.id)}'); if(typeof window.openBlockUserModal==='function') window.openBlockUserModal('${escAttr(otherUid)}','${escAttr(title)}')">${blockActionLabel}</button>` : ''}`;

  /* v11.878: PURE panel HTML. The slide is driven entirely by the stage engine
     (mountDmThread → slideDmThreadIn); the panel carries no entering class / inline
     transform of its own, so a data re-render that swaps the message list can never
     touch the slide. */
  return `<div class="dm-v2-panel" data-dm-thread-id="${escAttr(thread.id)}">
    <div class="dm-v2-header">
      <button class="dm-v2-back" type="button" onclick="closeDirectMessageThread()" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="dm-v2-identity" type="button" ${identityClick ? `onclick="${identityClick}"` : ''}>
        <img class="dm-v2-identity-avatar" src="${escAttr(getDirectMessageAvatar(profile))}" alt="" loading="lazy">
        <span class="dm-v2-identity-text">
          <span class="dm-v2-identity-name">${renderDirectMessageHeaderNameHTML(thread)}</span>
          <span class="dm-v2-identity-handle">${escHtml(subtitle)}</span>
        </span>
      </button>
      <div class="dm-v2-overflow-wrap">
        <button class="dm-v2-overflow" type="button" onclick="toggleDmV2OverflowMenu('${escAttr(thread.id)}')" aria-label="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
        <div class="dm-v2-overflow-menu" id="dm-v2-overflow-menu-${escAttr(thread.id)}" hidden>
          ${overflowMenuItems}
        </div>
      </div>
    </div>
    <div class="dm-v2-list" id="dm-message-list">
      ${messageHtml}
    </div>
    <div class="dm-v2-compose">
      <!-- v10.744: hidden file inputs — photo library, camera capture, any file -->
      <input id="dm-photo-input-${escAttr(thread.id)}" type="file" accept="image/*" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <input id="dm-camera-input-${escAttr(thread.id)}" type="file" accept="image/*" capture="environment" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <input id="dm-file-input-${escAttr(thread.id)}" type="file" accept="*/*" style="display:none" onchange="handleDirectMessagePhotoUpload('${escAttr(thread.id)}', this.files && this.files[0])">
      <!-- + button with attachment menu -->
      <div class="dm-v2-plus-wrap">
        <button class="dm-v2-plus-btn" type="button" aria-label="Attach" onclick="toggleDmV2PlusMenu('${escAttr(thread.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <div class="dm-v2-plus-menu" id="dm-v2-plus-menu-${escAttr(thread.id)}" hidden>
          <button type="button" class="dm-v2-plus-menu-item" onclick="closeDmV2PlusMenu('${escAttr(thread.id)}'); document.getElementById('dm-camera-input-${escAttr(thread.id)}') && document.getElementById('dm-camera-input-${escAttr(thread.id)}').click()">
            <span class="dm-v2-plus-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5l-2 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5l-2-2z"/><circle cx="12" cy="13" r="4"/></svg>
            </span>
            <span>Camera</span>
          </button>
          <button type="button" class="dm-v2-plus-menu-item" onclick="closeDmV2PlusMenu('${escAttr(thread.id)}'); document.getElementById('dm-photo-input-${escAttr(thread.id)}') && document.getElementById('dm-photo-input-${escAttr(thread.id)}').click()">
            <span class="dm-v2-plus-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </span>
            <span>Photos</span>
          </button>
          <button type="button" class="dm-v2-plus-menu-item" onclick="closeDmV2PlusMenu('${escAttr(thread.id)}'); document.getElementById('dm-file-input-${escAttr(thread.id)}') && document.getElementById('dm-file-input-${escAttr(thread.id)}').click()">
            <span class="dm-v2-plus-menu-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </span>
            <span>Files</span>
          </button>
        </div>
      </div>
      <!-- pill input with waveform voice button -->
      <div class="dm-v2-input-pill" onclick="focusDirectMessageComposerInput(event)">
        <input id="dm-message-input" class="dm-v2-input" type="text" placeholder="Message" autocomplete="off" oninput="this.closest('.dm-v2-compose')?.classList.toggle('has-text', !!this.value.trim())" onkeydown="if(event.key==='Enter'){sendDirectMessage('${escAttr(thread.id)}')}">
        <button class="dm-v2-pill-btn dm-v2-voice-btn" type="button" aria-label="Voice message" onclick="triggerDmV2VoiceNote('${escAttr(thread.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <line x1="4" y1="10" x2="4" y2="14"/><line x1="7" y1="7" x2="7" y2="17"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="13" y1="5" x2="13" y2="19"/><line x1="16" y1="8" x2="16" y2="16"/><line x1="19" y1="10" x2="19" y2="14"/>
          </svg>
        </button>
      </div>
      <button class="dm-v2-send-btn" type="button" onpointerdown="if(window.matchMedia && window.matchMedia('(max-width: 700px)').matches){event.preventDefault();}" onclick="sendDirectMessage('${escAttr(thread.id)}')" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 11.5L21 3l-8.5 18-2.5-8L3 11.5z"/></svg>
      </button>
    </div>
  </div>`;
}

/* v11.878: patch ONLY the message body + header identity of the already-mounted chat
   panel in the stage. Called by renderDirectMessagesView for every data update
   (snapshot / hydration / read-marker) while a thread is open. The .dm-v2-panel and
   its in-flight slide are NEVER rebuilt; the live #dm-message-input is untouched, so
   composer text/caret/focus survive automatically. */
function patchDmThreadMessages(threadId = activeDmThreadId) {
  const id = String(threadId || '').trim();
  const thread = dmThreadMap[id];
  const panel = getDmThreadPanel();
  if (!thread || !panel || panel.dataset.dmThreadId !== id) return;
  const list = panel.querySelector('#dm-message-list');
  if (!list) return;
  /* header identity — cheap, no media. Only reassign when the value ACTUALLY changed, so a
     hydration/read-marker echo never needlessly resets the header avatar's <img src> (a reset
     re-decodes = flash). */
  const profile = getDirectMessageThreadProfile(thread);
  const nameEl = panel.querySelector('.dm-v2-identity-name');
  const handleEl = panel.querySelector('.dm-v2-identity-handle');
  const avatarEl = panel.querySelector('.dm-v2-identity-avatar');
  if (nameEl) { const h = renderDirectMessageHeaderNameHTML(thread); if (nameEl.innerHTML !== h) nameEl.innerHTML = h; }
  if (handleEl) { const s = getDirectMessageThreadSubtitle(thread); if (handleEl.textContent !== s) handleEl.textContent = s; }
  if (avatarEl) { const a = getDirectMessageAvatar(profile); if (avatarEl.getAttribute('src') !== a) avatarEl.setAttribute('src', a); }
  /* v11.879 MEDIA-FLASH FIX: SKIP the message-list innerHTML swap when the rendered content is
     byte-identical to what's already mounted. The warm inbox-open path fires
     ensureDirectMessageThreadHydrated's .get() echo + a read-marker snapshot that re-render with
     the SAME messages; without this, each echo recreated every <img>/<iframe> in the thread →
     shared media reloaded from scratch = the black flash. We touch the DOM only on a genuine
     content change (new/edited message, or the cold-start spinner→real swap). */
  const html = buildDirectMessageListHTML(thread, id);
  if (panel.__dmListSig === html) {
    if (dmThreadNav.state === 'opening') pinDmThreadListToBottomInstant(panel);
    return;
  }
  const wasPinnedBottom = (list.scrollHeight - list.clientHeight - list.scrollTop) <= 60;
  panel.__dmListSig = html;
  list.innerHTML = html;
  if (wasPinnedBottom || dmThreadNav.state === 'opening') {
    const prev = list.style.scrollBehavior;
    list.style.scrollBehavior = 'auto';
    list.scrollTop = list.scrollHeight;
    if (prev) list.style.scrollBehavior = prev; else list.style.removeProperty('scroll-behavior');
    /* v11.878: re-pin as freshly-inserted media decodes and grows its bubble. On a push
       cold-start the panel mounts showing only the loading spinner, so beginDmThreadBottomAnchor's
       media listeners bound to nothing; the real photos arrive HERE (hydration patch). Photo
       bubbles have no reserved height, so a late decode would otherwise push the newest message
       above the fold. Guarded so it never yanks a user who has since scrolled up to read history. */
    list.querySelectorAll('img, video').forEach(m => {
      if (m.complete || m.readyState >= 2) return;
      const repin = () => {
        if (activeDmThreadId !== id) return;
        const p = getDmThreadPanel();
        const l = p ? p.querySelector('#dm-message-list') : null;
        if (!l || p.dataset.dmThreadId !== id) return;
        if ((l.scrollHeight - l.clientHeight - l.scrollTop) <= 120) pinDmThreadListToBottomInstant(p);
      };
      try { m.addEventListener('load', repin, { once: true }); } catch (_) {}
      try { m.addEventListener('loadedmetadata', repin, { once: true }); } catch (_) {}
    });
  }
}

/* v10.467: DM v2 helpers. Kept colocated with the renderer so the
   message-list HTML and the formatting/menu utilities live in one place. */

/* Date divider format — uppercase, contextual:
     • Same day  → "TODAY AT 3:42 PM"
     • Yesterday → "YESTERDAY AT 9:15 AM"
     • This week → "MON 5:30 AM"
     • Older     → "SEP 30 AT 6:50 AM" */
function formatDmV2DayDivider(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  const d = new Date(n);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  const msSinceMidnight = (now - new Date(now.getFullYear(), now.getMonth(), now.getDate())) + (Date.now() - now.getTime());
  const daysSince = Math.floor((Date.now() - n) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`.toUpperCase();
  if (isYesterday) return `Yesterday at ${time}`.toUpperCase();
  if (daysSince < 7) {
    const day = d.toLocaleDateString([], { weekday: 'short' });
    return `${day} ${time}`.toUpperCase();
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr} at ${time}`.toUpperCase();
}

/* Emoji-only detector — used to drop the bubble background on
   single-emoji or short emoji-string messages so they render large,
   matching the Instagram reference. */
function isDmV2EmojiOnly(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  if (s.length > 16) return false; // very short messages only
  try {
    return /^(?:\s|\p{Emoji_Presentation}|\p{Extended_Pictographic}|️|‍)+$/u.test(s);
  } catch (_) {
    /* Older engines without the \p Unicode property escape — fall back
       to a permissive surrogate-range check. */
    return /^[⌀-➿\uD83C-􏰀-\uDFFF\s]+$/.test(s);
  }
}

/* 3-dot overflow menu — open/close + outside-click dismiss. */
/* v10.815: Override the older emoji detector with a grapheme-aware version
   that handles iOS emoji sequences while rejecting normal text. */
isDmV2EmojiOnly = function(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  if (s.length > 48) return false;
  try {
    const compact = s.replace(/\s+/gu, '');
    const withoutKeycaps = compact.replace(/[0-9#*]\uFE0F?\u20E3/gu, '');
    if (!compact || /[A-Za-z0-9]/.test(withoutKeycaps)) return false;
    const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
    const segments = segmenter
      ? Array.from(segmenter.segment(compact), item => item.segment)
      : Array.from(compact);
    if (!segments.length || segments.length > 6) return false;
    return segments.every(segment => (
      /^[0-9#*]\uFE0F?\u20E3$/u.test(segment) ||
      /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]/u.test(segment)
    ));
  } catch (_) {
    const compact = s.replace(/\s+/g, '');
    const withoutKeycaps = compact.replace(/[0-9#*]\uFE0F?\u20E3/g, '');
    if (!compact || /[A-Za-z0-9]/.test(withoutKeycaps)) return false;
    return /(?:[\u2600-\u27BF]|\uD83C[\uDDE6-\uDDFF\uDF00-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDFFF])/.test(compact);
  }
};

window.openDirectMessagePhotoViewer = function(sourceImage) {
  const img = sourceImage && sourceImage.tagName === 'IMG'
    ? sourceImage
    : (sourceImage && sourceImage.querySelector ? sourceImage.querySelector('img') : null);
  const src = img?.currentSrc || img?.src || '';
  if (!src) return;
  const rect = img.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'dm-photo-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Photo preview');
  overlay.innerHTML = `
    <div class="dm-photo-viewer-backdrop"></div>
    <img class="dm-photo-viewer-image" src="${escAttr(src)}" alt="${escAttr(img.alt || 'Photo message')}" draggable="false">
    <button class="dm-photo-viewer-close" type="button" aria-label="Close photo preview">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  const viewerImage = overlay.querySelector('.dm-photo-viewer-image');
  const closeBtn = overlay.querySelector('.dm-photo-viewer-close');
  const start = {
    x: Math.max(0, rect.left || 0),
    y: Math.max(0, rect.top || 0),
    scaleX: Math.max(0.01, (rect.width || 1) / Math.max(1, window.innerWidth || 1)),
    scaleY: Math.max(0.01, (rect.height || 1) / Math.max(1, window.innerHeight || 1))
  };
  const startTransform = `translate3d(${start.x}px, ${start.y}px, 0) scale(${start.scaleX}, ${start.scaleY})`;
  const finishTransform = 'translate3d(0, 0, 0) scale(1, 1)';
  let closing = false;

  const close = () => {
    if (closing) return;
    closing = true;
    overlay.classList.add('is-closing');
    document.removeEventListener('keydown', onKeyDown);
    if (viewerImage && viewerImage.animate) {
      viewerImage.animate([
        { transform: finishTransform },
        { transform: startTransform }
      ], {
        duration: 260,
        easing: 'cubic-bezier(.32, 0, .67, 0)',
        fill: 'forwards'
      }).onfinish = () => overlay.remove();
    } else {
      overlay.remove();
    }
  };

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  overlay.addEventListener('click', close);
  if (viewerImage) viewerImage.addEventListener('click', event => event.stopPropagation());
  if (closeBtn) closeBtn.addEventListener('click', event => { event.stopPropagation(); close(); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    if (viewerImage && viewerImage.animate) {
      viewerImage.animate([
        { transform: startTransform },
        { transform: finishTransform }
      ], {
        duration: 360,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both'
      });
    }
  });
};

window.toggleDmV2OverflowMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-overflow-menu-' + id);
  if (!menu) return;
  const willOpen = menu.hidden;
  /* Close any other open menus first. */
  document.querySelectorAll('.dm-v2-overflow-menu').forEach(el => { el.hidden = true; });
  menu.hidden = !willOpen;
  if (willOpen) {
    /* One-shot outside-click listener — closes the menu when the user
       taps anywhere else. Captures touch + click for iOS. */
    setTimeout(() => {
      const onDocTap = (event) => {
        if (menu.hidden) return;
        if (event.target && event.target.closest && event.target.closest('.dm-v2-overflow-wrap')) return;
        menu.hidden = true;
        document.removeEventListener('click', onDocTap, true);
        document.removeEventListener('touchstart', onDocTap, true);
      };
      document.addEventListener('click', onDocTap, true);
      document.addEventListener('touchstart', onDocTap, true);
    }, 0);
  }
};
window.closeDmV2OverflowMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-overflow-menu-' + id);
  if (menu) menu.hidden = true;
};

/* v10.744: + attachment menu — open/close + outside-click dismiss. */
function closeDmV2PlusMenuElement(menu) {
  if (!menu || menu.hidden) return;
  menu.classList.remove('is-open');
  window.setTimeout(() => {
    if (!menu.classList.contains('is-open')) menu.hidden = true;
  }, 620);
}
window.toggleDmV2PlusMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-plus-menu-' + id);
  if (!menu) return;
  const willOpen = menu.hidden;
  document.querySelectorAll('.dm-v2-plus-menu').forEach(el => {
    if (el !== menu) closeDmV2PlusMenuElement(el);
  });
  if (willOpen) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    setTimeout(() => {
      const onDocTap = (event) => {
        if (menu.hidden) return;
        if (event.target && event.target.closest && event.target.closest('.dm-v2-plus-wrap')) return;
        closeDmV2PlusMenuElement(menu);
        document.removeEventListener('click', onDocTap, true);
        document.removeEventListener('touchstart', onDocTap, true);
      };
      document.addEventListener('click', onDocTap, true);
      document.addEventListener('touchstart', onDocTap, true);
    }, 0);
  } else {
    closeDmV2PlusMenuElement(menu);
  }
};
window.closeDmV2PlusMenu = function(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const menu = document.getElementById('dm-v2-plus-menu-' + id);
  if (menu) closeDmV2PlusMenuElement(menu);
};

/* v10.485: DM v2 inbox helpers — filter dropdown + inline search filter. */
window.toggleDmV2InboxFilter = function() {
  const menu = document.getElementById('dm-v2-inbox-filter-menu');
  if (!menu) return;
  const willOpen = menu.hidden;
  document.querySelectorAll('.dm-v2-inbox-filter-menu').forEach(el => { el.hidden = true; });
  menu.hidden = !willOpen;
  if (willOpen) {
    setTimeout(() => {
      const onDocTap = (event) => {
        if (menu.hidden) return;
        if (event.target && event.target.closest && event.target.closest('.dm-v2-inbox-filter-wrap')) return;
        menu.hidden = true;
        document.removeEventListener('click', onDocTap, true);
        document.removeEventListener('touchstart', onDocTap, true);
      };
      document.addEventListener('click', onDocTap, true);
      document.addEventListener('touchstart', onDocTap, true);
    }, 0);
  }
};
window.closeDmV2InboxFilter = function() {
  const menu = document.getElementById('dm-v2-inbox-filter-menu');
  if (menu) menu.hidden = true;
};
/* Inline filter — typing in the search pill hides chat rows that don't
   contain the query string. Resets when the query is cleared. */
window.filterDmV2InboxChats = function(query) {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('.dm-v2-inbox-list .dm-chat-swipe-item').forEach(item => {
    if (!q) {
      item.style.display = '';
      return;
    }
    const txt = (item.textContent || '').toLowerCase();
    item.style.display = txt.indexOf(q) !== -1 ? '' : 'none';
  });
};

/* Voice-note placeholder — Shelfd doesn't have voice messages yet.
   The icon exists in the composer (Instagram-parity) but tapping it
   surfaces a toast so the affordance doesn't read as broken. */
window.triggerDmV2VoiceNote = function(threadId) {
  if (typeof window.showToast === 'function') {
    window.showToast('Voice messages coming soon');
  }
};
window.focusDirectMessageComposerInput = function(event) {
  if (event?.target?.closest?.('button')) return;
  const input = document.getElementById('dm-message-input');
  if (!input) return;
  /* v10.782: just focus. visualViewport.resize handles the rest;
     no scroll juggling needed. */
  try { input.focus({ preventScroll: true }); }
  catch (_) { input.focus(); }
};
async function markDirectMessageThreadRead(threadId = '') {
  const thread = dmThreadMap[threadId];
  if (!currentUser || !thread || !(thread.unreadUids || []).includes(currentUser.uid)) return;
  /* v10.900: stamp `readAtMsByUid[currentUser.uid] = Date.now()` so the
     other participant can render the "Read {time}" receipt under their
     last sent message. The legacy mirror at setDirectMessageThreadMirror
     is a no-op (per v10.771 comment), so this also adds the canonical
     write to `dmThreads/{threadId}` via writeSharedDmThread — without
     that write, the other participant's listener would never observe
     the read-state change cross-user. */
  const nowMs = Date.now();
  const nextReadAt = { ...(thread.readAtMsByUid || {}), [currentUser.uid]: nowMs };
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    unreadUids: (thread.unreadUids || []).filter(uid => uid !== currentUser.uid),
    readAtMsByUid: nextReadAt,
    updatedAtMs: nowMs
  });
  dmThreadMap[threadId] = nextThread;
  try { if (typeof scheduleDmInboxCacheWrite === 'function') scheduleDmInboxCacheWrite(); } catch (_) {}
  try {
    /* v11.776 ROOT-CAUSE FIX: a read-mark must update ONLY the read-state fields
       — NEVER the `messages` array. The old code did writeSharedDmThread(nextThread),
       i.e. set(WHOLE thread, {merge:true}); because `messages` is an array, merge
       REPLACES it. When a thread was opened from a push notification on a cold
       start, its local copy was a message-LESS inbox-cache STUB (09b caches
       inbox rows without message bodies), so this write wiped the sender's
       message on the server — the recipient saw an empty "Chat accepted" chat
       until they sent a reply (which re-wrote the array). Writing ONLY the read
       fields with merge leaves the messages array untouched on the server. */
    try {
      await db.collection('dmThreads').doc(threadId).set({
        unreadUids: (thread.unreadUids || []).filter(uid => uid !== currentUser.uid),
        readAtMsByUid: nextReadAt,
        updatedAtMs: nowMs
      }, { merge: true });
    }
    catch (err) { console.warn('Shared DM read-mark write failed:', err && err.message ? err.message : err); }
    /* Legacy per-user mirror (currently a no-op stub, kept for safety). */
    await setDirectMessageThreadMirror(currentUser.uid, nextThread);
    updateDirectMessagesBadge();
  } catch (error) {
    console.warn('Direct Message read marker failed:', error);
  }
}

/* v11.776: pull the canonical dmThreads/{id} doc the moment a thread is opened.
   The inbox CACHE seeds message-LESS stubs for instant cold-start paint, and the
   global listener can be ~seconds behind on a push-notification cold start — so
   without this, opening from a notification shows an empty chat until the listener
   catches up. This fetch hydrates the real messages immediately, marks the thread
   server-confirmed (so the loading state can give way to either messages or a true
   empty state), and re-renders the open thread. Messages merge by id (union), so
   it never drops an optimistic just-sent message. */
function ensureDirectMessageThreadHydrated(threadId = '') {
  const id = String(threadId || '').trim();
  if (!id || typeof db === 'undefined' || !db || !currentUser) return;
  db.collection('dmThreads').doc(id).get().then(snap => {
    if (snap && snap.exists) {
      const incoming = normalizeDirectMessageThread({ ...(snap.data() || {}), id: snap.id });
      if ((incoming.participantUids || []).includes(currentUser.uid)) {
        mergeDirectMessageThreadIntoState(incoming);
      }
    }
    /* Only let the loading state resolve to the EMPTY state on a fresh SERVER
       read. A `fromCache` read (offline persistence) may be the stale/empty copy
       — keep showing loading and let the global listener deliver the real data. */
    const fromCache = !!(snap && snap.metadata && snap.metadata.fromCache);
    if (!fromCache) dmHydratedThreadIds.add(id);
    if (activeDmThreadId === id && isDirectMessagesPageOpen()) {
      try { renderDirectMessagesView(); } catch (_) {}
    }
  }).catch(() => { /* leave to the global listener (it also marks hydrated) */ });
}

/* v11.878 — the ONE authoritative animated open. Inbox-tap, profile "Message", and
   the push deep-link (routePushNotificationToDmThread) all funnel here. One tap =
   one panel build = one slide, as a structural fact. */
function openDirectMessageThread(threadId = '') {
  const id = String(threadId || '').trim();
  if (!id || !dmThreadMap[id]) return;
  /* ONE open per thread. A duplicate tap, or a notification re-fire for the chat that's
     already open or sliding in, is a clean no-op — it never cancels/restarts the slide. */
  if ((dmThreadNav.state === 'opening' || dmThreadNav.state === 'open')
      && dmThreadNav.threadId === id && !activeDmGroupEditThreadId) {
    const panel = getDmThreadPanel();
    if (panel && panel.dataset.dmThreadId === id) return;
  }
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  activeMessagesSubTab = 'chats';
  activeDmThreadId = id;
  syncDirectMessageActiveThreadState('thread-open');
  /* fresh inbox in the shell — the resting back-layer revealed once the panel is gone
     (back / swipe). The .dm-thread-swipe-underlay below is the correctly-sized layer the
     panel actually slides OVER during the entrance. */
  const shell = document.getElementById('dm-fullscreen-shell');
  if (shell) shell.innerHTML = renderDirectMessagesInboxShell();
  const page = document.getElementById('direct-messages-page');
  if (page) {
    /* clear any transition leftovers (e.g. a cancelled swipe-back that the engine snapped back
       without a callback) so this open starts from a clean inbox-geometry baseline. */
    page.classList.remove('dm-thread-swiping', 'dm-nav-finalizing-inbox');
    renderDirectMessageSwipeInboxUnderlay(page);   // inbox-behind, revealed during the slide-in
    page.classList.add('dm-thread-open');
  }
  /* mount the panel into its persistent stage + slide it in ONCE (token-guarded). */
  const token = ++dmThreadNavToken;
  dmThreadNav = { state: 'opening', threadId: id, token };
  mountDmThread(id, { animate: true, token });
  updateDirectMessagesTopbar();
  /* data: load the real messages + clear unread WITHOUT disturbing the slide. These
     fire async renders that only PATCH the message list in place (v11.776 preserved). */
  ensureDirectMessageThreadHydrated(id);
  markDirectMessageThreadRead(id);
  persistUiState();
}

/* v11.680: tap-back close. Slides the .dm-v2-panel off to the right over a STATIC
   inbox underlay — the EXACT same motion the edge-swipe engine produces (320ms
   cubic-bezier(0.22,1,0.36,1), 45px corners), so tap-back and swipe-back are
   visually identical, just like the news reader. No more --dm-thread-swipe-x CSS
   variable, no inbox parallax, no cascading !important transform rules. */
function closeDirectMessageThread(options = {}) {
  const animate = options !== false && options?.animate !== false;
  const page = document.getElementById('direct-messages-page');
  const panel = getDmThreadPanel();
  if (animate && page && panel && activeDmThreadId) {
    const token = ++dmThreadNavToken;
    dmThreadNav = { state: 'closing', threadId: activeDmThreadId, token };
    cancelDmThreadSlide();                           // stop any in-flight open slide cleanly
    resetDirectMessageKeyboardLift();
    /* v11.879 — settle the inbox NOW, while the panel still fully covers the screen.
       updateDirectMessagesTopbar drops .dm-thread-open (state is 'closing') so the inbox's
       final :not(.dm-thread-open) padding lands BEFORE the reveal (fixes the ~8px downward
       shift). Re-render the shell inbox so its cached avatars re-decode behind the covering
       panel (no avatar blink), and reveal the SHELL inbox directly — no separate underlay copy,
       so there's no decoded→fresh handoff to flash/jump. */
    updateDirectMessagesTopbar();
    const closeShell = document.getElementById('dm-fullscreen-shell');
    if (closeShell) closeShell.innerHTML = renderDirectMessagesInboxShell();
    page.classList.remove('dm-nav-open-thread', 'dm-nav-finalizing-inbox');
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(n => n.remove());
    /* slide the panel back off to the right — the exact REVERSE of the 390ms open slide.
       TOKEN-GUARD the finish: if a thread is (re)opened DURING this 390ms close — tap-back
       then re-tap the same row, or tap a different row through the revealed inbox — a newer
       token supersedes this close, so finalize must NOT yank that new thread back to the
       inbox. (The new open already swapped in its own panel via the stage, so this close is
       now animating a detached element; we simply drop its stale finalize.) */
    animateDirectMessagePanelOffscreen(panel, () => {
      if (dmThreadNav.token !== token) return;
      finalizeDirectMessageThreadClose(page);
    }, DIRECT_MESSAGES_THREAD_NAV_ANIMATION_MS);
    return;
  }
  finalizeDirectMessageThreadClose(page);
}

/* Settle the page to the inbox after the chat panel has slid off (or instantly).
   Shared by tap-back, the edge-swipe engine (window.shelfdDmFinishSwipeBack), and
   programmatic closes. Renders the real inbox FIRST, then removes the transient
   underlay, so there is never a blank frame. */
function finalizeDirectMessageThreadClose(page = document.getElementById('direct-messages-page')) {
  cancelDmThreadSlide();
  activeDmGroupEditThreadId = '';
  dmGroupEditPhotoData = '';
  activeDmThreadId = '';
  clearDirectMessageActiveThreadState('thread-close');
  dmThreadNav = { state: 'closed', threadId: '', token: dmThreadNavToken };
  resetDirectMessageKeyboardLift();
  unmountDmThread();                                 // remove the panel from its stage
  if (page) {
    page.classList.remove('dm-thread-open', 'dm-nav-open-thread', 'dm-nav-finalizing-inbox', 'dm-thread-swiping');
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
  }
  /* v11.879: the inbox was already rendered fresh + settled to its final geometry at close-start
     (behind the covering panel), so DON'T rebuild it here. Rebuilding at finalize is exactly what
     re-decoded the avatars (the black blink) and re-settled the layout (the downward shift) AFTER
     the animation. Only build if it's somehow missing (e.g. an instant, no-slide close). */
  const shell = document.getElementById('dm-fullscreen-shell');
  if (shell && !shell.querySelector('.dm-v2-inbox')) shell.innerHTML = renderDirectMessagesInboxShell();
  updateDirectMessagesTopbar();
  updateDirectMessagesBadge();
  persistUiState();
}

/* v11.680: hooks the generic edge-swipe engine (31-edge-swipe-back.js) calls so the
   DM chat thread swipes back with the identical animation to the news reader. */
if (typeof window !== 'undefined') {
  window.shelfdDmRenderSwipeUnderlay = function () {
    const page = document.getElementById('direct-messages-page');
    if (!page) return;
    /* the generic edge-swipe engine (31-edge-swipe-back.js) now owns the panel transform —
       kill any in-flight open slide (timer + lingering CSS transition) so the finger fully
       owns the panel, then reveal the inbox-behind underlay. */
    cancelDmThreadSlide();
    const panel = getDmThreadPanel();
    if (panel) { panel.style.transition = 'none'; panel.style.webkitTransition = 'none'; panel.style.willChange = 'transform'; }
    resetDirectMessageKeyboardLift();
    /* v11.879: add .dm-thread-swiping FIRST so updateDirectMessagesTopbar (and any snapshot
       re-render mid-swipe) drops .dm-thread-open → the inbox the finger reveals is already in its
       final :not(.dm-thread-open) position (no post-swipe downward shift). Reveal the SHELL inbox
       directly (fresh content + cached avatars), not a separate underlay copy. We do NOT flip
       dmThreadNav.state to 'closing': a CANCELLED swipe (snap-back) gets no callback from the
       engine, and keeping state 'open' keeps the keyboard lift working if the chat stays open. */
    dmSwipeBackToken = dmThreadNav.token;
    page.classList.remove('dm-nav-open-thread', 'dm-nav-finalizing-inbox');
    page.classList.add('dm-thread-swiping');
    updateDirectMessagesTopbar();
    const swipeShell = document.getElementById('dm-fullscreen-shell');
    if (swipeShell) swipeShell.innerHTML = renderDirectMessagesInboxShell();
    page.querySelectorAll('.dm-thread-swipe-underlay').forEach(n => n.remove());
  };
  window.shelfdDmFinishSwipeBack = function () {
    /* superseded by a thread opened mid-swipe-off → don't wipe the new thread. */
    if (dmThreadNav.token !== dmSwipeBackToken) return;
    finalizeDirectMessageThreadClose(document.getElementById('direct-messages-page'));
  };
}

/* ────────────────────────────────────────────────────────────────────────
   v10.776 — Push-notification → DM thread deep-link router.
   ────────────────────────────────────────────────────────────────────────
   When a user taps a DM push notification (iOS APNs), the Capacitor
   pushNotificationActionPerformed handler in 33-push-notifications.js
   calls this function with the threadId pulled out of the notification
   payload. We open the DM inbox page then drill into the specific
   thread. Lives here (not in 33-push-notifications.js) because the
   thread-lookup needs `dmThreadMap`, which is declared `let` at the
   top of this file — it's not on window, so cross-file access requires
   a wrapper defined in the same scope.

   Cold-launch race: when a user taps a notification from the lock
   screen, the app boots fresh. Auth and dmThreads listener take
   ~300-600ms to settle (faster on warm cache). If we tried to open
   immediately, dmThreadMap[threadId] would still be empty and
   openDirectMessageThread would no-op (see line 2393 early-return).
   Solution: poll for up to 8 seconds at 200ms intervals, opening the
   moment the data lands. After the timeout, fall back to just opening
   the inbox so the user lands somewhere useful instead of staring at
   their default tab. */
function routePushNotificationToDmThread(threadId) {
  const id = String(threadId || '').trim();
  if (!id) return;
  const start = Date.now();
  const MAX_WAIT_MS = 8000;
  const POLL_MS = 200;
  const attempt = () => {
    const authReady = !!(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
    const threadReady = !!(dmThreadMap && dmThreadMap[id]);
    if (authReady && threadReady) {
      /* v11.783/786: SINGLE ATOMIC OPEN — open the page WITHOUT its slide (no compound
         page+panel double-slide, no 140ms stagger) then drill into the thread so ONLY the
         chat panel slides (WAAPI-with-pixels, animates regardless of paint timing).
         activeDmThreadId reset first so the inbox renders clean underneath the sliding panel. */
      try {
        activeDmThreadId = '';
        if (typeof openDirectMessagesPage === 'function') openDirectMessagesPage(true);
        if (typeof openDirectMessageThread === 'function') openDirectMessageThread(id);
      } catch (e) { console.warn('[v11.786] DM notification open failed:', e); }
      return;
    }
    if (Date.now() - start < MAX_WAIT_MS) {
      setTimeout(attempt, POLL_MS);
      return;
    }
    /* Timed out waiting for data — at least drop the user on the
       DM inbox so the tap isn't a complete no-op. */
    if (authReady && typeof openDirectMessagesPage === 'function') {
      try { openDirectMessagesPage(); } catch (e) {}
    }
  };
  attempt();
}
if (typeof window !== 'undefined') {
  window.routePushNotificationToDmThread = routePushNotificationToDmThread;
}

function renderDirectMessagesInboxShell() {
  const requestCount = dmIncomingRequestIds.length;
  const body = activeMessagesSubTab === 'requests' ? renderDirectMessageRequests() : renderDirectMessageChats();
  const myProfile = (typeof userProfile === 'object' && userProfile) ? userProfile : {};
  const myAvatar = currentUser?.photoURL || myProfile.photo || myProfile.photoURL
    || `/default-avatar.svg#${encodeURIComponent(currentUser?.displayName || myProfile.name || 'Me')}&background=1e2028&color=a78bfa`;
  const filterLabel = activeMessagesSubTab === 'requests'
    ? (requestCount ? `Requests (${requestCount})` : 'Requests')
    : 'All';
  return `<div class="dm-v2-inbox">
    <div class="dm-v2-inbox-header">
      <button class="dm-v2-inbox-back" type="button" onclick="closeDirectMessagesPage()" aria-label="Close messages">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="dm-v2-inbox-title">Chat</h1>
      <div class="dm-v2-inbox-filter-wrap">
        <button class="dm-v2-inbox-filter" type="button" onclick="toggleDmV2InboxFilter()" aria-haspopup="true">
          <span>${escHtml(filterLabel)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="dm-v2-inbox-filter-menu" id="dm-v2-inbox-filter-menu" hidden>
          <button type="button" onclick="switchMessagesSubTab('chats');closeDmV2InboxFilter()">All chats</button>
          <button type="button" onclick="switchMessagesSubTab('requests');closeDmV2InboxFilter()">Requests${requestCount ? ` (${requestCount})` : ''}</button>
        </div>
      </div>
    </div>
    <div class="dm-v2-inbox-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/>
        <path d="m21 21-4.3-4.3"/>
      </svg>
      <input type="text" placeholder="Search" autocomplete="off" oninput="filterDmV2InboxChats(this.value)">
    </div>
    ${dmNewChatOpen ? renderDirectMessageComposerPanel() : ''}
    <div class="dm-v2-inbox-list">${body}</div>
    <button class="dm-v2-inbox-fab" type="button" onclick="openDirectMessageComposer('direct')" aria-label="New chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        <line x1="12" y1="9" x2="12" y2="14"/>
        <line x1="9.5" y1="11.5" x2="14.5" y2="11.5"/>
      </svg>
    </button>
  </div>`;
}

function renderDirectMessageSwipeInboxUnderlay(page = document.getElementById('direct-messages-page')) {
  if (!page || !currentUser) return null;
  page.querySelectorAll('.dm-thread-swipe-underlay').forEach(node => node.remove());
  const underlay = document.createElement('div');
  underlay.className = 'dm-thread-swipe-underlay';
  underlay.setAttribute('aria-hidden', 'true');
  underlay.innerHTML = renderDirectMessagesInboxShell();
  page.appendChild(underlay);
  return underlay;
}
/* v10.840: removed window exposure — the generic edge-swipe-back system
   no longer drives DM thread swipes. The custom system in this file
   calls renderDirectMessageSwipeInboxUnderlay directly. */

async function sendDirectMessage(threadId = '') {
  const input = document.getElementById('dm-message-input');
  const text = String(input?.value || '').trim();
  const thread = dmThreadMap[threadId];
  if (!text || !currentUser || !thread) return;
  /* v10.782: iMessage behavior — clear the input but DON'T blur. The
     keyboard stays up so the user can immediately type another message.
     They dismiss it themselves by swiping the message list down (see
     swipe-dismiss handler in initDirectMessageKeyboardLift). */
  if (input) input.value = '';
  const sent = await appendDirectMessageToThread(threadId, text, null);
  if (!sent && input) {
    /* Send failed — restore the text so the user can retry. */
    input.value = text;
    return;
  }
  /* v11.880: the user is now at the latest message — lock to bottom so that when they dismiss
     the iOS keyboard (Done / swipe-down) the chat stays pinned to this newest message instead of
     drifting up as the list grows back. */
  setDmThreadBottomLocked(true);
  /* One scroll-to-bottom (next frame, after the new message renders)
     so the user immediately sees what they sent. No chains, no settle
     times — the message list naturally stays at the bottom because
     it WAS at the bottom (user just typed and sent). */
  requestAnimationFrame(scrollDirectMessageListToBottom);
}

function renderDirectMessagesView() {
  const shell = document.getElementById('dm-fullscreen-shell');
  if (!isDirectMessagesPageOpen() || !shell) return;
  if (!currentUser) {
    shell.innerHTML = '<div class="dm-empty-card"><strong>Sign in required</strong><span>Direct Messages will appear here.</span></div>';
    unmountDmThread();
    updateDirectMessagesTopbar();
    return;
  }
  updateDirectMessagesBadge();

  /* v11.878 RENDER BOUNDARY.
     GROUP-EDIT page replaces the shell; the chat stage is hidden behind it. */
  if (activeDmGroupEditThreadId) {
    hideDmThreadStage();
    shell.innerHTML = renderDirectMessageGroupEditPage(activeDmGroupEditThreadId);
    if (dmGroupEditCropState && dmGroupEditCropState.sourceData) primeDirectMessageGroupEditCropImage(dmGroupEditCropState.sourceData);
    updateDirectMessagesTopbar();
    return;
  }

  /* OPEN CHAT THREAD — lives in #dm-thread-stage, OUTSIDE this shell. A data re-render
     (snapshot / hydration / read-marker) only PATCHES the message list inside the mounted
     panel; it NEVER rebuilds the panel or touches its slide transform. That physical
     separation is what makes the open animation un-replayable. */
  if (activeDmThreadId && dmThreadMap[activeDmThreadId]) {
    showDmThreadStage();
    /* keep a base inbox in the shell, revealed on back/swipe. Only build it if missing so
       we don't churn the inbox on every snapshot while a thread is open. */
    if (!shell.querySelector('.dm-v2-inbox')) shell.innerHTML = renderDirectMessagesInboxShell();
    const panel = getDmThreadPanel();
    if (panel && panel.dataset.dmThreadId === activeDmThreadId) {
      patchDmThreadMessages(activeDmThreadId);
    } else if (dmThreadNav.state !== 'opening' && dmThreadNav.state !== 'closing') {
      /* active thread but no mounted panel (cold open / UI-state restore) -> mount at rest. */
      mountDmThread(activeDmThreadId, { animate: false });
    }
    updateDirectMessagesTopbar();
    return;
  }

  /* INBOX */
  unmountDmThread();
  shell.innerHTML = renderDirectMessagesInboxShell();
  updateDirectMessagesTopbar();
}


function openDirectMessageFromUser(uid = '') {
  if (!uid || uid === currentUser?.uid) return;
  const thread = getDirectMessageThreadWithUser(uid);
  if (thread) {
    /* v11.786: open the page instantly (inbox visible, no page-level slide) then drill into
       the thread — same synchronous shape as the inbox tap. The slide is now WAAPI-with-
       pixels (see startDirectMessageThreadOpenAnimation), which animates regardless of paint
       timing, so the earlier one-frame defer is no longer needed. activeDmThreadId reset
       first so the inbox renders clean underneath the sliding panel. */
    activeDmThreadId = '';
    openDirectMessagesPage(true);
    openDirectMessageThread(thread.id);
    return;
  }
  openDirectMessagesPage();
  if (isDirectMessageFriend(uid)) {
    openOrCreateDirectMessageThreadForUser(uid);
    return;
  }
  sendDirectMessageRequest(uid).then(() => {
    activeMessagesSubTab = 'requests';
    renderDirectMessagesView();
  });
}
