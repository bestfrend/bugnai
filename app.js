import './navigation.js';
import './play-help.js';
import * as db from './database.js';
import { prepareAudio, hitDrum, stopAudio, soundDuration, ACTIVE_KIT, DEFAULT_KIT, getKit, releasePianoKeys } from './index.js';
import { t, setLanguage, applyPageTranslations, language } from './i18n.js';
import { lessonsForKit, lessonSpeeds } from './lessons.js';

const $ = id => document.getElementById(id);
const MAX_NOTES = 6000;
const MAX_RHYTHMS = 50;
const MIN_AUTOMATIC_RECORDING_MS = 15000;
const EMERGENCY_DRAFT_KEY = 'bugnai.emergency-draft';
const members = new Map();
let me;
let offset = 0;
let recording = null;
let busy = false;
let playback = null;
let playbackGeneration = 0;
let usersLoading = false;
let pollTimer;
let presenceTimer;
let locationRequestTimer;
let activeLocationRequest;
let dismissedLocationRequestId;
let locationRequestChecking = false;
let lastLocationRequestCheck = 0;
const locationAcquisitions = new Map();
let mutationRevision = 0;
let renamingSlot = null;
let renamingBusy = false;
let avatarRemovalVisible = false;
let activeStatus = { message: '', error: false };
let lesson = null;
let pausedLesson = null;

const iconPaths = {
  play: ['M8 5v14l11-7z'],
  listen: ['M11 5L6 9H3v6h3l5 4z', 'M15 8a6 6 0 0 1 0 8', 'M18 5a10 10 0 0 1 0 14'],
  stop: ['M6 6h12v12H6z'],
  repeat: ['M3 11a9 9 0 1 1 2.9 6.9', 'M3 4v7h7'],
  check: ['M5 12l4 4L19 6'],
  trash: ['M3 6h18', 'M9 6V4h6v2', 'M5 6l1 14h12l1-14', 'M10 10v6', 'M14 10v6'],
  plus: ['M12 5v14', 'M5 12h14'],
  edit: ['M16 3l5 5L8 21H3v-5z', 'M14 5l5 5'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2z', 'M7 3v6h10V3', 'M7 21v-8h10v8'],
  close: ['M6 6l12 12', 'M6 18L18 6'],
  arrow: ['M4 12h16', 'M14 6l6 6-6 6'],
  more: ['M6 9l6 6 6-6']
};
const actionIcons = {
  'Atkurti': 'play', 'Perklausyti bandymą': 'play', 'Perrašyti': 'edit',
  'Sukurti ritmą': 'plus', 'Ištrinti': 'trash', 'Atnaujinti ritmą': 'check',
  'Pakartoti bandymą': 'repeat', 'Bandyti dar kartą': 'repeat',
  'Išsaugoti dar kartą': 'save', 'Stabdyti atkūrimą': 'stop',
  'Išsaugoti pavadinimą': 'check', 'Atšaukti': 'close',
  'Pradėti groti': 'arrow', 'Rodyti daugiau vartotojų': 'more'
};

function decorateAction(button, icon = button.dataset.icon || actionIcons[button.textContent.trim()]) {
  if (!icon || !iconPaths[icon]) return;
  button.dataset.i18nSource = button.textContent.trim();
  const label = document.createElement('span');
  label.className = 'button-label';
  label.textContent = t(button.textContent.trim());
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('button-icon');
  for (const data of iconPaths[icon]) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  button.replaceChildren(svg, label);
}

function status(message = '', error = false) {
  activeStatus = { message, error };
  $('status').dataset.source = typeof message === 'string' ? message : '';
  $('status').textContent = typeof message === 'function' ? message() : t(message);
  $('status').classList.toggle('error', error);
}

function action(label, handler, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action ' + className;
  button.textContent = label;
  decorateAction(button);
  button.addEventListener('click', handler);
  return button;
}

function clearLessonCues() {
  for (const button of document.querySelectorAll('.lesson-cue, .lesson-correct, .lesson-wrong')) {
    button.classList.remove('lesson-cue', 'lesson-correct', 'lesson-wrong');
  }
}

function removeLessonStarter() {
  $('lesson-start')?.remove();
}

function stopLesson() {
  stopLessonPreview();
  removeLessonStarter();
  document.querySelector('.kit')?.classList.remove('lesson-active');
  if (!lesson) return;
  cancelAnimationFrame(lesson.frame);
  for (const timer of lesson.feedbackTimers.values()) clearTimeout(timer);
  clearLessonCues();
  lesson = null;
  renderLessons();
}

function showLessonStarter() {
  const set = document.querySelector('.kit .set');
  if (!set || !lesson) return;
  const overlay = document.createElement('div');
  overlay.id = 'lesson-start';
  overlay.className = 'lesson-start-overlay';
  const button = action('Pradėti pamoką', beginLesson, 'primary');
  decorateAction(button, 'play');
  const listen = action('Klausyti', toggleLessonPreview, 'lesson-listen');
  listen.id = 'listen-lesson';
  const controls = document.createElement('div');
  controls.className = 'lesson-start-actions';
  controls.append(button, listen);
  overlay.append(controls);
  set.append(overlay);
  updateLessonListenButton();
}

function updateLessonListenButton() {
  const button = $('listen-lesson');
  if (!button) return;
  const active = !!lesson?.preview;
  const label = active ? 'Stabdyti perklausą' : 'Klausyti';
  button.textContent = label;
  decorateAction(button, active ? 'stop' : 'listen');
  button.querySelector('.button-label').textContent = t(label);
  button.classList.toggle('is-listening', active);
  button.setAttribute('aria-pressed', String(active));
}

function stopLessonPreview(current = lesson) {
  if (!current?.preview) return;
  clearInterval(current.preview.timer);
  clearTimeout(current.preview.endTimer);
  current.preview = null;
  stopAudio();
  if (lesson === current) updateLessonListenButton();
}

async function toggleLessonPreview() {
  const current = lesson;
  if (!current || current.started !== null) return;
  if (current.preview) {
    stopLessonPreview(current);
    return;
  }
  stopPlayback();
  stopAudio();
  const preview = {};
  current.preview = preview;
  updateLessonListenButton();
  const kit = ACTIVE_KIT;
  try {
    await prepareAudio(kit);
    if (lesson !== current || current.preview !== preview || current.started !== null) return;
    const velocity = kit === DEFAULT_KIT ? 127 : 96;
    const notes = current.events.map(note => {
      const next = current.events.find(candidate => candidate.beat > note.beat);
      const interval = (next ? next.beat - note.beat : 1) * current.speed.beatMs;
      return { key: note.key, time: note.beat * current.speed.beatMs,
        length: kit === 'salamander-v1' ? Math.max(60, Math.round(interval * .85)) : undefined };
    });
    const started = performance.now();
    const endsAt = Math.max(...notes.map(note => note.time + soundDuration(note.key, kit, velocity, note.length)));
    let index = 0;
    const tick = () => {
      if (lesson !== current || current.preview !== preview) return;
      const elapsed = performance.now() - started;
      while (index < notes.length && notes[index].time <= elapsed) {
        const note = notes[index++];
        hitDrum(note.key, false, velocity, kit, note.length);
      }
      if (index === notes.length) {
        clearInterval(preview.timer);
        preview.endTimer = setTimeout(() => {
          if (current.preview === preview) stopLessonPreview(current);
        }, Math.max(0, endsAt - elapsed));
      }
    };
    preview.timer = setInterval(tick, 8);
    tick();
  } catch {
    if (lesson !== current || current.preview !== preview) return;
    stopLessonPreview(current);
    status('Nepavyko paleisti garso. Paliesk būgną ir bandyk atkurti dar kartą.', true);
  }
}

async function prepareLesson(definition, speed) {
  if (busy || lesson || recording?.stage === 'saving') return;
  if (recording) discardRecordingForLesson();
  pausedLesson = null;
  lesson = createLesson(definition, speed);
  document.querySelector('.kit')?.classList.add('lesson-active');
  renderLessons();
  document.querySelector('.kit')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  try {
    await prepareAudio(ACTIVE_KIT);
  } catch {
    lesson = null;
    document.querySelector('.kit')?.classList.remove('lesson-active');
    renderLessons();
    status('Nepavyko paleisti garso. Paliesk būgną ir bandyk atkurti dar kartą.', true);
    return;
  }
  if (!lesson || lesson.definition !== definition) return;
  showLessonStarter();
}

function beginLesson() {
  if (!lesson || lesson.started !== null) return;
  stopLessonPreview();
  removeLessonStarter();
  const current = lesson;
  current.started = performance.now();
  const tick = () => {
    if (lesson !== current) return;
    const elapsed = performance.now() - current.started;
    const cycleMs = lessonCycleMs(current);
    while (true) {
      const cycle = Math.floor(current.next / current.events.length);
      const index = current.next % current.events.length;
      const note = current.events[index];
      const target = cycle * cycleMs + note.beat * current.speed.beatMs;
      if (target > elapsed) break;
      current.next++;
      if (!current.judged.get(cycle)?.has(index)) current.pending.push({ key: note.key, target,
        expires: target + lessonResponseWindow(current, index) });
    }
    current.pending = current.pending.filter(note => elapsed < note.expires);
    for (const button of document.querySelectorAll('.lesson-cue')) button.classList.remove('lesson-cue');
    for (const note of current.pending) lessonButton(note.key)?.classList.add('lesson-cue');
    const cycle = Math.floor(elapsed / cycleMs);
    for (const previous of current.judged.keys()) if (previous < cycle - 1) current.judged.delete(previous);
    current.frame = requestAnimationFrame(tick);
  };
  tick();
}

function createLesson(definition, speed) {
  return { definition, speed, events: [...definition.events].sort((a, b) => a.beat - b.beat), next: 0, started: null, frame: 0, preview: null, pending: [], judged: new Map(), feedbackTimers: new Map() };
}

function lessonCycleMs(current) {
  return (current.events.at(-1).beat + 1) * current.speed.beatMs;
}

function lessonResponseWindow(current, index) {
  const beat = current.events[index].beat;
  const next = current.events.find(note => note.beat > beat);
  return next ? Math.min(1000, (next.beat - beat) * current.speed.beatMs) : 1000;
}

function lessonButton(key) {
  return [...document.querySelectorAll('.kit .set [data-key]')].find(button => button.dataset.key === key);
}

function flashLessonResult(current, key, correct) {
  const button = lessonButton(key);
  if (!button) return;
  clearTimeout(current.feedbackTimers.get(key));
  button.classList.remove('lesson-correct', 'lesson-wrong');
  button.classList.add(correct ? 'lesson-correct' : 'lesson-wrong');
  if (ACTIVE_KIT === 'salamander-v1') return;
  current.feedbackTimers.set(key, setTimeout(() => {
    button.classList.remove('lesson-correct', 'lesson-wrong');
    current.feedbackTimers.delete(key);
  }, 420));
}

function scoreLessonHit(key) {
  const current = lesson;
  if (!current || current.started === null) return;
  const elapsed = performance.now() - current.started;
  const cycleMs = lessonCycleMs(current);
  const cycle = Math.floor(elapsed / cycleMs);
  let closest;
  for (const candidateCycle of [cycle - 1, cycle]) {
    if (candidateCycle < 0) continue;
    current.events.forEach((note, index) => {
      if (note.key !== key || current.judged.get(candidateCycle)?.has(index)) return;
      const delay = elapsed - (candidateCycle * cycleMs + note.beat * current.speed.beatMs);
      const lateWindow = lessonResponseWindow(current, index);
      if (delay < 0 || delay >= lateWindow) return;
      if (!closest || delay < closest.distance) closest = { cycle: candidateCycle, index, distance: delay };
    });
  }
  if (closest) {
    if (!current.judged.has(closest.cycle)) current.judged.set(closest.cycle, new Set());
    current.judged.get(closest.cycle).add(closest.index);
    const target = closest.cycle * cycleMs + current.events[closest.index].beat * current.speed.beatMs;
    current.pending = current.pending.filter(note => note.key !== key || note.target !== target);
    if (!current.pending.some(note => note.key === key)) lessonButton(key)?.classList.remove('lesson-cue');
  }
  flashLessonResult(current, key, !!closest);
}

function pauseLessonForReview() {
  if (!lesson) return;
  pausedLesson = { definition: lesson.definition, speed: lesson.speed };
  stopLesson();
}

function restorePausedLesson() {
  const saved = pausedLesson;
  pausedLesson = null;
  if (!saved || lesson) return;
  lesson = createLesson(saved.definition, saved.speed);
  document.querySelector('.kit')?.classList.add('lesson-active');
  renderLessons();
  showLessonStarter();
}

function renderLessons() {
  const list = $('lesson-list');
  if (!list) return;
  const piano = ACTIVE_KIT === 'salamander-v1';
  $('lessons-title').textContent = t(piano ? 'Piano dainelės' : 'Būgnų pamokos');
  $('lessons-hint').textContent = t('Pasirink greitį ir spausk šviečiančius mygtukus.');
  list.replaceChildren();
  for (const definition of lessonsForKit(ACTIVE_KIT)) {
    const card = document.createElement('article');
    card.className = 'lesson-card' + (lesson?.definition.id === definition.id ? ' is-playing' : '');
    const title = document.createElement('h3');
    title.textContent = t(definition.title);
    const speeds = document.createElement('div');
    speeds.className = 'lesson-speeds';
    for (const speed of lessonSpeeds) {
      const button = action(t(speed.label), () => prepareLesson(definition, speed));
      button.classList.add('lesson-speed');
      button.disabled = !!lesson || busy || recording?.stage === 'saving';
      speeds.append(button);
    }
    if (lesson?.definition.id === definition.id) {
      const stop = action(t('Stabdyti pamoką'), stopLesson);
      stop.dataset.icon = 'stop';
      decorateAction(stop, 'stop');
      speeds.append(stop);
    }
    card.append(title, speeds);
    list.append(card);
  }
}

function duration(ms) {
  return (ms / 1000).toFixed(1) + ' s';
}

function recordingDuration(record) {
  return Math.max(0, ...record.events.map(note => note.time + (note.length || 0)));
}

function keepsAutomaticRecording(record) {
  return !record.automatic || recordingDuration(record) >= MIN_AUTOMATIC_RECORDING_MS;
}

function markPlayButton(button, owner, slot) {
  const active = playback?.owner === owner && playback.slot === slot;
  button.classList.toggle('is-playing', active);
  button.setAttribute('aria-pressed', String(active));
}

function updatePlaybackButtons() {
  for (const member of members.values()) {
    for (const button of member.slots.querySelectorAll('.play-rhythm')) {
      markPlayButton(button, member.profile.id, Number(button.dataset.slot));
    }
  }
}

function displayRhythmTitle(title, slot) {
  return !title || title === `Ritmas ${slot}` || title === `Rytm ${slot}`
    ? `${t('Ritmas')} ${slot}` : title;
}

function rhythmTitle(saved) {
  return displayRhythmTitle(saved.title, saved.slot);
}

function nextFreeSlot(member) {
  for (let slot = 1; slot <= MAX_RHYTHMS; slot++) {
    if (!member.performances.has(slot)) return slot;
  }
  return null;
}

function beginAutomaticRecording() {
  if (recording || busy) return;
  const member = members.get(me.id);
  if (!member?.loaded) return;
  const slot = nextFreeSlot(member);
  if (slot === null) {
    status('Pasiektas 50 ritmų limitas. Gali perrašyti arba ištrinti vieną iš savo ritmų.');
    return;
  }
  startRecording(slot, false, true);
}

function updateCreateControl() {
  const member = members.get(me?.id);
  const count = member?.performances.size || 0;
  $('rhythm-count').textContent = member?.loaded ? `${count} / ${MAX_RHYTHMS} ${t('ritmų')}` : '';
}

function formatRhythmDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('lt-LT', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('.');
}

function renderSlots(member) {
  if (!member.loaded) return;
  const previousScroll = member.slots.querySelector('.rhythm-list')?.scrollTop || 0;
  member.slots.replaceChildren();
  const own = member.profile.id === me.id;
  if (own) updateCreateControl();
  if (!member.performances.size) {
    const empty = document.createElement('p');
    empty.className = 'empty-library hint';
    empty.textContent = t(own ? 'Dar nėra išsaugotų ritmų.' : 'Dar nėra ritmų.');
    member.slots.append(empty);
  }
  const list = document.createElement('div');
  list.className = 'rhythm-list';
  list.tabIndex = 0;
  list.setAttribute('role', 'region');
  list.setAttribute('aria-label', member.profile.nickname + ' ' + t('ritmai'));
  for (const [slot, saved] of [...member.performances].sort(([a], [b]) => a - b)) {
    const active = own && recording?.slot === slot;
    const card = document.createElement('article');
    card.className = 'slot' + (active ? ' is-recording' : '');
    card.dataset.slot = slot;
    const title = document.createElement('h3');
    title.textContent = rhythmTitle(saved);
    if (own) {
      title.tabIndex = 0;
      title.setAttribute('role', 'button');
      title.setAttribute('aria-label', t('Pervadinti') + ': ' + rhythmTitle(saved));
      title.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openRename(slot);
        }
      });
    }
    const info = document.createElement('p');
    info.textContent = active ? t(recording.stage === 'review' ? 'Perklausa' : 'Bandymas') : duration(saved.duration_ms);
    const kitLabel = document.createElement('span');
    kitLabel.className = 'rhythm-kit';
    kitLabel.textContent = t(getKit(active ? recording.kit : saved.kit || DEFAULT_KIT).name);
    info.append(kitLabel);
    const heading = document.createElement('div');
    heading.className = 'slot-heading';
    const controls = document.createElement('div');
    controls.className = 'actions';
    if (saved) {
      const play = action('Atkurti', () => playPerformance(member, slot), 'play-rhythm');
      play.dataset.slot = slot;
      markPlayButton(play, member.profile.id, slot);
      play.disabled = !!recording || busy;
      const meta = document.createElement('div');
      meta.className = 'play-meta';
      meta.append(play);
      const dateValue = saved.created_at || saved.updated_at;
      const dateLabel = formatRhythmDate(dateValue);
      if (dateLabel) {
        const date = document.createElement('time');
        date.className = 'rhythm-date';
        date.dateTime = new Date(dateValue).toISOString();
        date.textContent = dateLabel;
        date.title = t(saved.created_at ? 'Sukurta' : 'Paskutinis žinomas atnaujinimas');
        meta.append(date);
      }
      heading.append(meta);
    }
    heading.append(title, info);
    if (own) {
      const record = action('Perrašyti', () => startRecording(slot), 'primary');
      record.disabled = !!recording || busy;
      controls.append(record);
      if (saved) {
        const remove = action('Ištrinti', () => removePerformance(slot), 'danger');
        remove.disabled = !!recording || busy;
        controls.append(remove);
      }
    }
    if (own) card.addEventListener('dblclick', event => {
      if (!event.target.closest('button')) openRename(slot);
    });
    card.append(heading);
    if (own) card.append(controls);
    list.append(card);
  }
  if (member.performances.size) {
    member.slots.append(list);
    list.scrollTop = previousScroll;
  }
}

function openRename(slot) {
  if (busy || recording) return;
  const saved = members.get(me.id).performances.get(slot);
  if (!saved) return;
  renamingSlot = slot;
  $('rhythm-title-input').value = rhythmTitle(saved);
  $('rhythm-title-input').setCustomValidity('');
  $('rename-error').textContent = '';
  $('rename-dialog').showModal();
  $('rhythm-title-input').focus();
  $('rhythm-title-input').select();
}

async function finishRename(event) {
  event.preventDefault();
  if (renamingBusy || renamingSlot === null) return;
  const title = $('rhythm-title-input').value.trim();
  if (!title || Array.from(title).length > 60) {
    $('rhythm-title-input').setCustomValidity(t('Pavadinimas turi būti nuo 1 iki 60 simbolių.'));
    $('rhythm-title-input').reportValidity();
    return;
  }
  busy = renamingBusy = true;
  mutationRevision++;
  $('save-title').disabled = $('cancel-title').disabled = true;
  refreshControls();
  try {
    const saved = await db.renamePerformance(renamingSlot, title);
    members.get(me.id).performances.set(renamingSlot, saved);
    $('rename-dialog').close();
    status('Ritmo pavadinimas išsaugotas.');
  } catch (error) {
    $('rename-error').textContent = t(error.message);
  } finally {
    busy = renamingBusy = false;
    $('save-title').disabled = $('cancel-title').disabled = false;
    refreshControls();
  }
}

function refreshControls() {
  updateCreateControl();
  for (const member of members.values()) renderSlots(member);
  $('more-users').disabled = usersLoading || busy || !!recording;
  $('upload-avatar').disabled = busy || !!recording;
  $('remove-avatar').disabled = busy || !!recording;
}

async function loadMember(member, silent = false) {
  if (member.pending) return member.pending;
  if (member.profile.id === me.id && (recording || busy)) return;
  if (!member.loaded) member.slots.textContent = t('Įkeliami grojimai…');
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
      message.textContent = t(error.message);
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
    $('welcome-name').textContent = t('Labas') + ', ' + profile.nickname + '!';
    showAvatar($('my-avatar'), profile);
    $('remove-avatar').hidden = !profile.avatar_data || !avatarRemovalVisible;
    $('welcome-name').setAttribute('aria-expanded', String(!!profile.avatar_data && avatarRemovalVisible));
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
  clearInterval(presenceTimer);
  clearInterval(locationRequestTimer);
  db.touchPresence().catch(() => {});
  pollTimer = setInterval(() => loadUsers(true, true), 30000);
  presenceTimer = setInterval(() => db.touchPresence().catch(() => {}), 30000);
  locationRequestTimer = setInterval(() => {
    if (activeLocationRequest || Date.now() - lastLocationRequestCheck >= 2000) checkLocationRequest();
  }, 500);
  checkLocationRequest();
}

function clientDeviceInfo() {
  const ua = navigator.userAgent;
  const lower = ua.toLowerCase();
  const ipad = /ipad/.test(lower) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const deviceType = ipad || /tablet/.test(lower) || (/android/.test(lower) && !/mobile/.test(lower))
    ? 'Planšetė' : /mobile|iphone|ipod|android/.test(lower) ? 'Telefonas' : 'Kompiuteris';
  let osName = 'Kita sistema';
  if (/android/.test(lower)) osName = 'Android';
  else if (ipad || /iphone|ipod/.test(lower)) osName = 'iOS';
  else if (/windows/.test(lower)) osName = 'Windows';
  else if (/mac os|macintosh/.test(lower)) osName = 'macOS';
  else if (/linux/.test(lower)) osName = 'Linux';
  let browserName = 'Kita naršyklė';
  if (/edg\//.test(lower)) browserName = 'Edge';
  else if (/opr\//.test(lower)) browserName = 'Opera';
  else if (/samsungbrowser\//.test(lower)) browserName = 'Samsung Internet';
  else if (/firefox\/|fxios\//.test(lower)) browserName = 'Firefox';
  else if (/chrome\/|crios\//.test(lower)) browserName = 'Chrome';
  else if (/safari\//.test(lower)) browserName = 'Safari';
  return { deviceType, osName, browserName };
}

async function captureSessionContext() {
  const details = clientDeviceInfo();
  try {
    const response = await fetch('https://ipwho.is/?fields=success,country,region,city', {
      signal: AbortSignal.timeout(4000), referrerPolicy: 'no-referrer'
    });
    const place = await response.json();
    if (response.ok && place.success !== false) {
      details.approxLocation = [...new Set([place.city, place.region, place.country].filter(Boolean))].join(', ');
    }
  } catch {}
  await db.startMemberSession(details);
}

function createLocationDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'location-request-dialog';
  dialog.setAttribute('aria-labelledby', 'location-request-title');
  const title = document.createElement('h2');
  title.id = 'location-request-title';
  title.textContent = t('Vietos bendrinimo prašymas');
  const explanation = document.createElement('p');
  explanation.textContent = t('Administratorius prašo vieną kartą gauti dabartinę jūsų vietą. Patvirtinus naršyklė dar paprašys vietos leidimo. Nuolatinis sekimas nebus įjungtas.');
  const controls = document.createElement('div');
  controls.className = 'actions';
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'action primary';
  share.textContent = 'Bendrinti dabartinę vietą';
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'action';
  decline.textContent = 'Atmesti';
  controls.append(share, decline);
  dialog.append(title, explanation, controls);
  document.body.append(dialog);
  decorateAction(share, 'check');
  decorateAction(decline, 'close');
  share.addEventListener('click', shareRequestedLocation);
  decline.addEventListener('click', declineLocationRequest);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    declineLocationRequest();
  });
  return dialog;
}

async function checkLocationRequest() {
  if (!me || document.hidden || locationRequestChecking) return;
  locationRequestChecking = true;
  lastLocationRequestCheck = Date.now();
  const current = activeLocationRequest;
  try {
    const requests = await db.pendingLocationRequest();
    if (current) {
      if (activeLocationRequest?.id !== current.id) return;
      if (!requests.some(request => request.id === current.id)) {
        closeLocationRequest();
      }
      return;
    }
    const next = requests.find(request => request.id !== dismissedLocationRequestId);
    if (!next) return;
    activeLocationRequest = next;
    $('location-request-dialog').showModal();
  } catch {} finally {
    locationRequestChecking = false;
  }
}

function closeLocationRequest() {
  dismissedLocationRequestId = activeLocationRequest?.id || dismissedLocationRequestId;
  $('location-request-dialog').close();
  activeLocationRequest = null;
}

function currentPosition(requestId, onPosition) {
  return new Promise((resolve, reject) => {
    const geolocation = navigator.geolocation;
    if (!geolocation) return reject(new Error(t('Ši naršyklė nepalaiko vietos nustatymo.')));
    const options = { enableHighAccuracy: true, maximumAge: 0 };
    let watchId;
    let refinementTimer;
    let best;
    let saving = Promise.resolve();
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(refinementTimer);
      if (watchId !== undefined) geolocation.clearWatch(watchId);
      locationAcquisitions.delete(requestId);
      if (error) reject(error);
      else resolve(saving);
    };
    locationAcquisitions.set(requestId, () => finish(Object.assign(new Error('Location collection cancelled'), { code: 'LOCATION_CANCELLED' })));
    const onError = error => finish(best && error.code !== 1 ? undefined : error);
    try {
      if (typeof geolocation.watchPosition !== 'function') {
        geolocation.getCurrentPosition(position => {
          if (finished) return;
          best = position;
          saving = saving.then(() => onPosition(position, false));
          saving.catch(() => {});
          finish();
        }, onError, options);
        return;
      }
      watchId = geolocation.watchPosition(position => {
        if (finished) return;
        if (!best || position.coords.accuracy < best.coords.accuracy) {
          const refinement = !!best;
          best = position;
          // Save the first fix immediately. Serialize later improvements so an
          // earlier, slower request cannot overwrite a more accurate result.
          saving = saving.then(() => onPosition(position, refinement));
          saving.catch(() => {});
        }
        if (best.coords.accuracy <= 100) return finish();
        // The browser can initially return a coarse fix while GPS warms up.
        // This bounded refinement starts AFTER a first fix, never while waiting
        // for permission. The first fix is already visible to the admin.
        if (!refinementTimer) refinementTimer = setTimeout(() => finish(), 12000);
      }, onError, options);
      if (finished) geolocation.clearWatch(watchId);
    } catch (error) {
      finish(error);
    }
  });
}

async function shareRequestedLocation() {
  if (!activeLocationRequest) return;
  const request = activeLocationRequest;
  closeLocationRequest();
  try {
    await db.beginLocationRequest(request.id);
    await currentPosition(request.id, (position, refinement) => refinement
      ? db.refineLocationRequest(request.id, position)
      : db.respondLocationRequest(request.id, 'approved', position));
  } catch (error) {
    const cancelled = error.code === 'P0002' || error.code === 'LOCATION_CANCELLED';
    const browserDenied = error.code === 1;
    if (!cancelled) {
      try { await db.respondLocationRequest(request.id, browserDenied ? 'browser_denied' : 'error'); } catch {}
    }
  }
}

async function declineLocationRequest() {
  if (!activeLocationRequest) return;
  const request = activeLocationRequest;
  locationAcquisitions.get(request.id)?.();
  closeLocationRequest();
  try {
    await db.respondLocationRequest(request.id, 'declined');
  } catch {}
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
    avatarRemovalVisible = false;
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
  clearTimeout(recording.silenceTimer);
  clearInterval(recording.clockTimer);
}

function updateRecordBar() {
  const visible = recording && ['review', 'saving', 'failed'].includes(recording.stage);
  if (visible) pauseLessonForReview();
  $('recording-bar').hidden = !visible;
  if (!recording) return;
  const stage = recording.stage;
  $('recording-bar').dataset.stage = stage;
  $('recording-title').textContent = `${displayRhythmTitle(recording.title, recording.slot)} · ` + t(({
    armed: 'Laukiama pirmo smūgio', recording: 'Įrašoma',
    review: 'Pabaiga', saving: 'Išsaugoma…', failed: 'Nepavyko išsaugoti'
  })[stage]);
  $('commit-recording').hidden = stage !== 'review';
  $('commit-recording').querySelector('.button-label').textContent = recording.replace
    ? `${t('Atnaujinti')} ${displayRhythmTitle(recording.title, recording.slot)}` : `${t('Įrašyti į')} ${displayRhythmTitle(recording.title, recording.slot)}`;
  $('retry-recording').hidden = stage !== 'failed';
  $('restart-recording').disabled = $('cancel-recording').disabled = stage === 'saving';
  const elapsed = ['review', 'failed', 'saving'].includes(stage) ? (Math.max(0, ...recording.events.map(note => note.time + (note.length || 0))))
    : recording.started === null ? 0 : performance.now() - recording.started;
  $('recording-clock').textContent = duration(elapsed);
}

function startRecording(slot, scroll = true, automatic = false) {
  if (recording || busy) return;
  const saved = members.get(me.id)?.performances.get(slot);
  mutationRevision++;
  stopPlayback();
  if (scroll) stopLesson();
  prepareAudio().catch(() => {});
  recording = { slot, kit: ACTIVE_KIT, title: saved ? rhythmTitle(saved) : t('Ritmas') + ' ' + slot, replace: !!saved, automatic, stage: 'armed', started: null, events: [], heldPiano: new Set() };
  updateRecordBar();
  refreshControls();
  status(automatic ? '' : saved ? 'Grok naują bandymą. Senas ritmas liks, kol nepatvirtinsi pakeitimo.'
    : 'Įrašymas prasidėjo nuo pirmo smūgio.');
  if (scroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function discardRecordingForLesson() {
  if (!recording || recording.stage === 'saving') return;
  clearRecordTimers();
  stopPlayback();
  recording = null;
  pausedLesson = null;
  stopAudio();
  updateRecordBar();
  refreshControls();
  status('');
}

function scheduleRecordingReview(tail = 0) {
  if (!recording || recording.stage !== 'recording') return;
  clearTimeout(recording.silenceTimer);
  recording.silenceTimer = setTimeout(finishRecording, Math.max(0, tail) + 3000);
}

window.addEventListener('drumhit', event => {
  stopLessonPreview();
  scoreLessonHit(event.detail.key);
  stopPlayback();
  if (!recording) beginAutomaticRecording();
  if (!recording || !['armed', 'recording'].includes(recording.stage)) return;
  const now = performance.now();
  if (recording.started === null) {
    recording.started = now;
    recording.stage = 'recording';
    recording.clockTimer = setInterval(updateRecordBar, 250);
  }
  const time = Math.round(now - recording.started);
  recording.events.push({ key: event.detail.key, time,
    ...(recording.kit === DEFAULT_KIT ? {} : { velocity: event.detail.velocity }),
    ...(recording.kit === 'salamander-v1' ? { length: 0 } : {}) });
  if (recording.kit === 'salamander-v1') {
    recording.heldPiano.add(event.detail.key);
    clearTimeout(recording.silenceTimer);
  } else {
    scheduleRecordingReview(soundDuration(event.detail.key, recording.kit, event.detail.velocity));
  }
  updateRecordBar();
  if (recording.events.length >= MAX_NOTES) finishRecording();
});

window.addEventListener('pianorelease', event => {
  lessonButton(event.detail.key)?.classList.remove('lesson-correct', 'lesson-wrong');
  if (!recording || recording.kit !== 'salamander-v1' || recording.stage !== 'recording') return;
  const note = recording.events.findLast(note => note.key === event.detail.key);
  if (note) note.length = Math.max(0, Math.round(performance.now() - recording.started) - note.time);
  recording.heldPiano.delete(event.detail.key);
  if (!recording.heldPiano.size) {
    const releaseTail = note ? soundDuration(note.key, recording.kit, note.velocity || 127, note.length) - note.length : 200;
    scheduleRecordingReview(releaseTail);
  }
});

async function finishRecording() {
  if (!recording || ['saving', 'review', 'failed'].includes(recording.stage)) return;
  releasePianoKeys();
  clearRecordTimers();
  if (!recording.events.length) {
    cancelRecording();
    status('Tuščias bandymas neišsaugotas. Ankstesnis grojimas nepakeistas.');
    return;
  }
  if (!keepsAutomaticRecording(recording)) {
    recording = null;
    stopAudio();
    updateRecordBar();
    refreshControls();
    status('');
    return;
  }
  recording.stage = 'review';
  updateRecordBar();
  refreshControls();
  status(recording.replace ? 'Pasirink: atnaujinti ritmą, pakartoti bandymą arba išeiti.'
    : 'Pasirink: išsaugoti ritmą, pakartoti bandymą arba išeiti.');
}

async function persistRecording() {
  if (!recording || recording.stage === 'saving' || !recording.events.length) return;
  clearRecordTimers();
  stopPlayback();
  const draft = recording;
  draft.stage = 'saving';
  updateRecordBar();
  try {
    const [saved] = await db.savePerformance(draft.slot, draft.events, draft.title, draft.replace, draft.kit);
    // A pagehide can discard local state while the explicitly requested save finishes.
    if (recording !== draft) return;
    members.get(me.id).performances.set(draft.slot, saved);
    recording = null;
    pausedLesson = null;
    updateRecordBar();
    refreshControls();
    renderLessons();
    status(() => language === 'sv'
      ? `”${rhythmTitle(saved)}” har sparats. Alla inloggade kan lyssna på inspelningen.`
      : `„${rhythmTitle(saved)}“ išsaugotas. Jį gali perklausyti visi prisijungę vartotojai.`);
  } catch (error) {
    if (recording !== draft) return;
    draft.stage = 'failed';
    updateRecordBar();
    status(() => t(error.message) + ' ' + t('Gali išsaugoti dar kartą arba pakartoti bandymą.'), true);
  }
}

function repeatRecording() {
  if (!recording || recording.stage === 'saving') return;
  const { slot, title, replace } = recording;
  clearRecordTimers();
  stopPlayback();
  stopAudio();
  mutationRevision++;
  recording = { slot, title, replace, kit: ACTIVE_KIT, stage: 'armed', started: null, events: [], heldPiano: new Set() };
  updateRecordBar();
  refreshControls();
  restorePausedLesson();
  status('Bandymas pradėtas iš naujo. Įrašymas prasidės nuo pirmo smūgio.');
}

function cancelRecording() {
  if (recording?.stage === 'saving') return;
  clearRecordTimers();
  stopPlayback();
  recording = null;
  pausedLesson = null;
  stopAudio();
  updateRecordBar();
  refreshControls();
  renderLessons();
  status('Bandymas atmestas. Ankstesni įrašai nepakeisti.');
}

async function removePerformance(slot) {
  const saved = members.get(me.id)?.performances.get(slot);
  if (recording || busy || !saved || !confirm(language === 'sv'
    ? `Vill du ta bort ”${rhythmTitle(saved)}”?`
    : `Ištrinti ritmą „${rhythmTitle(saved)}“?`)) return;
  busy = true;
  mutationRevision++;
  stopPlayback();
  refreshControls();
  try {
    await db.deletePerformance(slot);
    members.get(me.id).performances.delete(slot);
    status('Ritmas ištrintas. Gali sukurti naują.');
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
    updatePlaybackButtons();
  }
  $('playback-bar').hidden = true;
}

async function playPerformance(member, slot) {
  if (recording || busy) return;
  stopLesson();
  await playSequence(member.performances.get(slot), member.profile.id, slot,
    `${member.profile.nickname} · ${rhythmTitle(member.performances.get(slot))}`);
}

async function playSequence(saved, owner, slot, label, draft = null) {
  if (playback?.owner === owner && playback.slot === slot) {
    stopPlayback();
    return;
  }
  stopPlayback();
  const generation = playbackGeneration;
  try {
    const kit = saved.kit || DEFAULT_KIT;
    await prepareAudio(kit);
    if (generation !== playbackGeneration || (draft ? recording !== draft || !['review', 'failed'].includes(draft.stage) : recording)) return;
    let index = 0;
    const started = performance.now();
    playback = { owner, slot };
    updatePlaybackButtons();
    const endsAt = started + Math.max(...saved.events.map(note => note.time + soundDuration(note.key, kit, note.velocity || 127, note.length))) + 8;
    $('playback-title').textContent = label;
    $('playback-bar').hidden = false;
    const tick = () => {
      const elapsed = performance.now() - started;
      while (index < saved.events.length && saved.events[index].time <= elapsed) {
        const note = saved.events[index++];
        hitDrum(note.key, false, note.velocity || 127, kit, note.length);
      }
      if (index === saved.events.length) {
        clearInterval(playback.timer);
        // Wait for every drum's tail, including overlapping earlier hits.
        playback.endTimer = setTimeout(stopPlayback, Math.max(0, endsAt - performance.now()));
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
  document.querySelector('.kit-tabs').hidden = false;
  $('workspace').hidden = false;
  $('welcome-name').textContent = t('Labas') + ', ' + profile.nickname + '!';
  window.drumAppReady = true;
  renderLessons();
  addMember(profile);
  captureSessionContext().catch(() => {});
  await restoreEmergencyDraft();
  await loadUsers(true);
  startPolling();
}

async function restoreEmergencyDraft() {
  const raw = localStorage.getItem(EMERGENCY_DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (!Array.isArray(draft.events) || !draft.events.length) throw new Error('invalid draft');
    if (await db.saveEmergencyPerformance(draft.events, 'Ritmas 1', draft.kit || DEFAULT_KIT)) {
      localStorage.removeItem(EMERGENCY_DRAFT_KEY);
    }
  } catch {
    localStorage.removeItem(EMERGENCY_DRAFT_KEY);
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const nickname = $('nickname').value.trim();
  if (!nickname || nickname.length > 24) {
    status('Įvesk vardą nuo 1 iki 24 simbolių.', true);
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
$('retry-recording').addEventListener('click', persistRecording);
$('commit-recording').addEventListener('click', persistRecording);
$('restart-recording').addEventListener('click', repeatRecording);
$('cancel-recording').addEventListener('click', cancelRecording);
$('stop-playback').addEventListener('click', stopPlayback);
$('rename-form').addEventListener('submit', finishRename);
$('cancel-title').addEventListener('click', () => $('rename-dialog').close());
$('rename-dialog').addEventListener('cancel', event => {
  if (renamingBusy) event.preventDefault();
});
$('rename-dialog').addEventListener('close', () => { renamingSlot = null; });
$('rhythm-title-input').addEventListener('input', () => $('rhythm-title-input').setCustomValidity(''));
$('more-users').addEventListener('click', () => loadUsers());
$('upload-avatar').addEventListener('click', () => $('avatar-file').click());
$('avatar-file').addEventListener('change', () => {
  const file = $('avatar-file').files[0];
  if (file) changeAvatar(file);
});
$('remove-avatar').addEventListener('click', () => changeAvatar(null));
function revealAvatarRemoval() {
  if (!me?.avatar_data || busy || recording) return;
  avatarRemovalVisible = true;
  $('remove-avatar').hidden = false;
  $('welcome-name').setAttribute('aria-expanded', 'true');
}
function hideAvatarRemoval() {
  avatarRemovalVisible = false;
  $('remove-avatar').hidden = true;
  $('welcome-name').setAttribute('aria-expanded', 'false');
}
$('welcome-name').addEventListener('dblclick', revealAvatarRemoval);
$('welcome-name').addEventListener('click', event => {
  if (event.detail === 0) revealAvatarRemoval();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#welcome-name, #remove-avatar')) hideAvatarRemoval();
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('#welcome-name, #remove-avatar')) hideAvatarRemoval();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideAvatarRemoval();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && me && window.drumAppReady) {
    db.touchPresence().catch(() => {});
    loadUsers(true, true);
    checkLocationRequest();
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted && me) {
    startPolling();
    loadUsers(true, true);
  }
});
// Instrument navigation keeps this module, identity and library alive.
window.addEventListener('instrumentwillchange', () => {
  stopLesson();
  pausedLesson = null;
  const discarded = recording && recording.stage !== 'saving';
  if (discarded) {
    clearRecordTimers();
    recording = null;
    mutationRevision++;
  }
  stopPlayback();
  stopAudio();
  updateRecordBar();
  // Refresh only if draft controls changed; ordinary navigation leaves library DOM intact.
  if (discarded) refreshControls();
  if (!recording) status(discarded ? 'Nebaigtas bandymas atmestas. Pasirinktas kitas instrumentas.' : '');
});
window.addEventListener('instrumentchanged', () => renderLessons());
window.addEventListener('pagehide', () => {
  for (const cancel of locationAcquisitions.values()) cancel();
  clearInterval(pollTimer);
  clearInterval(presenceTimer);
  clearInterval(locationRequestTimer);
  closeLocationRequest();
  clearRecordTimers();
  stopLesson();
  pausedLesson = null;
  if (recording?.events.length && recording.stage !== 'saving' && keepsAutomaticRecording(recording)) {
    localStorage.setItem(EMERGENCY_DRAFT_KEY, JSON.stringify({ events: recording.events, kit: recording.kit }));
    db.saveEmergencyPerformance(recording.events, 'Ritmas 1', recording.kit);
  }
  recording = null;
  stopPlayback();
  stopAudio();
  updateRecordBar();
  refreshControls();
});
window.addEventListener('storage', event => {
  if (event.key?.startsWith('bugnai.auth.') && !event.newValue) {
    for (const cancel of locationAcquisitions.values()) cancel();
    clearInterval(pollTimer);
    clearInterval(presenceTimer);
    clearInterval(locationRequestTimer);
    window.drumAppReady = false;
    cancelRecording();
    stopPlayback();
    $('workspace').hidden = true;
    document.querySelector('.kit-tabs').hidden = true;
    $('login').hidden = false;
    status('Prisijungimas šiame įrenginyje pasikeitė. Perkrauk puslapį.', true);
  }
});

createLocationDialog();
renderLessons();
document.querySelectorAll('.action').forEach(button => decorateAction(button));
decorateAction($('remove-avatar'), 'trash');
applyPageTranslations();
$('language-select').addEventListener('change', event => setLanguage(event.target.value));
window.addEventListener('languagechange', () => {
  if (me) updateProfile(members.get(me.id), me);
  refreshControls();
  updateRecordBar();
  renderLessons();
  if (lesson?.started === null) {
    removeLessonStarter();
    showLessonStarter();
  }
  if (typeof activeStatus.message === 'function') status(activeStatus.message, activeStatus.error);
});

(async () => {
  try {
    if (db.currentUser()) await enter(await db.ensureProfile());
    else status('');
  } catch (error) {
    status(error.message, true);
  }
})();
