// Firebase init
const firebaseConfig = {
  apiKey: "AIzaSyApUcFwneC85iAajpMYu0hpczwe3iQ0CyA",
  authDomain: "track-ce817.firebaseapp.com",
  projectId: "track-ce817",
  storageBucket: "track-ce817.firebasestorage.app",
  messagingSenderId: "207486826025",
  appId: "1:207486826025:web:a42aeca80955f819064e38"
};

/* v634: Google Identity Services (GIS) Web Client ID.
   ─────────────────────────────────────────────────────────────────────────
   PASTE YOUR OAUTH WEB CLIENT ID BELOW. Find it here:
     Google Cloud Console → APIs & Services → Credentials
     Select project track-ce817
     Look for the OAuth 2.0 Client ID named "Web client (auto created by Google Service)"
     Copy the Client ID (ends with .apps.googleusercontent.com)
   Format example: 207486826025-xxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
   ───────────────────────────────────────────────────────────────────────── */
window.GOOGLE_OAUTH_WEB_CLIENT_ID = "207486826025-apah3k1thitalp2sob722ug317iqc9r6.apps.googleusercontent.com";
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
/* v10.762: ENABLE FIRESTORE INDEXEDDB OFFLINE PERSISTENCE.
   ─────────────────────────────────────────────────────────────────────────
   This is the single highest-impact change for cold-start performance. The
   Firestore SDK now caches every doc + query read to IndexedDB on this
   device. On the NEXT cold launch, attached listeners fire with cached data
   typically within ~100ms — then fire again with fresh network data when
   the connection settles. Friends data, dmThreads, derived friend queries,
   activity feed, discover friends watching — all benefit automatically.

   Must be called BEFORE any other Firestore operation. We do it synchronously
   right after firestore() so no listener can sneak in first.

   Failure modes (all non-fatal, app degrades gracefully to network-only):
     - 'failed-precondition': another tab already has persistence (PWA multi-tab,
        not a concern on iOS Capacitor which is single WKWebView)
     - 'unimplemented': private browsing / storage disabled
   Either way we just log and continue. */
try {
  db.enablePersistence().catch(err => {
    console.warn('[v10.762] Firestore persistence disabled:', err?.code || err?.message || err);
  });
} catch (e) {
  console.warn('[v10.762] Firestore persistence sync throw:', e?.message || e);
}
const auth = firebase.auth();

// Live user counter: 280 hardcoded offset + registered user count in Firestore meta/userCount.
const USER_COUNT_OFFSET = 280;
const userCountRef = db.collection("meta").doc("userCount");
function renderUserCounter(n) {
  const el = document.getElementById("user-counter");
  if (el) el.textContent = (USER_COUNT_OFFSET + (n || 0)) + " REGISTERED USERS";
}

function openLoginOverlayPage(pageId) {
  const page = document.getElementById(pageId);
  if (!page) return;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  page.dataset.returnScrollY = String(scrollY);
  page.style.display = 'block';
  document.body.style.overflow = 'hidden';
  page.scrollTop = 0;
}

function closeLoginOverlayPage(pageId) {
  const page = document.getElementById(pageId);
  if (!page) return;
  const scrollY = Number(page.dataset.returnScrollY || 0);
  page.style.display = 'none';
  document.body.style.overflow = '';
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, behavior: 'auto' });
  });
}

function scrollLoginOverlayToTop(pageId) {
  const page = document.getElementById(pageId);
  if (!page) return;
  page.scrollTo({ top: 0, behavior: 'auto' });
}

let loginTermsHtmlCache = '';
let loginPrivacyHtmlCache = '';

function escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(text) {
  return escapeHtmlText(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function renderSimpleMarkdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${formatInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map(item => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  lines.forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }
    if (line === '---') {
      flushParagraph();
      flushList();
      html.push('<hr>');
      return;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
      return;
    }
    const listMatch = line.match(/^- (.+)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      return;
    }
    paragraph.push(line);
  });

  flushParagraph();
  flushList();
  return html.join('');
}

async function openLoginTermsPage() {
  const content = document.getElementById('login-terms-content');
  if (content && !loginTermsHtmlCache) {
    content.innerHTML = '<div class=\"login-privacy-loading\">Loading terms...</div>';
  }
  openLoginOverlayPage('login-terms-page');
  if (!content || loginTermsHtmlCache) {
    if (content && loginTermsHtmlCache) content.innerHTML = loginTermsHtmlCache;
    return;
  }
  try {
    const res = await fetch('/ScreenList_Terms_and_Conditions.md', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Terms load failed: ${res.status}`);
    const markdown = await res.text();
    loginTermsHtmlCache = renderSimpleMarkdownToHtml(markdown);
    content.innerHTML = loginTermsHtmlCache;
  } catch (error) {
    console.error('Terms page failed to load:', error);
    content.innerHTML = '<div class=\"login-privacy-loading\">Could not load the terms right now.</div>';
  }
}

function closeLoginTermsPage() {
  closeLoginOverlayPage('login-terms-page');
}

async function openLoginPrivacyPage() {
  const content = document.getElementById('login-privacy-content');
  if (content && !loginPrivacyHtmlCache) {
    content.innerHTML = '<div class=\"login-privacy-loading\">Loading privacy policy...</div>';
  }
  openLoginOverlayPage('login-privacy-page');
  if (!content || loginPrivacyHtmlCache) {
    if (content && loginPrivacyHtmlCache) content.innerHTML = loginPrivacyHtmlCache;
    return;
  }
  try {
    const res = await fetch('/ScreenList_Privacy_Policy.md', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Privacy load failed: ${res.status}`);
    const markdown = await res.text();
    loginPrivacyHtmlCache = renderSimpleMarkdownToHtml(markdown);
    content.innerHTML = loginPrivacyHtmlCache;
  } catch (error) {
    console.error('Privacy page failed to load:', error);
    content.innerHTML = '<div class=\"login-privacy-loading\">Could not load the privacy policy right now.</div>';
  }
}

function closeLoginPrivacyPage() {
  closeLoginOverlayPage('login-privacy-page');
}
// Real-time listener — updates for everyone whenever the count doc changes.
userCountRef.onSnapshot((snap) => {
  if (snap.exists && typeof snap.data().count === "number") {
    renderUserCounter(snap.data().count);
  }
}, (err) => { console.error("User counter listener failed:", err); });
// Bootstrap: called after auth so we have permission to read the users collection.
async function bootstrapUserCountIfNeeded() {
  try {
    const snap = await userCountRef.get();
    if (!snap.exists || typeof snap.data().count !== "number") {
      const all = await db.collection("users").get();
      const n = all.size;
      await userCountRef.set({ count: n }, { merge: true });
      // onSnapshot will fire and call renderUserCounter automatically.
    }
  } catch(e) { console.error("User count bootstrap failed:", e); }
}
let DOC_REF = null;
let currentUser = null;
let viewingUser = null; // null = viewing own list, otherwise { uid, name, photo }
let myData = null; // backup of own data when viewing others
let userProfile = null; // custom display name and photo
const UI_STATE_KEY = 'screenlist-ui-state-v2';
const CREATOR_ADMIN_EMAIL = 'kingkooom@gmail.com';
const CREATOR_PUBLIC_UID = 'KihPpiqSsFMpn5Tee4xZWFWapg62';
const CREATOR_DEFAULT_NAME = 'King Kooom';
const CREATOR_PUBLIC_PROFILE_SLUG = 'kingkooom';
const CREATOR_PUBLIC_PROFILE_CACHE_KEY = 'screenlist-public-creator-profile-v1';
/* v10.589: removed savage tones (uid xHu4YAzC2EVUTq1XWJM3BCJEgTw1 /
   display "z money") from creative team tag per direct request. */
const CREATIVE_TEAM_DISPLAY_NAMES = new Set(['rushlust']);
const CREATIVE_TEAM_UIDS = new Set(['JD3Oa7TdGMgW5IOs7feUPD7Ybb42']);
const CREATIVE_TEAM_EMAILS = new Set(['zippy.zavy@gmail.com']);
const CREATIVE_TEAM_HANDLES = new Set(['rushlust']);
let commentsViewState = null;
let creatorSearchUserCache = null;

let shelfdGuestBrowsing = false;
const SHELFD_GUEST_SESSION_KEY = 'shelfd-guest-browsing-v1';

function isShelfdGuestBrowsing() {
  return shelfdGuestBrowsing === true || !!document.body?.classList.contains('guest-browsing-mode');
}

function shouldRestoreShelfdGuestBrowsing() {
  try {
    return sessionStorage.getItem(SHELFD_GUEST_SESSION_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function setShelfdGuestBrowsing(active, options = {}) {
  shelfdGuestBrowsing = !!active;
  if (document.body) {
    document.body.classList.toggle('guest-browsing-mode', !!active);
    if (!active) document.body.classList.remove('guest-auth-modal-open');
  }
  try {
    if (active && options.persist !== false) sessionStorage.setItem(SHELFD_GUEST_SESSION_KEY, '1');
    if (!active || options.persist === false) sessionStorage.removeItem(SHELFD_GUEST_SESSION_KEY);
  } catch (e) {}
}

function ensureShelfdGuestAuthModal() {
  let modal = document.getElementById('shelfd-guest-auth-modal');
  if (modal) return modal;
  if (!document.body) return null;

  modal = document.createElement('div');
  modal.id = 'shelfd-guest-auth-modal';
  modal.className = 'shelfd-guest-auth-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'shelfd-guest-auth-title');
  modal.hidden = true;
  modal.innerHTML = `
    <button class="shelfd-guest-auth-card" type="button">
      <span id="shelfd-guest-auth-title">Sign-in required</span>
      <small>Go back to sign in</small>
    </button>
  `;
  modal.addEventListener('click', returnShelfdGuestToLanding);
  document.body.appendChild(modal);
  return modal;
}

function openShelfdGuestAuthModal(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (typeof event?.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  const modal = ensureShelfdGuestAuthModal();
  if (!modal) return false;
  modal.hidden = false;
  document.body?.classList.add('guest-auth-modal-open');
  requestAnimationFrame(() => modal.classList.add('is-open'));
  return false;
}

function closeShelfdGuestAuthModal() {
  const modal = document.getElementById('shelfd-guest-auth-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  document.body?.classList.remove('guest-auth-modal-open');
  window.setTimeout(() => {
    if (!modal.classList.contains('is-open')) modal.hidden = true;
  }, 180);
}

function returnShelfdGuestToLanding() {
  closeShelfdGuestAuthModal();
  setShelfdGuestBrowsing(false, { persist: false });
  currentUser = null;
  DOC_REF = null;
  myData = null;
  ownDataCache = null;
  viewingUser = null;
  friendViewData = null;
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  if (typeof stopFriendsDataListener === 'function') stopFriendsDataListener();
  if (typeof stopWatchTogetherListener === 'function') stopWatchTogetherListener();
  if (typeof resetFriendsDataState === 'function') resetFriendsDataState();
  if (typeof showLandingPage === 'function') showLandingPage();
}

function requireShelfdSignedInAction(event) {
  if (currentUser) return true;
  if (isShelfdGuestBrowsing()) return openShelfdGuestAuthModal(event);
  return false;
}

const SHELFD_GUEST_WRITE_SELECTOR = [
  '#header-add-quick-btn',
  '#add-btn',
  '#empty-cta',
  '#mylist-header-cog',
  '.header-import-btn',
  '.edit-profile-btn',
  '.mobile-edit-profile-btn',
  '.logout-btn',
  '.header-dm-btn',
  '#header-dm-btn',
  '.discover-add-btn',
  '.discover-status-btn',
  '.discover-media-add-floating',
  '.discover-media-library-choice',
  '.discover-media-library-skip',
  '.sas-status-btn',
  '.modal-status-btn',
  '.modal-status-confirm-submit',
  '.friend-card-add-btn',
  '.friend-add-btn',
  '.friend-remove-btn',
  '.friend-accept-btn',
  '.friend-pending-btn',
  '.friend-message-btn',
  '.friend-list-dm-btn',
  '.friend-mobile-remove-x',
  '#ftab-requests',
  '#ftab-add-friend',
  '.request-subtab',
  '.feed-composer-action-btn',
  '.feed-composer-post-btn',
  '.feed-composer-remove-trailer',
  '.x-post-action-btn',
  '.sl-activity-action-btn',
  '.card-comment-add-btn',
  '.game-card-comment-post-btn',
  '.comments-submit',
  '.comments-input-submit',
  '#feed-reply-input',
  '#feed-composer-input',
  '#comment-input',
  '#comment-textarea',
  '.comments-input',
  '.delete-btn',
  '.status-pill',
  '.game-status-current-pill',
  '.game-status-options button',
  '.ep-check',
  '.ep-rating-btn',
  '.star-btn',
  '[data-mylist-action]',
  '[data-game-details-save]',
  '.game-details-save-btn',
  '.game-details-cancel-btn',
  '.game-card-edit-btn',
  '.game-card-cover-btn',
  '.screenlist-game-cover-choice',
  '.profile-settings-btn',
  '.profile-save-btn',
  '.profile-rating-option input',
  '.mylist-settings-action-btn',
  '.mylist-delete-category-btn',
  '.mylist-vis-toggle',
  '#feed-reply-btn',
  '.feed-reply-inline-reply'
].join(',');

function getShelfdGuestBlockedWriteTarget(target) {
  if (!target || typeof target.closest !== 'function') return null;
  const activityAction = target.closest('[data-activity-action]');
  if (activityAction) {
    const action = String(activityAction.dataset.activityAction || '').trim();
    if (action === 'stack' || action === 'reply') return null;
    return activityAction;
  }
  if (target.closest('.activity-feed-load-more-btn')) return null;
  return target.closest(SHELFD_GUEST_WRITE_SELECTOR);
}

function initShelfdGuestWriteGuard() {
  if (window.__shelfdGuestWriteGuardReady) return;
  window.__shelfdGuestWriteGuardReady = true;

  document.addEventListener('click', event => {
    if (!isShelfdGuestBrowsing() || currentUser) return;
    const blocked = getShelfdGuestBlockedWriteTarget(event.target);
    if (!blocked) return;
    openShelfdGuestAuthModal(event);
  }, true);

  document.addEventListener('submit', event => {
    if (!isShelfdGuestBrowsing() || currentUser) return;
    const form = event.target;
    if (form?.closest?.('#login-screen')) return;
    openShelfdGuestAuthModal(event);
  }, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShelfdGuestWriteGuard, { once: true });
} else {
  initShelfdGuestWriteGuard();
}

window.isShelfdGuestBrowsing = isShelfdGuestBrowsing;
window.shouldRestoreShelfdGuestBrowsing = shouldRestoreShelfdGuestBrowsing;
window.setShelfdGuestBrowsing = setShelfdGuestBrowsing;
window.openShelfdGuestAuthModal = openShelfdGuestAuthModal;
window.returnShelfdGuestToLanding = returnShelfdGuestToLanding;
window.requireShelfdSignedInAction = requireShelfdSignedInAction;
