export const DEFAULT_KIT = 'classic-v1';
export const ACTIVE_KIT = document.body.dataset.kit || DEFAULT_KIT;
export const KITS = {
  'classic-v1': {
    name: 'Klasikiniai',
    sounds: Object.fromEntries(Object.entries({w:'tom-1',a:'tom-2',s:'tom-3',d:'tom-4',j:'snare',k:'crash',l:'kick-bass'})
      .map(([key,file])=>[key,[`sounds/${file}.mp3`]]))
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
