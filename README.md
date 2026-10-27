# Voice Note Ducker

A Chrome / Edge / Brave extension (Manifest V3). When a voice note starts playing in one tab, it
fades every other tab's `<audio>` / `<video>` down to a low level, and fades it back to the exact
previous volume when the voice note pauses or ends.

Everything runs locally. The extension makes no network requests and collects no data.

## Install (unpacked)

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Turn on **Developer mode** (top right in Chrome and Brave, left sidebar in Edge).
3. Click **Load unpacked** and select this folder (the one that contains `manifest.json`).
4. **Reload the tabs that were already open.** Content scripts are only injected into pages
   loaded after the extension is installed.

Requires Chrome 111 or newer, or Edge/Brave on the same engine version.

## How it works

```
 voice-note tab                       service worker                     other tabs
 content-main.js (page world)         background.js                      content-main.js
   └ sees <audio> play  ──event──▶ content-bridge.js ──message──▶  tracks voice notes ──message──▶ bridge ──event──▶ duck / restore
```

- `content/content-main.js` runs in the page's own JavaScript world, in every frame, at
  `document_start`. It finds media two ways: a capturing `play` listener catches any element in
  the DOM that starts playing (autoplay or added later), and a hook on `HTMLMediaElement.play()`
  catches elements that are never attached to the DOM (`new Audio()`, which several chat apps use).
  There is deliberately no `MutationObserver`. Only media that plays matters, and watching every
  DOM change on heavy pages like YouTube or WhatsApp would cost far more.
- `content/content-bridge.js` runs in the extension's isolated world. It is the only page-side
  part that can use extension APIs, so it relays messages between the page and the service worker.
  It stays idle until its frame has media. Frames without audio or video (most of them, ads
  included) never read settings or wake the service worker.
- `background.js` keeps the set of playing voice notes (per tab, frame and element) in
  `chrome.storage.session`, so it survives the service worker being stopped. It only messages tabs
  that have media, and only when their state changes. Storage is written only when something
  changed. A tab with a playing voice note is never ducked. Ducking ends only when no voice note is
  left, after a 500 ms grace period so consecutive voice notes don't make the music jump up between
  them.

### Classification

- On a **voice note site** (default: `web.whatsapp.com`, `web.telegram.org`, `app.slack.com`,
  `discord.com`, and their subdomains), any media element that starts playing is a voice note.
  The exceptions are muted or zero-volume media (GIF videos) and clips shorter than 3 seconds
  (notification sounds). Chat apps often start a clip before its length is known. In that case the
  decision waits until the length loads. If it never loads, a clip still playing after 3 seconds
  counts as a voice note.
- WhatsApp Web has a stricter rule, checked on the real site. WhatsApp decrypts voice notes in
  the browser, so they play from `blob:` URLs. Its notification sounds are static files from
  `static.whatsapp.net`. On WhatsApp only `blob:` media counts as a voice note, and it ducks
  immediately without waiting for the length.
- Media on any other site counts as music.

### Volume rules

- The ducking level is an absolute cap: media at 100% drops to 10% by default, and media already
  below the level is left alone.
- The original volume is saved once, when the element is first ducked, and is never overwritten
  while ducked, even if ducking starts again during the fade back up.
- If the volume changes while we are managing it (you drag the player's slider), the extension
  stops managing that element and keeps your value. It is not restored over.
- Fades take about 200 ms down and 400 ms up. Paused media changes instantly.
- Media that starts playing while ducking is active is ducked too. This covers YouTube's
  single-page navigation, where the same `<video>` element is reused for the next video.

## Popup

- **Enabled** turns the whole extension on or off. Turning it off restores everything immediately.
- **Ducking level**: 0–50%.
- **Voice note sites**: add or remove host names. Subdomains match automatically.

Settings live in `chrome.storage.sync` and apply live to open tabs. While ducking is active, the
toolbar icon shows a `▼` badge.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Settings (`chrome.storage.sync`) and the list of playing voice notes (`chrome.storage.session`). |
| Content scripts on `<all_urls>` | Music and voice notes can play on any site and in any iframe, so the scripts must run everywhere. This is declared only under `content_scripts`; there is no `host_permissions` entry. |

**Not requested: `tabs`.** The service worker only needs tab IDs (`chrome.tabs.query`,
`chrome.tabs.sendMessage`, `chrome.tabs.onRemoved`). Those work without the `tabs` permission,
which only adds access to tab URLs and titles. The extension never reads those.

## Manual test plan

Before you start, reload the extension on the extensions page and reload any open tabs.

1. **Basic ducking.** Play a YouTube video at a clearly audible volume. In another tab, open
   WhatsApp Web and play a voice note. YouTube should fade down within about 0.2 s and the badge
   should show `▼`. When the voice note ends, YouTube should fade back to the same volume within
   about 1 s, and the badge should clear.
2. **Pause mid-note.** Play a voice note, pause it halfway, then resume it. YouTube should go up on
   pause and down again on resume.
3. **Back-to-back notes.** Play a voice note immediately followed by another one (WhatsApp plays
   consecutive notes automatically). YouTube should stay low the whole time, with no bump between
   the notes.
4. **Close the voice note tab.** While a voice note is playing, close the WhatsApp tab. YouTube
   should return to its volume within about 1 s.
5. **Manual change.** While ducked, drag YouTube's volume slider to around 50%. When the voice note
   ends, YouTube should stay at 50%.
6. **YouTube navigation.** While ducked, click another video on YouTube. The new video should also
   start low.
7. **Settings live.** While ducked, move the slider in the popup to 40%. YouTube should follow on
   release. Turn **Enabled** off and YouTube should return to its volume immediately.
8. **Never duck the voice tab.** With YouTube embedded in a chat (or any media in the WhatsApp tab
   itself), confirm that the voice note's own tab is never lowered.
9. **Other browsers.** Repeat test 1 in Edge and Brave.

To inspect the service worker, click **service worker** under the extension on the extensions
page. Run `chrome.storage.session.get('duckState')` in its console.

## Development

There is no build step. `npm test` runs the Node tests (Node 18 or newer, no dependencies). They
use fake `chrome` and DOM objects to exercise the service worker logic and the duck/restore engine.
`npm run icons` regenerates the icons and the 300×300 store logo. `npm run package` builds
`dist/voice-note-ducker-<version>.zip` for the stores. Store texts and screenshots live in `store/`
(see `store/listing.md`). The public page and the privacy policy live in `docs/`, served by
GitHub Pages at https://devrequena.github.io/voice-note-ducker/.

The extension is translated into English and Spanish (`_locales/`). It follows the browser's
language. To show a donation link in the popup, set `DONATION_URL` in `popup/popup.js`.

## Known limitations

- **Desktop apps are not detected.** The WhatsApp, Telegram, Slack, Discord and Spotify desktop
  apps live outside the browser.
- **Web Audio API** output (some games, synths and players) is not a media element and is not ducked.
- **DRM and custom players** may ignore or reset `volume`. If a player resets the volume itself
  while ducked, that counts as a manual change and the element is released until it plays again.
  Some players also save whatever volume they see, so they could remember the ducked level.
- **Already-open tabs** need a reload after installing or updating the extension.
- **Voice note sites are host-based.** Any long, unmuted audio on those sites counts as a voice
  note. That includes Slack huddles, Discord voice channels and incoming-call ringtones.
- Media inside closed shadow roots that autoplays without calling `play()` is not detected.
- Pages can see the extension's DOM events and could fake a voice note. The worst case is that the
  page ducks your other tabs. The page cannot read your settings or other tabs.
- Browser-internal pages (`chrome://`, the Web Store, the PDF viewer) can't run content scripts.
