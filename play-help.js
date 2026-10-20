import { t } from './i18n.js';

const SEQUENCE_SETTING = 'bugnai.lesson-sequence';
export let lessonSequenceVisible = localStorage.getItem(SEQUENCE_SETTING) === 'true';

const toolbar = document.querySelector('.language-switch');
if (toolbar) {
  const menu = document.createElement('details');
  menu.className = 'play-help-menu';
  menu.innerHTML = '<summary><span id="play-help-menu-label"></span></summary><div class="play-help-dropdown"><button id="open-play-help" class="action" type="button" aria-haspopup="dialog" aria-controls="play-help-dialog"></button><label class="play-help-toggle"><input id="show-lesson-sequence" type="checkbox"><span id="lesson-sequence-setting-label"></span></label></div>';
  toolbar.prepend(menu);
  const sequenceToggle = document.getElementById('show-lesson-sequence');
  sequenceToggle.checked = lessonSequenceVisible;
  sequenceToggle.addEventListener('change', () => {
    lessonSequenceVisible = sequenceToggle.checked;
    localStorage.setItem(SEQUENCE_SETTING, String(lessonSequenceVisible));
    window.dispatchEvent(new Event('lessonsequencechange'));
  });

  const dialog = document.createElement('dialog');
  dialog.id = 'play-help-dialog';
  dialog.className = 'play-help-dialog';
  dialog.setAttribute('aria-labelledby', 'play-help-title');
  dialog.innerHTML = '<h2 id="play-help-title"></h2><p id="play-help-intro"></p><ul><li id="play-help-partial"></li><li id="play-help-screenshot"></li></ul><p id="play-help-path" class="hint"></p><p id="play-help-reason" class="hint"></p><form method="dialog"><button id="close-play-help" class="action" type="submit"></button></form>';
  document.body.append(dialog);

  const text = {
    'play-help-menu-label': 'Meniu',
    'lesson-sequence-setting-label': 'Rodyti natų seką mokantis',
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
