# Service-Hub — planul de construcție

**Cum folosești lista asta.** O sarcină pe sesiune. Deschizi o sesiune nouă în Claude (secțiunea Code, pe repo-ul `service-hub`) și scrii:

> Citește CLAUDE.md, docs/ARCHITECTURE.md și docs/TASKS.md. Fă T01.

Sau, după prima: **„Fă următoarea sarcină.”** Claude construiește, testează, deschide un pull request și îți spune ce ai de făcut. Tu deschizi linkul de test, apeși prin aplicație după pașii din „Ce testezi tu” și, dacă e bine, dai **Merge** în GitHub.

**Dacă ceva nu merge:** scrii în aceeași sesiune ce ai apăsat, ce te așteptai și ce s-a întâmplat, cu o captură de ecran. Nu da Merge până nu merge pe linkul de test.

Ordinea contează: fiecare sarcină se sprijină pe cele de dinainte. Sarcinile mari pot fi împărțite de Claude în părți (T08a, T08b), fiecare funcțională.

**Pentru Claude:** detaliile de ecran sunt în `docs/lovable-prompts.md` (numerele „P…” de mai jos), regulile tehnice în `docs/ARCHITECTURE.md`, cerințele în `docs/FUNCTIONAL_REQUIREMENTS.md` („FR …”). Bifează sarcina aici când e gata și adaugă sub ea o linie „Note:” cu deciziile și ce a rămas.

---

## Pe scurt

| # | Sarcina | Ce vezi după ea |
|---|---|---|
| T01 | Fundația aplicației | Scheletul: meniu, culori, RO/EN, pe telefon și pe laptop |
| T02 | Baza de date | Toate tabelele și regulile de acces; se publică singură în Supabase |
| T03 | Motorul programărilor | Regulile de business în baza de date, testate (fără ecrane noi) |
| T04 | Conturi | Înregistrare, login, „Ține-mă minte”, confirmare email, Cont |
| T05 | Setările service-ului | Program, capacitate, servicii, taxă, date firmă, primii pași |
| T06 | Căutarea clientului | Căutare, filtre, pagina service-ului, favorite, „Aproape de tine” |
| T07 | Programare și garaj | Programarea în 4 pași, garajul, alertele ITP/RCA/rovinietă |
| T08 | Panoul și programările service-ului | Cereri, confirmare, reprogramare, constatare, trimiterea devizului |
| T09 | Devizul, lucrarea și finalizarea | Decizia clientului (și parțială), lucrul, finalizarea cu km, recenzia |
| T10 | Istoricul | Istoric reparații la service, istoricul fiecărei mașini la client |
| T11 | Mesaje și recenzii | Conversații live, mesaje automate, răspuns și raportare recenzii |
| T12 | Notificări push și remindere | Notificări pe telefon, reamintiri automate, expirarea devizelor |
| T13 | Email și SMS | Emailuri de pe service-hub.ro, SMS la cerere nouă, verificare telefon |
| T14 | Abonamentul | Plata cu cardul, perioada gratuită, dezactivare la neplată, facturi |
| T15 | Raportul oficial de istoric | PDF de 29 lei per mașină, pagina publică /verifica |
| T16a | Admin — administrare | Service-uri, clienți, rezervări, moderare, jurnal |
| T16b | Admin — unelte | Abonamente, catalog, setări platformă, anunțuri, exporturi |
| T17 | Rapoarte pentru service | Încasări, clienți reveniți, rata devizelor, ocupare |
| T18 | Pagina publică și lustruire | Pagina de prezentare, accesibilitate, fus orar, tipărire |
| T19 | Lansarea | Monitorizare erori, mediu de test separat, verificarea finală, domeniul |

---

## T01 — Fundația aplicației

**Scop:** proiectul pornește, se publică automat pe Netlify și arată ca Service-Hub pe orice ecran.

**Surse:** CLAUDE.md · ARCHITECTURE §15–18 · FR §10, §11 · P1, P1b, P9c (componentele), P17 (layout) · demo.

**Include:**
- Vite + React + TypeScript strict, React Router, ESLint, Vitest, Playwright. Scripturi: `dev`, `build`, `typecheck`, `lint`, `test`, `test:sql`, `test:e2e`.
- `tokens.css` și stilurile globale (ARCHITECTURE §17).
- Componente comune: Wordmark (nu se rupe pe două rânduri), LogoTile, Button, **ActionButton** (blocare la apăsare, spinner, o singură trimitere, eroare sub buton cu „Încearcă din nou”, `request_id`), Card, StatusBadge, Chip, Stepper, Tabs, Field (label + input + eroare), Checkbox, Skeleton (3 carduri), EmptyState, Banner, OfflineBar, BackLink.
- Cadrul pe roluri: bara de jos pe mobil și tabletă, bara laterală pe desktop (≥1024 px) cu Cont și Deconectare fixate jos. Seturile de 5 butoane pentru client, service și admin, cu ecrane goale (doar titlul). Până la T04, un comutator de rol **doar în build-urile de test** (`?rol=client|service|admin`).
- Limba: `ro.ts` / `en.ts` tipizate, detectarea limbii browserului, comutator RO/EN.
- Clientul Supabase din variabile de mediu, `.env.example`, verificarea versiunii bazei de date (ARCHITECTURE §18; sare peste verificare cât timp nu există migrări).
- Netlify: `netlify.toml`, `public/_redirects`. Iconițe și `manifest.webmanifest` din `docs/brand/logo` (necesare mai târziu pentru notificări pe iPhone).
- GitHub Actions pe fiecare pull request: typecheck, lint, teste, build.
- Pagina `/` temporară: logo + „În curând”.

**Gata când:** linkul de test arată cadrul corect la 390, 820 și 1440 px, fără derulare orizontală; RO/EN schimbă tot textul; fiecare rol are exact cele 5 butoane din CLAUDE.md §1.

**Ce testezi tu:**
1. Deschide linkul pe telefon. Vezi logo-ul și „SERVICE-HUB” pe un rând, cu HUB portocaliu.
2. Adaugă la adresă `?rol=service`: jos apar Panou, Programări, Istoric, Mesaje, Cont. Cu `?rol=client`: Caută, Garaj, Programări, Mesaje, Cont. Cu `?rol=admin`: cele 5 ecrane de admin.
3. Pe laptop: meniul e în stânga, cu Cont și Deconectare jos.
4. Comută EN: tot textul trece în engleză.

**Pașii tăi:** înainte de sesiune, pașii 1–4 din `PORNIRE.md`. După ce se deschide pull request-ul, pasul 5 (Netlify). Apoi Merge.

- [x] Făcut

Note: documentele urcate în rădăcina repo-ului au fost mutate la locul lor (`docs/`, `docs/brand/`, `docs/brand/logo/`, `docs/legal/`). Comutatorul de rol `?rol=` și pagina `/dev/componente` (toate componentele comune, de verificat vizual) există doar când `CONTEXT` de la Netlify nu e `production`. Adminul are pe mobil iconița Cont în antet (bara de jos are cele 5 ecrane de admin); pe desktop, Cont e fixat jos ca la celelalte roluri. Comutatorul RO/EN stă temporar în antet / bara laterală; în T04 se mută și în Cont și se salvează pe profil. Orele se afișează în format 24 h și în engleză (09:00), ca la service. Verificarea versiunii bazei de date e gata, dar pornește abia când există migrări (`EXPECTED_SCHEMA_VERSION = 0`). Pachetul JS e ~510 kB (în mare parte supabase-js + React); împărțirea pe roluri e în T18. Rămâne pentru T04: stocarea „Ține-mă minte”, sesiunea reală.

---

## T02 — Baza de date

**Scop:** toată structura datelor, cu reguli de acces sigure, publicată automat în Supabase.

**Surse:** ARCHITECTURE §2, §5, §14, §15, §18 · FR §8 · P2, P2b, P4, P12, P15b, P16e (ca referință pentru coloane; suprascrierile din ARCHITECTURE §19).

**Include:**
- Migrările pentru toate tabelele din ARCHITECTURE §2, cu RLS, drepturi pe coloane, funcțiile ajutătoare (`my_shop_id`, `is_shop_member`, `is_admin`, `is_shop_public`), secvențele pentru ID-uri (`C-00001`, `S-00001`, `A-00001`), view-ul `shop_ratings`.
- Trigger-ul la înregistrare: creează profilul, iar pentru service și atelierul, programul implicit, abonamentul în perioada gratuită și rândul de proprietar. Rolul admin nu se poate crea de aici.
- Validatorii în SQL (CUI, Registrul Comerțului în ambele formate, IBAN, cod poștal) și aceiași în `src/lib/validators.ts`, cu testele din ARCHITECTURE §14.
- Catalogul de servicii: migrare generată din `docs/service-catalog.json` de un script (`scripts/gen-catalog-sql.ts`).
- `platform_settings` cu valorile implicite, `schema_version`, `promote_to_admin(email)` (nepermisă din API), bucket-urile `logos` și `reports` cu regulile lor, publicația Realtime pentru bookings, messages, threads, reviews, notices.
- `supabase/seed/dev_seed.sql` cu datele din demo (doar pentru teste locale).
- Tipurile TypeScript ale bazei de date în `src/data/database.types.ts`.
- Workflow GitHub Actions **„Deploy Supabase”**: la fiecare pull request și la fiecare Merge în `main`, aplică migrările noi (`supabase db push`) și publică Edge Functions, ca linkul de test să aibă mereu baza de date potrivită. Folosește secretele din GitHub (PORNIRE pasul 6). Dacă GitHub Actions nu se poate conecta direct la baza de date, se folosește pooler-ul Supabase.
- Teste SQL: un client nu vede datele altui client; un service nu vede alt service; un service nu poate citi tabelul `cars`; datele fiscale nu se văd decât de proprietar și admin; un utilizator nu poate modifica coloanele protejate; înregistrarea cu rol „admin” în metadate devine client.

**Gata când:** toate migrările rulează de la zero pe o bază goală, testele SQL trec, „Deploy Supabase” e verde pe pull request și bara roșie „Baza de date nu e la zi” nu apare pe linkul de test.

**Ce testezi tu:**
1. Pe pagina pull request-ului, verificarea „Deploy Supabase” e verde.
2. În Supabase → Table Editor vezi tabelele (profiles, shops, bookings, services cu 150 de rânduri etc.).
3. Pe linkul de test nu apare nicio bară roșie.

**Pașii tăi:** pasul 6 din `PORNIRE.md` (cele 3 secrete în GitHub). Dacă nu l-ai făcut înainte de sesiune, îl faci acum și îi spui lui Claude să ruleze din nou verificarea.

- [x] Făcut

Note: 6 migrări (`schema_version` = 6): foundation, identity_and_shops, bookings_and_messages, notifications_and_money, storage_and_realtime, service_catalog (generată). Nimic nu e accesibil din browser implicit — fiecare tabel/funcție primește acces explicit; `tests/sql/50_platform.sql` verifică lista exactă (vezi ARCHITECTURE §18 „Grants”). Recenziile, favoritele, mesajele și marcajele „citit” se scriu doar prin funcțiile din T03 (fără scriere directă din browser). `shops.city` poate fi gol dacă lipsește din metadate (formularul din T04 îl cere). Un service cu programări nu poate fi șters (`bookings.shop_id` restrict); facturile rămân (restrict) — `delete-account` (T04) trebuie să anonimizeze în loc să șteargă. Testele SQL rulează și pe stack-ul Supabase real (`npx supabase start` cu `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`), plus verificare prin API (înregistrare, login, RLS, logo, realtime). **Pentru T03:** seed-ul inserează programări în trecut (statusuri finale) — trigger-ul „nicio programare în trecut” trebuie să permită seed-ul (ex. verificare doar la statusuri active / la schimbarea datei). Cerut de Eduard în aceeași sesiune: comutatorul de rol `?rol=` merge și pe site-ul publicat până la T04 (`ROLE_SWITCH_ENABLED` în `src/lib/env.ts`).

---

## T03 — Motorul programărilor

**Scop:** toate regulile de business, în baza de date, dovedite prin teste. Fără ecrane noi.

**Surse:** ARCHITECTURE §3, §4, §6, §7, §8 · FR §6 · P3, P9, P14b, P15, P15c, P15d.

**Include:**
- Toate funcțiile din tabelul ARCHITECTURE §3, plus: `get_availability`, `search_shops(q, category, city, lat, lng, sort)` (potrivire fără diacritice pe nume, oraș și serviciu, cu „ce serviciu s-a potrivit”), `send_message`, `mark_thread_read`, `submit_review`, `reply_review`, `report_review`, `toggle_favorite`, `client_no_show_count`, `last_odometer_for_booking`, `expire_quotes`.
- Capacitatea pe zi și pe interval orar (câte mașini încep la aceeași oră), cu blocarea rândului, și trigger-ul de siguranță pe `bookings`.
- Limitele anti-abuz (ARCHITECTURE §6), idempotența prin `request_log`, mesajele automate ca eveniment + parametri, evenimentele în `notification_events`.
- Regulile de kilometraj (ARCHITECTURE §7).
- **Nicio programare în trecut:** data și ora trebuie să fie în viitor (ora României), verificat în baza de date la salvare, atât la programare cât și la reprogramare, plus trigger de siguranță pe tabel.
- În frontend: `src/data/rpc.ts` cu funcții tipizate și harta codurilor de eroare către mesaje traduse în RO și EN.
- Teste SQL: o programare pe o zi trecută, pe ziua de azi la o oră trecută și o reprogramare în trecut sunt toate refuzate, chiar dacă cererea vine direct în baza de date, nu din interfață; fiecare tranziție permisă și fiecare refuzată; două rezervări simultane pe ultimul loc (doar una reușește); acceptarea parțială recalculează totalul; refuzul total aplică taxa de constatare; devizul expirat eliberează locul; toate limitele; toate regulile de kilometraj; clientul nu poate modifica pozițiile devizului; service-ul nu poate accepta devizul în locul clientului.

**Gata când:** `npm run test:sql` acoperă toate cele de mai sus și trece.

**Ce testezi tu:** nimic de apăsat încă. Claude îți arată în pull request lista testelor care au trecut.

**Pașii tăi:** verifici că „Deploy Supabase” e verde pe pull request, apoi Merge.

- [ ] Făcut

---

## T04 — Conturi

**Scop:** oricine își face cont, intră, rămâne logat și își administrează contul.

**Surse:** ARCHITECTURE §15 · FR §2, §3.8, §4.8 · P4b, P4c, P13, P13b, P14.

**Include:**
- Ecranul de autentificare (P4b): tab-uri, alegerea rolului pe carduri, numele service-ului și orașul doar pentru service, telefon, bifa de termeni cu linkuri care deschid documentele pe loc, erori specifice.
- „Ține-mă minte” bifat implicit (sesiune păstrată) / debifat (sesiune până la închiderea browserului).
- Confirmarea emailului: banner până la confirmare, „Retrimite emailul” cel mult o dată la 60 s. Până la confirmare: service-ul nu apare în căutări, clientul nu poate programa.
- „Ai uitat parola?” cu răspuns neutru și ecranul de parolă nouă (P4c).
- Rutare după rol și protecția rutelor; scoaterea comutatorului de rol din T01 (`ROLE_SWITCH_ENABLED` în `src/lib/env.ts`, `DevRoleFromUrl`, cardul de pe pagina `/`; acum merge și pe site-ul publicat).
- Ecranul Cont, baza comună (P13b): card de identitate cu ID-ul contului, editarea numelui și a telefonului, limbă, schimbare parolă, schimbare email (în așteptare până la confirmare), documentele legale în aplicație (`docs/legal`), „Datele mele”: descărcare JSON și ștergerea contului cu confirmare (Edge Functions `export-my-data`, `delete-account`), Deconectare.
- CAPTCHA Turnstile la înregistrare, activat doar dacă există cheia.
- Sesiunea expirată în mijlocul unei acțiuni: mesaj clar și reautentificare, fără să se piardă ce completase utilizatorul.
- Emailurile vin deocamdată prin serviciul de test Supabase (câteva pe oră); emailurile reale vin în T13.

**Gata când:** se poate crea cont de client și de service, confirma emailul, intra, ieși, reseta parola; fiecare rol ajunge doar în interfața lui.

**Ce testezi tu:**
1. Creezi un cont de client cu emailul tău. Fără bifa de termeni, nu merge și primești mesaj clar.
2. Confirmi din email, intri: ajungi pe Caută. Vezi ID-ul `C-00001` în Cont.
3. Închizi browserul complet, îl redeschizi: ești tot logat. Repeți cu „Ține-mă minte” debifat: trebuie să te loghezi din nou.
4. Creezi un cont de service cu alt email (merge și `adresa+service@gmail.com`): ajungi pe Panou.
5. „Ai uitat parola?” cu o adresă inexistentă: același mesaj ca pentru una existentă.

**Pașii tăi:** în Supabase → Authentication → URL Configuration: Site URL și Redirect URLs, exact cum îți scrie Claude în pull request.

- [ ] Făcut

---

## T05 — Setările service-ului

**Scop:** un service nou își configurează atelierul și apare în căutări.

**Surse:** FR §4.5b, §4.6 · P5, P5b, P5c, P5d · ARCHITECTURE §4, §5, §14 · demo (ecranul de setări).

**Include:**
- Datele publice cu adresa pe câmpuri separate, logo încărcat, geocodarea adresei la salvare (Edge Function `geocode`) și butonul „Folosește locația curentă”.
- Programul pe fiecare zi, zilele libere și concediile (adaugă / editează / șterge), regulile de programare (durata intervalului 30/60 min, preaviz minim, cât de departe în viitor, termen de anulare), „Comenzi pe zi” 1–100, „Mașini pe aceeași oră”, taxa de constatare.
- Catalogul de servicii: căutare fără diacritice, pe categorii, „Alege tot” / „Scoate tot”, 2 coloane pe desktop.
- **Pagina rămâne pe loc când apeși + / − sau bifezi un serviciu** (fără salt în sus).
- Datele de facturare (doar proprietarul): validare CUI, Registrul Comerțului, IBAN, cod poștal; „Copiază adresa atelierului”; reamintire pe Panou din ziua 60 a perioadei gratuite.
- Primii pași pe Panou (P5d): 4 pași cu progres „2 din 4”, dispare definitiv la final. Banner cu motivul exact pentru care service-ul nu apare în căutări.
- Personalul: invitație pe email, listă, eliminare (emailul real din T13; până atunci, link de copiat).
- Preferințele de notificare: SMS la cerere nouă, rezumat zilnic (se salvează acum, funcționează din T12 și T13).
- Verificarea telefonului: până la T13, pasul 4 arată „În așteptare” și se poate verifica manual din SQL (Claude îți dă comanda).

**Gata când:** un service nou completează cei 4 pași și apare în căutarea unui client (după verificarea manuală a telefonului).

**Ce testezi tu:**
1. Cu contul de service: vezi cei 4 pași pe Panou.
2. Alegi servicii (caută „frane”: găsește „Frâne”), setezi programul cu sâmbătă scurtă, 6 mașini pe zi, taxă 80 lei. Pagina nu sare în sus la fiecare apăsare.
3. Pui un CUI greșit (de ex. 14872302): e refuzat cu mesaj. `RO14872301` e acceptat. Un IBAN greșit e refuzat.
4. Adaugi un concediu de 3 zile.

**Pașii tăi:** rulezi comanda SQL de verificare a telefonului pe care ți-o dă Claude, ca service-ul tău de test să apară în căutări.

- [ ] Făcut

---

## T06 — Căutarea clientului

**Scop:** clientul găsește service-ul potrivit după ce are nevoie, nu doar după nume.

**Surse:** FR §3.1, §3.2 · P11, P11b, P16, P16d · ARCHITECTURE §5, §8.

**Include:**
- Un singur câmp de căutare (nume, oraș, serviciu), chip-uri de categorii și de orașe (din date), rândul „Oferă: X”, numărul de rezultate („7 service-uri în Brașov”), „Cum e ordonată lista?”, stare goală cu „Șterge filtrele”.
- Ordinea: scorul ponderat (ARCHITECTURE §8). Un service nou, fără recenzii, stă la mijlocul listei.
- Favorite: inimă pe rezultat și pe pagina service-ului, chip „Favorite”, lista Favorite în Cont.
- Locația (P16d): banner, cererea nativă doar la apăsare, secțiunea „Aproape de tine”, distanța pe carduri, sortarea „Recomandate” / „Cele mai apropiate”. Locația nu se salvează în baza de date. Rândul de control în Cont.
- Pagina service-ului (P11b + FR §3.2): program pe zile, zile închise, concedii viitoare, mașini pe zi, preaviz minim, telefon cu apel direct, servicii fără prețuri, taxa de constatare cu explicația ei, recenzii cu răspunsurile service-ului (secțiunea lipsește dacă nu există), butonul „Programează-te”.

**Gata când:** căutarea după „vulcanizare”, „brasov” și „frane” dă rezultatele corecte, iar filtrele se combină.

**Ce testezi tu:**
1. Cu contul de client: cauți „frane”, apoi „brasov”, apoi alegi categoria Anvelope.
2. Activezi locația: apare „Aproape de tine” și distanțele.
3. Deschizi un service: vezi programul, serviciile, taxa și recenziile. Nu vezi CUI, IBAN sau sediul social.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T07 — Programare și garaj

**Scop:** clientul se programează în 4 pași și își ține mașinile în garaj.

**Surse:** FR §3.3, §3.4 · P6, P7 · ARCHITECTURE §4 · demo.

**Include:**
- Programarea în 4 pași cu bara de progres: serviciu (grupat pe categorii) → zi (următoarele 12 zile disponibile, locuri rămase, zile pline estompate) → oră (ore ocupate tăiate) → mașină (din garaj sau introdusă manual, cu „Salvează în garaj” bifat), observație, rezumat, trimitere. Ecranul de succes.
- Zilele trecute nu apar deloc, iar în ziua de azi orele deja trecute nu se pot alege (nici cele mai apropiate decât preavizul service-ului).
- Dacă ziua s-a umplut sau ora a trecut între timp (ecran lăsat deschis): mesaj clar, lista se reîmprospătează și te întoarce la alegerea zilei.
- Clientul neconfirmat pe email nu poate trimite: explicație în loc de buton.
- Garajul (P7): carduri cu marcă, model, an, număr; buline ITP / RCA / rovinietă colorate după urgență; formular cu VIN validat și datele de expirare; ștergere cu confirmare.
- Bannerul de expirare pe Caută („ITP la Golf 7 în 12 zile”, „+1 de verificat”), care deschide Garajul.
- Tabul Programări al clientului, forma de bază: carduri cu serviciu, service, dată, oră, mașină și status (stările complete, devizul și anularea vin în T09).

**Gata când:** o programare trimisă apare în Programări ca „În așteptare”; capacitatea 1 face ziua gri pentru a doua programare.

**Ce testezi tu:**
1. Adaugi o mașină în garaj, cu ITP peste 10 zile: pe Caută apare bannerul.
2. Te programezi la service-ul tău de test.
3. Pui capacitatea service-ului pe 1: ziua aleasă devine gri pentru o a doua programare.
4. În calendar nu apar zile din trecut, iar azi nu poți alege o oră care a trecut.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T08 — Panoul și programările service-ului

**Scop:** service-ul primește cererea, o confirmă, constată mașina și trimite devizul.

**Surse:** FR §4.1, §4.2 · P8, P8b, P8c, P15 (partea de service), P15c, P15d · ARCHITECTURE §3, §7 · demo.

**Include:**
- Panoul: cele 6 carduri (cereri noi, azi, 7 zile, în constatare, așteaptă deviz, în lucru), fiecare apăsabil spre lista filtrată, cu chip-ul de filtru care se poate șterge; cardurile cu 0 nu se apasă. Linia de capacitate duce la setări. Programul de azi, cu rânduri apăsabile. Nota despre devizele fără răspuns.
- Programări: tab-urile Cereri și Programate cu numărătoare, cardul complet (client, telefon cu apel, ID cont, număr, observație, marcajul „Client cu 3 neprezentări”).
- Acțiunile pe fiecare status: Confirmă, Respinge, Reprogramează (zile + ore, „Mută și confirmă”, refuz sigur dacă ziua s-a umplut), Anulează cu motiv, Neprezentat (după ora programării), În constatare (reprogramarea nu poate muta pe o zi sau oră trecută), compunerea devizului (poziții, „+ Adaugă poziție”, total live, observație, taxa afișată), Editează / Retrage devizul. (În lucru și Finalizare vin în T09, după ce clientul poate accepta devizul.)
- Actualizare live: o cerere nouă apare pe Panou și în Programări fără reîncărcare; bulina pe tabul Programări.
- Tipărirea programului de azi.

**Gata când:** o cerere a clientului ajunge la service live și merge până la „Deviz trimis”; apăsarea repetată pe „Confirmă” pe semnal slab creează o singură confirmare.

**Ce testezi tu** (două browsere sau telefon + laptop, client și service):
1. Clientul trimite o cerere: apare la service fără refresh.
2. Service: Confirmă → În constatare → trimite un deviz cu 3 poziții.
3. La client, programarea arată „Deviz trimis” (decizia vine în T09).
4. Reprogramezi o altă cerere pe o zi plină: e refuzată, programarea rămâne neschimbată.
5. Apeși de 3 ori rapid pe „Confirmă” la o cerere nouă: o singură confirmare.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T09 — Devizul, lucrarea și finalizarea

**Scop:** clientul decide pe deviz, service-ul lucrează și finalizează cu kilometrajul, clientul lasă recenzie. Fluxul complet, cap-coadă.

**Surse:** FR §3.5, §4.2 · P10b, P15, P15c, P15d · ARCHITECTURE §3, §7 · demo.

**Include:**
- Lista: active sus, apoi restul; toate statusurile cu badge.
- Stările pe card: în constatare (punct animat), devizul complet cu bife pe fiecare poziție, total recalculat, „Accept” / „Accept selectate”, „Refuz” cu confirmare care numește taxa (sau fără taxă, dacă e 0); deviz acceptat; în lucru cu ora de start; finalizat cu kilometraj, lucrare, sumă, „Gata de ridicare”; deviz refuzat cu taxa; expirat; neprezentat.
- Anularea doar până la termenul service-ului, apoi „Contactează service-ul pentru a anula”; niciodată din constatare încolo.
- Recenzia pe card (5 stele, text opțional) o singură dată, în 60 de zile; apoi „Recenzie trimisă”.
- „Vezi istoricul mașinii” și „Programează din nou” pe lucrările finalizate.
- Actualizare live a statusului; bulină pe tab când un deviz așteaptă decizia.
- La service: În lucru (cu pozițiile aprobate vizibile) și Finalizare cu **kilometraj obligatoriu** — km lângă câmp, tastatură numerică, ultima valoare cunoscută, refuz sub ultima valoare, confirmare la salt de peste 50.000 km; lucrarea și costul precompletate din pozițiile aprobate.

**Gata când:** clientul debifează o poziție, acceptă restul, totalul e corect, service-ul vede exact pozițiile aprobate și nu poate finaliza fără kilometraj valid.

**Ce testezi tu:**
1. Pe devizul din T08: debifezi o poziție, totalul scade, apeși „Accept selectate”.
2. La service apare „Deviz acceptat” fără refresh. Apeși „În lucru”, apoi „Finalizare”: sunt precompletate doar pozițiile aprobate.
3. Încerci să finalizezi fără kilometraj: nu merge. Pui 105.400 și finalizezi.
4. Faci încă o lucrare pe aceeași mașină și pui 98.000 km: e refuzat și îți arată 105.400.
5. Pe o altă programare refuzi devizul: confirmarea numește taxa de constatare.
6. Lași o recenzie după finalizare.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T10 — Istoricul

**Scop:** „ce i-am făcut data trecută mașinii ăsteia?” — pentru service și pentru client.

**Surse:** FR §3.6, §4.3 · P16b, P16c, P15d · ARCHITECTURE §7.

**Include:**
- Istoric la service (P16b): totaluri, căutare după număr, mașină, client, serviciu; chip-uri de status și de perioadă; carduri care se deschid cu devizul complet (pozițiile neaprobate tăiate), observația, lucrarea, kilometrajul, linkul spre mesaje; export CSV al listei filtrate (cu kilometraj); tipărire.
- Istoricul mașinii la client (P16c): **trei intrări** — cardul din Garaj, „Istoricul mașinilor mele” din Cont (cu alegerea mașinii), „Vezi istoricul mașinii” de pe o programare finalizată. Totaluri, lucrările cu kilometraj, „Programează din nou” precompletat. Potrivire după număr (fără spații, fără diferență de litere mari/mici), altfel marcă + model + an.

**Gata când:** cele trei intrări duc la același ecran; căutarea „BV 12” găsește toate lucrările pe acel număr.

**Ce testezi tu:**
1. La service, în Istoric, cauți după numărul mașinii de test și descarci CSV-ul.
2. La client, ajungi la istoricul mașinii din Garaj, din Cont și de pe programarea finalizată.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T11 — Mesaje și recenzii

**Scop:** clientul și service-ul vorbesc în aplicație, live; service-ul își gestionează recenziile.

**Surse:** FR §3.7, §4.4, §4.5 · P9, P9b, P10 · ARCHITECTURE §2 (Messages), §6.

**Include:**
- Lista de conversații sortată după ultimul mesaj, cu previzualizare și bulină de necitit (și pe tab).
- Conversația: bule, ore, mesajele automate centrate cu „mesaj automat”, afișate în limba celui care citește. Trimitere cu limitele din ARCHITECTURE §6 și mesaje clare la refuz.
- Butonul „Mesaj” de pe orice programare deschide conversația corectă.
- Actualizare live: mesajul nou apare imediat, lista se reordonează.
- Recenziile la service (tile în Cont): media, lista, „Răspunde” / „Editează răspunsul”, „Raportează” cu cele 4 motive, starea „Raportată”, recenzia nouă apare live.
- Verificare generală: bara „Fără conexiune”, scheletele la încărcare și erorile sub butoane funcționează pe toate ecranele construite până acum.

**Gata când:** un mesaj trimis de client apare la service în 1–2 secunde, fără refresh, și invers.

**Ce testezi tu:**
1. Deschizi aceeași conversație ca client pe telefon și ca service pe laptop; trimiți mesaje din ambele părți.
2. Oprești internetul pe telefon: apare bara „Fără conexiune”; la revenire dispare și mesajele pierdute apar.
3. Răspunzi la o recenzie și raportezi alta.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T12 — Notificări push și remindere

**Scop:** clientul află de deviz și de mașina gata, service-ul de cereri noi, fără să deschidă aplicația.

**Surse:** FR §7 · P15b, P7b, P15c (remindere și expirare) · ARCHITECTURE §9, §10, §11.

**Include:**
- Service worker, abonarea push, tabelul `push_subscriptions`, mai multe dispozitive per utilizator.
- Cererea de permisiune ca la WhatsApp Web, pentru ambele roluri: banner în aplicație, fereastra nativă doar la apăsare, „Nu acum” nu mai revine în sesiune; rândul din Cont cu Activate / Dezactivate / Blocate de browser; nota pentru iPhone (Adaugă pe ecranul de start).
- Cheile VAPID generate o singură dată de server și păstrate într-un tabel privat (fără pas manual).
- Edge Function `dispatch-notifications`: textele în limba destinatarului, trimitere, ștergerea abonamentelor moarte, jurnal.
- Joburile programate din ARCHITECTURE §10: expirarea devizelor și reamintirea cu 24 h înainte, reamintirea programării cu 24 h înainte, expirarea ITP/RCA/rovinietă la 30, 7 și 0 zile (o singură dată pe prag), rezumatul zilnic pentru service-urile care îl vor.

**Gata când:** fiecare eveniment din FR §7 care are canal push ajunge pe telefon, o singură dată.

**Ce testezi tu:**
1. Pe telefon (pe iPhone: întâi Share → „Adaugă pe ecranul principal”), ca client, activezi notificările.
2. De pe laptop, ca service, trimiți un deviz: telefonul primește notificarea. Apăsând-o, se deschide programarea.
3. Refuzi permisiunea pe alt browser: bannerul nu mai apare, în Cont scrie cum le activezi.

**Pașii tăi:** ce scrie în pull request (de regulă activarea extensiilor `pg_cron` și `pg_net` din Supabase → Database → Extensions, dacă migrarea nu le poate activa singură).

- [ ] Făcut

---

## T13 — Email și SMS

**Scop:** emailuri reale de pe service-hub.ro, SMS la cerere nouă, verificarea telefonului.

**Surse:** FR §2, §7, §9 · SERVICII_EXTERNE §2, §4 · ARCHITECTURE §9, §11.

**Include:**
- Resend: domeniul `service-hub.ro` verificat (înregistrări SPF, DKIM, DMARC), SMTP-ul Supabase Auth prin Resend, șabloanele de email RO/EN (confirmare, resetare, schimbare email) cu aspectul Service-Hub.
- Emailurile aplicației din `dispatch-notifications`: invitație personal, recenzie raportată către admin, cont suspendat (plățile vin în T14).
- SMSO: SMS la cerere nouă pentru service-urile care au activat opțiunea; verificarea telefonului prin cod SMS (`phone-verify-start` / `phone-verify-check`), care bifează pasul 4 din primii pași.

**Gata când:** confirmarea contului ajunge în Inbox (nu în Spam) la Gmail și Yahoo; un service primește SMS la o cerere nouă.

**Ce testezi tu:**
1. Faci un cont nou: emailul vine de la service-hub.ro, în Inbox, în limba aleasă.
2. Ca service nou, confirmi telefonul cu codul primit prin SMS.
3. Activezi SMS-ul la cerere nouă și faci o programare din contul de client.

**Pașii tăi:** cont Resend, înregistrările DNS în Netlify (Domains → service-hub.ro → DNS), cheia `RESEND_API_KEY` în Supabase → Edge Functions → Secrets, setările SMTP în Supabase → Authentication; cont SMSO și `SMSO_API_KEY`; adresa de admin `ADMIN_EMAIL`. Claude îți dă valorile exacte, pas cu pas.

- [ ] Făcut

---

## T14 — Abonamentul

**Scop:** service-urile plătesc 100 lei/lună după 90 de zile; cine nu plătește dispare din căutări.

**Surse:** FR §4.7, §6 (Subscription) · P12, P12b · ARCHITECTURE §12 · SERVICII_EXTERNE §5, §6.

**Include:**
- Ecranul Abonament (doar proprietarul): zilele rămase din perioada gratuită, prețul, ce include, status, următoarea plată, „Activează” (Stripe Checkout), „Gestionează” (portalul Stripe), lista facturilor.
- Edge Functions `stripe-checkout`, `stripe-portal`, `stripe-webhook` (semnătură verificată, fiecare eveniment o singură dată). Doar webhook-ul și adminul schimbă statusul.
- Regula de neplată: la sfârșitul perioadei gratuite fără plată sau după ultima încercare eșuată, service-ul devine inactiv (nu apare în căutări, nu primește programări noi, își păstrează datele), cu banner și buton de plată. Plata îl reactivează imediat.
- Avertizări la 7 zile și la 1 zi înainte de final, și la plată eșuată (push + email).
- Prețul per service (`price_ron`), ca primele 10 service-uri să-și păstreze prețul fix.
- Facturarea cu SmartBill sau Oblio și e-Factura (`issue-invoice`): construită cu comutator, pornită după decizia ta și a contabilului.

**Gata când:** în modul de test Stripe, un service plătește cu cardul de test, devine activ, anulează, iar la final de perioadă dispare din căutări.

**Ce testezi tu:** plata cu cardul de test `4242 4242 4242 4242`, orice dată viitoare, orice CVC; apoi anularea din portal.

**Pașii tăi:** cont Stripe pe firmă, produsul „Abonament Service-Hub” la 100 lei/lună, cheile de test ca secrete (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`), adresa webhook-ului; decizia pentru facturare (SmartBill / Oblio, seria, TVA) împreună cu contabilul.

- [ ] Făcut

---

## T15 — Raportul oficial de istoric

**Scop:** clientul cumpără cu 29 lei un PDF verificabil cu tot ce s-a lucrat la o mașină, ca să-l dea cumpărătorului.

**Surse:** FR §3.6b · P16e, P15d · ARCHITECTURE §7, §13 · `docs/reference-report.pdf` (exemplul de raport).

**Include:**
- Trei intrări: istoricul mașinii, cardul din Garaj, „Rapoartele mele” din Cont. Doar pentru o mașină anume; niciodată pentru o mașină fără lucrări finalizate.
- Previzualizarea înainte de plată, cu ultimele două rânduri estompate și fraza „Raportul conține doar lucrările efectuate prin Service-Hub.”
- Plata unică prin Stripe; doar webhook-ul marchează raportul plătit și pornește generarea.
- PDF-ul generat pe server: antet, mașina, cod unic `SH-2026-000123`, tabelul lucrărilor **cu coloana de kilometraj**, totaluri, „Kilometraj la ultima lucrare”, nota dacă citirile nu sunt crescătoare, blocul de verificare, mențiunea că nu e istoricul complet. Diacriticele românești apar corect.
- „Rapoartele mele”: descărcare gratuită oricând. Exportul GDPR gratuit din Cont rămâne neschimbat.
- Pagina publică `/verifica`, fără cont: arată doar mașina, numărul de lucrări, perioada și data generării.

**Gata când:** un raport cumpărat în modul de test se descarcă, iar codul lui e confirmat pe `/verifica` fără nume de service-uri sau sume.

**Ce testezi tu:**
1. Cumperi raportul pentru mașina de test cu cardul de test.
2. Deschizi PDF-ul: verifici kilometrajul și diacriticele.
3. Într-o fereastră privată, fără cont, verifici codul pe `/verifica`.

**Pașii tăi:** prețul raportului în Stripe (dacă Claude îți cere un produs separat).

- [ ] Făcut

---

## T16a — Admin: administrare

**Scop:** tu vezi și controlezi tot, iar fiecare acțiune a ta rămâne scrisă în jurnal.

**Surse:** FR §5.1–5.5, §5.8 · P19, P20 · ARCHITECTURE §15 (Admin).

**Include:**
- Interfața de admin și crearea contului de admin prin `promote_to_admin`.
- Prezentare: cifrele din FR §5.1 și activitatea recentă.
- Service-uri: listă cu căutare și filtre, detaliu complet; acțiuni: verificare manuală a telefonului, suspendare / reactivare, editare, prelungirea perioadei gratuite, schimbarea manuală a statusului abonamentului, ștergere.
- Clienți: listă, detaliu (mașini, programări, recenzii, conversații doar de citit), suspendare, ștergere, numărul de neprezentări.
- Rezervări: toate, cu filtre, detaliu cu deviz și conversație, anulare forțată cu motiv.
- Moderare: coada recenziilor raportate, cele mai vechi primele, cu vechimea vizibilă; „Păstrează” / „Șterge” cu notă; media service-ului se recalculează; ambele părți sunt anunțate.
- Jurnalul de audit pentru fiecare acțiune.
- Listele se actualizează live (programări noi, recenzii raportate), cu bulină pe Moderare.

**Gata când:** fiecare acțiune de admin apare în jurnal cu „înainte” și „după”.

**Ce testezi tu:** te faci admin (comanda de mai jos), suspenzi service-ul de test (dispare din căutări), îl reactivezi, moderezi o recenzie raportată.

**Pașii tăi:** în Supabase → SQL Editor rulezi `select promote_to_admin('adresa-ta@...');` pentru contul cu care vrei să fii admin (un cont separat de cel de client).

- [ ] Făcut

---

## T16b — Admin: unelte de platformă

**Scop:** schimbi prețuri, catalogul și textele fără programator.

**Surse:** FR §5.6, §5.6b, §5.7, §5.9–5.11 · P21.

**Include:**
- Abonamente și facturi: listă, corecturi manuale.
- Rapoarte de istoric: toate, cu anulare pentru cele emise greșit.
- Catalogul: adaugă, redenumește, activează / dezactivează, reordonează servicii și categorii. ID-urile nu se schimbă niciodată.
- Setările platformei: prețul abonamentului, zilele gratuite, expirarea devizului, prețul raportului, constantele de clasament, valorile implicite pentru service-uri noi, limitele, textele notificărilor RO/EN. Modificările nu ating programările și devizele existente.
- Anunțuri: către toate service-urile, toți clienții sau un oraș; previzualizare; în aplicație și, opțional, push; jurnal.
- Exporturi CSV cu filtre: service-uri, clienți, programări, recenzii, abonamente.

**Gata când:** schimbarea expirării devizului din setări se aplică doar devizelor trimise după schimbare.

**Ce testezi tu:** trimiți un anunț către clienții din Brașov și îl vezi pe contul de client.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T17 — Rapoarte pentru service

**Scop:** ecranul care îl face pe patron să-și reînnoiască abonamentul.

**Surse:** P22 · FR §4.9 · demo (ecranul Rapoarte).

**Include:** tot din P22 — perioade, cele trei cifre cu comparația față de perioada anterioară, încasările pe 12 luni, lucrările pe tip de serviciu, clienți unici și reveniți, rata de acceptare a devizelor, taxele de constatare încasate, timpul mediu de răspuns la deviz, ocuparea și cea mai aglomerată zi, export CSV, starea „prea puține lucrări” sub 3. Graficele desenate în SVG. Vizibil doar proprietarului (conține încasările) — decizie pe care o poți schimba.

**Gata când:** cifrele se potrivesc cu Istoricul pentru aceeași perioadă.

**Ce testezi tu:** compari încasările din Rapoarte cu totalul din Istoric pe „Ultimele 3 luni”.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T18 — Pagina publică și lustruire

**Scop:** pagina de prezentare pentru vizitatori și aplicația verificată ca întreg.

**Surse:** P18, P17b · `docs/reference-landing.html` (pagina „în curând” de acum, cu textele, telefonul și stilul) · ARCHITECTURE §17.

**Include:**
- Pagina publică la `/` pentru cine nu e logat (P18), cu textele și contactul din pagina actuală „în curând”. Fără cifre, testimoniale sau logo-uri inventate.
- Accesibilitate pe toată aplicația: navigare doar cu tastatura, focus vizibil, etichete, contrast, ținte de 44 px, animații oprite la „reduce motion”.
- Fus orar: testele Playwright rulează și cu fusul orar al Germaniei și al SUA; o programare la 09:00 arată 09:00 peste tot.
- Tipărirea programului zilei și a istoricului.
- Încărcare rapidă: codul fiecărui rol se încarcă separat. Pagina 404. Titlu, descriere și imagine pentru distribuire pe pagina publică.

**Gata când:** toată aplicația se poate folosi doar cu tastatura și nicio oră nu se schimbă cu fusul orar al dispozitivului.

**Ce testezi tu:** deschizi pagina publică pe telefon și laptop; schimbi fusul orar al laptopului pe Germania și verifici ora unei programări.

**Pașii tăi:** nimic.

- [ ] Făcut

---

## T19 — Lansarea

**Scop:** aplicația trece de pe linkul de test pe service-hub.ro, pregătită pentru primii clienți reali.

**Include:**
- Sentry pentru aplicație și pentru Edge Functions.
- Mediu de test separat: un al doilea proiect Supabase pentru linkurile de test din pull request-uri; proiectul actual rămâne cel real. Variabilele Netlify separate pentru „Deploy Previews” și „Production”.
- Documentele legale actualizate (Claude pregătește ciorna, tu și avocatul le finalizați): completarea câmpurilor goale ([Denumire firmă], [CUI], [email]…); scoaterea mențiunilor vechi (prețuri publice, încărcarea de poze și documente, „posturi”); adăugarea raportului plătit, locației, notificărilor push, SMS-urilor, kilometrajului, plăților Stripe și a furnizorilor (Supabase, Netlify, Resend, SMSO, Stripe); versiunile în engleză.
- Verificarea finală: lista „Final check” din `docs/lovable-prompts.md` și FR, parcurse automat de Claude cu Playwright pe mediul de test, cu raport în `docs/LAUNCH_CHECK.md`, apoi parcurse de tine.
- Mutarea domeniului `service-hub.ro` de pe pagina „în curând” pe aplicație (Netlify), redirecționarea `www`, HTTPS; Site URL în Supabase Auth; cheile Stripe live; contul de admin; backup-uri.

**Gata când:** `docs/LAUNCH_CHECK.md` are toate punctele bifate, iar service-hub.ro deschide aplicația.

**Ce testezi tu:** lista din `docs/LAUNCH_CHECK.md`, cap-coadă, cu un service și un client reali (de ex. un prieten cu service).

**Pașii tăi:** ce listează Claude; mutarea domeniului o faci împreună, pas cu pas.

- [ ] Făcut
