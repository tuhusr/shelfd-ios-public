/*
   52-profile-character-editor.js
   Extracted from 15-profile-settings.js to keep surface ownership explicit.
*/
/* ============================================================================
   v465: Top 3 Fictional Characters editor
   ----------------------------------------------------------------------------
   - Mobile/PWA-first centered modal (own overlay, not the legacy bottom-sheet).
   - Character name input.
   - Tavily web image search (worker route /api/tavily/character-image-search).
   - Upload from phone with 2:3 poster-shape crop (drag to reposition,
     pinch/slider to zoom, render to canvas at save).
   - Saves only the targeted slot's name + image; preserves all unrelated
     showcaseFavorites entries and other profile fields.
   ========================================================================== */

let profileCharacterEditorState = null;
let profileCharacterSearchSeq = 0;
let profileCharacterSearchTimer = null;

function getProfilePosterEditorStateFromCard(card) {
  const databaseMode = card?.classList?.contains('profile-db-slot');
  const section = databaseMode ? card.dataset.profileDbSection : card.dataset.manualSection;
  const config = getProfileFavoriteConfig(section) || { label: 'Profile Pick', shortLabel: 'Pick', namePlaceholder: 'Name' };
  const slotIndex = Number(databaseMode ? card.dataset.profileDbIndex || 0 : card.dataset.manualIndex || 0);
  const name = databaseMode ? (card.dataset.profileDbTitle || '').trim() : (card.dataset.manualName || '').trim();
  const image = databaseMode ? (card.dataset.profileDbImage || '').trim() : (card.dataset.manualImage || '').trim();
  return {
    mode: databaseMode ? 'database' : 'manual',
    section,
    config,
    slotIndex,
    name,
    image,
    rating: databaseMode ? (card.dataset.profileDbRating || '').trim() : (card.dataset.manualRating || '').trim(),
    searchQuery: name
  };
}

function getProfilePosterEditorSlotLabel(state = profileCharacterEditorState) {
  const label = state?.config?.shortLabel || state?.config?.label || 'Pick';
  return `${label} ${Number(state?.slotIndex || 0) + 1}`;
}

function getProfilePosterEditorNameLabel(state = profileCharacterEditorState) {
  if (state?.section === 'fictionalCharacters') return 'Character name';
  if (state?.section === 'musicArtists') return 'Artist name';
  return 'Name';
}

function getProfilePosterEditorNamePlaceholder(state = profileCharacterEditorState) {
  return state?.config?.namePlaceholder || (state?.section === 'musicArtists' ? 'Artist' : state?.section === 'directors' ? 'Director' : state?.section === 'actors' ? 'Actor' : 'Name');
}

function ensureProfileCharacterEditorOverlay() {
  let overlay = document.getElementById('profile-character-editor-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'profile-character-editor-overlay';
    overlay.className = 'profile-character-editor-overlay';
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeProfileCharacterEditor();
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function openProfileCharacterEditor(event, card) {
  if (isViewingOtherProfile() || !card) return;
  if (event) event.stopPropagation();
  const base = getProfilePosterEditorStateFromCard(card);
  profileCharacterEditorState = {
    ...base,
    card,
    pendingImage: null,
    pendingImageSource: '',
    cropState: null,
    searchResults: [],
    searchStatus: ''
  };
  document.documentElement.classList.add('profile-character-editor-open');
  document.body.classList.add('profile-character-editor-open');
  renderProfileCharacterEditor();
}

function closeProfileCharacterEditor() {
  const overlay = document.getElementById('profile-character-editor-overlay');
  if (overlay) overlay.classList.remove('open');
  clearTimeout(profileCharacterSearchTimer);
  profileCharacterEditorState = null;
  document.documentElement.classList.remove('profile-character-editor-open');
  document.body.classList.remove('profile-character-editor-open');
}

function renderProfileCharacterEditor() {
  const state = profileCharacterEditorState;
  if (!state) return;
  const overlay = ensureProfileCharacterEditorOverlay();
  const slotLabel = getProfilePosterEditorSlotLabel(state);
  const previewImage = state.pendingImage || state.image || '';
  const previewStyle = previewImage ? `style="background-image:url('${previewImage.replace(/'/g, "%27")}')"` : '';
  const hasName = !!state.name;
  const hasImage = !!previewImage;
  const cropPanel = state.cropState
    ? renderProfileCharacterCropPanel(state.cropState)
    : '';
  overlay.innerHTML = `
    <div class="profile-character-editor-modal" role="dialog" aria-modal="true" aria-label="Edit ${slotLabel}">
      <div class="profile-character-editor-head">
        <div class="profile-character-editor-title-wrap">
          <div class="profile-character-editor-kicker">${escHtml(state.config?.label || 'Profile Pick')}</div>
          <div class="profile-character-editor-title">${escHtml(slotLabel)}</div>
        </div>
        <button type="button" class="profile-character-editor-close" onclick="closeProfileCharacterEditor()" aria-label="Close">×</button>
      </div>

      <div class="profile-character-editor-body">
        <div class="profile-character-preview-row">
          <div class="profile-character-preview-poster ${hasImage ? '' : 'profile-character-preview-empty'}" ${previewStyle} aria-hidden="true">
            ${hasImage ? '' : `<span class="profile-character-preview-rank">${state.slotIndex + 1}</span>`}
          </div>
          <div class="profile-character-preview-meta">
            <label class="profile-character-field-label" for="profile-character-name-input">${escHtml(getProfilePosterEditorNameLabel(state))}</label>
            <input id="profile-character-name-input" class="profile-character-field-input" type="text" maxlength="30" placeholder="${escAttr(getProfilePosterEditorNamePlaceholder(state))}" value="${escAttr(state.name)}" autocomplete="off" oninput="handleProfileCharacterNameInput(this.value)">
          </div>
        </div>

        ${cropPanel || `
          <div class="profile-character-section">
            <div class="profile-character-section-head">
              <div class="profile-character-section-title">Search the web</div>
              <div class="profile-character-section-sub">Find an image from Tavily.</div>
            </div>
            <form class="profile-character-search-form" onsubmit="event.preventDefault(); runProfileCharacterImageSearch();">
              <input id="profile-character-search-input" class="profile-character-field-input" type="text" placeholder="Search ${escAttr(state.config?.shortLabel || state.config?.label || 'person')}..." value="${escAttr(state.searchQuery)}" autocomplete="off">
              <button type="submit" class="profile-character-search-btn">Search</button>
            </form>
            <div id="profile-character-search-results" class="profile-character-search-results" data-state="${state.searchStatus || 'idle'}">
              ${renderProfileCharacterSearchResultsHTML(state)}
            </div>
          </div>

          <div class="profile-character-section">
            <div class="profile-character-section-head">
              <div class="profile-character-section-title">Upload from your phone</div>
              <div class="profile-character-section-sub">Crop to a vertical poster.</div>
            </div>
            <label class="profile-character-upload-btn">
              <input type="file" accept="image/*" onchange="handleProfileCharacterUploadInput(this)" style="display:none">
              <span>Choose photo</span>
            </label>
          </div>
        `}
      </div>

      <div class="profile-character-editor-actions">
        ${(hasName || hasImage || state.pendingImage) ? '<button type="button" class="profile-character-editor-clear" onclick="clearProfileCharacterSlotFromEditor()">Clear slot</button>' : ''}
        <button type="button" class="profile-character-editor-save" onclick="saveProfileCharacterFromEditor()">Save</button>
      </div>
    </div>
  `;
  overlay.classList.add('open');
  if (!state.cropState) {
    /* v617: requestAnimationFrame keeps us inside the user-gesture context
       so iOS Safari raises the keyboard when the input auto-focuses. */
    requestAnimationFrame(() => {
      const input = document.getElementById('profile-character-name-input');
      if (input) {
        input.focus();
        /* Move cursor to end of existing value */
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    });
  }
}

function renderProfileCharacterSearchResultsHTML(state) {
  if (state.searchStatus === 'loading') {
    return '<div class="profile-character-search-empty">Searching…</div>';
  }
  if (state.searchStatus === 'error') {
    return `<div class="profile-character-search-empty">${escHtml(state.searchError || "Search failed. Try a different query.")}</div>`;
  }
  if (state.searchStatus === 'empty') {
    return '<div class="profile-character-search-empty">No image results. Try another search term.</div>';
  }
  if (!state.searchResults || !state.searchResults.length) {
    return '<div class="profile-character-search-empty">Search to see image results.</div>';
  }
  return `<div class="profile-character-search-grid">${state.searchResults.map((hit, i) => {
    const safeUrl = String(hit.imageUrl || '').replace(/'/g, "%27");
    return `<button type="button" class="profile-character-search-tile" data-character-search-index="${i}" onclick="selectProfileCharacterSearchResult(${i})" aria-label="Use this image">
      <img src="${escAttr(hit.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('button').classList.add('profile-character-search-tile-broken')">
    </button>`;
  }).join('')}</div>`;
}

function handleProfileCharacterNameInput(value) {
  if (!profileCharacterEditorState) return;
  const input = document.getElementById('profile-character-name-input');
  const next = String(value || '').slice(0, 30);
  if (input && input.value !== next) input.value = next;
  profileCharacterEditorState.name = next.trim();
}

async function runProfileCharacterImageSearch() {
  const state = profileCharacterEditorState;
  if (!state) return;
  const queryEl = document.getElementById('profile-character-search-input');
  const query = String(queryEl?.value || '').trim();
  if (!query) return;
  state.searchQuery = query;
  state.searchStatus = 'loading';
  state.searchResults = [];
  state.searchError = '';
  const resultsEl = document.getElementById('profile-character-search-results');
  if (resultsEl) {
    resultsEl.dataset.state = 'loading';
    resultsEl.innerHTML = renderProfileCharacterSearchResultsHTML(state);
  }
  const seq = ++profileCharacterSearchSeq;
  try {
    const res = await fetch('/api/tavily/character-image-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 9 })
    });
    if (seq !== profileCharacterSearchSeq || !profileCharacterEditorState) return;
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data?.results) ? data.results.slice(0, 9) : [];
    if (!res.ok || !results.length) {
      state.searchStatus = res.ok ? 'empty' : 'error';
      state.searchError = String(data?.error || (res.ok ? '' : 'Search failed.'));
      state.searchResults = [];
    } else {
      state.searchStatus = 'ready';
      state.searchResults = results;
    }
  } catch (error) {
    if (seq !== profileCharacterSearchSeq || !profileCharacterEditorState) return;
    state.searchStatus = 'error';
    state.searchError = 'Network error. Please try again.';
    state.searchResults = [];
  }
  const finalEl = document.getElementById('profile-character-search-results');
  if (finalEl) {
    finalEl.dataset.state = state.searchStatus;
    finalEl.innerHTML = renderProfileCharacterSearchResultsHTML(state);
  }
}

function selectProfileCharacterSearchResult(index) {
  const state = profileCharacterEditorState;
  if (!state) return;
  const hit = state.searchResults?.[index];
  if (!hit?.imageUrl) return;
  state.pendingImage = hit.imageUrl;
  state.pendingImageSource = 'search';
  renderProfileCharacterEditor();
}

function handleProfileCharacterUploadInput(input) {
  const state = profileCharacterEditorState;
  if (!state) return;
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = String(e.target?.result || '');
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      // Init crop state — fit image into 2:3 frame (cover), centered, scale=1.
      // Drag/zoom adjust translate + scale. Save renders to 600×900 canvas.
      const aspect = 2 / 3;
      const frameW = 1, frameH = 1 / aspect; // unit space; we use pixels at render
      // Compute base scale so the image covers the frame at scale=1
      const imgRatio = img.width / img.height;
      // We treat the frame as 600×900 in pixel space.
      const FRAME_W = 600;
      const FRAME_H = 900;
      let baseScale;
      if (imgRatio > (FRAME_W / FRAME_H)) {
        // Image wider than frame relative to height — scale so height fills
        baseScale = FRAME_H / img.height;
      } else {
        baseScale = FRAME_W / img.width;
      }
      state.cropState = {
        dataUrl,
        img,
        FRAME_W,
        FRAME_H,
        baseScale,
        zoom: 1,           // user-adjustable multiplier on top of baseScale
        offsetX: 0,        // translation in frame pixels
        offsetY: 0,
        minZoom: 1,
        maxZoom: 4
      };
      renderProfileCharacterEditor();
      // After re-render, attach drag handlers and clamp.
      requestAnimationFrame(() => {
        installProfileCharacterCropInteractions();
      });
    };
    img.onerror = () => { showToast?.('Could not read image.'); };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
  // reset input so the same file can be re-selected
  try { input.value = ''; } catch (e) {}
}

function renderProfileCharacterCropPanel(crop) {
  return `
    <div class="profile-character-section">
      <div class="profile-character-section-head">
        <div class="profile-character-section-title">Adjust crop</div>
        <div class="profile-character-section-sub">Drag to reposition. Use the slider to zoom.</div>
      </div>
      <div class="profile-character-crop-stage" id="profile-character-crop-stage" data-character-crop-stage>
        <img class="profile-character-crop-image" id="profile-character-crop-image" src="${escAttr(crop.dataUrl)}" alt="" draggable="false">
        <div class="profile-character-crop-mask" aria-hidden="true"></div>
      </div>
      <div class="profile-character-crop-controls">
        <input id="profile-character-crop-zoom" class="profile-character-crop-zoom" type="range" min="1" max="4" step="0.01" value="${crop.zoom}" oninput="handleProfileCharacterCropZoom(this.value)">
        <div class="profile-character-crop-buttons">
          <button type="button" class="profile-character-editor-clear" onclick="cancelProfileCharacterCrop()">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function applyProfileCharacterCropTransform() {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const imgEl = document.getElementById('profile-character-crop-image');
  if (!imgEl) return;
  const crop = state.cropState;
  // Frame DOM size (CSS px). The transform is computed in CSS-px space using
  // the ratio of CSS-px to FRAME_H to keep behaviour proportional.
  const stage = document.getElementById('profile-character-crop-stage');
  if (!stage) return;
  const stageH = stage.clientHeight || 1;
  const cssScale = stageH / crop.FRAME_H;
  const finalScale = crop.baseScale * crop.zoom * cssScale;
  imgEl.style.transformOrigin = '0 0';
  imgEl.style.width = `${crop.img.width}px`;
  imgEl.style.height = `${crop.img.height}px`;
  imgEl.style.transform = `translate3d(${crop.offsetX * cssScale}px, ${crop.offsetY * cssScale}px, 0) scale(${finalScale})`;
}

function clampProfileCharacterCropOffsets() {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const crop = state.cropState;
  const scaledW = crop.img.width * crop.baseScale * crop.zoom;
  const scaledH = crop.img.height * crop.baseScale * crop.zoom;
  // Image (in FRAME pixel space) must always cover [0..FRAME_W] x [0..FRAME_H].
  // Offset is the top-left corner of the image inside the frame (FRAME px).
  const minX = crop.FRAME_W - scaledW;
  const maxX = 0;
  const minY = crop.FRAME_H - scaledH;
  const maxY = 0;
  crop.offsetX = Math.min(maxX, Math.max(minX, crop.offsetX));
  crop.offsetY = Math.min(maxY, Math.max(minY, crop.offsetY));
}

function installProfileCharacterCropInteractions() {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const stage = document.getElementById('profile-character-crop-stage');
  if (!stage) return;
  // Center the image initially
  const crop = state.cropState;
  const scaledW = crop.img.width * crop.baseScale * crop.zoom;
  const scaledH = crop.img.height * crop.baseScale * crop.zoom;
  crop.offsetX = (crop.FRAME_W - scaledW) / 2;
  crop.offsetY = (crop.FRAME_H - scaledH) / 2;
  clampProfileCharacterCropOffsets();
  applyProfileCharacterCropTransform();

  let dragging = false;
  let startX = 0, startY = 0;
  let startOffsetX = 0, startOffsetY = 0;
  const onPointerDown = e => {
    dragging = true;
    stage.setPointerCapture?.(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    startOffsetX = crop.offsetX; startOffsetY = crop.offsetY;
    e.preventDefault();
  };
  const onPointerMove = e => {
    if (!dragging) return;
    const stageH = stage.clientHeight || 1;
    const cssScale = stageH / crop.FRAME_H;
    const dxFrame = (e.clientX - startX) / cssScale;
    const dyFrame = (e.clientY - startY) / cssScale;
    crop.offsetX = startOffsetX + dxFrame;
    crop.offsetY = startOffsetY + dyFrame;
    clampProfileCharacterCropOffsets();
    applyProfileCharacterCropTransform();
  };
  const onPointerUp = e => { dragging = false; try { stage.releasePointerCapture?.(e.pointerId); } catch (err) {} };
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('pointerleave', onPointerUp);
  // Re-apply on viewport changes (orientation, keyboard)
  const onResize = () => applyProfileCharacterCropTransform();
  window.addEventListener('resize', onResize, { passive: true });
}

function handleProfileCharacterCropZoom(value) {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return;
  const crop = state.cropState;
  const next = Math.max(crop.minZoom, Math.min(crop.maxZoom, Number(value) || 1));
  // Keep crop centered around the same focal point of the frame
  const focusX = crop.FRAME_W / 2;
  const focusY = crop.FRAME_H / 2;
  const oldScale = crop.baseScale * crop.zoom;
  const newScale = crop.baseScale * next;
  // Image-space focal point under cursor (so it remains stable on zoom)
  const imgX = (focusX - crop.offsetX) / oldScale;
  const imgY = (focusY - crop.offsetY) / oldScale;
  crop.zoom = next;
  crop.offsetX = focusX - imgX * newScale;
  crop.offsetY = focusY - imgY * newScale;
  clampProfileCharacterCropOffsets();
  applyProfileCharacterCropTransform();
}

function cancelProfileCharacterCrop() {
  if (!profileCharacterEditorState) return;
  profileCharacterEditorState.cropState = null;
  renderProfileCharacterEditor();
}

function commitProfileCharacterCrop(options = {}) {
  const state = profileCharacterEditorState;
  if (!state?.cropState) return '';
  const crop = state.cropState;
  /* v618: Render at 400×600 (was 600×900) at q0.70 (was q0.85) so the
     base64 output stays well under Firestore's 1MiB document limit.
     Three posters at ~40KB each = ~120KB, safely leaving room for all
     other profile fields. The previous 600×900 q0.85 produced ~150KB
     per image — three of them could push the document over the limit and
     cause silent save failures, making data appear to revert. */
  const OUT_W = 400;
  const OUT_H = 600;
  const scaleX = OUT_W / crop.FRAME_W;
  const scaleY = OUT_H / crop.FRAME_H;
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const scaledW = crop.img.width * crop.baseScale * crop.zoom * scaleX;
  const scaledH = crop.img.height * crop.baseScale * crop.zoom * scaleY;
  ctx.drawImage(crop.img, crop.offsetX * scaleX, crop.offsetY * scaleY, scaledW, scaledH);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.70);
  state.pendingImage = dataUrl;
  state.pendingImageSource = 'upload';
  state.cropState = null;
  if (options.render !== false) renderProfileCharacterEditor();
  return dataUrl;
}

function saveProfileCharacterFromEditor() {
  const state = profileCharacterEditorState;
  if (!state || !state.card) return;
  // Read latest name input value (in case oninput hadn't fired)
  const nameInput = document.getElementById('profile-character-name-input');
  if (nameInput) state.name = String(nameInput.value || '').slice(0, 30).trim();
  if (state.cropState) commitProfileCharacterCrop({ render: false });
  const finalImage = state.pendingImage || state.image || '';
  if (state.mode === 'database') {
    state.card.dataset.profileDbTitle = state.name;
    state.card.dataset.profileDbImage = finalImage;
    state.card.dataset.profileDbSource = state.card.dataset.profileDbSource || 'custom';
    state.card.dataset.profileDbType = state.card.dataset.profileDbType || 'person';
    updateProfileDatabaseCardPreview(state.card);
  } else {
    state.card.dataset.manualName = state.name;
    state.card.dataset.manualImage = finalImage;
    state.card.dataset.manualRating = state.section === 'fictionalCharacters' ? '' : (state.rating || state.card.dataset.manualRating || '');
    updateProfileManualCardPreview(state.card);
  }
  if (userProfile) readProfileDraftFromPage(userProfile);
  closeProfileCharacterEditor();
  saveProfileFavoritesAuto('saved');
}

function clearProfileCharacterSlotFromEditor() {
  const state = profileCharacterEditorState;
  if (!state || !state.card) return;
  if (state.mode === 'database') {
    state.card.dataset.profileDbId = '';
    state.card.dataset.profileDbSource = '';
    state.card.dataset.profileDbType = '';
    state.card.dataset.profileDbTitle = '';
    state.card.dataset.profileDbImage = '';
    state.card.dataset.profileDbMeta = '';
    state.card.dataset.profileDbLegacyId = '';
    state.card.dataset.profileDbRating = '';
    updateProfileDatabaseCardPreview(state.card);
  } else {
    state.card.dataset.manualName = '';
    state.card.dataset.manualImage = '';
    state.card.dataset.manualRating = '';
    updateProfileManualCardPreview(state.card);
  }
  if (userProfile) readProfileDraftFromPage(userProfile);
  closeProfileCharacterEditor();
  saveProfileFavoritesAuto('saved');
}
