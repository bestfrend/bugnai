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

## Administratoriaus panelė

Administravimo panelė atveriama adresu `https://bestfrend.github.io/bugnai/admin.html`. Administratorius įveda privatų
kodą, kuris nėra įrašytas į naršyklės failus. Supabase saugo tik jo `bcrypt` maišą,
be viešos skaitymo teisės.

Panelėje rodomi visi nariai, jų ritmų skaičius ir būsena. Programa atnaujina nario
aktyvumo laiką kas 30 sekundžių; jei atnaujinimo nebuvo 75 sekundes, panelė jį rodo
kaip atsijungusį. Aktyvumo laikas saugomas privačioje lentelėje ir paprastiems
nariams negrąžinamas. Panelė pati atsinaujina kas 5 sekundes.

Įrenginio rūšiai, operacinei sistemai, naršyklei, sesijos pradžiai, apytikslei IP
vietai ir vartotojo patvirtinamoms vienkartinėms tikslioms koordinatėms pridėti
„Supabase SQL Editor“ vieną kartą paleiskite visą
[supabase/member-insights.sql](supabase/member-insights.sql). Apytikslei vietai
naudojama `ipwho.is` HTTPS paslauga; IP adresas programos duomenų bazėje nesaugomas.
Kiekvienas tikslios vietos prašymas ir atsakymas saugomas atskira istorijos eilute.
Jei ankstesnis 10 sekundžių atnaujinimas jau įdiegtas, Supabase SQL Editor paleiskite
visą [supabase/location-no-timeout.sql](supabase/location-no-timeout.sql).
Ji pašalina automatinį galiojimo terminą ir išlaiko ankstesnes patvirtintas koordinates.
Failą galima paleisti pakartotinai. Lentelė rodo paskutinio gauto patvirtinto atsakymo
koordinates ir paklaidą, net jei jo prašymas buvo išsiųstas anksčiau.
Prašyti vietos galima tik aktyviai prisijungusio vartotojo. Prašymas lieka aktyvus,
kol vartotojas atsako arba administratorius jį atšaukia. Naršyklės leidimo lango
programėlė negali uždaryti. Jei vartotojas jau paspaudė „Bendrinti“, jo vėlesnis
sutikimas naršyklės lange išsaugomas ir po administratoriaus atšaukimo. Jei iki
atšaukimo vartotojas nesutiko pradėti bendrinimo, atsakymas nepriimamas.
Lentelėje apytikslė vietovė pagal IP rodoma atskirai nuo vienkartinės vartotojo
bendrintos naršyklės vietos; koordinates galima nukopijuoti arba atverti „Google Maps“.
Naršyklės vieta žymima pagal jos pateiktą paklaidą: iki 100 m – maža paklaida,
virš 100 m – apytikslė vieta. Tai įvertinimas, nes naršyklė tiesiogiai neatskleidžia
vartotojo pasirinktos tikslios ar apytikslės vietos leidimo parinkties.
Vieta renkama su `enableHighAccuracy` ir be naršyklės talpyklos. Jei pirmas matavimas
apytikslis, po jo iki 12 sekundžių laukiama geresnio matavimo, tada išsaugomas vienas
mažiausią paklaidą turintis rezultatas ir matavimai sustabdomi. Vartotojo leidimo
laukimas neribojamas; pati programėlė negali pakeisti telefono vietos nustatymų.

Panelė skiria „Atmesta programėlėje“ nuo „Atmestas naršyklės leidimas“.
Naršyklės atsisakymas taip pat gali reikšti anksčiau užblokuotą leidimą ar įrenginio
vietos privatumo nustatymą; naršyklė nepateikia paties leidimo lango pasirinkimo istorijos.

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

### Antras būgnų puslapis: Virtuosity

Pradinis `index.html` atveria pianiną. Klasikiniai būgnai yra `classic.html`,
o Virtuosity – `studio.html`. Prisijungimas, vartotojų sąrašas ir iki 50 ritmų
biblioteka bendri. `index.html`, `piano.html` ir `studio.html` generuojami iš
`classic.html` šablono su `python3 scripts/build-studio.py`; įrašymo logika ir
stiliai visiems bendri. Pakeitus šabloną, prieš naršyklės testus sugeneruokite
puslapius iš naujo.

Esamame Supabase projekte **SQL Editor** paleiskite
[supabase/drum-kits.sql](supabase/drum-kits.sql). Jis prideda versijuotą `kit` lauką
ir leidžia neprivalomą sveiką smūgio `velocity` nuo 1 iki 127. Senieji `{key,time}`
įrašai lieka klasikiniai; naujam projektui pakanka viso `supabase/schema.sql`.
Kol migracija nepritaikyta, klasikinis formatas dar gali būti saugomas senu būdu,
o Virtuosity bandymą galima pakartotinai išsaugoti tame pačiame lange pritaikius SQL.

Naujas rinkinys naudoja autentiškų Virtuosity Drums overhead mikrofono įrašų
atranką: aukštas ir žemas tomai, uždaras hi-hat, ride, snare, crash ir kick.
Kiekvienam paruošti trys skirtingo stiprumo smūgio mėginiai; MP3 suma apie 1,54 MB.
Tai sumažintas rinkinys telefonams, ne visas originalus SFZ instrumentas su visais
mikrofonais, artikuliacijomis ir round-robin variantais.

Valdiklis „Smūgio stiprumas“ veikia iš karto smūgio pradžioje ir įrašomas kiekvienai
natai. Laikymo trukmė stiprumo nekeičia: būgno smūgis negali laukti būsimo atleidimo.
Seni įrašai grojami pradiniais MP3 ir vienodu pradiniu stiprumu. Perrašymas naudoja
pasirinkto puslapio rinkinį ir tik po patvirtinimo pakeičia seno ritmo duomenis.

Garsų kilmė, CC0 licencija, šaltinio commit, SHA-256 ir paruošimas aprašyti
[sounds/virtuosity-v1/README.md](sounds/virtuosity-v1/README.md) bei `sources.json`.
Paruošti failai saugomi saugykloje, todėl naudojantis svetaine nereikia jokio CDN,
FFmpeg ar SFZ grotuvo. Keisdami patį rinkinį ateityje naudokite naują versijos ID,
kad senų įrašų skambesys nepasikeistų.

### Pianinas telefonui: Salamander · Alexander Holm

Puslapio viršuje galima pasirinkti lietuvių arba švedų kalbą. Pasirinkimas
išsaugomas šioje naršyklėje ir lieka perjungiant instrumentus. Įrašų pavadinimai
rodomi tokie, kokius juos įvedė vartotojai.

`piano.html` turi penkias atskiras 13 klavišų oktavas nuo C2–C3 iki C6–C7.
Po C6–C7 esantis „Pilnas“ režimas viename ekrane sutalpina visą turimą C2–C7
diapazoną (61 natą), todėl telefone klavišai labai siauri. Kiekvienas įrašas saugo
tikrą natos aukštį. Vienu metu galima liesti kelis klavišus; kompiuteryje naudojami
A W S E D F T G Y H U J K, „Pilnas“ režime jie valdo vidurinę C4–C5 oktavą. Pointer capture užtikrina atleidimą ir pirštą
pakėlus už klavišo ribų; atšauktas lietimas, prarastas lango fokusas ir paslėptas
puslapis taip pat atleidžia natas. Stiprumo slankiklis keičia garsumą, ne laikymo
trukmę. Laikymas valdo natos trukmę, atleidimas turi 180 ms slopimo gaubtinę.

Autorius **Alexander Holm**, **Salamander Grand Piano**, licencija **CC BY 3.0**.
Autorius, šaltinis, licencija ir pritaikymo aprašymas matomi puslapyje. 21
nepakeisti MP3 iš prisegtos Tone.js audio saugyklos versijos sudaro apie 1,4 MB;
tarpinės natos atkuriamos keičiant aukštį iki dviejų pustonių. Tai vienas dinamikos
sluoksnis, be pedalų ir pilno SFZ rezonansų modelio. Ilgai laikoma nata natūraliai
nutyla pasibaigus mėginiui. Kilmė ir SHA-256: `sounds/salamander-v1/sources.json`;
originalus autoriaus pranešimas: `sounds/salamander-v1/README`;
naudojimas ir pakeitimai: `sounds/salamander-v1/ATTRIBUTION.md`.

Esamame Supabase projekte po ankstesnio `piano.sql` SQL Editor paleiskite
**`supabase/piano-octaves.sql`**. Migracija
prideda `salamander-v1` ir pianino natų `{key,time,velocity,length}` validavimą,
išlaikydama senus būgnų įrašus ir savininko teises. Trukmė baigiasi paskutinės natos
atleidimu, ne paskutinės natos pradžia; akordų atleidimai gali persidengti. Iki
migracijos pianino išsaugojimas rodo konkretų SQL failą ir išlaiko bandymą
pakartotiniam išsaugojimui. Naujam projektui pakanka viso `schema.sql`.

Visų trijų instrumentų prisijungimas ir 50 įrašų limitas bendri. Pianino įrašas
atkuriamas pianinu ir būgnų puslapyje. `python3 scripts/build-studio.py` generuoja
kitus tris puslapius iš bendro `classic.html`; GitHub Actions tai atlieka prieš
publikuodamas ir visiems instrumentų puslapiams suteikia tą pačią versiją.

### Skirtukai be puslapio perkrovimo

`navigation.js` perjungia instrumentus tame pačiame dokumente. Iš esamų statinių
puslapių paimama tik instrumento sritis, pavadinimas ir garsų autorystės eilutė;
šablonai ir dekoduoti garsai laikomi atmintyje. Prisijungimas, narių sąrašas,
išskleistos grupės ir periodinis atnaujinimas lieka aktyvūs. `pushState` ir
`popstate` išlaiko esamus adresus bei naršyklės „Atgal“ / „Pirmyn“ veikimą.
Tiesioginės nuorodos ir atidarymas naujame skirtuke veikia kaip anksčiau.

Pasirinkus kitą instrumentą sustabdomas atkūrimas, atleidžiamos laikomos natos,
atmetamas nepatvirtintas bandymas ir išvalomi jo tylos / dviejų minučių laikmačiai.
Perjungimas nesukelia `pagehide`, todėl neišsaugo juodraščio į avarinį pirmą slotą.
Vartotojo jau patvirtinta, vykdoma išsaugojimo užklausa užbaigiama įprastai.
Garsų krovimo metu klavišai neaktyvūs; nepavykus įkelti šablono lieka ankstesnis
instrumentas ir galimybė bandyti dar kartą be naujo prisijungimo.
Supabase pakeitimų šiam atnaujinimui nereikia.
