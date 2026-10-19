import { t } from './i18n.js';

const toolbar = document.querySelector('.language-switch');
if (toolbar) {
  const menu = document.createElement('details');
  menu.className = 'play-help-menu';
  menu.innerHTML = '<summary><span id="play-help-menu-label"></span></summary><div class="play-help-dropdown"><button id="open-play-help" class="action" type="button" aria-haspopup="dialog" aria-controls="play-help-dialog"></button></div>';
  toolbar.prepend(menu);

  const dialog = document.createElement('dialog');
  dialog.id = 'play-help-dialog';
  dialog.className = 'play-help-dialog';
  dialog.setAttribute('aria-labelledby', 'play-help-title');
  dialog.innerHTML = '<h2 id="play-help-title"></h2><p id="play-help-intro"></p><ul><li id="play-help-partial"></li><li id="play-help-screenshot"></li></ul><p id="play-help-path" class="hint"></p><p id="play-help-reason" class="hint"></p><form method="dialog"><button id="close-play-help" class="action" type="submit"></button></form>';
  document.body.append(dialog);

  const text = {
    'play-help-menu-label': 'Meniu',
    'open-play-help': 'Prieš grojant',
    'play-help-title': 'Prieš grojant',
    'play-help-intro': 'Jei groji keliais pirštais, įrenginio nustatymuose išjunk šiuos gestus, jei jie įjungti:',
    'play-help-partial': 'Dalinę ekrano kopiją laikant tris pirštus.',
    'play-help-screenshot': 'Ekrano kopiją braukiant trimis pirštais žemyn.',
    'play-help-path': 'Nustatymuose ieškok „Gestai“ arba „Ekrano kopija“. Pavadinimai priklauso nuo įrenginio.',
    'play-help-reason': 'Šie sistemos gestai gali perimti prisilietimus ir nutraukti natas.',
    'close-play-help': 'Uždaryti'
  };
  const translate = () => {
    for (const [id, source] of Object.entries(text)) document.getElementById(id).textContent = t(source);
  };
  translate();
  window.addEventListener('languagechange', translate);
  document.getElementById('open-play-help').addEventListener('click', () => {
    menu.open = false;
    dialog.showModal();
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') menu.open = false;
  });
}
