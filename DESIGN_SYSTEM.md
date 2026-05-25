# Shelfd Design System

> **Purpose:** single source of truth for repeatable visual + interaction patterns across the app.
>
> **How to use:** when making an edit, find the relevant section here FIRST and copy the spec exactly. If you create a new pattern that should be reused, add it here before shipping. If a section is marked `TODO`, fill it in the first time you ship a rule that touches it.
>
> **Why this exists:** prevents drift between agents / sessions. No more "what was that easing curve again?" — it lives here.

---

## Table of Contents

- [Animations](#animations)
  - [Default page back-swipe (from FPR)](#default-page-back-swipe-from-fpr)
- [Typography](#typography) *(TODO)*
- [Colors](#colors) *(TODO)*
- [Icons](#icons) *(TODO)*
- [Component sizes](#component-sizes) *(TODO — start populating with the v10.717-v10.721 action-row button sizes)*
- [Spacing](#spacing) *(TODO)*
- [Modals & overlays](#modals--overlays) *(TODO)*
- [Theme](#theme) *(TODO — note that `body.true-dark-mode` is the only active theme; light-mode is structurally entangled and unreachable)*

---

# Animations

## Default page back-swipe (from FPR)

**Canonical reference:** `assets/public/js/31-edge-swipe-back.js`
**Reference implementation:** Full Page Media Review (`#mylist-media-review-page`, registered as a `DRAGGABLE_OVERLAYS` entry at lines ~145-165)
**Generic fallback for other pages:** `findDraggableForCurrentBack()` at lines 216-242 — auto-applies this same animation to any back-buttoned overlay that meets the size criteria. **Every new full-page overlay should inherit this for free if it satisfies the criteria below.**

This is the **default** swipe-back animation for the entire app. When in doubt, do not invent a new transition — let this one fire.

---

### 1. Trigger (what starts the gesture)

| # | Aspect | Value | Source line |
|---|---|---|---|
| 1 | Edge detect zone | Touch must begin within **24 px** of left screen edge | `EDGE_DETECT_PX = 24` (line 34) |
| 2 | Single-finger only | Multi-touch ignored | `if (event.touches.length !== 1) return;` (line 354) |
| 3 | Input lockout | Disabled when `<input>`, `<textarea>`, `<select>`, or `contentEditable` is focused | `isInputFocused()` (lines 77-84) |
| 4 | Carousel-safe | Aborts if touch began inside `.sl-activity-stack-carousel` or `[data-stack-carousel]` | `isTouchInsideCarousel()` (lines 342-351) |
| 5 | Back-button precondition | Gesture doesn't start unless a visible back button exists | `if (!findBackTarget()) return;` (line 363) |
| 6 | Topmost-overlay wins | When multiple back buttons share a selector, last-in-DOM match used | `for (let i = candidates.length - 1; i >= 0; i--)` (lines 196-199) |

### 2. Cancel conditions

| # | Aspect | Value | Source line |
|---|---|---|---|
| 7 | Vertical-priority cancel | If `dy > 14 px` AND `dy > |dx|` → cancelled as scroll | `VERTICAL_CANCEL_PX = 14` (line 36), check at line 441 |
| 8 | Timeout | Gesture cancelled if it runs > **800 ms** | `MAX_DURATION_MS = 800` (line 37) |

### 3. During the drag (finger moving right)

| # | Aspect | Value | Source line |
|---|---|---|---|
| 9 | Drag target | The page element itself (`#mylist-media-review-page`) — no inner wrapper | `getSurface()` returns `page` (line 159) |
| 10 | Transform follows finger 1:1 | `transform: translate3d(dx, 0, 0)` clamped to `dx ≥ 0` (never travels left) | `const tx = Math.max(0, dx)` (line 453-454) |
| 11 | Opacity stays at `1.0` | Page reveals underneath via translation, not via fade | `dragSurface.style.opacity = '1'` (line 455) |
| 12 | Corner radius | `45 px` during drag (rounded outgoing-card look) | `dragSurface.style.borderRadius = '45px'` (line 402) |
| 13 | Overflow clipping | `overflow: hidden` on page so content clips to rounded corners | `dragSurface.style.overflow = 'hidden'` (line 403) |
| 14 | GPU optimization | `will-change: transform` set on surface | line 383 |
| 15 | No transition during drag | `transition: none` while finger is moving (pure 1:1 follow) | line 382 |
| 16 | Surface touch action | `touch-action: none` on page itself (no native pan interpretation) | line 395 |

#### 3a. Scroll lock — three layers of defense
The page's scroll container (`.mylist-media-review-content`) is frozen during drag so internal scrolling can't fire mid-swipe:

| # | Aspect | Value | Source line |
|---|---|---|---|
| 17 | `overflow: hidden` on scroll container | — | line 417 |
| 18 | `touch-action: none` on scroll container | — | line 418 |
| 19 | `overscroll-behavior: none` on scroll container | — | line 419 |
| 20 | `scrollTop` preserved | Restored exactly on snap-back or dismiss | line 420 |
| 21 | Non-passive `touchmove` preventDefault | Kills any momentum scroll already in flight | lines 422-425 |

#### 3b. Edge gradient indicator
The thin gradient indicator on the left edge **only shows in fallback mode** (when no draggable surface is found). When the FPR or generic-fallback drag mode is active, the moving page itself IS the feedback — no indicator.

### 4. On release — past threshold (dx ≥ 80 px) → DISMISS

| # | Aspect | Value | Source line |
|---|---|---|---|
| 22 | Threshold | `dx ≥ 80 px` triggers dismiss | `TRIGGER_DELTA_PX = 80` (line 35), check at line 526 |
| 23 | Animation timing | `transform 320ms cubic-bezier(0.22, 1, 0.36, 1)` (snappy ease-out) | line 527-528 |
| 24 | Final transform | `translate3d(100vw, 0, 0)` — slides full viewport width to the right | line 529 |
| 25 | Opacity stays at `1.0` throughout | — | line 530 |
| 26 | Dismiss callback fires after 320ms | Calls `closeFullPageMediaReview()` (or page-specific `dismiss()`) for normal teardown | lines 531-533 |

### 5. On release — below threshold (dx < 80 px) → SNAP BACK

| # | Aspect | Value | Source line |
|---|---|---|---|
| 27 | Animation timing | `transform 220ms cubic-bezier(0.33, 1, 0.68, 1)` (softer ease for return) | line 535 |
| 28 | Final transform | `translate3d(0, 0, 0)` — back to resting position | line 536 |
| 29 | Opacity cleared (removes inline `1.0` override) | — | line 537 |
| 30 | Restore EVERY original style after 240ms | `transition`, `transform`, `will-change`, `touch-action`, `border-radius`, `overflow` on surface; `overflow`, `touch-action`, `overscroll-behavior`, `scrollTop` on scroll container | lines 538-552 |

### 6. Conditional skip (per-overlay opt-out)

| # | Aspect | Value | Source line |
|---|---|---|---|
| 31 | FPR-specific actions-sheet guard | If page has class `actions-open`, drag is skipped — the actions sheet is a modal layer on top of the page; swipe shouldn't dismiss the page from under it | line 158 (`if (page.classList.contains('actions-open')) return null;`) |

---

### Easing curve reference (for this animation)

| Phase | Curve | Duration | Notes |
|---|---|---|---|
| Dismiss slide-off | `cubic-bezier(0.22, 1, 0.36, 1)` | 320 ms | Standard "snappy ease-out" — the iOS-feel curve |
| Snap-back to rest | `cubic-bezier(0.33, 1, 0.68, 1)` | 220 ms | Slightly softer ease so the return doesn't overshoot visually |

---

### How to add a new page to the generic drag-to-dismiss

The generic fallback in `findDraggableForCurrentBack()` (lines 216-242) auto-applies this animation to any page that meets ALL of these criteria:

1. Page has a **visible back button** matching one of the selectors in `BACK_SELECTORS` (lines 91-119). If your page uses a custom back-button class, **add it to that list**.
2. The back button's nearest ancestor with `position: fixed` or `position: absolute` covers **≥ 70% viewport width AND ≥ 50% viewport height** — `findGenericPageSurface()` (lines 254-277).
3. (Optional but recommended) The page has a scroll container with `overflow-y: auto`/`scroll` and actual overflow — `findGenericScrollContainer()` (lines 283-301) auto-detects it for scroll-lock.

If your page doesn't qualify automatically, register it explicitly in the `DRAGGABLE_OVERLAYS` array (lines 130-165) following the FPR's entry as a template.

---

### Known exceptions / per-overlay overrides

- **My List Episode page** (`.mylist-episode-page-overlay`) has an explicit `DRAGGABLE_OVERLAYS` entry (lines 131-144). Same drag behavior, but the surface is the inner `.mylist-episode-page-surface`, not the overlay itself.
- **FPR actions-sheet** (`.actions-open`) — see aspect #31 above.

---

# Typography

> **TODO** — populate when next typography rule lands.
>
> Starting hints to capture:
> - Primary font family stack
> - Display font (Sora) usage rules
> - Weight ladder (200 / 300 / 400 / 500 / 600 / 700 / 800 / 900) and when each applies
> - **iOS rule:** input/textarea font-size must floor at **16 px** on mobile (lower triggers iOS auto-zoom). See CLAUDE.md.

---

# Colors

> **TODO** — populate from CLAUDE.md "Design System → Colors" section so the canonical palette has a single home.
>
> Starting hints to capture:
> - Surface 1 / Surface 2 (`#101013`, `#17171b`)
> - Border / line `rgba(255,255,255,0.075)`
> - Lavender ramp (`#7c3aed` → `#8b5cf6` → `#a78bfa` → `#b7a4ff` → `#c4b5fd`)
> - Cyan accent ramp
> - **Champagne Gold `#E6C766`** — single active gold, used for stars, accents, AND gold text (per memory)
> - Error red ramp
> - Body text `#f5f5f7` / `#f6f4fb`
> - Muted text `rgba(235,232,244,0.58)`

---

# Icons

> **TODO** — populate the first time a new icon decision is made.
>
> Starting hints to capture:
> - Canonical icon library (currently inline SVGs)
> - Stroke width per icon size
> - Standard icon sizes per context (card action row, header bar, list rows, etc.)
> - Whether to use line vs filled per state
> - Specific icons that must always be used for specific actions (e.g. the rounded chat-bubble-with-lines icon for "review", the people-plus for "share watch")

---

# Component sizes

## Default button sizes

| Button shape | Default size | Notes |
|---|---|---|
| **Circular icon button** | **`27 × 27 px`** | Canonical default for ANY circular icon button across the app (action-row review/+, share-watch, profile/header utility circles, etc.). Pair with appropriately-scaled inner SVG (typically 14–18 px depending on glyph weight). When adding a new circular button, start at 27×27 unless you have a documented reason to differ. |

**Cascade trap reminder for ALL button sizing:** when changing a size, ALWAYS update both the base rule AND any `@media (max-width: 720px)` / `(max-width: 700px)` mobile override. Both rules typically have the same `(1,4,0)` specificity + `!important`, so source order wins. Mobile breakpoints fire on every iPhone (390–440pt viewport), so the mobile override is what actually renders on TestFlight. See [v10.718 cascade-collision fix](#) and the v10.719 / v10.720 paired-rule resolution as reference.

---

## Action row buttons

> **TODO** — populate with additional context as new rules land. The v10.717–v10.721 + v10.722 rules below are the current canon.
>
> **Action row buttons (TV Shows → Watching card and equivalent across sections)** — confirmed v10.720/v10.721:
>
> | Button | Class | Dimensions | Source |
> |---|---|---|---|
> | Rating bubble (closed) | `.rating-bubble` | min `39 × 27 px`, chip-icon `11 px`, chip-value `10 px` | `01-mylists-cards-episodes.css:1200-1204`, `:1274-1284`, `:1283-1293` |
> | Rating bubble (expanded) | `.rating-bubble.is-expanded` | chip-icon grows back to `13 px`, chip-value to `12 px`, stars track `max-width: 280 px`, `margin-left: 8 px`; transition `font-size 280ms cubic-bezier(0.32, 0.72, 0, 1)` | `01-mylists-cards-episodes.css:8631-8649`, `:1349-1357` |
> | Episodes button | `.ep-toggle-bar.card-footer-btn` | min-height `27 px`, full-width `100%`, padding `0 12 px` (desktop) / `0 10 px` (mobile), text `10 px / 650 weight` (chevron inherits font-size) | `01-mylists-cards-episodes.css:6587-6611`, mobile `:6664-6674`, dark-mode `16-light-mode-contrast.css:4302-4309` |
> | Share Watch button (empty state) | `.watch-together-add` | `27 × 27 px` circle, SVG `18 × 18 px` | `08-watch-together.css:50-72` |
> | Share Watch button (populated) | `.watch-together-stack` | pill, min-height `32 px` (in v10.719 NOT shrunk — kept original), avatars `25 × 25 px` overlap `-9 px` | `08-watch-together.css:11-43` |
> | Review button (+ icon, no review yet) | `.card-comment-add-btn` | `27 × 27 px` circle, SVG `14 × 14 px` | `01-mylists-cards-episodes.css:7359-7388`, mobile `:7611-7613` |
> | Review button (chat bubble, has review) | `.card-review-layers-btn` | `27 × 27 px` circle, SVG `18 × 18 px` | `01-mylists-cards-episodes.css:7399-7429`, mobile `:7433` |
>
> **Cascade trap to watch for:** when changing any of these, ALWAYS update both the base rule AND the `@media (max-width: 720px)` / `(max-width: 700px)` mobile override. Both rules have the same `(1,4,0)` specificity + `!important`, so source order wins. Mobile breakpoints fire on every iPhone (390–440pt viewport), so the mobile override is what actually renders on TestFlight.

---

# Spacing

> **TODO** — populate when next spacing rule lands.

---

# Modals & overlays

> **TODO** — populate from existing modal patterns.
>
> Starting hints to capture:
> - Bottom sheet pattern (comment sheet → see `13-e2ee-activity-post.css` + `10-activity-feed.js openActivityReplyPage`)
> - Centered modal pattern (completion-rating, add-to-shelf review)
> - Full-page overlay pattern (FPR, episode page, profile)
> - Back-swipe inheritance — see [Default page back-swipe](#default-page-back-swipe-from-fpr) above
> - z-index hierarchy (`.app-toast` = 5000 above all modals; Add-to-Shelf = 3900; etc.)

---

# Theme

> **TODO** — populate.
>
> Critical context (per memory): `body.true-dark-mode` is the only theme that actually renders in production. Light mode is structurally entangled — removing it broke the app — but it's also unreachable. **All cascade analysis should treat `body.true-dark-mode` selectors as the only path that matters.** Light-mode CSS is dead but kept for stability.

---

## How to extend this file

1. Land a new pattern in code first.
2. Before closing the deploy, add a section here (or fill in a TODO) with:
    - The canonical class name(s) / file paths / line numbers
    - The exact CSS / JS values
    - WHY the choice was made (1-2 sentences)
    - Any cascade traps or `@media` overrides that future edits must also touch
3. If the pattern replaces an older one, mark the old one **DEPRECATED — do not use** and link to the replacement.
