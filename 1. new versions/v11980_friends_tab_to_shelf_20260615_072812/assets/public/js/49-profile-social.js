/*
   49-profile-social.js
   Extracted from 15-profile-settings.js to keep surface ownership explicit.
*/

function getProfileSocialIds(kind) {
  if (isPreviewMode()) {
    return PREVIEW_COMMUNITY_USERS
      .filter(user => user.uid !== (profileViewingUser?.uid || 'preview-user'))
      .map(user => user.uid);
  }
  const profile = getActiveProfile() || {};
  const ids = new Set();
  hydrateDerivedFollowerIdsForProfile(profile);
  const addIds = list => {
    if (!Array.isArray(list)) return;
    list.forEach(uid => {
      if (uid) ids.add(uid);
    });
  };

  /* v11438: This is a MUTUAL-friendship app — the only relationship the app
     actually maintains is the confirmed `friends` list, and "Followers" /
     "Following" are just Instagram-style presentations of that same mutual set
     (the code already folded `friends` into both). The legacy follow arrays
     (following / followingIds / follows / outgoingFollowing / followers /
     followerIds / followedBy / incomingFollowers) are NOT written by any current
     code path, and were the ONLY place a still-pending "requested to follow"
     entry could live — exactly what was leaking into a viewed user's public
     Following list (v11.207 + v11434 only stripped outgoingRequests, which the
     leaked entries were NOT in). Build BOTH lists from confirmed friends only,
     then defensively strip any pending uids. You can never see who someone is
     merely requesting to follow. (`kind` kept for API symmetry + mutual calc.) */
  if (kind === 'followers') {
    addIds(profile.acceptedFollowerRequests);
    if (!isViewingOtherProfile() && typeof ownAcceptedFollowerRequestIds !== 'undefined') addIds(ownAcceptedFollowerRequestIds);
    addFollowerIdsForProfile(ids, profile, !isViewingOtherProfile());
  } else if (kind === 'following') {
    addIds(profile.friends);
    if (!isViewingOtherProfile()) addIds(friends);
    addFollowingIdsForProfile(ids, profile, !isViewingOtherProfile());
  } else {
    const following = new Set();
    const followers = new Set();
    const addTo = (set, list) => {
      if (!Array.isArray(list)) return;
      list.forEach(uid => { if (uid) set.add(uid); });
    };
    addTo(following, profile.friends);
    addTo(followers, profile.acceptedFollowerRequests);
    if (!isViewingOtherProfile()) {
      addTo(following, friends);
      if (typeof ownAcceptedFollowerRequestIds !== 'undefined') addTo(followers, ownAcceptedFollowerRequestIds);
    }
    addFollowingIdsForProfile(following, profile, !isViewingOtherProfile());
    addFollowerIdsForProfile(followers, profile, !isViewingOtherProfile());
    following.forEach(uid => { if (followers.has(uid)) ids.add(uid); });
  }
  excludePendingSocialIds(ids, profile);
  ids.delete(profile.uid);
  ids.delete(currentUser?.uid === profile.uid ? currentUser.uid : '');
  return [...ids];
}

/* v11378: pure social-id resolver for ANY profile object (not the active-state
   one). Mirrors the field set in getProfileSocialIds so counts shown on the
   friend-shelf banner match the followers/following page exactly. */
function getSocialIdsForProfile(profile, kind) {
  profile = profile || {};
  const ids = new Set();
  hydrateDerivedFollowerIdsForProfile(profile);
  const add = list => { if (Array.isArray(list)) list.forEach(uid => { if (uid) ids.add(uid); }); };
  /* v11438: confirmed friends only (see getProfileSocialIds). Fold in the
     reconciled `friends` global for my OWN profile so my header counts stay
     accurate even if userProfile.friends lags the live state. */
  if (kind === 'followers') {
    add(profile.acceptedFollowerRequests);
    if (currentUser && profile.uid === currentUser.uid && typeof ownAcceptedFollowerRequestIds !== 'undefined') add(ownAcceptedFollowerRequestIds);
    addFollowerIdsForProfile(ids, profile, currentUser && profile.uid === currentUser.uid);
  } else if (kind === 'following') {
    add(profile.friends);
    if (currentUser && profile.uid === currentUser.uid && typeof friends !== 'undefined' && Array.isArray(friends)) add(friends);
    addFollowingIdsForProfile(ids, profile, currentUser && profile.uid === currentUser.uid);
  } else {
    const following = new Set();
    const followers = new Set();
    const addTo = (set, list) => { if (Array.isArray(list)) list.forEach(uid => { if (uid) set.add(uid); }); };
    addTo(following, profile.friends);
    addTo(followers, profile.acceptedFollowerRequests);
    if (currentUser && profile.uid === currentUser.uid) {
      if (typeof friends !== 'undefined' && Array.isArray(friends)) addTo(following, friends);
      if (typeof ownAcceptedFollowerRequestIds !== 'undefined') addTo(followers, ownAcceptedFollowerRequestIds);
    }
    addFollowingIdsForProfile(following, profile, currentUser && profile.uid === currentUser.uid);
    addFollowerIdsForProfile(followers, profile, currentUser && profile.uid === currentUser.uid);
    following.forEach(uid => { if (followers.has(uid)) ids.add(uid); });
  }
  excludePendingSocialIds(ids, profile);
  ids.delete(profile.uid);
  return [...ids];
}

/* v11378: open the followers/following/mutual page for a user whose shelf you're
   viewing (the counts under their banner name are tappable). Sets the profile
   viewing context so the social page reads the right user's arrays + @handle. */
function openShelfUserSocialPage(uid, kind) {
  const u = String(uid || '').trim();
  if (!u) return;
  let src = null;
  if (typeof viewingUser === 'object' && viewingUser && String(viewingUser.uid) === u) src = viewingUser;
  else if (typeof usersMap === 'object' && usersMap && usersMap[u]) src = usersMap[u];
  src = src || { uid: u };
  profileViewingUser = { uid: u, name: src.name || src.displayName || 'Friend', photo: src.photo || '' };
  profileViewingProfile = normalizeUserProfile({ ...src, uid: u });
  openProfileSocialModal(kind);
}

function renderProfileSocialCounts() {
  const host = document.querySelector('.profile-main-fields');
  if (!host) return;
  let row = document.getElementById('profile-social-counts');
  if (!row) {
    row = document.createElement('div');
    row.id = 'profile-social-counts';
    row.className = 'profile-social-counts';
    const bio = document.getElementById('profile-bio');
    if (bio?.parentElement === host) bio.insertAdjacentElement('afterend', row);
    else host.appendChild(row);
  }
  const followingCount = getProfileSocialIds('following').length;
  const followersCount = getProfileSocialIds('followers').length;
  /* v11.208: order is Followers (left) → Following (right) per request. */
  row.innerHTML = `
    <button type="button" class="profile-social-count" onclick="openProfileSocialModal('followers')">
      <strong>${followersCount.toLocaleString('en-US')}</strong>
      <span>Followers</span>
    </button>
    <button type="button" class="profile-social-count" onclick="openProfileSocialModal('following')">
      <strong>${followingCount.toLocaleString('en-US')}</strong>
      <span>Following</span>
    </button>
  `;
}

/* ===========================================================================
   v11367 — Followers / Following / Mutual as a FULL PAGE (Instagram-style).
   Replaces the old bottom sheet. Header = back chevron + the viewed user's
   @handle. Three tabs: mutual | followers | following. Each row = avatar +
   @username + display name, with a single Follow / Following button on the
   right; tapping the name/avatar opens that user's profile.
   =========================================================================== */
function getProfileMutualIds() {
  /* mutual = people connected to this profile (its followers ∪ following) that
     YOU also follow (your confirmed friends). */
  const union = new Set([...getProfileSocialIds('followers'), ...getProfileSocialIds('following')]);
  const mine = new Set(Array.isArray(friends) ? friends : []);
  const out = [];
  union.forEach(uid => { if (uid && mine.has(uid)) out.push(uid); });
  return out;
}
function getProfileSocialIdsForTab(kind) {
  return kind === 'mutual' ? getProfileMutualIds() : getProfileSocialIds(kind);
}
function normalizeProfileSocialTab(kind) {
  return (kind === 'mutual' || kind === 'followers' || kind === 'following') ? kind : 'followers';
}
function getProfileSocialUserHandle(user) {
  return String(
    user?.usernameHandle || user?.userHandle || user?.handle || user?.username ||
    user?.usernameHandleLower || user?.handleLower || user?.usernameLower || ''
  ).trim().replace(/^@+/, '');
}
function getProfileSocialTitleHandle() {
  const p = getActiveProfile() || {};
  const u = profileViewingUser || {};
  const h = getProfileSocialUserHandle(p) || getProfileSocialUserHandle(u);
  return h ? ('@' + h) : (p.name || u.name || 'Profile');
}

async function getProfileSocialUsers(kind) {
  const ids = getProfileSocialIdsForTab(kind);
  if (!ids.length) return [];
  if (isPreviewMode()) {
    return ids.map(uid => getPreviewCommunityUser(uid)).filter(Boolean);
  }
  const rows = await Promise.all(ids.map(async uid => {
    if (usersMap[uid]?.name) return usersMap[uid];
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap.exists) return null;
      const user = { ...(snap.data() || {}), uid };
      usersMap[uid] = user;
      return user;
    } catch(e) {
      console.error('Profile social user load failed:', e);
      return usersMap[uid] || null;
    }
  }));
  return rows.filter(Boolean);
}

/* v11379: restore the underlying page scroll that was locked while the social
   page was open (see openProfileSocialModal). */
function restoreProfileSocialPageScroll(modal) {
  if (!modal) return;
  document.body.style.overflow = modal.dataset.prevBodyOverflow || '';
  document.documentElement.style.overflow = modal.dataset.prevHtmlOverflow || '';
}

function closeProfileSocialModal() {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  restoreProfileSocialPageScroll(modal);
  modal.classList.remove('profile-social-page-open');
  setTimeout(() => modal.remove(), 300);
}

async function openProfileSocialAddFriendPage() {
  const modal = document.getElementById('profile-social-modal');
  if (modal) {
    restoreProfileSocialPageScroll(modal);
    modal.remove();
  }
  document.body.classList.add('shelfd-friends-list-mode');
  activeFriendsTab = 'add-friend';
  const onCommunity = typeof getActiveMainTab === 'function' && getActiveMainTab() === 'community';
  if (!onCommunity && typeof switchMainNav === 'function') {
    await switchMainNav('community');
  }
  document.body.classList.add('shelfd-friends-list-mode');
  activeFriendsTab = 'add-friend';
  if (typeof switchFriendsTab === 'function') {
    switchFriendsTab('add-friend');
  }
  if (typeof persistUiState === 'function') {
    persistUiState();
  }
  const focusSearch = () => {
    const input = document.getElementById('friends-inline-search-input');
    if (!input) return;
    input.focus();
    if (typeof input.select === 'function') input.select();
  };
  requestAnimationFrame(() => window.setTimeout(focusSearch, 140));
}

function openProfileSocialUser(uid) {
  const u = String(uid || '').trim();
  closeProfileSocialModal();
  if (!u) return;
  /* v11436: tapping a name/avatar in the followers / following / mutual list
     opens that user's SHELF (My List) page — not their profile page.
     viewUserList already handles preview mode (community profile) and self
     (switches to your own My List) internally, so route everything through it. */
  if (typeof viewUserList === 'function') {
    const src = (typeof usersMap === 'object' && usersMap && usersMap[u]) ? usersMap[u] : {};
    viewUserList(u, src.name || src.displayName || '', src.photo || src.photoURL || '');
    return;
  }
  /* defensive fallback — original profile-page behavior */
  if (isPreviewMode()) { openPreviewUserProfile(u); return; }
  if (currentUser && u === currentUser.uid) { openProfile(); return; }
  openUserProfile(u);
}

/* v11381: open MY OWN followers/following/mutual page from the My List header.
   Clears any viewing context so getActiveProfile() resolves to my own profile. */
function openOwnSocialPage(kind) {
  profileViewingUser = null;
  profileViewingProfile = null;
  openProfileSocialModal(kind);
}

/* Kept for any external callers; the social rows now use the dedicated
   getProfileSocialFollowButtonHTML below. */
function getSocialRelationshipActionHTML(user) {
  if (!currentUser || !user?.uid || user.uid === currentUser.uid || isPreviewMode()) return '';
  const uid = user.uid;
  if (friends.includes(uid)) {
    return `<button type="button" class="friend-action-btn friend-pending-btn" disabled>Following</button>`;
  }
  if (outgoingRequests.includes(uid)) {
    return `<button type="button" class="friend-action-btn friend-pending-btn" onclick="event.stopPropagation(); cancelFriendRequest('${escAttr(uid)}')" title="Tap to cancel">Requested</button>`;
  }
  return `<button type="button" class="friend-action-btn friend-add-btn" onclick="event.stopPropagation(); sendFriendRequest('${escAttr(uid)}')">+ Follow</button>`;
}

/* Single right-side Follow / Following button (IG-style). Lavender for the
   actionable states, grayish once following / requested. */
function getProfileSocialFollowButtonHTML(user) {
  if (!currentUser || !user?.uid || user.uid === currentUser.uid || isPreviewMode()) return '';
  const uid = escAttr(user.uid);
  const u = user.uid;
  /* v11435: every state routes through the single optimistic handler
     toggleProfileSocialFollow (re-derives the action from live state). Keeps
     the card button instant + double-tap safe and consistent with the banner. */
  if (friends.includes(u)) {
    return `<button type="button" class="profile-social-follow-btn is-following" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Following</button>`;
  }
  if (outgoingRequests.includes(u)) {
    return `<button type="button" class="profile-social-follow-btn is-requested" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Requested</button>`;
  }
  return `<button type="button" class="profile-social-follow-btn is-follow" onclick="event.stopPropagation(); toggleProfileSocialFollow('${uid}')">Follow</button>`;
}

/* ===========================================================================
   v11435 — Shared optimistic follow-state plumbing (Follow / Requested /
   Following). The outgoing relationship globals (friends / outgoingRequests)
   are already mutated SYNCHRONOUSLY by the action fns
   (sendFriendRequest / cancelFriendRequest / removeFriend)
   BEFORE their network await, and rolled back on failure — so the UI can reflect
   the new state instantly and self-heal once the write resolves.

   syncFollowButtonsForUid repaints EVERY visible follow button for one uid (the
   shelf/profile banner + any social-list rows) IN PLACE. Nothing re-renders, the
   list never rebuilds, and scroll position is preserved.
   =========================================================================== */
function shelfdFollowBusySet() {
  if (!window._shelfdFollowBusy) window._shelfdFollowBusy = new Set();
  return window._shelfdFollowBusy;
}
function replaceProfileSocialRowBtn(row, html) {
  if (!row) return;
  const btn = row.querySelector('.profile-social-follow-btn');
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').trim();
  const fresh = tpl.content.firstElementChild;
  if (btn) { if (fresh) btn.replaceWith(fresh); else btn.remove(); }
  else if (fresh) row.appendChild(fresh);
}
function syncProfileSocialRowButtons(modal) {
  modal = modal || document.getElementById('profile-social-modal');
  if (!modal) return;
  modal.querySelectorAll('.profile-social-row[data-uid]').forEach(row => {
    const uid = row.getAttribute('data-uid');
    if (!uid) return;
    /* v11.977: followers-tab rows (own profile) carry a Remove button, not a
       follow button — don't inject a follow button into them. */
    if (row.querySelector('.profile-social-remove-btn')) return;
    const user = (typeof usersMap === 'object' && usersMap && usersMap[uid]) ? usersMap[uid] : { uid };
    replaceProfileSocialRowBtn(row, getProfileSocialFollowButtonHTML(user));
  });
}
function syncFollowButtonsForUid(uid) {
  const u = String(uid || '').trim();
  if (!u) return;
  /* shelf / profile viewing-banner button (16-friends-requests.js) */
  if (typeof refreshFriendListFollowButton === 'function') refreshFriendListFollowButton(u);
  if (typeof refreshPeopleSearchFollowButton === 'function') refreshPeopleSearchFollowButton(u);
  /* v11.847: inline "Follow back" row button on the Friends list (after Accept) */
  if (typeof refreshInlineFollowBackButton === 'function') refreshInlineFollowBackButton(u);
  /* v11.972: friend-request notification card action slot (Follow → Requested) */
  if (typeof refreshNotifFriendRequestActions === 'function') refreshNotifFriendRequestActions(u);
  /* social-list rows — in place, no panel rebuild, scroll preserved */
  const modal = document.getElementById('profile-social-modal');
  if (modal) {
    modal.querySelectorAll('.profile-social-row[data-uid]').forEach(row => {
      if (row.getAttribute('data-uid') !== u) return;
      if (row.querySelector('.profile-social-remove-btn')) return;
      const user = (typeof usersMap === 'object' && usersMap && usersMap[u]) ? usersMap[u] : { uid: u };
      replaceProfileSocialRowBtn(row, getProfileSocialFollowButtonHTML(user));
    });
  }
}
/* Centralized tap handler for the social-list row Follow buttons. Optimistic,
   double-tap safe, and reconciles after the backend resolves — including the
   failure case, because the action fn rolls the globals back and we always
   repaint from the live globals. */
async function toggleProfileSocialFollow(uid) {
  const u = String(uid || '').trim();
  if (!u || !currentUser || u === currentUser.uid) return;
  if (typeof isPreviewMode === 'function' && isPreviewMode()) return;
  const busy = shelfdFollowBusySet();
  if (busy.has(u)) return;        // race / double-tap guard
  busy.add(u);
  let action = null;
  if (friends.includes(u)) action = (typeof removeFriend === 'function') ? removeFriend : null;
  else if (outgoingRequests.includes(u)) action = (typeof cancelFriendRequest === 'function') ? cancelFriendRequest : null;
  else action = (typeof sendFriendRequest === 'function') ? sendFriendRequest : null;
  let p = Promise.resolve();
  try { if (action) p = action(u) || Promise.resolve(); } catch (e) { p = Promise.reject(e); }
  /* action mutated the relationship globals synchronously → paint immediately */
  syncFollowButtonsForUid(u);
  try { await p; } catch (e) { console.warn('toggleProfileSocialFollow failed:', e); }
  busy.delete(u);
  /* reconcile against the confirmed (or rolled-back) state — no flicker */
  syncFollowButtonsForUid(u);
}

function renderProfileSocialLoadingState() {
  return `<div class="profile-social-state-card">
    <div class="profile-social-state-spinner" aria-hidden="true"></div>
    <p>Loading…</p>
  </div>`;
}

function renderProfileSocialEmptyState(kind) {
  const label = kind === 'mutual' ? 'mutual connections' : kind === 'followers' ? 'followers' : 'following';
  return `<div class="profile-social-state-card profile-social-state-empty">
    <p>No ${escHtml(label)} yet</p>
  </div>`;
}

function renderProfileSocialUserRow(user, kind = '') {
  const name = user?.name || user?.displayName || 'ScreenList User';
  const photo = user?.photo || user?.photoURL || getProfileFallbackPhotoFor({ name });
  if (user?.uid) usersMap[user.uid] = { ...(usersMap[user.uid] || {}), ...user, uid: user.uid };
  const handle = getProfileSocialUserHandle(user);
  const primary = handle || name;
  const secondary = handle ? name : '';
  const uidAttr = escAttr(user.uid);
  /* v11.977: on MY OWN Followers tab, each follower gets a "Remove" button
     (undo the Accept). Followers ARE my acceptedFollowerRequests, so removing one
     revokes their follow and a fresh request re-surfaces as Accept/Deny. Scoped to
     my own followers list only (not when viewing another user, not in preview). */
  const canRemoveFollower = kind === 'followers'
    && typeof isViewingOtherProfile === 'function' && !isViewingOtherProfile()
    && (typeof isPreviewMode !== 'function' || !isPreviewMode())
    && currentUser && user?.uid && user.uid !== currentUser.uid;
  const rightSide = canRemoveFollower
    ? `<button type="button" class="profile-social-remove-btn" onclick="event.stopPropagation(); confirmRemoveFollower('${uidAttr}')">Remove</button>`
    : getProfileSocialFollowButtonHTML(user);
  return `<div class="profile-social-row" data-uid="${uidAttr}">
    <button type="button" class="profile-social-row-main" onclick="openProfileSocialUser('${uidAttr}')">
      <img class="profile-social-avatar" src="${escAttr(photo)}" alt="" decoding="async">
      <span class="profile-social-row-copy">
        <span class="profile-social-row-name">${escHtml(primary)}</span>
        ${secondary ? `<span class="profile-social-row-sub">${escHtml(secondary)}</span>` : ''}
      </span>
    </button>
    ${rightSide}
  </div>`;
}

function updateProfileSocialTabCounts(modal) {
  if (!modal) return;
  const counts = {
    mutual: getProfileMutualIds().length,
    followers: getProfileSocialIds('followers').length,
    following: getProfileSocialIds('following').length
  };
  ['mutual', 'followers', 'following'].forEach(kind => {
    const el = modal.querySelector(`.profile-social-tab[data-kind="${kind}"] strong`);
    if (el) el.textContent = counts[kind].toLocaleString('en-US');
  });
}

const PROFILE_SOCIAL_TABS = ['mutual', 'followers', 'following'];

async function renderProfileSocialPanel(modal, kind) {
  if (!modal) return;
  const panel = modal.querySelector(`.profile-social-panel[data-kind="${kind}"]`);
  if (!panel) return;
  panel.innerHTML = renderProfileSocialLoadingState();
  const users = await getProfileSocialUsers(kind);
  const live = document.body.contains(modal) ? modal.querySelector(`.profile-social-panel[data-kind="${kind}"]`) : null;
  if (!live) return;
  if (!users.length) { live.innerHTML = renderProfileSocialEmptyState(kind); return; }
  live.innerHTML = users.map(u => renderProfileSocialUserRow(u, kind)).join('');
}

function renderAllProfileSocialPanels(modal) {
  PROFILE_SOCIAL_TABS.forEach(kind => { renderProfileSocialPanel(modal, kind); });
}

function updateProfileSocialActiveTab(modal, index) {
  if (!modal) return;
  const kind = PROFILE_SOCIAL_TABS[Math.max(0, Math.min(PROFILE_SOCIAL_TABS.length - 1, index))];
  modal.dataset.mode = kind;
  modal.querySelectorAll('.profile-social-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.kind === kind);
  });
}

function switchProfileSocialTab(kind) {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  const i = PROFILE_SOCIAL_TABS.indexOf(normalizeProfileSocialTab(kind));
  if (modal._socialPager) modal._socialPager.goTo(i, true);
  else updateProfileSocialActiveTab(modal, i);
}

async function refreshProfileSocialModal() {
  const modal = document.getElementById('profile-social-modal');
  if (!modal) return;
  updateProfileSocialTabCounts(modal);
  /* v11435: was renderAllProfileSocialPanels(modal) — a full async refetch +
     innerHTML reset that flashed "Loading…" and snapped every panel back to the
     top whenever ANY follow action fired. Now we only repaint the existing rows'
     buttons in place, so scroll position and the rendered list are preserved.
     (Initial population still uses renderAllProfileSocialPanels in
     openProfileSocialModal; membership changes surface on next open.) */
  syncProfileSocialRowButtons(modal);
}

function openProfileSocialModal(kind) {
  const mode = normalizeProfileSocialTab(kind);
  const existing = document.getElementById('profile-social-modal');
  if (existing) existing.remove();
  const title = escHtml(getProfileSocialTitleHandle());
  const counts = {
    mutual: getProfileMutualIds().length,
    followers: getProfileSocialIds('followers').length,
    following: getProfileSocialIds('following').length
  };
  const tab = (k, lbl) =>
    `<button type="button" class="profile-social-tab${k === mode ? ' active' : ''}" data-kind="${k}" role="tab" onclick="switchProfileSocialTab('${k}')"><strong>${counts[k].toLocaleString('en-US')}</strong> ${lbl}</button>`;
  const panel = (k) => `<div class="profile-social-panel" data-kind="${k}" role="list">${renderProfileSocialLoadingState()}</div>`;
  const modal = document.createElement('div');
  modal.id = 'profile-social-modal';
  modal.dataset.mode = mode;
  modal.className = 'profile-social-page-overlay';
  modal.setAttribute('role', 'dialog');
  modal.innerHTML = `
    <div class="profile-social-page">
      <div class="profile-social-page-header">
        <button type="button" class="profile-social-page-back" onclick="closeProfileSocialModal()" aria-label="Back">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4 6 10l6.5 6"></path></svg>
        </button>
        <div class="profile-social-page-title">${title}</div>
        <button type="button" class="profile-social-page-add" onclick="openProfileSocialAddFriendPage()" aria-label="Add a friend" title="Add a friend">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 19.5a5.5 5.5 0 0 0-11 0"></path>
            <circle cx="9.5" cy="8" r="3.5"></circle>
            <path d="M19 8v6"></path>
            <path d="M16 11h6"></path>
          </svg>
        </button>
      </div>
      <div class="profile-social-tabs" role="tablist">
        ${tab('mutual', 'mutual')}${tab('followers', 'followers')}${tab('following', 'following')}
      </div>
      <div class="profile-social-pager">
        <div class="profile-social-track">
          ${panel('mutual')}${panel('followers')}${panel('following')}
        </div>
      </div>
    </div>`;
  /* v11379: lock the underlying page scroll while the social page is open.
     Without this, opening from a window-scrolling page (the friend SHELF) lets
     the page behind scroll on the swipe's vertical component, fighting the
     horizontal pager and making it hitchy. The profile page already uses a
     contained scroller so it was fine — this makes both entry points behave
     identically. Mirrors how the app's other full-screen overlays lock scroll. */
  modal.dataset.prevBodyOverflow = document.body.style.overflow || '';
  modal.dataset.prevHtmlOverflow = document.documentElement.style.overflow || '';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  document.body.appendChild(modal);
  /* v11375: drive the 3-tab pager with the shared instagramPageSwipe preset
     (assets/public/js/39-instagram-page-swipe.js) — the single source of truth
     for horizontal page swipes. Attaching also places the track on the opening
     tab (no animation). lockTarget = modal so the .horizontal-swipe-active scroll
     lock CSS keeps matching; edgeClose = modal so swiping right on the first tab
     slides the whole page off and removes it. */
  const pagerEl = modal.querySelector('.profile-social-pager');
  const trackEl = modal.querySelector('.profile-social-track');
  if (typeof attachInstagramPageSwipe === 'function' && pagerEl && trackEl) {
    modal._socialPager = attachInstagramPageSwipe(pagerEl, {
      track: trackEl,
      pageCount: PROFILE_SOCIAL_TABS.length,
      getIndex: () => PROFILE_SOCIAL_TABS.indexOf(normalizeProfileSocialTab(modal.dataset.mode)),
      onIndexChange: (i) => updateProfileSocialActiveTab(modal, i),
      duration: 450,
      lockTarget: modal,
      edgeCloseElement: modal,
      onEdgeClose: () => { restoreProfileSocialPageScroll(modal); if (modal.isConnected) modal.remove(); }
    });
  }
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('profile-social-page-open')));
  renderAllProfileSocialPanels(modal);
}


