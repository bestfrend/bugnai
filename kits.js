export const DEFAULT_KIT = 'classic-v1';
export let ACTIVE_KIT = document.body.dataset.kit || DEFAULT_KIT;
export const KITS = {
  'classic-v1': {
    name: 'Klasikiniai',
    sounds: Object.fromEntries(Object.entries({w:'tom-1',a:'tom-2',s:'tom-3',d:'tom-4',j:'snare',k:'crash',l:'kick-bass'})
      .map(([key,file])=>[key,[`sounds/${file}.mp3`]]))
  },
  'salamander-v1': {
    name: 'Salamander pianinas',
    sounds: Object.fromEntries(['c4','cs4','d4','ds4','e4','f4','fs4','g4','gs4','a4','as4','b4','c5'].map((key,i)=> {
      const sources = [[0,'C4'],[3,'Ds4'],[6,'Fs4'],[9,'A4'],[12,'C5']];
      const [,file] = sources.reduce((best,item)=>Math.abs(item[0]-i)<Math.abs(best[0]-i)?item:best);
      return [key,[`sounds/salamander-v1/${file}.mp3`]];
    }))
  },
  'virtuosity-v1': {
    name: 'Virtuosity',
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

export const PIANO_KEYS = ['c4','cs4','d4','ds4','e4','f4','fs4','g4','gs4','a4','as4','b4','c5'];
export function playbackRate(kit, key) {
  if (kit !== 'salamander-v1') return 1;
  const index = PIANO_KEYS.indexOf(key);
  const nearest = [0,3,6,9,12].reduce((best,n)=>Math.abs(n-index)<Math.abs(best-index)?n:best);
  return 2 ** ((index-nearest)/12);
}

export function setActiveKit(id) {
  getKit(id);
  ACTIVE_KIT = id;
}
