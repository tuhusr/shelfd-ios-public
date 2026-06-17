C:\Users\kingk\.claude\projects\C--Users-kingk-Desktop-websites-claudecode\memory\MEMORY.md <- all claude memory from CC



#### **DEV TEAM INFORMATION**

**developer and creator account info**

username @kingkooom

display name: King Kooom

email: King Kooom
firebase user UID: KihPpiqSsFMpn5Tee4xZWFWapg62



**Creative Team Member account info**
email: zippy.zavy@gmail.com
username: @rushlust
firebase user UID:JD3Oa7TdGMgW5IOs7feUPD7Ybb42



**CSS and JS files**
-- You are allowed to make new css and js files if you think it is necessary. 
-- You can take aspects from certain css and js files to make a new one if you deem is necessary

\-- If there are 2 aspects inside 1 css or 1 js and it would make more sense to completely separate them into their own, you can do that


**default animations**
- always targeting 120fps
- always targeting 390ms 
- always targeting smooth transitions 


**Default font:** Sohne

**default font size:** 15px

*default letter spacing: 0.00em


**default font weights**
titles - 600
subleaders - 500
body text - 400
light text - 300


**work reply**
- while working give me simple updates in plain English. 2 sentences max but it does not have to be 2 sentences
- when finished tell me the version deployed, tell me what issues you found if any (3 sentences max if needed, can be less)
- tell me what you did to fix is (max of 3 sentences if needed can be less)


iOS Capacitor build is the source of truth - author for iPhone 14 Pro Max (430x932), hold across iPhone to Max range.

currently on the iOS app store.


**Displays to account for**

iPhone Display Sizes + Resolutions

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


**For actual UI testing, the most important:**

360 x 800
390 x 844
402 x 874
430 x 932
440 x 956
412 x 915


**Android phone sizing as well**

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

ANY UPDATES TO FIRESTORE RULES: make it very clear in chat using emojis bold and all caps
"FIRESTORE RULES MUST BE UDPATED"
there will be a live file with the firestore rules. edit C:\Users\kingk\Desktop\websites\chat gpt edits\7\0.1CURRENT FIRESTORE RULES.txt ANYTIME there needs to be an update to the firestore rules. once updated i will then copy the updated file and paste into firestore



##### **Deploy Workflow (every edit)**


\\- Edit the \\\*\\\*root\\\*\\\* files in `C:\\\\Users\\\\kingk\\\\Desktop\\\\websites\\\\chat gpt edits\\\\7\\\\`


\\- Bump the `?v=` cache-buster on every changed CSS/JS file in `index.html`


\\- Update the \\\*\\\*3 version values\\\*\\\* in `index.html` (meta `screenlist-build-version`, `window.SCREENLIST\\\_BUILD\\\_VERSION`, `window.SCREENLIST\\\_DISPLAY\\\_VERSION`)


\\- Deploy with `npx wrangler deploy in the root folder powershell 


\\- Version-copy backup → `1. new versions\\\\v<num>\\\_<desc>` (full `assets/` + `worker.js` + `wrangler.jsonc` + `VERSION.txt`), \\\*\\\*no "A\\\_" prefix\\\*\\\*


\\- Live worker is `7\\\\worker.js`; new server routes must be added to `run\\\_worker\\\_first` in `wrangler.jsonc`


**\\## One Prompt At A Time**


\\- If new prompts arrive mid-task, \\\*\\\*queue them\\\*\\\* — finish the current pass (edit → version copy → deploy → patch notes) before starting the next; never batch


**\\## Code Approach**


\\- \\\*\\\*Rebuild over override\\\*\\\* — delete the conflicting old code and rebuild fresh under a clean class/path; never stack `!important` or specificity hacks to win the cascade


\\- \\\*\\\*Never hardcode a fix for one title\\\*\\\* — fixes must be general


**\\## Design / UI**


\\- \\\*\\\*"Editorial Dark"\\\*\\\* style: true blacks, single lavender accent, editorial typography (Letterboxd / Apple TV+ / Spotify / Mubi)


\\- \\\*\\\*Dark mode only\\\*\\\* — no new light-mode CSS, no `body.light-mode` rules, don't touch `16-light-mode-contrast.css` for light mode


\\- \\\*\\\*iOS Capacitor build is the source of truth\\\*\\\* — author for iPhone 14 Pro Max (430×932), hold across iPhone → Max range


\\- \\\*\\\*Söhne\\\*\\\* is the default font (weight table respected)


\\- \\\*\\\*Default letter-spacing is `0.00em`\\\*\\\* — this is the standard text tracking for ALL new text from here on out (headers, titles, body). Use it unless a specific element calls for something else.


\\- \\\*\\\*Animation standards\\\*\\\* — ProMotion 120Hz, transform + opacity only during motion, FLIP when needed, no layout animation



\\- \\\*\\\*Liquid Glass\\\*\\\* — when the dev asks for "liquid glass / glassy / frosted" surfaces (popovers, modals, panels), use the canonical recipe in `SHELFD\_CONTEXT.md` → "Liquid Glass UI". Core = heavy `backdrop-filter: blur(\~40px) saturate(180%) brightness(1.08)` + layered translucent gradient fill + `inset 0 1px 0 rgba(255,255,255,0.30)` top highlight. Popovers anchor near their trigger and scale open from the trigger corner (not centered). Reference build: `.mylist-settings-panel` (v11.239).


**\\## Security / Constraints**


\\- Don't expose any API keys on the front end


\\- Don't change Firestore rules unless required and explained


**Virtual MacOS prompt to put into the command prompt to pull the latest files on the virtual macOS**
cd \~/path/to/shelfd-ios-public

git pull origin main



