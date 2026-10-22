// Beginner arrangements. All piano timing is expressed in beats, independent
// of playback speed: [key, spacing, hold], or [null, spacing] for a rest.
// A plain key is a quarter note. Short release gaps keep repetitions distinct.
export function melody(notes) {
  if (!Array.isArray(notes) || !notes.length) throw new TypeError('A melody needs notes.');
  let time = 0;
  const events = [];
  for (const note of notes) {
    const [key, beats = 1, hold = beats - Math.min(.2, beats * .2)] = Array.isArray(note) ? note : [note];
    if (!Number.isFinite(beats) || beats <= 0) throw new TypeError('Spacing must be positive beats.');
    if (key !== null) {
      if (!/^(?:(?:c|cs|d|ds|e|f|fs|g|gs|a|as|b)[2-6]|c7)$/.test(key) ||
          !Number.isFinite(hold) || hold <= 0 || hold > beats) throw new TypeError('Invalid piano note or hold.');
      events.push({ key, beat: time, duration: hold });
    }
    time += beats;
  }
  if (!events.length) throw new TypeError('A melody needs a sounding note.');
  return { events, durationBeats: time };
}

const pianoLessons = [
  { id: 'ode-to-joy', title: 'Odė džiaugsmui', ...melody([
    'e4', 'e4', 'f4', 'g4', 'g4', 'f4', 'e4', 'd4',
    'c4', 'c4', 'd4', 'e4', ['e4', 1.5], ['d4', .5], ['d4', 1.75, 1.65], [null, .25],
    'e4', 'e4', 'f4', 'g4', 'g4', 'f4', 'e4', 'd4',
    'c4', 'c4', 'd4', 'e4', ['d4', 1.5], ['c4', .5], ['c4', 1.5, 1.4], [null, .5]
  ]) },
  { id: 'london-bridge', title: 'Londono tiltas', ...melody([
    ['g4', 1.5], ['a4', .5], 'g4', 'f4', 'e4', 'f4', ['g4', 1.75, 1.65], [null, .25],
    'd4', 'e4', ['f4', 2], 'e4', 'f4', ['g4', 1.75, 1.65], [null, .25],
    ['g4', 1.5], ['a4', .5], 'g4', 'f4', 'e4', 'f4', ['g4', 1.75, 1.65], [null, .25],
    ['d4', 2], ['g4', 2], 'e4', ['c4', 2.5, 2.4], [null, .5]
  ]) },
  { id: 'mary-little-lamb', title: 'Mažas avinėlis', ...melody([
    'e4', 'd4', 'c4', 'd4', 'e4', 'e4', ['e4', 1.75, 1.65], [null, .25],
    'd4', 'd4', ['d4', 2], 'e4', 'g4', ['g4', 1.75, 1.65], [null, .25],
    'e4', 'd4', 'c4', 'd4', 'e4', 'e4', 'e4', 'e4',
    'd4', 'd4', 'e4', 'd4', ['c4', 3.5, 3.4], [null, .5]
  ]) },
  { id: 'two-roosters', title: 'Du gaideliai', ...melody([
    'c4', 'c4', 'g4', 'g4', 'a4', 'a4', ['g4', 1.75, 1.65], [null, .25],
    'f4', 'f4', 'e4', 'e4', 'd4', 'd4', ['c4', 1.75, 1.65], [null, .25],
    'g4', 'g4', 'f4', 'f4', 'e4', 'e4', ['d4', 2],
    'g4', 'g4', 'f4', 'f4', 'e4', 'e4', ['d4', 1.75, 1.65], [null, .25],
    'c4', 'c4', 'g4', 'g4', 'a4', 'a4', ['g4', 1.75, 1.65], [null, .25],
    'f4', 'f4', 'e4', 'e4', 'd4', 'd4', ['c4', 1.5, 1.4], [null, .5]
  ]) }
];

function repeat(keys, count, step = .5) {
  return Array.from({ length: count }, (_, index) => ({ key: keys[index % keys.length], beat: index * step }));
}

const drumLessons = [
  { id: 'first-rock', title: 'Pirmas rokas', events: repeat(['l', 's', 'j', 's'], 16) },
  { id: 'slow-rock', title: 'Lėtas rokas', events: repeat(['l', 'j'], 8, 1) },
  { id: 'crash-start', title: 'Crash pradžia', events: [
    { key: 'k', beat: 0 }, { key: 'l', beat: 0 }, { key: 's', beat: .5 }, { key: 'j', beat: 1 }, { key: 's', beat: 1.5 },
    ...repeat(['l', 's', 'j', 's'], 12).map(note => ({ ...note, beat: note.beat + 2 }))
  ] },
  { id: 'eight-hihat', title: 'Aštuoni hi-hat', events: Array.from({ length: 16 }, (_, beat) => ({ key: beat % 4 === 0 ? 'l' : beat % 4 === 2 ? 'j' : 's', beat: beat * .25 })) }
];

export const lessonSpeeds = [
  { id: 'slow', label: 'Lėtas', beatMs: 1400 },
  { id: 'medium', label: 'Normalus', beatMs: 520 },
  { id: 'fast', label: 'Greitas', beatMs: 350 }
];

export function lessonsForKit(kit) {
  if (kit === 'salamander-v1') return pianoLessons;
  return drumLessons;
}
