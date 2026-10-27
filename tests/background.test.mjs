// Runs background.js against a fake `chrome` API. Usage: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createExtension(tabIds = [1, 2, 3]) {
  const listeners = { message: [], storage: [], removed: [], replaced: [] };
  const syncData = {};
  const sessionData = {};
  const sent = [];
  const badge = { text: '' };
  const event = (list) => ({ addListener: (fn) => list.push(fn) });

  const chrome = {
    runtime: { onMessage: event(listeners.message) },
    storage: {
      onChanged: event(listeners.storage),
      sync: {
        get: async (defaults) => structuredClone({ ...defaults, ...syncData }),
        set: async (values) => {
          Object.assign(syncData, structuredClone(values));
          listeners.storage.forEach((fn) => fn({}, 'sync'));
        },
      },
      session: {
        get: async (key) => (key in sessionData ? { [key]: structuredClone(sessionData[key]) } : {}),
        set: async (values) => Object.assign(sessionData, structuredClone(values)),
      },
    },
    tabs: {
      query: async () => tabIds.map((id) => ({ id })),
      sendMessage: async (tabId, msg) => sent.push({ tabId, ...msg }),
      onRemoved: event(listeners.removed),
      onReplaced: event(listeners.replaced),
    },
    action: {
      setBadgeText: async ({ text }) => (badge.text = text),
      setBadgeBackgroundColor: async () => {},
    },
  };

  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, structuredClone });
  context.importScripts = (path) => vm.runInContext(read(path), context);
  vm.runInContext(read('background.js'), context);

  const message = (msg, tabId, frameId = 0) =>
    new Promise((resolve) => {
      listeners.message[0](msg, { tab: { id: tabId }, frameId }, resolve);
    });

  // Last state each tab received.
  const lastState = () => {
    const result = {};
    for (const msg of sent) result[msg.tabId] = msg.ducked;
    return result;
  };

  // Every tab reports media (hello), as a page with audio/video would.
  const ready = async () => {
    for (const id of tabIds) await message({ type: 'hello' }, id);
  };

  return { chrome, listeners, sent, badge, message, lastState, ready };
}

test('voice note ducks other tabs but never its own', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  assert.deepEqual(ext.lastState(), { 1: false, 2: true, 3: true });
  assert.equal(ext.badge.text, '▼');
  assert.equal(ext.sent.find((m) => m.tabId === 2).level, 0.1);
});

test('restores after the grace period, not before', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  await ext.message({ type: 'voice-stop', id: 1 }, 1);
  assert.equal(ext.lastState()[2], true);
  await wait(650);
  assert.deepEqual(ext.lastState(), { 1: false, 2: false, 3: false });
  assert.equal(ext.badge.text, '');
});

test('back-to-back voice notes never restore in between', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  await ext.message({ type: 'voice-stop', id: 1 }, 1);
  await wait(100);
  await ext.message({ type: 'voice-start', id: 2 }, 1);
  await wait(650);
  assert.ok(!ext.sent.some((m) => m.tabId === 2 && m.ducked === false));
});

test('overlapping voice notes: restore only when the last one stops', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  await ext.message({ type: 'voice-start', id: 1 }, 3); // same id, other tab
  await ext.message({ type: 'voice-stop', id: 1 }, 1);
  await wait(650);
  assert.deepEqual(ext.lastState(), { 1: true, 2: true, 3: false });
  await ext.message({ type: 'voice-stop', id: 1 }, 3);
  await wait(650);
  assert.deepEqual(ext.lastState(), { 1: false, 2: false, 3: false });
});

test('closing the voice note tab restores everything', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  ext.listeners.removed[0](1);
  await wait(650);
  assert.equal(ext.lastState()[2], false);
});

test('leaving the page (frame-reset) clears only that frame’s voices', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1, 5); // voice in a subframe
  await ext.message({ type: 'voice-start', id: 1 }, 1, 0); // and one in the top frame
  await ext.message({ type: 'frame-reset' }, 1, 5);
  await wait(650);
  assert.equal(ext.lastState()[2], true);
  await ext.message({ type: 'frame-reset' }, 1, 0);
  await wait(650);
  assert.equal(ext.lastState()[2], false);
});

test('hello from a new document clears that frame’s stale voices', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  const response = await ext.message({ type: 'hello' }, 1);
  assert.equal(response.ducked, true); // still applied during the grace period
  await wait(650);
  assert.equal(ext.lastState()[2], false);
});

test('only tabs with media are messaged, and only when their state changes', async () => {
  const ext = createExtension([1, 2, 3, 4]);
  for (const id of [1, 2]) await ext.message({ type: 'hello' }, id);
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  await ext.message({ type: 'voice-start', id: 2 }, 1);
  assert.deepEqual(
    ext.sent.map((m) => [m.tabId, m.ducked]),
    [
      [1, false],
      [2, true],
    ],
  );
});

test('new tab opened while ducking gets the ducked state', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  const response = await ext.message({ type: 'hello' }, 9);
  assert.deepEqual({ ...response }, { type: 'state', ducked: true, level: 0.1 });
});

test('disabling restores immediately and ignores new voice notes', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  await ext.chrome.storage.sync.set({ enabled: false });
  await wait(20);
  assert.equal(ext.lastState()[2], false);
  await ext.message({ type: 'voice-start', id: 2 }, 1);
  assert.equal(ext.lastState()[2], false);
});

test('level changes are pushed live to ducked tabs', async () => {
  const ext = createExtension();
  await ext.ready();
  await ext.message({ type: 'voice-start', id: 1 }, 1);
  await ext.chrome.storage.sync.set({ duckLevel: 0.3 });
  await wait(20);
  const last = ext.sent.filter((m) => m.tabId === 2).at(-1);
  assert.deepEqual({ ducked: last.ducked, level: last.level }, { ducked: true, level: 0.3 });
});
