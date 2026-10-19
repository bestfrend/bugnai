import { ACTIVE_KIT, DEFAULT_KIT, PIANO_OCTAVES, getKit, pianoKeys, samplePath, playbackRate, setActiveKit } from './kits.js';
import { t } from './i18n.js';
export { ACTIVE_KIT, DEFAULT_KIT, getKit } from './kits.js';

const buttons = new Map();
const boundButtons = new WeakSet();
const animationTimers = new Map();
const buffers = new Map();
const fallbackSounds = new Map();
const activeSources = new Set();
const heldNotes = new Map();
const pianoPointers = new Map();
const pianoTouches = new Map();
const drumPointers = new Map();
const keyboardShortcuts = new Map();
const loading = new Map();
const readyKits = new Set();
let currentPianoOctave = 4;
const FULL_PIANO_VIEW = PIANO_OCTAVES.at(-1) + 1;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext;
try {
  if (AudioContextClass) audioContext = new AudioContextClass({ latencyHint: 'interactive' });
} catch {}

function setInstrumentDisabled(element, disabled) {
  element.disabled = disabled;
  if (element.classList.contains('piano-key')) {
    element.setAttribute('aria-disabled', String(disabled));
    element.tabIndex = disabled ? -1 : 0;
  }
}

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
  // Reuse an idle player, never a sample still held by another finger.
  let audio = pool.voices.find(player => player.paused || player.ended);
  if (!audio && pool.voices.length >= 64) {
    audio = pool.voices.find(player => ![...heldNotes.values()].some(held => held.voice === player.currentVoice));
  }
  if (!audio) {
    audio = new Audio(path);
    pool.voices.push(audio);
  }
  const previous = audio.currentVoice;
  if (previous) {
    previous.cleanup();
    if (!previous.released) previous.onFinished?.();
    previous.released = true;
  }
  const voice = { audio };
  audio.currentVoice = voice;
  const onEnded = () => {
    if (audio.currentVoice !== voice) return;
    audio.currentVoice = null;
    if (!voice.released) voice.onFinished?.();
  };
  voice.cleanup = () => audio.removeEventListener('ended', onEnded);
  audio.addEventListener('ended', onEnded, { once: true });
  audio.currentTime = 0;
  audio.volume = volume;
  audio.playbackRate = rate;
  audio.preservesPitch = false;
  const playback = audio.play();
  if (playback) playback.catch(() => {});
  return voice;
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
    if (!voice.released) voice.onFinished?.();
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
    voice.cleanup();
    if (voice.audio.currentVoice === voice) {
      voice.audio.currentVoice = null;
      voice.audio.pause();
    }
    return;
  }
  const now = audioContext.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.linearRampToValueAtTime(0, now + .18);
  voice.source.stop(now + .19);
}

function pressPiano(key, owner) {
  if (!window.drumAppReady) return false;
  const held = heldNotes.get(key);
  if (held) {
    held.owners.add(owner);
    return true;
  }
  const voice = hitDrum(key);
  if (!voice) return false;
  voice.onFinished = () => finishPianoHold(key, voice);
  heldNotes.set(key, { voice, owners: new Set([owner]) });
  return true;
}
function finishPianoHold(key, voice, stopVoice = false) {
  if (heldNotes.get(key)?.voice !== voice) return;
  heldNotes.delete(key);
  if (stopVoice) releaseVoice(voice);
  buttons.get(key)?.classList.remove('pressed');
  window.dispatchEvent(new CustomEvent('pianorelease', { detail: { key } }));
}
function releasePiano(key, owner) {
  const held = heldNotes.get(key);
  if (!held || (owner !== undefined && !held.owners.has(owner))) return;
  if (owner !== undefined) {
    held.owners.delete(owner);
    if (held.owners.size) return;
  }
  finishPianoHold(key, held.voice, true);
}
export function releasePianoKeys() {
  for (const key of heldNotes.keys()) releasePiano(key);
  pianoPointers.clear();
  pianoTouches.clear();
}

function releasePianoPointer(pointerId) {
  if (!pianoPointers.has(pointerId)) return;
  const key = pianoPointers.get(pointerId);
  pianoPointers.delete(pointerId);
  if (key) releasePiano(key, pointerId);
}

function bindInstrumentButtons() {
  buttons.clear();
  keyboardShortcuts.clear();
  for (const button of document.querySelectorAll('.drum, .piano-key')) {
    const key = button.dataset.key || button.textContent.trim();
    buttons.set(key, button);
    if (button.dataset.shortcut) keyboardShortcuts.set(button.dataset.shortcut, key);
    setInstrumentDisabled(button, !readyKits.has(ACTIVE_KIT));
    if (boundButtons.has(button)) continue;
    boundButtons.add(button);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !window.drumAppReady) return;
      if (ACTIVE_KIT === 'salamander-v1') {
        if (event.pointerType === 'touch') {
          event.preventDefault();
          return; // Touch identifiers own touchscreen notes, not pointer capture.
        }
        button.setPointerCapture(event.pointerId);
        pianoPointers.set(event.pointerId, key);
        pressPiano(key, event.pointerId);
      } else {
        button.setPointerCapture(event.pointerId);
        hitDrum(key);
        drumPointers.set(event.pointerId, key);
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => {
        releasePianoPointer(event.pointerId);
        drumPointers.delete(event.pointerId);
      });
    }
    button.addEventListener('click', event => {
      if (event.detail !== 0 || !window.drumAppReady) return;
      if (ACTIVE_KIT === 'salamander-v1') {
        pressPiano(key, 'accessibility');
        setTimeout(() => releasePiano(key, 'accessibility'), 250);
      } else hitDrum(key);
    });
    if (button.classList.contains('piano-key')) button.addEventListener('keydown', event => {
      if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat || button.disabled) return;
      event.preventDefault();
      button.click();
    });
  }
}

document.addEventListener('pointermove', event => {
  if (ACTIVE_KIT !== 'salamander-v1' && drumPointers.has(event.pointerId)) {
    const pad = document.elementFromPoint(event.clientX, event.clientY)?.closest('.drum');
    const nextKey = pad && !pad.disabled ? pad.dataset.key : null;
    if (nextKey !== drumPointers.get(event.pointerId)) {
      drumPointers.set(event.pointerId, nextKey);
      if (nextKey) hitDrum(nextKey);
    }
    return;
  }
  if (ACTIVE_KIT !== 'salamander-v1' || !pianoPointers.has(event.pointerId)) return;
  const previousKey = pianoPointers.get(event.pointerId);
  const nextKey = document.elementFromPoint(event.clientX, event.clientY)?.closest('.piano-key')?.dataset.key;
  if (nextKey === previousKey) return;
  if (nextKey) event.preventDefault();
  if (previousKey) releasePiano(previousKey, event.pointerId);
  pianoPointers.set(event.pointerId, nextKey || null);
  if (nextKey) pressPiano(nextKey, event.pointerId);
}, { passive: false });

// Keep cleanup reliable even if capture ends outside the original pad.
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, event => drumPointers.delete(event.pointerId));
}
for (const type of ['contextmenu', 'dragstart']) {
  document.addEventListener(type, event => {
    if (window.drumAppReady && event.target.closest('.kit .set')) event.preventDefault();
  });
}
// Cancel native touch handling before a browser can claim a musical gesture.
// Pointer events still drive notes; lesson controls keep their normal clicks.
for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
  document.addEventListener(type, event => {
    if (!window.drumAppReady) return;
    if (ACTIVE_KIT === 'salamander-v1') {
      for (const touch of event.changedTouches) {
        const id = touch.identifier;
        const owner = `touch:${id}`;
        if (type !== 'touchstart' && !pianoTouches.has(id)) continue;
        if (type === 'touchend' || type === 'touchcancel') {
          const previous = pianoTouches.get(id);
          pianoTouches.delete(id);
          if (previous) releasePiano(previous, owner);
          continue;
        }
        const target = type === 'touchstart' ? touch.target : document.elementFromPoint(touch.clientX, touch.clientY);
        const key = target?.closest('.piano-key')?.dataset.key || null;
        if (type === 'touchstart' && !key) continue;
        const previous = pianoTouches.get(id);
        if (previous === key) continue;
        if (previous) releasePiano(previous, owner);
        pianoTouches.set(id, key);
        if (key) pressPiano(key, owner);
      }
    }
    if (event.target.closest('.kit .set') && !event.target.closest('.action') && event.cancelable) event.preventDefault();
  }, { passive: false });
}
function clearInstrumentPointers() {
  releasePianoKeys();
  drumPointers.clear();
}

const pianoNames = { c: 'Do', cs: 'Do♯', d: 'Re', ds: 'Re♯', e: 'Mi', f: 'Fa', fs: 'Fa♯', g: 'Sol', gs: 'Sol♯', a: 'La', as: 'La♯', b: 'Si' };
const pianoShortcuts = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'];
function pianoKeyboardMarkup(octave) {
  const full = octave === FULL_PIANO_VIEW;
  const keys = full ? [...PIANO_OCTAVES.flatMap(value => pianoKeys(value).slice(0, -1)), 'c7'] : pianoKeys(octave);
  return keys.map((key, index) => {
    const note = key.replace(/\d/, '');
    const shortcut = full ? pianoShortcuts[index - 24] : pianoShortcuts[index];
    const position = (full ? (Number(key.at(-1)) - PIANO_OCTAVES[0]) * 7 : 0) + (({ cs: 1, ds: 2, fs: 4, gs: 5, as: 6 })[note] ?? 0);
    const label = full ? (note === 'c' ? key.toUpperCase() : '') : t(pianoNames[note]);
    return `<div role="button" tabindex="0" class="piano-key ${note.endsWith('s') ? 'black-key' : 'white-key'}" data-key="${key}"${shortcut ? ` data-shortcut="${shortcut}"` : ''} style="--position:${position}" aria-label="${t(pianoNames[note])}, ${key.toUpperCase()}${shortcut ? `, ${t('klavišas')} ${shortcut.toUpperCase()}` : ''}"><span>${label}</span>${!full && shortcut ? `<small>${shortcut.toUpperCase()}</small>` : ''}</div>`;
  }).join('');
}
function updatePianoOctave(octave) {
  currentPianoOctave = Math.max(PIANO_OCTAVES[0], Math.min(FULL_PIANO_VIEW, octave));
  const keyboard = document.querySelector('.piano-keyboard');
  if (!keyboard) return;
  // A keyboard key can still be held while the octave button is clicked.
  // Finish that exact note before replacing the visible keys.
  releasePianoKeys();
  const full = currentPianoOctave === FULL_PIANO_VIEW;
  keyboard.classList.toggle('full-range', full);
  keyboard.innerHTML = pianoKeyboardMarkup(currentPianoOctave);
  keyboard.setAttribute('aria-label', full ? `${t('Pilnas pianinas')} C2–C7` : `${t('Pianino klavišai')} C${currentPianoOctave}–C${currentPianoOctave + 1}`);
  const octaveLabel = document.getElementById('piano-octave-label');
  octaveLabel.dataset.source = full ? 'Pilnas' : currentPianoOctave === 4 ? 'Vidurinė dalis' : currentPianoOctave < 4 ? 'Žemesni garsai' : 'Aukštesni garsai';
  octaveLabel.dataset.range = full ? 'C2–C7' : `C${currentPianoOctave}–C${currentPianoOctave + 1}`;
  octaveLabel.textContent = `${t(octaveLabel.dataset.source)} · ${octaveLabel.dataset.range}`;
  document.querySelector('[data-octave-shift="-1"]').disabled = currentPianoOctave === PIANO_OCTAVES[0];
  const higher = document.querySelector('[data-octave-shift="1"]');
  const higherLabel = higher.querySelector('.piano-button-label');
  higherLabel.dataset.source = currentPianoOctave >= PIANO_OCTAVES.at(-1) ? 'Pilnas' : 'Aukščiau';
  higherLabel.textContent = t(higherLabel.dataset.source);
  higher.setAttribute('aria-label', t(currentPianoOctave >= PIANO_OCTAVES.at(-1) ? 'Pilnas pianinas' : 'Aukštesni garsai'));
  higher.disabled = full;
  bindInstrumentButtons();
}

window.addEventListener('blur', clearInstrumentPointers);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInstrumentPointers(); });
window.addEventListener('languagechange', () => { if (ACTIVE_KIT === 'salamander-v1') updatePianoOctave(currentPianoOctave); });

let instrumentGeneration = 0;
export function suspendInstrument() {
  instrumentGeneration++;
  stopAudio();
  for (const button of buttons.values()) setInstrumentDisabled(button, true);
}
export async function mountInstrument(id = ACTIVE_KIT) {
  suspendInstrument();
  setActiveKit(id);
  if (id === 'salamander-v1') updatePianoOctave(currentPianoOctave);
  bindInstrumentButtons();
  const generation = instrumentGeneration;
  const message = document.getElementById('audio-status');
  message.hidden = false;
  message.dataset.source = 'Įkeliami garsai…';
  message.textContent = t('Įkeliami garsai…');
  try {
    await loadKit(id);
    if (generation !== instrumentGeneration) return;
    for (const button of buttons.values()) setInstrumentDisabled(button, false);
    message.hidden = true;
  } catch {
    if (generation !== instrumentGeneration) return;
    message.dataset.source = 'Garsų įkelti nepavyko. Patikrink internetą ir dar kartą pasirink instrumentą.';
    message.textContent = t(message.dataset.source);
  }
}
mountInstrument();

document.addEventListener('click', event => {
  const control = event.target.closest('[data-octave-shift]');
  if (!control || ACTIVE_KIT !== 'salamander-v1') return;
  updatePianoOctave(currentPianoOctave + Number(control.dataset.octaveShift));
});

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
  clearInstrumentPointers();
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
