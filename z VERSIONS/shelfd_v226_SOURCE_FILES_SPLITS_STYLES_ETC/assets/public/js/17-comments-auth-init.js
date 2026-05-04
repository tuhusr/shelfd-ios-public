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
  activeFriendsTab = 'find';
  switchFriendsTab('find');
  const searchInput = document.querySelector('#find-people-view .find-search');
  if (searchInput) searchInput.value = comment.name || '';
  searchUsersByUsername(comment.name || '');
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

function getCommentsTransitionOverlay() {
  let overlay = document.getElementById('comments-transition-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'comments-transition-overlay';
    overlay.className = 'comments-transition-overlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function animateCommentsOverlay(fromRect, toRect, done, duration = 420, runDoneOnStart = true) {
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || !fromRect || !toRect) {
    done();
    return;
  }

  const overlay = getCommentsTransitionOverlay();
  const startWidth = Math.max(fromRect.width, 44);
  const startHeight = Math.max(fromRect.height, 32);
  const endWidth = Math.max(toRect.width, 44);
  const endHeight = Math.max(toRect.height, 32);
  const dx = fromRect.left - toRect.left;
  const dy = fromRect.top - toRect.top;
  const sx = startWidth / endWidth;
  const sy = startHeight / endHeight;

  overlay.style.left = toRect.left + 'px';
  overlay.style.top = toRect.top + 'px';
  overlay.style.width = endWidth + 'px';
  overlay.style.height = endHeight + 'px';
  overlay.style.opacity = '1';

  const anim = overlay.animate([
    {
      transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
      borderRadius: '18px',
      opacity: 0.98
    },
    {
      transform: 'translate3d(0, 0, 0) scale(1, 1)',
      borderRadius: '14px',
      opacity: 0.88,
      offset: 0.72
    },
    {
      transform: 'translate3d(0, 0, 0) scale(1, 1)',
      borderRadius: '14px',
      opacity: 0
    }
  ], {
    duration,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards'
  });

  if (runDoneOnStart) done();

  anim.onfinish = () => {
    overlay.style.opacity = '0';
    overlay.style.width = '0';
    overlay.style.height = '0';
    overlay.style.transform = 'none';
    if (!runDoneOnStart) done();
  };
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

  const overlay = document.getElementById('comments-transition-overlay');
  if (overlay) {
    overlay.getAnimations().forEach(anim => anim.cancel());
    overlay.style.opacity = '0';
    overlay.style.width = '0';
    overlay.style.height = '0';
    overlay.style.transform = 'none';
  }

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
function signIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    console.error("Sign in failed:", err);
    // Fallback for mobile browsers that block popups
    auth.signInWithRedirect(provider);
  });
}

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

// Auth state listener
auth.onAuthStateChanged(async (user) => {
  const mediaRoute = parseScreenListMediaRoute();
  if (user) {
    landingPublicProfileActive = false;
    currentUser = user;
    DOC_REF = db.collection("watchlist").doc(user.uid);
    exitPreviewMode();
    if (mediaRoute) {
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
    if (mediaRoute) {
      openSharedMediaProfileRoute(mediaRoute);
      return;
    }
    setDefaultMyListsWatchingView();
    render();
  } else {
    stopFriendsDataListener();
    stopWatchTogetherListener();
    resetFriendsDataState();
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
  }
});

window.addEventListener('hashchange', syncSignedOutRoute);
window.addEventListener('beforeunload', persistUiState);
bindMobileBottomDockSwipe();
