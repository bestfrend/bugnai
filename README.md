# būgnų komplektas

## Publikavimas ir versija

GitHub saugykloje pasirinkite **Settings → Pages → Source → GitHub Actions**.
Workflow `Publish versioned drum kit` publikuoja svetainę po kiekvieno push į
`master`. Pirmas paleidimas rodo `1.01`, antras `1.02` ir t. t. Pakartotinai
paleidus tą patį workflow, versija nesikeičia. Numeris žymi publikavimo bandymą:
jei bandymas nepavyksta, svetainėje lieka ankstesnė sėkminga versija.

Versija įrašoma tik į publikuojamą svetainę; automatinių commitų nekuriama.
Vietinėje projekto kopijoje rodomas pradinis `1.01` užrašas.
Workflow numeracija turi būti išsaugota tęsiant tą patį workflow failą.

## Supabase paruošimas

1. Projekto Authentication nustatymuose įjunkite **Anonymous Sign-Ins**.
2. **SQL Editor → New query** paleiskite visą [supabase/schema.sql](supabase/schema.sql).
   Skriptas sukuria `profiles`, `performances`, validavimą ir RLS taisykles; jį galima
   paleisti pakartotinai. SQL nededamas į viešai publikuojamą svetainės katalogą.
3. Viešas projekto URL ir `publishable` raktas yra `supabase-config.js`.
   Tai vieša svetainės konfigūracija; `service_role` ir slapti raktai nenaudojami.
4. Publikuokite tik po lentelių sukūrimo. GitHub Pages workflow įkelia tik programos
   failus, paveikslėlius bei garsus ir prieš publikavimą paleidžia bazės taisyklių testus.
5. Tikroje svetainėje išbandykite dvi atskiras naršykles: abi turi matyti visus
   slapyvardžius ir jų 7 vietas; kiekviena gali keisti ir trinti tik savo įrašus.

Programai nereikia papildomo backend serverio ar build komandos. Paleiskite:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

### Įrašymo taisyklės

- Vardas yra viešas slapyvardis, ne slaptažodis. Tapatybę suteikia Supabase Auth.
  Vienodi slapyvardžiai leidžiami; kitus vartotojus atskiria ID žymė.
- Prisijungimo sesija išsaugoma `localStorage` ir automatiškai atnaujinama.
  Išvalius naršyklės duomenis, prieigos prie senos anoniminės paskyros galima netekti.
- Prisijungę vartotojai mato visus profilius, o išskleidę profilį — jo 7 vietas.
  Sąrašas papildomas po 50 vartotojų; naujus įrašus galima pamatyti atnaujinus sąrašą.
- Įrašomas tik `{key, time}` masyvas: laikas milisekundėmis nuo pirmo smūgio.
  Pirmas smūgis prasideda ties 0, įrašo trukmė baigiasi paskutiniu smūgiu.
- Po 120 sekundžių nuo pirmo smūgio įrašymas automatiškai išsaugomas. Vieno įrašo
  duomenų riba — 6000 smūgių; ją pasiekus taip pat automatiškai išsaugoma.
- Užvėrus ar perkrovus puslapį nebaigtas bandymas atmetamas; juodraščiai nesaugomi.
  Perrašant ankstesnis įrašas lieka iki naujo įrašo išsaugojimo. Paspaudus išsaugojimą
  užklausa jau gali pasiekti bazę, net jei langas uždaromas dar negavus atsakymo.
- Tuščias bandymas neišsaugomas. Nepavykus išsaugoti, galima pakartoti išsaugojimą
  arba atmesti bandymą, kol tas pats langas dar atidarytas.
- Teises ir 7 vietų limitą užtikrina bazė, ne vien sąsajos mygtukai.

### Patikros

Reikalingas Node.js 22 arba naujesnis:

```sh
npm ci --ignore-scripts
npm test
```

`npm test` vykdo schemą izoliuotoje PostgreSQL WASM vykdyklėje (PGlite) su dviem
vartotojų tapatybėmis. Tikrinamos RLS teisės, vietų limitas, duomenų validavimas,
perrašymas ir trynimas. Tai nekeičia tikro Supabase projekto duomenų.

Naršyklės patikroms reikia Chromium:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Testas paleidžia laikiną HTTP serverį ir naudoja izoliuotą Supabase HTTP imitaciją.
Tikrinami pelės ir telefono lietimai, prisijungimas bei jo atnaujinimas, atkūrimas,
2 minučių automatinis išsaugojimas, nesėkmingo išsaugojimo pakartojimas ir nebaigto
bandymo atmetimas. Tikrą Supabase Auth ir PostgREST ryšį reikia patikrinti atskirai.
