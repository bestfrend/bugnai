# Instrumentų garsų peržiūra — 2026-10-15

## Dabartinė programa

`index.js` iš tiesų įkelia ir naudoja visus septynis `sounds/` MP3 failus:

| Klavišas | Failas | Trukmė |
| --- | --- | --- |
| W | tom-1.mp3 | 1,429 s |
| A | tom-2.mp3 | 2,265 s |
| S | tom-3.mp3 | 1,847 s |
| D | tom-4.mp3 | 1,781 s |
| J | snare.mp3 | 1,644 s |
| K | crash.mp3 | 2,160 s |
| L | kick-bass.mp3 | 0,098 s |

Trukmės ir formatas patikrinti `ffprobe`: visi yra MP3, 44,1 kHz, stereo,
128 kbit/s. Naršyklėje jie dekoduojami į Web Audio buferius; yra ir HTML Audio
atsarginis kelias. Garsai atkuriami iš failų, nesintezuojami programoje.

Kiekvienam būgnui yra tik vienas smūgis: nėra atskirų silpno / stipraus smūgio
įrašų, kelių pakaitinių įrašų ar pilno rinkinio su hi-hat ir ride lėkštėmis.
MP3 formatas pats savaime neįrodo prastos ar profesionalios kokybės. Failuose
nerasta autoriaus žymų, o projekto dokumentacijoje nenurodyta jų kilmė ar licencija.
Negalima nustatyti, ar originalai įrašyti nuo akustinio būgno, ar sukurti sinteze.
Ši peržiūra patvirtina failus, jų naudojimą ir šaltinių dokumentaciją; naujų
bibliotekų subjektyvi garso kokybė dar nelyginta klausant vienodomis sąlygomis.

## Patikrinti alternatyvų šaltiniai

### Būgnai: Virtuosity Drums

- Šaltinis: https://github.com/sfzinstruments/virtuosity_drums
- Licencija: https://github.com/sfzinstruments/virtuosity_drums/blob/master/LICENSE
- Licencija yra **CC0 1.0**.
- Tikro šiuolaikinio džiazo būgnų rinkinio įrašai, būgnininkas Austin McMahon,
  šešios mikrofonų pozicijos. Tinka ir kitų stilių bandymams, bet skambesį reikia
  rinktis perklausius — tai nėra automatiškai universalus roko rinkinys.
- Yra įvairūs snare smūgiai, tomai, atviras / uždaras / pedalu grojamas hi-hat,
  ride, crash ir papildoma perkusija.
- Tai SFZ biblioteka su garso įrašais. Į dabartinę svetainę jos negalima tiesiog
  prijungti kaip JavaScript failo: reikėtų atrinkti įrašus, paruošti mažą rinkinį
  ir perkelti reikiamus garso sluoksnių bei natų atvaizdavimus į Web Audio grotuvą.

### Alternatyvūs būgnai: AVL Drumkits

- Grotuvas ir rinkinių failai: https://github.com/x42/avldrums.lv2
- Būtent garsų licencija (atskirai nuo grotuvo GPL):
  https://github.com/x42/avldrums.lv2/blob/master/sf2/README
- Rinkiniai apima Black Pearl, Red Zeppelin ir Blonde Bop.
- Garsams taikoma **CC BY-SA 3.0** su nurodyta išimtimi: sukurtą muziką galima
  licencijuoti laisvai; modifikuotų garsų ar naujų bibliotekų platinimui galioja
  share-alike ir atribucijos sąlygos. Modifikuota biblioteka turi turėti kitą vardą.
- Dabartinei svetainei reikėtų paruošti konkrečius garsus iš SF2 / SFZ rinkinio.

### Pianinas: Salamander Grand Piano v3

- Šaltinis ir aprašyta licencija:
  https://github.com/sfzinstruments/SalamanderGrandPiano
- Alexander Holm įrašai: **48 kHz / 24 bit**, **16 smūgio stiprumo sluoksnių**,
  atskiri mechanikos / atleidimo / rezonanso garsai.
- **CC BY 3.0** — reikia nurodyti autorių, licenciją ir atliktus pakeitimus.
- Ši konkreti SFZ versija naudoja ARIA papildymus; pilnos jos funkcijos nėra
  savaime palaikomos naršyklėje ar paprastame Tone.js Sampler.
- Telefonui pirmiausia verta paruošti pasirinktą klavišų diapazoną ir dalį sluoksnių,
  įkeliant tik pasirinktą instrumentą. Toks supaprastinimas neatkartos visų SFZ savybių.

### Akordeonas ir daugiau instrumentų: FluidR3_GM

- Paruoštų naršyklei garsų katalogas ir licencijos:
  https://github.com/gleitz/midi-js-soundfonts
- Instrumentų sąrašas:
  https://github.com/gleitz/midi-js-soundfonts/blob/gh-pages/FluidR3_GM/names.json
- Tikrai yra `accordion`, `tango_accordion`, `acoustic_grand_piano`, elektriniai
  pianinai, gitaros, bosas, styginiai ir pučiamieji.
- Katalogo dokumentacijoje FluidR3 nurodyta **CC BY 3.0**. Musyng Kite ir FatBoy
  licencijos tame pačiame kataloge kitokios — **CC BY-SA 3.0**.
- Patikrinti realūs failai: `FluidR3_GM/accordion-mp3.js` (apie 3,0 MB) ir
  `FluidR3_GM/acoustic_grand_piano-mp3.js` (apie 2,6 MB) pasiekiami saugykloje.
  Tai instrumentų natų MP3 duomenys JavaScript formatu, ne šiuolaikinis atskiras
  grotuvas. Galima paruošti paprastus mėginių žemėlapius mūsų Web Audio grotuvui.
- Tai praktiškas būdas prototipuoti akordeoną, tačiau katalogo turėjimas savaime
  nereiškia koncertinio ar konkretaus tradicinio lietuviško akordeono skambesio.

### Papildomas naršyklės pavyzdys: tonejs-instruments

https://github.com/nbrosowsky/tonejs-instruments

Yra pianinas, gitaros, bosas, styginiai, pučiamieji, harmoniumas ir kiti instrumentai.
Pavyzdžiai jungiami per Tone.js. Garsų licencija CC BY 3.0, kodo MIT. Harmoniumas
nėra akordeonas; šios bibliotekos pateiktame sąraše akordeono ir būgnų rinkinio nėra.

## Rekomenduojama kryptis

1. Dabartinius būgnus palikti kaip atskirą rinkinį ir pridėti lengvą, atrinktą
   Virtuosity Drums variantą palyginimui. Taip ankstesni ritmai gali skambėti kaip anksčiau.
2. Akordeono prototipui naudoti FluidR3_GM, pianinui — atrinktą Salamander variantą
   arba mažesnį FluidR3 pianiną greitam bandymui.
3. Instrumentus įkelti pagal pasirinkimą. Pianinui ir akordeonui reikės natų,
   paspaudimo / atleidimo ir laikymo logikos; vien septynių būgnų klavišų nepakanka.
4. Prieš įjungiant instrumentus įrašymo schemoje saugoti instrumento ir rinkinio
   versiją, natą, jos pradžią, trukmę ir stiprumą. Esamas `{key, time}` būgnų
   formatas to neaprašo, o pakeitus garsus senų įrašų skambesys galėtų pasikeisti.

Šios peržiūros metu programos garso failai nekeičiami ir papildomi instrumentai
nepridedami. Viešų šaltinių dokumentacija patikrinta nurodytą dieną; kai kurios
ne GitHub svetainės šioje aplinkoje buvo nepasiekiamos dėl tinklo politikos.
