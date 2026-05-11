// ===== Comments Page =====
let commentsItemId = null;
let commentsMediaKey = null;
let commentsUnsubscribe = null;
let commentsScope = 'friends';
let commentsRawItems = [];
let commentsDrafts = { friends: '', global: '' };
let commentsSubmitting = false;
let commentCountCache = {};

function getMediaKey(item) {
  if (!item) return '';
  if (item.imdbId) return 'imdb:' + item.imdbId;
  if (item.tmdbId) {
    const section = item.librarySection || item.mediaCategory || activeSection;
    const tmdbType = isShowSection(section) ? 'tv' : 'movie';
    const seasonSuffix = section === 'anime' && item.tmdbSeasonNumber ? `:s${item.tmdbSeasonNumber}` : '';
    return `tmdb-${tmdbType}:${item.tmdbId}${seasonSuffix}`;
  }
  if (item.metacriticSlug) return 'game:' + item.metacriticSlug;
  const title = (item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const type = item.librarySection || item.mediaCategory || activeSection || 'media';
  return type + ':' + title;
}

function getCachedCommentCount(mediaKey) {
  if (!mediaKey) return 0;
  return Number(commentCountCache[mediaKey] || 0);
}

function setCachedCommentCount(mediaKey, count) {
  if (!mediaKey) return;
  commentCountCache[mediaKey] = Math.max(0, Number(count) || 0);
}

function updateCommentCountBadges(mediaKey, count) {
  if (!mediaKey) return;
  document.querySelectorAll(`.comment-count[data-media-key="${CSS.escape(mediaKey)}"]`).forEach(el => {
    el.textContent = String(Math.max(0, Number(count) || 0));
  });
}

async function refreshVisibleCommentCounts() {
  const badges = Array.from(document.querySelectorAll('.comment-count[data-media-key]'));
  const uniqueKeys = Array.from(new Set(badges.map(el => el.dataset.mediaKey).filter(Boolean)));
  if (!uniqueKeys.length) return;

  await Promise.all(uniqueKeys.map(async mediaKey => {
    if (isPreviewMode() && !currentUser) {
      const previewCount = getPreviewCommentsForMedia(mediaKey).length;
      setCachedCommentCount(mediaKey, previewCount);
      updateCommentCountBadges(mediaKey, previewCount);
      return;
    }
    try {
      const snap = await db.collection('comments').doc(mediaKey).get();
      const comments = snap.exists && Array.isArray(snap.data().comments) ? snap.data().comments : [];
      setCachedCommentCount(mediaKey, comments.length);
      updateCommentCountBadges(mediaKey, comments.length);
    } catch (error) {
      console.error('Comment count load failed:', error);
      setCachedCommentCount(mediaKey, 0);
      updateCommentCountBadges(mediaKey, 0);
    }
  }));
}

function isFriendVisibleComment(comment) {
  if (!comment?.uid || !currentUser) return false;
  return comment.uid === currentUser.uid || friends.includes(comment.uid);
}

function getScopedComments(comments, scope) {
  const list = Array.isArray(comments) ? comments : [];
  if (scope === 'global') {
    return list.filter(comment => (comment.scope || 'global') !== 'friends');
  }
  if (!currentUser) return [];
  return list.filter(comment => (comment.scope || 'global') === 'friends' && isFriendVisibleComment(comment));
}

function getCommentsEmptyMessage(scope) {
  if (scope === 'friends') {
    if (!currentUser) return 'Sign in to see friends-only comments.';
    return 'No friends-only comments yet. Start the conversation with your friends.';
  }
  if (isPreviewMode() && !currentUser) return 'No preview global comments yet for this title.';
  return 'No global comments yet. Be the first to say something.';
}

function renderCommentsToolbar() {
  const countEl = document.getElementById('comments-count');
  if (!countEl) return;
  const filtered = getScopedComments(commentsRawItems, commentsScope);
  countEl.innerHTML = `<div class="comments-count">${filtered.length} Comment${filtered.length !== 1 ? 's' : ''}</div>`;
}

function renderCommentsInput() {
  const area = document.getElementById('comments-input-area');
  if (!area) return;
  if (!currentUser) {
    if (isPreviewMode()) {
      const note = commentsScope === 'friends'
        ? 'Friends-only comments are visible after sign-in.'
        : 'Preview Mode lets you read public comments, but nothing can be posted or saved.';
      area.innerHTML = `
        <div class="comment-input-area">
          <div class="comment-input-right">
            <div class="comment-input-footer">
              <div class="comment-input-left">
                <div class="comments-scope-tabs">
                  <button type="button" class="comments-scope-tab${commentsScope === 'friends' ? ' active' : ''}" onclick="switchCommentsScope('friends')">Friends</button>
                  <button type="button" class="comments-scope-tab${commentsScope === 'global' ? ' active' : ''}" onclick="switchCommentsScope('global')">Global</button>
                </div>
                <div class="comments-scope-note">${note}</div>
              </div>
            </div>
          </div>
        </div>`;
      return;
    }
    area.innerHTML = '';
    return;
  }
  const photo = (userProfile && userProfile.photo) || currentUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent((userProfile && userProfile.name) || currentUser.displayName || '?')}&background=1e2028&color=60a5fa`;
  const placeholder = commentsScope === 'friends'
    ? 'Write a friends-only comment...'
    : 'Write a global comment...';
  const buttonLabel = commentsScope === 'friends' ? 'Post to Friends' : 'Post Globally';
  const note = commentsScope === 'friends'
    ? 'Only you and confirmed friends can see these comments.'
    : 'Anyone who opens this media can see these comments.';
  const draft = commentsDrafts[commentsScope] || '';
  area.innerHTML = `
    <div class="comment-input-area">
      <img class="comment-input-avatar" src="${photo}" alt="">
      <div class="comment-input-right">
        <textarea class="comment-textarea" id="comment-textarea" placeholder="${placeholder}" oninput="cacheCommentDraft(this.value)">${escHtml(draft)}</textarea>
        <div class="comment-input-footer">
          <div class="comment-input-left">
            <div class="comments-scope-tabs">
              <button type="button" class="comments-scope-tab${commentsScope === 'friends' ? ' active' : ''}" onclick="switchCommentsScope('friends')">Friends</button>
              <button type="button" class="comments-scope-tab${commentsScope === 'global' ? ' active' : ''}" onclick="switchCommentsScope('global')">Global</button>
            </div>
            <div class="comments-scope-note">${note}</div>
          </div>
          <button type="button" class="comment-post-btn" onclick="postComment()"${commentsSubmitting ? ' disabled' : ''}>${buttonLabel}</button>
        </div>
      </div>
    </div>`;
}

function cacheCommentDraft(value) {
  commentsDrafts[commentsScope] = value || '';
}

function switchCommentsScope(scope) {
  const input = document.getElementById('comment-textarea');
  if (input) commentsDrafts[commentsScope] = input.value || '';
  commentsScope = scope === 'global' ? 'global' : 'friends';
  renderCommentsToolbar();
  renderCommentsInput();
  renderCommentsUI(commentsRawItems);
}

function dismissCommentsPageForProfileNavigation() {
  if (commentsUnsubscribe) {
    commentsUnsubscribe();
    commentsUnsubscribe = null;
  }
  const commentsPageEl = document.getElementById('comments-page');
  if (commentsPageEl) {
    commentsPageEl.classList.remove('comments-page-animating', 'comments-page-animating-in', 'comments-page-closing');
    commentsPageEl.style.display = 'none';
    commentsPageEl.style.position = '';
    commentsPageEl.style.left = '';
    commentsPageEl.style.top = '';
    commentsPageEl.style.width = '';
    commentsPageEl.style.height = '';
    commentsPageEl.style.zIndex = '';
    commentsPageEl.style.overflowY = '';
    commentsPageEl.style.opacity = '';
    commentsPageEl.style.transform = '';
    commentsPageEl.style.pointerEvents = '';
    commentsPageEl.style.removeProperty('--comments-origin-x');
    commentsPageEl.style.removeProperty('--comments-origin-y');
  }
  commentsItemId = null;
  commentsMediaKey = null;
  commentsScope = 'friends';
  commentsRawItems = [];
  commentsDrafts = { friends: '', global: '' };
  commentsTransitionOrigin = null;
  commentsTransitionOriginRect = null;
  commentsPageClosing = false;
  commentsCloseAnimation = null;
  commentsRestoreView = null;
  setBottomNavVisibility(true);
}

async function openCommentAuthorProfile(commentId) {
  const rawComment = commentsRawItems.find(entry => entry.id === commentId);
  const comment = rawComment ? (usersMap[rawComment.uid] ? { ...rawComment, ...usersMap[rawComment.uid] } : rawComment) : null;
  if (!comment) return;

  dismissCommentsPageForProfileNavigation();

  if (isPreviewMode() || getPreviewCommunityUser(comment.uid)) {
    openPreviewCommunityProfile(comment.uid);
    return;
  }

  if (!currentUser || !comment.uid) return;
  if (comment.uid === currentUser.uid) {
    switchMainNav('mylist');
    return;
  }
  if (friends.includes(comment.uid)) {
    await viewUserList(comment.uid, comment.name || 'Anonymous', comment.photo || '');
    return;
  }

  await switchMainNav('community');
  switchFriendsTab('friends');
  const searchInput = document.getElementById('friends-inline-search-input');
  const query = comment.name || '';
  if (searchInput) searchInput.value = query;
  filterInlineFriendSearch(query);
  showToast("Find this user to send a friend request");
}


let commentsTransitionOrigin = null;
let commentsTransitionOriginRect = null;
let commentsPageClosing = false;
let commentsCloseAnimation = null;
let commentsRestoreView = null;

function restoreCommentsSourceView() {
  setBottomNavVisibility(true);

  const navComm = document.getElementById('nav-community');
  const activeMainTab = navComm && navComm.classList.contains('active') ? 'community' : 'mylist';
  setMainNavVisibility(activeMainTab);

  if (activeMainTab === 'community') {
    loadCommunity();
    return;
  }

  render();
}

function cleanupCommentsPageState() {
  const commentsPageEl = document.getElementById('comments-page');
  commentsPageEl.classList.remove('comments-page-animating', 'comments-page-animating-in', 'comments-page-closing');
  commentsPageEl.style.display = 'none';
  commentsPageEl.style.position = '';
  commentsPageEl.style.left = '';
  commentsPageEl.style.top = '';
  commentsPageEl.style.width = '';
  commentsPageEl.style.height = '';
  commentsPageEl.style.zIndex = '';
  commentsPageEl.style.overflowY = '';
  commentsPageEl.style.opacity = '';
  commentsPageEl.style.transform = '';
  commentsPageEl.style.pointerEvents = '';
  commentsPageEl.style.removeProperty('--comments-origin-x');
  commentsPageEl.style.removeProperty('--comments-origin-y');

  if (typeof commentsRestoreView === 'function') commentsRestoreView();

  commentsItemId = null;
  commentsMediaKey = null;
  commentsScope = 'friends';
  commentsRawItems = [];
  commentsDrafts = { friends: '', global: '' };
  commentsTransitionOrigin = null;
  commentsTransitionOriginRect = null;
  commentsPageClosing = false;
  commentsCloseAnimation = null;
  commentsRestoreView = null;
}

function cancelCommentsCloseIfNeeded() {
  if (!commentsPageClosing) return;
  if (commentsCloseAnimation) {
    commentsCloseAnimation.onfinish = null;
    commentsCloseAnimation.oncancel = null;
    commentsCloseAnimation.cancel();
  }
  cleanupCommentsPageState();
}

function openCommentsPage(itemId, triggerEl) {
  cancelCommentsCloseIfNeeded();

  const sourceData = getVisibleListData();
  const items = sourceData[activeSection];
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  commentsTransitionOrigin = triggerEl || null;
  commentsTransitionOriginRect = null;
  commentsItemId = itemId;
  commentsMediaKey = getMediaKey(item);
  commentsViewState = { type: 'item', itemId };

  const commentsPageEl = document.getElementById('comments-page');
  const triggerRect = triggerEl ? triggerEl.getBoundingClientRect() : null;
  const startRect = triggerRect ? {
    left: triggerRect.left,
    top: triggerRect.top,
    width: triggerRect.width,
    height: triggerRect.height
  } : null;
  commentsTransitionOriginRect = startRect;

  document.getElementById('mylist-view').style.display = 'none';
  document.getElementById('community-view').style.display = 'none';
  document.getElementById('mylist-header').style.display = 'none';
  commentsPageEl.style.display = 'block';
  commentsPageEl.style.pointerEvents = '';
  commentsPageEl.classList.remove('comments-page-animating', 'comments-page-animating-in', 'comments-page-closing');
  commentsPageEl.style.opacity = '1';
  commentsPageEl.style.transform = 'none';

  const emoji = getSectionIcon(activeSection);
  const coverHtml = item.cover
    ? `<div class="comments-page-cover" style="background-image:url('${item.cover}')"></div>`
    : `<div class="comments-page-cover no-img" style="display:flex;align-items:center;justify-content:center;font-size:24px;">${emoji}</div>`;
  const sectionLabel = activeSection === 'anime' ? 'ANIME' : activeSection === 'shows' ? 'TV SHOW' : activeSection === 'movies' ? 'MOVIE' : 'GAME';

  function renderCommentsHeader(yearVal) {
    document.getElementById('comments-page-header').innerHTML = `
      <div class="comments-page-header">
        ${coverHtml}
        <div class="comments-page-info">
          <div class="comments-page-title">${escHtml(item.title)}</div>
          <div class="comments-page-meta">${sectionLabel}${item.genre ? ' · ' + escHtml(item.genre) : ''}${yearVal ? ' · ' + yearVal : ''}</div>
        </div>
      </div>`;
  }

  renderCommentsHeader(item.year);

  if (!item.year && !viewingUser) {
    const tmdbType = isShowSection(activeSection) ? 'tv' : 'movie';
    fetch(buildProxyUrl(TMDB_PROXY_BASE, `search/${tmdbType}`, { query: item.title }))
      .then(r => r.json())
      .then(json => {
        const match = (json.results || [])[0];
        if (match) {
          const yr = (match.release_date || match.first_air_date || '').slice(0, 4);
          if (yr) {
            item.year = yr;
            save();
            renderCommentsHeader(yr);
          }
        }
      }).catch(() => {});
  }

  commentsScope = currentUser ? 'friends' : 'global';
  commentsDrafts = { friends: '', global: '' };
  renderCommentsToolbar();
  renderCommentsInput();
  loadComments();
  persistUiState();
}

function openCommentsPageForActivity(mediaKey, title, cover, commentId = '') {
  cancelCommentsCloseIfNeeded();
  const activityPage = document.getElementById('activity-page');
  const communityView = document.getElementById('community-view');
  const commentsPageEl = document.getElementById('comments-page');
  commentsItemId = null;
  commentsMediaKey = mediaKey;
  commentsViewState = { type: 'activity', mediaKey, title, cover, commentId };
  commentsTransitionOrigin = null;
  commentsTransitionOriginRect = null;
  if (activityPage?.classList.contains('active')) {
    activityPage.classList.remove('active');
    commentsRestoreView = () => {
      activityPage.classList.add('active');
      if (commentsPageEl) commentsPageEl.style.display = 'none';
    };
  } else {
    syncMainNavButtons('community');
    if (communityView) communityView.style.display = 'none';
    commentsRestoreView = () => {
      syncMainNavButtons('community');
      if (communityView) communityView.style.display = 'block';
      setBottomNavVisibility(true);
    };
  }
  commentsPageEl.style.display = 'block';
  commentsPageEl.style.pointerEvents = '';
  commentsPageEl.classList.remove('comments-page-animating', 'comments-page-animating-in', 'comments-page-closing');
  commentsPageEl.style.opacity = '1';
  commentsPageEl.style.transform = 'none';
  const coverHtml = cover
    ? `<div class="comments-page-cover" style="background-image:url('${escAttr(cover)}')"></div>`
    : `<div class="comments-page-cover no-img" style="display:flex;align-items:center;justify-content:center;font-size:24px;">💬</div>`;
  document.getElementById('comments-page-header').innerHTML = `
    <div class="comments-page-header">
      ${coverHtml}
      <div class="comments-page-info">
        <div class="comments-page-title">${escHtml(title || 'Comments')}</div>
        <div class="comments-page-meta">FRIEND ACTIVITY</div>
      </div>
    </div>`;
  commentsScope = 'global';
  commentsDrafts = { friends: '', global: '' };
  renderCommentsToolbar();
  renderCommentsInput();
  loadComments();
  persistUiState();
  if (commentId) {
    setTimeout(() => {
      const row = document.querySelector(`#comments-list .comment-item[data-comment-id="${CSS.escape(commentId)}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.animate([
          { backgroundColor: 'rgba(245, 158, 11, 0.18)' },
          { backgroundColor: 'rgba(245, 158, 11, 0)' }
        ], { duration: 1400, easing: 'ease-out' });
      }
    }, 450);
  }
}

function closeCommentsPage() {
  if (commentsPageClosing) return;
  commentsPageClosing = true;

  if (commentsUnsubscribe) { commentsUnsubscribe(); commentsUnsubscribe = null; }

  const commentsPageEl = document.getElementById('comments-page');
  commentsPageEl.classList.remove('comments-page-animating', 'comments-page-animating-in', 'comments-page-closing');
  commentsPageEl.style.pointerEvents = 'none';

  commentsRestoreView = restoreCommentsSourceView;
  cleanupCommentsPageState();
  commentsViewState = null;
  persistUiState();
}

function loadComments() {
  if (commentsUnsubscribe) commentsUnsubscribe();
  if (isPreviewMode()) {
    commentsUnsubscribe = null;
    commentsRawItems = getPreviewCommentsForMedia(commentsMediaKey);
    commentsRawItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    setCachedCommentCount(commentsMediaKey, commentsRawItems.length);
    updateCommentCountBadges(commentsMediaKey, commentsRawItems.length);
    renderCommentsToolbar();
    renderCommentsUI(commentsRawItems);
    return;
  }
  const ref = db.collection('comments').doc(commentsMediaKey);
  commentsUnsubscribe = ref.onSnapshot(doc => {
    commentsRawItems = (doc.exists && doc.data().comments) || [];
    commentsRawItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    setCachedCommentCount(commentsMediaKey, commentsRawItems.length);
    updateCommentCountBadges(commentsMediaKey, commentsRawItems.length);
    renderCommentsToolbar();
    renderCommentsUI(commentsRawItems);
  }, err => {
    console.error('Comments listen error:', err);
    commentsRawItems = [];
    setCachedCommentCount(commentsMediaKey, 0);
    updateCommentCountBadges(commentsMediaKey, 0);
    renderCommentsToolbar();
    document.getElementById('comments-list').innerHTML = '<div class="comments-empty">Failed to load comments. Try again in a moment.</div>';
  });
}

function renderCommentsUI(comments) {
  const list = document.getElementById('comments-list');
  const filtered = getScopedComments(comments, commentsScope);
  if (filtered.length === 0) {
    list.innerHTML = `<div class="comments-empty">${getCommentsEmptyMessage(commentsScope)}</div>`;
    return;
  }
  list.innerHTML = filtered.map(c => {
      const photo = c.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name || 'U') + '&background=1e2028&color=60a5fa';
      const isOwn = currentUser && c.uid === currentUser.uid;
      const authorUser = usersMap[c.uid] ? { ...c, ...usersMap[c.uid] } : c;
      const authorHtml = commentsScope === 'global' && (c.uid || getPreviewCommunityUser(c.uid))
        ? `<button type="button" class="comment-author-btn" onclick="openCommentAuthorProfile('${c.id}')">${renderDisplayNameHTML(authorUser, 'Anonymous')}</button>`
        : `<span class="comment-author">${renderDisplayNameHTML(authorUser, 'Anonymous')}</span>`;
      return `<div class="comment-item" data-comment-id="${escAttr(c.id || '')}">
      <img class="comment-avatar" src="${photo}" alt="">
      <div class="comment-body">
        <div class="comment-header">
          ${authorHtml}
          <span class="comment-time">${timeAgo(c.timestamp)}</span>
          ${isOwn ? `<button class="comment-delete" onclick="deleteComment('${c.id}')">Delete</button>` : ''}
        </div>
        <div class="comment-text">${escHtml(c.text)}</div>
      </div>
    </div>`;
  }).join('');
}

async function postComment() {
  const input = document.getElementById('comment-textarea');
  const button = document.querySelector('#comments-input-area .comment-post-btn');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text || !currentUser || !commentsMediaKey || commentsSubmitting) return;

  commentsSubmitting = true;
  if (button) button.disabled = true;
  input.disabled = true;

    const comment = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      uid: currentUser.uid,
      name: (userProfile && userProfile.name) || currentUser.displayName || 'Anonymous',
      photo: (userProfile && userProfile.photo) || currentUser.photoURL || '',
      accountEmailLower: normalizeEmail(currentUser?.email),
      isCreatorAdmin: normalizeEmail(currentUser?.email) === CREATOR_ADMIN_EMAIL,
      text: text,
    timestamp: Date.now(),
    scope: commentsScope === 'global' ? 'global' : 'friends'
  };

  try {
    const ref = db.collection('comments').doc(commentsMediaKey);
    await ref.set({
      comments: firebase.firestore.FieldValue.arrayUnion(comment),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    if (!viewingUser && commentsViewState?.type === 'item' && commentsItemId && typeof findOwnLibraryItemRecord === 'function') {
      const record = findOwnLibraryItemRecord(commentsItemId, activeSection);
      if (record.item && typeof markOwnItemLastEdited === 'function') {
        markOwnItemLastEdited(record.item, record.section || activeSection);
        save();
      }
    }
    setCachedCommentCount(commentsMediaKey, Math.max(getCachedCommentCount(commentsMediaKey), commentsRawItems.length) + 1);
    commentsRawItems = [comment, ...commentsRawItems.filter(c => c && c.id !== comment.id)];
    commentsRawItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderCommentsToolbar();
    renderCommentsUI(commentsRawItems);
    commentsDrafts[commentsScope] = '';
    if (document.getElementById('comment-textarea') === input) input.value = '';
    renderCommentsInput();
    updateCommentCountBadges(commentsMediaKey, getCachedCommentCount(commentsMediaKey));
    showToast("Comment posted");
  } catch(e) {
    console.error('Post comment failed:', e);
    showToast("Could not post comment. Try again.");
  } finally {
    commentsSubmitting = false;
    const liveInput = document.getElementById('comment-textarea');
    const liveButton = document.querySelector('#comments-input-area .comment-post-btn');
    if (liveInput) liveInput.disabled = false;
    if (liveButton) liveButton.disabled = false;
  }
}

async function deleteComment(commentId) {
  if (!commentsMediaKey || !currentUser) return;
  try {
    const ref = db.collection('comments').doc(commentsMediaKey);
    await db.runTransaction(async transaction => {
      const doc = await transaction.get(ref);
      if (!doc.exists) return;
      const comments = Array.isArray(doc.data().comments) ? doc.data().comments : [];
      const target = comments.find(c => c.id === commentId);
      if (!target || target.uid !== currentUser.uid) return;
      transaction.set(ref, {
        comments: comments.filter(c => c.id !== commentId)
      }, { merge: true });
      setCachedCommentCount(commentsMediaKey, comments.length - 1);
    });
    updateCommentCountBadges(commentsMediaKey, getCachedCommentCount(commentsMediaKey));
    showToast("Comment deleted");
  } catch(e) {
    console.error('Delete comment failed:', e);
    showToast("Could not delete comment. Try again.");
  }
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';
  return Math.floor(months / 12) + 'y ago';
}

// Auth functions
/* v631: iOS PWA standalone mode cannot open popups (no window.opener). Detect
   standalone + iOS / coarse-pointer up front and pick the redirect flow directly.
   Otherwise we'd waste a round-trip on a doomed popup before falling back, which
   on iOS PWA also leaves the keyboard in a broken state. */
function _shelfdIsStandalonePWA() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  } catch (_) {}
  return false;
}
function _shelfdIsIosLike() {
  const ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  /* iPadOS 13+ identifies as Mac with touch */
  if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}
function signIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  /* Skip the popup attempt entirely on iOS PWA standalone — popups are blocked
     and the failed open can stall the click gesture on some iOS versions. */
  if (_shelfdIsStandalonePWA() || _shelfdIsIosLike()) {
    try {
      auth.signInWithRedirect(provider);
    } catch (err) {
      console.error('Redirect sign-in failed:', err);
    }
    return;
  }
  auth.signInWithPopup(provider).catch(err => {
    console.error("Sign in failed:", err);
    // Fallback for mobile browsers that block popups
    auth.signInWithRedirect(provider);
  });
}

/* v631: Complete a pending redirect sign-in as soon as Firebase Auth loads.
   onAuthStateChanged still fires on success, but if the redirect failed
   (e.g. Apple ITP blocked the third-party cookie), we want the error in
   the console so we can diagnose. */
(function initRedirectResult() {
  try {
    if (!auth || typeof auth.getRedirectResult !== 'function') return;
    auth.getRedirectResult().catch(err => {
      console.error('Redirect sign-in result error:', err);
    });
  } catch (err) {
    console.error('Redirect-result handler init failed:', err);
  }
})();

function confirmSignOut() {
  closeSignOutModal();
  stopFriendsDataListener();
  stopWatchTogetherListener();
  resetFriendsDataState();
  document.body.classList.remove('profile-active');
  setBottomNavVisibility(false);
  auth.signOut().catch(err => {
    console.error("Sign out failed:", err);
    showToast("Could not log out. Try again.");
  });
}

function signOut() {
  openSignOutModal();
}


function markScreenListAppReadyForSplash() {
  window.__shelfdAppReady = true;
  try { window.dispatchEvent(new CustomEvent('shelfd:app-ready')); }
  catch (error) { window.dispatchEvent(new Event('shelfd:app-ready')); }
}

// Auth state listener
auth.onAuthStateChanged(async (user) => {
  const mediaRoute = parseScreenListMediaRoute();
  const profileRoute = typeof parseScreenListProfileRoute === 'function' ? parseScreenListProfileRoute() : null;
  if (user) {
    /* v804: when the new email-signup flow is mid-flight, that flow owns the
       UI (it just kicked off the setup overlay). We still set currentUser
       and DOC_REF so the rest of the app behaves, but we hand routing to
       the setup flow and skip render() / shell-swap entirely. The signup
       handler called saveUserProfile() itself, so nothing is missed. */
    if (window.__shelfdSignupInProgress) {
      landingPublicProfileActive = false;
      currentUser = user;
      DOC_REF = db.collection("watchlist").doc(user.uid);
      exitPreviewMode();
      markScreenListAppReadyForSplash();
      return;
    }
    landingPublicProfileActive = false;
    currentUser = user;
    DOC_REF = db.collection("watchlist").doc(user.uid);
    exitPreviewMode();
    if (mediaRoute || profileRoute?.uid) {
      prepareSharedMediaRouteView();
    } else {
      document.getElementById("login-screen").style.display = "none";
      document.getElementById("app-container").style.display = "block";
    }
    await load();
    await saveUserProfile(user);
    try {
      await ensureDirectMessageEncryptionReady(user.uid, { silent: true });
    } catch (error) {
      console.warn('Secure Direct Message background setup skipped:', error);
    }
    bootstrapUserCountIfNeeded();
    startFriendsDataListener(); // live Friends/Requests badge + request list updates
    startWatchTogetherListener();
    /* v730: load the user's favoritePeople map (favorited actors/directors)
       into window.shelfdFavoritePeople so cast-card hearts render with the
       correct filled/empty state on first paint. */
    if (typeof window.shelfdLoadFavoritePeople === 'function') {
      window.shelfdLoadFavoritePeople();
    }
    if (mediaRoute) {
      await openSharedMediaProfileRoute(mediaRoute);
      markScreenListAppReadyForSplash();
      return;
    }
    if (profileRoute?.uid && (profileRoute.section || window.location.pathname.startsWith('/profile-card/'))) {
      await openProfileRouteDirect(profileRoute);
      markScreenListAppReadyForSplash();
      return;
    }
    /* v804: gate routing on onboardingComplete. If the user signed up via
       the new email flow and refreshed mid-setup, this returns true and
       the setup overlay opens at the saved step. Skip render() in that case. */
    if (typeof window.__shelfdAuthOnboardingGate === 'function') {
      try {
        const gated = await window.__shelfdAuthOnboardingGate(user);
        if (gated) {
          markScreenListAppReadyForSplash();
          return;
        }
      } catch (e) {
        console.warn('[shelfd-auth] onboarding gate threw:', e);
      }
    }
    setDefaultMyListsWatchingView();
    render();
    markScreenListAppReadyForSplash();
  } else {
    stopFriendsDataListener();
    stopWatchTogetherListener();
    resetFriendsDataState();
    /* v730: drop favoritePeople cache so the next signed-in user starts
       with a clean slate (and signed-out users don't see leftover state). */
    if (typeof window.shelfdClearFavoritePeopleLocal === 'function') {
      window.shelfdClearFavoritePeopleLocal();
    }
    landingPublicProfileActive = false;
    currentUser = null;
    DOC_REF = null;
    ownDataCache = null;
    myData = null;
    viewingUser = null;
    friendViewData = null;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    syncSignedOutRoute();
    markScreenListAppReadyForSplash();
  }
});

window.addEventListener('hashchange', syncSignedOutRoute);
window.addEventListener('beforeunload', persistUiState);
bindMobileBottomDockSwipe();
// Shelfd split runtime guard v302-splash-until-app-ready.
window.__shelfdSplitScriptsLoaded = true;
window.__shelfdSplitScriptsLoading = false;
