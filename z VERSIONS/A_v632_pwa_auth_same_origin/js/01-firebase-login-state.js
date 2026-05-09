// Firebase init
/* v632: authDomain is intentionally same-origin with the app (myscreenlist.com)
   so iOS Safari ITP / storage partitioning doesn't blackhole the redirect-flow
   credential. The Cloudflare Worker proxies /__/auth/* to track-ce817.firebaseapp.com
   so Firebase's auth handler still loads, but it now writes its credential to
   IndexedDB on myscreenlist.com — which the app can read after the redirect.
   On localhost (or any non-myscreenlist host) we fall back to the canonical
   firebaseapp.com authDomain so dev still works. */
const firebaseConfig = {
  apiKey: "AIzaSyApUcFwneC85iAajpMYu0hpczwe3iQ0CyA",
  authDomain: (typeof window !== 'undefined' && /(^|\.)myscreenlist\.com$/i.test(window.location.hostname))
    ? window.location.hostname
    : "track-ce817.firebaseapp.com",
  projectId: "track-ce817",
  storageBucket: "track-ce817.firebasestorage.app",
  messagingSenderId: "207486826025",
  appId: "1:207486826025:web:a42aeca80955f819064e38"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Live user counter: 280 hardcoded offset + registered user count in Firestore meta/userCount.
const USER_COUNT_OFFSET = 280;
const userCountRef = db.collection("meta").doc("userCount");
function renderUserCounter(n) {
  const el = document.getElementById("user-counter");
  if (el) el.textContent = (USER_COUNT_OFFSET + (n || 0)) + " REGISTERED USERS";
}

function switchLoginInfoTab(tab = 'notes') {
  const nextTab = tab === 'privacy' ? 'privacy' : 'notes';
  const notesTab = document.getElementById('login-info-tab-notes');
  const privacyTab = document.getElementById('login-info-tab-privacy');
  const notesPanel = document.getElementById('login-info-panel-notes');
  const privacyPanel = document.getElementById('login-info-panel-privacy');
  if (notesTab) notesTab.classList.toggle('active', nextTab === 'notes');
  if (privacyTab) privacyTab.classList.toggle('active', nextTab === 'privacy');
  if (notesPanel) notesPanel.classList.toggle('active', nextTab === 'notes');
  if (privacyPanel) privacyPanel.classList.toggle('active', nextTab === 'privacy');
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
const CREATIVE_TEAM_DISPLAY_NAMES = new Set(['z money']);
const CREATIVE_TEAM_UIDS = new Set(['xHu4YAzC2EVUTq1XWJM3BCJEgTw1']);
let commentsViewState = null;
let creatorSearchUserCache = null;
