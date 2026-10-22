export const DEFAULT_KIT = 'classic-v1';
export let ACTIVE_KIT = document.body.dataset.kit || DEFAULT_KIT;
export const PIANO_OCTAVES = [2, 3, 4, 5, 6];
export const PIANO_SEMITONES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];
export function pianoKeys(octave) {
  if (!PIANO_OCTAVES.includes(octave)) throw new Error('Nežinomas pianino aukštis.');
  return [...PIANO_SEMITONES.map(note => note + octave), 'c' + (octave + 1)];
}
const pianoAnchors = PIANO_OCTAVES.flatMap(octave => ['c', 'ds', 'fs', 'a'].map(note => note + octave)).concat('c7');
function closestPianoSample(key) {
  const index = pianoNoteIndex(key);
  return pianoAnchors.reduce((best, sample) => Math.abs(pianoNoteIndex(sample) - index) < Math.abs(pianoNoteIndex(best) - index) ? sample : best);
}
function pianoNoteIndex(key) {
  const match = /^([a-g]s?)(\d)$/.exec(key);
  if (!match) return Number.NaN;
  return Number(match[2]) * 12 + PIANO_SEMITONES.indexOf(match[1]);
}
export const KITS = {
  'classic-v1': {
    name: 'Klasikiniai',
    sounds: Object.fromEntries(Object.entries({w:'tom-1',a:'tom-2',s:'tom-3',d:'tom-4',j:'snare',k:'crash',l:'kick-bass'})
      .map(([key,file])=>[key,[`sounds/${file}.mp3`]]))
  },
  'salamander-v1': {
    name: 'Salamander pianinas',
    sounds: Object.fromEntries(PIANO_OCTAVES.flatMap(pianoKeys).map(key => {
      const sample = closestPianoSample(key);
      return [key, [`sounds/salamander-v1/${sample[0].toUpperCase()}${sample.slice(1)}.mp3`]];
    }))
  },
  'virtuosity-v1': {
    name: 'Virtuosity',
    sounds: Object.fromEntries([...'wasdjkl'].map(key=>[key,[0,1,2].map(layer=>`sounds/virtuosity-v1/${key}-${layer}.mp3`)]))
  },
  'stage-v1': {
    name: 'Studijiniai',
    // Fixed CC0 Virtuosity samples: each visual pad maps to its real instrument.
    sounds: Object.fromEntries([...'wasdjkl'].map(key=>[key,[0,1,2].map(layer=>`sounds/virtuosity-v1/${key}-${layer}.mp3`)]))
  }
};

export function getKit(id = DEFAULT_KIT) {
  if (!KITS[id]) throw new Error('Nežinomas būgnų rinkinys.');
  return KITS[id];
}

export function samplePath(id, key, velocity = 127) {
  const paths = getKit(id).sounds[key];
  if (!paths) return null;
  const layer = Math.min(paths.length-1,Math.floor((Math.max(1,Math.min(127,velocity))-1)*paths.length/127));
  return paths[layer];
}

export function playbackRate(kit, key) {
  if (kit !== 'salamander-v1') return 1;
  return 2 ** ((pianoNoteIndex(key) - pianoNoteIndex(closestPianoSample(key))) / 12);
}

export function setActiveKit(id) {
  getKit(id);
  ACTIVE_KIT = id;
}
