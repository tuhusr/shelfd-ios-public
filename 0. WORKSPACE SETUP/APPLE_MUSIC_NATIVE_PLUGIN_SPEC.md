# `ShelfdAppleMusic` Native iOS Capacitor Plugin — Implementation Spec

Status: **the web layer already calls this plugin, but it does not exist in the native Xcode repo.** On TestFlight/App Store the web JS resolves `getAppleMusicNativeBridge()` to `null`, so every Apple Music connect attempt on iOS throws `getAppleMusicNativeBridgeRequiredMessage()` ("Apple Music is ready server-side, but the iOS app needs a native MusicKit bridge update before connecting from TestFlight."). This doc is the exact, implementation-ready contract + native build steps to make that bridge real.

- Web layer source of truth: `assets/public/js/13-discover-add-imports.js` (lines ~795–1436)
- Capacitor app id: `com.myshelfd.app` / app name `Shelfd` (`capacitor.config.json`)
- Web is served remotely (`server.url = https://myshelfd.com`), so the plugin JS shim is delivered by the **website**, not bundled in the native build. The native build only needs to register the Swift plugin class under the name `ShelfdAppleMusic` so `window.Capacitor.Plugins.ShelfdAppleMusic` resolves.
- Worker developer-token endpoint: `GET /api/apple-music/developer-token` (`worker.js` ~8090, routed ~10321).

---

## 1. Goal & how it plugs into the existing web bridge

### 1.1 What already exists on the web side

The web resolves the bridge here (do not change this — match it):

```js
// 13-discover-add-imports.js:833
function getAppleMusicNativeBridge() {
  return window.Capacitor?.Plugins?.ShelfdAppleMusic || window.ShelfdAppleMusic || null;
}
```

So the plugin **must register under the Capacitor plugin id `ShelfdAppleMusic`**. Once registered natively, `window.Capacitor.Plugins.ShelfdAppleMusic` is populated automatically by Capacitor's bridge — no extra JS needed in most cases.

The web dispatches every call through one helper that tries an **array of method names** and uses the first one the bridge actually implements:

```js
// 13-discover-add-imports.js:1184
async function callAppleMusicBridge(methodNames = [], payload = {}) {
  const bridge = getAppleMusicNativeBridge();
  const method = bridge ? methodNames.find(name => typeof bridge[name] === 'function') : '';
  if (bridge && method) {
    return bridge[method](payload);           // <-- native call, returns a Promise
  }
  if (isShelfdNativeIosApp()) {
    throw new Error(getAppleMusicNativeBridgeRequiredMessage());
  }
  // ... web fallbacks (MusicKit JS) for non-iOS browsers
}
```

The exact method-name arrays the web tries (the native plugin must implement **at least one name from each group**):

| Web call site | `methodNames` tried (first match wins) | Payload sent | Result consumed by |
| --- | --- | --- | --- |
| `connectAppleMusicAccount()` (1212) | `['authorize', 'requestAuthorization', 'connect']` | `{ mode }` where `mode ∈ 'metadata' \| 'import'` | `normalizeAppleMusicConnection()` (809) |
| `syncAppleMusicMetadataOnly()` (1353) | `['getMetadata', 'syncMetadata', 'getLibraryMetadata']` | `{ importLibrary: false }` | `buildAppleMusicAlbumRows()` (1289) |
| `syncAppleMusicLibraryPreview()` (1405) | `['getLibrary', 'syncLibrary', 'getLibraryPreview']` | `{ importLibrary: true }` | `buildAppleMusicAlbumRows()` (1289) |

> Important: the comment in the task ("['metadata'], ['library'], ['sync']") is approximate. The **literal** names in the code are the three arrays above. Implement those exact names.

### 1.2 The `@objc` method names that must match

Capacitor exposes a Swift method to JS only if it is `@objc` and declared in the plugin's `pluginMethods`/`CAP_PLUGIN_METHOD` list. To satisfy `methodNames.find(...)`, the Swift plugin should expose these names (pick one per group; recommended set in **bold**):

- Auth group: **`authorize`** (also fine: `requestAuthorization`, `connect`)
- Metadata group: **`getMetadata`** (also fine: `syncMetadata`, `getLibraryMetadata`)
- Library group: **`getLibrary`** (also fine: `syncLibrary`, `getLibraryPreview`)
- Plus helpers (not auto-called by the bridge but good hygiene): `isAuthorized`, `unauthorize`, `getDeveloperToken` (optional passthrough).

Implementing more than one alias per group is harmless; the web takes the first that exists.

### 1.3 Optional JS shim (only if you bundle the web locally)

Because Shelfd loads the web from a remote URL, the standard Capacitor auto-registration is enough. **No shim is required.** If you ever switch to a locally bundled web build (rare), add:

```js
import { registerPlugin } from '@capacitor/core';
export const ShelfdAppleMusic = registerPlugin('ShelfdAppleMusic');
```

…but for the current remote-URL setup the only requirement is that the native plugin registers with the name `ShelfdAppleMusic`.

---

## 2. Exact method list (input / output JSON shapes)

All methods are async (Capacitor `CAPPluginCall`, resolved with a JSON object). Shapes below are exactly what the web normalizers read.

### 2.1 `authorize` (auth group) — REQUIRED

Input:
```json
{ "mode": "metadata" }     // or "import"
```

Output (read by `normalizeAppleMusicConnection`, 809):
```json
{
  "authorized": true,
  "connected": true,
  "status": "authorized",
  "provider": "appleMusic",
  "storefront": "us",
  "musicUserToken": "Ar....",          // Music-User-Token (see §3)
  "musicUserId": "",                    // optional; MusicKit does not expose a stable user id — leave "" 
  "capabilities": ["musickit-native"], // free-form string array
  "subscription": { "active": true },   // optional object
  "connectedAt": "2026-06-14T00:00:00.000Z"
}
```

Web acceptance gate (1213):
```js
const authorized = auth?.authorized !== false
  && auth?.status !== 'denied'
  && auth?.status !== 'restricted';
```

Rules for the native impl:
- On user-granted: return `authorized:true` (or omit `authorized`) and `status:"authorized"`.
- On denied: return `{ "authorized": false, "status": "denied" }` (web shows "permission was not granted").
- On restricted (parental controls / no capability): `{ "authorized": false, "status": "restricted" }`.
- `storefront` should be the lowercase 2-letter storefront id (e.g. `us`, `gb`, `jp`). The web uppercases it for display.
- `musicUserToken` — include it. The web reuses the token for the `Music-User-Token` header when it does its own `api.music.apple.com` calls (see §2.4 + §3.3). Even though `normalizeAppleMusicConnection` does not persist the token, returning it lets future web flows fetch the library directly without re-auth.

### 2.2 `isAuthorized` — RECOMMENDED (not auto-called, useful for "Manage" state)

Input: `{}`
Output:
```json
{ "authorized": true, "status": "authorized", "storefront": "us" }
```
`status` mirrors `MusicAuthorization.Status`: `authorized | denied | restricted | notDetermined`.

### 2.3 `unauthorize` — RECOMMENDED

Input: `{}`
Output: `{ "ok": true }`
> Note: MusicKit has **no programmatic revoke**. Implement this as a local clear of cached token/state and return `{ "ok": true }`; the real revoke happens in iOS Settings. Document this in the call's resolve.

### 2.4 `getMetadata` (metadata group) — REQUIRED IF the bridge serves library data

Input: `{ "importLibrary": false }`

Output — **must** be the album/song shape consumed by `buildAppleMusicAlbumRows()` (1289), which feeds each item through `normalizeAppleMusicAlbum` (1271) / `normalizeAppleMusicSong` (1249):
```json
{
  "albums": [ /* raw album objects, see §2.6 */ ],
  "songs":  [ /* raw song objects,  see §2.6 */ ],
  "storefront": "us",
  "albumCount": 42,
  "songCount": 530
}
```

### 2.5 `getLibrary` (library group) — REQUIRED IF the bridge serves library data

Input: `{ "importLibrary": true }`
Output: same shape as §2.4 (just a larger pull — the web caps at `APPLE_MUSIC_MAX_CACHE_ALBUMS = 1200` / `APPLE_MUSIC_MAX_CACHE_SONGS = 2500`).

### 2.6 Exact album/song object shapes the normalizers read

`normalizeAppleMusicAlbum` (1271) and `normalizeAppleMusicSong` (1249) are **tolerant**: they accept either Apple's raw catalog/library JSON (`raw.attributes.*`, `raw.relationships.tracks.data`) **or** a flat object. Two equally valid options:

**Option A — pass Apple's raw MusicKit JSON straight through** (matches `raw.attributes` / `raw.relationships`):
```json
// album
{
  "id": "l.AbCdEf",
  "attributes": {
    "name": "Album Name",
    "artistName": "Artist",
    "releaseDate": "2021-05-14",
    "genreNames": ["Pop"],
    "trackCount": 12,
    "artwork": { "url": "https://.../{w}x{h}.jpg" },
    "playParams": { "id": "l.AbCdEf", "kind": "album", "isLibrary": true }
  },
  "relationships": {
    "tracks": { "data": [ /* song objects, same shape as below */ ] }
  }
}
```
```json
// song
{
  "id": "i.XyZ",
  "attributes": {
    "name": "Track Title",
    "artistName": "Artist",
    "albumName": "Album Name",
    "albumArtistName": "Artist",
    "durationInMillis": 215000,
    "trackNumber": 3,
    "discNumber": 1,
    "releaseDate": "2021-05-14",
    "genreNames": ["Pop"],
    "artwork": { "url": "https://.../{w}x{h}.jpg" },
    "playParams": { "id": "i.XyZ", "kind": "song", "isLibrary": true }
  }
}
```

**Option B — flat objects** (the normalizers also read top-level keys): use `name`/`title`, `artistName`/`artist`, `albumName`/`album`, `durationInMillis`/`durationMs`/`length`, `trackNumber`, `discNumber`, `releaseDate`, `genreNames`/`genre`, `artwork` (object with `.url`, or a string), `favorite`/`favorited`/`isFavorite`, `rating`/`userRating`, `playParams`.

Artwork detail: `getAppleMusicArtworkUrl()` (1243) does `String(artwork.url).replace('{w}', size).replace('{h}', size)`. So **return the artwork URL template containing literal `{w}`/`{h}`** (MusicKit gives this verbatim) and the web sizes it. If you pre-size it, just return a plain URL string — still works.

Identity fields that matter downstream:
- `appleMusicAlbumId` comes from `raw.id` (album) — keep library ids (the `l.*` form) so re-imports dedupe.
- `appleMusicSongId` comes from `raw.id` (song) — keep `i.*`/`playParams.id`.
- `trackNumber` / `discNumber` drive track sort order in `buildAppleMusicAlbumRows` (1335).

### 2.7 Developer token

- The **developer token (Apple JWT signed with the .p8)** is produced server-side: `GET /api/apple-music/developer-token` returns:
  ```json
  { "ok": true, "developerToken": "eyJ...", "expiresAtMs": 1750000000000, "expiresAt": "..." , "appleMusic": { /* status */ } }
  ```
  (`worker.js` ~8098, TTL 12h, signed with `APPLE_MUSIC_PRIVATE_KEY` secret.)
- **The .p8 private key is NEVER shipped in the app.** It lives only as a Cloudflare Worker secret. The dev token rotated recently — the plugin must always fetch a fresh token, never cache a hardcoded one.
- Two acceptable native patterns for getting the developer token into MusicKit:
  1. **JS passes it in** — add an optional `developerToken` field to the `authorize` payload from the web (small JS change), or
  2. **Native fetches it** — the plugin does `GET https://myshelfd.com/api/apple-music/developer-token` itself before requesting the Music-User-Token.
  Pattern 2 is recommended (self-contained, no JS change). Use the `developerToken` value as the developer token when minting the Music-User-Token (see §3.2).

---

## 3. Native Swift implementation notes (MusicKit, iOS 16+)

Framework: **MusicKit** (`import MusicKit`), available iOS 15+, but use **iOS 16+** as the deployment floor for stable `MusicLibraryRequest` and token APIs.

### 3.1 Authorization

```swift
import MusicKit

let status = await MusicAuthorization.request()
switch status {
case .authorized:   // proceed
case .denied:       // return { authorized:false, status:"denied" }
case .restricted:   // return { authorized:false, status:"restricted" }
case .notDetermined: // treat as denied for this call
@unknown default:   // denied
}
```
`MusicAuthorization.request()` triggers the system prompt backed by `NSAppleMusicUsageDescription` (§4).

### 3.2 Obtaining the Music-User-Token

```swift
// Developer token from the Worker (or passed from JS)
let developerToken = try await fetchDeveloperTokenFromWorker()   // GET /api/apple-music/developer-token
let provider = MusicUserTokenProvider()
let musicUserToken = try await provider.userToken(
    for: developerToken,
    options: .ignoreCache
)
```
- `MusicUserTokenProvider.userToken(for:options:)` is the supported MusicKit way to get the Music-User-Token for a developer token.
- Reference plugins for this exact pattern:
  - **`himanushi/capacitor-plugin-musickit`** — the maintained Capacitor MusicKit plugin; recommended as the base/reference (auth, library requests, token). Either depend on it and add the `ShelfdAppleMusic`-named aliases, or copy its token/library code into a thin in-repo plugin.
  - **`terrier-capacitor-musickit`** — note its `getUserToken` pattern (developer-token → user-token) which mirrors the approach above.

### 3.3 Storefront

```swift
let storefront = try await MusicDataRequest.currentCountryCode   // e.g. "us"
```
Return it lowercased in `storefront`.

### 3.4 Two architecture choices for library data — pick one

**Choice A (lean, recommended first):** the plugin returns **only `{ musicUserToken, storefront, capabilities }`** from `authorize`, and the existing web JS does the `api.music.apple.com` calls itself.
- The web already has `fetchAppleMusicApiPage()` (972) and `fetchAppleMusicLibraryCollection()` (994) that call `https://api.music.apple.com/v1/me/library/{albums,songs}` with `Authorization: Bearer <devToken>` + `Music-User-Token: <userToken>`.
- BUT: today those web fetchers get the user token via `getAppleMusicWebUserToken()` (963) → `music.authorize()` (MusicKit **JS**), which fails in WKWebView (see §6). For Choice A to work on iOS, the web must be taught to use the **native** token (e.g. expose `getMusicUserToken` on the bridge and have `getAppleMusicWebUserToken` prefer it on iOS). That is a **web-side change**, so Choice A is not zero-JS.

**Choice B (self-contained, recommended for shipping):** the plugin implements `getMetadata` / `getLibrary` natively using `MusicLibraryRequest`, and returns the `{ albums, songs }` shape from §2.4. **No web change needed** — the existing `callAppleMusicBridge(['getMetadata',...])` / `(['getLibrary',...])` calls just work.

```swift
// Albums
var albumReq = MusicLibraryRequest<Album>()
albumReq.limit = 100
let albums = try await albumReq.response().items        // page via offset/next
// For each album, load tracks:
let detailed = try await album.with([.tracks])

// Songs
var songReq = MusicLibraryRequest<Song>()
songReq.limit = 100
let songs = try await songReq.response().items
```
Map each `Album`/`Song`/`Track` into the §2.6 JSON (Option A or B). Respect the web caps (1200 albums / 2500 songs) and the smaller "metadata-only" pulls (web web-fallback uses 300/600 for metadata vs the max for import) — for native, `importLibrary` in the payload tells you which budget to use.

> Recommendation: ship **Choice B**. It avoids any web change and sidesteps the WKWebView CORS/auth limitations entirely. Keep `musicUserToken` in the `authorize` response anyway for forward-compat.

### 3.5 Threading / resolve

Run MusicKit calls on a background `Task`, resolve the `CAPPluginCall` with a `JSObject`. On error, `call.reject(message)` so the web's `catch` surfaces a toast. For the metadata path, if you intentionally do NOT implement metadata, reject with a message containing `missing getMetadata` so the web's special-case (1356) treats it as "connected, metadata pending" rather than a hard error:
```js
// web: 1356
if (!/missing getMetadata|missing syncMetadata|missing getLibraryMetadata/i.test(message)) throw error;
```

---

## 4. Apple Developer + Xcode setup

1. **App ID** (`com.myshelfd.app`) → enable the **MusicKit** capability (Certificates, Identifiers & Profiles → Identifiers → App ID → Capabilities → MusicKit).
2. **Media ID + MusicKit key (.p8):** create/confirm a **Media Identifier** and a **MusicKit private key (.p8)** under Keys. **The key was just rotated by the dev** — confirm the new Key ID + .p8 are the ones loaded into the Worker secrets (`APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY`, `APPLE_MUSIC_TEAM_ID`). The .p8 stays server-side only; **do not** add it to the Xcode project.
3. **Entitlement:** add the **MusicKit** entitlement to the app target (Xcode → Signing & Capabilities → + Capability → MusicKit). Regenerate the provisioning profile if signing is manual.
4. **Info.plist:** add the usage string —
   - Key: `NSAppleMusicUsageDescription`
   - Sample value: `Shelfd connects to Apple Music to read your albums and songs so it can show your music stats and let you import your library into your Shelfd shelf.`
5. **Deployment target:** iOS **16.0+** (raise the target in the Capacitor `App` target + Podfile `platform :ios, '16.0'`).
6. **Install + sync:**
   - If using `himanushi/capacitor-plugin-musickit` as base: `npm i capacitor-plugin-musickit`
   - `npx cap sync ios`
   - Open `ios/App/App.xcworkspace`, confirm the plugin pod + entitlement, **rebuild → archive → upload to App Store Connect**, then **resubmit** for TestFlight/App Store review.
7. **Verify registration:** after launch, in Safari Web Inspector on the device console: `window.Capacitor.Plugins.ShelfdAppleMusic` must be truthy and expose `authorize` (+ `getMetadata`/`getLibrary` if Choice B).

---

## 5. Test checklist (Simulator + TestFlight)

Simulator (auth + plumbing only — note: a Simulator usually has **no** Apple Music subscription, so library pulls may be empty):
- [ ] `window.Capacitor.Plugins.ShelfdAppleMusic` resolves (not null) — confirms registration name.
- [ ] Tapping "Connect Apple Music" → "Connect Only" calls `authorize({mode:'metadata'})`; the **system Apple Music permission prompt appears** (proves `NSAppleMusicUsageDescription` + entitlement).
- [ ] Granting returns `{ authorized:true, status:'authorized', storefront, musicUserToken }`; web shows "Connected. Syncing metadata only…".
- [ ] Denying returns `{ authorized:false, status:'denied' }`; web shows "permission was not granted" toast.

TestFlight on a real device with an active Apple Music subscription:
- [ ] **Authorize prompt appears** once; subsequent launches skip it (status `authorized`).
- [ ] **Token returned to web** — `musicUserToken` non-empty; `storefront` correct (e.g. `us`).
- [ ] **Connect-only works** — `getMetadata({importLibrary:false})` returns `{albums,songs,...}`; `buildAppleMusicAlbumRows` produces rows; profile shows "Metadata synced for N songs".
- [ ] **Import-library works** — "Connect + Import Library" → `getLibrary({importLibrary:true})` returns the larger set; `renderImportPreview()` shows albums with covers, track counts, ratings/favorites.
- [ ] Artwork renders (the `{w}/{h}` template resolves via `getAppleMusicArtworkUrl`).
- [ ] **Error states:**
  - [ ] Permission denied in iOS Settings → re-attempt returns `denied`, web toasts, no crash.
  - [ ] Worker token endpoint down (`/api/apple-music/developer-token` 500) → plugin rejects with a clear message; web shows error, app stays usable.
  - [ ] No subscription → MusicKit returns empty library; web shows "Apple Music returned no albums to preview." (library path, 1408).
  - [ ] If `getMetadata` deliberately unimplemented → reject with "missing getMetadata …" → web shows "metadata sync is waiting for the native iOS metadata method." (1365), connection still saved.

---

## 6. Why native (short note)

MusicKit **JS** `music.authorize()` works by opening a **pop-up window** for the Apple ID sign-in / consent flow. A default Capacitor **WKWebView does not create new browser windows** (no `window.open` target), so the pop-up never opens and the JS auth silently hangs or fails. That makes in-webview MusicKit JS auth unreliable on iOS. The native plugin uses `MusicAuthorization.request()` + `MusicUserTokenProvider`, which present the **system** Apple Music permission sheet directly — the dependable, App Store-blessed path on iOS. The web MusicKit-JS path remains the fallback for real desktop/mobile browsers (`isShelfdNativeIosApp() === false`).

---

## Appendix — bridge contract quick reference (verbatim from `13-discover-add-imports.js`)

- Resolve: `window.Capacitor?.Plugins?.ShelfdAppleMusic || window.ShelfdAppleMusic || null` (834)
- Auth call: `callAppleMusicBridge(['authorize','requestAuthorization','connect'], { mode })` (1212)
- Metadata call: `callAppleMusicBridge(['getMetadata','syncMetadata','getLibraryMetadata'], { importLibrary:false })` (1353)
- Library call: `callAppleMusicBridge(['getLibrary','syncLibrary','getLibraryPreview'], { importLibrary:true })` (1405)
- Auth accept gate: `auth.authorized !== false && auth.status !== 'denied' && auth.status !== 'restricted'` (1213)
- Connection shape consumer: `normalizeAppleMusicConnection` (809) reads `connected/authorized/connectedAt`, `storefront/storefrontId`, `musicUserId/userId`, `capabilities[]`, `subscription{}`.
- Library shape consumer: `buildAppleMusicAlbumRows({ albums:[], songs:[] })` (1289) → `normalizeAppleMusicAlbum` (1271) / `normalizeAppleMusicSong` (1249).
- Developer token endpoint: `GET /api/apple-music/developer-token` → `{ ok, developerToken, expiresAtMs, expiresAt }` (worker.js 8090/10321). TTL 12h. .p8 = Worker secret only.
