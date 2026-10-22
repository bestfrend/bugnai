// Short beginner arrangements of public-domain melodies, within C4–A4.
// A tuple gives a note's length in beats; plain notes last one beat.
function melody(notes) {
  let time = 0;
  return notes.map(note => {
    const [key, length] = Array.isArray(note) ? note : [note, 1];
    const event = { key, beat: time };
    time += length;
    return event;
  });
}

const pianoLessons = [
  { id: 'ode-to-joy', title: 'Odė džiaugsmui', events: melody([
    'e4', 'e4', 'f4', 'g4', 'g4', 'f4', 'e4', 'd4',
    'c4', 'c4', 'd4', 'e4', 'e4', 'd4', ['d4', 2],
    'e4', 'e4', 'f4', 'g4', 'g4', 'f4', 'e4', 'd4',
    'c4', 'c4', 'd4', 'e4', 'd4', 'c4', 'c4'
  ]) },
  { id: 'london-bridge', title: 'Londono tiltas', events: melody([
    ['g4', 1.5], ['a4', .5], 'g4', 'f4', 'e4', 'f4', ['g4', 2],
    'd4', 'e4', ['f4', 2], 'e4', 'f4', ['g4', 2],
    ['g4', 1.5], ['a4', .5], 'g4', 'f4', 'e4', 'f4', ['g4', 2],
    ['d4', 2], ['g4', 2], 'e4', 'c4'
  ]) },
  { id: 'mary-little-lamb', title: 'Mažas avinėlis', events: melody([
    'e4', 'd4', 'c4', 'd4', 'e4', 'e4', ['e4', 2],
    'd4', 'd4', ['d4', 2], 'e4', 'g4', ['g4', 2],
    'e4', 'd4', 'c4', 'd4', 'e4', 'e4', 'e4', 'e4',
    'd4', 'd4', 'e4', 'd4', 'c4'
  ]) },
  { id: 'two-roosters', title: 'Du gaideliai', events: melody([
    'c4', 'c4', 'g4', 'g4', 'a4', 'a4', 'g4',
    'f4', 'f4', 'e4', 'e4', 'd4', 'd4', 'c4',
    'g4', 'g4', 'f4', 'f4', 'e4', 'e4', 'd4',
    'g4', 'g4', 'f4', 'f4', 'e4', 'e4', 'd4',
    'c4', 'c4', 'g4', 'g4', 'a4', 'a4', 'g4',
    'f4', 'f4', 'e4', 'e4', 'd4', 'd4', 'c4'
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
