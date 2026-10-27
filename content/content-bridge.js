// Isolated-world content script: the only part of the page side that can talk
// to the extension. It relays messages between the service worker and
// content-main.js (which runs in the page's own world).
// It stays idle until the frame actually has media, so most frames cost nothing.
(() => {
  const { DEFAULT_SETTINGS, isVoiceHost, sanitizeSettings } = VoiceNoteDuckerShared;
  const TO_PAGE = 'voice-note-ducker:to-page';
  const TO_EXT = 'voice-note-ducker:to-ext';

  let started = false;
  let hadVoice = false;

  // Strings are used as event detail because objects don't cross JS worlds.
  const toPage = (msg) =>
    document.dispatchEvent(new CustomEvent(TO_PAGE, { detail: JSON.stringify(msg) }));

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      // The extension was reloaded and this script is orphaned.
      return Promise.resolve(null);
    }
  }

  async function loadConfig() {
    const settings = sanitizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
    toPage({
      type: 'config',
      enabled: settings.enabled,
      voiceSite: isVoiceHost(location.hostname, settings.voiceSites),
    });
  }

  async function hello() {
    const response = await send({ type: 'hello' });
    if (response && response.type === 'state') toPage(response);
  }

  function start() {
    if (started) return;
    started = true;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'state') toPage(msg);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.enabled || changes.voiceSites)) loadConfig();
    });
    // hello goes out first so it can never clear a voice note reported right after it.
    hello();
    loadConfig();
  }

  document.addEventListener(TO_EXT, (event) => {
    let msg;
    try {
      msg = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (msg.type === 'media-seen') {
      start();
    } else if (msg.type === 'voice-start' || msg.type === 'voice-stop') {
      const id = Number(msg.id);
      if (!Number.isInteger(id) || id <= 0) return;
      if (msg.type === 'voice-start') hadVoice = true;
      send({ type: msg.type, id });
    }
  });

  // Leaving the page (or entering the back/forward cache) ends its voice notes.
  addEventListener('pagehide', () => {
    if (hadVoice) send({ type: 'frame-reset' });
  });
  addEventListener('pageshow', async (event) => {
    if (!event.persisted || !started) return;
    await hello();
    toPage({ type: 'resync' });
  });
})();
