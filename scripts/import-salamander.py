"""Fetch a pinned, attributed Salamander subset; verify TLS and record SHA-256."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import urllib.request

REVISION = 'efd8296360f9526e379bfbe5c1698ff54d6a1d34'
BASE = f'https://raw.githubusercontent.com/tonejs/audio/{REVISION}/salamander/'
DEST = Path(__file__).resolve().parents[1] / 'sounds/salamander-v1'
DEST.mkdir(parents=True, exist_ok=True)

def fetch(name):
    data = urllib.request.urlopen(BASE + name, timeout=60).read()
    if name.endswith('.mp3') and not (data[:3] == b'ID3' or data[0] == 255):
        raise ValueError('Not an MP3: ' + name)
    (DEST / name).write_bytes(data)
    return {'file': name, 'url': BASE + name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

SAMPLES = [
    *(f'{note}{octave}.mp3' for octave in range(2, 7) for note in ('C', 'Ds', 'Fs', 'A')),
    'C7.mp3',
]

with ThreadPoolExecutor(max_workers=3) as pool:
    files = list(pool.map(fetch, [*SAMPLES, 'README']))
(DEST / 'sources.json').write_text(json.dumps({'commit': REVISION, 'author': 'Alexander Holm',
    'license': 'CC BY 3.0', 'files': files}, indent=2) + '\n')
print('Downloaded and hashed', len(files), 'files')
