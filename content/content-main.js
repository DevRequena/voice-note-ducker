// Main-world content script: finds every <audio>/<video> (including ones that
// are never attached to the DOM), reports voice notes and ducks/restores music.
// It has no extension APIs; it talks to content-bridge.js through DOM events.
(() => {
  const TO_PAGE = 'voice-note-ducker:to-page';
  const TO_EXT = 'voice-note-ducker:to-ext';
  const FADE_DOWN_MS = 200;
  const FADE_UP_MS = 400;
  const FADE_STEP_MS = 16;
  // Shorter sounds on voice sites (notification pings) are not voice notes.
  const MIN_VOICE_SECONDS = 3;
  const EPSILON = 0.005;

  let enabled = false;
  let voiceSite = false;
  let wantDucked = false; // what the service worker asked for
  let frameDucked = false; // what is actually applied in this frame
  let duckLevel = 0.1;
  let nextVoiceId = 1;
  let mediaSeen = false;

  // Per element: { original, lastSet, fade, restoring, voiceId, waitTimer }
  const info = new WeakMap();
  const playing = new Set();
  const ducked = new Set(); // elements whose volume we own (ducked or fading back up)
  const voices = new Set(); // voice note elements currently playing

  const send = (msg) =>
    document.dispatchEvent(new CustomEvent(TO_EXT, { detail: JSON.stringify(msg) }));

  const clamp = (v) => Math.min(1, Math.max(0, v));

  function track(el) {
    let s = info.get(el);
    if (s) return s;
    s = { original: 1, lastSet: null, fade: null, restoring: false, voiceId: 0, waitTimer: null };
    info.set(el, s);
    el.addEventListener('play', () => onPlay(el));
    el.addEventListener('pause', () => onStop(el));
    el.addEventListener('ended', () => onStop(el));
    el.addEventListener('emptied', () => onStop(el));
    el.addEventListener('volumechange', () => onVolumeChange(el));
    el.addEventListener('durationchange', () => onDurationChange(el));
    if (!mediaSeen) {
      // Wakes up the bridge; frames without media never talk to the extension.
      mediaSeen = true;
      send({ type: 'media-seen' });
    }
    return s;
  }

  // Track an element seen for the first time; catch it up if it's already playing.
  function adopt(el) {
    const isNew = !info.has(el);
    track(el);
    if (isNew && !el.paused) onPlay(el);
  }

  // Rules checked on the real site. WhatsApp decrypts voice notes into blob: URLs,
  // while its notification sounds are static files from static.whatsapp.net.
  function siteRule(el) {
    const src = el.currentSrc || el.src;
    if (!src || location.hostname !== 'web.whatsapp.com') return null;
    return src.startsWith('blob:') ? 'voice' : 'short';
  }

  // 'music' | 'voice' | 'short' (a ping on a voice site) | 'unknown' (length not loaded yet)
  function classify(el) {
    if (!voiceSite) return 'music';
    if (el.muted || el.volume === 0) return 'short';
    const rule = siteRule(el);
    if (rule) return rule;
    const length = el.duration;
    if (!Number.isFinite(length) || length <= 0) return 'unknown';
    return length >= MIN_VOICE_SECONDS ? 'voice' : 'short';
  }

  // Starts a voice note (or waits for its length). Returns true if el is music.
  function checkVoice(el) {
    const kind = classify(el);
    if (kind === 'voice') startVoice(el);
    else if (kind === 'unknown') waitForLength(el);
    return kind === 'music';
  }

  function decide(el) {
    if (checkVoice(el) && frameDucked) duck(el);
  }

  // Chat apps often call play() before the clip's length is known. Decide when
  // it loads; if it never does (live or recorded streams), a clip still playing
  // after MIN_VOICE_SECONDS is a voice note.
  function waitForLength(el) {
    const s = info.get(el);
    if (s.waitTimer) return;
    s.waitTimer = setTimeout(() => {
      s.waitTimer = null;
      if (enabled && !el.paused && classify(el) === 'unknown') startVoice(el);
    }, MIN_VOICE_SECONDS * 1000);
  }

  function cancelWait(el) {
    const s = info.get(el);
    clearTimeout(s.waitTimer);
    s.waitTimer = null;
  }

  function onDurationChange(el) {
    if (!info.get(el).waitTimer || classify(el) === 'unknown') return;
    cancelWait(el);
    if (enabled && !el.paused) decide(el);
  }

  function onPlay(el) {
    playing.add(el);
    if (enabled) decide(el);
  }

  function onStop(el) {
    playing.delete(el);
    cancelWait(el);
    stopVoice(el);
  }

  function startVoice(el) {
    if (voices.has(el)) return;
    const s = info.get(el);
    if (ducked.has(el)) restore(el, 0); // a voice note itself is never ducked
    voices.add(el);
    if (!s.voiceId) s.voiceId = nextVoiceId++;
    send({ type: 'voice-start', id: s.voiceId });
  }

  function stopVoice(el) {
    if (!voices.delete(el)) return;
    send({ type: 'voice-stop', id: info.get(el).voiceId });
  }

  function setVolume(el, value) {
    info.get(el).lastSet = value;
    try {
      el.volume = value;
    } catch {
      // Some players lock the volume; nothing we can do.
    }
  }

  function fadeTo(el, target, ms, onDone) {
    const s = info.get(el);
    clearTimeout(s.fade);
    s.fade = null;
    const from = el.volume;
    target = clamp(target);
    // Paused media doesn't need a fade (and its tab's timers may be throttled).
    if (ms <= 0 || el.paused || Math.abs(from - target) < EPSILON) {
      setVolume(el, target);
      if (onDone) onDone();
      return;
    }
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      // Land exactly on the target so restores give back the precise original volume.
      setVolume(el, t < 1 ? from + (target - from) * t : target);
      if (t < 1) {
        s.fade = setTimeout(step, FADE_STEP_MS);
      } else {
        s.fade = null;
        if (onDone) onDone();
      }
    };
    step();
  }

  function duck(el) {
    if (voices.has(el)) return;
    const s = info.get(el);
    // Save the original only once: re-ducking while ducked (or fading back up) keeps it.
    if (!ducked.has(el)) {
      s.original = el.volume;
      ducked.add(el);
    }
    s.restoring = false;
    fadeTo(el, Math.min(s.original, duckLevel), FADE_DOWN_MS);
  }

  function restore(el, ms = FADE_UP_MS) {
    const s = info.get(el);
    s.restoring = true;
    fadeTo(el, s.original, ms, () => {
      ducked.delete(el);
      s.restoring = false;
    });
  }

  // If someone else (the user, or the player itself) moves the volume while we
  // own it, stop managing that element and keep their value.
  function onVolumeChange(el) {
    const s = info.get(el);
    if (!ducked.has(el) || s.lastSet === null) return;
    if (Math.abs(el.volume - s.lastSet) > EPSILON) {
      clearTimeout(s.fade);
      s.fade = null;
      s.restoring = false;
      ducked.delete(el);
    }
  }

  function sync() {
    const shouldDuck = enabled && wantDucked;
    if (shouldDuck && !frameDucked) {
      frameDucked = true;
      playing.forEach((el) => duck(el));
    } else if (shouldDuck) {
      // Already ducked: only follow a level change. Elements the user released stay released.
      ducked.forEach((el) => {
        if (!info.get(el).restoring) duck(el);
      });
    } else if (frameDucked) {
      frameDucked = false;
      ducked.forEach((el) => {
        if (!info.get(el).restoring) restore(el);
      });
    }
  }

  function handleMessage(msg) {
    if (msg.type === 'config') {
      enabled = msg.enabled === true;
      voiceSite = msg.voiceSite === true;
      if (!enabled || !voiceSite) voices.forEach(stopVoice);
      // Media that started before the config arrived is classified now.
      // Only voice notes here: music the user turned up by hand stays as it is.
      if (enabled) playing.forEach((el) => checkVoice(el));
      sync();
    } else if (msg.type === 'state') {
      wantDucked = msg.ducked === true;
      const level = Number(msg.level);
      if (Number.isFinite(level)) duckLevel = clamp(level);
      sync();
    } else if (msg.type === 'resync') {
      // Back from the back/forward cache: the service worker forgot our voices.
      voices.forEach((el) => {
        voices.delete(el);
        if (!el.paused) onPlay(el);
      });
    }
  }

  document.addEventListener(TO_PAGE, (event) => {
    let msg;
    try {
      msg = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (msg && typeof msg.type === 'string') handleMessage(msg);
  });

  // 1) Media created with `new Audio()` and never attached: hook play().
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    if (this instanceof HTMLMediaElement) adopt(this);
    return nativePlay.apply(this, args);
  };

  // 2) Any media in the DOM that starts playing, including autoplay and media
  // added later. "play" doesn't bubble, so capture it. This replaces a
  // MutationObserver: only media that plays matters, and watching every DOM
  // change on heavy pages (YouTube, WhatsApp) costs far more.
  document.addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement) adopt(event.target);
    },
    true,
  );
})();
