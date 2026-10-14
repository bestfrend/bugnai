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
