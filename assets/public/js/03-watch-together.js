// My Lists: Watch / Plan Together groups (mobile-first social tagging)
const WATCH_TOGETHER_SECTIONS = ["movies", "shows", "anime"];
let watchTogetherGroups = [];
let watchTogetherIncomingRequests = [];
let watchTogetherOutgoingRequests = [];
let watchTogetherIncomingRequestIds = [];
let watchTogetherOutgoingRequestIds = [];
let watchTogetherIncomingRequestPayloadMap = {};
let watchTogetherOutgoingRequestPayloadMap = {};
let watchTogetherApprovedRequestIds = [];
let watchTogetherApprovedRequestPayloadMap = {};
let watchTogetherMirrorHydratePromise = null;
let watchTogetherUnsubscribe = null;
let watchTogetherTagContext = null;
let watchTogetherSelectedUsers = [];
let watchTogetherSearchTimer = null;
let watchTogetherAverageCache = {};

function normalizeWatchTogetherRequestIds(value) {
  return Array.isArray(value) ? value.map(id => String(id || '').trim()).filter(Boolean) : [];
}

function normalizeWatchTogetherRequestPayloadMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [id, raw]) => {
    const groupId = String(id || raw?.id || '').trim();
    if (!groupId || !raw || typeof raw !== 'object') return acc;
    acc[groupId] = {
      id: groupId,
      ...raw,
      pendingUids: Array.isArray(raw.pendingUids) ? raw.pendingUids.filter(Boolean) : [],
      approvedUids: Array.isArray(raw.approvedUids) ? raw.approvedUids.filter(Boolean) : [],
      participantUids: Array.isArray(raw.participantUids) ? raw.participantUids.filter(Boolean) : [],
      rejectedUids: Array.isArray(raw.rejectedUids) ? raw.rejectedUids.filter(Boolean) : []
    };
    return acc;
  }, {});
}

function getWatchTogetherMirroredPayloadGroups() {
  return [
    ...Object.values(watchTogetherIncomingRequestPayloadMap || {}),
    ...Object.values(watchTogetherOutgoingRequestPayloadMap || {}),
    ...Object.values(watchTogetherApprovedRequestPayloadMap || {})
  ].filter(group => group && group.id);
}

function getWatchTogetherMirrorPayload(group = {}, groupId = '') {
  return {
    id: groupId || group.id || '',
    section: group.section || '',
    title: group.title || '',
    titleKey: group.titleKey || '',
    mediaKey: group.mediaKey || '',
    cover: group.cover || '',
    genre: group.genre || '',
    tmdbId: group.tmdbId || '',
    imdbId: group.imdbId || '',
    librarySection: group.librarySection || group.section || '',
    mediaCategory: group.mediaCategory || group.section || '',
    mode: group.mode === 'planned' ? 'planned' : 'watched',
    ownerUid: group.ownerUid || '',
    participantUids: Array.isArray(group.participantUids) ? group.participantUids.filter(Boolean) : [],
    approvedUids: Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [],
    pendingUids: Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [],
    rejectedUids: Array.isArray(group.rejectedUids) ? group.rejectedUids.filter(Boolean) : [],
    profiles: group.profiles || {},
    status: group.status || 'pending',
    createdAtMs: group.createdAtMs || Date.now(),
    updatedAtMs: Date.now()
  };
}

async function setWatchTogetherRequestMirror(uid = '', direction = 'incoming', groupId = '', payload = {}, options = {}) {
  if (!uid || !groupId) return;
  const isIncoming = direction === 'incoming';
  const idsField = isIncoming ? 'watchTogetherIncomingRequests' : 'watchTogetherOutgoingRequests';
  const mapField = isIncoming ? 'watchTogetherIncomingRequestMap' : 'watchTogetherOutgoingRequestMap';
  const includeInRequestList = options.includeInRequestList !== false;
  await db.collection('users').doc(uid).set({
    [idsField]: includeInRequestList
      ? firebase.firestore.FieldValue.arrayUnion(groupId)
      : firebase.firestore.FieldValue.arrayRemove(groupId),
    [mapField]: { [groupId]: getWatchTogetherMirrorPayload(payload, groupId) }
  }, { merge: true });
}

async function setWatchTogetherApprovedMirror(uid = '', groupId = '', payload = {}) {
  if (!uid || !groupId) return;
  await db.collection('users').doc(uid).set({
    watchTogetherApprovedGroups: firebase.firestore.FieldValue.arrayUnion(groupId),
    watchTogetherApprovedGroupMap: { [groupId]: getWatchTogetherMirrorPayload(payload, groupId) }
  }, { merge: true });
}

async function clearWatchTogetherApprovedMirror(uid = '', groupId = '') {
  if (!uid || !groupId) return;
  const userRef = db.collection('users').doc(uid);
  await userRef.set({ watchTogetherApprovedGroups: firebase.firestore.FieldValue.arrayRemove(groupId) }, { merge: true });
  try {
    await userRef.update({ [`watchTogetherApprovedGroupMap.${groupId}`]: firebase.firestore.FieldValue.delete() });
  } catch (error) {
    console.warn('Watch Together approved mirror cleanup skipped:', error);
  }
}

async function clearWatchTogetherRequestMirror(uid = '', direction = 'incoming', groupId = '') {
  if (!uid || !groupId) return;
  const isIncoming = direction === 'incoming';
  const idsField = isIncoming ? 'watchTogetherIncomingRequests' : 'watchTogetherOutgoingRequests';
  const mapField = isIncoming ? 'watchTogetherIncomingRequestMap' : 'watchTogetherOutgoingRequestMap';
  const userRef = db.collection('users').doc(uid);
  await userRef.set({ [idsField]: firebase.firestore.FieldValue.arrayRemove(groupId) }, { merge: true });
  try {
    await userRef.update({ [`${mapField}.${groupId}`]: firebase.firestore.FieldValue.delete() });
  } catch (error) {
    console.warn('Watch Together request mirror cleanup skipped:', error);
  }
}

function mergeWatchTogetherGroupsById(...groupsLists) {
  const byId = new Map();
  groupsLists.flat().forEach(group => {
    if (!group || !group.id) return;
    byId.set(group.id, { ...(byId.get(group.id) || {}), ...group });
  });
  return [...byId.values()];
}

async function fetchWatchTogetherGroupsByIds(ids = []) {
  // Shared Watch now mirrors all needed request data inside users docs.
  // This avoids depending on a separate top-level collection during send/approve.
  return [];
}

async function hydrateWatchTogetherMirroredRequests() {
  if (!currentUser) return;
  if (watchTogetherMirrorHydratePromise) return watchTogetherMirrorHydratePromise;
  watchTogetherMirrorHydratePromise = (async () => {
    const incomingIds = watchTogetherIncomingRequestIds.slice();
    const outgoingIds = watchTogetherOutgoingRequestIds.slice();
    const mirroredGroups = mergeWatchTogetherGroupsById(
      await fetchWatchTogetherGroupsByIds([...incomingIds, ...outgoingIds]),
      getWatchTogetherMirroredPayloadGroups()
    );
    const incomingFromMirror = mirroredGroups.filter(group => incomingIds.includes(group.id) && (group.pendingUids || []).includes(currentUser.uid));
    const outgoingFromMirror = mirroredGroups.filter(group => outgoingIds.includes(group.id) && group.ownerUid === currentUser.uid && (group.pendingUids || []).length);
    const mirroredIds = new Set(mirroredGroups.map(group => group.id));

    watchTogetherGroups = mergeWatchTogetherGroupsById(
      watchTogetherGroups.filter(group => !mirroredIds.has(group.id)),
      mirroredGroups
    );
    watchTogetherIncomingRequests = incomingFromMirror;
    watchTogetherOutgoingRequests = outgoingFromMirror;
    updateRequestsBadges();
    const communityActive = document.getElementById('nav-community')?.classList.contains('active');
    if (communityActive && activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
  })().catch(error => {
    console.error('Watch Together mirrored request hydrate failed:', error);
  }).finally(() => {
    watchTogetherMirrorHydratePromise = null;
  });
  return watchTogetherMirrorHydratePromise;
}

function canUseWatchTogetherSection(section = activeSection) {
  return WATCH_TOGETHER_SECTIONS.includes(String(section || '').trim());
}

function getWatchTogetherOwnerUid() {
  return viewingUser?.uid || currentUser?.uid || '';
}

function getWatchTogetherTitleKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getMediaKeyForSection(item = {}, section = activeSection) {
  const copy = {
    ...(item || {}),
    librarySection: item?.librarySection || item?.mediaCategory || section,
    mediaCategory: item?.mediaCategory || item?.librarySection || section
  };
  return getMediaKey(copy);
}

function getWatchTogetherItemTitle(item = {}, section = activeSection) {
  return getDisplayTitleForItem(item, section) || item?.title || item?.name || '';
}

function buildWatchTogetherItemSeed(item = {}, section = activeSection) {
  const title = getWatchTogetherItemTitle(item, section);
  return {
    section,
    title,
    titleKey: getWatchTogetherTitleKey(title),
    mediaKey: getMediaKeyForSection(item, section),
    cover: item.cover || '',
    genre: item.genre || '',
    tmdbId: item.tmdbId || '',
    imdbId: item.imdbId || '',
    librarySection: section,
    mediaCategory: section
  };
}

function watchTogetherGroupMatchesItem(group = {}, item = {}, section = activeSection) {
  if (!group || !item || group.section !== section) return false;
  const itemMediaKey = getMediaKeyForSection(item, section);
  if (group.mediaKey && itemMediaKey && group.mediaKey === itemMediaKey) return true;
  const itemTitleKey = getWatchTogetherTitleKey(getWatchTogetherItemTitle(item, section));
  return !!group.titleKey && group.titleKey === itemTitleKey;
}

function getWatchTogetherGroupsForItem(item = {}, section = activeSection, ownerUid = getWatchTogetherOwnerUid()) {
  if (!ownerUid || !canUseWatchTogetherSection(section)) return [];
  return watchTogetherGroups.filter(group => {
    const approved = Array.isArray(group.approvedUids) ? group.approvedUids : [];
    return approved.includes(ownerUid) && watchTogetherGroupMatchesItem(group, item, section);
  });
}

function getPendingWatchTogetherGroupsForItem(item = {}, section = activeSection) {
  if (!currentUser || viewingUser || !canUseWatchTogetherSection(section)) return [];
  return watchTogetherGroups.filter(group => {
    const pending = Array.isArray(group.pendingUids) ? group.pendingUids : [];
    return group.ownerUid === currentUser.uid && pending.length && watchTogetherGroupMatchesItem(group, item, section);
  });
}

function getWatchTogetherProfile(uid = '', group = {}) {
  const profile = (group.profiles && group.profiles[uid]) || usersMap[uid] || {};
  return {
    uid,
    name: profile.name || profile.customName || (uid === currentUser?.uid ? userProfile?.name : '') || 'User',
    photo: profile.photo || profile.customPhoto || (uid === currentUser?.uid ? userProfile?.photo : '') || ''
  };
}

function getWatchTogetherAvatar(profile = {}) {
  return profile.photo || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(profile.name || '?') + '&background=1c1535&color=a78bfa');
}

function getWatchTogetherGroupById(groupId = '') {
  const id = String(groupId || '').trim();
  if (!id) return null;
  return { id, ...(
    watchTogetherOutgoingRequestPayloadMap[id] ||
    watchTogetherIncomingRequestPayloadMap[id] ||
    watchTogetherApprovedRequestPayloadMap[id] ||
    watchTogetherGroups.find(group => group && group.id === id) ||
    {}
  ) };
}

function getWatchTogetherBlockedTagUids() {
  if (!watchTogetherTagContext) return new Set();
  const { itemId, section } = watchTogetherTagContext;
  const item = findListItemById(section, itemId);
  if (!item) return new Set();
  const blocked = new Set([currentUser?.uid].filter(Boolean));
  getWatchTogetherGroupsForItem(item, section, currentUser?.uid).forEach(group => {
    [...(group.approvedUids || []), ...(group.pendingUids || [])].forEach(uid => {
      if (uid && uid !== currentUser?.uid) blocked.add(uid);
    });
  });
  watchTogetherSelectedUsers.forEach(user => {
    if (user.uid) blocked.add(user.uid);
  });
  return blocked;
}

function getVisibleWatchTogetherMembersForItem(item = {}, section = activeSection, ownerUid = getWatchTogetherOwnerUid()) {
  const groups = getWatchTogetherGroupsForItem(item, section, ownerUid);
  const byUid = new Map();
  const isOwnPrivateCard = !viewingUser && currentUser?.uid && ownerUid === currentUser.uid;
  groups.forEach(group => {
    const approved = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
    const pending = Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [];
    approved.forEach(uid => {
      if (!uid || uid === ownerUid) return;
      if (!byUid.has(uid)) byUid.set(uid, { ...getWatchTogetherProfile(uid, group), watchTogetherPending: false });
    });
    if (isOwnPrivateCard && group.ownerUid === currentUser.uid) {
      pending.forEach(uid => {
        if (!uid || uid === ownerUid || byUid.has(uid)) return;
        byUid.set(uid, { ...getWatchTogetherProfile(uid, group), watchTogetherPending: true });
      });
    }
  });
  return [...byUid.values()];
}

function renderWatchTogetherCardControl(item = {}, section = activeSection) {
  if (!canUseWatchTogetherSection(section)) return '';
  const ownerUid = getWatchTogetherOwnerUid();
  if (!ownerUid) return '';
  const itemId = escAttr(item.id || '');
  const sectionAttr = escAttr(section);
  const members = getVisibleWatchTogetherMembersForItem(item, section, ownerUid);
  const pendingGroups = getPendingWatchTogetherGroupsForItem(item, section);
  const pendingCount = pendingGroups.reduce((sum, group) => sum + (Array.isArray(group.pendingUids) ? group.pendingUids.length : 0), 0);
  const visible = members.slice(0, 3);
  const stack = members.length ? `<button class="watch-together-stack" type="button" onclick="openWatchTogetherInfoModal(event, '${itemId}', '${sectionAttr}')" aria-label="View people tagged on this title">
    ${visible.map(profile => `<img class="${profile.watchTogetherPending ? 'watch-together-avatar-pending' : ''}" src="${escAttr(getWatchTogetherAvatar(profile))}" alt="${escAttr(profile.name)}" loading="lazy" title="${profile.watchTogetherPending ? 'Waiting for approval' : 'Approved'}">`).join('')}
    ${members.length > 3 ? `<span class="watch-together-more">+${members.length - 3}</span>` : ''}
  </button>` : '';
  const add = (!members.length && !viewingUser && currentUser) ? `<button class="watch-together-add" type="button" onclick="openWatchTogetherTagModal(event, '${itemId}', '${sectionAttr}')" aria-label="Tag people to watch together">＋</button>` : '';
  const pending = pendingCount ? `<span class="watch-together-pending" title="Waiting for approval">${pendingCount} pending</span>` : '';
  if (!stack && !add && !pending) return '';
  return `<div class="watch-together-slot">${stack}${pending}${add}</div>`;
}

function findListItemById(section = activeSection, itemId = '') {
  const source = viewingUser && friendViewData ? friendViewData : data;
  return (source?.[section] || []).find(item => String(item.id) === String(itemId)) || null;
}

function closeWatchTogetherModal() {
  const overlay = document.getElementById('watch-together-modal-overlay');
  if (overlay) overlay.remove();
  watchTogetherTagContext = null;
  watchTogetherSelectedUsers = [];
}

function closeWatchTogetherInfoModal() {
  const overlay = document.getElementById('watch-together-info-overlay');
  if (overlay) overlay.remove();
  if (!document.getElementById('watch-together-modal-overlay')) {
    watchTogetherTagContext = null;
    watchTogetherSelectedUsers = [];
  }
}

function setWatchTogetherMode(mode = 'watched') {
  if (!watchTogetherTagContext) return;
  watchTogetherTagContext.mode = mode === 'planned' ? 'planned' : 'watched';
  const modal = document.getElementById('watch-together-modal-overlay') || document.getElementById('watch-together-info-overlay');
  if (!modal) return;
  modal.querySelectorAll('.watch-together-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === watchTogetherTagContext.mode);
  });
}

function renderWatchTogetherSelected() {
  const wrap = document.getElementById('watch-together-selected');
  if (!wrap) return;
  wrap.innerHTML = watchTogetherSelectedUsers.length
    ? watchTogetherSelectedUsers.map(user => `<span class="watch-together-chip"><img src="${escAttr(getWatchTogetherAvatar(user))}" alt="">${renderDisplayNameHTML(user, 'User')}<button type="button" onclick="removeWatchTogetherSelected('${escAttr(user.uid)}')">×</button></span>`).join('')
    : '<span class="watch-together-selected-empty">Search and add people. They approve before it appears.</span>';
  const saveBtn = document.getElementById('watch-together-save-btn');
  if (saveBtn) saveBtn.disabled = watchTogetherSelectedUsers.length === 0;
}

function removeWatchTogetherSelected(uid = '') {
  watchTogetherSelectedUsers = watchTogetherSelectedUsers.filter(user => user.uid !== uid);
  renderWatchTogetherSelected();
  const input = document.getElementById('watch-together-search-input');
  if (input) searchWatchTogetherUsers(input.value || '');
}

function addWatchTogetherSelected(uid = '', name = '', photo = '') {
  if (!uid || uid === currentUser?.uid || watchTogetherSelectedUsers.some(user => user.uid === uid)) return;
  watchTogetherSelectedUsers.push({ uid, name: name || 'User', photo: photo || '' });
  renderWatchTogetherSelected();
  const input = document.getElementById('watch-together-search-input');
  if (input) searchWatchTogetherUsers(input.value || '');
}

async function searchWatchTogetherUsers(query = '') {
  const results = document.getElementById('watch-together-search-results');
  if (!results) return;
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) {
    results.innerHTML = '<div class="watch-together-empty">Type at least 2 letters to tag anyone by username.</div>';
    return;
  }
  results.innerHTML = '<div class="watch-together-empty">Searching...</div>';
  try {
    const snap = await db.collection('users')
      .where('nameLower', '>=', q)
      .where('nameLower', '<=', q + '\uf8ff')
      .limit(12)
      .get();
    const users = [];
    snap.forEach(doc => {
      const raw = { ...(doc.data() || {}), uid: doc.id };
      if (!raw.uid || raw.uid === currentUser?.uid) return;
      usersMap[raw.uid] = raw;
      users.push(raw);
    });
    if (!users.length) {
      results.innerHTML = '<div class="watch-together-empty">No users found.</div>';
      return;
    }
    const blockedUids = getWatchTogetherBlockedTagUids();
    results.innerHTML = users.map(user => {
      const selected = watchTogetherSelectedUsers.some(u => u.uid === user.uid);
      const alreadyTagged = blockedUids.has(user.uid) && !selected;
      const disabled = selected || alreadyTagged;
      const avatar = getWatchTogetherAvatar(user);
      return `<div class="watch-together-result">
        <img src="${escAttr(avatar)}" alt="">
        <div class="watch-together-result-copy"><strong>${renderDisplayNameHTML(user, 'User')}</strong><span>${selected ? 'Selected' : alreadyTagged ? 'Already on this title' : 'Tap Add to request approval'}</span></div>
        <button type="button" class="watch-together-result-add" ${disabled ? 'disabled' : ''} onclick="addWatchTogetherSelected('${escAttr(user.uid)}','${escAttr(user.name || user.customName || 'User')}','${escAttr(user.photo || user.customPhoto || '')}')">${selected ? 'Added' : alreadyTagged ? 'Added' : 'Add'}</button>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('Watch together search failed:', e);
    results.innerHTML = '<div class="watch-together-empty">Search failed. Try again.</div>';
  }
}

function queueWatchTogetherSearch(value = '') {
  clearTimeout(watchTogetherSearchTimer);
  watchTogetherSearchTimer = setTimeout(() => searchWatchTogetherUsers(value), 180);
}

function createWatchTogetherGroupId() {
  const safeUid = String(currentUser?.uid || 'user').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'user';
  return `wt_${safeUid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function openWatchTogetherTagModal(event, itemId = '', section = activeSection) {
  event?.stopPropagation?.();
  if (!currentUser || viewingUser || !canUseWatchTogetherSection(section)) return;
  const item = findListItemById(section, itemId);
  if (!item) return;
  const seed = buildWatchTogetherItemSeed(item, section);
  const defaultMode = item.status === 'planned' ? 'planned' : 'watched';
  watchTogetherTagContext = { itemId, section, seed, mode: defaultMode };
  watchTogetherSelectedUsers = [];
  const existing = document.getElementById('watch-together-modal-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'watch-together-modal-overlay';
  overlay.className = 'watch-together-modal-overlay';
  overlay.innerHTML = `<div class="watch-together-modal" role="dialog" aria-modal="true" aria-label="Tag people on ${escAttr(seed.title)}">
    <div class="watch-together-modal-head">
      <div><div class="watch-together-kicker">My Lists Social</div><h3>Tag people on this title</h3><p>${escHtml(seed.title)}</p></div>
      <button type="button" class="watch-together-close" onclick="closeWatchTogetherModal()" aria-label="Close">×</button>
    </div>
    <div class="watch-together-mode-toggle">
      <button type="button" class="watch-together-mode-btn${defaultMode === 'watched' ? ' active' : ''}" data-mode="watched" onclick="setWatchTogetherMode('watched')">Watched together</button>
      <button type="button" class="watch-together-mode-btn${defaultMode === 'planned' ? ' active' : ''}" data-mode="planned" onclick="setWatchTogetherMode('planned')">Plan together</button>
    </div>
    <div class="watch-together-selected" id="watch-together-selected"></div>
    <input id="watch-together-search-input" class="watch-together-search" type="text" placeholder="Search anyone by username..." oninput="queueWatchTogetherSearch(this.value)">
    <div class="watch-together-search-results" id="watch-together-search-results"><div class="watch-together-empty">Type at least 2 letters to tag anyone by username.</div></div>
    <button id="watch-together-save-btn" class="watch-together-save" type="button" disabled onclick="createWatchTogetherRequest()">Send approval request</button>
  </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWatchTogetherModal(); });
  document.body.appendChild(overlay);
  renderWatchTogetherSelected();
  setTimeout(() => document.getElementById('watch-together-search-input')?.focus(), 80);
}

async function createWatchTogetherRequest() {
  if (!currentUser || !watchTogetherTagContext || !watchTogetherSelectedUsers.length) return;
  const btn = document.getElementById('watch-together-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  const selected = watchTogetherSelectedUsers.slice();
  const seed = watchTogetherTagContext.seed;
  const mode = watchTogetherTagContext.mode === 'planned' ? 'planned' : 'watched';
  const ownerProfile = {
    uid: currentUser.uid,
    name: userProfile?.name || currentUser.displayName || 'User',
    photo: userProfile?.photo || currentUser.photoURL || ''
  };
  const profiles = { [currentUser.uid]: { name: ownerProfile.name, photo: ownerProfile.photo } };
  selected.forEach(user => { profiles[user.uid] = { name: user.name || 'User', photo: user.photo || '' }; });
  const pendingUids = selected.map(user => user.uid);
  const participantUids = [currentUser.uid, ...pendingUids.filter(uid => uid !== currentUser.uid)];
  try {
    const groupId = createWatchTogetherGroupId();
    const baseGroupData = {
      id: groupId,
      ...seed,
      mode,
      ownerUid: currentUser.uid,
      participantUids,
      approvedUids: [currentUser.uid],
      pendingUids,
      rejectedUids: [],
      profiles,
      status: 'pending',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now()
    };
    const mirrorPayload = getWatchTogetherMirrorPayload(baseGroupData, groupId);
    await Promise.all([
      setWatchTogetherRequestMirror(currentUser.uid, 'outgoing', groupId, mirrorPayload),
      ...pendingUids.map(uid => setWatchTogetherRequestMirror(uid, 'incoming', groupId, mirrorPayload))
    ]);
    watchTogetherOutgoingRequestIds = [...new Set([...watchTogetherOutgoingRequestIds, groupId])];
    watchTogetherOutgoingRequestPayloadMap[groupId] = mirrorPayload;
    watchTogetherGroups = mergeWatchTogetherGroupsById(watchTogetherGroups, [mirrorPayload]);
    watchTogetherOutgoingRequests = mergeWatchTogetherGroupsById(watchTogetherOutgoingRequests, [mirrorPayload]);
    updateRequestsBadges();
    render();
    const refreshInfoContext = document.getElementById('watch-together-info-overlay')
      ? { itemId: watchTogetherTagContext.itemId, section: watchTogetherTagContext.section }
      : null;
    if (refreshInfoContext) {
      closeWatchTogetherInfoModal();
      setTimeout(() => openWatchTogetherInfoModal(null, refreshInfoContext.itemId, refreshInfoContext.section), 40);
    } else {
      closeWatchTogetherModal();
    }
    showToast('Approval request sent');
  } catch (e) {
    console.error('Create watch together request failed:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Send approval request'; }
    showToast('Could not send request. Try again.');
  }
}

function getWatchTogetherRequestTitle(group = {}) {
  const mode = group.mode === 'planned' ? 'plans to watch' : 'watched';
  return `${mode} ${group.title || 'this title'} together`;
}

function renderWatchTogetherRequestCards(groups = [], type = 'incoming') {
  if (!groups.length) return '';
  const isIncoming = type === 'incoming';
  return `<div class="friend-watch-request-list ${isIncoming ? 'incoming' : 'outgoing'}">${groups.map(group => {
    const owner = getWatchTogetherProfile(group.ownerUid, group);
    const section = group.section || group.librarySection || group.mediaCategory || '';
    const sectionLabel = getSectionLabel(section, true) || 'Title';
    const modeLabel = group.mode === 'planned' ? 'Plan Together' : 'Watched Together';
    const modeVerb = group.mode === 'planned' ? 'plan to watch' : 'watched';
    const title = group.title || 'Untitled';
    const ownerAvatar = getWatchTogetherAvatar(owner);
    const pendingUids = Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [];
    const pendingUsers = pendingUids.map(uid => getWatchTogetherProfile(uid, group));
    const approvedUids = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
    const approvedUsers = approvedUids.filter(uid => uid !== currentUser?.uid).map(uid => getWatchTogetherProfile(uid, group));
    const targetUsers = isIncoming ? [owner] : pendingUsers;
    const visibleUsers = targetUsers.slice(0, 4);
    const targetStack = visibleUsers.length ? `<div class="friend-watch-request-people-stack">${visibleUsers.map(user => `<img src="${escAttr(getWatchTogetherAvatar(user))}" alt="${escAttr(user.name || 'User')}" loading="lazy">`).join('')}${targetUsers.length > 4 ? `<span>+${targetUsers.length - 4}</span>` : ''}</div>` : '';
    const approvedStack = approvedUsers.length ? `<div class="friend-watch-request-approved"><span>Already joined</span><div class="friend-watch-request-people-stack mini">${approvedUsers.slice(0, 4).map(user => `<img src="${escAttr(getWatchTogetherAvatar(user))}" alt="${escAttr(user.name || 'User')}" loading="lazy">`).join('')}${approvedUsers.length > 4 ? `<span>+${approvedUsers.length - 4}</span>` : ''}</div></div>` : '';
    const summary = isIncoming
      ? `${owner.name || 'Someone'} wants to mark this as ${modeLabel.toLowerCase()} with you.`
      : (pendingUsers.length === 1
        ? `Waiting for ${pendingUsers[0].name || 'this user'} to approve.`
        : `Waiting for ${pendingUsers.length || 0} people to approve.`);
    const sentTo = !isIncoming && pendingUsers.length ? `<div class="friend-watch-request-sent-to"><span>Sent to</span>${pendingUsers.map(user => `
      <button class="friend-watch-request-person-pill" type="button" onclick="cancelWatchTogetherPendingUser('${escAttr(group.id)}','${escAttr(user.uid)}')" aria-label="Remove ${escAttr(user.name || 'user')} from this request">
        <img src="${escAttr(getWatchTogetherAvatar(user))}" alt="" loading="lazy"><strong>${renderDisplayNameHTML(user, 'User')}</strong><em>Remove</em>
      </button>`).join('')}</div>` : '';
    return `<article class="friend-watch-request-card ${isIncoming ? 'needs-approval' : 'sent-request'}">
      <div class="friend-watch-request-poster">${group.cover ? `<img src="${escAttr(group.cover)}" alt="${escAttr(title)}" loading="lazy">` : `<span>${escHtml(getSectionIcon(section))}</span>`}</div>
      <div class="friend-watch-request-body">
        <div class="friend-watch-request-kicker"><span>${escHtml(modeLabel)}</span><em>${escHtml(sectionLabel)}</em></div>
        <h4>${escHtml(title)}</h4>
        <p>${escHtml(summary)}</p>
        <div class="friend-watch-request-meta-row">
          ${targetStack}
          <strong>${isIncoming ? `From ${renderDisplayNameHTML(owner, 'User')}` : `${pendingUsers.length || 0} pending`}</strong>
        </div>
        ${approvedStack}
        ${sentTo}
      </div>
      <div class="friend-watch-request-actions">
        ${isIncoming
          ? `<button class="friend-watch-action accept" type="button" onclick="approveWatchTogetherRequest('${escAttr(group.id)}')">Accept</button><button class="friend-watch-action decline" type="button" onclick="declineWatchTogetherRequest('${escAttr(group.id)}')">Decline</button>`
          : `<button class="friend-watch-action decline" type="button" onclick="cancelWatchTogetherPendingUser('${escAttr(group.id)}')">Remove</button>`}
      </div>
    </article>`;
  }).join('')}</div>`;
}

async function ensureWatchTogetherItemInOwnList(group = {}) {
  if (!group || !canUseWatchTogetherSection(group.section)) return;
  const section = group.section;
  const list = Array.isArray(data[section]) ? data[section] : [];
  const already = list.some(item => watchTogetherGroupMatchesItem(group, item, section));
  if (already) return;
  const nextItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: group.title || 'Untitled',
    cover: group.cover || '',
    genre: group.genre || '',
    rating: 0,
    status: group.mode === 'planned' ? 'planned' : 'watched',
    tmdbId: group.tmdbId || '',
    imdbId: group.imdbId || '',
    librarySection: section,
    mediaCategory: section,
    episodes: isShowSection(section) ? [] : undefined,
    addedAt: Date.now()
  };
  data[section] = [nextItem, ...list];
  await writeOwnDataDirect(data);
}

async function approveWatchTogetherRequest(groupId = '') {
  if (!currentUser || !groupId) return;
  try {
    const group = { id: groupId, ...(watchTogetherIncomingRequestPayloadMap[groupId] || {}) };
    if (!(group.pendingUids || []).includes(currentUser.uid)) return;
    await ensureWatchTogetherItemInOwnList(group);
    const pendingBefore = Array.isArray(group.pendingUids) ? group.pendingUids : [];
    const remainingPending = pendingBefore.filter(uid => uid !== currentUser.uid);
    const isLastPendingApproval = remainingPending.length === 0;
    const updatedGroup = {
      ...group,
      pendingUids: remainingPending,
      approvedUids: [...new Set([...(Array.isArray(group.approvedUids) ? group.approvedUids : []), currentUser.uid])],
      participantUids: [...new Set([...(Array.isArray(group.participantUids) ? group.participantUids : []), currentUser.uid])],
      status: isLastPendingApproval ? 'approved' : 'pending',
      updatedAtMs: Date.now()
    };
    const approvedMirrorUids = updatedGroup.approvedUids.filter(Boolean);
    await Promise.all([
      clearWatchTogetherRequestMirror(currentUser.uid, 'incoming', groupId),
      setWatchTogetherRequestMirror(group.ownerUid, 'outgoing', groupId, updatedGroup, { includeInRequestList: !isLastPendingApproval }),
      ...approvedMirrorUids.map(uid => setWatchTogetherApprovedMirror(uid, groupId, updatedGroup))
    ]);
    watchTogetherIncomingRequestIds = watchTogetherIncomingRequestIds.filter(id => id !== groupId);
    delete watchTogetherIncomingRequestPayloadMap[groupId];
    watchTogetherIncomingRequests = watchTogetherIncomingRequests.filter(group => group.id !== groupId);
    watchTogetherApprovedRequestIds = [...new Set([...watchTogetherApprovedRequestIds, groupId])];
    watchTogetherApprovedRequestPayloadMap[groupId] = getWatchTogetherMirrorPayload(updatedGroup, groupId);
    if (isLastPendingApproval) {
      watchTogetherOutgoingRequestIds = watchTogetherOutgoingRequestIds.filter(id => id !== groupId);
      watchTogetherOutgoingRequests = watchTogetherOutgoingRequests.filter(group => group.id !== groupId);
    }
    watchTogetherGroups = mergeWatchTogetherGroupsById(watchTogetherGroups, [updatedGroup]);
    showToast('Shared Watch approved');
    if (activeFriendsTab === 'requests') renderRequestsList(true);
    if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
    render();
  } catch (e) {
    console.error('Approve watch together failed:', e);
    showToast('Could not approve. Try again.');
  }
}

async function declineWatchTogetherRequest(groupId = '') {
  if (!currentUser || !groupId) return;
  try {
    const group = { id: groupId, ...(watchTogetherIncomingRequestPayloadMap[groupId] || {}) };
    const pendingBefore = Array.isArray(group.pendingUids) ? group.pendingUids : [];
    const remainingPending = pendingBefore.filter(uid => uid !== currentUser.uid);
    const isLastPendingResponse = remainingPending.length === 0;
    const updatedGroup = {
      ...group,
      pendingUids: remainingPending,
      participantUids: (Array.isArray(group.participantUids) ? group.participantUids : []).filter(uid => uid !== currentUser.uid),
      rejectedUids: [...new Set([...(Array.isArray(group.rejectedUids) ? group.rejectedUids : []), currentUser.uid])],
      status: isLastPendingResponse ? ((Array.isArray(group.approvedUids) && group.approvedUids.length > 1) ? 'approved' : 'declined') : 'pending',
      updatedAtMs: Date.now()
    };
    await Promise.all([
      clearWatchTogetherRequestMirror(currentUser.uid, 'incoming', groupId),
      setWatchTogetherRequestMirror(group.ownerUid, 'outgoing', groupId, updatedGroup, { includeInRequestList: !isLastPendingResponse }),
      ...(Array.isArray(updatedGroup.approvedUids) ? updatedGroup.approvedUids : []).filter(Boolean).map(uid => setWatchTogetherApprovedMirror(uid, groupId, updatedGroup))
    ]);
    watchTogetherIncomingRequestIds = watchTogetherIncomingRequestIds.filter(id => id !== groupId);
    delete watchTogetherIncomingRequestPayloadMap[groupId];
    watchTogetherIncomingRequests = watchTogetherIncomingRequests.filter(group => group.id !== groupId);
    watchTogetherGroups = mergeWatchTogetherGroupsById(watchTogetherGroups, [updatedGroup]);
    showToast('Shared Watch declined');
    if (activeFriendsTab === 'requests') renderRequestsList(true);
    if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
  } catch (e) {
    console.error('Decline watch together failed:', e);
    showToast('Could not decline. Try again.');
  }
}

async function cancelWatchTogetherPendingUser(groupId = '', targetUid = '') {
  if (!currentUser || !groupId) return;
  try {
    const group = { id: groupId, ...(watchTogetherOutgoingRequestPayloadMap[groupId] || watchTogetherApprovedRequestPayloadMap[groupId] || {}) };
    if (group.ownerUid !== currentUser.uid) return;
    const pendingUids = Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [];
    const targets = (targetUid ? [targetUid] : pendingUids).filter(uid => pendingUids.includes(uid));
    if (!targets.length) return;
    const remainingPending = pendingUids.filter(uid => !targets.includes(uid));
    const approvedUids = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
    const nextStatus = remainingPending.length ? 'pending' : (approvedUids.length > 1 ? 'approved' : 'cancelled');
    const updatedGroup = {
      ...group,
      pendingUids: remainingPending,
      participantUids: (Array.isArray(group.participantUids) ? group.participantUids : []).filter(uid => !targets.includes(uid)),
      status: nextStatus,
      updatedAtMs: Date.now()
    };
    const writes = [
      ...targets.map(uid => clearWatchTogetherRequestMirror(uid, 'incoming', groupId))
    ];
    if (!remainingPending.length && approvedUids.length <= 1) {
      writes.push(clearWatchTogetherRequestMirror(currentUser.uid, 'outgoing', groupId));
      writes.push(clearWatchTogetherApprovedMirror(currentUser.uid, groupId));
    } else {
      writes.push(setWatchTogetherRequestMirror(currentUser.uid, 'outgoing', groupId, updatedGroup, { includeInRequestList: remainingPending.length > 0 }));
      if (approvedUids.length > 1) {
        writes.push(...approvedUids.map(uid => setWatchTogetherApprovedMirror(uid, groupId, updatedGroup)));
      }
    }
    await Promise.all(writes);
    const updateGroup = original => original && original.id === groupId
      ? { ...original, pendingUids: remainingPending, participantUids: (original.participantUids || []).filter(uid => !targets.includes(uid)), status: nextStatus }
      : original;
    watchTogetherGroups = watchTogetherGroups.map(updateGroup).filter(g => g && (g.id !== groupId || nextStatus !== 'cancelled'));
    watchTogetherOutgoingRequests = watchTogetherOutgoingRequests.map(updateGroup).filter(g => g && (g.pendingUids || []).length);
    if (!remainingPending.length) {
      watchTogetherOutgoingRequestIds = watchTogetherOutgoingRequestIds.filter(id => id !== groupId);
      if (approvedUids.length <= 1) delete watchTogetherOutgoingRequestPayloadMap[groupId];
      else watchTogetherOutgoingRequestPayloadMap[groupId] = getWatchTogetherMirrorPayload(updatedGroup, groupId);
    } else {
      watchTogetherOutgoingRequestPayloadMap[groupId] = getWatchTogetherMirrorPayload(updatedGroup, groupId);
    }
    showToast(targets.length === 1 ? 'Removed Shared Watch request' : 'Removed pending Shared Watch requests');
    if (activeFriendsTab === 'requests') renderRequestsList(true);
    if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
    render();
    const overlay = document.getElementById('watch-together-info-overlay');
    const refreshItemId = overlay?.dataset.itemId || '';
    const refreshSection = overlay?.dataset.section || activeSection;
    if (overlay && refreshItemId) {
      closeWatchTogetherInfoModal();
      setTimeout(() => openWatchTogetherInfoModal(null, refreshItemId, refreshSection), 40);
    }
  } catch (e) {
    console.error('Cancel watch together request failed:', e);
    showToast('Could not remove request. Try again.');
  }
}



async function removeWatchTogetherMember(groupId = '', targetUid = '') {
  if (!currentUser || !groupId || !targetUid || targetUid === currentUser.uid) return;
  try {
    const group = getWatchTogetherGroupById(groupId);
    if (!group || group.ownerUid !== currentUser.uid) return;
    const pendingUids = Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [];
    if (pendingUids.includes(targetUid)) {
      await cancelWatchTogetherPendingUser(groupId, targetUid);
      return;
    }
    const approvedUids = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
    if (!approvedUids.includes(targetUid)) return;

    const remainingApproved = approvedUids.filter(uid => uid !== targetUid);
    const remainingPending = pendingUids.filter(uid => uid !== targetUid);
    const hasApprovedPartner = remainingApproved.some(uid => uid && uid !== currentUser.uid);
    const nextStatus = remainingPending.length ? 'pending' : (hasApprovedPartner ? 'approved' : 'cancelled');
    const updatedGroup = {
      ...group,
      approvedUids: remainingApproved,
      pendingUids: remainingPending,
      participantUids: (Array.isArray(group.participantUids) ? group.participantUids : []).filter(uid => uid !== targetUid),
      status: nextStatus,
      updatedAtMs: Date.now()
    };

    const writes = [
      clearWatchTogetherRequestMirror(targetUid, 'incoming', groupId),
      clearWatchTogetherRequestMirror(targetUid, 'outgoing', groupId),
      clearWatchTogetherApprovedMirror(targetUid, groupId)
    ];

    if (nextStatus === 'cancelled') {
      writes.push(clearWatchTogetherRequestMirror(currentUser.uid, 'outgoing', groupId));
      writes.push(clearWatchTogetherApprovedMirror(currentUser.uid, groupId));
    } else {
      if (remainingPending.length) {
        writes.push(setWatchTogetherRequestMirror(currentUser.uid, 'outgoing', groupId, updatedGroup, { includeInRequestList: true }));
        writes.push(...remainingPending.map(uid => setWatchTogetherRequestMirror(uid, 'incoming', groupId, updatedGroup)));
      } else {
        writes.push(clearWatchTogetherRequestMirror(currentUser.uid, 'outgoing', groupId));
      }
      writes.push(...remainingApproved.map(uid => setWatchTogetherApprovedMirror(uid, groupId, updatedGroup)));
    }

    await Promise.all(writes);

    const updateLocalGroup = original => original && original.id === groupId ? updatedGroup : original;
    watchTogetherGroups = watchTogetherGroups.map(updateLocalGroup).filter(g => g && (g.id !== groupId || nextStatus !== 'cancelled'));
    watchTogetherOutgoingRequests = watchTogetherOutgoingRequests.map(updateLocalGroup).filter(g => g && (g.pendingUids || []).length);
    watchTogetherIncomingRequests = watchTogetherIncomingRequests.filter(g => g.id !== groupId || (g.pendingUids || []).includes(currentUser.uid));
    if (nextStatus === 'cancelled') {
      watchTogetherOutgoingRequestIds = watchTogetherOutgoingRequestIds.filter(id => id !== groupId);
      watchTogetherApprovedRequestIds = watchTogetherApprovedRequestIds.filter(id => id !== groupId);
      delete watchTogetherOutgoingRequestPayloadMap[groupId];
      delete watchTogetherApprovedRequestPayloadMap[groupId];
    } else {
      if (remainingPending.length) {
        watchTogetherOutgoingRequestIds = [...new Set([...watchTogetherOutgoingRequestIds, groupId])];
        watchTogetherOutgoingRequestPayloadMap[groupId] = getWatchTogetherMirrorPayload(updatedGroup, groupId);
      } else {
        watchTogetherOutgoingRequestIds = watchTogetherOutgoingRequestIds.filter(id => id !== groupId);
        delete watchTogetherOutgoingRequestPayloadMap[groupId];
      }
      watchTogetherApprovedRequestIds = [...new Set([...watchTogetherApprovedRequestIds, groupId])];
      watchTogetherApprovedRequestPayloadMap[groupId] = getWatchTogetherMirrorPayload(updatedGroup, groupId);
    }

    watchTogetherAverageCache = {};
    updateRequestsBadges();
    render();
    const overlay = document.getElementById('watch-together-info-overlay');
    const refreshItemId = overlay?.dataset.itemId || '';
    const refreshSection = overlay?.dataset.section || activeSection;
    if (overlay && refreshItemId) {
      closeWatchTogetherInfoModal();
      setTimeout(() => openWatchTogetherInfoModal(null, refreshItemId, refreshSection), 40);
    }
    if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
    showToast('Removed from Shared Watch');
  } catch (e) {
    console.error('Remove watch together member failed:', e);
    showToast('Could not remove. Try again.');
  }
}

async function openWatchTogetherInfoModal(event, itemId = '', section = activeSection) {
  event?.stopPropagation?.();
  const item = findListItemById(section, itemId);
  if (!item) return;
  const ownerUid = getWatchTogetherOwnerUid();
  const groups = getWatchTogetherGroupsForItem(item, section, ownerUid);
  const membersByUid = new Map();
  const isOwnPrivateCard = !viewingUser && currentUser?.uid && ownerUid === currentUser.uid;
  groups.forEach(group => {
    const approved = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
    const pending = Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [];
    approved.forEach(uid => {
      if (!membersByUid.has(uid)) membersByUid.set(uid, { ...getWatchTogetherProfile(uid, group), groupId: group.id, watchTogetherPending: false });
    });
    if (isOwnPrivateCard && group.ownerUid === currentUser.uid) {
      pending.forEach(uid => {
        if (!membersByUid.has(uid)) membersByUid.set(uid, { ...getWatchTogetherProfile(uid, group), groupId: group.id, watchTogetherPending: true });
      });
    }
  });
  const members = [...membersByUid.values()];
  if (!members.length && !isOwnPrivateCard) return;
  if (isOwnPrivateCard) {
    const seed = buildWatchTogetherItemSeed(item, section);
    const defaultMode = item.status === 'planned' ? 'planned' : 'watched';
    watchTogetherTagContext = { itemId, section, seed, mode: defaultMode };
    watchTogetherSelectedUsers = [];
  }
  const old = document.getElementById('watch-together-info-overlay');
  if (old) old.remove();
  const title = getWatchTogetherItemTitle(item, section);
  const manageHtml = isOwnPrivateCard ? `<div class="watch-together-manage-block">
    <div class="watch-together-manage-title">Add more people</div>
    <div class="watch-together-mode-toggle">
      <button type="button" class="watch-together-mode-btn${item.status === 'planned' ? '' : ' active'}" data-mode="watched" onclick="setWatchTogetherMode('watched')">Watched together</button>
      <button type="button" class="watch-together-mode-btn${item.status === 'planned' ? ' active' : ''}" data-mode="planned" onclick="setWatchTogetherMode('planned')">Plan together</button>
    </div>
    <div class="watch-together-selected" id="watch-together-selected"></div>
    <input id="watch-together-search-input" class="watch-together-search" type="text" placeholder="Search anyone by username..." oninput="queueWatchTogetherSearch(this.value)">
    <div class="watch-together-search-results" id="watch-together-search-results"><div class="watch-together-empty">Type at least 2 letters to tag anyone by username.</div></div>
    <button id="watch-together-save-btn" class="watch-together-save" type="button" disabled onclick="createWatchTogetherRequest()">Send approval request</button>
  </div>` : '';
  const memberHtml = members.length
    ? members.map(profile => `<div class="watch-together-member-row${profile.watchTogetherPending ? ' pending' : ''}">
        <button class="watch-together-member-profile" type="button" onclick="openUserProfile('${escAttr(profile.uid)}')"><img src="${escAttr(getWatchTogetherAvatar(profile))}" alt=""><span>${renderDisplayNameHTML(profile, 'User')}</span>${profile.watchTogetherPending ? '<em>Pending</em>' : ''}</button>
        ${isOwnPrivateCard && profile.uid !== currentUser?.uid ? `<button class="watch-together-member-remove" type="button" onclick="removeWatchTogetherMember('${escAttr(profile.groupId)}','${escAttr(profile.uid)}')" aria-label="Remove ${escAttr(profile.name || 'user')}">Remove</button>` : ''}
      </div>`).join('')
    : '<div class="watch-together-empty">No one added yet.</div>';
  const overlay = document.createElement('div');
  overlay.id = 'watch-together-info-overlay';
  overlay.className = 'watch-together-modal-overlay watch-together-info-overlay';
  overlay.dataset.itemId = itemId;
  overlay.dataset.section = section;
  overlay.innerHTML = `<div class="watch-together-info-modal" role="dialog" aria-modal="true" aria-label="People tagged on ${escAttr(title)}">
    <div class="watch-together-modal-head">
      <div><div class="watch-together-kicker">Watched Together</div><h3>${escHtml(title)}</h3><p id="watch-together-average">Average rating: loading...</p></div>
      <button type="button" class="watch-together-close" onclick="closeWatchTogetherInfoModal()" aria-label="Close">×</button>
    </div>
    <div class="watch-together-member-list">${memberHtml}</div>
    ${manageHtml}
  </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWatchTogetherInfoModal(); });
  document.body.appendChild(overlay);
  if (isOwnPrivateCard) renderWatchTogetherSelected();
  const avgEl = document.getElementById('watch-together-average');
  const average = await calculateWatchTogetherAverageRating(members.map(m => m.uid), item, section);
  if (avgEl) avgEl.textContent = average;
}

async function calculateWatchTogetherAverageRating(uids = [], item = {}, section = activeSection) {
  const seed = buildWatchTogetherItemSeed(item, section);
  const cacheKey = `${section}|${seed.mediaKey}|${seed.titleKey}|${uids.slice().sort().join(',')}`;
  if (watchTogetherAverageCache[cacheKey]) return watchTogetherAverageCache[cacheKey];
  try {
    const docs = await Promise.all(uids.map(uid => db.collection('watchlist').doc(uid).get().catch(() => null)));
    const ratings = [];
    docs.forEach(doc => {
      if (!doc || !doc.exists) return;
      const d = doc.data() || {};
      let list = [];
      try { list = d[section] ? JSON.parse(d[section]) : []; } catch (e) { list = []; }
      const match = (Array.isArray(list) ? list : []).find(row => {
        const rowSeed = buildWatchTogetherItemSeed(row, section);
        return (seed.mediaKey && rowSeed.mediaKey && seed.mediaKey === rowSeed.mediaKey) || (seed.titleKey && seed.titleKey === rowSeed.titleKey);
      });
      const rating = Number(match?.rating || 0);
      if (rating > 0) ratings.push(rating);
    });
    const label = ratings.length
      ? `Average rating: ⭐ ${formatRatingValueForSection(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length, section, false)} · ${ratings.length}/${uids.length} rated`
      : `Average rating: no ratings yet`;
    watchTogetherAverageCache[cacheKey] = label;
    return label;
  } catch (e) {
    console.error('Average Watch Together rating failed:', e);
    return 'Average rating unavailable';
  }
}

function applyWatchTogetherSnapshot(groups = []) {
  watchTogetherGroups = mergeWatchTogetherGroupsById(groups, watchTogetherGroups);
  const incomingFromSnapshot = currentUser ? groups.filter(group => (group.pendingUids || []).includes(currentUser.uid)) : [];
  const outgoingFromSnapshot = currentUser ? groups.filter(group => group.ownerUid === currentUser.uid && (group.pendingUids || []).length) : [];
  watchTogetherIncomingRequests = mergeWatchTogetherGroupsById(incomingFromSnapshot, watchTogetherIncomingRequests)
    .filter(group => (group.pendingUids || []).includes(currentUser.uid));
  watchTogetherOutgoingRequests = mergeWatchTogetherGroupsById(outgoingFromSnapshot, watchTogetherOutgoingRequests)
    .filter(group => group.ownerUid === currentUser.uid && (group.pendingUids || []).length);
  watchTogetherAverageCache = {};
  updateRequestsBadges();
  const communityActive = document.getElementById('nav-community')?.classList.contains('active');
  if (communityActive && activeFriendsTab === 'requests') renderRequestsList(true);
  if (communityActive && activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
  render();
}

function startWatchTogetherListener() {
  // Shared Watch is driven by the live users/{uid} listener so requests do not depend
  // on a separate collection that can be blocked by Firestore rules.
  watchTogetherUnsubscribe = null;
}

async function loadWatchTogetherGroupsForOwner(uid = '') {
  const ownerUid = String(uid || '').trim();
  if (!ownerUid) return;
  try {
    const doc = await db.collection('users').doc(ownerUid).get();
    const raw = doc.exists ? (doc.data() || {}) : {};
    const approvedMap = normalizeWatchTogetherRequestPayloadMap(raw.watchTogetherApprovedGroupMap);
    const outgoingMap = normalizeWatchTogetherRequestPayloadMap(raw.watchTogetherOutgoingRequestMap);
    const groups = [...Object.values(approvedMap), ...Object.values(outgoingMap)].filter(group => {
      const approved = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
      return group.ownerUid === ownerUid && approved.some(approvedUid => approvedUid !== ownerUid);
    });
    if (groups.length) {
      watchTogetherGroups = mergeWatchTogetherGroupsById(watchTogetherGroups, groups);
      watchTogetherAverageCache = {};
    }
  } catch (error) {
    console.error('Shared Watch owner groups failed:', error);
  }
}

function stopWatchTogetherListener() {
  if (watchTogetherUnsubscribe) {
    watchTogetherUnsubscribe();
    watchTogetherUnsubscribe = null;
  }
  watchTogetherGroups = [];
  watchTogetherIncomingRequests = [];
  watchTogetherOutgoingRequests = [];
  watchTogetherIncomingRequestIds = [];
  watchTogetherOutgoingRequestIds = [];
  watchTogetherIncomingRequestPayloadMap = {};
  watchTogetherOutgoingRequestPayloadMap = {};
  watchTogetherApprovedRequestIds = [];
  watchTogetherApprovedRequestPayloadMap = {};
  watchTogetherMirrorHydratePromise = null;
  watchTogetherAverageCache = {};
}
