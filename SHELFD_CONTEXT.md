# **Shelfd App Context \& Standards**

# **iOS App Focus (Primary Directive)**



* **Primary build target:** iOS app, always. This is the absolute truth above all else.
* **Screen size range:** All UI must account for BOTH:

  * Standard iPhone screens
  * iPhone Max screen sizes and resolutions
* **Sizing/spacing reference point:** Developer provides all positional and UI changes from an **iPhone 14 Pro Max**. Calibrate accordingly.
* **Animation standard:** 120Hz smooth, gradual, and crisp across everything.
* **Resolution standard:** Top-tier, crispy rendering optimized for both standard and Max resolution ranges.
* **Rule of thumb:** Every UI element must be implemented as a range, never a single fixed value, to render optimally across both screen tiers.



**iPhone Display Sizes + Resolutions**



iPhone 12 - 6.1" - 2532 x 1170

iPhone 12 Pro - 6.1" - 2532 x 1170

iPhone 12 Pro Max - 6.7" - 2778 x 1284



iPhone 13 - 6.1" - 2532 x 1170

iPhone 13 Pro - 6.1" - 2532 x 1170

iPhone 13 Pro Max - 6.7" - 2778 x 1284



iPhone 14 - 6.1" - 2532 x 1170

iPhone 14 Plus - 6.7" - 2778 x 1284

iPhone 14 Pro - 6.1" - 2556 x 1179

iPhone 14 Pro Max - 6.7" - 2796 x 1290



iPhone 15 - 6.1" - 2556 x 1179

iPhone 15 Plus - 6.7" - 2796 x 1290

iPhone 15 Pro - 6.1" - 2556 x 1179

iPhone 15 Pro Max - 6.7" - 2796 x 1290



iPhone 16 - 6.1" - 2556 x 1179

iPhone 16 Plus - 6.7" - 2796 x 1290

iPhone 16 Pro - 6.3" - 2622 x 1206

iPhone 16 Pro Max - 6.9" - 2868 x 1320



iPhone 16e - 6.1" - 2532 x 1170



iPhone 17e - 6.1" - 2532 x 1170

iPhone 17 - 6.3" - 2622 x 1206

iPhone Air - 6.5" - 2736 x 1260

iPhone 17 Pro - 6.3" - 2622 x 1206

iPhone 17 Pro Max - 6.9" - 2868 x 1320

**For actual UI testing, the most important**

360 × 800

390 × 844

402 × 874

430 × 932

440 × 956

412 × 915



\-------
**android phone sizing as well**



Most-Used / Most-Important Android Display Sizes + Resolutions



Samsung Galaxy A12 - 6.5" - 1600 x 720

Samsung Galaxy A13 5G - 6.5" - 1600 x 720

Samsung Galaxy A14 5G - 6.6" - 2408 x 1080

Samsung Galaxy A15 5G - 6.5" - 2340 x 1080

Samsung Galaxy A16 5G - 6.7" - 2340 x 1080



Samsung Galaxy S22 - 6.1" - 2340 x 1080

Samsung Galaxy S22+ - 6.6" - 2340 x 1080

Samsung Galaxy S22 Ultra - 6.8" - 3088 x 1440



Samsung Galaxy S23 - 6.1" - 2340 x 1080

Samsung Galaxy S23+ - 6.6" - 2340 x 1080

Samsung Galaxy S23 Ultra - 6.8" - 3088 x 1440



Samsung Galaxy S24 - 6.2" - 2340 x 1080

Samsung Galaxy S24+ - 6.7" - 3120 x 1440

Samsung Galaxy S24 Ultra - 6.8" - 3120 x 1440



Samsung Galaxy S25 - 6.2" - 2340 x 1080

Samsung Galaxy S25+ - 6.7" - 3120 x 1440

Samsung Galaxy S25 Ultra - 6.9" - 3120 x 1440



Google Pixel 7 - 6.3" - 2400 x 1080

Google Pixel 7 Pro - 6.7" - 3120 x 1440



Google Pixel 8 - 6.2" - 2400 x 1080

Google Pixel 8 Pro - 6.7" - 2992 x 1344



Google Pixel 9 - 6.3" - 2424 x 1080

Google Pixel 9 Pro - 6.3" - 2856 x 1280

Google Pixel 9 Pro XL - 6.8" - 2992 x 1344



**For actual UI testing, the most important Android widths to cover are:**
360 x 780

360 x 800

384 x 832

412 x 891

412 x 915

427 x 952

448 x 997



## **Typography**

Font Family

* **Söhne** by Klim Type Foundry (already within the app foundation)



**Font Weight Ladder**



Sohne-Extraleicht.otf = **ExtraLight = 200**

Sohne-Extraleicht-Italic.otf = ExtraLight Italic = 200 italic



Sohne-Leicht.otf = **Light = 300**

Sohne-Leicht-Italic.otf = Light Italic = 300 italic



Sohne-Buch.otf = **Book / Regular = 400**

Sohne-Buch-Italic.otf = Book Italic = 400 italic



Sohne-Kraftig.otf = **Medium = 500**

Sohne-Kraftig-Italic.otf = Medium Italic = 500 italic



Sohne-Halbfett.otf = **SemiBold = 600**

Sohne-Halbfett-Italic.otf = SemiBold Italic = 600 italic



Sohne-Dreiviertelfett.otf = **DemiBold / Three-Quarter Bold = 700**

Sohne-Dreiviertelfett-Italic.otf = DemiBold Italic = 700 italic



Sohne-Fett.otf = **Bold = 800**

Sohne-Fett-Italic.otf = Bold Italic = 800 italic



Sohne-Extrafett.otf = **ExtraBold = 900**

Sohne-Extrafett-Italic.otf = ExtraBold Italic = 900 italic



**MORE FONT DETAIL**
100 = Thin / Hairline

200 = ExtraLight / UltraLight

300 = Light

400 = Regular / Normal / Book

500 = Medium

600 = SemiBold / DemiBold

700 = Bold

800 = ExtraBold / Heavy

900 = Black / ExtraBlack / UltraBlack



\---

**IMPORTANT! NEVER USE 700 OR ABOVE WHEN CREATING UNLESS I EXPLICITLY ASK YOU TO USE THAT FONT WEIGHT**



**------**



**simplified** **RULES TO FOLLOW** (default font-weight scale — v11.247)
600 = headers / titles
500 = sub headings / categories
400 = body default text (our default)
300 = thin / light text

NOTE: titles/headers now top out at **600** by default (was 700). The
"NEVER USE 700+ unless explicitly asked" rule still stands — 600 is the
heaviest default weight; only go to 700+ when the developer explicitly asks.



**Font Size Rules**

* iOS input/textarea floor: 16px minimum on mobile (anything lower triggers iOS auto-zoom)



\---

#### **Colors (Defaults)**

Surfaces

* **Surface 1:** `#101013`
* **Surface 2:** `#17171b`
* **Border / line:** `rgba(255,255,255,0.075)`

Text

* **Body text:** `#f5f5f7` / `#f6f4fb`
* **Muted text:** `rgba(235,232,244,0.58)`
* **Release date text:** `#C9A84C` (warm gold/amber)

Accents

* **Champagne Gold:** `#E6C766` (single active gold, used for stars, accents, and gold text)
* **Lavender ramp:** `#7c3aed` → `#8b5cf6` → `#a78bfa` → `#b7a4ff` → `#c4b5fd`
* **Cyan accent ramp:** TBD
* **Error red ramp:** TBD

Theme

* **`body.true-dark-mode`** is the ONLY active theme that renders in production
* Light mode CSS is dead but kept for stability (do not remove, structurally entangled)

\---

#### **GitHub Repos**

Main Repo (Windows desktop ↔ Windows laptop sync)

* **URL:** https://github.com/tuhusr/SHELFD-CLEAN.git
* **Purpose:** Main files for swapping between Windows desktop and Windows laptop
* **Use:** Push and pull all primary development files here

iOS Repo (for Xcode / virtual macOS)

* **URL:** https://github.com/tuhusr/shelfd-ios-public.git
* **Purpose:** Used for any work that requires Xcode on virtual macOS (no native macOS owned)
* **Use:** Push files here whenever something needs to be re-archived through virtual macOS Xcode

\---

#### **Dev / Creator Account**

The creator and dev account. Always grants special features and dev insight info.

* **Email:** kingkooom@gmail.com
* **Username:** @kingkooom
* **Display Name:** King Kooom
* **UID:** `KihPpiqSsFMpn5Tee4xZWFWapg62`

Main App Account (in-app)

* **Email:** shelfd@proton.me
* **UID:** `m0OCsA272KhvsDWzBUEZ8KhAoUE2`

\---







#### **Liquid Glass UI (Apple-style — canonical recipe)**

**This is the canonical "Liquid Glass" surface treatment for Shelfd.** It mimics Apple's liquid-glass material. Whenever the developer asks for "liquid glass," "glassy," "frosted glass," or a glass popover/modal/panel anywhere in the app, use this exact recipe and adapt only the size/radius/anchor to the target element. First shipped on the My Lists cogwheel settings popover (`.mylist-settings-panel`, v11.239).

**The material (the part that makes it "liquid glass"):**

```css
/* Liquid Glass surface — adapt radius/padding/size per element */
.liquid-glass {
  /* layered translucent fill: a bright top-left sheen gradient over a
     low-opacity dark base. This gives the wet/refractive look. */
  background:
    linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 38%, rgba(255,255,255,0.02) 100%),
    linear-gradient(180deg, rgba(40,34,58,0.46), rgba(20,18,28,0.40));
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 22px;                 /* generous rounding reads as glass */
  box-shadow:
    0 24px 64px rgba(0,0,0,0.58),       /* floating drop shadow */
    inset 0 1px 0 rgba(255,255,255,0.30),       /* top highlight (light catching the edge) */
    inset 0 0 0 0.5px rgba(255,255,255,0.10),   /* thin inner hairline */
    inset 0 -18px 40px rgba(255,255,255,0.04);  /* faint bottom inner glow */
  /* the heavy backdrop blur + saturation/brightness boost IS the frosted glass */
  -webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.08);
  backdrop-filter: blur(40px) saturate(180%) brightness(1.08);
}
```

**Rules / notes:**
* The three ingredients that matter most: (1) heavy `backdrop-filter: blur(~40px) saturate(180%) brightness(1.08)`, (2) the layered translucent gradient fill, (3) the `inset 0 1px 0 rgba(255,255,255,0.30)` top highlight. Drop any one and it stops reading as glass.
* **Popover behavior:** anchor the panel near its trigger (don't center it) and scale it open from the trigger's corner — `transform-origin` set to the corner nearest the trigger (e.g. `0% 0%` for a top-left trigger), open/close animation is `scale()` + opacity only (no translate). Clamp inside the viewport so it never spills off-screen.
* **Dark mode only** — these alpha values are tuned for the true-black UI. Don't add a light-mode variant.
* Keep blur cost in mind on long scrolling lists; for a one-shot popover/modal it's fine.
* Reference build: `assets/public/css/13-e2ee-activity-post.css` → `.mylist-settings-panel`; JS anchor logic in `assets/public/js/15-profile-settings.js` → `openMyListSettingsModal(triggerEl)`.

\---

#### **Backswipe / Left Edge Swipe Motion**

#### **Reference Notice (for Claude Code / agents)**

**This is the canonical reference implementation for the left-edge back-swipe gesture in the Shelfd app.** Whenever the developer asks for a "backswipe," "swipe-back," "left edge swipe," or any equivalent gesture to be added to a page or overlay anywhere else in the app (for example: the user profile page, settings page, any new full-page overlay, etc.), use this exact code as the template.

**How to use this reference:**

* Read the code below to understand the engage thresholds, commit thresholds, easing curves, transforms, opacity/background fades, pointer event wiring, and cleanup logic.
* Replicate the same behavior (timings, thresholds, transforms, gesture feel) when wiring the swipe-back into the target page.
* Adapt only the selectors, class names, and close/dismiss callbacks to match the destination page. Do NOT change the gesture feel, thresholds, easing, or timings unless the developer explicitly says so.
* Keep the same PointerEvents-primary + touch-fallback wiring pattern.
* Keep the same left-edge 48px hit zone, 14px engage threshold, 34% / 58px+0.75px/ms velocity commit thresholds, and the same `cubic-bezier(0.18, 0.92, 0.18, 1)` dismiss curve / `cubic-bezier(0.2, 1, 0.3, 1)` snap-back curve.

**Code source:** `assets/public/js/11-discovery-media-games-profiles.js` → `bindDiscoverMediaProfileSwipeBack(overlay)`

#### **Reference Code (DO NOT MODIFY — copy and adapt selectors only)**

```javascript
/\\\\\\\\\\\\\\\* =============================================================================
   Discovery → full-page media profile: LEFT-EDGE BACK-SWIPE GESTURE
   File: assets/public/js/11-discovery-media-games-profiles.js
   Function: bindDiscoverMediaProfileSwipeBack(overlay)
   ============================================================================= \\\\\\\\\\\\\\\*/

function bindDiscoverMediaProfileSwipeBack(overlay) {
  const page = overlay?.querySelector?.('.discover-media-page');
  if (!page || page.dataset.swipeBackBound === 'true') return;
  page.dataset.swipeBackBound = 'true';

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocityX = 0;
  let velocityY = 0;
  let viewportW = 0;
  let viewportH = 0;
  let canSwipeBack = false;
  let canPullDown = false;
  let canTrailerExpand = false;
  let canTrailerCollapse = false;
  let gestureMode = '';
  let activePointerId = null;
  let rafId = 0;
  let pendingX = 0;
  let pendingY = 0;
  let pendingProgress = 0;

  const shouldIgnoreLegacyTouchEvent = (event) => {
    return !!window.PointerEvent \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& String(event?.type || '').startsWith('touch');
  };

  const getGesturePoint = (event) => {
    const coalesced = typeof event?.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
    if (coalesced?.length) return coalesced\\\\\\\\\\\\\\\[coalesced.length - 1];
    return event?.touches?.\\\\\\\\\\\\\\\[0] || event?.changedTouches?.\\\\\\\\\\\\\\\[0] || event;
  };

  /\\\\\\\\\\\\\\\* ───────── Per-frame finger tracking (rAF, composited transform only) ───────── \\\\\\\\\\\\\\\*/
  const renderGestureFrame = () => {
    rafId = 0;
    if (gestureMode === 'swipe-back') {
      page.style.transform = `translate3d(${pendingX}px, 0, 0)`;
      overlay.style.background = `rgba(5, 4, 13, ${Math.max(0, 0.18 - pendingProgress \\\\\\\\\\\\\\\* 0.18)})`;
      return;
    }
    if (gestureMode === 'pull-down') {
      /\\\\\\\\\\\\\\\* v652: scale() is removed from the pull-down transform.
         Combination of translate3d + scale on the parent page caused
         iOS Safari to drop the poster <img> mid-gesture. Pure
         translate3d preserves the GPU layer cleanly and the poster
         stays visible the whole way down. The 2.5% shrink was a
         minor visual flourish — losing it is worth the bug fix.
         Swipe-back (left → right) is unchanged. Tap-back is unchanged. \\\\\\\\\\\\\\\*/
      page.style.transform = `translate3d(0, ${pendingY}px, 0)`;
      overlay.style.background = `rgba(5, 4, 13, ${Math.max(0.08, 0.22 - pendingProgress \\\\\\\\\\\\\\\* 0.16)})`;
      return;
    }
    if (gestureMode === 'trailer-expand' || gestureMode === 'trailer-collapse') {
      applyDiscoverHeroTrailerExpansionProgress(overlay, pendingProgress);
    }
  };

  const requestGestureFrame = () => {
    if (!rafId) rafId = requestAnimationFrame(renderGestureFrame);
  };

  const clearGestureFrame = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const resetGestureStyles = () => {
    clearGestureFrame();
    gestureMode = '';
    pendingX = 0;
    pendingY = 0;
    pendingProgress = 0;
    activePointerId = null;
    velocityX = 0;
    velocityY = 0;
    canTrailerExpand = false;
    canTrailerCollapse = false;
    page.classList.remove('media-profile-swipe-dragging', 'media-profile-pull-dragging');
    overlay.classList.remove('media-profile-swipe-revealing', 'media-profile-trailer-gesture');
    document.body.classList.remove('media-profile-swipe-reveal-active');
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.backfaceVisibility = '';
    page.style.webkitBackfaceVisibility = '';
    page.style.touchAction = '';
    page.style.boxShadow = '';
    page.style.borderRadius = '';
    page.style.borderTopLeftRadius = '';
    page.style.borderBottomLeftRadius = '';
    page.style.overflow = '';
    overlay.style.transition = '';
    overlay.style.background = '';
    overlay.style.opacity = '';
  };

  const preparePullDownHeroClose = () => {
    clearGestureFrame();
    gestureMode = '';
    pendingY = 0;
    pendingProgress = 0;
    page.classList.remove('media-profile-pull-dragging');
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.touchAction = '';
    page.style.boxShadow = '';
    page.style.borderRadius = '';
    overlay.style.transition = '';
    overlay.style.background = '';
  };

  const shouldReturnToPreviousTitleProfile = () => {
    return activeDiscoverMediaProfileState?.view === 'person'
      \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !!activeDiscoverMediaProfileState?.previous?.details;
  };

  const shouldReturnToFilmographyPage = () => {
    return !!activeDiscoverMediaProfileState?.filmographyReturn;
  };

  const returnToPreviousTitleProfileFromGesture = () => {
    resetGestureStyles();
    document.body.classList.remove('media-profile-swipe-reveal-active');
    backToDiscoverTitleProfile();
  };

  const returnToFilmographyPageFromGesture = () => {
    resetGestureStyles();
    document.body.classList.remove('media-profile-swipe-reveal-active');
    returnToFilmographyFromMediaProfile();
  };

  /\\\\\\\\\\\\\\\* ───────── Arm the gesture once direction is decided ───────── \\\\\\\\\\\\\\\*/
  const armGesture = (mode) => {
    if (gestureMode === mode) return;
    gestureMode = mode;
    if (mode === 'trailer-expand' || mode === 'trailer-collapse') {
      if (mode === 'trailer-collapse' \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& isDiscoverHeroTrailerLandscape(overlay)) {
        closeDiscoverHeroTrailerLandscapeMode(overlay, { refresh: false });
      }
      const trailerState = beginDiscoverHeroTrailerExpansion(overlay);
      if (trailerState) trailerState.direction = mode === 'trailer-collapse' ? 'collapse' : 'expand';
      overlay.classList.add('media-profile-trailer-aspect-preserve');
      if (mode === 'trailer-collapse') {
        overlay.classList.remove('media-profile-trailer-fullscreen', 'media-profile-trailer-expanding');
        overlay.classList.add('media-profile-trailer-collapsing');
        document.body.classList.remove('media-profile-trailer-fullscreen-active');
        document.body.classList.add('media-profile-trailer-transition-active');
        stopDiscoverHeroTrailerProgressLoop(getDiscoverHeroTrailerPreviewElement(overlay));
      }
      overlay.classList.add('media-profile-trailer-gesture');
      page.style.transition = 'none';
      page.style.touchAction = 'none';
      return;
    }
    page.style.transition = 'none';
    overlay.style.transition = 'none';
    page.style.willChange = 'transform';
    /\\\\\\\\\\\\\\\* v650: backface-visibility: hidden on the gesture page combined with
       transform: scale() during pull-down causes the poster <img> to flicker
       and sometimes disappear entirely on iOS Safari. Removing it has no
       effect on the gesture itself (will-change: transform already gives
       us the GPU layer) but keeps the poster reliably visible. \\\\\\\\\\\\\\\*/
    page.style.touchAction = mode === 'swipe-back' ? 'none' : 'pan-x';
    page.style.transform = 'translate3d(0, 0, 0)';
    if (mode === 'swipe-back') {
      page.classList.add('media-profile-swipe-dragging');
      overlay.classList.add('media-profile-swipe-revealing');
      document.body.classList.add('media-profile-swipe-reveal-active');
      page.style.boxShadow = '-18px 0 42px rgba(0,0,0,0.28)';
      page.style.borderTopLeftRadius = '18px';
      page.style.borderBottomLeftRadius = '18px';
      page.style.overflow = 'hidden';
      overlay.style.background = 'rgba(5, 4, 13, 0.18)';
    } else {
      page.classList.add('media-profile-pull-dragging');
      page.style.borderRadius = '14px 14px 0 0';
      page.style.boxShadow = '0 18px 42px rgba(0,0,0,0.28)';
      overlay.style.background = 'rgba(5, 4, 13, 0.22)';
    }
  };

  /\\\\\\\\\\\\\\\* ───────── Commit: page flies off-screen, overlay fades, then unmount ───────── \\\\\\\\\\\\\\\*/
  const closeFromSwipe = () => {
    if (shouldReturnToFilmographyPage()) {
      returnToFilmographyPageFromGesture();
      return;
    }
    if (shouldReturnToPreviousTitleProfile()) {
      returnToPreviousTitleProfileFromGesture();
      return;
    }
    clearGestureFrame();
    page.style.transition = 'transform 0.22s cubic-bezier(0.18, 0.92, 0.18, 1), box-shadow 0.22s ease, border-radius 0.22s ease';
    overlay.style.transition = 'background 0.22s ease';
    page.style.willChange = 'transform';
    page.style.transform = 'translate3d(105vw, 0, 0)';
    page.style.boxShadow = '-20px 0 44px rgba(0,0,0,0.12)';
    page.style.borderTopLeftRadius = '30px';
    page.style.borderBottomLeftRadius = '30px';
    overlay.style.background = 'transparent';
    window.setTimeout(() => {
      closeMediaProfileOverlayImmediately(overlay, () => {
        document.body.classList.remove('discover-media-profile-open', 'game-media-profile-open', 'media-profile-swipe-reveal-active');
      });
    }, 230);
  };

  /\\\\\\\\\\\\\\\* ───────── Cancel: spring the page back to translate3d(0,0,0) ───────── \\\\\\\\\\\\\\\*/
  const snapBack = () => {
    clearGestureFrame();
    page.style.transition = 'transform 0.22s cubic-bezier(0.2, 1, 0.3, 1), box-shadow 0.22s ease, border-radius 0.22s ease';
    overlay.style.transition = 'background 0.22s ease, opacity 0.22s ease';
    page.style.transform = 'translate3d(0, 0, 0)';
    page.style.boxShadow = '';
    page.style.borderRadius = '';
    page.style.borderTopLeftRadius = '';
    page.style.borderBottomLeftRadius = '';
    overlay.style.background = '';
    window.setTimeout(resetGestureStyles, 230);
  };

  /\\\\\\\\\\\\\\\* ───────── Touch lifecycle: down / move / up / cancel ───────── \\\\\\\\\\\\\\\*/
  const handleGestureStart = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    const point = getGesturePoint(event);
    if (!point) return;
    if (event.pointerType === 'mouse' \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& event.button !== 0) return;
    if (event.touches \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& event.touches.length !== 1) return;
    const eventTarget = event.target?.closest ? event.target : null;
    const trailerPreviewTarget = eventTarget?.closest('\\\\\\\\\\\\\\\[data-discover-hero-trailer-preview]');
    const trailerAvailable = hasDiscoverHeroTrailerPreview(overlay);
    const trailerFullscreen = isDiscoverHeroTrailerFullscreen(overlay);
    const trailerControlTarget = eventTarget?.closest('\\\\\\\\\\\\\\\[data-discover-trailer-control]');
    const trailerDirectControlTarget = eventTarget?.closest('button, input, textarea, select');
    if (trailerControlTarget \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& (!trailerFullscreen || trailerDirectControlTarget)) return;
    const interactiveTarget = eventTarget?.closest('.discover-media-back, .discover-media-cast, .discover-media-similar, .discover-media-library-dock, .discover-media-add-floating, button, a, input, textarea, select');
    if (interactiveTarget \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !trailerPreviewTarget) return;
    startX = point.clientX;
    startY = point.clientY;
    lastX = startX;
    lastY = startY;
    lastTime = performance.now();
    velocityX = 0;
    velocityY = 0;
    const trailerViewport = getDiscoverTrailerViewportSize();
    viewportW = trailerViewport.width;
    viewportH = trailerViewport.height;
    const startsInTrailerArea = !!trailerPreviewTarget
      || !!eventTarget?.closest('.discover-media-hero')
      || startY <= Math.min(viewportH \\\\\\\\\\\\\\\* 0.42, 360);
    /\\\\\\\\\\\\\\\* Left-edge hit-zone: gesture only arms when the finger lands in the
       leftmost 48 px of the screen. \\\\\\\\\\\\\\\*/
    canSwipeBack = startX <= 48;
    canTrailerCollapse = trailerAvailable \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& trailerFullscreen;
    canTrailerExpand = trailerAvailable \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !trailerFullscreen \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& page.scrollTop <= 2 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& startsInTrailerArea;
    canPullDown = page.scrollTop <= 2 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canTrailerExpand \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canTrailerCollapse;
    gestureMode = '';
    activePointerId = event.pointerId ?? null;
  };

  const handleGestureMove = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    if (!canSwipeBack \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canPullDown \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canTrailerExpand \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canTrailerCollapse) return;
    const point = getGesturePoint(event);
    if (!point) return;
    if (activePointerId !== null \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& event.pointerId !== undefined \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& event.pointerId !== activePointerId) return;

    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!gestureMode) {
      /\\\\\\\\\\\\\\\* Engage threshold: 14 px of horizontal travel AND horizontal beats
         vertical by 1.35× — disambiguates from scroll / pull-down. \\\\\\\\\\\\\\\*/
      if (canSwipeBack \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& dx > 14 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& absDx > absDy \\\\\\\\\\\\\\\* 1.35) {
        armGesture('swipe-back');
        try { page.setPointerCapture?.(event.pointerId); } catch (e) {}
      } else if (canTrailerCollapse \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& dy < -8 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& absDy > absDx \\\\\\\\\\\\\\\* 1.12) {
        armGesture('trailer-collapse');
        try { page.setPointerCapture?.(event.pointerId); } catch (e) {}
      } else if (canTrailerExpand \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& page.scrollTop <= 2 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& dy > 4 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& absDy > absDx \\\\\\\\\\\\\\\* 1.08) {
        armGesture('trailer-expand');
        try { page.setPointerCapture?.(event.pointerId); } catch (e) {}
      } else if (canPullDown \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& page.scrollTop <= 2 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& dy > 18 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& absDy > absDx \\\\\\\\\\\\\\\* 1.25) {
        armGesture('pull-down');
      } else if (absDy > absDx \\\\\\\\\\\\\\\* 1.15) {
        canSwipeBack = false;
        return;
      } else {
        return;
      }
    }

    const now = performance.now();
    const dt = Math.max(1, now - lastTime);
    velocityX = (point.clientX - lastX) / dt;
    velocityY = (point.clientY - lastY) / dt;
    lastX = point.clientX;
    lastY = point.clientY;
    lastTime = now;

    if (gestureMode === 'swipe-back') {
      if (event.cancelable) event.preventDefault();
      pendingX = Math.max(0, Math.min(viewportW, dx));
      pendingProgress = Math.min(1, pendingX / Math.max(1, viewportW));
      requestGestureFrame();
      return;
    }

    if (gestureMode === 'pull-down') {
      if (event.cancelable) event.preventDefault();
      pendingY = Math.max(0, Math.min(viewportH, dy)) \\\\\\\\\\\\\\\* 0.72;
      pendingProgress = Math.min(1, pendingY / Math.max(1, viewportH \\\\\\\\\\\\\\\* 0.36));
      requestGestureFrame();
      return;
    }

    if (gestureMode === 'trailer-expand') {
      if (event.cancelable) event.preventDefault();
      pendingProgress = Math.min(1, Math.max(0, dy) / Math.max(1, viewportH \\\\\\\\\\\\\\\* 0.34));
      requestGestureFrame();
      return;
    }

    if (gestureMode === 'trailer-collapse') {
      if (event.cancelable) event.preventDefault();
      pendingProgress = 1 - Math.min(1, Math.max(0, -dy) / Math.max(1, viewportH \\\\\\\\\\\\\\\* 0.32));
      requestGestureFrame();
    }
  };

  const handleGestureEnd = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    if (!canSwipeBack \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canPullDown \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canTrailerExpand \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !canTrailerCollapse \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& !gestureMode) return;
    const point = getGesturePoint(event);
    const dx = point ? point.clientX - startX : pendingX;
    const dy = point ? point.clientY - startY : pendingY;
    const mode = gestureMode;
    canSwipeBack = false;
    canPullDown = false;
    canTrailerExpand = false;
    canTrailerCollapse = false;
    try { if (activePointerId !== null) page.releasePointerCapture?.(activePointerId); } catch (e) {}
    activePointerId = null;

    if (mode === 'swipe-back') {
      /\\\\\\\\\\\\\\\* Commit threshold:
         - dx ≥ 34% of viewport width, OR
         - dx > 58 px AND velocity > 0.75 px/ms (fast flick) \\\\\\\\\\\\\\\*/
      const shouldClose = dx >= viewportW \\\\\\\\\\\\\\\* 0.34 || (dx > 58 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& velocityX > 0.75);
      if (shouldClose) closeFromSwipe();
      else snapBack();
      return;
    }

    if (mode === 'pull-down') {
      if (dy > 92 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& dy > Math.abs(dx) \\\\\\\\\\\\\\\* 1.22) {
        if (shouldReturnToFilmographyPage()) {
          returnToFilmographyPageFromGesture();
          return;
        }
        if (shouldReturnToPreviousTitleProfile()) {
          returnToPreviousTitleProfileFromGesture();
          return;
        }
        preparePullDownHeroClose();
        if (overlay.classList.contains('game-media-profile-overlay')) closeGameMediaProfile({ reason: 'pull-down', heroClose: true });
        else closeDiscoverMediaProfile({ reason: 'pull-down', heroClose: true });
      } else {
        snapBack();
      }
      return;
    }

    if (mode === 'trailer-expand') {
      const shouldExpand = pendingProgress >= 0.58 || (dy > viewportH \\\\\\\\\\\\\\\* 0.26 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& dy > Math.abs(dx) \\\\\\\\\\\\\\\* 1.1);
      overlay.classList.remove('media-profile-trailer-gesture');
      if (shouldExpand) expandDiscoverHeroTrailerPreview(overlay);
      else cancelDiscoverHeroTrailerExpansion(overlay);
      resetGestureStyles();
      return;
    }

    if (mode === 'trailer-collapse') {
      const shouldCollapse = pendingProgress <= 0.78 || velocityY < -0.42 || (-dy > viewportH \\\\\\\\\\\\\\\* 0.14 \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& Math.abs(dy) > Math.abs(dx));
      overlay.classList.remove('media-profile-trailer-gesture');
      if (shouldCollapse) collapseDiscoverHeroTrailerPreview(overlay);
      else restoreDiscoverHeroTrailerFullscreen(overlay);
      resetGestureStyles();
      return;
    }

    resetGestureStyles();
  };

  const handleGestureCancel = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    resetGestureStyles();
  };

  /\\\\\\\\\\\\\\\* ───────── Listener wiring (PointerEvents primary) ───────── \\\\\\\\\\\\\\\*/
  page.addEventListener('pointerdown',   handleGestureStart,  { passive: true  });
  page.addEventListener('pointermove',   handleGestureMove,   { passive: false });
  page.addEventListener('pointerup',     handleGestureEnd,    { passive: true  });
  page.addEventListener('pointercancel', handleGestureCancel, { passive: true  });

  // iOS Safari fallback for older WebKit behavior — touch listeners follow below
  // in the source (lines 5919+); same handlers, just bound to touchstart/move/end.
}
```


\---

#### **Instagram-style horizontal page swipe — `instagramPageSwipe` (canonical preset)**

**This is the SINGLE SOURCE OF TRUTH for horizontal page-to-page / tab-pager swipe animations.** Whenever the developer asks for an "Instagram-style swipe", "swipe between tabs/pages", or a horizontal page pager anywhere in the app, use this preset — do NOT re-implement the gesture per page.

* **Where it lives:** `assets/public/js/39-instagram-page-swipe.js`
  * Global: `window.attachInstagramPageSwipe(container, options)`
  * Also `window.instagramPageSwipe = { name, duration, easing, attach }`
* **Reference consumer (copy this pattern):** the Followers / Following / Mutual full page in `assets/public/js/15-profile-settings.js` → `openProfileSocialModal()` (attaches the preset) + `switchProfileSocialTab()` (calls `ctrl.goTo(i, true)`).

**How to apply to a new page stack**
1. Markup: an `overflow:hidden` viewport (the gesture `container`) holding a flex `track` of N full-width pages (`flex: 0 0 100%`, each scrolls vertically on its own).
2. Attach:
   ```js
   const ctrl = attachInstagramPageSwipe(pagerEl, {
     track: trackEl,
     pageCount: 3,
     getIndex: () => currentIndex,
     onIndexChange: (i) => { currentIndex = i; updateTabs(i); },
     duration: 450,              // optional; preset default is 360
     lockTarget: overlayEl,      // element the active-swipe class lands on
     // optional close-on-first-page: edgeCloseElement + onEdgeClose
   });
   ```
   Navigate programmatically (tab taps): `ctrl.goTo(index, true)`. Cleanup: `ctrl.destroy()`.
3. CSS — lock vertical scroll ONLY while swiping (preset toggles `horizontal-swipe-active` on `lockTarget`):
   ```css
   .my-overlay.horizontal-swipe-active .my-page { overflow: hidden; touch-action: pan-x; }
   ```

**Timing / easing (defaults)**
* Drag is finger-tracked 1:1 (rAF, `translate3d` only, NO css transition during drag).
* Release settle (complete OR snap-back): `duration` ms, default **360ms** (the social page passes **450ms**), easing **`cubic-bezier(.22, 1, .36, 1)`**.
* Completes when the drag passes ~**30% of page width** OR has enough horizontal velocity; otherwise snaps back. Slight resistance at the first/last page.

**Rules baked in**
* Vertical scroll is disabled **only during an active horizontal swipe** (after horizontal intent is confirmed) and re-enabled the instant the gesture ends/cancels. `preventDefault()` only fires once a swipe is engaged; text inputs are ignored, so taps/buttons/links/cards/normal scroll are never blocked.
* `will-change: transform` is set inline only while dragging/settling and removed afterward; only the single `track` layer moves; no blur/filter/shadow animated. Smooth on iOS Capacitor at 60fps/120Hz.
