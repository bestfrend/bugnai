"""Generate both instrument pages from the shared application markup."""
import pathlib
import re
root = pathlib.Path(__file__).resolve().parents[1]
page = (root / 'index.html').read_text(encoding='utf-8')
page = page.replace('<title>Būgnai</title>', '<title>Virtuosity būgnai</title>')
page = page.replace('<body data-kit="classic-v1">', '<body data-kit="virtuosity-v1" class="studio-kit">')
page = page.replace('data-kit-link="classic-v1" aria-current="page"', 'data-kit-link="classic-v1"')
page = page.replace('data-kit-link="virtuosity-v1"', 'data-kit-link="virtuosity-v1" aria-current="page"')
page = page.replace('class="sound-credit" hidden', 'class="sound-credit"')
names = {'w':'Aukštas tomas', 'a':'Žemas tomas', 's':'Užd. hi-hat', 'd':'Ride lėkštė', 'j':'Mažasis būgnas', 'k':'Crash lėkštė', 'l':'Bosinis būgnas'}
buttons = '\n'.join(f'          <button type="button" class="{key} drum" data-key="{key}" aria-label="{name}, {key.upper()}"><span class="drum-key">{key}</span><span class="drum-name">{name}</span></button>' for key,name in names.items())
page, count = re.subn(r'<div class="set">.*?</div>', '<div class="set">\n'+buttons+'\n        </div>', page, count=1, flags=re.S)
if count != 1: raise SystemExit('Missing shared drum kit markup')
(root / 'studio.html').write_text(page, encoding='utf-8')

# Piano shares the complete login/library/recording UI with both drum pages.
page = (root / 'index.html').read_text(encoding='utf-8')
page = page.replace('<title>Būgnai</title>', '<title>Salamander pianinas · Alexander Holm</title>')
page = page.replace('<body data-kit="classic-v1">', '<body data-kit="salamander-v1" class="piano-kit">')
page = page.replace('data-kit-link="classic-v1" aria-current="page"', 'data-kit-link="classic-v1"')
page = page.replace('data-kit-link="salamander-v1"', 'data-kit-link="salamander-v1" aria-current="page"')
page = page.replace('Būgnų 🥁 komplektas', 'Salamander pianinas')
page = page.replace('aria-label="Būgnai"', 'aria-label="Pianinas"')
page = page.replace('<p class="hint">Paliesk būgnus arba grok klavišais W A S D J K L.</p>\n', '')
page = page.replace('Įkeliami būgnų garsai…', 'Įkeliami pianino garsai…')
notes = [('c4','Do','a',0),('cs4','Do♯','w',1),('d4','Re','s',1),('ds4','Re♯','e',2),('e4','Mi','d',2),('f4','Fa','f',3),('fs4','Fa♯','t',4),('g4','Sol','g',4),('gs4','Sol♯','y',5),('a4','La','h',5),('as4','La♯','u',6),('b4','Si','j',6),('c5','Do','k',7)]
buttons = '\n'.join(f'<button type="button" class="piano-key {"black-key" if "s" in note else "white-key"}" data-key="{note}" data-shortcut="{shortcut}" style="--position:{position}" aria-label="{name}, {note.upper()}, klavišas {shortcut.upper()}"><span>{name}</span><small>{shortcut.upper()}</small></button>' for note,name,shortcut,position in notes)
controls = '<div class="piano-octave-controls" aria-label="Pianino aukščio pasirinkimas"><button type="button" class="action piano-octave-button" data-octave-shift="-1" aria-label="Žemesni garsai"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7"/></svg><span class="piano-button-label">Žemiau</span></button><output id="piano-octave-label" aria-live="polite">Vidurinė dalis · C4–C5</output><button type="button" class="action piano-octave-button" data-octave-shift="1" aria-label="Aukštesni garsai"><span class="piano-button-label">Aukščiau</span><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></button></div>'
page = re.sub(r'<div class="set">.*?</div>', controls+'<div class="set piano-keyboard" aria-label="Pianino klavišai C4–C5">'+buttons+'</div>', page, count=1, flags=re.S)
credit = '<div class="sound-credit piano-credit">Salamander Grand Piano · <strong>Alexander Holm</strong><br><a href="https://github.com/tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander" target="_blank" rel="noopener">Garsų šaltinis</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="license noopener">CC BY 3.0</a><br><span>Atrinkti mėginiai, natų aukščio keitimas ir atleidimo gaubtinė.</span></div>'
page = re.sub(r'<div class="sound-credit" hidden>.*?</div>', credit, page)
page = page.replace('<section class="kit" aria-label="Pianinas">', '<section class="kit" aria-label="Pianinas">\n<p class="piano-author">Salamander Grand Piano · Alexander Holm</p>')
(root / 'piano.html').write_text(page, encoding='utf-8')
