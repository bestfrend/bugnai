"""Generate the second page from the shared application markup."""
import pathlib
import re
root = pathlib.Path(__file__).resolve().parents[1]
page = (root / 'index.html').read_text()
page = page.replace('<title>Būgnai</title>', '<title>Virtuosity būgnai</title>')
page = page.replace('<body data-kit="classic-v1">', '<body data-kit="virtuosity-v1" class="studio-kit">')
page = page.replace('data-kit-link="classic-v1" aria-current="page"', 'data-kit-link="classic-v1"')
page = page.replace('data-kit-link="virtuosity-v1"', 'data-kit-link="virtuosity-v1" aria-current="page"')
page = page.replace('id="strength-control" class="strength-control" hidden', 'id="strength-control" class="strength-control"')
page = page.replace('class="sound-credit" hidden', 'class="sound-credit"')
names = {'w':'Aukštas tomas', 'a':'Žemas tomas', 's':'Užd. hi-hat', 'd':'Ride lėkštė', 'j':'Mažasis būgnas', 'k':'Crash lėkštė', 'l':'Bosinis būgnas'}
buttons = '\n'.join(f'          <button type="button" class="{key} drum" data-key="{key}" aria-label="{name}, {key.upper()}"><span class="drum-key">{key}</span><span class="drum-name">{name}</span></button>' for key,name in names.items())
page, count = re.subn(r'<div class="set">.*?</div>', '<div class="set">\n'+buttons+'\n        </div>', page, count=1, flags=re.S)
if count != 1: raise SystemExit('Missing shared drum kit markup')
(root / 'studio.html').write_text(page)
