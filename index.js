import { ACTIVE_KIT, DEFAULT_KIT, getKit, samplePath } from './kits.js';
export { ACTIVE_KIT, DEFAULT_KIT, getKit } from './kits.js';

const buttons = new Map();
const animationTimers = new Map();
const buffers = new Map();
const fallbackSounds = new Map();
const activeSources = new Set();
const loading = new Map();
const readyKits = new Set();
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext;
try {
  if (AudioContextClass) audioContext = new AudioContextClass({ latencyHint: 'interactive' });
} catch {}

export function loadKit(id = ACTIVE_KIT) {
  if (loading.has(id)) return loading.get(id);
  const promise = Promise.all(Object.values(getKit(id).sounds).flat().map(async path => {
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

function playFallback(path, volume) {
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
  const playback = audio.play();
  if (playback) playback.catch(() => {});
}

function playBuffer(path, volume) {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffers.get(path);
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
}

export function hitDrum(key, live = true, velocity, kit = ACTIVE_KIT) {
  const button = buttons.get(key);
  if (!button || !readyKits.has(kit)) return;
  if (velocity === undefined) velocity = kit === DEFAULT_KIT ? 127 : Number(document.getElementById('strike-strength')?.value || 96);
  velocity = Math.max(1, Math.min(127, Math.round(velocity)));
  if (live) window.dispatchEvent(new CustomEvent('drumhit', { detail: { key, velocity } }));
  clearTimeout(animationTimers.get(key));
  button.classList.add('pressed');
  animationTimers.set(key, setTimeout(() => {
    button.classList.remove('pressed');
    animationTimers.delete(key);
  }, 100));
  const path = samplePath(kit, key, velocity);
  const volume = kit === DEFAULT_KIT ? 1 : velocity / 127;
  if (audioContext && buffers.has(path)) {
    if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
    playBuffer(path, volume);
  } else playFallback(path, volume);
}

for (const button of document.querySelectorAll('.drum')) {
  const key = button.dataset.key || button.textContent.trim();
  buttons.set(key, button);
  button.disabled = true;
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !window.drumAppReady) return;
    event.preventDefault();
    hitDrum(key);
  });
  button.addEventListener('click', event => {
    if (event.detail === 0 && window.drumAppReady) hitDrum(key);
  });
}

loadKit().then(() => {
  for (const button of buttons.values()) button.disabled = false;
  document.getElementById('audio-status').hidden = true;
}).catch(() => {
  document.getElementById('audio-status').textContent = 'Garsų įkelti nepavyko. Patikrink internetą ir perkrauk puslapį.';
});

document.addEventListener('keydown', event => {
  if (!window.drumAppReady) return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (!buttons.has(key)) return;
  event.preventDefault();
  hitDrum(key);
});

export async function prepareAudio(kit = ACTIVE_KIT) {
  if (audioContext && audioContext.state !== 'running') await audioContext.resume();
  await loadKit(kit);
}

export function soundDuration(key, kit = ACTIVE_KIT, velocity = 127) {
  const path = samplePath(kit, key, velocity);
  const seconds = buffers.get(path)?.duration || fallbackSounds.get(path)?.voices[0]?.duration;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000;
}

export function stopAudio() {
  for (const { source } of activeSources) source.stop();
  activeSources.clear();
  for (const { voices } of fallbackSounds.values()) for (const audio of voices) {
    audio.pause();
    audio.currentTime = 0;
  }
  for (const [key, timer] of animationTimers) {
    clearTimeout(timer);
    buttons.get(key).classList.remove('pressed');
  }
  animationTimers.clear();
}
