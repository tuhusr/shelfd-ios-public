/*
   55-highlight-reader.js  (v12.076)
   In-app highlight clip reader — full-screen overlay sliding in from the right,
   mirrors the news reader (js/43 / css/24). Opens when the user taps a highlight
   activity card (outside the inline embed) or arrives via the /highlight/ deep link.
*/
(function () {

  /* ---- lazy DOM creation ---- */
  function ensureHighlightReaderPage() {
    if (document.getElementById('highlight-reader-page')) return;
    const el = document.createElement('div');
    el.id = 'highlight-reader-page';
    el.className = 'highlight-reader-page';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Highlight clip');
    el.style.display = 'none';
    el.innerHTML = [
      '<div class="highlight-reader-topbar">',
      '  <button class="highlight-reader-back" onclick="closeHighlightReaderPage()" aria-label="Back">',
      '    <svg viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>',
      '  </button>',
      '  <div class="highlight-reader-topbar-title">',
      '    <div class="highlight-reader-topbar-label">Highlight</div>',
      '    <div class="highlight-reader-game-name" id="highlight-reader-game-name"></div>',
      '  </div>',
      '</div>',
      '<div class="highlight-reader-body">',
      '  <div class="highlight-reader-embed-wrap" id="highlight-reader-embed-wrap">',
      '    <div id="highlight-reader-embed"></div>',
      '  </div>',
      '  <div id="highlight-reader-meta" class="highlight-reader-meta"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
  }

  /* ---- open ---- */
  window.openHighlightReaderPage = function (activityId, activityData) {
    ensureHighlightReaderPage();

    const activity = activityData
      || (window.friendActivityClickTargets && window.friendActivityClickTargets[activityId])
      || {};

    const hlUrl  = String(activity.highlightUrl || (activity.content && activity.content.text) || '').trim();
    const hlMatch = hlUrl.match(/streamable\.com\/(?:e\/)?([a-z0-9]+)/i);
    const hlId   = hlMatch ? hlMatch[1] : '';
    const game   = activity.item || {};
    const gameName   = game.title || game.name || '';
    const gamePoster = game.poster || game.image || '';
    const uid    = activity.uid || '';
    const usersMapRef = window.usersMap || {};
    const user   = usersMapRef[uid] || {};
    const displayName = user.displayName || user.name || 'Someone';
    const avatarSrc   = user.photo || user.photoURL || '/default-avatar.svg';

    const caption = typeof window.getScreenListHighlightCaption === 'function'
      ? window.getScreenListHighlightCaption(activity)
      : String(activity.highlightCaption || activity.caption || (activity.content && activity.content.caption) || '');

    const postId    = activity.postId || activityId || '';
    const likes     = Array.isArray(activity.likes)   ? activity.likes   : [];
    const replies   = Array.isArray(activity.replies) ? activity.replies : [];
    const currentUid = (window.currentUser && window.currentUser.uid) || '';
    const isLiked   = likes.includes(currentUid);

    /* embed */
    var embedEl = document.getElementById('highlight-reader-embed');
    if (embedEl) {
      embedEl.innerHTML = hlId
        ? '<iframe src="https://streamable.com/e/' + escA(hlId) + '" allow="autoplay; fullscreen" allowfullscreen title="Highlight clip"></iframe>'
        : '';
    }

    /* topbar */
    var nameEl = document.getElementById('highlight-reader-game-name');
    if (nameEl) nameEl.textContent = gameName || 'Highlight';

    /* meta */
    var metaEl = document.getElementById('highlight-reader-meta');
    if (metaEl) {
      var gamePosterHtml = gamePoster
        ? '<img class="highlight-reader-game-poster" src="' + escA(gamePoster) + '" alt="' + escA(gameName) + '" loading="lazy">'
        : '';
      var gameTagHtml = gameName
        ? '<div class="highlight-reader-game-tag">' + gamePosterHtml + '<span class="highlight-reader-game-tag-name">' + escH(gameName) + '</span></div>'
        : '';
      var captionHtml = caption
        ? '<div class="highlight-reader-caption">' + escH(caption) + '</div>'
        : '';
      var likedClass  = isLiked ? ' is-liked' : '';
      var likedFill   = isLiked ? 'fill="#f43f5e" stroke="#f43f5e"' : '';
      metaEl.innerHTML = [
        '<div class="highlight-reader-user-row">',
        '  <img class="highlight-reader-avatar" src="' + escA(avatarSrc) + '" alt="' + escA(displayName) + '" loading="lazy" onerror="this.src=\'/default-avatar.svg\'">',
        '  <div class="highlight-reader-user-info">',
        '    <div class="highlight-reader-user-name">' + escH(displayName) + '</div>',
        '    <div class="highlight-reader-user-action">Shared a highlight</div>',
        '  </div>',
        '  ' + gameTagHtml,
        '</div>',
        captionHtml,
        '<div class="highlight-reader-actions">',
        '  <button class="highlight-reader-action-btn' + likedClass + '" id="highlight-reader-like-btn"',
        '    onclick="highlightReaderToggleLike(\'' + escA(activityId) + '\')">',
        '    <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" ' + likedFill + '></path></svg>',
        '    <span id="highlight-reader-like-count">' + likes.length + '</span>',
        '  </button>',
        '  <button class="highlight-reader-action-btn"',
        '    onclick="highlightReaderOpenComments(\'' + escA(postId) + '\',\'' + escA(activityId) + '\')">',
        '    <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        '    <span>' + replies.length + '</span>',
        '  </button>',
        '  <button class="highlight-reader-action-btn highlight-reader-share-btn"',
        '    onclick="highlightReaderShare(\'' + escA(activityId) + '\')">',
        '    <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>',
        '  </button>',
        '</div>'
      ].join('');
    }

    /* slide in */
    var page = document.getElementById('highlight-reader-page');
    page.style.display = 'flex';
    page.style.flexDirection = 'column';
    void page.offsetWidth;
    requestAnimationFrame(function () { page.classList.add('is-open'); });
  };

  /* ---- close ---- */
  window.closeHighlightReaderPage = function () {
    var page = document.getElementById('highlight-reader-page');
    if (!page) return;
    page.classList.remove('is-open');
    setTimeout(function () {
      page.style.display = 'none';
      var embedEl = document.getElementById('highlight-reader-embed');
      if (embedEl) embedEl.innerHTML = ''; /* stop video playback */
    }, 380);
  };

  /* ---- actions ---- */
  window.highlightReaderToggleLike = function (activityId) {
    if (typeof toggleScreenListActivityLike === 'function') {
      toggleScreenListActivityLike(activityId);
      /* optimistic UI update */
      var btn = document.getElementById('highlight-reader-like-btn');
      var countEl = document.getElementById('highlight-reader-like-count');
      if (btn) {
        var nowLiked = !btn.classList.contains('is-liked');
        btn.classList.toggle('is-liked', nowLiked);
        var svgPath = btn.querySelector('svg path');
        if (svgPath) {
          svgPath.setAttribute('fill', nowLiked ? '#f43f5e' : 'none');
          svgPath.setAttribute('stroke', nowLiked ? '#f43f5e' : 'currentColor');
        }
        if (countEl) {
          var n = parseInt(countEl.textContent, 10) || 0;
          countEl.textContent = nowLiked ? n + 1 : Math.max(0, n - 1);
        }
      }
    }
  };

  window.highlightReaderOpenComments = function (postId, activityId) {
    closeHighlightReaderPage();
    setTimeout(function () {
      if (postId && typeof openFeedPostPage === 'function') {
        openFeedPostPage(postId);
      } else if (activityId && typeof openActivityReplyPage === 'function') {
        openActivityReplyPage(activityId);
      }
    }, 220);
  };

  window.highlightReaderShare = function (activityId) {
    if (typeof shareScreenListHighlightActivity === 'function') {
      shareScreenListHighlightActivity(activityId);
    }
  };

  /* ---- escape helpers (global escAttr/escHtml may not exist at IIFE time) ---- */
  function escA(s) {
    return String(s || '').replace(/[&"'<>]/g, function (c) {
      return { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function escH(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- deep-link: /highlight/{hlId}?postId=...&game=...&user=...&caption=... ---- */
  function checkHighlightDeepLink() {
    try {
      var m = window.location.pathname.match(/^\/highlight\/([a-z0-9]+)\/?$/i);
      if (!m) return;
      var hlId = m[1];
      var params = new URLSearchParams(window.location.search);
      var postId      = params.get('postId')  || '';
      var gameName    = params.get('game')    || '';
      var userName    = params.get('user')    || '';
      var caption     = params.get('caption') || '';
      var syntheticActivity = {
        highlightUrl:     'https://streamable.com/e/' + hlId,
        item:             { title: gameName },
        highlightCaption: caption,
        caption:          caption,
        postId:           postId
      };
      if (userName) {
        var uid = '__hl_deeplink__';
        syntheticActivity.uid = uid;
        window.usersMap = window.usersMap || {};
        window.usersMap[uid] = { displayName: userName, name: userName };
      }
      /* Defer slightly so app globals (usersMap, friendActivityClickTargets) are ready */
      setTimeout(function () {
        window.openHighlightReaderPage(postId || hlId, syntheticActivity);
      }, 700);
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkHighlightDeepLink);
  } else {
    checkHighlightDeepLink();
  }

})();
