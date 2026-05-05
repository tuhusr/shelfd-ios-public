# Shelfd / ScreenList Project Memory

Last updated: 2026-05-05

## Core Product Direction
- This is a premium tracking/social app, but the tracking aspect always takes the front seat.
- Social features should feel deeply integrated, but they support the tracking experience rather than replacing it.
- The app should feel modern, clean, premium, smooth, and unique.
- Comparable familiarity targets: Twitter/X, Instagram, and Letterboxd. Users should feel some familiar interaction patterns without the app feeling copied or generic.
- Avoid overwhelming or overstimulating users with too many colors, dividers, or competing visual treatments.

## Mobile/PWA Priority
- The PWA app on mobile is always the main focus.
- Browser desktop and mobile should still work, but every change should be judged first by the mobile PWA/app feel.
- Smoothness and functionality as an app are top priorities.
- Extra full-page pop-outs should generally hide the main header and bottom nav so users understand they have moved away from the main pages.
- Examples of full-page pop-outs: Import Library, Direct Messages, Profile, media profile, comments, Discover search, and similar focused screens.

## Visual System
- Default experience should lean true black / black backgrounds, with contrast preserved.
- Accent hierarchy:
  1. Purple: primary recurring accent throughout the app.
  2. Cyan: reserved for specific buttons/highlights.
  3. Gold: reserved for specific buttons/highlights.
  4. Creamy/milky off-white: main white-like text/accent tone, subtly warm but not drastic.
- Keep the palette restrained. Do not introduce many additional accent colors unless specifically asked.

## Workflow
- Before any edit, create a new folder inside `7/z VERSIONS` based on the latest provided version folder.
- Edit only the new version folder so previous versions stay as fallback.
- User may switch between desktop and laptop. When that happens, wait for the active path and treat it as the current baseline.
- Files should stay up to date through GitHub; path may change, workflow should remain the same.

## Collaboration Style
- Ask clarification questions whenever the creative direction, layout, mobile/PWA behavior, or user flow is ambiguous.
- Vibe coding guardrail: ask as many clarification questions as needed to offset vague or assumption-based "vibe coding" and get a clear, direct picture of what the user wants before editing.
- The more detail, technical coding terminology, implementation context, and concrete examples the user provides, the better. Treat detailed technical direction as valuable signal, not noise.
- Clarify frameworks, packages, dependencies, and runtime assumptions when relevant so both user and Codex are aligned before implementation.
- If debugging is crucial to fixing an issue, say so clearly and move into a debug pass with the user rather than guessing at the fix.
- Do not be afraid to stop and ask questions. Accuracy to the creative objective matters more than guessing.
- If implementation details are clear and mechanical, proceed and verify.

## Current App Structure Notes
- `index.html` wires main layout, header, nav, import page, My Lists, Friends, Discovery, Profile, overlays, and script/style loading.
- CSS is loaded from `00` through `15`; later files override earlier files heavily.
- `css/16-activity-card-rebuild.css` exists but is not currently linked in `index.html` or imported by `style.css` unless changed later.
- JS is loaded from `00` through `17`.
- Visual fixes usually require checking both the feature CSS and later override CSS, especially `10` through `15` for mobile/PWA behavior.

## High-Value Edit Hotspots
- Import page: `index.html`, `js/13-discover-add-imports.js`, `css/07-imports-discover-rankings.css`, later header overrides in `css/12`, `css/13`, `css/14`, `css/15`.
- My Lists and cards: `js/06-mylists-render-episodes-ratings.js`, `css/01`, plus later overrides in `css/11`, `css/12`, `css/13`, `css/14`.
- My List cog/settings/profile controls: `js/15-profile-settings.js`, `css/13-e2ee-activity-post.css`, `css/12-pwa-header-continuity.css`.
- Navigation/full-screen states: `js/14-navigation.js`, `css/10-mobile-transitions-media-profile.css`, `css/12-pwa-header-continuity.css`, `css/15-universal-discovery-search.css`.
- Direct messages: `js/09-direct-messages.js`, `css/09-direct-messages.css`.
- Profile: `js/15-profile-settings.js`, `css/06-profile.css`, plus mobile overrides in `css/10` and `css/11`.
- Discovery/search/media profiles: `js/11-discovery-media-games-profiles.js`, `css/03`, `css/06`, `css/07`, `css/10`, `css/14`, `css/15`.
- Activity feed/posts: `js/10-activity-feed.js`, `css/04`, `css/12`, `css/13`, and possibly inactive `css/16` if later linked.
- Friends/requests: `js/16-friends-requests.js`, `css/03`, `css/08`, `css/11`, `css/12`, `css/14`.




