# Auditul de consecvență

Regulile: `docs/MODEL_DE_FOLOSIRE.md`. Măsurat: 178 ecrane și stări, 754 vederi (fiecare ecran la fiecare lățime).

## Pe scurt

| Regula | Ecrane cu abateri | Abateri diferite |
|---|---|---|
| P1 Titlul ecranului e în antetul comun | 0 | 0 |
| P2 „Înapoi” e linkul comun | 0 | 0 |
| P3 Ce arată lista: file sau listă de ales, nu bule | 0 | 0 |
| P4 Butoanele sunt butonul comun | 3 | 3 |
| P5 Un singur buton plin pe ecran | 0 | 0 |
| P6 Câmpurile sunt câmpul comun | 0 | 0 |
| P7 Starea e eticheta comună | 0 | 0 |
| P8 O listă e din rânduri sau carduri egale, nu carduri unul sub altul | 13 | 42 |
| P9 „Se încarcă” e forma gri comună | 0 | 0 |
| P10 „Mai multe” e meniul comun | 0 | 0 |
| P11 Confirmările și formularele se deschid în pagină, nu în fereastră | 0 | 0 |
| F1 Câmpurile de pe un rând au aceeași lățime | 0 | 0 |
| F2 Câmpurile unul sub altul au aceleași margini | 2 | 2 |
| F3 Câmpurile de pe un rând au aceeași înălțime | 0 | 0 |
| F4 Câmpul nu iese din card | 0 | 0 |
| F5 Textul din câmp are cel puțin 16 px | 0 | 0 |
| F6 Fiecare câmp are etichetă | 0 | 0 |
| F7 Eticheta începe unde începe caseta | 0 | 0 |

## P4 — Butoanele sunt butonul comun

- **Firmă (administrator) · Vehicule**: „B 58 LFC Dacia Logan Activ Șofer Maria P” e un buton făcut separat (390, 820, 1440 px)
- **Firmă (manager) · Vehicule**: „B 66 STG Dacia Logan Activ Șofer Maria P” e un buton făcut separat (390, 820, 1440 px)
- **Firmă (șofer) · Vehicule**: „B 66 STG Dacia Logan Activ Șofer Maria P” e un buton făcut separat (390, 820, 1440 px)

## P8 — O listă e din rânduri sau carduri egale, nu carduri unul sub altul

- **Admin · Catalog de servicii**: 22 carduri unul sub altul (Revizii & Întreținere Servicii…) (390, 820, 1440 px)
- **Admin · Contestații de neprezentare**: 14 carduri unul sub altul (În analiză P-000127 Atelier T5…) (390, 820, 1440 px); 15 carduri unul sub altul (…) (390, 820, 1440 px)
- **Admin · Echipa de suport**: 25 carduri unul sub altul (Ioana Suport Activ E-00001 sup…) (390, 820, 1440 px)
- **Admin · Export**: 6 carduri unul sub altul (Service-uri Date publice, veri…) (390, 820, 1440 px)
- **Admin · Moderare**: 12 carduri unul sub altul (Limbaj abuziv Așteaptă de 1 zi…) (390, 820, 1440 px); 56 carduri unul sub altul (Lucrare foarte rapidă · Lucrar…) (390, 820, 1440 px); 12 carduri unul sub altul (Lucrare foarte rapidă · Lucrar…) (390, 820, 1440 px); 61 carduri unul sub altul (Publicată Maria P. · C-01351 ·…) (390, 820, 1440 px); și încă 1
- **Admin · Rapoarte de istoric**: 3 carduri unul sub altul (SH-2026-000003 Anulat Mașina D…) (390, 820, 1440 px)
- **Admin · Retenția datelor**: 3 carduri unul sub altul (Solicitări de suport Oprit Se …) (390, 820, 1440 px)
- **Admin · Textele notificărilor**: 78 carduri unul sub altul (client.booking_confirmed {shop…) (390, 820, 1440 px); 48 carduri unul sub altul (shop.booking_requested Cerere …) (390, 820, 1440 px)
- **Admin · Verificare ANAF**: 26 carduri unul sub altul (Anaf Negasit 1107338 Negăsită …) (390, 820, 1440 px); 17 carduri unul sub altul (Atelier Digest 4851456 Negăsit…) (390, 820, 1440 px); 584 carduri unul sub altul (Atelier Test Fără CUI S-00630 …) (390, 820, 1440 px)
- **Admin · Zone**: 42 carduri unul sub altul (Brașov Pornită Service-uri pub…) (390, 820, 1440 px)
- **Client · Notificări**: 4 carduri unul sub altul (Cerere de recenzie Pornită.…) (390, 820, 1440 px)
- **Service · Istoric reparații**: 8 carduri unul sub altul (Încărcare climatizare 14 nov D…) (390, 820, 1440 px); 31 carduri unul sub altul (Schimb ulei + filtru ulei 8 oc…) (390, 820, 1440 px); 7 carduri unul sub altul (Plăcuțe de frână 11 oct Mașină…) (390, 820, 1440 px)
- **Service · Personal**: 9 carduri unul sub altul (Coleg Atelier client-179463842…) (390, 820, 1440 px)

## F2 — Câmpurile unul sub altul au aceleași margini

- **Admin · Proceduri interne**: „Caută în proceduri” se termină la 1392 px, „Categorie” + „Tip” + „Responsabil” + „Afișează” la 1169 px (1440 px)
- **Agent de suport · Proceduri interne**: „Caută în proceduri” se termină la 1392 px, „Categorie” + „Tip” + „Responsabil” + „Afișează” la 1169 px (1440 px)

## Mărimi

- Înălțimea butoanelor (px: de câte ori): 119: 7370, 44: 5329, 117: 1668, 203: 1647, 96: 614, 147: 397, 212: 389, 184: 221, 78: 148, 100: 128, 74: 117, 75: 108, 76: 100, 118: 73, 79: 73, 73: 72, 48: 61, 93: 52, 52: 42, 98: 37, 84: 35, 141: 28, 107: 25, 61: 24, 123: 20, 125: 20, 90: 18, 183: 17, 205: 15, 69: 12, 80: 10, 97: 10, 164: 7, 191: 7, 153: 6, 173: 6, 216: 6, 120: 6, 142: 4, 71: 4, 515: 4, 356: 4, 161: 4, 60: 3, 70: 2, 68: 2, 332: 2, 162: 1, 110: 1, 169: 1
- Înălțimea câmpurilor pe un rând (px: de câte ori): 48: 1351, 44: 4
- Cardurile (colțuri, spațiu interior: de câte ori): r14px p24px: 4779, r14px p16px: 2276, r10px p12px: 18, r14px p4px: 4
- Titlurile (mărime/grosime → ecrane):
  - h1 17px/650: 2 ecrane (Client · garaj-nou; Client · garaj-masina)
  - h1 17px/700: 2 ecrane (Vizitator · atelier-public; Vizitator · link-programare-invalid)
  - h1 20px/700: 3 ecrane (Client · conversatie; Client · mesaje-echipa; Service · conversatie)
  - h1 22px/700: 9 ecrane
  - h1 23px/700: 1 ecrane (Client · service)
  - h1 26px/700: 180 ecrane
  - h1 30px/700: 184 ecrane
  - h1 32.76px/700: 1 ecrane (Vizitator · landing)
  - h1 56px/700: 1 ecrane (Vizitator · landing)
  - h2 13px/600: 29 ecrane
  - h2 13px/700: 2 ecrane (Service · deviz-editor; Service · preluare)
  - h2 15px/600: 5 ecrane (Admin · solicitare; Admin · procedura; Admin · procedura-editare; Client · ajutor-articol; Agent de suport · solicitare)
  - h2 15px/700: 2 ecrane (Client · mesaje-echipa; Service · programare-noua)
  - h2 16px/650: 27 ecrane
  - h2 16px/700: 3 ecrane (Coleg de service · cont; Service nou · cont-nou-service; Admin · service)
  - h2 17px/650: 10 ecrane
  - h2 17px/700: 5 ecrane (Vizitator · legal-termeni; Vizitator · legal-confidentialitate; Vizitator · legal-cookies; Client · cont-legal; Service · fisa-vehicul)
  - h2 18px/700: 13 ecrane
  - h2 19px/650: 1 ecrane (Firmă (administrator) · abonament)
  - h2 19px/700: 5 ecrane (Admin · centrul-de-ajutor; Service · rapoarte; Admin · zone; Admin · retentie; Service nou · panou-nou)
  - h2 21px/600: 2 ecrane (Admin · responsabili; Agent de suport · responsabili)
  - h2 21px/700: 4 ecrane (Service · abonament; Client · rapoarte; Client nou · rapoarte-gol; Service nou · abonament-nou)
  - h2 22.5px/600: 2 ecrane (Admin · responsabili; Agent de suport · responsabili)
  - h2 22.5px/700: 4 ecrane (Service · abonament; Client · rapoarte; Client nou · rapoarte-gol; Service nou · abonament-nou)
  - h2 24.6px/700: 1 ecrane (Vizitator · landing)
  - h2 24px/700: 1 ecrane (Vizitator · landing)
  - h2 24px/750: 1 ecrane (Firmă (administrator) · vehicul)
  - h2 27.88px/700: 1 ecrane (Vizitator · landing)
  - h2 27px/700: 1 ecrane (Vizitator · landing)
  - h2 34px/700: 1 ecrane (Vizitator · landing)
  - h2 40px/700: 1 ecrane (Vizitator · landing)
  - h3 12px/700: 6 ecrane (Vizitator · sablon-lista; Vizitator · sablon-lista-incheiate; Vizitator · sablon-lista-detaliu; Client · programari; Client · programari-incheiate; Client · programare-detaliu)
  - h3 13px/600: 2 ecrane (Client · cauta-filtre; Admin · service)
  - h3 15px/650: 2 ecrane (Client · garaj-nou; Client · garaj-masina)
  - h3 15px/700: 7 ecrane
  - h3 17px/650: 1 ecrane (Firmă (administrator) · vehicul)
  - h3 17px/700: 1 ecrane (Vizitator · landing)

