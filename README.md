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
   slapyvardžius ir išsaugotus ritmus; kiekviena gali keisti ir trinti tik savo įrašus.

Programai nereikia papildomo backend serverio ar build komandos. Paleiskite:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

### Įrašymo taisyklės

- Vardas yra viešas slapyvardis, ne slaptažodis. Tapatybę suteikia Supabase Auth.
  Vienodi slapyvardžiai leidžiami; tapatybę atskiria Supabase vartotojo ID.
- Prisijungimo sesija išsaugoma `localStorage` ir automatiškai atnaujinama.
  Išvalius naršyklės duomenis, prieigos prie senos anoniminės paskyros galima netekti.
- Prisijungę vartotojai mato visus profilius, o išskleidę profilį — tik išsaugotus ritmus.
  Viršuje, šalia savo profilio, mygtukas „Sukurti ritmą“ pradeda naują bandymą; kortelė atsiranda
  tik sėkmingai išsaugojus. Vienam vartotojui leidžiama iki 50 ritmų.
  Sąrašas papildomas po 50 vartotojų ir atnaujinamas kas 30 sekundžių. Atvertos grupės
  išlieka atvertos, vykstantis įrašymas nenutraukiamas. Sugrįžus į naršyklės kortelę,
  sąrašas atnaujinamas iš karto; užvertos grupės atnaujinamos jas išskleidus.
- Įrašomas tik `{key, time}` masyvas: laikas milisekundėmis nuo pirmo smūgio.
  Pirmas smūgis prasideda ties 0, įrašo trukmė baigiasi paskutiniu smūgiu.
- Po 120 sekundžių nuo pirmo smūgio arba pasiekus 6000 smūgių ribą įrašymas baigiamas.
  Naujas ritmas automatiškai išsaugomas. Perrašomas ritmas pirmiausia pateikiamas
  perklausai: „Perklausyti bandymą“, „Atnaujinti ritmą“ arba „Pakartoti bandymą“.
  „Baigti“ perrašymo metu taip pat atveria šią perklausą. Senas ritmas pakeičiamas
  tik paspaudus „Atnaujinti ritmą“ ir sėkmingai išsaugojus.
- Užvėrus ar perkrovus puslapį nebaigtas bandymas atmetamas; juodraščiai nesaugomi.
  Perrašant ankstesnis įrašas lieka iki naujo įrašo išsaugojimo. Paspaudus išsaugojimą
  užklausa jau gali pasiekti bazę, net jei langas uždaromas dar negavus atsakymo.
- Tuščias bandymas neišsaugomas. Nepavykus išsaugoti, galima pakartoti išsaugojimą
  arba pakartoti grojimą, kol tas pats langas dar atidarytas.
- „Pakartoti bandymą“ išvalo tik laikiną smūgių seką ir laikmatį, sustabdo perklausą
  ir pradeda naują bandymą tame pačiame ritme. Ankstesnis išsaugotas ritmas nepakeičiamas.
- Teises ir 50 ritmų limitą užtikrina bazė, ne vien sąsajos mygtukai.
  Pasiekus limitą, galima perrašyti arba ištrinti savo ritmą. Naujo ritmo įrašymas
  nepakeičia kito įrašo, net jei ta pati vieta užimama kitame naršyklės lange.
- Pavadinimą (1–60 simbolių) galima pakeisti dukart paspaudus savo kortelę arba
  sufokusavus jos pavadinimą ir paspaudus Enter ar tarpo klavišą. Atskiro pervadinimo
  mygtuko nėra. Kitų vartotojų pavadinimų keisti negalima.
- Kompaktiškoje kortelėje atkūrimo mygtukas yra kairėje prie pavadinimo. Ritmų
  sąrašas turi atskirą slinkimo sritį, kurios pozicija išlaikoma atnaujinant duomenis.

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

### Profilio nuotraukos

Anksčiau paruoštame projekte **SQL Editor** paleiskite papildomą
[supabase/avatars.sql](supabase/avatars.sql). Naujame projekte pakanka viso
`supabase/schema.sql` — nuotraukų pakeitimai jau įtraukti.

Savo profiliui galima pasirinkti JPG, PNG ar WebP failą iki 5 MB. Naršyklė iškerpa
centrinį kvadratą ir sumažina jį iki 128 × 128 JPEG. Maža nuotrauka saugoma tiesiogiai
profilio `avatar_data` lauke (iki 32 KB), todėl papildomo Storage bucket nereikia.
Duomenų bazė leidžia keisti tik savo nuotrauką; kiti profilio laukai nepakeičiami.
Nuotraukas mato tik prisijungę vartotojai. Nepasirinkus nuotraukos, apskritime rodoma
slapyvardžio pirmoji raidė. Smūgių masyvas lieka įrašo duomenyse ir sąsajoje nerodomas.
Nuotrauka įkeliama paspaudus savo avatarą. Jos pašalinimo užrašas atsiranda tik
dukart paspaudus vardą; paspaudus kitur ar perkėlus fokusą į kitą elementą pasislepia.
Klaviatūra pašalinimą taip pat galima atverti aktyvavus vardo mygtuką.

### Atnaujinimas nuo 7 iki 50 ritmų

Jau veikiančiame projekte Supabase **SQL Editor** paleiskite
[supabase/recordings-50.sql](supabase/recordings-50.sql). Jis išplečia leistinų
įrašų vietų ribą ir prideda pavadinimą, išsaugodamas ankstesnius įrašus.
Esami ritmai be pavadinimo rodomi kaip „Ritmas 1“, „Ritmas 2“ ir t. t.
Naujame projekte pakanka viso atnaujinto `supabase/schema.sql`.

### Ritmo data

Po atkūrimo mygtuku rodoma maža data formatu `2026.10.15`, vartotojo naršyklės
laiko juostoje. Jau veikiančiame projekte Supabase SQL Editor paleiskite
[supabase/creation-date.sql](supabase/creation-date.sql). Naujiems ritmams bazė pati
priskiria `created_at` ir išlaiko ją pervadinant ar perrašant įrašą.

Senų ritmų tikra sukūrimo data anksčiau nebuvo saugoma, todėl migracija panaudoja
paskutinę žinomą `updated_at` datą, nekeisdama įrašų ar jų atnaujinimo laiko.
Iki migracijos programa rodo turimą atnaujinimo datą su tai paaiškinančiu tooltip.
Naujam projektui pakanka viso `supabase/schema.sql`.
