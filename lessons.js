const pianoMelody = [
  'c4', 'c4', 'g4', 'g4', 'a4', 'a4', 'g4',
  'f4', 'f4', 'e4', 'e4', 'd4', 'd4', 'c4',
  'g4', 'g4', 'f4', 'f4', 'e4', 'e4', 'd4',
  'g4', 'g4', 'f4', 'f4', 'e4', 'e4', 'd4',
  'c4', 'c4', 'g4', 'g4', 'a4', 'a4', 'g4',
  'f4', 'f4', 'e4', 'e4', 'd4', 'd4', 'c4'
];

function beat(keys) {
  return keys.map((key, beat) => ({ key, beat }));
}

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
  { id: 'slow', label: 'Lėtas', beatMs: 700 },
  { id: 'medium', label: 'Vidutinis', beatMs: 500 },
  { id: 'fast', label: 'Greitas', beatMs: 340 }
];

export function lessonsForKit(kit) {
  if (kit === 'salamander-v1') return [{ id: 'two-roosters', title: 'Du gaideliai', events: beat(pianoMelody) }];
  return drumLessons;
}
