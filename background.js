// Service worker: keeps track of playing voice notes and tells every tab with
// media whether it should be ducked.
importScripts('shared/defaults.js');

const { DEFAULT_SETTINGS, sanitizeSettings } = VoiceNoteDuckerShared;

// Wait this long before restoring, so back-to-back voice notes don't bump the music up.
const RESTORE_GRACE_MS = 500;
const STATE_KEY = 'duckState';

let settings = null;
// voices: { "tabId|frameId|voiceId": true }
// mediaTabs: { tabId: true }, tabs that reported media; the only ones we message.
// applied: whether tabs are currently told to duck.
// Mirrored to storage.session because the service worker can be stopped at any time.
let state = null;
let graceTimer = null;
let queue = Promise.resolve();
// Last state sent to each tab, so unchanged tabs aren't messaged again.
// Lost when the worker stops, which only means one extra resend.
const lastSent = new Map();

async function loadSettings() {
  settings = sanitizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
}

// Serialize every state change so rapid play/pause messages never race.
// Storage is only written when something actually changed.
function withState(fn) {
  const run = queue.then(async () => {
    if (!settings) await loadSettings();
    if (!state) {
      const stored = await chrome.storage.session.get(STATE_KEY);
      state = { voices: {}, mediaTabs: {}, applied: false, ...stored[STATE_KEY] };
    }
    const before = JSON.stringify(state);
    const result = await fn();
    if (JSON.stringify(state) !== before) await chrome.storage.session.set({ [STATE_KEY]: state });
    return result;
  });
  queue = run.catch((err) => console.error('[Voice Note Ducker]', err));
  return run;
}

const voiceKey = (tabId, frameId, id) => `${tabId}|${frameId}|${id}`;
const hasVoices = () => Object.keys(state.voices).length > 0;

function voiceTabs() {
  return new Set(Object.keys(state.voices).map((key) => Number(key.split('|')[0])));
}

// Drop the voices of one frame, or of the whole tab when no frame is given.
function clearVoices(tabId, frameId) {
  const prefix = frameId === undefined ? `${tabId}|` : `${tabId}|${frameId}|`;
  let changed = false;
  for (const key of Object.keys(state.voices)) {
    if (key.startsWith(prefix)) {
      delete state.voices[key];
      changed = true;
    }
  }
  return changed;
}

// A tab that plays a voice note is never ducked.
function tabState(tabId, tabsWithVoices = voiceTabs()) {
  return {
    type: 'state',
    ducked: state.applied && !tabsWithVoices.has(tabId),
    level: settings.duckLevel,
  };
}

function setApplied(applied) {
  if (state.applied === applied) return;
  state.applied = applied;
  chrome.action.setBadgeText({ text: applied ? '▼' : '' });
}

function broadcast() {
  const tabsWithVoices = voiceTabs();
  for (const id of Object.keys(state.mediaTabs)) {
    const tabId = Number(id);
    const msg = tabState(tabId, tabsWithVoices);
    const signature = `${msg.ducked}|${msg.level}`;
    if (lastSent.get(tabId) === signature) continue;
    lastSent.set(tabId, signature);
    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  }
}

function update() {
  if (settings.enabled && hasVoices()) {
    clearTimeout(graceTimer);
    graceTimer = null;
    setApplied(true);
    broadcast();
  } else if (!settings.enabled && state.applied) {
    clearTimeout(graceTimer);
    graceTimer = null;
    setApplied(false);
    broadcast();
  } else if (state.applied && !graceTimer) {
    graceTimer = setTimeout(() => {
      graceTimer = null;
      withState(finishRestore);
    }, RESTORE_GRACE_MS);
  }
}

function finishRestore() {
  if (!state.applied || (settings.enabled && hasVoices())) return;
  setApplied(false);
  broadcast();
}

function handleMessage(msg, tabId, frameId) {
  switch (msg.type) {
    case 'hello':
      // First media in a new document: remember the tab, and forget any voice
      // note left over from the frame's previous document.
      state.mediaTabs[tabId] = true;
      if (clearVoices(tabId, frameId)) update();
      return tabState(tabId);
    case 'frame-reset':
      if (clearVoices(tabId, frameId)) update();
      return null;
    case 'voice-start':
      if (!settings.enabled) return null;
      state.voices[voiceKey(tabId, frameId, msg.id)] = true;
      update();
      return null;
    case 'voice-stop': {
      const key = voiceKey(tabId, frameId, msg.id);
      if (!state.voices[key]) return null;
      delete state.voices[key];
      update();
      return null;
    }
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !msg || typeof msg.type !== 'string') return false;
  withState(() => handleMessage(msg, tabId, sender.frameId ?? 0)).then(
    (response) => sendResponse(response),
    () => sendResponse(null),
  );
  return true; // respond asynchronously
});

// Live settings: level changes re-target ducked tabs, disabling restores everything.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'sync') return;
  withState(async () => {
    await loadSettings();
    if (!settings.enabled) state.voices = {};
    update();
  });
});

// A tab closed (even while its voice note plays): forget it, restoring if it was the last voice.
function forgetTab(tabId) {
  withState(() => {
    delete state.mediaTabs[tabId];
    lastSent.delete(tabId);
    if (clearVoices(tabId)) update();
  });
}

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => forgetTab(removedTabId));

chrome.action.setBadgeBackgroundColor({ color: '#5b4bd6' });
