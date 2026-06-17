/* ============================================================================
   44-news-share-sheet.js  (v11.690)
   In-app "send to a friend" share bottom sheet for News articles. Replaces the
   straight-to-iOS share with an Instagram/Depop-style sheet that slides up from
   the bottom: pick Shelfd friends (recents first) and send the article into their
   DMs as a rich card (kind:'article'), plus a Copy-link / Share-to… row for
   outside the app. Multi-select; sends WITHOUT navigating into the DM thread.

   Reuses the existing DM plumbing (appendDirectMessageToThread / thread helpers
   from js/09 + js/11) and the article deep-link (buildNewsArticleShareUrl, js/43).
   ========================================================================== */
(function () {
  'use strict';

  var OVERLAY_ID = 'shelfd-news-share-overlay';
  var state = { meta: null, selected: {}, query: '', sending: false };

  /* ---------- helpers ---------- */
  function esc(s) {
    if (typeof escHtml === 'function') { try { return escHtml(s); } catch (e) {} }
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escA(s) {
    if (typeof escAttr === 'function') { try { return escAttr(s); } catch (e) {} }
    return esc(s);
  }
  function toast(m) { if (typeof showToast === 'function') { try { showToast(m); } catch (e) {} } }

  function deepLinkFor(meta) {
    /* v11.676: a media-profile share (movie/tv/anime/game) carries its own canonical
       /media/{kind}/{id} deep link in meta.url. Articles build a /article/{token}
       link from their raw source url.
       v11.997: enrich the media link with the SAME title/poster/user query params
       that the native "Share to…" path (shelfdShareMediaProfileNative) adds. Without
       them the copied link shows no rich preview AND a non-numeric game id can't
       resolve, so "Copy link" produced a bare URL that looked/behaved like a plain
       website link. Now Copy link === Share to…
       highlight: return the post URL directly (no article-token wrapping). */
    if (meta && meta.shareKind === 'highlight') { return String(meta.url || ''); }
    if (meta && meta.shareKind === 'media') {
      var base = String(meta.url || '');
      if (!base) return '';
      try {
        var origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : undefined;
        var u = new URL(base, origin);
        if (meta.title) u.searchParams.set('title', meta.title);
        if (/^https?:\/\//i.test(String(meta.image || ''))) u.searchParams.set('poster', meta.image);
        var uname = '';
        try {
          uname = (typeof getDisplayName === 'function' && typeof userProfile !== 'undefined' && userProfile)
            ? getDisplayName(userProfile, '')
            : ((typeof currentUser !== 'undefined' && currentUser && currentUser.displayName) || '');
        } catch (e) {}
        if (uname) u.searchParams.set('user', uname);
        return u.toString();
      } catch (e) { return base; }
    }
    if (typeof buildNewsArticleShareUrl === 'function') { try { return buildNewsArticleShareUrl(meta) || ''; } catch (e) {} }
    return '';
  }
  function avatarFor(user) {
    if (typeof getDirectMessageAvatar === 'function') { try { return getDirectMessageAvatar(user); } catch (e) {} }
    return (user && user.photo) ? user.photo : ('/default-avatar.svg#' + encodeURIComponent((user && (user.name || user.customName)) || 'User') + '&background=1e2028&color=a78bfa');
  }
  function nameFor(user) {
    if (typeof getDisplayName === 'function') { try { return getDisplayName(user, 'User'); } catch (e) {} }
    return (user && (user.customName || user.name)) || 'User';
  }
  function nameHtml(user) {
    if (typeof renderDisplayNameHTML === 'function') { try { return renderDisplayNameHTML(user, 'User'); } catch (e) {} }
    return esc(nameFor(user));
  }
  function meId() {
    try { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null; } catch (e) { return null; }
  }
  function recipientUserKey(uid) { return 'user:' + String(uid || ''); }
  function recipientThreadKey(threadId) { return 'thread:' + String(threadId || ''); }
  function threadTitle(thread) {
    if (typeof getDirectMessageThreadTitle === 'function') { try { return getDirectMessageThreadTitle(thread); } catch (e) {} }
    return String((thread && thread.groupName) || 'Group Chat');
  }
  function threadAvatar(thread) {
    if (typeof getDirectMessageThreadProfile === 'function') {
      try { return avatarFor(getDirectMessageThreadProfile(thread)); } catch (e) {}
    }
    var title = threadTitle(thread);
    return (thread && thread.groupPhoto) ? thread.groupPhoto : ('/default-avatar.svg#' + encodeURIComponent(title || 'Group') + '&background=1e2028&color=a78bfa');
  }
  function threadSubtitle(thread) {
    if (typeof getDirectMessageThreadSubtitle === 'function') { try { return getDirectMessageThreadSubtitle(thread); } catch (e) {} }
    var count = Array.isArray(thread && thread.participantUids) ? thread.participantUids.length : 0;
    return count ? (count + ' member' + (count === 1 ? '' : 's')) : 'Group chat';
  }
  function threadSearchText(thread) {
    var parts = [threadTitle(thread), threadSubtitle(thread)];
    try {
      (thread.participantUids || []).forEach(function (uid) {
        if (!uid || uid === meId()) return;
        var profile = (typeof getDirectMessageProfile === 'function') ? getDirectMessageProfile(uid, thread.participants && thread.participants[uid]) : null;
        parts.push(nameFor(profile || {}));
        if (profile && profile.username) parts.push(profile.username);
        if (profile && profile.handle) parts.push(profile.handle);
      });
    } catch (e) {}
    return parts.join(' ').toLowerCase();
  }

  /* Recipients: recent DM threads first (including group chats), then the rest of
     friends, deduped + name-filtered by the search query. */
  function candidates(query) {
    var q = String(query || '').trim().toLowerCase();
    var seenUsers = {}, seenThreads = {}, out = [], me = meId();
    var umap = (typeof usersMap !== 'undefined' && usersMap) ? usersMap : {};
    function addUser(uid, profileFallback) {
      if (!uid || uid === me || seenUsers[uid]) return;
      var user = Object.assign({ uid: uid }, umap[uid] || profileFallback || {});
      var nm = nameFor(user);
      if (q && String(nm).toLowerCase().indexOf(q) === -1) return;
      seenUsers[uid] = 1; out.push({ type: 'user', key: recipientUserKey(uid), uid: uid, user: user });
    }
    function addThread(thread) {
      if (!thread || !thread.id || seenThreads[thread.id]) return;
      if (!Array.isArray(thread.participantUids) || (me && thread.participantUids.indexOf(me) === -1)) return;
      if (typeof isDirectMessageGroupThread === 'function' && !isDirectMessageGroupThread(thread)) return;
      if (q && threadSearchText(thread).indexOf(q) === -1) return;
      seenThreads[thread.id] = 1; out.push({ type: 'thread', key: recipientThreadKey(thread.id), threadId: thread.id, thread: thread });
    }
    /* recents */
    try {
      if (typeof getSortedDirectMessageThreads === 'function') {
        var threads = getSortedDirectMessageThreads() || [];
        for (var i = 0; i < threads.length; i++) {
          if (typeof isDirectMessageGroupThread === 'function' && isDirectMessageGroupThread(threads[i])) {
            addThread(threads[i]);
            continue;
          }
          var ouid = (typeof getDirectMessageOtherUid === 'function') ? getDirectMessageOtherUid(threads[i]) : '';
          var fallback = (typeof getDirectMessageOtherProfile === 'function') ? getDirectMessageOtherProfile(threads[i]) : null;
          if (ouid) addUser(ouid, fallback);
        }
      }
    } catch (e) {}
    /* then friends, alphabetical */
    try {
      var fr = (typeof friends !== 'undefined' && Array.isArray(friends)) ? friends.slice() : [];
      var frUsers = fr.map(function (uid) { return Object.assign({ uid: uid }, umap[uid] || {}); });
      frUsers.sort(function (a, b) { return nameFor(a).localeCompare(nameFor(b)); });
      for (var j = 0; j < frUsers.length; j++) addUser(frUsers[j].uid);
    } catch (e) {}
    return out;
  }

  /* ---------- markup ---------- */
  function shareIconSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M12 3L8 7M12 3l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>'; }
  function linkIconSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>'; }
  function checkSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>'; }
  function groupIconSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="7.5" r="3.5"/><path d="M20 20v-1.4a3.2 3.2 0 0 0-2.4-3.1"/><path d="M16 4.3a3.3 3.3 0 0 1 0 6.4"/></svg>'; }

  function recipientHtml(recipient) {
    var on = !!state.selected[recipient.key];
    var isGroup = recipient.type === 'thread';
    var avatar = isGroup ? threadAvatar(recipient.thread) : avatarFor(recipient.user);
    var titleHtml = isGroup ? esc(threadTitle(recipient.thread)) : nameHtml(recipient.user);
    var subtitle = isGroup ? '<span class="shelfd-share-recipient-type">' + esc(threadSubtitle(recipient.thread)) + '</span>' : '';
    return '<button type="button" class="shelfd-share-person' + (isGroup ? ' is-group' : '') + (on ? ' is-selected' : '') + '" data-recipient-key="' + escA(recipient.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="shelfd-share-avatar-wrap">' +
        '<img class="shelfd-share-avatar" src="' + escA(avatar) + '" alt="" loading="lazy">' +
        (isGroup ? '<span class="shelfd-share-group-badge" aria-hidden="true">' + groupIconSvg() + '</span>' : '') +
        '<span class="shelfd-share-check" aria-hidden="true">' + checkSvg() + '</span>' +
      '</span>' +
      '<span class="shelfd-share-name">' + titleHtml + '</span>' +
      subtitle +
    '</button>';
  }

  function peopleHtml() {
    if (!meId()) return '<div class="shelfd-share-empty">Sign in to send articles to friends.</div>';
    var list = candidates(state.query);
    if (!list.length) {
      return '<div class="shelfd-share-empty">' + (state.query ? 'No recipients match that search.' : 'Add friends or start a group chat to send articles.') + '</div>';
    }
    return list.map(recipientHtml).join('');
  }

  function buildSheetHtml(meta) {
    var thumb = meta.image ? '<img class="shelfd-share-preview-thumb" src="' + escA(meta.image) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    var src = meta.source ? '<span class="shelfd-share-preview-source">' + esc(meta.source) + '</span>' : '';
    return '' +
      '<div class="shelfd-share-sheet" role="dialog" aria-modal="true" aria-label="Share article" data-sheet>' +
        '<div class="shelfd-share-grabzone" data-grab>' +
          '<div class="shelfd-share-grab"></div>' +
          '<div class="shelfd-share-preview">' + thumb +
            '<span class="shelfd-share-preview-copy">' +
              '<span class="shelfd-share-preview-title">' + esc(meta.title || 'Article') + '</span>' + src +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="shelfd-share-search-row">' +
          '<input class="shelfd-share-search" type="text" placeholder="Search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" data-search aria-label="Search friends and group chats">' +
        '</div>' +
        '<div class="shelfd-share-people" data-people>' + peopleHtml() + '</div>' +
        '<div class="shelfd-share-footer">' +
          '<input type="text" class="shelfd-share-note" data-note placeholder="Write a message…" maxlength="500" autocomplete="off" autocapitalize="sentences" aria-label="Write a message" hidden>' +
          '<button type="button" class="shelfd-share-send" data-send hidden>Send</button>' +
          '<div class="shelfd-share-actions">' +
            '<button type="button" class="shelfd-share-action" data-copy>' +
              '<span class="shelfd-share-action-icon">' + linkIconSvg() + '</span>' +
              '<span class="shelfd-share-action-label">Copy link</span>' +
            '</button>' +
            '<button type="button" class="shelfd-share-action" data-native>' +
              '<span class="shelfd-share-action-icon">' + shareIconSvg() + '</span>' +
              '<span class="shelfd-share-action-label">Share to…</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------- selection + send button ---------- */
  function selectedRecipientKeys() { return Object.keys(state.selected).filter(function (key) { return state.selected[key]; }); }
  function refreshSendButton(overlay) {
    var btn = overlay.querySelector('[data-send]');
    var note = overlay.querySelector('[data-note]');
    var n = selectedRecipientKeys().length;
    if (note) note.hidden = (n === 0);   // message field rides with the Send button
    if (!btn) return;
    if (n > 0 && !state.sending) {
      btn.hidden = false;
      btn.disabled = false;
      btn.textContent = n === 1 ? 'Send' : ('Send to ' + n);
    } else if (state.sending) {
      btn.hidden = false; btn.disabled = true;
      btn.classList.add('is-sending'); btn.textContent = 'Sending…';
    } else {
      btn.hidden = true; btn.classList.remove('is-sending');
    }
  }

  /* ---------- send (no navigation) ---------- */
  function ensureThreadId(uid) {
    /* Existing thread → use its id directly (never opens the DM page). New thread
       with a friend → create quietly (the create path does not navigate). */
    try {
      if (typeof getDirectMessageThreadWithUser === 'function') {
        var ex = getDirectMessageThreadWithUser(uid);
        if (ex && ex.id) return Promise.resolve(ex.id);
      }
    } catch (e) {}
    var isFriend = (typeof isDirectMessageFriend === 'function') ? isDirectMessageFriend(uid) : true;
    if (!isFriend) return Promise.resolve(null);   // non-friend w/o thread: skip in v1
    if (typeof openOrCreateDirectMessageThreadForUser !== 'function') return Promise.resolve(null);
    return Promise.resolve(openOrCreateDirectMessageThreadForUser(uid))
      .then(function (t) { return (t && t.id) ? t.id : null; })
      .catch(function () { return null; });
  }

  function doSend(overlay) {
    if (state.sending) return;
    var recipientKeys = selectedRecipientKeys();
    if (!recipientKeys.length || !state.meta) return;
    var meta = state.meta;
    var deep = deepLinkFor(meta);
    if (!deep) { toast('Could not build link'); return; }
    if (typeof appendDirectMessageToThread !== 'function') { toast('Messaging unavailable'); return; }
    var noteEl = overlay.querySelector('[data-note]');
    var note = noteEl ? String(noteEl.value || '').trim() : '';
    /* v11.676: DM card payload per content kind. Media uses the media payload shape
       (kind movie/tv/anime/game + id) so appendDirectMessageToThread →
       normalizeSharedMediaPayload renders a media-profile card; articles unchanged.
       v12.048: highlight shares use kind:'highlight' so the DM card tap opens the
       feed post page rather than falling into the news-reader article path. */
    var payload = (meta.shareKind === 'media')
      ? { kind: meta.mediaKind || 'movie', id: meta.mediaId || deep, title: meta.title || '', poster: meta.image || '', url: deep }
      : (meta.shareKind === 'highlight')
      ? { kind: 'highlight', id: deep, title: meta.title || 'Gaming Highlight', poster: meta.image || '', url: deep }
      : { kind: 'article', id: meta.url || deep, title: meta.title || 'Article', poster: meta.image || '', url: deep, source: meta.source || '' };

    state.sending = true;
    refreshSendButton(overlay);

    var ok = 0;
    var chain = Promise.resolve();
    recipientKeys.forEach(function (recipientKey) {
      chain = chain.then(function () {
        var tidPromise = recipientKey.indexOf('thread:') === 0
          ? Promise.resolve(recipientKey.slice(7))
          : ensureThreadId(recipientKey.indexOf('user:') === 0 ? recipientKey.slice(5) : recipientKey);
        return tidPromise.then(function (tid) {
          if (!tid) return;
          return Promise.resolve(appendDirectMessageToThread(tid, note, payload)).then(function (sent) { if (sent) ok++; });
        });
      }).catch(function () {});
    });
    chain.then(function () {
      state.sending = false;
      closeSheet();
      toast(ok > 0 ? (ok === 1 ? 'Sent' : ('Sent to ' + ok)) : 'Could not send');
    });
  }

  /* ---------- open / close ---------- */
  function closeSheet() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (typeof overlay._vvCleanup === 'function') { try { overlay._vvCleanup(); } catch (e) {} overlay._vvCleanup = null; }
    try { var nf = overlay.querySelector('[data-note]'); if (nf) nf.blur(); } catch (e) {}   // dismiss the keyboard
    overlay.classList.remove('is-open');
    document.body.classList.remove('shelfd-share-sheet-open');
    var sheet = overlay.querySelector('[data-sheet]');
    if (sheet) sheet.style.transform = '';   // clear any keyboard/drag transform so it animates down
    window.setTimeout(function () { if (overlay && overlay.parentNode) overlay.remove(); }, 380);
  }

  function openSheet(meta) {
    meta = meta || {};
    if (!meta.url) return;
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    state.meta = {
      url: String(meta.url || ''),
      title: String(meta.title || ''),
      source: String(meta.source || ''),
      image: /^https?:\/\//i.test(meta.image || '') ? String(meta.image) : '',
      category: String(meta.category || meta.catlabel || ''),
      catKey: String(meta.catKey || ''),
      topics: Array.isArray(meta.topics) ? meta.topics.slice(0, 8) : [],
      summary: String(meta.summary || ''),
      mediaType: String(meta.mediaType || ''),
      videoAspectRatio: String(meta.videoAspectRatio || ''),
      videoOrientation: String(meta.videoOrientation || ''),
      videoAspectSource: String(meta.videoAspectSource || ''),
      videoAspectProbeUrl: String(meta.videoAspectProbeUrl || ''),
      thumbnailWidth: String(meta.thumbnailWidth || ''),
      thumbnailHeight: String(meta.thumbnailHeight || ''),
      /* v11.676: 'media' = a Full Page Media Profile share (movie/tv/anime/game)
         reusing this exact sheet; default 'article' = the original News Feed share.
         v12.048: preserve 'highlight' so deepLinkFor returns the raw post URL instead
         of wrapping it in /article/{base64}, which caused the news reader to open. */
      shareKind: meta.shareKind === 'media' ? 'media' : meta.shareKind === 'highlight' ? 'highlight' : 'article',
      mediaKind: String(meta.mediaKind || ''),
      mediaId: String(meta.mediaId || '')
    };
    /* News-share taste is an ARTICLE ranking signal only — media-profile and
       highlight shares must NOT feed it. */
    if (state.meta.shareKind !== 'media' && state.meta.shareKind !== 'highlight') {
      try {
        if (typeof window.shelfdNewsRecordShare === 'function') {
          window.shelfdNewsRecordShare(state.meta);
          state.meta.__newsShareRecorded = true;
        } else if (typeof window.shelfdNewsRecordTaste === 'function') {
          window.shelfdNewsRecordTaste(state.meta, 4);
          state.meta.__newsShareRecorded = true;
        }
      } catch (e) {}
    }
    state.selected = {};
    state.query = '';
    state.sending = false;

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'shelfd-share-overlay';
    overlay.innerHTML = buildSheetHtml(state.meta);
    document.body.appendChild(overlay);
    document.body.classList.add('shelfd-share-sheet-open');
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });

    wireEvents(overlay);
  }

  /* ---------- events ---------- */
  function wireEvents(overlay) {
    // backdrop tap closes
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSheet(); });

    // recipient toggle (delegated)
    var people = overlay.querySelector('[data-people]');
    if (people) {
      people.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.shelfd-share-person[data-recipient-key]') : null;
        if (!btn) return;
        var key = btn.getAttribute('data-recipient-key');
        if (!key) return;
        if (state.selected[key]) { delete state.selected[key]; btn.classList.remove('is-selected'); btn.setAttribute('aria-pressed', 'false'); }
        else { state.selected[key] = true; btn.classList.add('is-selected'); btn.setAttribute('aria-pressed', 'true'); }
        refreshSendButton(overlay);
      });
    }

    // search
    var search = overlay.querySelector('[data-search]');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value || '';
        var p = overlay.querySelector('[data-people]');
        if (p) p.innerHTML = peopleHtml();   // selected state persists via state.selected
        refreshSendButton(overlay);
      });
    }

    // send
    var send = overlay.querySelector('[data-send]');
    if (send) send.addEventListener('click', function () { doSend(overlay); });

    // copy link
    var copy = overlay.querySelector('[data-copy]');
    if (copy) copy.addEventListener('click', function () {
      var deep = deepLinkFor(state.meta);
      if (!deep) { toast('Could not build link'); return; }
      var done = function () { toast('Link copied'); closeSheet(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(deep).then(done).catch(function () { try { window.prompt('Copy this link', deep); } catch (e) {} closeSheet(); });
      } else { try { window.prompt('Copy this link', deep); } catch (e) {} closeSheet(); }
    });

    // native "Share to…" (the original iOS sheet) — routed by content kind (v11.676)
    var native = overlay.querySelector('[data-native]');
    if (native) native.addEventListener('click', function () {
      var meta = state.meta;
      var deep = deepLinkFor(meta);
      closeSheet();
      if (meta.shareKind === 'highlight') {
        if (navigator.share && deep) {
          try { navigator.share({ title: meta.title || 'Gaming highlight', url: deep }); } catch (e) {}
        }
      } else if (meta.shareKind === 'media' && typeof window.shelfdShareMediaProfileNative === 'function') {
        try { window.shelfdShareMediaProfileNative(meta); } catch (e) {}
      } else if (typeof window.shelfdShareNewsArticle === 'function') {
        try { window.shelfdShareNewsArticle(meta); } catch (e) {}
      }
    });

    bindNoteKeyboard(overlay);
    bindDrag(overlay);
  }

  /* Keep the message field visible above the iOS keyboard: while it's focused,
     lift the whole sheet by the keyboard height (visualViewport-based). A no-op
     when the webview already resizes itself for the keyboard (kb ≈ 0 then). */
  function bindNoteKeyboard(overlay) {
    var note = overlay.querySelector('[data-note]');
    if (!note || !window.visualViewport) return;
    var vv = window.visualViewport;
    var focused = false;
    function apply() {
      var sheet = overlay.querySelector('[data-sheet]');
      if (!sheet) return;
      var kb = Math.max(0, (window.innerHeight || 0) - vv.height - vv.offsetTop);
      sheet.style.transform = (focused && kb > 80) ? ('translate3d(0,-' + Math.round(kb) + 'px,0)') : '';
    }
    note.addEventListener('focus', function () { focused = true; apply(); });
    note.addEventListener('blur', function () { focused = false; apply(); });
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    overlay._vvCleanup = function () { try { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); } catch (e) {} };
  }

  /* ---------- drag-to-dismiss (grab zone only, so the list still scrolls) ---------- */
  function bindDrag(overlay) {
    var sheet = overlay.querySelector('[data-sheet]');
    var grab = overlay.querySelector('[data-grab]');
    if (!sheet || !grab) return;
    var startY = 0, dy = 0, dragging = false;
    function onStart(e) {
      var t = e.touches ? e.touches[0] : e;
      startY = t.clientY; dy = 0; dragging = true;
      sheet.style.transition = 'none';
    }
    function onMove(e) {
      if (!dragging) return;
      var t = e.touches ? e.touches[0] : e;
      dy = Math.max(0, t.clientY - startY);
      if (dy > 0 && e.cancelable) e.preventDefault();
      sheet.style.transform = 'translate3d(0,' + dy + 'px,0)';
      overlay.style.background = 'rgba(0,0,0,' + Math.max(0.12, 0.58 - dy / 600) + ')';
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      overlay.style.background = '';
      if (dy > 110) { closeSheet(); }
      else { sheet.style.transform = ''; }
    }
    grab.addEventListener('touchstart', onStart, { passive: true });
    grab.addEventListener('touchmove', onMove, { passive: false });
    grab.addEventListener('touchend', onEnd, { passive: true });
    grab.addEventListener('touchcancel', onEnd, { passive: true });
    // mouse (desktop) drag on the grab handle
    grab.addEventListener('mousedown', function (e) {
      onStart(e);
      function mm(ev) { onMove(ev); }
      function mu() { onEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
  }

  /* ---------- public ---------- */
  window.openShelfdNewsShareSheet = openSheet;
  window.closeShelfdNewsShareSheet = closeSheet;
})();
