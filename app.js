import * as db from './database.js';
import { prepareAudio, hitDrum, stopAudio } from './index.js';

const $ = id => document.getElementById(id);
const MAX_TIME = 120000;
const MAX_NOTES = 6000;
const members = new Map();
let me;
let offset = 0;
let recording = null;
let busy = false;
let playback = null;
let playbackGeneration = 0;
let usersLoading = false;
let pollTimer;
let mutationRevision = 0;

function status(message = '', error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function action(label, handler, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action ' + className;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function duration(ms) {
  return (ms / 1000).toFixed(1) + ' s';
}

function renderSlots(member) {
  if (!member.loaded) return;
  member.slots.replaceChildren();
  for (let slot = 1; slot <= 7; slot++) {
    const saved = member.performances.get(slot);
    const own = member.profile.id === me.id;
    const active = own && recording?.slot === slot;
    const card = document.createElement('article');
    card.className = 'slot' + (active ? ' is-recording' : '');
    card.dataset.slot = slot;
    const title = document.createElement('h3');
    title.textContent = 'Grojimas ' + slot;
    const info = document.createElement('p');
    info.textContent = active ? 'Naujas bandymas · ankstesnis įrašas lieka iki išsaugojimo' : saved
      ? duration(saved.duration_ms) : 'Laisva vieta';
    const controls = document.createElement('div');
    controls.className = 'actions';
    if (saved) {
      const play = action('Atkurti', () => playPerformance(member, slot));
      play.disabled = !!recording || busy;
      controls.append(play);
    }
    if (own) {
      const record = action(saved ? 'Perrašyti' : 'Įrašyti', () => startRecording(slot), 'primary');
      record.disabled = !!recording || busy;
      controls.append(record);
      if (saved) {
        const remove = action('Ištrinti', () => removePerformance(slot), 'danger');
        remove.disabled = !!recording || busy;
        controls.append(remove);
      }
    } else if (!saved) {
      info.textContent = 'Dar neįrašyta';
    }
    card.append(title, info, controls);
    member.slots.append(card);
  }
}

function refreshControls() {
  for (const member of members.values()) renderSlots(member);
  $('more-users').disabled = usersLoading || busy || !!recording;
  $('upload-avatar').disabled = busy || !!recording;
  $('remove-avatar').disabled = busy || !!recording;
}

async function loadMember(member, silent = false) {
  if (member.pending) return member.pending;
  if (member.profile.id === me.id && (recording || busy)) return;
  if (!member.loaded) member.slots.textContent = 'Įkeliami grojimai…';
  const revision = mutationRevision;
  member.pending = (async () => {
    try {
      const data = await db.listPerformances(member.profile.id);
      if (member.profile.id === me.id && (revision !== mutationRevision || recording || busy)) return;
      const changed = !member.loaded || JSON.stringify([...member.performances.values()]) !== JSON.stringify(data);
      if (changed) member.performances = new Map(data.map(item => [item.slot, item]));
      member.loaded = true;
      if (changed) renderSlots(member);
    } catch (error) {
      if (silent && member.loaded) return;
      member.slots.replaceChildren();
      const message = document.createElement('p');
      message.textContent = error.message;
      member.slots.append(message, action('Bandyti dar kartą', () => loadMember(member)));
      status(error.message, true);
    } finally {
      member.pending = null;
    }
  })();
  return member.pending;
}

function showAvatar(element, profile) {
  const avatar = profile.avatar_data;
  if (element.dataset.avatar === (avatar || profile.nickname)) return;
  element.dataset.avatar = avatar || profile.nickname;
  element.replaceChildren();
  const initial = document.createElement('span');
  initial.textContent = Array.from(profile.nickname)[0].toLocaleUpperCase('lt');
  element.append(initial);
  if (avatar && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = avatar;
    image.draggable = false;
    image.addEventListener('error', () => image.remove());
    element.append(image);
  }
}

function updateProfile(member, profile) {
  member.profile = profile;
  member.name.textContent = profile.nickname;
  showAvatar(member.avatar, profile);
  if (profile.id === me.id) {
    me = profile;
    $('welcome-name').textContent = 'Labas, ' + profile.nickname + '!';
    showAvatar($('my-avatar'), profile);
    $('remove-avatar').hidden = !profile.avatar_data;
  }
}

function addMember(profile) {
  if (members.has(profile.id)) {
    updateProfile(members.get(profile.id), profile);
    return;
  }
  const details = document.createElement('details');
  details.className = 'user-card';
  details.dataset.owner = profile.id;
  const summary = document.createElement('summary');
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'member-name';
  const arrow = document.createElement('span');
  arrow.className = 'member-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›';
  summary.append(avatar, name, arrow);
  const slots = document.createElement('div');
  slots.className = 'slots';
  details.append(summary, slots);
  const member = { profile, details, slots, avatar, name, loaded: false, performances: new Map() };
  members.set(profile.id, member);
  updateProfile(member, profile);
  $('users').append(details);
  details.addEventListener('toggle', () => {
    if (details.open) loadMember(member);
  });
  if (profile.id === me.id) details.open = true;
}

async function loadUsers(refresh = false, silent = false) {
  if (usersLoading || !me || document.hidden) return;
  usersLoading = true;
  $('more-users').disabled = true;
  const revision = mutationRevision;
  try {
    const pages = refresh ? Math.max(1, Math.ceil(offset / 50)) : 1;
    let nextOffset = refresh ? 0 : offset;
    let hasMore;
    for (let page = 0; page < pages; page++) {
      const profiles = await db.listProfiles(nextOffset);
      for (const profile of profiles) {
        if (profile.id !== me.id || (revision === mutationRevision && !busy)) addMember(profile);
      }
      nextOffset += profiles.length;
      hasMore = profiles.length === 50;
      if (!hasMore) break;
    }
    offset = nextOffset;
    $('more-users').hidden = !hasMore;
    // Refresh open groups in place: leave closed groups, focus and recording alone.
    if (refresh) {
      await Promise.all([...members.values()]
        .filter(member => member.details.open)
        .map(member => loadMember(member, silent)));
    }
    if (!silent) status('');
  } catch (error) {
    if (!silent) status(error.message, true);
  } finally {
    usersLoading = false;
    $('more-users').disabled = busy || !!recording;
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => loadUsers(true, true), 30000);
}

async function optimizeAvatar(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Pasirink JPG, PNG arba WebP nuotrauką iki 5 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error('Nepavyko perskaityti nuotraukos. Pasirink kitą JPG, PNG arba WebP failą.');
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 128, 128);
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, 0, 0, 128, 128);
    const data = canvas.toDataURL('image/jpeg', 0.8);
    if (data.length > 32768) throw new Error('Nuotrauka per didelė. Pasirink mažesnę.');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function changeAvatar(file) {
  if (busy || recording) return;
  busy = true;
  mutationRevision++;
  refreshControls();
  try {
    const avatar = file ? await optimizeAvatar(file) : null;
    const [profile] = await db.saveAvatar(avatar);
    updateProfile(members.get(me.id), profile);
    status(file ? 'Nuotrauka išsaugota.' : 'Nuotrauka pašalinta.');
  } catch (error) {
    status(error.message, true);
  } finally {
    $('avatar-file').value = '';
    busy = false;
    refreshControls();
  }
}

function clearRecordTimers() {
  if (!recording) return;
  clearTimeout(recording.limitTimer);
  clearInterval(recording.clockTimer);
}

function updateRecordBar() {
  $('recording-bar').hidden = !recording;
  if (!recording) return;
  const stage = recording.stage;
  $('recording-title').textContent = `Tavo ${recording.slot} vieta · ` + ({
    armed: 'Laukiama pirmo smūgio', recording: 'Įrašoma',
    saving: 'Išsaugoma…', failed: 'Nepavyko išsaugoti'
  })[stage];
  $('finish-recording').hidden = stage === 'failed';
  $('finish-recording').disabled = stage === 'saving';
  $('retry-recording').hidden = stage !== 'failed';
  $('cancel-recording').disabled = stage === 'saving';
  const elapsed = recording.started === null ? 0 : Math.min(MAX_TIME, performance.now() - recording.started);
  $('recording-clock').textContent = `${duration(elapsed)} / 120 s`;
}

function startRecording(slot) {
  if (recording || busy) return;
  const saved = members.get(me.id)?.performances.get(slot);
  if (saved && !confirm(`Perrašyti ${slot} vietą? Ankstesnis grojimas bus pakeistas tik išsaugojus naują.`)) return;
  mutationRevision++;
  stopPlayback();
  prepareAudio().catch(() => {});
  recording = { slot, stage: 'armed', started: null, events: [] };
  updateRecordBar();
  refreshControls();
  status('Grok būgnais. Dviejų minučių laikas prasidės nuo pirmo smūgio.');
  $('recording-bar').scrollIntoView({ block: 'start' });
}

window.addEventListener('drumhit', event => {
  stopPlayback();
  if (!recording || !['armed', 'recording'].includes(recording.stage)) return;
  const now = performance.now();
  if (recording.started === null) {
    recording.started = now;
    recording.stage = 'recording';
    recording.limitTimer = setTimeout(finishRecording, MAX_TIME);
    recording.clockTimer = setInterval(updateRecordBar, 250);
  }
  const time = Math.round(now - recording.started);
  if (time > MAX_TIME) {
    finishRecording();
    return;
  }
  recording.events.push({ key: event.detail.key, time });
  updateRecordBar();
  if (recording.events.length >= MAX_NOTES) finishRecording();
});

async function finishRecording() {
  if (!recording || recording.stage === 'saving') return;
  clearRecordTimers();
  if (!recording.events.length) {
    cancelRecording();
    status('Tuščias bandymas neišsaugotas. Ankstesnis grojimas nepakeistas.');
    return;
  }
  const draft = recording;
  draft.stage = 'saving';
  updateRecordBar();
  try {
    const [saved] = await db.savePerformance(draft.slot, draft.events);
    // A pagehide can discard local state while the explicitly requested save finishes.
    if (recording !== draft) return;
    members.get(me.id).performances.set(draft.slot, saved);
    recording = null;
    updateRecordBar();
    refreshControls();
    status(`Grojimas išsaugotas ${draft.slot} vietoje. Jį gali perklausyti visi prisijungę vartotojai.`);
  } catch (error) {
    if (recording !== draft) return;
    draft.stage = 'failed';
    updateRecordBar();
    status(error.message + ' Bandymas tebėra šiame lange — gali išsaugoti dar kartą arba atmesti.', true);
  }
}

function cancelRecording() {
  if (recording?.stage === 'saving') return;
  clearRecordTimers();
  recording = null;
  stopAudio();
  updateRecordBar();
  refreshControls();
  status('Bandymas atmestas. Ankstesni įrašai nepakeisti.');
}

async function removePerformance(slot) {
  if (recording || busy || !confirm(`Ištrinti savo grojimą ${slot} vietoje?`)) return;
  busy = true;
  mutationRevision++;
  stopPlayback();
  refreshControls();
  try {
    await db.deletePerformance(slot);
    members.get(me.id).performances.delete(slot);
    status(`Grojimas ištrintas. ${slot} vieta vėl laisva.`);
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    refreshControls();
  }
}

function stopPlayback() {
  playbackGeneration++;
  if (playback) {
    clearInterval(playback.timer);
    clearTimeout(playback.endTimer);
    playback = null;
    stopAudio();
  }
  $('playback-bar').hidden = true;
}

async function playPerformance(member, slot) {
  if (recording || busy) return;
  stopPlayback();
  const generation = playbackGeneration;
  const saved = member.performances.get(slot);
  try {
    await prepareAudio();
    if (generation !== playbackGeneration || recording) return;
    let index = 0;
    const started = performance.now();
    playback = {};
    $('playback-title').textContent = `${member.profile.nickname} · Grojimas ${slot}`;
    $('playback-bar').hidden = false;
    const tick = () => {
      const elapsed = performance.now() - started;
      while (index < saved.events.length && saved.events[index].time <= elapsed) {
        hitDrum(saved.events[index++].key, false);
      }
      if (index === saved.events.length) {
        clearInterval(playback.timer);
        // Leave the last drum's tail audible rather than cutting it at the final hit.
        playback.endTimer = setTimeout(stopPlayback, 5000);
      }
    };
    playback.timer = setInterval(tick, 8);
    tick();
  } catch {
    status('Nepavyko paleisti garso. Paliesk būgną ir bandyk atkurti dar kartą.', true);
  }
}

async function enter(profile) {
  me = profile;
  $('login').hidden = true;
  $('workspace').hidden = false;
  $('welcome-name').textContent = 'Labas, ' + profile.nickname + '!';
  window.drumAppReady = true;
  addMember(profile);
  await loadUsers(true);
  startPolling();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const nickname = $('nickname').value.trim();
  if (!nickname || nickname.length > 24) {
    status('Įvesk slapyvardį nuo 1 iki 24 simbolių.', true);
    return;
  }
  $('login-button').disabled = true;
  status('Jungiamasi…');
  try {
    await enter(await db.signIn(nickname));
  } catch (error) {
    status(error.message, true);
  } finally {
    $('login-button').disabled = false;
  }
});
$('finish-recording').addEventListener('click', finishRecording);
$('retry-recording').addEventListener('click', finishRecording);
$('cancel-recording').addEventListener('click', cancelRecording);
$('stop-playback').addEventListener('click', stopPlayback);
$('more-users').addEventListener('click', () => loadUsers());
$('upload-avatar').addEventListener('click', () => $('avatar-file').click());
$('avatar-file').addEventListener('change', () => {
  const file = $('avatar-file').files[0];
  if (file) changeAvatar(file);
});
$('remove-avatar').addEventListener('click', () => changeAvatar(null));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && me && window.drumAppReady) loadUsers(true, true);
});
window.addEventListener('pageshow', event => {
  if (event.persisted && me) {
    startPolling();
    loadUsers(true, true);
  }
});
window.addEventListener('pagehide', () => {
  clearInterval(pollTimer);
  clearRecordTimers();
  recording = null;
  stopPlayback();
  stopAudio();
  updateRecordBar();
  refreshControls();
});
window.addEventListener('storage', event => {
  if (event.key?.startsWith('bugnai.auth.') && !event.newValue) {
    clearInterval(pollTimer);
    window.drumAppReady = false;
    cancelRecording();
    stopPlayback();
    $('workspace').hidden = true;
    $('login').hidden = false;
    status('Prisijungimas šiame įrenginyje pasikeitė. Perkrauk puslapį.', true);
  }
});

(async () => {
  try {
    if (db.currentUser()) await enter(await db.ensureProfile());
    else status('');
  } catch (error) {
    status(error.message, true);
  }
})();
