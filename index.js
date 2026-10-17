import { ACTIVE_KIT, DEFAULT_KIT, getKit, samplePath, playbackRate, setActiveKit } from './kits.js';
export { ACTIVE_KIT, DEFAULT_KIT, getKit } from './kits.js';

const buttons = new Map();
const boundButtons = new WeakSet();
const animationTimers = new Map();
const buffers = new Map();
const fallbackSounds = new Map();
const activeSources = new Set();
const heldNotes = new Map();
const keyboardShortcuts = new Map();
const loading = new Map();
const readyKits = new Set();
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext;
try {
  if (AudioContextClass) audioContext = new AudioContextClass({ latencyHint: 'interactive' });
} catch {}

export function loadKit(id = ACTIVE_KIT) {
  if (loading.has(id)) return loading.get(id);
  const promise = Promise.all([...new Set(Object.values(getKit(id).sounds).flat())].map(async path => {
    if (buffers.has(path)) return;
    const response = await fetch(path, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Nepavyko įkelti būgnų garsų.');
    const data = await response.arrayBuffer();
    if (audioContext) buffers.set(path, await audioContext.decodeAudioData(data));
    else {
      const audio = new Audio(path);
      audio.preload = 'auto';
      audio.load();
      fallbackSounds.set(path, { voices: [audio], next: 0 });
    }
  })).then(() => readyKits.add(id)).catch(error => {
    loading.delete(id);
    throw error;
  });
  loading.set(id, promise);
  return promise;
}

function playFallback(path, volume, rate = 1) {
  let pool = fallbackSounds.get(path);
  if (!pool) {
    pool = { voices: [], next: 0 };
    fallbackSounds.set(path, pool);
  }
  if (pool.voices.length < 4) pool.voices.push(new Audio(path));
  const audio = pool.voices[pool.next % pool.voices.length];
  pool.next++;
  audio.currentTime = 0;
  audio.volume = volume;
  audio.playbackRate = rate;
  audio.preservesPitch = false;
  const playback = audio.play();
  if (playback) playback.catch(() => {});
  return { audio };
}

function playBuffer(path, volume, rate = 1) {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffers.get(path);
  source.playbackRate.value = rate;
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audioContext.destination);
  const voice = { source, gain };
  // Keep fast overlapping cymbal strikes bounded on phones.
  if (activeSources.size >= 64) {
    const oldest = activeSources.values().next().value;
    activeSources.delete(oldest);
    oldest.source.stop();
  }
  activeSources.add(voice);
  source.onended = () => {
    activeSources.delete(voice);
    source.disconnect();
    gain.disconnect();
  };
  source.start();
  return voice;
}

export function hitDrum(key, live = true, velocity, kit = ACTIVE_KIT, length) {
  const button = buttons.get(key);
  if ((live && (!button || button.disabled)) || !readyKits.has(kit) || !getKit(kit).sounds[key]) return;
  if (velocity === undefined) velocity = kit === DEFAULT_KIT ? 127 : 96;
  velocity = Math.max(1, Math.min(127, Math.round(velocity)));
  if (live) window.dispatchEvent(new CustomEvent('drumhit', { detail: { key, velocity } }));
  clearTimeout(animationTimers.get(key));
  button?.classList.add('pressed');
  animationTimers.set(key, setTimeout(() => {
    if (!heldNotes.has(key)) button?.classList.remove('pressed');
    animationTimers.delete(key);
  }, kit === 'salamander-v1' && length !== undefined ? length : 100));
  const path = samplePath(kit, key, velocity);
  const volume = kit === DEFAULT_KIT ? 1 : velocity / 127;
  let voice;
  const rate = playbackRate(kit, key);
  if (audioContext && buffers.has(path)) {
    if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
    voice = playBuffer(path, volume, rate);
  } else voice = playFallback(path, volume, rate);
  if (kit === 'salamander-v1' && length !== undefined) {
    voice.releaseTimer = setTimeout(() => releaseVoice(voice), length);
  }
  return voice;
}

function releaseVoice(voice) {
  if (!voice || voice.released) return;
  voice.released = true;
  clearTimeout(voice.releaseTimer);
  if (voice.audio) {
    // Legacy HTML Audio fallback cannot expose a per-voice gain envelope.
    voice.audio.pause();
    return;
  }
  const now = audioContext.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.linearRampToValueAtTime(0, now + .18);
  voice.source.stop(now + .19);
}

function pressPiano(key, owner) {
  if (!window.drumAppReady || heldNotes.has(key)) return;
  const voice = hitDrum(key);
  if (voice) heldNotes.set(key, { voice, owner });
}
function releasePiano(key, owner) {
  const held = heldNotes.get(key);
  if (!held || (owner !== undefined && held.owner !== owner)) return;
  heldNotes.delete(key);
  releaseVoice(held.voice);
  buttons.get(key)?.classList.remove('pressed');
  window.dispatchEvent(new CustomEvent('pianorelease', { detail: { key } }));
}
export function releasePianoKeys() {
  for (const key of heldNotes.keys()) releasePiano(key);
}

function bindInstrumentButtons() {
  buttons.clear();
  keyboardShortcuts.clear();
  for (const button of document.querySelectorAll('.drum, .piano-key')) {
    const key = button.dataset.key || button.textContent.trim();
    buttons.set(key, button);
    if (button.dataset.shortcut) keyboardShortcuts.set(button.dataset.shortcut, key);
    button.disabled = true;
    if (boundButtons.has(button)) continue;
    boundButtons.add(button);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !window.drumAppReady) return;
      event.preventDefault();
      if (ACTIVE_KIT === 'salamander-v1') {
        button.setPointerCapture(event.pointerId);
        pressPiano(key, event.pointerId);
      } else hitDrum(key);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => releasePiano(key, event.pointerId));
    }
    button.addEventListener('click', event => {
      if (event.detail !== 0 || !window.drumAppReady) return;
      if (ACTIVE_KIT === 'salamander-v1') {
        pressPiano(key, 'accessibility');
        setTimeout(() => releasePiano(key, 'accessibility'), 250);
      } else hitDrum(key);
    });
  }
}

window.addEventListener('blur', releasePianoKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) releasePianoKeys(); });

let instrumentGeneration = 0;
export function suspendInstrument() {
  instrumentGeneration++;
  stopAudio();
  for (const button of buttons.values()) button.disabled = true;
}
export async function mountInstrument(id = ACTIVE_KIT) {
  suspendInstrument();
  setActiveKit(id);
  bindInstrumentButtons();
  const generation = instrumentGeneration;
  const message = document.getElementById('audio-status');
  message.hidden = false;
  message.textContent = 'Įkeliami garsai…';
  try {
    await loadKit(id);
    if (generation !== instrumentGeneration) return;
    for (const button of buttons.values()) button.disabled = false;
    message.hidden = true;
  } catch {
    if (generation !== instrumentGeneration) return;
    message.textContent = 'Garsų įkelti nepavyko. Patikrink internetą ir dar kartą pasirink instrumentą.';
  }
}
mountInstrument();

document.addEventListener('keydown', event => {
  if (!window.drumAppReady) return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const shortcut = event.key.toLowerCase();
  const key = ACTIVE_KIT === 'salamander-v1' ? keyboardShortcuts.get(shortcut) : shortcut;
  if (!buttons.has(key)) return;
  event.preventDefault();
  if (ACTIVE_KIT === 'salamander-v1') pressPiano(key, 'keyboard');
  else hitDrum(key);
});
document.addEventListener('keyup', event => {
  const key = keyboardShortcuts.get(event.key.toLowerCase());
  if (key) releasePiano(key, 'keyboard');
});

export async function prepareAudio(kit = ACTIVE_KIT) {
  if (audioContext && audioContext.state !== 'running') await audioContext.resume();
  await loadKit(kit);
}

export function soundDuration(key, kit = ACTIVE_KIT, velocity = 127, length) {
  if (kit === 'salamander-v1' && length !== undefined) return length + 200;
  const path = samplePath(kit, key, velocity);
  const seconds = buffers.get(path)?.duration || fallbackSounds.get(path)?.voices[0]?.duration;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000;
}

export function stopAudio() {
  releasePianoKeys();
  for (const voice of activeSources) { clearTimeout(voice.releaseTimer); voice.source.stop(); }
  activeSources.clear();
  for (const { voices } of fallbackSounds.values()) for (const audio of voices) {
    audio.pause();
    audio.currentTime = 0;
  }
  for (const [key, timer] of animationTimers) {
    clearTimeout(timer);
    buttons.get(key)?.classList.remove('pressed');
  }
  animationTimers.clear();
}
