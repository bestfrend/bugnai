"""Prepare the small, versioned CC0 sample subset. Requires Python 3 and ffmpeg."""
import array
import concurrent.futures
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import urllib.request

COMMIT = '9f04cf9a734527edfbb0a4eee1f674e45bbf71bc'
BASE = f'https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/{COMMIT}/'
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'sounds' / 'virtuosity-v1'
INSTRUMENTS = {'w': 'htom_center', 'a': 'ltom_center', 's': 'hh_closed',
               'd': 'ride_ride', 'j': 'snare_center', 'k': 'crash_crash', 'l': 'kick_snon'}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def fetch(path):
    with urllib.request.urlopen(BASE + path, timeout=45) as response:
        return response.read()


def prepare(item):
    key, instrument = item
    mapping_path = f'Programs/mappings/oh/{instrument}_map.sfz'
    mapping = fetch(mapping_path).decode()
    regions = []
    for block in mapping.split('<region>')[1:]:
        fields = dict(re.findall(r'(\w+)=([^\s]+)', block))
        if int(fields.get('seq_position', 1)) == 1:
            regions.append(fields)
    with tempfile.TemporaryDirectory(prefix='bugnai-sample-') as temp:
        clips = []
        peak = 0
        for layer, velocity in enumerate([40, 80, 120]):
            region = next(r for r in regions if int(r.get('lovel', 1)) <= velocity <= int(r.get('hivel', 127)))
            source = region['sample'].removeprefix('../')
            data = fetch(source)
            if not data.startswith(b'fLaC'):
                raise ValueError(f'Expected a real FLAC file: {source}')
            local = pathlib.Path(temp) / f'{layer}.flac'
            local.write_bytes(data)
            pcm = array.array('f', run('ffmpeg', '-v', 'error', '-i', str(local), '-ac', '2', '-ar', '48000', '-f', 'f32le', '-'))
            local_peak = max(abs(x) for x in pcm)
            peak = max(peak, local_peak)
            threshold = local_peak * 0.005
            first = next((i // 2 for i, x in enumerate(pcm) if abs(x) >= threshold), 0)
            start = max(0, first / 48000 - 0.002)
            length = min(len(pcm) / (48000 * 2) - start, 10)
            clips.append((local, source, data, start, length))
        # One gain per instrument preserves the relative loudness of its three layers.
        gain = min(8, 0.68 / peak)
        result = []
        for layer, (local, source, data, start, length) in enumerate(clips):
            name = f'{key}-{layer}.mp3'
            filters = f'atrim=start={start}:duration={length},asetpts=PTS-STARTPTS,volume={gain},afade=t=out:st={max(0,length-0.035)}:d=0.035'
            run('ffmpeg', '-v', 'error', '-y', '-i', str(local), '-af', filters, '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '-1', str(OUTPUT / name))
            result.append({'file': name, 'source': source, 'source_sha256': hashlib.sha256(data).hexdigest(),
                           'sha256': hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest(),
                           'trim_start_seconds': round(start, 6), 'gain': round(gain, 6)})
        print(f'{key}: {instrument}, 3 velocity layers', flush=True)
        return result


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    license_data = fetch('LICENSE')
    if b'CC0 1.0 Universal' not in license_data:
        raise ValueError('Unexpected source license')
    (OUTPUT / 'LICENSE.txt').write_bytes(license_data)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(prepare, INSTRUMENTS.items()))
    (OUTPUT / 'sources.json').write_text(json.dumps({'repository': 'https://github.com/sfzinstruments/virtuosity_drums',
        'commit': COMMIT, 'license': 'CC0-1.0', 'microphone': 'overhead',
        'sample_velocities': [40, 80, 120], 'files': [f for group in results for f in group]}, indent=2) + '\n')
    print(f'Total MP3 bytes: {sum(p.stat().st_size for p in OUTPUT.glob("*.mp3"))}', flush=True)
