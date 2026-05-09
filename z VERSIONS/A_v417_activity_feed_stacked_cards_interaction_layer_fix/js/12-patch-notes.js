// Shared Patch Notes page — one central data source for future updates.
const SCREENLIST_PATCH_NOTES = [
  { id: 'v417-activity-feed-stacked-card-interaction-layer-fix', date: '2026-05-06', time: '2:25 PM EST', title: 'Update applied', changes: [] },
  { id: 'v416-activity-feed-stacked-card-bottom-sheet-layout-fix', date: '2026-05-06', time: '2:05 PM EST', title: 'Update applied', changes: [] },
  { id: 'v415-game-cover-web-results-picker-fix', date: '2026-05-06', time: '1:45 PM EST', title: 'Update applied', changes: [] },
  { id: 'v414-game-cover-web-results-picker', date: '2026-05-06', time: '1:20 PM EST', title: 'Update applied', changes: [] },
  { id: 'v413-cover-fallback-google-picker-layout-fix', date: '2026-05-06', time: '12:45 PM EST', title: 'Update applied', changes: [] },
  { id: 'v412-cover-fallback-picker-fix', date: '2026-05-06', time: '12:20 PM EST', title: 'Update applied', changes: [] },
  { id: 'v411-user-selected-game-cover-picker', date: '2026-05-06', time: '12:00 PM EST', title: 'Update applied', changes: [] },
  { id: 'v410-strict-igdb-twitch-only-game-covers', date: '2026-05-05', time: '11:59 PM EST', title: 'Update applied', changes: [] },
  { id: 'v409-activity-status-stack-delete-cover-enforcement', date: '2026-05-05', time: '11:59 PM EST', title: 'Update applied', changes: [] },
  { id: 'v408-activity-stack-visual-polish', date: '2026-05-05', time: '11:59 PM EST', title: 'Update applied', changes: [] },
  { id: 'v407-import-activity-dropdown-delete-scroll-preserve', date: '2026-05-05', time: '11:59 PM EST', title: 'Update applied', changes: [] },
  { id: 'v405-activity-stack-import-dropdown-border-fix', date: '2026-05-05', time: '11:58 PM EST', title: 'Update applied', changes: [] },
  {
    id: 'v404-shared-watch-copy-underline',
    date: '2026-05-05',
    time: '11:28 PM EST',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v403-stacked-activity-groups',
    date: '2026-05-05',
    time: 'Update applied',
    title: 'v.403',
    changes: ['Update applied']
  },{
    id: 'v402-game-played-user-rating-default',
    date: '2026-05-05',
    time: '11:59 PM EST',
    title: 'v.402',
    changes: ['Update applied']
  },
  {
    id: 'v401-media-card-watchlist-release-badges',
    date: '2026-05-05',
    time: '11:59 PM EST',
    title: 'v.401',
    changes: ['Update applied']
  },
  {
    id: 'v400-activity-feed-own-post-delete',
    date: '2026-05-05',
    time: '11:59 PM EST',
    title: 'v.400',
    changes: ['Update applied']
  },
  {
    id: 'v399-game-status-scroll-toggle-gray',
    date: '2026-05-05',
    time: '11:59 PM EST',
    title: 'v.399',
    changes: ['Update applied']
  },
  {
    id: 'v398-profile-top3-library-picker',
    date: '2026-05-05',
    time: 'Update applied',
    title: 'v.398',
    changes: []
  },

  {
    id: 'v397-profile-stat-alignment-card-size-tuning',
    date: '2026-05-05',
    time: '10:10 PM EST',
    title: 'Update applied',
    changes: []
  },


  {
    id: 'v395-profile-showcase-labels-under-values',
    date: '2026-05-05',
    time: '9:45 PM EST',
    title: 'Update applied',
    changes: []
  },


  {
    id: 'v394-profile-showcase-headers-centered',
    date: '2026-05-05',
    time: '9:35 PM EST',
    title: 'Update applied',
    changes: []
  },


  {
    id: 'v392-profile-showcase-stat-label-cleanup',
    date: '2026-05-05',
    time: '9:20 PM EST',
    title: 'Update applied',
    changes: []
  },

  {
    id: 'v391-profile-top3-rank-period-fix',
    date: '2026-05-05',
    time: '9:05 PM EST',
    title: 'Update applied',
    changes: []
  },

  {
    id: 'v391-profile-top3-rank-period-fix',
    date: '2026-05-05',
    time: '8:45 PM EST',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v389-profile_stat_average_star_size_adjustment',
    date: '2026-05-05',
    time: '2:05 AM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v387-profile-mobile-follow-counts-stat-card-alignment',
    date: '2026-05-05',
    time: '1:55 AM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v384-profile-edit-polish',
    date: '2026-05-05',
    time: '1:35 AM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v383-profile-mobile-stat-grid-cleanup',
    date: '2026-05-05',
    time: '1:20 AM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v382-myanimelist-desktop-helper',
    date: '2026-05-05',
    time: '1:05 AM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v381-import-subpages-myanimelist-status-mapping',
    date: '2026-05-05',
    time: '12:55 AM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v380-shared-watch-explainer-cyan-scope',
    date: '2026-05-05',
    time: '12:40 AM UTC',
    title: 'Update applied',
    changes: []
  },
    {
    id: 'v379-friends-discovery-performance-cogwheel-divider',
    date: '2026-05-05',
    time: '12:25 AM UTC',
    title: 'Update applied',
    changes: []
  },
    {
    id: 'v377-import-activity-shared-watch-episode-activity',
    date: '2026-05-05',
    time: '11:58 PM UTC',
    title: 'Update applied',
    changes: []
  },
{
    id: 'v376-activity-feed-shared-watch-patch-notes-cleanup',
    date: '2026-05-05',
    time: '11:40 PM UTC',
    title: 'Update applied',
    changes: []
  },
  {
    id: 'v375-global-igdb-game-cover-override',
    date: '2026-05-05',
    time: '11:20 PM UTC',
    title: 'Global IGDB/Twitch game poster override',
    changes: [
      'Made IGDB/Twitch portrait covers the universal preferred poster source for games.',
      'Game posters in My Lists, Discovery, Universal Search, Activity Feed, and full game media profiles now force-repair non-IGDB art when an IGDB cover is available.',
      'RAWG, Steam, TMDB-style, and generic game images are now treated as temporary fallbacks only.',
      'Discovery game rows no longer skip IGDB cover repair when multiple game sections load at the same time.',
      'The IGDB cover endpoint now supports forced refresh requests so stale cached covers do not block poster replacement.'
    ]
  },
  {
    id: 'v374-footer-desktop-mobile-layout-fix',
    date: '2026-05-05',
    time: '11:05 PM UTC',
    title: 'Footer spacing and browser layout fixes',
    changes: [
      'Added 9px more cushion before the forced visible version footer.',
      'Kept the forced visible version footer active while updating this build to v.374-May 5th, 2026.',
      'Desktop browser only: lifted the header profile area above the main Discovery/Friends/My Lists tabs.',
      'Desktop browser only: forced the duplicate mobile bottom navigation to stay hidden.',
      'Mobile browser only: shifted the My Lists page down by 10px and removed the hard header/body divider without changing the PWA layout.',
      'Updated future ZIP naming to avoid spaces so download links no longer show %20.'
    ]
  },
  {
    id: 'v373-default-status-sort-map',
    date: '2026-05-05',
    time: '11:05 PM UTC',
    title: 'My Lists default sort map updated',
    changes: [
      'Set Games → Playing, Live Games, and Single Player to default to Last Edited.',
      'Set Games → Backlog, Played, and Wishlist to default to Last Added.',
      'Set Anime and TV Shows → Watching to default to Last Edited.',
      'Kept Watchlist/Backlog and Paused defaults on Last Added, with Watched defaulting to Highest Rated where requested.',
      'Set the visible version for this build to v.373-May 5th, 2026.'
    ]
  },
  {
    id: 'v372-remove-public-patch-notes',
    date: '2026-05-05',
    time: '12:55 AM UTC',
    title: 'Public Patch Notes button removed',
    changes: [
      'Removed the public Patch Notes button from every main page and the logged-out landing legal area.',
      'Kept the forced visible build version footer active so mobile browser, desktop browser, and PWA users can still verify the running build.',
      'Added a runtime guard so old cached Patch Notes buttons are removed if they appear from stale HTML.',
      'Set the visible version for this build to v.372-May 5th, 2026.'
    ]
  },
  {
    id: 'v371-mylist-settings-scroll-lock-polish',
    date: '2026-05-05',
    time: '12:35 AM UTC',
    title: 'My List cogwheel modal polish',
    changes: [
      'Locked the My Lists page behind the cogwheel modal so the modal becomes the active scroll area while it is open.',
      'Kept the cogwheel modal internally scrollable for future settings additions.',
      'Applied Aptos font styling across the cogwheel modal controls and labels.',
      'Changed the Visible Categories divider to the same hard milky white line treatment.',
      'Changed the Import button to a larger deep-cyan action button.',
      'Removed the Library header above the Import Lists section.',
      'Set the visible version for this build to v.371-May 5th, 2026.'
    ]
  },
  {
    id: 'v370-force-steam-igdb-poster-overwrite',
    date: '2026-05-05',
    time: '12:15 AM UTC',
    title: 'Steam game posters forced to IGDB/Twitch covers',
    changes: [
      'Forced Steam-imported games to treat Steam/RAWG artwork as fallback only and overwrite it with IGDB/Twitch portrait covers whenever available.',
      'Improved the Worker IGDB cover lookup to match Steam imports by Steam App ID first before falling back to title search.',
      'Updated My Lists game rendering so only real IGDB URLs are trusted as IGDB covers, preventing stale Steam cover URLs from winning.',
      'Changed the game-cover repair requests to bypass browser cache so existing Steam covers can be corrected after a fresh deploy.',
      'Set the visible version for this build to v.370-May 5th, 2026.'
    ]
  },
  {
    id: 'v369-mylist-settings-category-clear',
    date: '2026-05-05',
    time: '11:58 PM UTC',
    title: 'My List settings cleanup and category clearing',
    changes: [
      'Removed the separate Import Steam row from the My List cogwheel modal while keeping Steam import available inside Import Lists.',
      'Expanded the cogwheel modal horizontally on mobile without changing its intended vertical footprint.',
      'Added a red outline around the Import Lists section and a milky divider beneath it.',
      'Added scroll support to the cogwheel modal so more settings can be added without clipping.',
      'Added double-confirm category clearing for every library category: TV Shows, Movies, Anime, Games, Manga, and Books.',
      'Updated the forced visible version footer format to v.369-May 5th, 2026.'
    ]
  },
  {
    id: 'v368-sort-direction-last-edited',
    date: '2026-05-05',
    time: '11:45 PM UTC',
    title: 'Sort direction toggle and Last Edited sorting',
    changes: [
      'Added a clean ascending / descending direction button to the My Lists sort menu across categories and status pages.',
      'Added Last Edited sorting for Games, TV Shows, and Anime.',
      'Last Edited updates when a title rating changes, when a comment is posted from that user\'s own list, or when TV/Anime episode checkmarks are changed.',
      'Held the current card position while the user is actively editing so Last Edited sorting does not instantly jump the card away.',
      'The edited title moves to the top after switching status/category and returning when Last Edited is active.',
      'Set the visible version for this build to 368.'
    ]
  },
  {
    id: 'v367-version-footer-games-wishlist',
    date: '2026-05-05',
    time: '11:20 PM UTC',
    title: 'Visible version footer and Games Wishlist status',
    changes: [
      'Added a permanent version number under the Patch Notes button on every main page so Safari, desktop, and PWA builds can be checked visually.',
      'Set the visible version for this build to 367.',
      'Added Wishlist as a new saved Games status separate from Playing, Live Games, Backlog, and Played.',
      'Updated the Games status order to Playing, Backlog, Played, Wishlist.',
      'Added Wishlist to the Add to Shelf and Discover add flows for games.',
      'Removed game empty-state emojis for Playing subcategories, Backlog, Played, and Wishlist.'
    ]
  },
  {
    id: 'v366-steam-igdb-cover-sync',
    date: '2026-05-05',
    time: '10:55 PM UTC',
    title: 'Steam imported game posters repaired with IGDB covers',
    changes: [
      'Added the missing /api/igdb/cover Worker route so Shelfd can actually use the configured Twitch/IGDB credentials for game cover art.',
      'Steam-imported games now request IGDB/Twitch portrait cover art during import and save that poster as the primary game cover.',
      'Existing Steam-imported games can now repair weak or missing covers during Steam sync instead of waiting for a manual re-import.',
      'The My Lists game-cover backfill now replaces old non-IGDB covers with IGDB portrait posters and persists the repaired cover to Firestore.',
      'Duplicate Steam imports now repair missing IGDB cover fields on the existing saved game instead of skipping the poster update.'
    ]
  },
  {
    id: 'v365-games-playing-live-merge',
    date: '2026-05-05',
    time: '10:35 PM UTC',
    title: 'Games Playing and Live Games merged',
    changes: [
      'Merged the top-level Games status tabs so Live Games now lives inside Playing instead of appearing as its own main status button.',
      'Added a sleek Single Player / Live Games sub-toggle under Add to Shelf when Games → Playing is selected.',
      'Kept existing Single Player games stored as Playing and existing Live Games stored as Live Games so no library data is migrated or rewritten.',
      'Made the Playing count include both Single Player and Live Games.',
      'Set the merged Playing view to default to Live Games, while search inside Playing checks both Single Player and Live Games together.',
      'Added precise empty states: No single-player games yet and No live games yet.'
    ]
  },
  {
    id: 'v223-mylist-category-visibility-profile-sync',
    date: '2026-05-02',
    time: '8:35 PM UTC',
    title: 'My Lists category visibility synced to profiles',
    changes: [
      'Moved the My Lists category visibility control to the top-left of the My Lists category panel as a compact cog button.',
      'Fixed hidden My Lists categories so CSS overrides can no longer force toggled-off category pills back onto the page.',
      'Synced My Lists category visibility to public profile viewing so hidden Anime or Games categories no longer show as profile sections or profile stat cards.',
      'Kept the update scoped to My Lists category visibility, profile category visibility, and cache-busting build metadata.'
    ]
  },
  {
    id: 'v222-activity-post-page-rebuild',
    date: '2026-05-02',
    time: '8:05 PM UTC',
    title: 'Activity post page rebuilt and likes/replies fixed',
    changes: [
      'Rebuilt the full-screen post page that opens from Friends → Activity when tapping the reply button on an activity card.',
      'The post page now uses a cleaner X/Instagram-style layout with avatar on the left, name and time on one row, readable post details, and clean action buttons.',
      'Fixed replies appearing vertically squeezed or word-by-word by replacing the broken reply layout with a full-width thread layout.',
      'Reply text now wraps normally across the available screen width on mobile instead of collapsing into a tiny column.',
      'Activity cards and full post pages now show reply and like numbers directly beside the reply and heart icons, including zero counts.',
      'Fixed heart persistence for generated activity cards by hydrating visible activity cards from their saved activity record after rendering.',
      'The heart icon now stays filled when the user already liked that activity and remains filled when returning to the feed.',
      'Reply posting now writes to the correct feed or activity collection, then refreshes the visible count immediately.'
    ]
  },
  {
    id: 'v221-account-wide-e2ee-secure-key',
    date: '2026-05-02',
    time: '7:48 PM UTC',
    title: 'Account-wide encrypted messages recovery',
    changes: [
      'Added the new Shelfd Secure Key flow for encrypted direct messages.',
      'Users can now create one Secure Key password that encrypts and backs up their private message key to their account.',
      'When a user signs in on another phone, desktop, browser, or Home Screen app, they can enter the Secure Key password once to restore encrypted chat access.',
      'The private key backup is encrypted before it is saved, so Firebase stores the backup but not the password or readable private key.',
      'Stopped the large red encryption warning from appearing globally on My Lists or other non-message pages.',
      'If an older account has no backup and the local private key is already gone, the app can create a fresh secure key so new messages work again while older locked messages remain protected.'
    ]
  },
  {
    id: 'v220-friend-profile-inline-shelf-stats',
    date: '2026-05-02',
    time: '8:05 PM UTC',
    title: 'Friend profile shelf stats now match your own shelf header',
    changes: [
      'Added the same simple shelf summary to other people’s shelves and profile pages, so friends now show total time watched/played and total Shelfd items too.',
      'When viewing a friend’s shelf, the profile area now shows a clean line like 21h Watched • 214 Shelfd under their name.',
      'When opening another user’s profile page, the same inline summary appears near their name before the larger detailed stats grid.',
      'The total time includes watched movies, watched TV/anime episodes, and tracked game play time when available.',
      'The Shelfd total counts every saved item across shows, movies, anime, games, manga, and books.',
      'Kept the update scoped to profile/shelf stat visibility and did not change search, cards, messages, icons, or list behavior.'
    ]
  },
  {
    id: 'v219-friend-search-and-activity-reply-repair',
    date: '2026-05-02',
    time: '7:50 PM UTC',
    title: 'Friend search and activity replies repaired',
    changes: [
      'Removed the old two-character search requirement from the Friends Search tab so searches now start after one typed character.',
      'Updated the Friends Search helper text so it no longer tells users to type at least two characters.',
      'Made Friends Search run automatically while typing, so users do not need to hit a separate Search button.',
      'Expanded Friends Search beyond the creator-only path so regular users can appear when their name, display name, custom name, or username matches the typed text.',
      'Added a fallback scan for one-letter searches like “Z” so older profiles without every lowercase search field can still show up.',
      'Fixed Activity card replies for generated friend-activity cards by converting temporary on-screen activity IDs into stable saved activity records before opening the reply page.',
      'Activity replies and likes now use the stable saved activity record, which prevents the Activity not found console error when replying from the Friends Activity feed.'
    ]
  },
  {
    id: 'v218-mylist-profile-stats-inline',
    date: '2026-05-02',
    time: '7:35 PM UTC',
    title: 'My Lists profile stats made cleaner',
    changes: [
      'Changed the My Lists profile summary into one simple side-by-side line instead of explanatory stacked text.',
      'The summary now reads like: 21h Watched • 214 Shelfd, using clean white text with no border or card styling.',
      'Made the user name 3px larger than the watched/Shelfd stats so the profile identity has clearer hierarchy.',
      'Increased the profile picture size on My Lists so the profile header feels stronger and easier to see on mobile.',
      'Kept this update scoped to the My Lists profile header stats and did not change shelf cards, search, messages, ratings, or other app areas.'
    ]
  },
  {
    id: 'v217-mylist-stats-import-alignment',
    date: '2026-05-02',
    time: '7:20 PM UTC',
    title: 'My Lists header stats and Import Lists polish',
    changes: [
      'Aligned the Import Lists button with the Direct Messages button on the My Lists page so the mobile header feels balanced.',
      'Changed the My Lists Import Lists button into a cyan capsule so it stands out as a clean action without looking bulky.',
      'Added a simple white shelf summary under the user profile picture and name on My Lists.',
      'The new summary shows total watch/play time across movies, TV, anime, and games.',
      'The new summary also shows Shelf total, which counts every item across shows, movies, anime, games, manga, and books.',
      'Kept the change scoped to the My Lists header/profile area and did not change shelf cards, search, ratings, messages, or other app sections.'
    ]
  },
  {
    id: 'v216-sharing-image-refresh',
    date: '2026-05-02',
    time: '7:10 PM UTC',
    title: 'Website sharing image updated',
    changes: [
      'Replaced the image people see when the Shelfd website link is shared in messages, social apps, and previews.',
      'Updated the Open Graph sharing image to the new Shelfd promo artwork provided in the update.',
      'Updated the Twitter/X preview image to match the same new sharing artwork.',
      'Updated the shared-site URL metadata to use myscreenlist.com for cleaner link previews.',
      'Kept app layout, icons, buttons, and functionality unchanged.'
    ]
  },
  {
    id: 'v215-header-logo-size-align',
    date: '2026-05-02',
    time: '6:55 PM UTC',
    title: 'Header logo size and centering fixed',
    changes: [
      'Made the in-app top logo larger so it has more presence on Discover and the other main pages.',
      'Fixed the Friends page header logo alignment so it sits dead-center horizontally instead of drifting because of the Import Lists and DM buttons.',
      'Standardized the header logo size across My Lists, Discover, Friends, Anime Discover, and Games Discover so the logo no longer changes size from page to page.',
      'Kept the change limited to header logo sizing, mobile alignment, and deployment cache-busting.'
    ]
  },
  {
    id: 'v214-landing-description-font-15',
    date: '2026-05-02',
    time: '6:43 PM UTC',
    title: 'Landing description text made slightly larger',
    changes: [
      'Increased the long landing-page description below the sign-in buttons from 14px to 15px.',
      'Kept the wording, buttons, icons, and layout unchanged.'
    ]
  },
  {
    id: 'v213-pwa-home-screen-icon-update',
    date: '2026-05-02',
    time: '6:29 PM UTC',
    title: 'Home Screen app icon updated',
    changes: [
      'Updated only the PWA/Home Screen icon used when people add Shelfd to their phone home screen.',
      'Left the landing page logo, header logo, browser favicon, text, layout, and scripts unchanged.'
    ]
  },
  {
    id: 'v212-landing-cta-text-update',
    date: '2026-05-02',
    time: '6:27 PM UTC',
    title: 'Landing page creator buttons renamed',
    changes: [
      'Changed the landing page button text from “View My Profile” to “View Creators Profile”.',
      'Changed the landing page button text from “View My Lists” to “View Creators Shelf”.',
      'Kept the change text-only and did not alter the button behavior or layout.'
    ]
  },
  {
    id: 'v211-app-icon-refresh',
    date: '2026-05-02',
    time: '6:35 PM UTC',
    title: 'App icon updated across Safari, browsers, bookmarks, and the PWA',
    changes: [
      'Replaced the Safari Add to Home Screen icon with the newest Shelfd app icon artwork provided in the update.',
      'Updated desktop browser tab favicons so the new icon appears in tabs, bookmarks, and browser shortcut areas after cache refresh.',
      'Refreshed the PWA manifest icon set used by installed mobile and desktop app shortcuts.',
      'Updated the app metadata from ScreenList to Shelfd in the places browsers use for installed app naming and sharing previews.',
      'Added fresh cache-busting to icon and manifest links so returning users are pushed toward the new files after deployment.'
    ]
  },
  {
    id: 'v210-creative-team-tag-update',
    date: '2026-05-02',
    time: '6:28 PM UTC',
    title: 'Creative Team badge updated',
    changes: [
      'Added the Creative Team badge to another approved team member so the tag appears consistently across profiles, comments, activity, friends, and messages.',
      'Updated the Creative Team badge styling to be a little smaller and cleaner so it does not overpower usernames.',
      'Changed the badge glow to a minimal cyan treatment for a more polished, less intense look.'
    ]
  },
  {
    id: 'v209-landing-page-logo-refresh',
    date: '2026-05-02',
    time: '6:17 PM UTC',
    title: 'Landing page logo updated to the new Shelfd wordmark',
    changes: [
      'Replaced the landing page logo with the newest Shelfd wordmark artwork provided in the update.',
      'Updated the landing logo file used by the login/landing screen so visitors see the new icon-plus-Shelfd branding instead of the previous logo.',
      'Added a fresh cache-buster to the landing logo reference so browsers are pushed to load the new image after deployment.',
      'Updated the app build version so live clients can detect the new deployment and refresh cleanly.'
    ]
  },
  {
    id: 'v208-app-home-screen-icon-refresh',
    date: '2026-05-02',
    time: '6:03 PM UTC',
    title: 'App icons refreshed for Safari, browser tabs, and bookmarks',
    changes: [
      'Replaced the icon used when someone adds the app to their iPhone Home Screen through Safari with the new star app icon provided in the update.',
      'Replaced the desktop browser-tab favicon so the tab icon uses the same new app icon instead of the older artwork.',
      'Updated the bookmark/browser shortcut icons so saved bookmarks and shortcuts pull from the refreshed app icon files.',
      'Added refreshed PWA manifest icons for installed app behavior on mobile and desktop browsers.',
      'Added cache-busted icon links in the site header so returning users are more likely to see the new icon after deployment.'
    ]
  },
  {
    id: 'v207-header-outline-logo-center',
    date: '2026-05-02',
    time: '5:59 PM UTC',
    title: 'Header logo updated and centered',
    changes: [
      'Replaced the small top header logo used inside the app with the new outline star icon provided in the update.',
      'Added mobile alignment rules so the header logo stays horizontally centered instead of drifting left or right on different pages.',
      'Kept the landing page logo from the previous update unchanged while updating the in-app page header logo only.',
      'Added a fresh cache-buster so returning users load the new header logo asset after deployment.'
    ]
  },
  {
    id: 'v206-landing-page-logo-refresh',
    date: '2026-05-02',
    time: '5:52 PM UTC',
    title: 'Landing page logo refresh',
    changes: [
      'Replaced the landing page logo with the new Selfd logo artwork provided in the update.',
      'Updated the landing logo cache-buster so returning users load the new image instead of an older cached version.',
      'Kept the change limited to the landing page branding asset and deployment cache versioning.'
    ]
  },
  {
    id: 'v205-friends-mobile-layout-cleanup',
    date: '2026-05-02',
    time: '5:05 PM UTC',
    title: 'Friends mobile layout cleanup',
    changes: [
      'Scaled the Friends page top tabs so Activity Feed, Friends, Requests, and Search fit cleanly across a mobile screen.',
      'Made the activity post composer smaller and removed the composer avatar so the Friends feed has more usable space.',
      'Centered and emphasized the Watch Together, Activity, and Shared Watch controls so they feel like the main section tabs.',
      'Removed the profile avatar and Edit Profile controls from the Friends page mobile header.',
      'Moved Import Lists to the top-left area on the Friends page and enlarged the DM button on the top right for easier tapping.'
    ]
  },
  {
    id: 'v204-discover-ranking-logic-refactor',
    date: '2026-05-02',
    time: '3:18 AM UTC',
    title: 'Discover ranking logic refactor',
    changes: [
      'Rebuilt Discover ranking formulas so each movie, TV, anime, and game category now uses its own scoring logic instead of relying on blunt popularity or added-count sorting.',
      'Balanced the TMDB rows around category-specific mixes of momentum, weighted quality, confidence, release timing, and hidden-gem obscurity.',
      'Reworked the RAWG game rows to use normalized player-interest, rating confidence, critic quality, platform reach, and category-tag relevance.'
    ]
  },
  {
    id: 'v203-discover-header-card-spacing',
    date: '2026-05-02',
    time: '2:52 AM UTC',
    title: 'Discover header-to-card spacing',
    changes: [
      'Increased the spacing between Discover category headers and the title-card rows.',
      'Added extra breathing room for TV, Movies, Anime, and Games after the header descriptions were removed.'
    ]
  },
  {
    id: 'v202-mylists-category-pill-compaction',
    date: '2026-05-02',
    time: '2:47 AM UTC',
    title: 'My Lists category pill compaction',
    changes: [
      'Compacted the My Lists category button spacing and row gaps for a cleaner mobile layout.',
      'Trimmed category pill padding and height while keeping the labels comfortable and readable.'
    ]
  },
  {
    id: 'v201-activity-card-clearance-and-poster-profile-fix',
    date: '2026-05-02',
    time: '2:36 AM UTC',
    title: 'Activity card clearance and poster profile fix',
    changes: [
      'Shifted the Friends activity card text farther right so the avatar no longer clips the copy.',
      'Hardened activity-poster taps so they resolve into the same full-screen media profile flow used by Discover cards.'
    ]
  },
  {
    id: 'v200-discover-tab-spacing-increase',
    date: '2026-05-02',
    time: '2:23 AM UTC',
    title: 'Discover tab spacing increase',
    changes: [
      'Increased the vertical space between the Discover tab row and the Newest Releases section.'
    ]
  },
  {
    id: 'v199-friends-tab-font-clickable-activity-pills',
    date: '2026-05-02',
    time: '2:14 AM UTC',
    title: 'Friends tabs and activity pills',
    changes: [
      'Increased the top Friends page tab font size by 2px.',
      'Made the Watch Together, Activity, and Shared Watch header pills actual clickable buttons.',
      'Updated the Watch Requests label in that control row to Watch Together.'
    ]
  },
  {
    id: 'v198-final-mylists-category-grid-lock',
    date: '2026-05-02',
    time: '2:04 AM UTC',
    title: 'Final My Lists category grid lock',
    changes: [
      'Applied a final hard override that forces the My Lists category buttons into a three-column by two-row grid.',
      'Canceled leftover flex stacking rules that were still making the category buttons render one per line.'
    ]
  },
  {
    id: 'v197-mylists-card-status-sync',
    date: '2026-05-02',
    time: '1:58 AM UTC',
    title: 'My Lists card status sync',
    changes: [
      'Synced the title-card status buttons to the same section-based status rules used by the main My Lists tabs.',
      'Fixed card status behavior across TV shows, anime, movies, games, manga, and books.',
      'Updated active-state syncing so game cards correctly handle the Live status state too.'
    ]
  },
  {
    id: 'v196-discover-release-filter-cleanup-spacing',
    date: '2026-05-02',
    time: '1:46 AM UTC',
    title: 'Discover release filter cleanup and spacing',
    changes: [
      'Removed the purple boxed active highlight from the New This Week and New This Month release filters.',
      'Added more spacing between the discovery hub tabs and the Newest Releases section.'
    ]
  },
  {
    id: 'v195-activity-card-text-clearance-profile-open',
    date: '2026-05-02',
    time: '1:37 AM UTC',
    title: 'Activity card spacing and poster profile open',
    changes: [
      'Shifted Activity Feed text further right so the user profile picture no longer clips into the text.',
      'Applied the full media profile overlay path when tapping the poster on an Activity Feed card.'
    ]
  },
  {
    id: 'v194-stationary-centered-status-row',
    date: '2026-05-02',
    time: '1:28 AM UTC',
    title: 'Stationary centered My Lists status row',
    changes: [
      'Changed the My Lists status filters from a slidable row to a stationary four-column layout.',
      'Reduced the spacing and button width so the full status row fits on mobile without clipping.',
      'Centered the status buttons within the available screen width.'
    ]
  },
  {
    id: 'v193-discover-header-cleanup-mobile-tabs',
    date: '2026-05-02',
    time: '1:22 AM UTC',
    title: 'Discover header cleanup and mobile tabs',
    changes: [
      'Removed Discover header and section description text blocks.',
      'Increased the TV Shows, Movies, Anime, and Games tab font size by 2px.',
      'Reworked the discovery tabs into a four-column mobile row so they fit horizontally on phone screens.'
    ]
  },
  {
    id: 'v192-mylists-profile-picture-nudge',
    date: '2026-05-02',
    time: '1:13 AM UTC',
    title: 'My Lists profile picture nudge',
    changes: [
      'Lowered the My Lists profile picture slightly for a cleaner mobile header balance.'
    ]
  },
  {
    id: 'v191-mobile-status-pill-tightening',
    date: '2026-05-02',
    time: '1:05 AM UTC',
    title: 'Mobile status pill tightening',
    changes: [
      'Reduced the My Lists status button spacing and horizontal padding for mobile.',
      'Shrank the status count bubbles so the full row fits more comfortably on phone screens.'
    ]
  },
  {
    id: 'v190-mylists-category-grid-hard-fix',
    date: '2026-05-02',
    time: '12:58 AM UTC',
    title: 'My Lists category grid hard-fix',
    changes: [
      'Forced the My Lists category buttons into a real two-row, three-column grid.',
      'Prevented the category buttons from collapsing into a single vertical stack.'
    ]
  },
  {
    id: 'v189-discover-border-cleanup',
    date: '2026-05-02',
    time: '12:49 AM UTC',
    title: 'Discover border cleanup',
    changes: [
      'Removed the bordered container around the Discovery title and subtitle area.',
      'Removed the capsule borders around the TV Shows, Movies, Anime, and Games discovery tabs.'
    ]
  },
  {
    id: 'v188-mylists-filter-layout-refinement',
    date: '2026-05-02',
    time: '12:39 AM UTC',
    title: 'My Lists filter layout refinement',
    changes: [
      'Kept the category filters in a true two-row by three-column layout.',
      'Changed the status filters to a single horizontal row of text-sized capsules so the active highlight fully fits each label.'
    ]
  },
  {
    id: 'v187-mylists-filter-layout-sizing',
    date: '2026-05-02',
    time: '12:31 AM UTC',
    title: 'My Lists filter layout refresh',
    changes: [
      'Increased My Lists category button text to 15px and arranged the buttons in two rows of three.',
      'Increased My Lists status button text to 13px and locked the status filters to a single row.'
    ]
  },
  {
    id: 'v186-mylists-filter-font-sizing',
    date: '2026-05-02',
    time: '12:17 AM UTC',
    title: 'My Lists filter font sizing',
    changes: [
      'Increased My Lists category button text to 13px.',
      'Increased My Lists status button text to 12px.'
    ]
  },
  {
    id: 'v185-activity-avatar-spacing',
    date: '2026-05-02',
    time: '12:14 AM UTC',
    title: 'Activity Feed avatar spacing',
    changes: [
      'Moved the Activity Feed card profile picture further left.',
      'Added more breathing room between the avatar and notification text.'
    ]
  },
  {
    id: 'v184-mylists-labels-activity-card-redesign',
    date: '2026-05-02',
    time: '12:11 AM UTC',
    title: 'My Lists cleanup and Activity Feed redesign',
    changes: [
      'Removed the Categories and Status text labels from My Lists.',
      'Redesigned Friends Activity notification cards with a cleaner glass-card layout.',
      'Kept the user avatar anchored at the top-left of each Activity Feed card.'
    ]
  },
  {
    id: 'v183-media-share-route-startup',
    date: '2026-05-02',
    time: '12:07 AM UTC',
    title: 'Media share link startup polish',
    changes: [
      'Made shared media links bypass the normal My Lists startup render.',
      'Reduced the page flicker before a texted media link opens its media profile.'
    ]
  },
  {
    id: 'v182-my-lists-compact-filters',
    date: '2026-05-01',
    time: '11:57 PM UTC',
    title: 'My Lists filter layout polish',
    changes: [
      'Moved Edit My List onto the same row as Categories and aligned it to the far right.',
      'Reduced spacing in the My Lists categories section.',
      'Reduced spacing in the My Lists status section.'
    ]
  },
  {
    id: 'v181-activity-feed-media-share-mylists-fixes',
    date: '2026-05-01',
    time: '11:52 PM UTC',
    title: 'Activity Feed, sharing, and My Lists fixes',
    changes: [
      'Fixed Activity Feed notification cards so the user avatar stays anchored on the left side of the card.',
      'Prevented user profile photos from being reused as the media poster inside Activity Feed notifications.',
      'Fixed shared media profile links so they load the app route correctly from messages and direct links.',
      'Centered My Lists category buttons and aligned Edit My List with the Categories label.'
    ]
  },
  {
    id: 'v158-friends-activity-mylists-header-actions',
    date: '2026-05-01',
    time: '10:18 PM UTC',
    title: 'Friends Activity and My Lists polish',
    changes: [
      'Redesigned Friends Activity cards with clearer friend actions and poster links to media profiles.',
      'Improved My Lists header alignment and mobile action spacing.'
    ]
  },
  {
    id: 'v157-dm-mylists-header-label-polish',
    date: '2026-05-01',
    time: '10:05 PM UTC',
    title: 'My Lists and messages polish',
    changes: [
      'Cleaned up the Direct Messages icon styling.',
      'Improved My Lists header spacing with a larger profile picture.',
      'Refined My Lists category and status label alignment.'
    ]
  },
  {
    id: 'v156-friends-swipe-mylists-header-fix',
    date: '2026-05-01',
    time: '9:55 PM UTC',
    title: 'Friends swipe and header cleanup',
    changes: [
      'Fixed Friends swipe navigation between Watch Requests, Activity, and Shared Watch.',
      'Cleaned up the Friends Activity label while keeping the Activity Feed section title.',
      'Refined the own-profile header with a cleaner profile picture layout.',
      'Cleaned up the My Lists header with one centered profile picture and improved alignment.'
    ]
  },
  {
    id: 'v155-friends-swipe-profile-header-fix',
    date: '2026-05-01',
    time: '9:45 PM UTC',
    title: 'Friends swipe and profile header fixes',
    changes: [
      'Fixed Friends swipe navigation between Watch Requests, Activity, and Shared Watch.',
      'Cleaned up the Friends Activity label while keeping the Activity Feed section title.',
      'Refined the own-profile header with a cleaner profile picture layout.'
    ]
  },
  {
    id: 'v154-patch-note-entry-unread-pings',
    date: '2026-05-01',
    time: '8:59 PM UTC',
    title: 'Patch Notes unread indicators',
    changes: [
      'Added unread indicators inside Patch Notes so users can see which updates are new.'
    ]
  },
  {
    id: 'v153-mobile-topbar-friends-tabs',
    date: '2026-05-01',
    time: '9:28 PM UTC',
    title: 'Mobile theme and Friends tab polish',
    changes: [
      'Updated the mobile top bar to better match the deep purple ScreenList theme.',
      'Cleaned up Friends tab styling for a simpler look.',
      'Removed the extra visible count from the Friends tab.'
    ]
  },
  {
    id: 'v152-friends-section-order-swipe-backdrop',
    date: '2026-05-01',
    time: '9:10 PM UTC',
    title: 'Friends navigation polish',
    changes: [
      'Reorganized Friends sections into Watch Requests, Activity Feed, and Shared Watch.',
      'Fixed Friends swipe navigation between the three sections.',
      'Refined the Activity Feed backdrop to better match the deep purple ScreenList theme.'
    ]
  },
  {
    id: 'v151-patch-notes-unread-ping',
    date: '2026-05-01',
    time: '8:55 PM UTC',
    title: 'Patch Notes notifications',
    changes: [
      'Added a Patch Notes notification ping so users can tell when there are new updates to read.'
    ]
  },
  {
    id: 'v150-mylists-divider-profile-counts',
    date: '2026-05-01',
    time: '8:48 PM UTC',
    title: 'My Lists filter cleanup',
    changes: [
      'Added a cleaner divider between My Lists categories and status filters.',
      'Added a profile shortcut on My Lists so you can quickly open your own profile.',
      'Cleaned up My Lists category counts so only the selected category shows its total.'
    ]
  },
  {
    date: '2026-05-01',
    time: '8:40 PM UTC',
    title: 'Friends navigation and Activity backdrop update',
    changes: [
      'Updated Friends navigation so Activity opens by default and Watch Requests / Shared Watch are accessed by swipe.',
      'Refined the Friends Activity backdrop to better match the deep purple ScreenList theme.'
    ]
  },
  {
    date: '2026-05-01',
    time: '8:21 PM UTC',
    title: 'Profile and Friends mobile cleanup',
    changes: [
      'Cleaned up the own-profile header so your profile page feels simpler and less crowded.',
      'Removed the Paused status option from Games while keeping existing game data safe.',
      'Cleaned up the profile status summary so status items fit better on mobile.',
      'Added swipe navigation between Activity, Watch Requests, and Shared Watch on the Friends page.',
      'Renamed Friend Watch to Watch Requests for clearer wording.',
      'Refined Friends Activity styling with cleaner tabs and lighter purple activity cards.'
    ]
  },
  {
    date: '2026-05-01',
    time: '2:19 PM UTC',
    title: 'Creator preview, sharing, and smoother profile navigation',
    changes: [
      'Creator profile and creator lists now load real public data while logged out, so visitors can preview ScreenList before signing in.',
      'Moved the media share button directly next to Add to Library inside media profiles.',
      'Added a new Share menu with ScreenList sharing and Share Anywhere options.',
      'Shared media links can open the same movie, TV, anime, or game profile.',
      'Profile pages now support a left-to-right swipe back gesture that smoothly reveals the previous page underneath.'
    ]
  },
  {
    date: '2026-05-01',
    time: '1:52 PM UTC',
    title: 'Media sharing and profile previews',
    changes: [
      'Added share links inside media profiles for movies, TV, anime, and games.',
      'Improved logged-out creator profile and list previews so visitors can view public stats and lists.',
      'Moved the Patch Notes back button to a floating right-side control.',
      "Updated the Google sign-in button to match the app's main action style."
    ]
  },
  {
    date: '2026-05-01',
    time: '1:13 PM UTC',
    title: 'Friends requests and mobile cleanup',
    changes: [
      'Removed the extra watched/planned-together subtab from Friends Requests.',
      'Friend request badges now only show when someone is waiting for your response.',
      'Cleaned up Friends List mobile card spacing and action buttons.',
      'Centered and emphasized Watch Requests and Shared Watch buttons on mobile.'
    ]
  },
  {
    date: '2026-05-01',
    time: '1:04 PM UTC',
    title: 'Discover and Patch Notes improvements',
    changes: [
      'Discover Trending Movies and TV now use weekly trending results.',
      'Discover View All poster and title taps now open media profiles correctly.',
      'Added one shared Patch Notes page linked from Discover, Friends, and My Lists.'
    ]
  }
];
const SCREENLIST_PATCH_NOTES_SEEN_KEY = 'screenlist-last-seen-patch-note-id-v1';
const SCREENLIST_PATCH_NOTES_READ_IDS_KEY = 'screenlist-read-patch-note-ids-v1';
let patchNotesReturnScrollY = 0;
let patchNotesReadObserver = null;
let patchNotesReadIdsMigrated = false;

function getPatchNoteEntryTime(entry = {}) {
  return Date.parse(`${entry.date || ''} ${entry.time || ''}`) || 0;
}

function getPatchNoteEntryId(entry = {}) {
  if (entry.id) return String(entry.id);
  return [entry.date || '', entry.time || '', entry.title || 'update'].join('|');
}

function getSortedPatchNotes() {
  return SCREENLIST_PATCH_NOTES.slice().sort((a, b) => getPatchNoteEntryTime(b) - getPatchNoteEntryTime(a));
}

function getLatestPatchNoteEntry() {
  return getSortedPatchNotes()[0] || null;
}

function getLatestPatchNoteId() {
  const latest = getLatestPatchNoteEntry();
  return latest ? getPatchNoteEntryId(latest) : '';
}

function parsePatchNoteReadIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCREENLIST_PATCH_NOTES_READ_IDS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(id => String(id)).filter(Boolean) : []);
  } catch (error) {
    return new Set();
  }
}

function savePatchNoteReadIds(ids = new Set()) {
  try { localStorage.setItem(SCREENLIST_PATCH_NOTES_READ_IDS_KEY, JSON.stringify([...ids])); }
  catch (error) {}
}

function getLastSeenPatchNoteId() {
  try { return localStorage.getItem(SCREENLIST_PATCH_NOTES_SEEN_KEY) || ''; }
  catch (error) { return ''; }
}

function migratePatchNoteReadIdsFromLatestSeen(readIds) {
  if (patchNotesReadIdsMigrated) return readIds;
  patchNotesReadIdsMigrated = true;
  const lastSeenId = getLastSeenPatchNoteId();
  if (!lastSeenId || readIds.has(lastSeenId)) return readIds;
  const entries = getSortedPatchNotes();
  const seenEntry = entries.find(entry => getPatchNoteEntryId(entry) === lastSeenId);
  const seenTime = getPatchNoteEntryTime(seenEntry || {});
  if (!seenEntry || !seenTime) return readIds;
  entries.forEach(entry => {
    if (getPatchNoteEntryTime(entry) <= seenTime) readIds.add(getPatchNoteEntryId(entry));
  });
  savePatchNoteReadIds(readIds);
  return readIds;
}

function getPatchNoteReadIds() {
  return migratePatchNoteReadIdsFromLatestSeen(parsePatchNoteReadIds());
}

function isPatchNoteRead(id = '') {
  return !!id && getPatchNoteReadIds().has(String(id));
}

function hasUnreadPatchNotes() {
  const readIds = getPatchNoteReadIds();
  return SCREENLIST_PATCH_NOTES.some(entry => !readIds.has(getPatchNoteEntryId(entry)));
}

const SCREENLIST_VISIBLE_VERSION_FALLBACK = 'v.413-May 6th, 2026';
let screenListVersionFooterObserver = null;

function formatScreenListOrdinalDay(day) {
  const n = Number(day || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

function formatScreenListBuildDate(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 'May 6th, 2026';
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return 'May 6th, 2026';
  const monthName = date.toLocaleString('en-US', { month: 'long' });
  return `${monthName} ${formatScreenListOrdinalDay(Number(day))}, ${year}`;
}

function getScreenListVisibleVersion() {
  const explicitVersion = String(window.SCREENLIST_DISPLAY_VERSION || '').trim();
  if (explicitVersion) return explicitVersion;
  const build = String(
    window.SCREENLIST_BUILD_VERSION ||
    document.querySelector('meta[name="screenlist-build-version"]')?.content ||
    ''
  ).trim();
  const versionMatch = build.match(/v(\d+)/i);
  if (versionMatch && versionMatch[1]) {
    return `v.${versionMatch[1]}-${formatScreenListBuildDate(build)}`;
  }
  return SCREENLIST_VISIBLE_VERSION_FALLBACK;
}

function removePublicPatchNotesEntryPoints() {
  document.querySelectorAll('button[onclick*="openPatchNotesPage"]').forEach(button => {
    button.remove();
  });
}

function ensureScreenListVersionFooters() {
  removePublicPatchNotesEntryPoints();
  const version = getScreenListVisibleVersion();
  document.querySelectorAll('.screenlist-bottom-link-wrap, .login-legal-links').forEach(wrap => {
    let footer = wrap.querySelector('.screenlist-version-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'screenlist-version-footer';
      footer.setAttribute('aria-label', 'Shelfd build version');
      wrap.appendChild(footer);
    }
    if (footer.textContent !== version) footer.textContent = version;
    footer.dataset.screenlistVersion = version;
  });
}

function startScreenListVersionFooterGuard() {
  ensureScreenListVersionFooters();
  if (screenListVersionFooterObserver || !('MutationObserver' in window)) return;
  screenListVersionFooterObserver = new MutationObserver(() => ensureScreenListVersionFooters());
  screenListVersionFooterObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function getPatchNotesLinkButtons() {
  return Array.from(document.querySelectorAll('button[onclick="openPatchNotesPage()"]'));
}

function updatePatchNotesUnreadPing() {
  ensureScreenListVersionFooters();
}

function markPatchNoteRead(id = '') {
  const cleanId = String(id || '').trim();
  if (!cleanId) return;
  const readIds = getPatchNoteReadIds();
  if (readIds.has(cleanId)) return;
  readIds.add(cleanId);
  savePatchNoteReadIds(readIds);
  const card = Array.from(document.querySelectorAll('.screenlist-patch-note-card[data-patch-note-id]'))
    .find(el => String(el.dataset.patchNoteId || '') === cleanId);
  if (card) card.classList.remove('screenlist-patch-note-unread');
  updatePatchNotesUnreadPing();
}

function disconnectPatchNotesReadObserver() {
  if (patchNotesReadObserver) patchNotesReadObserver.disconnect();
  patchNotesReadObserver = null;
}

function setupPatchNotesEntryReadObserver(page) {
  disconnectPatchNotesReadObserver();
  const cards = Array.from(page.querySelectorAll('.screenlist-patch-note-card[data-patch-note-id]'));
  if (!cards.length) return;
  if (!('IntersectionObserver' in window)) {
    cards.forEach(card => markPatchNoteRead(card.dataset.patchNoteId || ''));
    return;
  }
  patchNotesReadObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;
      const id = entry.target.dataset.patchNoteId || '';
      markPatchNoteRead(id);
      observer.unobserve(entry.target);
    });
  }, { root: page, threshold: [0.35, 0.6] });
  cards.forEach(card => {
    if (card.classList.contains('screenlist-patch-note-unread')) patchNotesReadObserver.observe(card);
  });
}

function getOrCreatePatchNotesPage() {
  let page = document.getElementById('screenlist-patch-notes-page');
  if (page) return page;
  page = document.createElement('div');
  page.id = 'screenlist-patch-notes-page';
  page.className = 'screenlist-patch-notes-page';
  page.style.display = 'none';
  page.setAttribute('aria-hidden', 'true');
  page.innerHTML = `
    <button class="screenlist-patch-notes-back screenlist-patch-notes-floating-back" type="button" onclick="closePatchNotesPage()" aria-label="Back">Back</button>
    <div class="screenlist-patch-notes-shell">
      <div class="screenlist-patch-notes-title">Patch Notes</div>
      <div class="screenlist-patch-notes-list" id="screenlist-patch-notes-list"></div>
    </div>`;
  document.body.appendChild(page);
  return page;
}


function getPatchNoteDisplayVersion(entry = {}) {
  const raw = [entry.id, entry.title, ...(Array.isArray(entry.changes) ? entry.changes : [])].join(' ');
  const match = String(raw || '').match(/v\.?\s*(\d+)/i);
  return match && match[1] ? `v.${match[1]}` : 'v.legacy';
}

function formatPatchNoteEasternDateTime(entry = {}) {
  const rawTime = `${entry.date || ''} ${entry.time || ''}`.trim();
  const parsed = Date.parse(rawTime) || Date.parse(entry.date || '');
  if (!parsed) return `${entry.date || ''}${entry.time ? ` — ${entry.time}` : ''}`.trim();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `${formatter.format(new Date(parsed))} EST`;
}

function renderPatchNotesEntries() {
  const list = document.getElementById('screenlist-patch-notes-list');
  if (!list) return;
  const entries = getSortedPatchNotes();
  const readIds = getPatchNoteReadIds();
  list.innerHTML = entries.map(entry => {
    const id = getPatchNoteEntryId(entry);
    const unreadClass = readIds.has(id) ? '' : ' screenlist-patch-note-unread';
    return `
    <article class="screenlist-patch-note-card screenlist-patch-note-card-simple${unreadClass}" data-patch-note-id="${escAttr(id)}">
      <div class="screenlist-patch-note-date">${escHtml(formatPatchNoteEasternDateTime(entry))}</div>
      <div class="screenlist-patch-note-applied">Update applied</div>
      <div class="screenlist-patch-note-version">${escHtml(getPatchNoteDisplayVersion(entry))}</div>
      <span class="screenlist-patch-note-entry-ping" aria-label="Unread update"></span>
    </article>`;
  }).join('');
}

function openPatchNotesPage() {
  const page = getOrCreatePatchNotesPage();
  patchNotesReturnScrollY = window.scrollY || window.pageYOffset || 0;
  page.style.display = 'block';
  page.setAttribute('aria-hidden', 'false');
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  renderPatchNotesEntries();
  window.requestAnimationFrame(() => setupPatchNotesEntryReadObserver(page));
}

function closePatchNotesPage() {
  disconnectPatchNotesReadObserver();
  const page = document.getElementById('screenlist-patch-notes-page');
  if (page) {
    page.style.display = 'none';
    page.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
  updatePatchNotesUnreadPing();
  window.requestAnimationFrame(() => window.scrollTo({ top: patchNotesReturnScrollY, behavior: 'auto' }));
}


document.addEventListener('DOMContentLoaded', () => {
  startScreenListVersionFooterGuard();
  updatePatchNotesUnreadPing();
});
window.addEventListener('load', () => {
  startScreenListVersionFooterGuard();
  updatePatchNotesUnreadPing();
});

window.addEventListener('resize', () => {
  clearTimeout(discoverResizeTimer);
  discoverResizeTimer = setTimeout(() => {
    getAllDiscoverGrids().forEach(grid => {
      setupDiscoverSectionLimit(grid);
    });
  }, 120);
});
