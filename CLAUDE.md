# Project Overview
Shelfd is a personal media-tracking PWA for movies, TV, anime, games, manga, and books — with friends, an activity feed, ratings, episode progress, comments, and DMs. Mobile/PWA-first; designed to look and feel native on iPhone Home Screen. Lives at `myshelfd.com` and the legacy `myscreenlist.com`.

# Tech Stack
- **Frontend:** Vanilla JavaScript (no framework, no build step), vanilla CSS, served via `<script>`/`<link>` tags from `index.html`. PWA via `sw.js` + `site.webmanifest`.
- **Backend:** Cloudflare Worker (`worker.js`) — request router + API proxy.
- **Database:** Firebase Firestore (`DOC_REF` per user). `localStorage` is a fast-restore cache, NOT the source of truth.
- **Auth:** Firebase Auth (Google Identity Services + email/password). Firebase domains include `myshelfd.com`, `myscreenlist.com`, and `www.` variants.
- **External APIs:** TMDB (movies/TV/people), IGDB (games — via Twitch OAuth), RAWG (game fallback), Jikan (anime details), OMDb (IMDb ratings), Tracker.gg (competitive stats). All proxied through `worker.js` at `/api/*` — keys never leave the worker.
- **Hosting:** Cloudflare Workers + Workers Assets. Routes: `myshelfd.com`, `www.myshelfd.com`, `myscreenlist.com`, `www.myscreenlist.com`.

# Project Structure
```
chat gpt edits/7/
├── wrangler.jsonc                 # Cloudflare Worker config (routes, assets binding)
├── worker.js                      # Worker — API routes, TMDB/IGDB/RAWG/Tracker.gg proxies
├── CLAUDE.md                      # THIS FILE
├── ScreenList_Privacy_Policy.md   # served as static asset
├── ScreenList_Terms_and_Conditions.md
├── REPLY_DEBUG_GUIDE.md
├── assets/public/                 # ← ACTIVE EDIT ROOT. Everything served to the browser lives here.
│   ├── index.html                 # SPA shell. Inline event handlers call window-exposed functions.
│   ├── sw.js                      # Service worker. Bump `CACHE` const on every deploy.
│   ├── site.webmanifest           # PWA manifest
│   ├── icon-*.png, apple-touch-icon.png   # app icons (cached by SW on install)
│   ├── js/                        # numbered modules, loaded in order from index.html
│   │   ├── 00-live-update-pwa.js          # SW live-update splash, controllerchange reload
│   │   ├── 01-firebase-login-state.js     # auth state, Firestore onSnapshot
│   │   ├── 02-messages-e2ee.js            # DM encryption helpers
│   │   ├── 03-watch-together.js           # Shared Watch
│   │   ├── 04-shared-utils-data.js        # ratings markup, escapes, clone helpers
│   │   ├── 05-app-state-preview-routes.js # routing
│   │   ├── 06-mylists-render-...js  ~7k LOC   ★ render(), save(), episode/rating/comment paths
│   │   ├── 07-add-shelf-import-search.js          ★ Add to Shelf flow
│   │   ├── 08-discovery-state.js
│   │   ├── 09-direct-messages.js
│   │   ├── 10-activity-feed.js     ~5.5k LOC ★ Activity feed render/stack/merge
│   │   ├── 11-discovery-media-...js ~8.3k LOC ★ Discover, media profile, person profile, game profile, getTmdbImageUrl
│   │   ├── 12-patch-notes.js
│   │   ├── 13-discover-add-imports.js     # Steam/Letterboxd imports
│   │   ├── 14-navigation.js
│   │   ├── 15-profile-settings.js
│   │   ├── 16-friends-requests.js
│   │   ├── 17-comments-auth-init.js
│   │   ├── 18-search-page.js
│   │   ├── 19-gis-signin.js / 19b-email-password / 19c-auth-flow-setup
│   │   ├── 20-imdb-ratings.js / 20-jikan-anime.js
│   │   ├── 21-discover-ranking.js
│   │   ├── 22-favorite-people.js
│   │   ├── 23-trackergg-linking.js        # Tracker.gg competitive stats
│   │   └── 24-movie-rating-duel.js        # Tier List / duel
│   └── css/                       # numbered stylesheets
│       ├── 00-base-layout.css
│       ├── 01-mylists-cards-episodes.css  # card markup, episode list
│       ├── 02-comments-login-theme.css
│       ├── 03-friends-discovery-base.css
│       ├── 04-activity-feed.css
│       ├── 05-messages-early-polish.css   # toasts live here
│       ├── 06-profile.css                 # base #modal rules
│       ├── 07-imports-discover-rankings.css
│       ├── 08-watch-together.css
│       ├── 09-direct-messages.css
│       ├── 10-mobile-transitions-media-profile.css
│       ├── 11-patch-notes-friends-refinements.css
│       ├── 12-pwa-header-continuity.css
│       ├── 13-e2ee-activity-post.css
│       ├── 14-live-update-discover-controls.css
│       ├── 15-universal-discovery-search.css
│       ├── 16-light-mode-contrast.css  ~9.5k LOC  ★ Despite the name, holds the ENTIRE body.true-dark-mode override stack. Most visual edits go here.
│       └── 17-auth-flow-setup.css
└── z VERSIONS/                    # version-copy snapshots (only on explicit request)
```
★ = the files you'll touch most often.

# Key Conventions
- **No framework, no build step.** Vanilla JS files load in numbered order via `<script>` tags in `index.html`. Same for CSS via `<link>`. No bundler, no transpiler, no JSX.
- **Window-exposed functions for inline handlers.** Most click/input handlers are inline (`onclick="myFn(...)"`), so functions must live at top level (or be assigned to `window.*`). New functions called from inline HTML attributes need `window.fnName = fnName;` if they're inside an IIFE.
- **Numbered file prefixes.** Load order matters — a function defined in `04-shared-utils-data.js` is available to `06-mylists-render-...js`. Don't reverse.
- **Section / status nomenclature.** Sections: `shows`, `anime`, `movies`, `games`, `manga`, `books`. Statuses: `watching`, `live`, `competitive`, `planned`, `watched`, `wishlist`, `paused`, `dropped`. UI labels can vary by section (`watching` becomes `Reading` for books, `Playing` for games).
- **Data shape.** `data` is `{ shows: [...], anime: [...], movies: [...], games: [...], manga: [...], books: [...] }`. Each item has `id, title, cover, status, rating, dateAdded, ...` plus section-specific fields (`episodes[]`, `seasonRatings{}`, `cardComment{}` etc).
- **Save pattern.** Always update in-memory `data` FIRST, then `localStorage.setItem` (wrapped in `try/catch` for iOS quota), then schedule Firestore. Firestore is the source of truth.
- **`render()` is heavy.** Full grid rebuild — only call it after a state change that requires a re-layout. For per-card updates, use partial DOM helpers (`updateEpisodeRowState`, `updateSeasonRatingUI`, `updateCardProgressUI`, `updateStatusPillsUI`).
- **Comments in code.** Version-tagged with the version that introduced the change (e.g. `/* v10.65: ... */`). When fixing a regression, include WHY in the comment so the next pass doesn't undo it.
- **Inline event handlers.** Use `escAttr()` / `escHtml()` from `04-shared-utils-data.js` whenever interpolating user data into HTML strings. Never inject raw user input into `innerHTML`.

# Design System

### Colors (true-dark / Default Theme)
| Role | Hex | Notes |
|---|---|---|
| Page background | `#050506` → `#0E0E0E` | Inside modals usually `#101013` |
| Surface 1 | `#101013` | Cards |
| Surface 2 | `#17171b` | Raised surfaces |
| Border / line | `rgba(255,255,255,0.075)` | Subtle dividers |
| Body text | `#f5f5f7` / `#f6f4fb` | High-contrast |
| Muted text | `rgba(235,232,244,0.58)` | Subtitles |
| Lavender accent | `#7c3aed` → `#8b5cf6` → `#a78bfa` → `#b7a4ff` → `#c4b5fd` | Primary brand |
| Cyan accent | `#06b6d4` → `#22d3ee` → `#34d3ee` → `#7deeff` | "Added to library" success, links |
| Yellow rating | `#f59e0b` → `#f2bb53` → `#ffd87f` | Stars |
| Error red | `#dc2626` → `#fb7185` | Toast errors, dropped status |

### Typography
- Primary: `'Sohne', 'DM Sans', sans-serif`
- Display headings: `'Sora', sans-serif` (DM titles, hero titles)
- Inputs floor at **`16px`** on mobile (lower triggers iOS auto-zoom).

### UI patterns
- **Full-screen modals** = `position: fixed; inset: 0; height: 100vh; height: 100dvh;` (BOTH lines, in that order — see iOS PWA section below).
- **Pills/chips** = `border-radius: 999px`, subtle `rgba(255,255,255,0.04)` background, no border preferred (cleaner).
- **Primary buttons** = lavender (`#a78bfa` family).
- **Secondary buttons** = `rgba(255,255,255,0.04)` background, white-ish text.
- **Backdrop blur** = capped at `blur(10px)` everywhere. Never on `position: sticky`.
- **Animations** = `transform` + `opacity` ONLY. No layout-property animations.
- **Card chrome** = on the cleaner flow steps (Review, Success), prefer FLAT content over framed cards. Frames are reserved for status/picker steps where they help group buttons.

# Do Not Touch
Anything in this list — ask before changing.

- **Firebase auth flow.** Google Identity Services + email/password handlers in `19-gis-signin.js` / `19b-email-password-auth.js` / `19c-auth-flow-setup.js`. iOS PWA OAuth is fragile. Test Google + Apple + email/password round-trip after ANY change here.
- **`01-firebase-login-state.js`** — Firestore `onSnapshot` subscription lifecycle. Leaking a subscription leaks bandwidth + render cost across page navigations.
- **`02-messages-e2ee.js` and E2EE message render paths.** Crypto timing is delicate.
- **`sw.js` activate handler.** The `clients.navigate(client.url)` block is belt-and-suspenders for old PWAs that don't have the live-update listener. Don't remove without a bridge deploy first.
- **Live-update splash (`00-live-update-pwa.js`).** The double-rAF + 5-second safety timeout combo has a reason — touch carefully.
- **`save()` quota guard in `06-mylists-render-...js`** (v843 comment block). Pattern is copied to other save paths — keep all of them consistent.
- **`reloadAfterVisibleSplash()` (`00-live-update-pwa.js`).** Don't call `location.reload()` unconditionally — auth return paths break.
- **`worker.js` API key handling.** All keys live as Cloudflare Worker secrets. NEVER inline a key. NEVER log a key.

# Common Commands

### Deploy
```bash
cd "C:\Users\kingk\Desktop\websites\chat gpt edits\7"
npx wrangler deploy
```
Before deploying, bump version in THREE places:
1. `assets/public/index.html` — `<meta name="screenlist-build-version" content="YYYY-MM-DD-vN.NN_short_description">`
2. Same file — `window.SCREENLIST_BUILD_VERSION` AND `window.SCREENLIST_DISPLAY_VERSION`
3. `assets/public/sw.js` — `const CACHE = 'shelfd-vN-NN-short-description';`

Skipping the `CACHE` bump = installed PWAs stay on stale JS.

### Add a Worker secret
```bash
echo "KEY_VALUE" | npx wrangler secret put SECRET_NAME
```

### Final response format
After a successful deploy, the final reply is ONLY the deployed version (e.g. `v10.68`). No bloat unless something went wrong or detail was requested.

### Verify before saying "done"
- Re-read the file section you edited (balanced braces, closed tags, no stray chars).
- Confirm wrangler output says `Success!` and lists the files you actually changed.
- For UI changes that need device testing, state the assumption ("CSS is well-formed and deployed; in-app rendering needs user confirmation").

### Ask 3 clarifying questions when uncertain
If the task is ambiguous or multiple elements could match, stop and ask up to 3 numbered questions BEFORE touching code. Don't pad — only when guessing risks the wrong fix.

# Known Issues / Context

### iOS PWA — `localStorage` 5MB cap
iOS PWAs cap `localStorage` at ~5MB. `setItem` throws `QuotaExceededError` past that.
- Every `localStorage.setItem` in a save path MUST be `try/catch`-wrapped.
- `localStorage` is a fast-restore CACHE only. **Firestore (`DOC_REF`) is the source of truth for signed-in users.**
- A `localStorage` failure must NEVER block the Firestore write.
- Canonical patterns: `06-mylists-render-...js:save()` (v843 guard) and `07-add-shelf-import-search.js:submitModal()` (v10.66 guard).

### iOS PWA — `100dvh` requires fallback
`100dvh` / `100svh` / `100lvh` only parse on iOS Safari 15.4+. Always:
```css
height: 100vh;   /* fallback for older iOS */
height: 100dvh;  /* iOS 15.4+ */
```
Same for `max-height` and `min-height`. Without the `100vh` fallback, full-screen flex modals on older iOS collapse — the inner `flex: 1 1 auto; overflow-y: auto` has no constrained parent and content overflows off-viewport (this caused the Add to Shelf "no Confirm screen" bug, fixed in v10.63).

### iOS PWA — `inset: 0` shorthand
Added in Safari 14.1. For older iOS, also write explicit `top: 0; right: 0; bottom: 0; left: 0;` alongside `inset: 0;` (v10.63 pattern).

### iOS — input auto-zoom
Focus on an input with `font-size < 16px` triggers a page-level zoom on iOS. Floor all input/textarea font-size at **16px** on mobile.

### Modal z-index hierarchy
- `.app-toast` = `z-index: 5000` (above every modal — v10.64 fix).
- Add to Shelf modal overlay = `z-index: 3900`.
- Any new full-screen modal must stay below 5000 or toasts vanish behind it.

### Defensive UI after save — split the catch
In any flow that does `localStorage` + `render()` + UI update:
- Outer `try/catch` wraps the SAVE path only — that's the one allowed to show "Could not …".
- Each post-save UI call (`triggerSuccessFeedback`, `showToast`, `renderStepSurface`, `setTimeout` callbacks) gets its OWN `try/catch` that logs `console.warn` but never falsely reports a save failure.
- Canonical pattern: `07-add-shelf-import-search.js:confirmModalAdd()` (v10.65).

### `render()` performance
- Full grid rebuild: filters items 7×, joins a 100KB+ HTML string, sets `grid.innerHTML`. ~200–400ms main-thread block on a mid-range iPhone with 100+ items.
- Avoid calling during typing. Search input is debounced 160ms with immediate commit on blur (v10.61 pattern).
- Use partial DOM updates for episode mark / season rating / comment post — helpers already exist (`updateEpisodeRowState`, `updateSeasonRatingUI`, `updateCardProgressUI`, `updateStatusPillsUI`).
- Wrap `render()` in `try/catch` inside async save paths so a UI throw doesn't lie about save success (v10.65 pattern).

### GPU / blur perf
- `backdrop-filter: blur()` capped at **10px** everywhere (v10.60 pass).
- Stripped entirely from `position: sticky` headers — they were repainting blur every scroll frame.
- Never animate `backdrop-filter`, `filter`, or `box-shadow`.
- `will-change` is never permanent — apply only during active interaction.

### Image sizing (TMDB)
Use the smallest size that still looks crisp on iPhone retina:
| Context | Size |
|---|---|
| Add-to-shelf search row thumbs | `w185` |
| My Lists card poster | `w500` (set at add time) |
| Cast / filmography credit card | `w342` |
| Person profile hero photo | `w500` |
| Media profile poster (hero thumb) | `w500` |
| Media profile backdrop | `w780` |
| Network/provider logos | `w92` |

Multi-card grids: `loading="lazy" decoding="async"`. Single hero images: `decoding="async"`.

### Service worker quirks
- `sw.js:isAlwaysFreshAsset()` treats all `.js`/`.css`/`.json`/`.webmanifest`/`/` as always-fresh (network only). Suboptimal — disk cache benefit lost on cold start. Known future-work item.
- `sw.js` activate does `clients.navigate(client.url)` AND page-side `controllerchange` listener fires `reloadAfterVisibleSplash()`. Both can fire on SW upgrade — the SW-side navigate is belt-and-suspenders for old PWAs without the live-update listener.
- `DISCOVER_POSTER_CACHE` is checked by `sw.js:cacheMatchOrNetwork` but never written. Wire it up when adding Discover prefetch.

### Activity feed merge logic
Watch + rate the same item within 6h merges into ONE card: `"watched {ep}, rated ★ N"`. Never render those as two separate cards. (Standing rule, see `feedback_activity_merge_logic.md` memory.)

### Tracker.gg
- API key stored as Cloudflare Worker secret: `TRACKERGG_API_KEY` (or fallback `TRN_API_KEY`).
- Public API supports: `apex`, `the-division-2`, `csgo` (cs2 normalizes to csgo in `worker.js`).
- Unsupported by public API: `valorant`, `marvel-rivals`, `fortnite`, `rocket-league`. For those, the UI offers MANUAL stat entry (`23-trackergg-linking.js`).

### Past version decisions (recent, worth remembering)
| Version | Why it matters |
|---|---|
| **v10.60** | First GPU pass — capped all `backdrop-filter` blurs at 10px, stripped blur from sticky headers, removed `transition: all`, scoped `will-change`. |
| **v10.61** | Debounced My Lists search (`onSearch`) 160ms, immediate commit on blur. Eliminated per-keystroke `render()`. |
| **v10.62** | TMDB image sizing pass — discover title cards `original → w500`, backdrops `w1280 → w780`, person headshots `w780 → w500`. Lazy + decoding async on grid images. |
| **v10.63** | `100dvh` fallback for older iOS — fixed Add to Shelf Review screen being invisible on iOS < 15.4. |
| **v10.64** | `.app-toast` z-index `2000 → 5000` (above all modals). Success panel duration `620 → 1800ms`. |
| **v10.65** | Defensive split-catch in `confirmModalAdd` + `render()` try/catch in `submitModal`. UI failures no longer falsely report "Could not add" when save succeeded. |
| **v10.66** | iOS PWA `localStorage` quota guard in `submitModal` (matching the v843 pattern in `save()`). Fixes "could not add" on PWAs with a large library. |
| **v10.67** | Add to Shelf Review step — stripped all card chrome (borders, backgrounds, shadows) on hero + panel + chips. Buttons preserved. |
| **v10.68** | Add to Shelf Success step — same chrome strip + boosted check-mark to 64px with ring/glow as the focal point. |
