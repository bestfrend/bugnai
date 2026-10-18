const STORAGE_KEY = 'bugnai.language';
const swedish = {
  'Instrumentai': 'Instrument', 'Pianinas · Salamander': 'Piano · Salamander',
  'Klasikiniai būgnai': 'Klassiska trummor', 'Virtuosity būgnai': 'Virtuosity-trummor',
  'Būgnų 🥁 komplektas': 'Trumset 🥁', 'Salamander pianinas': 'Salamanderpiano',
  'Būgnai': 'Trummor',
  'Jungiamasi…': 'Ansluter…', 'Įvesk vardą': 'Ange ditt namn',
  'Vardas': 'Namn',
  'Pradėti groti': 'Börja spela',
  'Įkelti arba pakeisti profilio nuotrauką': 'Ladda upp eller ändra profilbild',
  'Įkelti arba pakeisti nuotrauką': 'Ladda upp eller ändra bild',
  'Dukart paspausk, kad tvarkytum nuotrauką': 'Dubbeltryck för att hantera bilden',
  'Pašalinti profilio nuotrauką': 'Ta bort profilbild', 'Pašalinti nuotrauką': 'Ta bort bild',
  'Įrašymo valdymas': 'Inspelningskontroller', 'Įrašyti': 'Spara',
  'Išsaugoti dar kartą': 'Försök spara igen', 'Pakartoti bandymą': 'Spela in igen',
  'Išeiti': 'Avsluta', 'Paliesk būgnus arba grok klavišais W A S D J K L.': 'Tryck på trummorna eller spela med tangenterna W A S D J K L.',
  'Įkeliami būgnų garsai…': 'Laddar trumljud…', 'Įkeliami pianino garsai…': 'Laddar pianoljud…',
  'Įkeliami garsai…': 'Laddar ljud…', 'Stabdyti atkūrimą': 'Stoppa uppspelning',
  'Mūsų ritmai': 'Våra rytmer', 'Kitų įrašus galite tik paklausyti.': 'Du kan lyssna på andras inspelningar, men bara ändra dina egna.',
  'Rodyti daugiau vartotojų': 'Visa fler användare', 'Šiai programai reikia įjungti JavaScript.': 'JavaScript måste vara aktiverat för den här appen.',
  'Ritmo pavadinimas': 'Namn på rytmen', 'Pavadinimas': 'Namn',
  'Išsaugoti pavadinimą': 'Spara namnet', 'Atšaukti': 'Avbryt',
  'Kurta su ❤️ Londone': 'Skapad med ❤️ i London', 'Versija': 'Version',
  'Garsai: Virtuosity Drums · CC0': 'Ljud: Virtuosity Drums · CC0',
  'Garsų šaltinis': 'Ljudkälla', 'Atrinkti mėginiai, natų aukščio keitimas ir atleidimo gaubtinė.': 'Utvalda ljudprover, tonhöjdsändring och avklingning.',
  'Pianino aukščio pasirinkimas': 'Välj oktav', 'Žemesni garsai': 'Lägre toner',
  'Aukštesni garsai': 'Högre toner', 'Pilnas pianinas': 'Alla tillgängliga pianotangenter',
  'Žemiau': 'Lägre', 'Aukščiau': 'Högre', 'Pilnas': 'Alla',
  'Pianino klavišai': 'Pianots tangenter', 'klavišas': 'tangent',
  'Vidurinė dalis': 'Mellanregistret', 'Pianinas': 'Piano',
  'Pirmas tomas': 'Tom 1', 'Antras tomas': 'Tom 2', 'Trečias tomas': 'Tom 3',
  'Ketvirtas tomas': 'Tom 4', 'Mažasis būgnas': 'Virveltrumma',
  'Lėkštė': 'Cymbal', 'Bosinis būgnas': 'Bastrumma',
  'Aukštas tomas': 'Hög tom-tom', 'Žemas tomas': 'Låg tom-tom',
  'Užd. hi-hat': 'Stängd hi-hat', 'Ride lėkštė': 'Ridecymbal', 'Crash lėkštė': 'Crashcymbal',
  'Ritmas': 'Rytm', 'ritmų': 'rytmer', 'ritmai': 'rytmer',
  'Dar nėra išsaugotų ritmų.': 'Du har inte sparat några rytmer än.', 'Dar nėra ritmų.': 'Det finns inga rytmer än.',
  'Perklausa': 'Förhandslyssning', 'Bandymas': 'Nytt försök',
  'Atkurti': 'Spela upp', 'Perrašyti': 'Spela in igen', 'Ištrinti': 'Ta bort',
  'Pervadinti': 'Byt namn', 'Labas': 'Hej', 'Išsaugotas ritmas': 'Rytmen har sparats',
  'Jį gali perklausyti visi prisijungę vartotojai.': 'Alla inloggade användare kan lyssna på den.',
  'Ištrinti ritmą': 'Radera rytmen',
  'Klasikiniai': 'Klassiska trummor', 'Virtuosity': 'Virtuosity-trummor',
  'Do': 'C', 'Do♯': 'C♯', 'Re': 'D', 'Re♯': 'D♯', 'Mi': 'E',
  'Fa': 'F', 'Fa♯': 'F♯', 'Sol': 'G', 'Sol♯': 'G♯', 'La': 'A',
  'La♯': 'A♯', 'Si': 'B',
  'Sukurta': 'Skapad', 'Paskutinis žinomas atnaujinimas': 'Senaste kända uppdatering',
  'Įkeliami grojimai…': 'Laddar inspelningar…', 'Bandyti dar kartą': 'Försök igen',
  'Laukiama pirmo smūgio': 'Väntar på att du börjar spela', 'Įrašoma': 'Spelar in',
  'Pabaiga': 'Inspelningen är klar', 'Išsaugoma…': 'Sparar…', 'Nepavyko išsaugoti': 'Det gick inte att spara',
  'Atnaujinti': 'Uppdatera', 'Įrašyti į': 'Spara i',
  'Vietos bendrinimo prašymas': 'Begäran om platsdelning',
  'Administratorius prašo vieną kartą gauti dabartinę jūsų vietą. Patvirtinus naršyklė dar paprašys vietos leidimo. Nuolatinis sekimas nebus įjungtas.': 'Administratören vill se var du befinner dig just nu. Om du godkänner frågar webbläsaren också om tillåtelse. Platsen delas bara en gång och spåras inte löpande.',
  'Bendrinti dabartinę vietą': 'Dela aktuell plats', 'Atmesti': 'Avvisa',
  'Ši naršyklė nepalaiko vietos nustatymo.': 'Den här webbläsaren stöder inte platsbestämning.',
  'Pasiektas 50 ritmų limitas. Gali perrašyti arba ištrinti vieną iš savo ritmų.': 'Gränsen på 50 rytmer har nåtts. Spela in igen eller ta bort en av dina rytmer.',
  'Pavadinimas turi būti nuo 1 iki 60 simbolių.': 'Namnet måste vara 1–60 tecken långt.',
  'Ritmo pavadinimas išsaugotas.': 'Namnet har sparats.',
  'Pasirink JPG, PNG arba WebP nuotrauką iki 5 MB.': 'Välj en JPG-, PNG- eller WebP-bild på högst 5 MB.',
  'Nepavyko perskaityti nuotraukos. Pasirink kitą JPG, PNG arba WebP failą.': 'Kunde inte läsa bilden. Välj en annan JPG-, PNG- eller WebP-fil.',
  'Nuotrauka per didelė. Pasirink mažesnę.': 'Bilden är för stor. Välj en mindre.',
  'Nuotrauka išsaugota.': 'Bilden har sparats.', 'Nuotrauka pašalinta.': 'Bilden har tagits bort.',
  'Grok naują bandymą. Senas ritmas liks, kol nepatvirtinsi pakeitimo.': 'Spela in ett nytt försök. Den gamla inspelningen finns kvar tills du bekräftar ändringen.',
  'Įrašymas prasidėjo nuo pirmo smūgio.': 'Inspelningen startade när du började spela.',
  'Tuščias bandymas neišsaugotas. Ankstesnis grojimas nepakeistas.': 'Den tomma inspelningen sparades inte. Den tidigare inspelningen finns kvar.',
  'Pasirink: atnaujinti ritmą, pakartoti bandymą arba išeiti.': 'Välj att uppdatera rytmen, spela in igen eller avsluta.',
  'Pasirink: išsaugoti ritmą, pakartoti bandymą arba išeiti.': 'Välj att spara rytmen, spela in igen eller avsluta.',
  'Gali išsaugoti dar kartą arba pakartoti bandymą.': 'Du kan försöka spara igen eller spela in på nytt.',
  'Bandymas pradėtas iš naujo. Įrašymas prasidės nuo pirmo smūgio.': 'Redo för ett nytt försök. Inspelningen börjar när du spelar.',
  'Bandymas atmestas. Ankstesni įrašai nepakeisti.': 'Försöket avbröts. Tidigare inspelningar är kvar.',
  'Ritmas ištrintas. Gali sukurti naują.': 'Inspelningen har tagits bort. Du kan skapa en ny.',
  'Nepavyko paleisti garso. Paliesk būgną ir bandyk atkurti dar kartą.': 'Det gick inte att spela upp ljudet. Tryck på en tangent eller trumma och försök igen.',
  'Nebaigtas bandymas atmestas. Pasirinktas kitas instrumentas.': 'Det oavslutade försöket avbröts när du bytte instrument.',
  'Prisijungimas šiame įrenginyje pasikeitė. Perkrauk puslapį.': 'Inloggningen på den här enheten har ändrats. Ladda om sidan.',
  'Instrumento įkelti nepavyko. Patikrink internetą ir bandyk dar kartą.': 'Kunde inte ladda instrumentet. Kontrollera anslutningen och försök igen.',
  'Nepavyko įkelti būgnų garsų.': 'Kunde inte ladda instrumentljuden.',
  'Garsų įkelti nepavyko. Patikrink internetą ir dar kartą pasirink instrumentą.': 'Kunde inte ladda ljuden. Kontrollera anslutningen och välj instrumentet igen.',
  'Nepavyko pasiekti duomenų bazės. Patikrink internetą ir bandyk dar kartą.': 'Kunde inte nå databasen. Kontrollera anslutningen och försök igen.',
  'Veiksmas nepavyko. Bandyk dar kartą.': 'Åtgärden misslyckades. Försök igen.',
  'Duomenų bazė dar neparuošta. Reikia paleisti projekto schema.sql Supabase SQL Editor.': 'Databasen är inte klar. Kör projektets schema.sql i Supabase SQL Editor.',
  'Pianino įrašams Supabase SQL Editor paleisk piano.sql.': 'Kör piano.sql i Supabase SQL Editor för pianoinspelningar.',
  'Antram būgnų rinkiniui Supabase SQL Editor paleisk drum-kits.sql.': 'Kör drum-kits.sql i Supabase SQL Editor för det andra trumsetet.',
  'Duomenų bazę reikia atnaujinti pagal naujausią Supabase SQL papildymą.': 'Databasen måste uppdateras med den senaste Supabase SQL-migreringen.',
  'Papildomoms pianino oktavoms Supabase SQL Editor paleisk piano-octaves.sql.': 'Kör piano-octaves.sql i Supabase SQL Editor för fler pianooktaver.',
  'Šią vietą jau užėmė įrašas kitame lange. Ankstesnis ritmas nepakeistas.': 'Platsen upptas redan av en inspelning i ett annat fönster. Den tidigare rytmen är kvar.',
  'Supabase nustatymuose reikia įjungti anoniminį prisijungimą.': 'Aktivera anonym inloggning i Supabase.',
  'Per daug bandymų. Palauk ir bandyk dar kartą.': 'För många försök. Vänta och försök igen.',
  'Prisijungimas arba prieiga nebegalioja. Perkrauk puslapį ir bandyk dar kartą.': 'Inloggningen har gått ut. Ladda om sidan och försök igen.',
  'Prisijunk įvesdamas vardą.': 'Logga in med ett namn.',
  'Įvesk vardą nuo 1 iki 24 simbolių.': 'Ange ett namn på 1–24 tecken.',
  'Šis anoniminis prisijungimas nebegalioja. Perkrauk puslapį, kad prisijungtum iš naujo.': 'Den anonyma inloggningen har gått ut. Ladda om sidan och logga in igen.',
  'Ritmas kitame lange jau pašalintas. Atmesk bandymą ir sukurk naują ritmą.': 'Rytmen har redan tagits bort i ett annat fönster. Avbryt försöket och skapa en ny rytm.',
  'Šis ritmas kitame lange jau pašalintas.': 'Den här rytmen har redan tagits bort i ett annat fönster.'
};

export let language = localStorage.getItem(STORAGE_KEY) === 'sv' ? 'sv' : 'lt';
export function t(text) { return language === 'sv' ? swedish[text] || text : text; }
export function setLanguage(next) {
  if (next !== 'lt' && next !== 'sv') return;
  language = next;
  localStorage.setItem(STORAGE_KEY, next);
  applyPageTranslations();
  window.dispatchEvent(new Event('languagechange'));
}

const staticText = {
  '[data-kit-link="salamander-v1"]': 'Pianinas · Salamander',
  '[data-kit-link="classic-v1"]': 'Klasikiniai būgnai',
  '[data-kit-link="virtuosity-v1"]': 'Virtuosity būgnai',
  '#login-title': 'Įvesk vardą',
  '#login-form label': 'Vardas',
  '#remove-avatar': 'Pašalinti nuotrauką',
  '.kit > .hint:not(#audio-status)': 'Paliesk būgnus arba grok klavišais W A S D J K L.',
  '#stop-playback': 'Stabdyti atkūrimą',
  '#community-title': 'Mūsų ritmai',
  '.community > .hint': 'Kitų įrašus galite tik paklausyti.',
  '#more-users': 'Rodyti daugiau vartotojų',
  '#rename-heading': 'Ritmo pavadinimas',
  '#rename-form label': 'Pavadinimas',
  '#save-title': 'Išsaugoti pavadinimą',
  '#cancel-title': 'Atšaukti',
  '#location-request-title': 'Vietos bendrinimo prašymas',
  '#location-request-dialog > p:first-of-type': 'Administratorius prašo vieną kartą gauti dabartinę jūsų vietą. Patvirtinus naršyklė dar paprašys vietos leidimo. Nuolatinis sekimas nebus įjungtas.',
  'footer > div:first-child': 'Kurta su ❤️ Londone',
  '.sound-credit a[href*="LICENSE"]': 'Garsai: Virtuosity Drums · CC0',
  '.piano-credit a[href*="github.com"]': 'Garsų šaltinis',
  '.piano-credit span': 'Atrinkti mėginiai, natų aukščio keitimas ir atleidimo gaubtinė.'
};

function setText(element, source) {
  if (!element) return;
  const label = element.querySelector('.button-label');
  if (label) label.textContent = t(source);
  else element.textContent = t(source);
}

export function applyPageTranslations() {
  document.documentElement.lang = language;
  const select = document.getElementById('language-select');
  if (select) {
    select.value = language;
    select.setAttribute('aria-label', 'Language');
  }
  document.querySelector('.kit-tabs')?.setAttribute('aria-label', t('Instrumentai'));
  const nickname = document.getElementById('nickname');
  if (nickname) nickname.placeholder = t('Įvesk vardą');
  const upload = document.getElementById('upload-avatar');
  if (upload) {
    upload.title = t('Įkelti arba pakeisti nuotrauką');
    upload.setAttribute('aria-label', t('Įkelti arba pakeisti profilio nuotrauką'));
  }
  const welcome = document.getElementById('welcome-name');
  if (welcome) welcome.title = t('Dukart paspausk, kad tvarkytum nuotrauką');
  for (const [selector, source] of Object.entries(staticText)) setText(document.querySelector(selector), source);
  const kit = document.body.dataset.kit;
  const title = kit === 'salamander-v1' ? 'Salamander pianinas' : 'Būgnų 🥁 komplektas';
  setText(document.getElementById('title'), title);
  document.title = t(kit === 'salamander-v1' ? 'Salamander pianinas' : kit === 'virtuosity-v1' ? 'Virtuosity būgnai' : 'Būgnai');
  const version = document.querySelector('.version');
  if (version?.firstChild?.nodeType === Node.TEXT_NODE) version.firstChild.textContent = t('Versija') + ' ';
  for (const button of document.querySelectorAll('.action[data-i18n-source], .avatar-remove[data-i18n-source]')) {
    setText(button, button.dataset.i18nSource);
  }
  const status = document.getElementById('status');
  if (status) status.textContent = t(status.dataset.source || '');
  document.getElementById('recording-bar')?.setAttribute('aria-label', t('Įrašymo valdymas'));
  document.getElementById('remove-avatar')?.setAttribute('aria-label', t('Pašalinti profilio nuotrauką'));
  const kitSection = document.querySelector('.kit');
  if (kitSection) kitSection.setAttribute('aria-label', t(document.body.dataset.kit === 'salamander-v1' ? 'Pianinas' : 'Būgnai'));
  for (const drum of document.querySelectorAll('.drum')) {
    drum.dataset.ariaSource ||= drum.getAttribute('aria-label') || '';
    const [name, key] = drum.dataset.ariaSource.split(', ');
    if (name && key) drum.setAttribute('aria-label', `${t(name)}, ${key}`);
    const drumName = drum.querySelector('.drum-name');
    if (drumName) {
      drumName.dataset.source ||= drumName.textContent;
      drumName.textContent = t(drumName.dataset.source);
    }
  }
  const audio = document.getElementById('audio-status');
  if (audio) audio.textContent = t(audio.dataset.source || (document.body.dataset.kit === 'salamander-v1' ? 'Įkeliami pianino garsai…' : 'Įkeliami būgnų garsai…'));
  const octaveControls = document.querySelector('.piano-octave-controls');
  if (octaveControls) octaveControls.setAttribute('aria-label', t('Pianino aukščio pasirinkimas'));
  const lowerButton = document.querySelector('[data-octave-shift="-1"]');
  if (lowerButton) lowerButton.setAttribute('aria-label', t('Žemesni garsai'));
  const higherButton = document.querySelector('[data-octave-shift="1"]');
  if (higherButton) higherButton.setAttribute('aria-label', t(higherButton.querySelector('.piano-button-label')?.dataset.source === 'Pilnas' ? 'Pilnas pianinas' : 'Aukštesni garsai'));
  const octave = document.getElementById('piano-octave-label');
  if (octave) octave.textContent = t(octave.dataset.source || 'Vidurinė dalis') + (octave.dataset.range ? ` · ${octave.dataset.range}` : ' · C4–C5');
  const lower = document.querySelector('[data-octave-shift="-1"] .piano-button-label');
  if (lower) lower.textContent = t('Žemiau');
  const higher = document.querySelector('[data-octave-shift="1"] .piano-button-label');
  if (higher) higher.textContent = t(higher.dataset.source || 'Aukščiau');
}
