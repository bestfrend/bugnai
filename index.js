const soundFiles = {
  w: 'tom-1', a: 'tom-2', s: 'tom-3', d: 'tom-4',
  j: 'snare', k: 'crash', l: 'kick-bass'
};
const buttons = new Map();
const animationTimers = new Map();
const buffers = new Map();
const fallbackSounds = new Map();
const activeSources = new Set();
const loadingSounds = [];
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext;
try {
  if (AudioContextClass) audioContext = new AudioContextClass({ latencyHint: 'interactive' });
} catch (error) {
  // Older browsers can still use the preloaded audio elements below.
}

for (const [key, file] of Object.entries(soundFiles)) {
  const path = 'sounds/' + file + '.mp3';
  const voices = Array.from({ length: 4 }, () => {
    const audio = new Audio(path);
    audio.preload = 'auto';
    audio.load();
    return audio;
  });
  fallbackSounds.set(key, { voices, next: 0 });
  if (audioContext) {
    loadingSounds.push(fetch(path)
      .then(response => {
        if (!response.ok) throw new Error('Sound unavailable: ' + path);
        return response.arrayBuffer();
      })
      .then(data => audioContext.decodeAudioData(data))
      .then(buffer => buffers.set(key, buffer))
      .catch(() => {})); // Keep the preloaded audio fallback if decoding fails.
  }
}

function playFallback(key) {
  const pool = fallbackSounds.get(key);
  const audio = pool.voices[pool.next];
  pool.next = (pool.next + 1) % pool.voices.length;
  audio.currentTime = 0;
  const playback = audio.play();
  if (playback) playback.catch(() => {});
}

function playBuffer(key) {
  const source = audioContext.createBufferSource();
  source.buffer = buffers.get(key);
  source.connect(audioContext.destination);
  activeSources.add(source);
  source.onended = () => {
    activeSources.delete(source);
    source.disconnect();
  };
  source.start();
}

export function hitDrum(key, live = true) {
  const button = buttons.get(key);
  if (!button) return;
  if (live) window.dispatchEvent(new CustomEvent('drumhit', { detail: { key } }));

  clearTimeout(animationTimers.get(key));
  button.classList.add('pressed');
  animationTimers.set(key, setTimeout(() => {
    button.classList.remove('pressed');
    animationTimers.delete(key);
  }, 100));

  // Resume within the user gesture: mobile browsers initially suspend audio.
  if (audioContext && audioContext.state !== 'running') {
    audioContext.resume().catch(() => {});
    // Use the already loaded element for this hit instead of queuing a late hit.
    playFallback(key);
  } else if (audioContext && buffers.has(key)) {
    playBuffer(key);
  } else {
    playFallback(key);
  }
}

for (const button of document.querySelectorAll('.drum')) {
  const key = button.textContent.trim();
  buttons.set(key, button);
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !window.drumAppReady) return;
    event.preventDefault();
    hitDrum(key);
  });
  // Native keyboard/assistive activation has no preceding pointerdown.
  button.addEventListener('click', event => {
    if (event.detail === 0 && window.drumAppReady) hitDrum(key);
  });
}

document.addEventListener('keydown', event => {
  if (!window.drumAppReady) return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (!buttons.has(key)) return;
  event.preventDefault();
  hitDrum(key);
});

export async function prepareAudio() {
  if (audioContext && audioContext.state !== 'running') await audioContext.resume();
  await Promise.all(loadingSounds);
}

export function soundDuration(key) {
  const seconds = buffers.get(key)?.duration || fallbackSounds.get(key)?.voices[0].duration;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000;
}

export function stopAudio() {
  for (const source of activeSources) source.stop();
  activeSources.clear();
  for (const { voices } of fallbackSounds.values()) {
    for (const audio of voices) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  for (const [key, timer] of animationTimers) {
    clearTimeout(timer);
    buttons.get(key).classList.remove('pressed');
  }
  animationTimers.clear();
}
