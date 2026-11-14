# Modelul de folosire (Eduard, 14 noiembrie 2026)

„Totul să fie la fel peste tot. Toți să aibă aceeași experiență pe fiecare cont.” Un singur model, pentru client,
firmă, service, coleg de service, agent de suport și admin. Fiecare regulă are o piesă comună în
`src/components` și un cod: auditul (`npm run test:visual`) verifică pe fiecare ecran, la fiecare lățime, că
regula e respectată, iar raportul e în `docs/AUDIT_CONSISTENTA.md`. Detaliile tehnice sunt în ARCHITECTURE §17
(„Page templates”); harta ecranelor pe șabloane e în `docs/SABLOANE_HARTA.md`.

## Pagina

| Cod | Regula | Piesa comună |
|---|---|---|
| P1 | Fiecare ecran are un singur titlu, sus, în antetul paginii: titlu, o frază sub el (opțional), acțiunea paginii în dreapta, filele sub el. | `PageHeader` |
| P2 | „‹ Înapoi” stă deasupra titlului, mereu la fel. | `BackLink` (prin `PageHeader back`) |
| — | Fiecare ecran folosește unul din cele cinci șabloane: A listă + detaliu, B grilă de carduri egale, C formular, D panou, E pagină de citit. | `ListDetailLayout`, `CardGrid`, `FormLayout`, `StatGrid` + `PanelSections`, `ReadingPage` |

## Ce arată o listă

| Cod | Regula | Piesa comună |
|---|---|---|
| P3 | Ce arată lista se alege din **file** (Active · Încheiate) sau dintr-o **listă de ales** („Afișează”), niciodată din bule. Bulele rămân doar în panoul „Filtre”, ca opțiuni. | `Tabs`, `SelectField` |
| — | Căutarea e o singură casetă, cu lupă și „×”. | `SearchField` |
| — | Filtrele suplimentare sunt în butonul „Filtre” (cu numărul celor active) și panoul lui. | `FiltersButton`, `FilterSheet` |
| P8 | Elementele unei liste sunt rânduri de aceeași înălțime (iconiță, titlu, un rând de detalii, stare, săgeată) sau carduri egale într-o grilă, nu carduri puse unul sub altul. | `ListRow`, `CardGrid` |
| P7 | Starea (programare, deviz, abonament) e o etichetă colorată după sens: chihlimbar = ai de făcut ceva, verde = gata, roșu = problemă, gri = închis. | `StatusPill` |

## Butoane și acțiuni

| Cod | Regula | Piesa comună |
|---|---|---|
| P4 | Un buton e mereu butonul comun: aceeași înălțime, aceleași colțuri, aceleași stări (apăsat, se trimite, eroare cu „Încearcă din nou”). | `Button`, `ActionButton` |
| P5 | Un singur buton plin (chihlimbar) pe ecran: acțiunea principală. Restul sunt secundare sau în „Mai multe”. | — |
| P10 | Acțiunile rare stau în „Mai multe”, în același loc. | `MoreActions` |
| P11 | O confirmare sau un formular deschis dintr-un buton se deschide în pagină, sub buton, nu într-o fereastră peste pagină. | `InlinePanel` |

## Câmpuri

| Cod | Regula | Piesa comună |
|---|---|---|
| P6 | Un câmp e mereu câmpul comun: etichetă deasupra, caseta, indicația dedesubt. | `Field`, `SelectField`, `TextArea`, `PhoneField`, `PasswordField`, `CheckMenu`, `SearchField` |
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
