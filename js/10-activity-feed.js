

function getActivityAction(item) {
  if (item.rating > 0) {
    const section = item.librarySection || item.mediaCategory || activeSection;
    return { verb: 'rated', extra: ` ${formatRatingValueForSection(item.rating, section, true)} &#9733;`, isRating: true };
  }
  if (item.status === 'watching') return { verb: 'is watching', extra: '', isRating: false };
  if (item.status === 'watched') return { verb: 'watched', extra: '', isRating: false };
  if (item.status === 'planned') return { verb: 'wants to watch', extra: '', isRating: false };
  return { verb: 'added', extra: '', isRating: false };
}

function getActivityEventType(activity) {
  if (activity.type === 'comment') return 'commented';
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
    case 'completed': return isGame ? 'completed' : 'finished watching';
    case 'started':   return isGame ? 'started playing' : 'started watching';
    case 'paused':    return isGame ? 'put on hold' : 'paused';
    case 'dropped':   return 'dropped';
    case 'planned':   return isGame ? 'wants to play' : 'wants to watch';
    case 'commented': return 'commented on';
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

  // Store in feed collection
  await db.collection('feed').doc(postId).set(feedPost);
  
  // Push to live feed cache
  if (Array.isArray(window.feedPosts)) {
    window.feedPosts.unshift(feedPost);
  }
  
  return feedPost;
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

async function deleteFeedPost(postId) {
  if (!currentUser) return;
  
  // Confirm deletion
  if (!confirm('Delete this post? This cannot be undone.')) {
    return;
  }
  
  try {
    await db.collection('feed').doc(postId).delete();
    
    // Clear cache and reload feed
    friendActivityCache = null;
    friendActivityPromise = null;
    loadActivityTabFeed();
    
    if (typeof showToast === 'function') {
      showToast('Post deleted');
    }
  } catch(err) {
    console.error('Error deleting post:', err);
    alert('Failed to delete post');
  }
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
  completed: { label: 'Finished', labelClass: 'el-completed', ringClass: 'ring-completed', storyRingClass: 'story-ring-completed', topClass: 'card-top-completed' },
  started:   { label: 'Watching', labelClass: 'el-started',   ringClass: 'ring-started',   storyRingClass: 'story-ring-started',   topClass: 'card-top-started'   },
  paused:    { label: 'Paused',   labelClass: 'el-paused',    ringClass: 'ring-paused',    storyRingClass: 'story-ring-paused',    topClass: 'card-top-paused'    },
  dropped:   { label: 'Dropped',  labelClass: 'el-dropped',   ringClass: 'ring-dropped',   storyRingClass: 'story-ring-dropped',   topClass: 'card-top-dropped'   },
  planned:   { label: 'Planning', labelClass: 'el-planned',   ringClass: 'ring-planned',   storyRingClass: 'story-ring-planned',   topClass: 'card-top-planned'   },
  commented: { label: 'Comment',  labelClass: 'el-commented', ringClass: 'ring-commented', storyRingClass: 'story-ring-commented', topClass: 'card-top-commented' },
  post:      { label: 'Post',     labelClass: 'el-added',     ringClass: 'ring-added',     storyRingClass: 'story-ring-added',     topClass: 'card-top-added'     },
  trailer:   { label: 'Trailer',  labelClass: 'el-started',   ringClass: 'ring-started',   storyRingClass: 'story-ring-started',   topClass: 'card-top-started'   },
};


function openActivityUserList(uid = '', name = '', photo = '') {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) return;
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
}

function buildFeedPostCardHTML(a, activityId, options = {}) {
  const content = a.content || {};
  const actor = usersMap[a.uid] ? { ...a, ...usersMap[a.uid] } : a;
  const timeStr = relativeTime(a.timestamp);
  const avatarSrc = actor.photo || a.photo || '';
  const initial = getDisplayName(actor, 'F').charAt(0).toUpperCase();
  const meta = ACTIVITY_TYPE_META[a.type] || ACTIVITY_TYPE_META.post;
  const isOwnPost = currentUser && a.uid === currentUser.uid;
  
  const avatarHtml = avatarSrc
    ? `<img class="activity-card-avatar ${meta.ringClass}" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}')" style="cursor:pointer;" title="View list" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="activity-card-avatar-placeholder ${meta.ringClass}" style="display:none;cursor:pointer;" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}')" title="View list">${initial}</div>`
    : `<div class="activity-card-avatar-placeholder ${meta.ringClass}" style="cursor:pointer;" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}')" title="View list">${initial}</div>`;
  
  const nameHtml = `<span class="activity-card-name" style="cursor:pointer;" onclick="event.stopPropagation(); viewUserFromMap('${escAttr(a.uid)}')">${renderDisplayNameHTML(actor, 'Friend', '')}</span>`;
  
  // Delete button (only for own posts)
  const deleteBtn = isOwnPost 
    ? `<button class="feed-post-delete-btn" onclick="event.stopPropagation(); deleteFeedPost('${escAttr(a.postId || a.id)}')" title="Delete post">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
         </svg>
       </button>`
    : '';
  
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
  
  const interactionsHtml = `
    <div class="activity-interactions" data-activity-interactions>
      <button class="activity-interaction-btn" data-activity-action="reply" onclick="event.stopPropagation(); openFeedPostPage('${escAttr(a.postId || a.id)}')">
        ${getScreenListReplyIconSvg()}
        <span data-activity-reply-count>${replyCount}</span>
      </button>
      <button class="activity-interaction-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" onclick="event.stopPropagation(); toggleFeedLike('${escAttr(a.postId || a.id)}', this)">
        <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span>
        <span data-activity-like-count>${likeCount}</span>
      </button>
    </div>
  `;
  
  return `<div class="activity-card feed-post ${meta.topClass}" data-activity-card-id="${escAttr(activityId)}" data-post-id="${escAttr(a.postId || a.id || '')}">
    <div class="activity-avatar-wrap">${avatarHtml}</div>
    <div class="activity-content-col">
      <div class="activity-who-row">
        ${nameHtml}
        <span class="activity-card-time" style="margin-left:auto;">${timeStr}</span>
        ${deleteBtn}
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
  page.style.cssText = `
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    z-index: 999999 !important;
    background: #0a0818 !important;
    overflow-y: auto !important;
    pointer-events: auto !important;
  `;
  document.body.style.overflow = 'hidden';

  const inner = page.querySelector('.overlay-page-inner');
  if (inner) inner.scrollTop = 0;

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

function buildFeedReplyItemHTML(reply, index = 0, total = 1) {
  const user = usersMap[reply.uid] || { uid: reply.uid, name: 'User' };
  const avatarSrc = user.photo || user.photoURL || '';
  const name = getDisplayName(user, user.displayName || user.name || 'User');
  const initial = String(name || 'U').charAt(0).toUpperCase();
  const timeStr = relativeTime(reply.timestamp);
  const showLine = index < total - 1;
  const avatarHtml = avatarSrc
    ? `<img class="feed-reply-avatar-img" src="${escAttr(avatarSrc)}" alt="" loading="lazy">`
    : `<div class="feed-reply-avatar-img feed-reply-avatar-placeholder">${escHtml(initial)}</div>`;

  return `<article class="feed-reply-item x-reply-item">
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
    </div>
  </article>`;
}

function renderFeedRepliesList(replies = []) {
  const sortedReplies = [...replies].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return sortedReplies.map((reply, index) => buildFeedReplyItemHTML(reply, index, sortedReplies.length)).join('');
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
  
  // Force show the page immediately with aggressive styling
  console.log('Setting page display to block...');
  page.style.cssText = `
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    z-index: 999999 !important;
    background: #0a0818 !important;
    overflow-y: auto !important;
    pointer-events: auto !important;
  `;
  document.body.style.overflow = 'hidden';
  
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

  const itemCover = String(item.cover || '').trim();
  const actorPhoto = String(avatarSrc || '').trim();
  const mediaCover = itemCover && itemCover !== actorPhoto ? itemCover : '';
  const posterHtml = mediaCover
    ? `<button type="button" class="x-post-media-poster" onclick="handleActivityMediaClick('${escAttr(activityId)}', this)"><img src="${escAttr(mediaCover)}" alt="" loading="lazy"></button>`
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
  if (eventType === 'completed') actionText = section === 'games' ? 'completed' : 'finished watching';
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
      </div>
    </article>`;
}

function focusFeedReplyInput() {
  const input = document.getElementById('feed-reply-input');
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function closeFeedPostPage() {
  const page = document.getElementById('feed-post-page');
  if (page) page.style.display = 'none';
  document.body.style.overflow = '';
  currentFeedPostId = null;
  currentFeedPostCollection = 'feed';
}

function initReplyComposer() {
  const avatar = document.getElementById('feed-reply-avatar');
  const input = document.getElementById('feed-reply-input');
  const btn = document.getElementById('feed-reply-btn');
  
  if (!avatar || !input || !btn || !currentUser) return;
  
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
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    btn.disabled = !this.value.trim();
  };
  
  input.value = '';
  btn.disabled = true;
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
    const reply = {
      id: replyId,
      uid: currentUser.uid,
      text,
      timestamp: Date.now()
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
    btn.textContent = 'Reply';
    btn.disabled = true;

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
  if (status === 'watched' || eventType === 'completed') return isGame ? 'played' : 'watched';
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

function buildActivityCardHTML(a, activityId, options = {}) {
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
    ? `<button class="sl-activity-avatar-btn" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','${escAttr(avatarSrc)}')" title="View list" aria-label="Open ${escAttr(getDisplayName(actor, 'Friend'))} list"><img class="sl-activity-avatar-img" src="${escAttr(avatarSrc)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="sl-activity-avatar-fallback" style="display:none">${escHtml(initial)}</span></button>`
    : `<button class="sl-activity-avatar-btn" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','')" title="View list" aria-label="Open ${escAttr(getDisplayName(actor, 'Friend'))} list"><span class="sl-activity-avatar-fallback">${escHtml(initial)}</span></button>`;

  const itemCover = String(item.cover || item.poster || item.image || '').trim();
  const actorPhoto = String(avatarSrc || '').trim();
  const mediaCover = itemCover && itemCover !== actorPhoto ? itemCover : '';
  const posterClick = `event.stopPropagation(); handleActivityMediaClick('${escAttr(activityId)}', this)`;
  const posterHtml = mediaCover
    ? `<button type="button" class="sl-activity-poster" onclick="${posterClick}" aria-label="Open ${escAttr(title)} media profile"><img class="sl-activity-poster-img" src="${escAttr(mediaCover)}" alt="${escAttr(title)}" loading="lazy"></button>`
    : `<button type="button" class="sl-activity-poster sl-activity-poster-empty" onclick="${posterClick}" aria-label="Open ${escAttr(title)} media profile"><span>${escHtml((sectionLabel || title || '?').charAt(0).toUpperCase())}</span></button>`;

  const ratingHtml = renderActivityUniversalRating(item.rating || a.rating || a.activityRating || 0);
  const commentHtml = renderActivityCommentPreview(getActivityPreviewComment(a, item), activityId);

  const likes = Array.isArray(a.likes) ? a.likes : [];
  const isLiked = currentUser && likes.includes(currentUser.uid);
  const likeCount = likes.length;
  const replies = Array.isArray(a.replies) ? a.replies : [];
  const replyCount = replies.length;
  const interactionsHtml = options.hideInteractions ? '' : `
    <div class="sl-activity-actions activity-interactions" data-activity-interactions>
      <button class="sl-activity-action-btn activity-interaction-btn" data-activity-action="reply" onclick="event.stopPropagation(); openActivityReplyPage('${escAttr(activityId)}')" aria-label="Open comments">
        ${getScreenListReplyIconSvg()}
        <span data-activity-reply-count>${replyCount}</span>
      </button>
      <button class="sl-activity-action-btn activity-interaction-btn ${isLiked ? 'liked' : ''}" data-activity-action="like" onclick="event.stopPropagation(); toggleActivityLike('${escAttr(activityId)}', this)" aria-label="Like activity">
        <span data-like-icon-slot>${getScreenListHeartIconSvg(isLiked)}</span>
        <span data-activity-like-count>${likeCount}</span>
      </button>
    </div>`;

  const nameLine = hideActorName
    ? `<span class="sl-activity-name-spacer" aria-hidden="true"></span>`
    : `<button class="sl-activity-name" type="button" onclick="event.stopPropagation(); openActivityUserList('${escAttr(a.uid)}','${escAttr(actor.name || actor.customName || a.name || '')}','${escAttr(avatarSrc)}')">${actorName}</button>`;

  return `<article class="shelfd-social-card ${meta.topClass}" data-activity-card-id="${escAttr(activityId)}" data-activity-id="${escAttr(activityId)}" data-shelfd-activity-card="v4">
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
    actionButtons.push(`<button type="button" class="activity-shared-watch-pill ${sharedWatchActive ? 'active' : 'secondary'}" aria-current="${sharedWatchActive ? 'true' : 'false'}" onclick="switchActivitySubTab('sharedWatch')">Shared Watch</button>`);
  }
  if (options.hideHeading && !actionButtons.length) return '';
  return `<div class="activity-feed-header"><span class="activity-feed-heading">${options.hideHeading ? '' : escHtml(heading)}</span><div class="activity-feed-actions">${actionButtons.join('')}</div></div>`;
}


function renderFriendActivityItems(feed, activities, options = {}) {
  friendActivityClickTargets = {};

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

async function fetchAllFriendActivities(dayLimit = 7) {
  const cacheKey = `${isPreviewMode() ? 'preview' : (currentUser?.uid || 'guest')}|${friends.slice().sort().join(',')}|${dayLimit || 0}`;
  const now = Date.now();
  if (
    friendActivityCache &&
    friendActivityCache.key === cacheKey &&
    (now - friendActivityCache.timestamp) < FRIEND_ACTIVITY_CACHE_MS
  ) {
    return friendActivityCache.activities.map(activity => ({
      ...activity,
      item: activity.item ? { ...activity.item } : activity.item
    }));
  }
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
    return previewActivities.map(activity => ({ ...activity, item: activity.item ? { ...activity.item } : activity.item }));
  }
  if (!currentUser) {
    friendActivityCache = { key: cacheKey, timestamp: Date.now(), activities: [] };
    return [];
  }
  const cutoff = dayLimit ? new Date(Date.now() - dayLimit * 24 * 60 * 60 * 1000).toISOString() : null;
  const activities = [];
  const mediaMap = new Map();
  const friendUidSet = new Set([...friends, currentUser.uid]); // Always include current user
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
        for (const item of items) {
          const enriched = { ...item, librarySection: section, mediaCategory: section };
          const mediaKey = getMediaKey(enriched);
          if (mediaKey && !mediaMap.has(mediaKey)) mediaMap.set(mediaKey, { title: item.title, cover: item.cover || '', section });

          const addedAt = item.dateAdded || '';
          const modifiedAt = item.dateModified || '';
          const hasRating = Number(item.rating || 0) > 0;
          const modIsDistinct = modifiedAt && modifiedAt !== addedAt &&
            (new Date(modifiedAt).getTime() - new Date(addedAt).getTime()) > 5 * 60 * 1000;
          const reviewActivityAt = item.lastReviewActivityAt || item.reviewUpdatedAt || item.reviewEditedAt || item.reviewSavedAt || item.reviewPostedAt || '';
          const modTime = modifiedAt ? new Date(modifiedAt).getTime() : 0;
          const reviewTime = reviewActivityAt ? new Date(reviewActivityAt).getTime() : 0;
          const modIsReviewActivity = Number.isFinite(modTime) && Number.isFinite(reviewTime) && modTime > 0 && reviewTime > 0 &&
            Math.abs(reviewTime - modTime) <= 60 * 1000;

          // Added event
          if (addedAt && (!cutoff || addedAt >= cutoff)) {
            activities.push({ uid, name: u.name || 'Friend', photo: u.photo || '', item: enriched, timestamp: addedAt, eventType: 'added', mediaKey });
          }

          // Modification event (rating or status change after initial add)
          if (modIsDistinct && !modIsReviewActivity && (!cutoff || modifiedAt >= cutoff)) {
            let modEventType = 'added';
            if (hasRating) {
              modEventType = 'rated';
            } else if (item.status === 'watched' || item.status === 'watching' || item.status === 'planned' || item.status === 'paused' || item.status === 'dropped' || item.status === 'live') {
              modEventType = 'status-changed';
            } else {
              continue;
            }
            activities.push({
              uid,
              name: u.name || 'Friend',
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
  const mergedActivities = [...deduped.values()].sort((a, b) => new Date(b.timestamp || b.item.dateAdded) - new Date(a.timestamp || a.item.dateAdded));
  friendActivityCache = { key: cacheKey, timestamp: Date.now(), activities: mergedActivities };
  return mergedActivities.map(activity => ({
    ...activity,
    item: activity.item ? { ...activity.item } : activity.item
  }));
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
