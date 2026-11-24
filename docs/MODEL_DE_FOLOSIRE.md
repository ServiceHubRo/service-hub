# Modelul de folosire (Eduard, 14 noiembrie 2026)

„Totul să fie la fel peste tot. Toți să aibă aceeași experiență pe fiecare cont.” Un singur model, pentru client,
firmă, service, coleg de service, agent de suport și admin. Fiecare regulă are o piesă comună în
`src/components` și un cod: auditul (`npm run test:visual`) verifică pe fiecare ecran, la fiecare lățime, că
regula e respectată, iar raportul e în `docs/AUDIT_CONSISTENTA.md`. Detaliile tehnice sunt în ARCHITECTURE §17
(„Page templates”); harta ecranelor pe șabloane e în `docs/SABLOANE_HARTA.md`.

## Pagina

| Cod | Regula | Piesa comună |
|---|---|---|
| P1 | Fiecare ecran are un singur titlu, sus, în antetul paginii: titlu, o frază sub el (opțional), acțiunea paginii în dreapta, filele sub el. Antete de un fel al lor, la fel pe fiecare cont: conversația (cu poza celui cu care vorbești), pagina unui service, pasul unei programări (sub bara de pași), „Cerere trimisă”, cardul mașinii din garaj (exact ca „Adaugă vehicul” din firmă). | `PageHeader` |
| P2 | „‹ Înapoi” stă deasupra titlului, mereu la fel. | `BackLink` (prin `PageHeader back`) |
| — | Fiecare ecran folosește unul din cele cinci șabloane: A listă + detaliu, B grilă de carduri egale, C formular, D panou, E pagină de citit. | `ListDetailLayout`, `CardGrid`, `FormLayout`, `StatGrid` + `PanelSections`, `ReadingPage` |

## Ce arată o listă

| Cod | Regula | Piesa comună |
|---|---|---|
| P3 | Ce arată lista se alege din **file** (Active · Încheiate) sau dintr-o **listă de ales** („Afișează”), niciodată din bule. Bulele rămân doar în panoul „Filtre”, ca opțiuni. | `Tabs`, `SelectField` |
| — | Căutarea e o singură casetă, cu lupă și „×”. | `SearchField` |
| — | Caută are filtrele în butonul „Filtre” (cu numărul celor active) și panoul lui; fundalul rămâne vizibil, doar întunecat, fără blur. Listele (Istoric, listele din admin, flotă) nu au panou: fiecare filtru e un dropdown în pagină, cu „Toate” (fără filtru) ca primă opțiune, apoi filtrele; se aplică imediat (Eduard, 24 nov 2026). | `FiltersButton`, `FilterSheet`, `ChoiceFilters` |
| P8 | Elementele unei liste sunt rânduri de aceeași înălțime (iconiță, titlu, un rând de detalii, stare, săgeată) sau carduri egale într-o grilă, nu carduri puse unul sub altul. | `ListRow`, `CardGrid` |
| P13 | Lângă o listă (de la 1024 px) ecranul are înălțimea ferestrei: antetul (titlul, căutarea, filtrele) și detaliul rămân pe loc, doar lista derulează în coloana ei. Sub 1024 px pagina derulează ca de obicei. | `ListDetailLayout` |
| P14 | Filtrele și acțiunea listei („Descarcă Excel”) stau pe același rând: filtrele în stânga, acțiunea în dreapta; nu unul sub altul. | `ChoiceFilters end` |
| P7 | Starea (programare, deviz, abonament) e o etichetă colorată după sens: chihlimbar = ai de făcut ceva, verde = gata, roșu = problemă, gri = închis. | `StatusPill` |

## Butoane și acțiuni

| Cod | Regula | Piesa comună |
|---|---|---|
| P4 | Un buton e mereu butonul comun: aceeași înălțime, aceleași colțuri, aceleași stări (apăsat, se trimite, eroare cu „Încearcă din nou”). | `Button`, `ActionButton` |
| P5 | Un singur buton plin (chihlimbar) pe ecran: acțiunea principală. Restul sunt secundare sau în „Mai multe”. Adăugarea din dreapta sus e mereu plină. | — |
| P10 | Acțiunile rare stau în „Mai multe”, în același loc. | `MoreActions` |
| P12 | Orice adăugare (o mașină, un coleg, o cheltuială, o categorie, zile libere, fotografii) stă în dreapta sus: în antetul paginii pentru toată pagina, în capul secțiunii pentru o secțiune. Butonul e plin, cu „+”, și scrie doar „Adaugă” (o invitație: „Invită”): titlul de lângă el spune ce se adaugă, iar numele complet („Adaugă programare”) rămâne pentru cititorul de ecran (Eduard, 20 nov 2026). Excepții: butonul unui formular deschis (îl trimite) și cel din starea goală. Antetul paginii are cel mult o acțiune, lângă titlul întreg; o a doua acțiune a paginii („Responsabili”, „Categorie nouă”) stă lângă căutarea sau lista ei (Eduard, 24 nov 2026). Verificat de `tests/unit/pageHeaderActions.test.ts` (sursa) și de auditul vizual (`P12 header`). | `PageHeader actions`, `Section action`, `HeaderAction` |
| P13 | Pe telefon (sub 600 px), butoanele unui loc sunt o familie: cele de pe același rând împart rândul în părți egale și îl umplu, cele unul sub altul (de obicei „Salvează” și „Renunță” dintr-un formular) au aceeași lățime, pe tot rândul. Un buton doar text (ghost) lângă unul plin nu se socotește. Verificat de auditul vizual (`VISUAL_OPENERS=1` deschide și formularele și confirmările, nu doar ecranul închis). Găsit pe aplicația Android (Eduard, 21 nov 2026). | `ListDetailLayout .actions`, `MoreActions`, `.actions` din fleet / requests, `JobDocuments` |
| P11 | O confirmare sau un formular deschis dintr-un buton se deschide în pagină, sub buton, nu într-o fereastră peste pagină. | `InlinePanel` |

## Câmpuri

| Cod | Regula | Piesa comună |
|---|---|---|
| P6 | Un câmp e mereu câmpul comun: etichetă deasupra, caseta, indicația dedesubt. Câmpul de scris din conversații (același la client și la service) și o alegere făcută pe un card (perioada de plată, varianta unei piese din deviz) sunt piese comune ale lor. | `Field`, `SelectField`, `TextArea`, `PhoneField`, `PasswordField`, `CheckMenu`, `SearchField`; conversația; `data-ui="choice"` |
| — | Modelul unui formular e „Adaugă vehicul” din firmă: câmpurile umplu cardul, în coloane egale (cât încap la 240 px: una pe telefon, patru pe laptop). Un câmp singur, un text mai lung, căutarea și „Afișează” umplu și ele lățimea. | `formGrid` (flotă), `--field-max: none` |
| F1 | Câmpurile de pe același rând au aceeași lățime. | `FieldPair` |
| F2 | Câmpurile puse unul sub altul în același formular încep și se termină la aceleași margini, sau stau în aceleași coloane (un rând mai scurt al unei grile). | — |
| F3 | Toate câmpurile pe un rând au aceeași înălțime: 48 px (`--field-h`); butoanele au 44 px. | `--field-h` |
| F4 | Un câmp nu iese din cardul în care stă. | — |
| F5 | Textul din câmp are cel puțin 16 px (altfel iPhone mărește pagina). | — |
| F6 | Fiecare câmp are o etichetă. | — |
| F7 | Eticheta începe exact unde începe caseta. | — |

Excepție: liniile devizului sunt un tabel (coloanele au lățimea conținutului: denumire lată, cantitate îngustă).

## Stări

| Cod | Regula | Piesa comună |
|---|---|---|
| P9 | „Se încarcă” = forme gri de aceeași formă cu conținutul (niciodată ecran gol). | `SkeletonList`, `ListRowsSkeleton`, `CardGridSkeleton`, `FormSkeleton`, `StatGridSkeleton` |
| — | Listă goală = iconiță, o frază, eventual un buton. | `EmptyState` |
| — | Eroare la încărcare = același format, cu „Încearcă din nou”. | `LoadError` |

## Mărimi

Înălțimea butoanelor, a câmpurilor, mărimile titlurilor și colțurile cardurilor vin din `src/styles/tokens.css`.
Auditul le notează pe fiecare ecran (`buttonHeights`, `fieldHeights`, `headings`, `cards`), ca să se vadă unde una
iese din rând.
