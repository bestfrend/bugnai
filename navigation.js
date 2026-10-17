import { ACTIVE_KIT, mountInstrument, suspendInstrument } from './index.js';
import { t, applyPageTranslations } from './i18n.js';

const links = [...document.querySelectorAll('[data-kit-link]')];
const destinations = new Map(links.map(link => [link.dataset.kitLink, new URL(link.href)]));
const templates = new Map();
let requestGeneration = 0;
let pending = false;

function snapshot(doc) {
  return {
    kit: doc.querySelector('.kit').outerHTML,
    credit: doc.querySelector('.sound-credit').outerHTML,
    title: doc.title,
    heading: doc.querySelector('#title').textContent,
    className: doc.body.className
  };
}
templates.set(ACTIVE_KIT, Promise.resolve(snapshot(document)));

function template(id) {
  if (!templates.has(id)) {
    const promise = fetch(destinations.get(id), { signal: AbortSignal.timeout(15000) })
      .then(async response => {
        if (!response.ok) throw new Error('Instrumento įkelti nepavyko.');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (doc.body.dataset.kit !== id) throw new Error('Netinkamas instrumentas.');
        return snapshot(doc);
      }).catch(error => {
        templates.delete(id);
        throw error;
      });
    templates.set(id, promise);
  }
  return templates.get(id);
}

async function navigate(id, push = true) {
  if (!destinations.has(id)) return;
  if (id === ACTIVE_KIT && !pending && document.querySelector('#audio-status').hidden) return;
  const generation = ++requestGeneration;
  pending = true;
  window.dispatchEvent(new Event('instrumentwillchange'));
  suspendInstrument();
  const message = document.querySelector('#audio-status');
  message.hidden = false;
  message.dataset.source = 'Įkeliami garsai…';
  message.textContent = t('Įkeliami garsai…');
  try {
    const page = await template(id);
    if (generation !== requestGeneration) return;
    // Only instrument markup changes; login, profiles and open groups are untouched.
    document.querySelector('.kit').outerHTML = page.kit;
    document.querySelector('.sound-credit').outerHTML = page.credit;
    document.querySelector('#title').textContent = page.heading;
    document.title = page.title;
    document.body.className = page.className;
    document.body.dataset.kit = id;
    applyPageTranslations();
    for (const link of links) {
      if (link.dataset.kitLink === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (push && location.pathname !== destinations.get(id).pathname) {
      history.pushState(null, '', destinations.get(id));
    }
    await mountInstrument(id);
  } catch {
    if (generation !== requestGeneration) return;
    // Keep the current instrument usable after a failed page fetch; never reload login.
    await mountInstrument(ACTIVE_KIT);
    if (generation !== requestGeneration) return;
    const status = document.querySelector('#status');
    status.dataset.source = 'Instrumento įkelti nepavyko. Patikrink internetą ir bandyk dar kartą.';
    status.textContent = t('Instrumento įkelti nepavyko. Patikrink internetą ir bandyk dar kartą.');
    status.classList.add('error');
    // A failed Back/Forward navigation must still show the URL of the visible instrument.
    if (!push) history.replaceState(null, '', destinations.get(ACTIVE_KIT));
  } finally {
    if (generation === requestGeneration) pending = false;
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-kit-link]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  event.preventDefault();
  navigate(link.dataset.kitLink);
});
window.addEventListener('popstate', () => {
  const id = [...destinations].find(([,url]) => url.pathname === location.pathname)?.[0];
  navigate(id || 'classic-v1', false);
});
