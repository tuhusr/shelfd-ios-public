/* ============================================================================
   43-news-reader.js  (v11.709)
   In-app news reader. Tapping a News card opens a full-screen, editorial-dark
   reader INSIDE Shelfd (no external Safari): a worker endpoint
   (/api/news/article) extracts the article's readable body via Tavily and we
   render it in our own UI — hero, source attribution, clean paragraphs, and a
   "View original" escape hatch. Mirrors the Full Page Media Review overlay so
   the slide-in + edge-swipe-back behave identically (js/31 wires
   `.news-reader-back` + `#news-reader` into the drag engine).
   ========================================================================== */
(function () {
  'use strict';

  var FETCH_TIMEOUT_MS = 16000;
  var openToken = 0;   // bumped on every open/close so a slow fetch can't render into a stale overlay

  /* ---------- engagement tracking (v11.623) -----------------------------------
     The feed learns from HOW the article was read, not merely that it was opened.
     A session starts on open and finalizes on close (the single close path —
     back button AND edge-swipe both call closeNewsReaderOverlay):
       • quick bounce  (closed fast, barely scrolled)  → mild NEGATIVE taste
       • real read     → positive, scaled 1.0 → 3.5 by dwell time + scroll depth
     One signal per open (finalize is idempotent — it nulls the session first). */
  var activeRead = null;   // { meta, openAt, contentEl, maxFrac }
  function onReaderScroll() {
    if (!activeRead || !activeRead.contentEl) return;
    var el = activeRead.contentEl, sh = el.scrollHeight;
    if (sh <= 0) return;
    var f = (el.scrollTop + el.clientHeight) / sh;
    if (f < 0) f = 0; else if (f > 1) f = 1;
    if (f > activeRead.maxFrac) activeRead.maxFrac = f;
  }
  function startActiveRead(meta, contentEl) {
    activeRead = { meta: meta, openAt: Date.now(), contentEl: contentEl || null, maxFrac: 0 };
    if (contentEl && contentEl.addEventListener) {
      try { contentEl.addEventListener('scroll', onReaderScroll, { passive: true }); }
      catch (e) { try { contentEl.addEventListener('scroll', onReaderScroll); } catch (e2) {} }
    }
  }
  function finalizeActiveRead() {
    var ar = activeRead;
    if (!ar || !ar.meta) { activeRead = null; return; }
    activeRead = null;                                   // idempotent: clear BEFORE work
    try { if (ar.contentEl) ar.contentEl.removeEventListener('scroll', onReaderScroll); } catch (e) {}
    if (typeof window.shelfdNewsRecordTaste !== 'function') return;
    var dwellMs = Date.now() - ar.openAt;
    var el = ar.contentEl, scrollable = false, frac = ar.maxFrac || 0;
    try {
      if (el) {
        scrollable = el.scrollHeight > el.clientHeight + 8;
        if (scrollable) { var nf = (el.scrollTop + el.clientHeight) / el.scrollHeight; if (nf > frac) frac = nf; }
      }
    } catch (e) {}
    if (frac > 1) frac = 1; else if (frac < 0) frac = 0;
    var weight;
    if (scrollable) {
      /* long article: a bounce needs BOTH barely-any time AND barely-any scroll. */
      if (dwellMs < 4000 && frac < 0.15) weight = -0.8;
      else weight = 1.0 + Math.max(frac, Math.min(1, dwellMs / 30000)) * 2.5;   // 1.0 → 3.5
    } else {
      /* short article (fits on screen, can't scroll): only dwell tells us anything. */
      if (dwellMs < 3500) weight = -0.6;
      else weight = 1.0 + Math.min(1, dwellMs / 20000) * 2.0;                    // up to 3.0
    }
    try { window.shelfdNewsRecordTaste(ar.meta, weight); } catch (e) {}
  }

  /* ---------- escaping helpers (reuse app globals, fall back inline) ---------- */
  function esc(s) {
    if (typeof escHtml === 'function') { try { return escHtml(s); } catch (e) {} }
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escA(s) {
    if (typeof escAttr === 'function') { try { return escAttr(s); } catch (e) {} }
    return esc(s);
  }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./i, ''); } catch (e) { return ''; }
  }

  function backIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  }
  function shareIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M12 3L8 7M12 3l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';
  }
  function searchIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.75" cy="10.75" r="6.75"/><path d="M16.4 16.4 21 21"/></svg>';
  }
  /* v11.677: same heart path as the news card (js/42) so the reader heart is
     visually identical — outline by default, fills red (.is-bookmarked) on heart. */
  function heartIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  }
  function isArticleHearted(url) {
    try { return (typeof window.shelfdNewsIsArticleHearted === 'function') && window.shelfdNewsIsArticleHearted(url); }
    catch (e) { return false; }
  }

  /* ---------- share / deep-link (base64url of the article URL in the path) ---------- */
  function b64urlEncode(str) {
    try { return btoa(unescape(encodeURIComponent(String(str || '')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch (e) { return ''; }
  }
  function b64urlDecode(token) {
    try {
      var s = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return decodeURIComponent(escape(atob(s)));
    } catch (e) { return ''; }
  }
  function buildNewsArticleShareUrl(meta) {
    meta = meta || {};
    var url = String(meta.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return '';
    var token = b64urlEncode(url);
    if (!token) return '';
    var origin = String(window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com').replace(/\/+$/, '');
    var share = origin + '/article/' + token;
    var qs = [];
    if (meta.title) qs.push('title=' + encodeURIComponent(String(meta.title).slice(0, 120)));
    if (meta.source) qs.push('source=' + encodeURIComponent(String(meta.source).slice(0, 60)));
    if (/^https?:\/\//i.test(meta.image || '')) qs.push('image=' + encodeURIComponent(String(meta.image)));
    if (meta.category) qs.push('category=' + encodeURIComponent(String(meta.category).slice(0, 32)));
    if (String(meta.mediaType || '').toLowerCase() === 'video') qs.push('mediaType=video');
    if (meta.videoAspectRatio) qs.push('videoAspect=' + encodeURIComponent(String(meta.videoAspectRatio).slice(0, 20)));
    if (meta.videoOrientation) qs.push('videoOrientation=' + encodeURIComponent(String(meta.videoOrientation).slice(0, 16)));
    if (meta.videoAspectSource) qs.push('videoAspectSource=' + encodeURIComponent(String(meta.videoAspectSource).slice(0, 40)));
    if (meta.videoAspectProbeUrl) qs.push('videoAspectProbe=' + encodeURIComponent(String(meta.videoAspectProbeUrl).slice(0, 240)));
    if (meta.thumbnailWidth) qs.push('thumbnailWidth=' + encodeURIComponent(String(meta.thumbnailWidth).slice(0, 8)));
    if (meta.thumbnailHeight) qs.push('thumbnailHeight=' + encodeURIComponent(String(meta.thumbnailHeight).slice(0, 8)));
    return share + (qs.length ? ('?' + qs.join('&')) : '');
  }
  async function shelfdShareNewsArticle(meta) {
    meta = meta || {};
    var shareUrl = buildNewsArticleShareUrl(meta);
    if (!shareUrl) return;
    /* Sharing is the STRONGEST taste signal — the user values this story enough
       to send it to someone. Recorded on intent (the tap), before the sheet. */
    try {
      if (!meta.__newsShareRecorded) {
        if (typeof window.shelfdNewsRecordShare === 'function') window.shelfdNewsRecordShare(meta);
        else if (typeof window.shelfdNewsRecordTaste === 'function') window.shelfdNewsRecordTaste(meta, 4);
        meta.__newsShareRecorded = true;
      }
    } catch (e) {}
    try {
      /* v11.610: share ONLY the URL — no title/text — so Messages (and every
         other target) shows JUST the rich link preview (built from the page's
         OG tags) with NO extra body text attached under it. */
      if (navigator.share) { await navigator.share({ url: shareUrl }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        if (typeof showToast === 'function') showToast('Article link copied');
        return;
      }
    } catch (e) {}
    try { window.prompt('Copy this article link', shareUrl); } catch (e) {}
  }

  /* Parse an incoming /article/{token}?title=&source=&image=&category= deep link. */
  function parseScreenListNewsArticleRoute(urlLike) {
    var nextUrl;
    try {
      nextUrl = (typeof urlLike === 'string') ? new URL(urlLike, window.location.origin) : (urlLike || window.location);
    } catch (e) { return null; }
    var pathname = String((nextUrl && nextUrl.pathname) || '');
    var m = pathname.match(/^\/article\/([^/?#]+)/i);
    if (!m) return null;
    var articleUrl = b64urlDecode(m[1] || '');
    if (!/^https?:\/\//i.test(articleUrl)) return null;
    var sp;
    if (nextUrl && nextUrl.searchParams instanceof URLSearchParams) sp = nextUrl.searchParams;
    else { try { sp = new URL(String(urlLike || window.location.href), window.location.origin).searchParams; } catch (e) { sp = new URLSearchParams(); } }
    return {
      url: articleUrl,
      title: sp.get('title') || '',
      source: sp.get('source') || '',
      image: sp.get('image') || '',
      category: sp.get('category') || '',
      mediaType: sp.get('mediaType') || sp.get('media') || '',
      videoAspectRatio: sp.get('videoAspect') || sp.get('videoAspectRatio') || '',
      videoOrientation: sp.get('videoOrientation') || '',
      videoAspectSource: sp.get('videoAspectSource') || '',
      videoAspectProbeUrl: sp.get('videoAspectProbe') || sp.get('videoAspectProbeUrl') || '',
      thumbnailWidth: sp.get('thumbnailWidth') || '',
      thumbnailHeight: sp.get('thumbnailHeight') || ''
    };
  }

  function readerOrientationFromRatio(r) {
    if (r < 0.82) return 'portrait';
    if (r <= 1.18) return 'square';
    return 'landscape';
  }
  function isReaderShortsLike(meta) {
    return /(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/|\b#shorts\b|\bshorts\b)/i.test(String(meta && meta.url || '') + ' ' + String(meta && meta.title || ''));
  }
  function normalizeReaderVideoAspect(meta) {
    meta = meta || {};
    var s = String(meta.videoAspectRatio || '').trim();
    var o = String(meta.videoOrientation || '').toLowerCase();
    var m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      var w = Number(m[1]), h = Number(m[2]);
      if (w > 0 && h > 0) return { css: w + ' / ' + h, value: w + '/' + h, orientation: o || readerOrientationFromRatio(w / h) };
    }
    var n = Number(s || 0);
    if (Number.isFinite(n) && n > 0) return { css: n + ' / 1', value: String(n), orientation: o || readerOrientationFromRatio(n) };
    var tw = Number(meta.thumbnailWidth || 0), th = Number(meta.thumbnailHeight || 0);
    if (tw > 0 && th > 0) return { css: tw + ' / ' + th, value: tw + '/' + th, orientation: o || readerOrientationFromRatio(tw / th) };
    if (o === 'portrait' || isReaderShortsLike(meta)) return { css: '9 / 16', value: '9/16', orientation: 'portrait' };
    if (o === 'square') return { css: '1 / 1', value: '1/1', orientation: 'square' };
    return { css: '16 / 9', value: '16/9', orientation: 'landscape' };
  }
  function isReaderVideoMeta(meta) {
    return String(meta && meta.mediaType || '').toLowerCase() === 'video' || !!readerYouTubeId(meta && meta.url);
  }

  var sharedNewsArticleRouteOpening = false;
  function openSharedNewsArticleRoute(route) {
    route = route || parseScreenListNewsArticleRoute();
    if (!route || !route.url || sharedNewsArticleRouteOpening) return false;
    sharedNewsArticleRouteOpening = true;
    try {
      if (typeof prepareSharedMediaRouteView === 'function') { try { prepareSharedMediaRouteView(); } catch (e) {} }
      var isVideo = String(route.mediaType || '').toLowerCase() === 'video' || !!readerYouTubeId(route.url);
      openNewsReaderOverlay({
        url: route.url, title: route.title, source: route.source, image: route.image, category: route.category,
        mediaType: isVideo ? 'video' : route.mediaType,
        videoAspectRatio: route.videoAspectRatio,
        videoOrientation: route.videoOrientation,
        videoAspectSource: route.videoAspectSource,
        videoAspectProbeUrl: route.videoAspectProbeUrl,
        thumbnailWidth: route.thumbnailWidth,
        thumbnailHeight: route.thumbnailHeight,
        fromSharedRoute: true,
        returnToNewsFeedOnClose: isVideo
      });
      return true;
    } catch (e) {
      if (typeof showToast === 'function') showToast('Could not open article');
      return false;
    } finally {
      setTimeout(function () { sharedNewsArticleRouteOpening = false; }, 600);
    }
  }
  function skeletonHtml() {
    var line = '<div class="news-reader-skel-line"></div>';
    var block = '<div class="news-reader-skel-para">' + line + line + line + '<div class="news-reader-skel-line short"></div></div>';
    return '<div class="news-reader-skeleton" aria-hidden="true">' + block + block + block + '</div>';
  }

  function metaRowHtml(meta) {
    var bits = [];
    if (meta.category) bits.push('<span class="news-reader-cat">' + esc(meta.category) + '</span>');
    if (meta.source)   bits.push('<span class="news-reader-source">' + esc(meta.source) + '</span>');
    if (meta.time)     bits.push('<span class="news-reader-dot">·</span><span class="news-reader-time">' + esc(meta.time) + '</span>');
    return bits.length ? '<div class="news-reader-meta">' + bits.join('') + '</div>' : '';
  }

  function heroHtml(image) {
    if (!image) return '';
    return '<div class="news-reader-hero"><img src="' + escA(image) + '" alt="" decoding="async" ' +
      'onerror="this.closest(\'.news-reader-hero\').style.display=\'none\'"></div>';
  }
  function readerVideoThumb(meta, ytId) {
    if (meta && /^https?:\/\//i.test(meta.image || '')) return String(meta.image);
    return ytId ? ('https://i.ytimg.com/vi/' + encodeURIComponent(ytId) + '/hqdefault.jpg') : '';
  }
  function readerVideoShellHtml(meta) {
    var ytId = readerYouTubeId(meta && meta.url);
    var aspect = normalizeReaderVideoAspect(meta);
    var img = readerVideoThumb(meta, ytId);
    var imgHtml = img
      ? '<img src="' + escA(img) + '" alt="" loading="eager" decoding="async" crossorigin="anonymous" onload="window.shelfdNewsApplyImageAspect&&window.shelfdNewsApplyImageAspect(this)" onerror="this.style.display=\'none\'">'
      : '';
    return '<div class="news-reader-video-primary news-card-media news-card-media-video" data-news-reader-video' +
      ' data-news-url="' + escA(meta && meta.url || '') + '"' +
      ' data-news-title="' + escA(meta && meta.title || '') + '"' +
      ' data-news-video-id="' + escA(ytId || '') + '"' +
      ' data-news-video-orientation="' + escA(aspect.orientation) + '"' +
      ' data-news-video-aspect="' + escA(aspect.value) + '"' +
      ' data-news-video-aspect-source="' + escA(meta && meta.videoAspectSource || '') + '"' +
      ' data-news-video-aspect-probe="' + escA(meta && meta.videoAspectProbeUrl || '') + '"' +
      ' data-news-thumbnail-width="' + escA(meta && meta.thumbnailWidth || '') + '"' +
      ' data-news-thumbnail-height="' + escA(meta && meta.thumbnailHeight || '') + '"' +
      ' data-news-aspect-locked="1" style="--news-video-aspect:' + escA(aspect.css) + '">' +
        imgHtml +
        '<span class="news-card-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>' +
      '</div>';
  }

  /* The URL is placed ONLY in the href (correct attribute-escaping). We never
     build an inline onclick from it — interpolating a URL into a JS-string
     inside an onclick is XSS-injectable (HTML entity-decoding revives a quote
     before the JS parser runs). The open is wired with addEventListener in
     openNewsReaderOverlay, using the validated in-scope URL. */
  function originButtonHtml(url) {
    var host = hostOf(url);
    return '<a class="news-reader-origin" href="' + escA(url) + '" target="_blank" rel="noopener noreferrer" data-news-origin>' +
      '<span>View original' + (host ? ' on ' + esc(host) : '') + '</span>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>' +
      '</a>';
  }

  function bodyHtml(paragraphs) {
    var ps = (paragraphs || []).filter(Boolean);
    if (!ps.length) return '';
    return ps.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  }

  /* v11.631: render the publisher's STRUCTURE — headings, paragraphs, inline
     images (+captions), quotes — in document order, instead of flattening to a
     wall of <p> text. `heroUrl` is the image already shown at the top, so we
     don't repeat it as the first inline figure. */
  function normImg(u) { return String(u || '').split('#')[0].split('?')[0]; }
  function sanitizeReaderInlineHtml(html) {
    html = String(html || '').trim();
    if (!html) return '';
    if (typeof document === 'undefined' || !document.createElement) return esc(html);
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var allowed = { A: true, EM: true, STRONG: true, B: true, I: true, BR: true };
    function cleanNode(node) {
      var child = node.firstChild;
      while (child) {
        var next = child.nextSibling;
        if (child.nodeType === 1) {
          var tag = child.tagName;
          if (!allowed[tag]) {
            child.replaceWith(document.createTextNode(child.textContent || ''));
          } else {
            if (tag === 'A') {
              var href = child.getAttribute('href') || '';
              var ok = false;
              try {
                var u = new URL(href, window.location.origin);
                ok = /^https?:$/i.test(u.protocol);
                if (ok) child.setAttribute('href', u.href);
              } catch (e) {}
              if (!ok) {
                child.replaceWith(document.createTextNode(child.textContent || ''));
                child = next;
                continue;
              }
              child.setAttribute('target', '_blank');
              child.setAttribute('rel', 'noopener noreferrer');
              child.removeAttribute('onclick');
              child.removeAttribute('style');
              child.removeAttribute('class');
              child.removeAttribute('id');
            } else if (tag !== 'BR') {
              child.removeAttribute('onclick');
              child.removeAttribute('style');
              child.removeAttribute('class');
              child.removeAttribute('id');
            }
            cleanNode(child);
          }
        } else if (child.nodeType !== 3) {
          child.remove();
        }
        child = next;
      }
    }
    cleanNode(tpl.content);
    return tpl.innerHTML.trim();
  }
  function blockInlineHtml(block) {
    var safe = sanitizeReaderInlineHtml(block && block.html);
    if (safe) return safe;
    return esc(block && block.text || '');
  }
  function blocksHtml(blocks, heroUrl) {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    var hero = normImg(heroUrl);
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || !b.type) continue;
      if (b.type === 'heading') {
        var t = String(b.text || '').trim(); if (!t) continue;
        var lvl = (b.level === 2) ? 2 : (b.level === 4 ? 4 : 3);
        out.push('<h' + lvl + ' class="news-reader-h news-reader-h' + lvl + '">' + blockInlineHtml(b) + '</h' + lvl + '>');
      } else if (b.type === 'image') {
        if (!/^https?:\/\//i.test(b.src || '')) continue;
        if (hero && normImg(b.src) === hero) continue;          // don't repeat the hero
        var cap = b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '';
        /* v11.632: eager (not lazy) so every photo starts downloading the moment
           the article renders — no scroll-triggered pop-in further down the page. */
        out.push('<figure class="news-reader-fig"><img src="' + escA(b.src) + '" alt="' + escA(b.alt || '') + '" loading="eager" decoding="async" onerror="this.closest(\'.news-reader-fig\').style.display=\'none\'">' + cap + '</figure>');
      } else if (b.type === 'quote') {
        var q = String(b.text || '').trim(); if (!q) continue;
        out.push('<blockquote class="news-reader-quote">' + blockInlineHtml(b) + '</blockquote>');
      } else {
        var p = String(b.text || '').trim(); if (!p) continue;
        out.push('<p>' + blockInlineHtml(b) + '</p>');
      }
    }
    return out.join('');
  }

  /* v11.633: some publishers (Valnet/Screen Rant, etc.) render only the first N
     ranking items server-side and lazy-load the rest via JS — there's no page-2
     URL to fetch, so we can't pull the back half. When the worker flags this, we
     hand off cleanly to the source instead of dead-ending mid-list. */
  function continueCardHtml(meta, data) {
    var srcRaw = String(meta.source || hostOf(meta.url) || 'the original site');
    var got = parseInt(data && data.gotItems, 10) || 0;
    var exp = parseInt(data && data.expectedItems, 10) || 0;
    var sub = (got && exp) ? ('Showing ' + got + ' of ' + exp + ' — the rest loads on their page.') : 'The full list loads on their page.';
    return '<div class="news-reader-continue">' +
      '<div class="news-reader-continue-head">' +
        '<strong>This list continues on ' + esc(srcRaw) + '</strong>' +
        '<span>' + esc(sub) + '</span>' +
      '</div>' +
      '<a class="news-reader-continue-btn" href="' + escA(meta.url) + '" target="_blank" rel="noopener noreferrer" data-news-continue><span>Continue reading</span>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>' +
      '</a>' +
    '</div>';
  }
  function appendContinueCard(meta, data) {
    var page = document.getElementById('news-reader');
    if (!page) return;
    var bodyEl = page.querySelector('[data-news-reader-body]');
    if (!bodyEl || bodyEl.querySelector('.news-reader-continue')) return;
    bodyEl.insertAdjacentHTML('beforeend', continueCardHtml(meta, data));
    var btn = bodyEl.querySelector('[data-news-continue]');
    if (btn) btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof window.shelfdOpenNewsArticle === 'function') window.shelfdOpenNewsArticle(meta.url);
      else { try { window.open(meta.url, '_blank', 'noopener'); } catch (e2) {} }
    });
  }

  /* ---------- overlay shell ---------- */
  function buildShellHtml(meta) {
    var topSource = meta.source || hostOf(meta.url) || 'Article';
    var isVideo = isReaderVideoMeta(meta);
    return '' +
      '<div class="news-reader-shell">' +
        '<header class="news-reader-topbar">' +
          '<button class="news-reader-back" type="button" onclick="closeNewsReaderOverlay()" aria-label="Back">' + backIconSvg() + '</button>' +
          '<span class="news-reader-topbar-title">' + esc(topSource) + '</span>' +
          /* v11.677: Heart — same per-article state as the feed card. Initial fill
             reflects the saved state so opening an already-hearted article shows it
             hearted; tapping syncs back to the card + the personalization taste. */
          '<button class="news-reader-heart' + (isArticleHearted(meta.url) ? ' is-bookmarked' : '') + '" type="button" aria-label="Heart article" aria-pressed="' + (isArticleHearted(meta.url) ? 'true' : 'false') + '" data-news-reader-heart>' + heartIconSvg() + '</button>' +
          '<button class="news-reader-search" type="button" aria-label="Search / Add to Shelf" title="Add to Shelf" data-news-reader-search>' + searchIconSvg() + '</button>' +
          '<button class="news-reader-share" type="button" aria-label="Share article" data-news-reader-share>' + shareIconSvg() + '</button>' +
        '</header>' +
        '<main class="news-reader-content">' +
          (isVideo ? '' : heroHtml(meta.image)) +
          '<article class="news-reader-article' + (isVideo ? ' news-reader-article-video' : '') + '">' +
            (meta.title ? '<h1 class="news-reader-title">' + esc(meta.title) + '</h1>' : '') +
            (isVideo ? readerVideoShellHtml(meta) : '') +
            metaRowHtml(meta) +
            '<div class="news-reader-body" data-news-reader-body>' + (isVideo ? '' : skeletonHtml()) + '</div>' +
            '<div class="news-reader-foot" data-news-reader-foot>' + originButtonHtml(meta.url) + '</div>' +
          '</article>' +
        '</main>' +
      '</div>';
  }

  function renderBody(html, opts) {
    var page = document.getElementById('news-reader');
    if (!page) return;
    var bodyEl = page.querySelector('[data-news-reader-body]');
    if (bodyEl) bodyEl.innerHTML = html;
    if (opts && opts.attribution) {
      var foot = page.querySelector('[data-news-reader-foot]');
      if (foot && !foot.querySelector('.news-reader-attrib')) {
        foot.insertAdjacentHTML('afterbegin', '<p class="news-reader-attrib">' + esc(opts.attribution) + '</p>');
      }
    }
  }

  /* ---------- fetch + render the extracted article ---------- */
  function loadArticle(meta, token) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) { try { controller.abort(); } catch (e) {} } }, FETCH_TIMEOUT_MS);
    var url = '/api/news/article?url=' + encodeURIComponent(meta.url);
    fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        clearTimeout(timer);
        if (token !== openToken) return;                 // overlay was closed / replaced
        var hasBlocks = data && Array.isArray(data.blocks) && data.blocks.length;
        var hasParas = data && Array.isArray(data.paragraphs) && data.paragraphs.length;
        if (data && data.ok && (hasBlocks || hasParas)) {
          var heroUrl = meta.image || (data && data.image) || '';
          renderBody(hasBlocks ? blocksHtml(data.blocks, heroUrl) : bodyHtml(data.paragraphs));
          // prefer the publisher hero if the card had none
          if (!meta.image && data.image) {
            var page = document.getElementById('news-reader');
            var content = page && page.querySelector('.news-reader-content');
            if (content && !content.querySelector('.news-reader-hero')) {
              content.insertAdjacentHTML('afterbegin', heroHtml(data.image));
            }
          }
          if (data && data.truncated) appendContinueCard(meta, data);
        } else {
          renderFallback(meta, data && data.error);
        }
      })
      .catch(function () {
        clearTimeout(timer);
        if (token !== openToken) return;
        renderFallback(meta, '');
      });
  }

  function renderFallback(meta, serverError) {
    var note = serverError || 'We couldn’t load a readable version of this story.';
    var summary = meta.summary
      ? '<p class="news-reader-fallback-summary">' + esc(meta.summary) + '</p>'
      : '';
    renderBody(
      '<div class="news-reader-fallback">' +
        summary +
        '<p class="news-reader-fallback-note">' + esc(note) + ' Tap below to read it on the source site.</p>' +
      '</div>'
    );
  }

  /* ---------- open / close ---------- */
  function returnSharedVideoReaderToNewsFeed() {
    try { if (typeof closeActivityPage === 'function') closeActivityPage(); } catch (e) {}
    try { if (typeof setMainNavVisibility === 'function') setMainNavVisibility('community'); } catch (e) {}
    try { if (typeof syncMainNavButtons === 'function') syncMainNavButtons('community'); } catch (e) {}
    try { if (typeof switchFriendsTab === 'function') switchFriendsTab('activity'); } catch (e) {}
    try {
      if (typeof switchActivitySubTab === 'function') {
        var p = switchActivitySubTab('news');
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) {}
    try { if (typeof renderNewsActivityFeed === 'function') renderNewsActivityFeed(); } catch (e) {}
  }
  function closeNewsReaderOverlay(immediate, opts) {
    finalizeActiveRead();                                 // learn from this read before tearing down
    var page = document.getElementById('news-reader');
    var shouldReturnToNews = !!(page && page.dataset.newsReaderReturnNews === '1' && !(opts && opts.skipSharedReturn));
    try {
      if (page && page.querySelector('[data-news-reader-video]') && typeof window.shelfdStopNewsInlineVideo === 'function') {
        window.shelfdStopNewsInlineVideo();
      }
    } catch (e) {}
    openToken++;                                          // invalidate any in-flight fetch
    document.removeEventListener('keydown', onKeydown);
    document.body.classList.remove('news-reader-open');
    if (!page) return;
    if (immediate === true) {
      page.remove();
      if (shouldReturnToNews) setTimeout(returnSharedVideoReaderToNewsFeed, 0);
      return;
    }
    page.classList.remove('is-open');
    setTimeout(function () {
      if (page && page.parentNode) page.remove();
      if (shouldReturnToNews) returnSharedVideoReaderToNewsFeed();
    }, 320);
  }

  function openNewsReaderUniversalSearch() {
    requestAnimationFrame(function () {
      if (typeof window.openSearchPage === 'function') {
        window.openSearchPage({ returnTo: 'news-reader' });
        return;
      }
      var navSearch = document.getElementById('mobile-nav-search');
      if (navSearch && typeof navSearch.click === 'function') {
        navSearch.click();
        return;
      }
      if (typeof showToast === 'function') showToast('Search is unavailable');
    });
  }

  function onKeydown(e) {
    if (e && e.key === 'Escape') closeNewsReaderOverlay();
  }

  /* v11.655: a YouTube "article" is a TRAILER — play it in the reader instead of
     running it through article extraction (which returns nothing for a video). */
  function readerYouTubeId(url) {
    var u = String(url || '');
    var m = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{6,})/);
    return m ? m[1] : '';
  }
  function renderReaderYouTube(token, ytId, meta) {
    if (token !== openToken) return;
    var page = document.getElementById('news-reader');
    if (!page) return;
    var videoEl = page.querySelector('[data-news-reader-video]');
    if (!videoEl) return;
    meta = meta || {};
    meta.mediaType = 'video';
    if (!meta.videoAspectRatio || !meta.videoOrientation) {
      var aspect = normalizeReaderVideoAspect(meta);
      meta.videoAspectRatio = aspect.value;
      meta.videoOrientation = aspect.orientation;
    }
    if (typeof window.shelfdMountNewsInlineVideo === 'function' &&
        window.shelfdMountNewsInlineVideo(videoEl, meta, { muted: true, wantSound: true })) {
      return;
    }
    var src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(ytId) + '?autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=1&fs=1';
    videoEl.classList.add('is-playing');
    videoEl.innerHTML = '<iframe src="' + escA(src) + '" title="' + escA(meta.title || 'Video') + '" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen playsinline></iframe>';
  }

  function openNewsReaderOverlay(meta) {
    meta = meta || {};
    var u = String(meta.url || '').trim();
    if (!u || !/^https?:\/\//i.test(u)) { return; }

    // finalize any in-progress read FIRST (records its engagement-weighted taste
    // while its DOM still holds the final scroll position) — covers reopening via
    // a deep link / rapid taps without going through closeNewsReaderOverlay.
    finalizeActiveRead();
    // tear down any existing reader instantly (no animation collision)
    var existing = document.getElementById('news-reader');
    if (existing) existing.remove();

    var token = ++openToken;
    var overlay = document.createElement('div');
    overlay.id = 'news-reader';
    overlay.className = 'news-reader-page';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', meta.title ? (String(meta.title) + ' — article') : 'Article');
    overlay.dataset.newsUrl = u;
    var normMeta = {
      url: u,
      id: String(meta.id || '').trim(),
      providerId: String(meta.providerId || meta.providerArticleId || meta.articleId || '').trim(),
      eventId: String(meta.eventId || meta.eventUri || meta.storyId || '').trim(),
      storyKey: String(meta.storyKey || '').trim(),
      title: String(meta.title || '').trim(),
      source: String(meta.source || '').trim(),
      image: /^https?:\/\//i.test(meta.image || '') ? String(meta.image) : '',
      time: String(meta.time || '').trim(),
      category: String(meta.category || '').trim(),
      catKey: String(meta.catKey || '').trim(),
      topics: Array.isArray(meta.topics) ? meta.topics.slice(0, 8) : [],
      summary: String(meta.summary || '').trim(),
      mediaType: String(meta.mediaType || '').trim(),
      videoAspectRatio: String(meta.videoAspectRatio || '').trim(),
      videoOrientation: String(meta.videoOrientation || '').trim(),
      videoAspectSource: String(meta.videoAspectSource || '').trim(),
      videoAspectProbeUrl: String(meta.videoAspectProbeUrl || '').trim(),
      thumbnailWidth: String(meta.thumbnailWidth || '').trim(),
      thumbnailHeight: String(meta.thumbnailHeight || '').trim(),
      fromSharedRoute: !!meta.fromSharedRoute,
      returnToNewsFeedOnClose: !!meta.returnToNewsFeedOnClose
    };
    if (isReaderVideoMeta(normMeta)) {
      normMeta.mediaType = 'video';
      var readerAspect = normalizeReaderVideoAspect(normMeta);
      normMeta.videoAspectRatio = readerAspect.value;
      normMeta.videoOrientation = readerAspect.orientation;
    }
    if (normMeta.returnToNewsFeedOnClose) overlay.dataset.newsReaderReturnNews = '1';
    overlay.innerHTML = buildShellHtml(normMeta);

    document.body.appendChild(overlay);
    document.body.classList.add('news-reader-open');
    document.addEventListener('keydown', onKeydown);
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });

    /* v11.623: feed the smart-feed algorithm. Opening lowers the article's
       repeat chance immediately (recordOpen). The TASTE signal is DEFERRED to
       close — its weight depends on HOW the user read (dwell + scroll depth),
       computed in finalizeActiveRead(). Start the engagement session now. */
    try { if (typeof window.shelfdNewsRecordOpen === 'function') window.shelfdNewsRecordOpen(normMeta); } catch (e) {}
    try { if (typeof window.shelfdNewsRecordTaste === 'function') window.shelfdNewsRecordTaste(normMeta, 0.8); } catch (e) {}
    startActiveRead(normMeta, overlay.querySelector('.news-reader-content'));

    // "View original" — open via JS with the validated in-scope URL (no inline
    // onclick, so a hostile URL can't break out of a JS-string context).
    var originBtn = overlay.querySelector('.news-reader-origin');
    if (originBtn) {
      originBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.shelfdOpenNewsArticle === 'function') window.shelfdOpenNewsArticle(normMeta.url);
      });
    }
    // Share — native share sheet / clipboard fallback with the deep link.
    var shareBtn = overlay.querySelector('[data-news-reader-share]');
    if (shareBtn) {
      shareBtn.addEventListener('click', function (e) {
        e.preventDefault();
        /* v11.626: open the in-app "send to a friend" sheet (js/44); fall back to
           the native share sheet if it isn't loaded for any reason. */
        if (typeof window.openShelfdNewsShareSheet === 'function') window.openShelfdNewsShareSheet(normMeta);
        else shelfdShareNewsArticle(normMeta);
      });
    }
    /* v11.677: Heart — toggles the SAME per-article like state as the feed card
       (js/42 shared API), which persists it, records the strong taste signal into
       the personalization algorithm, and syncs every on-screen card so the state
       matches when the user goes back. Red fill + pop on heart, mirroring the card. */
    var searchBtn = overlay.querySelector('[data-news-reader-search]');
    if (searchBtn) {
      searchBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        openNewsReaderUniversalSearch();
      });
    }
    var heartBtn = overlay.querySelector('[data-news-reader-heart]');
    if (heartBtn) {
      heartBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.shelfdNewsToggleArticleHeart !== 'function') return;
        var on = window.shelfdNewsToggleArticleHeart(normMeta.url, normMeta);
        heartBtn.classList.toggle('is-bookmarked', !!on);
        heartBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) {
          heartBtn.classList.remove('heart-pop');
          void heartBtn.offsetWidth;                       // restart the animation on rapid taps
          heartBtn.classList.add('heart-pop');
          setTimeout(function () { heartBtn.classList.remove('heart-pop'); }, 480);
        }
      });
    }

    var ytId = readerYouTubeId(normMeta.url);
    if (ytId) { renderReaderYouTube(token, ytId, normMeta); return; }   // trailers play, no extraction
    loadArticle(normMeta, token);
  }

  /* Open a news article from a DM "shared article" card (v11.626). The deep link
     lives on the element (data-article-deeplink / href) — we never take it as an
     inline JS-string arg — so a tampered DM can't inject. Parse it back to the
     original article + meta and open the in-app reader. */
  function openSharedNewsArticleFromDm(event, el) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    var deepLink = '';
    try { deepLink = (el && el.getAttribute) ? (el.getAttribute('data-article-deeplink') || el.getAttribute('href') || '') : ''; } catch (e) {}
    var route = parseScreenListNewsArticleRoute(deepLink);
    if (!route || !route.url) return false;
    try { if (typeof closeDirectMessagesPage === 'function') closeDirectMessagesPage(true); } catch (e) {}
    try { if (typeof prepareSharedMediaRouteView === 'function') prepareSharedMediaRouteView(); } catch (e) {}
    var isVideo = String(route.mediaType || '').toLowerCase() === 'video' || !!readerYouTubeId(route.url);
    openNewsReaderOverlay({
      url: route.url,
      title: route.title,
      source: route.source,
      image: route.image,
      category: route.category,
      mediaType: isVideo ? 'video' : route.mediaType,
      videoAspectRatio: route.videoAspectRatio,
      videoOrientation: route.videoOrientation,
      videoAspectSource: route.videoAspectSource,
      videoAspectProbeUrl: route.videoAspectProbeUrl,
      thumbnailWidth: route.thumbnailWidth,
      thumbnailHeight: route.thumbnailHeight
    });
    return false;
  }

  /* ---------- public ---------- */
  window.openSharedNewsArticleFromDm = openSharedNewsArticleFromDm;
  window.openNewsReaderOverlay = openNewsReaderOverlay;
  window.closeNewsReaderOverlay = closeNewsReaderOverlay;
  /* alias used by js/42's card dispatcher */
  window.openShelfdNewsReader = openNewsReaderOverlay;
  /* share + deep-link (used by js/42 cards + the 3 boot route dispatchers) */
  window.shelfdShareNewsArticle = shelfdShareNewsArticle;
  window.buildNewsArticleShareUrl = buildNewsArticleShareUrl;
  window.parseScreenListNewsArticleRoute = parseScreenListNewsArticleRoute;
  window.openSharedNewsArticleRoute = openSharedNewsArticleRoute;
})();
