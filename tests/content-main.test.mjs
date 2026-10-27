// Runs content/content-main.js against a minimal fake DOM. Usage: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../content/content-main.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPage(hostname = 'example.com') {
  class FakeMedia extends EventTarget {
    constructor(volume = 1, duration = 30) {
      super();
      this._volume = volume;
      this.paused = true;
      this.muted = false;
      this.duration = duration;
      this.src = '';
      this.currentSrc = '';
      this.nodeType = 1;
    }
    get volume() {
      return this._volume;
    }
    set volume(v) {
      this._volume = v;
      queueMicrotask(() => this.dispatchEvent(new Event('volumechange')));
    }
    play() {
      this.paused = false;
      queueMicrotask(() => this.dispatchEvent(new Event('play')));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      queueMicrotask(() => this.dispatchEvent(new Event('pause')));
    }
  }

  const document = new EventTarget();
  document.querySelectorAll = () => [];
  const toExt = [];
  document.addEventListener('voice-note-ducker:to-ext', (e) => toExt.push(JSON.parse(e.detail)));

  const context = vm.createContext({
    document,
    location: { hostname },
    HTMLMediaElement: FakeMedia,
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class {
      observe() {}
    },
    CustomEvent,
    performance,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context);

  const toPage = (msg) =>
    document.dispatchEvent(new CustomEvent('voice-note-ducker:to-page', { detail: JSON.stringify(msg) }));

  return { FakeMedia, toExt, toPage };
}

test('ducks playing music with a fade and restores the exact volume', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  const music = new page.FakeMedia(0.8);
  music.play();
  await wait(5);
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(50);
  assert.ok(music.volume < 0.8 && music.volume > 0.1, 'mid-fade');
  await wait(250);
  assert.equal(music.volume, 0.1);
  page.toPage({ type: 'state', ducked: false, level: 0.1 });
  await wait(500);
  assert.equal(music.volume, 0.8);
});

test('never raises media that is already quieter than the level', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  const music = new page.FakeMedia(0.05);
  music.play();
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(300);
  assert.equal(music.volume, 0.05);
});

test('a manual volume change while ducked is respected', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  const music = new page.FakeMedia(1);
  music.play();
  await wait(5);
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(300);
  music.volume = 0.4; // user drags the player's slider
  await wait(5);
  page.toPage({ type: 'state', ducked: false, level: 0.1 });
  await wait(500);
  assert.equal(music.volume, 0.4);
});

test('re-ducking while fading back up keeps the original volume', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  const music = new page.FakeMedia(0.9);
  music.play();
  await wait(5);
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(300);
  page.toPage({ type: 'state', ducked: false, level: 0.1 });
  await wait(150);
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(300);
  page.toPage({ type: 'state', ducked: false, level: 0.1 });
  await wait(500);
  assert.equal(music.volume, 0.9);
});

test('media that starts while ducked is ducked (e.g. next YouTube video)', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  page.toPage({ type: 'state', ducked: true, level: 0.2 });
  const music = new page.FakeMedia(0.7);
  music.play();
  await wait(300);
  assert.equal(music.volume, 0.2);
});

test('voice notes report start/stop and skip short pings and muted media', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: true });
  const ping = new page.FakeMedia(1, 0.8);
  const gif = new page.FakeMedia(1, 10);
  gif.muted = true;
  ping.play();
  gif.play();
  const voice = new page.FakeMedia(1, 12);
  voice.play();
  await wait(5);
  voice.pause();
  await wait(5);
  assert.deepEqual(
    page.toExt.filter((m) => m.type !== 'media-seen'),
    [
      { type: 'voice-start', id: 1 },
      { type: 'voice-stop', id: 1 },
    ],
  );
});

test('nothing happens while disabled', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: false, voiceSite: false });
  const music = new page.FakeMedia(1);
  music.play();
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(300);
  assert.equal(music.volume, 1);
});

test('reports media once, and classifies a voice note that started before the config', async () => {
  const page = createPage();
  const voice = new page.FakeMedia(1, 12);
  voice.play();
  new page.FakeMedia(1, 0.5).play(); // a ping: tracked, but not a voice note
  await wait(5);
  assert.deepEqual(page.toExt, [{ type: 'media-seen' }]);
  page.toPage({ type: 'config', enabled: true, voiceSite: true });
  assert.deepEqual(page.toExt.at(-1), { type: 'voice-start', id: 1 });
});

test('a ping whose length loads after play() is not a voice note', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: true });
  const ping = new page.FakeMedia(1, NaN);
  ping.play();
  await wait(5);
  ping.duration = 1.2;
  ping.dispatchEvent(new Event('durationchange'));
  await wait(5);
  ping.pause();
  await wait(5);
  assert.deepEqual(page.toExt, [{ type: 'media-seen' }]);
});

test('a voice note whose length loads after play() still counts', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: true });
  const voice = new page.FakeMedia(1, NaN);
  voice.play();
  await wait(5);
  voice.duration = 25;
  voice.dispatchEvent(new Event('durationchange'));
  assert.deepEqual(page.toExt.at(-1), { type: 'voice-start', id: 1 });
});

test('a clip of unknown length that keeps playing counts after 3 s', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: true });
  const voice = new page.FakeMedia(1, Infinity);
  voice.play();
  await wait(2800);
  assert.deepEqual(page.toExt, [{ type: 'media-seen' }]);
  await wait(300);
  assert.deepEqual(page.toExt.at(-1), { type: 'voice-start', id: 1 });
});

test('changing settings while ducked keeps a manual volume change', async () => {
  const page = createPage();
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  const music = new page.FakeMedia(1);
  music.play();
  await wait(5);
  page.toPage({ type: 'state', ducked: true, level: 0.1 });
  await wait(300);
  music.volume = 0.6;
  await wait(5);
  page.toPage({ type: 'config', enabled: true, voiceSite: false });
  await wait(300);
  assert.equal(music.volume, 0.6);
});

test('WhatsApp: static notification sound is ignored, blob voice note starts at once', async () => {
  const page = createPage('web.whatsapp.com');
  page.toPage({ type: 'config', enabled: true, voiceSite: true });
  const ping = new page.FakeMedia(1, NaN);
  ping.src = 'https://static.whatsapp.net/rsrc.php/yW/r/BS_BUUXbKq5.mp3';
  ping.play();
  await wait(5);
  ping.duration = 8; // even if it were long, it is still a notification
  ping.dispatchEvent(new Event('durationchange'));
  assert.deepEqual(page.toExt, [{ type: 'media-seen' }]);
  const voice = new page.FakeMedia(1, NaN);
  voice.src = 'blob:https://web.whatsapp.com/0d90a488-eaf4-474d-ac1b-f2d71a';
  voice.play();
  await wait(5);
  assert.deepEqual(page.toExt.at(-1), { type: 'voice-start', id: 1 });
});
