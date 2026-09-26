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
| T14a | Abonamentul | Plata cu cardul, perioada gratuită, dezactivare la neplată, chitanțe |
| T14b | Facturarea | Facturi fiscale SmartBill/Oblio și e-Factura, după decizia cu contabilul |
| T15 | Raportul oficial de istoric | PDF de 29 lei per mașină, pagina publică /verifica |
| T16a | Admin — administrare | Service-uri, clienți, rezervări, moderare, jurnal |
| T16b | Admin — unelte | Abonamente, catalog, setări platformă, anunțuri, exporturi |
| T17 | Rapoarte pentru service | Încasări, clienți reveniți, rata devizelor, ocupare |
| T18 | Pagina publică și lustruire | Pagina de prezentare, accesibilitate, fus orar, tipărire |
| T19a | Lansarea — monitorizare și mediu de test | Erorile ajung în Sentry; linkurile de test pe un proiect Supabase separat |
| T19b | Lansarea — documentele legale | Termeni, confidențialitate, cookies actualizate, în română și engleză |
| T19d | Remindere pentru clienți | Cerere de recenzie după lucrare, reminder pentru următoarea revizie |
| T19c | Lansarea — verificarea finală și domeniul | `LAUNCH_CHECK.md`, service-hub.ro, plăți reale, admin, copii de siguranță |
| T20 | Aplicațiile pentru iPhone și Android | Service-Hub în App Store și Google Play, cu notificări pe iPhone fără „Adaugă pe ecranul principal” |

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

- [x] Făcut

Note: 3 migrări (`schema_version` = 9): booking_engine, quotes_and_jobs, messages_reviews_search. Au timestamp-uri alese manual după cele din T02 (`npx supabase migration new` ar fi dat un timestamp mai mic decât al lor). Erorile au forma `message = cod`, `detail = JSON cu parametri`; `src/data/rpc.ts` le traduce (RO/EN) și un test unitar verifică că lista de coduri din frontend e exact cea din migrări. Decizii: o cerere **în așteptare** poate fi retrasă de client oricând (termenul de anulare se aplică doar programărilor confirmate); `decide_quote` primește și id-ul variantei de deviz văzute de client (`quote_changed` dacă service-ul a schimbat-o între timp); reprogramarea de către service respectă programul, zilele libere și capacitatea, dar nu preavizul minim; `mark_thread_read` nu are `request_id` (repetarea e inofensivă); fiecare tranziție scrie mesajul automat (cu `params.by` = cine l-a cauzat, ca să nu apară necitit la autor) și câte un eveniment pentru fiecare membru al service-ului; SMS doar pe copia proprietarului; căutarea tolerează ultima vocală („frane” găsește „Plăcuțe de frână”) și caută și în numele categoriei; limita de mesaje e per expeditor și conversație. Trigger-ul de siguranță verifică trecutul și capacitatea doar când o programare devine activă sau se mută, așa că seed-ul cu lucrări vechi merge. `expire_quotes()` există, dar programarea lui la 15 minute e în T12. Testele SQL (60–67, 90) rulează pe PostgreSQL 16 (CI) și pe stack-ul Supabase local (Postgres 17); `90_concurrency.sql` deschide o a doua sesiune reală cu `dblink` — pe stack-ul Supabase rulează cu `PGOPTIONS='-c test.dblink_password=postgres'`.

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
- Ecranul Cont, baza comună (P13b): card de identitate cu ID-ul contului, editarea numelui și a telefonului, limbă, schimbare parolă, schimbare email (în așteptare până la confirmare), documentele legale în aplicație (`docs/legal`), „Datele mele”: descărcare JSON și ștergerea contului cu confirmare (RPC `export_my_data`, Edge Function `delete-account`), Deconectare.
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

- [x] Făcut

Note: 1 migrare (`schema_version` = 10): `export_my_data()` (descărcarea datelor, RPC în loc de Edge Function — e doar citire și se poate testa în SQL), `cancel_email_change()`, `prepare_account_deletion()` (doar pentru service role) și `profiles.deleted_at`. Edge Function `delete-account` (fără pachete npm): refuză cât timp există programări active; clientul e șters de tot (service-urile păstrează lucrările, fără nume și telefon; recenziile rămân fără nume); un service cu programări sau facturi nu poate fi șters (legea cere păstrarea lor), așa că service-ul dispare din căutări, proprietarul e anonimizat și contul e închis definitiv. Adminul nu își poate șterge contul din aplicație. Confirmarea emailului rămâne cum e implicit în Supabase: nu intri în cont până nu confirmi (ecranul „Verifică-ți emailul” + „Retrimite” o dată la 60 s); bannerul din aplicație apare doar dacă un cont neconfirmat ajunge totuși logat. Linkurile din email folosesc fluxul „implicit”, deci merg și deschise pe alt dispozitiv. „Ține-mă minte” e salvat pe dispozitiv (`sh_remember`); după 30 de zile fără folosire, sesiunea se închide. Deconectarea închide sesiunea doar pe dispozitivul curent. Sesiunea expirată în timpul lucrului: apare un panou de autentificare peste ecran, ce ai scris rămâne. Resetarea parolei: același mesaj indiferent dacă adresa există; maxim 3 cereri pe oră pe adresă (în browser; serverul are limitele lui). CAPTCHA Turnstile există, dar pornește doar când se pune cheia publică `VITE_TURNSTILE_SITE_KEY` (și CAPTCHA în Supabase) — de făcut până la lansare (T19). Comutatorul `?rol=` a fost scos. Bara roșie a versiunii bazei de date spune acum de ce nu poate citi versiunea (variabile Netlify lipsă/greșite sau eroarea bazei de date), iar build-ul Netlify pică cu explicație dacă lipsesc `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Testele de browser rulează acum în CI pe un Supabase local (migrări + seed + Edge Functions + un „cutie poștală” de test), cu fluxuri reale: cont nou, confirmare din email, resetare parolă, Cont, ștergere cont, sesiune expirată. Documentele legale se afișează din `docs/legal` și au încă locuri de completat ([Denumire firmă], dată) și mențiuni vechi (planuri Start/Pro/Business) — de actualizat înainte de lansare. **Pentru T05:** plăcile din Cont (Setări, Abonament, Recenzii, Rapoarte) se adaugă odată cu ecranele lor. **Pentru T13:** șabloanele de email din Supabase Auth (confirmare, resetare, schimbare email) sunt încă cele implicite, în engleză; emailurile reale (Resend ca SMTP) le înlocuiesc. **Pentru T14:** `delete-account` trebuie să anuleze și abonamentul Stripe. **Pentru T15:** `history_reports` se șterg odată cu contul clientului (`on delete cascade`) — de decis dacă rapoartele plătite se păstrează anonimizate (codul de verificare `/verifica`).

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 11) și Edge Function `geocode`. Setările sunt în Cont → „Setări service”, pe secțiuni, fiecare cu butonul ei de salvare („✓ Salvat” 1,5 s): Profil public · Program și zile libere · Reguli de programare · Servicii oferite · Date de facturare (doar proprietarul) · Personal (doar proprietarul) · Notificări. Programul se salvează toată săptămâna o dată (`save_shop_hours`), din jumătate în jumătate de oră; serviciile se salvează ca listă întreagă (`set_shop_services`); „Alege tot” / „Scoate tot” se aplică serviciilor afișate (după căutare). Căutarea în catalog ignoră diacriticele și ultima vocală („frane” găsește „Frânare” și „Plăcuțe de frână”). Pașii 2 și 3 din „Pune service-ul pe picioare” se bifează când service-ul salvează programul, respectiv regulile (valorile implicite nu contează ca verificate). Pasul 4 rămâne „În așteptare” până la T13; telefonul se confirmă manual cu `select public.verify_phone_manually('email');` în SQL Editor (nu se poate apela din aplicație, apare în jurnalul de admin). Geocodarea: după „Salvează profilul”, doar dacă adresa s-a schimbat (sau lipsesc coordonatele), în fundal, cu mesaj „Am găsit adresa” / „Am găsit doar orașul” / „Nu am găsit” / „Harta nu răspunde”; dacă locul nu există, coordonatele vechi se șterg (mai bine fără locație decât una greșită). Logo: PNG/JPG/WebP ≤ 2 MB, previzualizare, apoi „Salvează”. Zilele libere: doar de azi încolo, cel mult un an, ștergere cu confirmare; programările deja făcute în acele zile rămân (se spune pe ecran). Memento-ul pentru datele de facturare apare pe Panou din ziua 60 a perioadei gratuite, doar proprietarului, până se completează denumirea, CUI-ul, Registrul Comerțului, sediul social și emailul de facturare; „Mai târziu” îl ascunde 7 zile. Personalul: invitație cu link de copiat (valabil 14 zile, doar pentru adresa invitată, cel mult 10 colegi); colegul își face cont din link și intră direct în service-ul care l-a invitat; nu vede facturarea și personalul; un cont care există deja nu poate fi invitat (cere altă adresă). Colegul eliminat vede „Contul tău nu mai e legat de niciun service”. Notificări: SMS la cerere nouă și rezumatul zilei se salvează acum; trimiterea pornește în T12/T13. **Pentru T06:** logo-ul (`shops.logo_url`) apare în locul inițialelor în căutare și pe pagina service-ului. **Pentru T08:** Panou are deocamdată doar pașii, bannerele și „Mașini pe zi: N”; contoarele și programul zilei vin în T08 (plus „Azi: M” pe rândul capacității). **Pentru T12:** starea notificărilor pe telefon în Notificări. **Pentru T13:** emailul de invitație (acum linkul se trimite de mână) și verificarea telefonului prin SMS.

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 12): `search_words`, `search_shops` rescrisă să caute **pe cuvinte** (fiecare cuvânt trebuie găsit în nume/oraș sau, pentru restul, într-un singur serviciu oferit; „s” de plural englezesc și ultima vocală sunt opționale — „brakes”, „schimb ulei”, „frane brasov” merg; „frane ulei” nu, fiindcă sunt două servicii diferite), `search_cities` (butoanele de orașe din date, „Brasov”/„Brașov” = un singur oraș) și `get_shop_page` (pagina service-ului într-un singur apel, doar coloane publice, `bookable`, recenziile cu răspuns). Recenziile se pot citi acum doar împreună cu service-ul lor (înainte, orice cont vedea recenziile oricărui service, chiar ascuns). Filtrele stau în adresă (`?q=&cat=&oras=&fav=1&sort=aproape`), deci „Înapoi” și reîncărcarea le păstrează; scrierea unui oraș exact („brasov”) selectează butonul orașului și îl deselectează când textul se schimbă. Distanțele se calculează în browser — locația nu pleacă nicăieri, nici măcar în cererea de căutare. „Aproape de tine” = cele mai apropiate 3 service-uri din rezultatele filtrate, pe o rază de 25 km; nu apare când lista e deja sortată după distanță. Bannerul de locație apare doar cât timp browserul nu a răspuns la cerere; „Nu acum” îl ascunde definitiv (`profiles.location_prompt_dismissed_at`; dacă salvarea pică, dispare doar pentru vizita curentă). Dacă permisiunea a fost dată deja, locația se citește singură (fără nicio întrebare). Inima de favorite folosește aceleași reguli ca ActionButton (logica e acum în `useAction`, folosit de amândouă); în lista Favorite din Cont o inimă stinsă își păstrează cardul până pleci (ca să poți reveni). Service-urile favorite care nu mai apar în căutări sunt doar numărate („1 service din favorite nu apare acum…”). Stelele arată nota exactă (4,5 = patru stele și jumătate). Pagina service-ului: program grupat pe zile la fel (Lun – Vin 08:00 – 18:00), concediile de azi încolo, comenzi pe zi, preaviz, telefon cu apel direct, site, taxa de constatare (doar dacă e peste 0), servicii pe categorii cu iconițe, recenzii (secțiunea lipsește dacă nu există). **Pentru T07:** „Programează-te” duce la `/c/service/:id/programare`, acum un ecran „Programarea online vine în curând” (`BookingSoon`) — T07 îl înlocuiește; un service care nu mai primește programări (clientul îl vede doar pentru că are o programare veche acolo) nu are butonul. **Pentru T11:** recenziile de pe pagina service-ului nu se actualizează live (sunt citite la deschidere).

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 13): browserul alege id-ul unei mașini noi (o dată pe formular), ca „Încearcă din nou” după un răspuns pierdut să nu adauge mașina de două ori. Programarea: `/c/service/:id/programare?pas=2&serviciu=ulei&zi=2026-10-14&ora=10:00` — alegerile stau în adresă, deci „Înapoi” din telefon merge un pas înapoi și reîncărcarea le păstrează; „Înapoi” de pe ecran păstrează alegerea (e marcată). Pasul 2: următoarele 12 zile în care service-ul e deschis, până la limita „cât de departe în viitor”; zilele pline apar estompate cu „plin”; o zi fără nicio oră din cauza ceasului (azi după ultima oră, sau în preaviz) nu apare deloc. Pasul 3: orele trecute și cele din preaviz nu apar, cele ocupate sunt tăiate. Pasul 4: mașinile din garaj (un tap) sau „Altă mașină” (marcă, model, an, număr; „Salvează mașina în garaj” bifat); fără mașini în garaj apare direct formularul; rezumatul arată și taxa de constatare. Dacă ziua s-a umplut sau ora a trecut între timp, apare mesajul și te întoarce la zile (reîncărcate); ce ai scris la mașină și observație rămâne. Clientul cu emailul neconfirmat vede explicația și „Retrimite emailul” în locul butonului. Ecranul de succes: `/programare/trimisa` (înlocuiește pașii în istoric), cu codul programării. Garajul: `/c/garaj`, `/c/garaj/nou`, `/c/garaj/:id`; VIN verificat (17 caractere, fără I, O, Q), număr și VIN scrise cu majuscule; ștergere cu confirmare pe ecran (programările vechi își păstrează copia mașinii). Bulinele: gri peste 30 de zile (cu data), portocaliu în 30 de zile, roșu din ziua expirării, cu clopoțel. Bannerul de pe Caută: cel mai urgent document, „+N de verificat”, duce la Garaj. Programări (client): active primele (cele mai apropiate sus), apoi încheiate (cele mai noi sus); se actualizează live (Realtime) când service-ul schimbă ceva. **Pentru T09:** cardurile de la Programări nu au încă butoane (anulare, deviz, recenzie, mesaj). **Pentru T10:** „Istoric — N lucrări” pe mașina din garaj și „Programează-te din nou” (poate folosi `?serviciu=` în adresa programării). **Pentru T12:** notificările push pentru expirări (acum doar bannerul).

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 14): `list_shop_bookings()` (toate programările active ale service-ului într-un singur apel: serviciul, ID-ul de cont al clientului și neprezentările lui din ultimele 90 de zile — service-ul tot nu poate citi profilul clientului —, devizul curent cu pozițiile) și `get_availability(…, p_exclude_booking)` (la reprogramare, locul pe care îl ține acum programarea se vede liber, cum îl socotește și `reschedule_booking`; doar pentru membrii service-ului). Lista se încarcă o dată pentru toată interfața service-ului și rămâne live (Realtime): Panou, Programări și bulina de pe tabul Programări citesc din ea, deci trecerea între ecrane nu mai arată schelet. **Panou:** 6 carduri (Cereri noi · Azi · 7 zile = azi și următoarele 6 · În constatare · Așteaptă deviz · În lucru), un card cu 0 nu se apasă (estompat); „Azi” și „7 zile” numără doar programările confirmate și mai departe (cererile sunt la „Cereri noi”); linia de capacitate: „Mașini pe zi: 5 · Azi: 3” (Azi = toate programările active de azi, cereri incluse); nota despre devizele fără răspuns apare doar când există un deviz trimis; „Programul de azi” cu rânduri care deschid programarea și „Tipărește” (tipărește doar tabelul zilei, negru pe alb). **Programări:** `/s/programari?tab=cereri|programate&filtru=azi|7zile|constatare|deviz|lucru&p=<id>`, chip-ul de filtru se șterge cu un tap; cele mai apropiate primele (una rămasă în urmă stă sus până o rezolvi). Cardul: serviciu, zi, oră, cod, status; mașina cu numărul, clientul, telefon cu apel, ID cont, observația, „Client cu N neprezentări” de la 3 în sus. Acțiunile se deschid în card (fără ferestre): Confirmă (ascuns când ora cererii a trecut — atunci reprogramezi sau respingi), Respinge (motiv opțional), Reprogramează (zilele service-ului fără preaviz, 12 odată + „Mai multe zile”, până la 3 luni; ora actuală marcată „acum”; „Mută și confirmă” / „Mută programarea”; dacă ziua s-a umplut între timp: mesaj, zilele se reîncarcă, programarea rămâne cum era), Anulează (motiv obligatoriu), Neprezentat (doar după ora programării, cu confirmare), În constatare, Trimite deviz (poziții + preț, „Adaugă poziție”, total live, observație, taxa de constatare și termenul de răspuns afișate; prețul se scrie `1250` sau `99,50` — `1.250` e refuzat ca să nu fie citit greșit), Editează devizul (pornește de la cel trimis, trimite o versiune nouă), Retrage devizul (cu confirmare). După fiecare acțiune un mesaj spune ce s-a întâmplat și, dacă programarea a trecut în celălalt tab, „Vezi programarea”. Programările încheiate (respinse, anulate, neprezentate) dispar din listă — Istoricul vine în T10. Datele demo locale (`dev_seed.sql`) au acum la Atelier Demo o săptămână completă (o programare confirmată trecută, un client cu 3 neprezentări, un deviz acceptat parțial, o lucrare în curs azi). **Pentru T09:** butoanele „În lucru” și „Finalizare” pe cardurile „Deviz acceptat” / „În lucru” (acum arată doar devizul și ora de start). **Pentru T11:** butonul de mesaj pe card. **Pentru T12:** notificările push (evenimentele se scriu deja în baza de date la fiecare acțiune).

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

- [x] Făcut

Note: fără migrare (baza de date avea deja toate funcțiile din T03: `decide_quote`, `start_work`, `complete_job`, `last_odometer_for_booking`, `cancel_booking`, `submit_review`). **Client:** programările se încarcă o dată pentru toată interfața clientului (`ClientBookingsProvider`, citire directă cu RLS: programarea, service-ul cu telefonul și termenul de anulare, toate versiunile devizului cu pozițiile, recenzia; plus `review_window_days` din setări) și rămân live (Realtime pe `bookings` filtrat pe client: rândul schimbat se aplică imediat, apoi lista se recitește discret pentru devizul nou). Bulina de pe tabul Programări = devize care așteaptă decizia („2 devize de aprobat” pentru cititorul de ecran). Cardul: în așteptare („Service-ul îți confirmă cererea în curând.”); în constatare și în lucru cu punct portocaliu care pulsează (oprit la `prefers-reduced-motion`), în lucru cu ora de start; devizul cu bife (toate bifate la început), total recalculat în bani, „Accept” / „Accept selectate”, fără nicio bifă rămâne doar „Refuz”; refuzul cere confirmare în card și numește taxa (fără taxă nu o pomenește); un deviz înlocuit de service între timp e refuzat de baza de date (`quote_changed`), mesajul apare sub buton și lista se reîncarcă, cu bifele resetate pe versiunea nouă. Acceptat: pozițiile neacceptate tăiate, „Ai acceptat 2 din 3 poziții — 430 lei. Lucrarea urmează.” Finalizat: kilometrajul lângă dată, lucrarea și suma; titlul „Gata de ridicare” în primele 2 zile după finalizare, apoi „Lucrare finalizată” (o lucrare de acum 3 luni nu mai e „de ridicat”). Refuzat: „Deviz refuzat. Taxă de constatare: 100 lei.” Respinse / anulate de service sau admin arată motivul. Anularea: cererile oricând, confirmatele până la termenul service-ului (0 = fără termen), după aceea „Contactează service-ul pentru a anula.” cu telefonul service-ului; niciodată din constatare încolo. Recenzia: 5 stele (butoane de 44 px, „5 din 5 stele”), text opțional, o singură dată, în fereastra din setări (60 de zile); apoi „★ Recenzie trimisă”. „Programează din nou” deschide programarea la același service cu serviciul ales (`?pas=2&serviciu=`). **Service:** „În lucru” pe „Deviz acceptat” (pozițiile refuzate tăiate); „Finalizare” deschide panoul: kilometraj obligatoriu cu „km” în câmp, tastatură numerică, ultima valoare pentru acest număr (sau „Prima lucrare înregistrată”), sub ea refuzat cu valoarea anterioară, peste +50.000 km cere bifa „Da, kilometrajul e corect”; se acceptă `105400`, `105.400`, `105 400`; butonul e inactiv până e valid; lucrarea și costul precompletate doar din pozițiile aprobate, editabile. Panoul din card (`InlinePanel`) e acum componentă comună. **Pentru T10:** „Vezi istoricul mașinii” pe programarea finalizată (e deja una dintre cele trei intrări din T10; nu am pus un link spre un ecran care încă nu există). **Pentru T11:** butonul „Mesaj” pe carduri.

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 16): `list_shop_history()` — toate programările încheiate ale service-ului tău (finalizate, deviz refuzat, deviz expirat, anulate, neprezentări), cele mai noi sus, cu devizul care se potrivește cu felul în care s-au încheiat, într-un singur apel (fără limita de 1000 de rânduri). Cererile respinse nu apar: n-au devenit niciodată lucrări. **Service — Istoric** (`/s/istoric`): „Istoric reparații” cu „{n} reparații · {sumă} încasat” (doar lucrările finalizate, din lista filtrată); căutare fără diacritice în număr (și scris fără spații: „bv12abc”), marcă, model, an, client, serviciu (RO/EN), kilometraj și codul programării; chip-uri Toate · Finalizate · Deviz refuzat (include și devizele expirate) · Anulate · Neprezentări; perioade Ultima lună · Ultimele 3 luni · Anul acesta · Tot (după ziua în care s-a încheiat lucrarea, ora României); filtrele stau în adresă. Cardul: serviciul, data, suma verde (sau statusul), mașina cu numărul, clientul, kilometrajul, lucrarea; apăsat se deschide cu devizul complet (pozițiile neaprobate tăiate), nota devizului, nota clientului, codul și ziua programării, telefonul clientului și „Mesaj”; la cele neterminate spune cum s-au încheiat (taxa de constatare, cine a anulat și motivul, neprezentare, deviz expirat). Live: o lucrare finalizată pe alt dispozitiv apare singură. „Descarcă istoricul” = CSV cu lista filtrată (data, cod, status, număr, mașină, client, serviciu, kilometraj, lucrare, sumă), în limba interfeței: în română cu `;` și virgulă zecimală (se deschide direct în Excel pe calculator românesc), în engleză cu `,`; „Tipărește” scoate un tabel alb-negru cu chenare. **Client — istoricul mașinii**: un singur ecran, trei intrări — rândul „Istoric — 2 lucrări” de pe cardul din Garaj („Nicio lucrare încă” când nu are), „Istoricul mașinilor mele” din Cont (mașinile din garaj, apoi „Alte mașini”: cele șterse din garaj dar cu lucrări) și „Vezi istoricul mașinii” pe programarea finalizată. Antet: mașina, anul, numărul, „{n} lucrări · {sumă} cheltuit în total”; lucrările (doar finalizate) cu service, oraș, dată, kilometraj, sumă; deschise: devizul acceptat, lucrarea, „Programează din nou” (același service și serviciu) și „Mesaj”. Potrivirea: după număr fără spații și fără diferență de litere mari/mici; fără număr, după marcă + model + an. Câmpul de căutare din Caută e acum o componentă comună (`SearchField`), folosită și în Istoric. **Pentru T15:** raportul PDF poate porni din ecranul istoricului mașinii (butonul lipsește intenționat până atunci). **Pentru T17:** rapoartele pot refolosi `list_shop_history`.

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 15): `list_threads()` (conversațiile tale într-un singur apel: numele celeilalte părți, ultimul mesaj, câte mesaje necitite) și `booking_thread(programare)` (conversația unei programări, pentru butonul „Mesaj”). Trimiterea, marcajul de citit, răspunsul și raportarea existau din T03. **Mesaje** (client `/c/mesaje`, service `/s/mesaje`): cele mai noi sus, avatar, nume, ora (azi: `14:05`, ieri: „Ieri”, altfel data), previzualizare („Tu: …” pentru mesajele tale, textul mesajului automat), numărul de necitite; bulina de pe tab = conversații cu mesaje necitite („o conversație necitită” pentru cititorul de ecran). Necitite = mesajele celeilalte părți după ultima ta citire; mesajele automate pe care le-ai provocat tu (ex. cererea trimisă de client) nu contează ca necitite pentru tine; la service, mesajele oricărui coleg sunt „ale noastre”. **Conversația** (`/c/mesaje/:id`): bule (ale tale portocalii în dreapta, ale lor gri în stânga), ora sub fiecare, zilele separate („Azi”, „Ieri”, data), mesajele automate centrate cu „mesaj automat”, scrise **din perspectiva celui care citește și în limba lui** („Programarea P-000123 e confirmată” la client, „Ai confirmat programarea P-000123” la service; motive, sume și taxa de constatare incluse). Ultimele 50 de mesaje, apoi „Mesaje mai vechi”. Caseta de scris stă jos pe ecran; pe laptop Enter trimite (Shift+Enter = rând nou), pe telefon Enter face rând nou și trimiți cu butonul (ca la WhatsApp). Butonul de trimitere urmează regulile ActionButton (o singură trimitere, eroare sub casetă cu „Încearcă din nou”); limitele (30 de mesaje pe oră, doar cu o programare între voi, 4000 de caractere) vin cu mesajele lor. Deschiderea conversației și fiecare mesaj primit cât e deschisă o marchează citită. Dacă clientul și-a șters contul, service-ul vede conversația dar nu mai poate scrie. **Live:** lista urmărește tabelul `threads` (fiecare mesaj și fiecare citire îl atinge), conversația deschisă urmărește `messages`; după o cădere a conexiunii se recitește ultima pagină, deci nu se pierde nimic. **„Mesaj”** pe fiecare card de programare, la client și la service (`/…/mesaje/programare/:id` găsește conversația și se înlocuiește cu ea, deci „Înapoi” duce la Programări). **Recenzii** (tile în Cont-ul service-ului, `/s/cont/recenzii`): media mare portocalie, stelele, numărul; cardurile cu nume, dată, cod programare și serviciu, text; „Răspunde” / „Editează răspunsul” (golind textul butonul devine „Șterge răspunsul”); „Raportează” cu cele 4 motive (butonul e inactiv până alegi), apoi chenar portocaliu, „Raportată” și confirmarea „în maximum 5 zile lucrătoare”; recenzia rămâne publică. Stări după decizia adminului (T16a): „Am verificat raportarea: recenzia rămâne publicată” sau „Eliminată” (nu mai intră în medie). Recenzia nouă și răspunsurile apar live, și pe pagina publică a service-ului (nota din T06). **Verificarea generală:** bara „Fără conexiune” apare pe toate ecranele (e în cadrul aplicației), listele au schelet la încărcare, gol doar după încărcare, erori cu „Încearcă din nou”; testul din browser oprește internetul clientului în mijlocul conversației și verifică că mesajul trimis între timp apare la revenire. **Pentru T10:** Istoricul nu e făcut încă (T10 rămâne următorul); linkul spre mesaje din Istoric poate folosi `bookingMessagesPath('shop', id)`. **Pentru T12:** notificarea push pentru mesaj nou (evenimentul `new_message` se scrie deja). **Pentru T16a:** adminul nu are încă ecran de mesaje (`list_threads` îi întoarce o listă goală).

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 17) și Edge Function `dispatch-notifications`. **Fără pas manual pentru chei:** la primul apel, funcția își face singură perechea de chei VAPID și își notează adresa în `push_config` (tabel pe care doar serverul îl poate citi); acțiunea „Deploy Supabase” o apelează o dată după fiecare publicare. **Trimiterea:** fiecare eveniment nou din coadă trezește funcția pe loc (prin `pg_net`, după salvare), plus o verificare la fiecare minut pentru ce a rămas; funcția scrie textul în limba destinatarului și din partea lui (client sau service), îl criptează (Web Push standard, fără pachete npm, testat cu exemplul oficial din RFC 8291) și îl trimite pe fiecare dispozitiv; dispozitivele care nu mai există (404/410) se șterg; dacă nu a ajuns pe niciun dispozitiv, reîncearcă de până la 5 ori (niciodată de două ori pe același dispozitiv); evenimentele mai vechi de 12 ore nu se mai trimit (o notificare despre un deviz de ieri nu ajută). SMS-ul și emailul apar în jurnal ca `not_configured` până la T13. **Apăsarea pe notificare** deschide ecranul potrivit: la client programarea (cardul e adus în ecran și conturat), conversația sau mașina din garaj; la service cererea, programarea, istoricul (pentru cele încheiate, după cod), conversația, recenziile sau Panou (rezumatul zilei). Dacă aplicația e deja deschisă, se schimbă doar ecranul (nimic scris nu se pierde). **În aplicație:** bannerul „Activează notificările” pe Caută (client) și Panou (service), fereastra browserului doar după „Activează”; „Nu acum” îl ascunde pentru sesiune și revine după 7 zile (salvat pe profil); dacă browserul le blochează, bannerul nu mai apare și Cont spune de unde le activezi. Pe iPhone, într-un tab de Safari, bannerul explică pașii „Partajează → Adaugă pe ecranul principal” (acolo nu pot funcționa altfel). Rândul „Notificări push” e în Cont (client și service) și în Setări → Notificări la service: Activate / Dezactivate / Blocate de browser, cu Activează / Dezactivează doar pentru dispozitivul curent. Un dispozitiv aparține celui logat pe el: la deconectare nu mai primește notificările contului care a ieșit; alt cont logat pe același browser (cu permisiunea deja dată) le primește pe ale lui. Cel mult 10 dispozitive de persoană. Se acceptă doar adresele serviciilor push reale (Google, Mozilla, Apple, Microsoft), ca serverul să nu poată fi pus să trimită oriunde. **Joburile** (pg_cron, create de migrare): expirarea devizelor și „devizul expiră mâine” la 15 minute (o dată pe versiune de deviz, clientului și service-ului); reamintirea programării confirmate cu 22–24 h înainte (o dată; o reprogramare o repornește; „Mâine la 10:00…” sau „Azi la 23:00…”); ITP / RCA / rovinieta la 30, 7 și 0 zile, zilnic la 07:00 (un singur mesaj pentru cel mai mic prag atins — o mașină adăugată cu ITP-ul peste 5 zile primește unul, nu două; o dată nouă de expirare pornește de la capăt); rezumatul zilei pentru service-urile care l-au cerut, o dată pe zi, în primele 2 ore după deschidere, doar în zilele deschise și doar dacă are ce spune; ștergerea `request_log` mai vechi de 7 zile. Decizii: reamintirile (programare, deviz care expiră, documente, rezumat) nu scriu mesaj automat în conversație — ar muta conversația sus și ar apărea ca necitită fără să fie ceva nou; adminul nu are încă notificări push. Textele pot fi schimbate din `platform_settings.notification_texts` cu aceleași chei (`client.quote_sent` etc., lista în ARCHITECTURE §9) — ecranul pentru asta vine în T16b. Testul din browser verifică tot drumul pe un Supabase local: activare → programare confirmată → baza de date trezește funcția → notificarea criptată ajunge la un „serviciu push” de test, în română, cu linkul corect → „apăsarea” deschide programarea → dezactivare și deconectare șterg dispozitivul. **Pentru T13:** SMS-ul la cerere nouă (evenimentul are deja canalul `sms` pentru service-urile care l-au cerut) și emailurile se adaugă în `dispatch-notifications` (acum sunt `not_configured`). **Pentru T14:** avertizările de sfârșit de perioadă gratuită și dezactivarea la neplată intră în `run_hourly_jobs` (ora 07:00). **Pentru T16a/b:** jurnalul `notifications_log` (ce s-a trimis, unde a eșuat) pentru ecranul de admin; notificările adminului (recenzie raportată) și anunțurile (`broadcast`) au nevoie de texte noi în `_shared/templates.ts`.

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 18), Edge Functions noi `phone-verify-start` și `invite-staff`, `dispatch-notifications` trimite acum și email și SMS. **Emailurile de cont** (confirmare, „Retrimite”, parolă uitată, schimbare email) au aspectul Service-Hub (card închis, buton portocaliu, SERVICE-HUB) și vin în limba contului — subiect și text; limba se ține la zi singură când o schimbi în aplicație. Șabloanele sunt în repo (`supabase/templates`, generate din `_shared/authEmails.ts`) și ajung în Supabase prin acțiunea „Deploy Supabase” (fără copiat de mână); linkul de confirmare e valabil 24 de ore. Pleacă prin Resend după ce pui SMTP-ul (pașii din PR). **Emailuri din aplicație** (Resend, de la `notificari@service-hub.ro`, cu răspuns către `ADMIN_EMAIL`): invitația pentru colegi (butonul „Trimite invitația”; linkul rămâne și pe ecran, pentru WhatsApp sau dacă emailul nu ajunge; „Retrimite invitația” face link nou și îl trimite; fiecare link pleacă o singură dată), recenzie raportată → adresa de admin (service, motiv, stele, client, programare, text; recenzia rămâne publică până decizi), cont sau service suspendat → persoana în cauză (se trimite automat oricine suspendă, deci și din ecranele de admin din T16a). **SMS** (SMSO, fără diacritice, un singur SMS de 160 de caractere): la cerere nouă, doar dacă service-ul a bifat opțiunea și numărul proprietarului e confirmat („Service-Hub: cerere noua de la Maria Pop, Mie 14 oct, 10:00: Schimb ulei. Raspunde in aplicatie. Oprire SMS: Setari > Notificari”). **Confirmarea telefonului:** pasul 4 din „Pune service-ul pe picioare” se face pe loc — „Trimite codul” → cod de 6 cifre prin SMS → „Confirmă numărul”; codul merge 10 minute, 5 încercări, „Trimite alt cod” după 60 s; cel mult 5 coduri pe zi de cont și 5 pe zi pe același număr (nimeni nu poate bombarda un număr cu SMS-uri); după reîncărcarea paginii, codul așteaptă în continuare. Același panou e și în Cont (doar pentru service-uri, cât timp numărul nu e confirmat), iar cardul de identitate arată „Număr confirmat” / „Număr neconfirmat”. Colegii (nu proprietarul) văd că proprietarul confirmă numărul. Un număr nou trebuie confirmat din nou. `verify_phone_manually` rămâne pentru tine, ca rezervă. Fiecare canal (push, email, SMS) se trimite o singură dată: dacă push-ul nu a ajuns și se reîncearcă, SMS-ul și emailul nu pleacă a doua oară. Decizii: verificarea codului e o funcție a bazei de date (`check_phone_code`), nu o a doua Edge Function — e mai sigur (totul într-o tranzacție) și se testează în SQL; emailul către admin e mereu în română; linkurile din emailuri duc la `https://service-hub-app.netlify.app` până la lansare (secretul opțional `APP_URL` îl schimbă — de pus `https://service-hub.ro` în T19); limba conturilor create înainte de T13 și schimbată ulterior se sincronizează la următoarea schimbare de limbă (nu am rescris date existente). Testele din browser folosesc „înlocuitori” locali pentru Resend și SMSO și verifică tot drumul: SMS-ul cu codul, SMS-ul la cerere nouă, emailul de invitație cu linkul bun, emailurile de cont în engleză și română. **Pentru T14:** emailurile de plată (factură, sfârșit de perioadă gratuită, plată eșuată) se adaugă în `emailForEvent` (`_shared/emails.ts`) și în `EMAIL_EVENTS`, cu canalul `email` pe eveniment. **Pentru T16a:** suspendarea trimite deja emailul (trigger); adminul are nevoie de ecranul de moderare la care duce emailul de recenzie raportată (acum duce la `/intra`). **Pentru T19:** `APP_URL` = `https://service-hub.ro` și Site URL în Supabase Auth; emailurile de cont trebuie verificate și pe proiectul de test separat (acțiunea le instalează singură).

---

## T14a — Abonamentul (plata cu cardul)

**Scop:** service-urile plătesc 100 lei/lună după 90 de zile; cine nu plătește dispare din căutări.

**Surse:** FR §4.7, §6 (Subscription) · P12, P12b · ARCHITECTURE §12 · SERVICII_EXTERNE §5, §6.

**Include:**
- Ecranul Abonament (doar proprietarul): zilele rămase din perioada gratuită, prețul, ce include, status, următoarea plată, „Activează” (Stripe Checkout), „Gestionează” (portalul Stripe), lista facturilor.
- Edge Functions `stripe-checkout`, `stripe-portal`, `stripe-webhook` (semnătură verificată, fiecare eveniment o singură dată). Doar webhook-ul și adminul schimbă statusul.
- Regula de neplată: la sfârșitul perioadei gratuite fără plată sau după ultima încercare eșuată, service-ul devine inactiv (nu apare în căutări, nu primește programări noi, își păstrează datele), cu banner și buton de plată. Plata îl reactivează imediat.
- Avertizări la 7 zile și la 1 zi înainte de final, și la plată eșuată (push + email).
- Prețul per service (`price_ron`), ca primele 10 service-uri să-și păstreze prețul fix.
- Facturarea fiscală (SmartBill / Oblio, e-Factura) a trecut în **T14b**; aici fiecare plată are chitanța Stripe.

**Gata când:** în modul de test Stripe, un service plătește cu cardul de test, devine activ, anulează, iar la final de perioadă dispare din căutări.

**Ce testezi tu:** plata cu cardul de test `4242 4242 4242 4242`, orice dată viitoare, orice CVC; apoi anularea din portal.

**Pașii tăi:** cont Stripe pe firmă, produsul „Abonament Service-Hub” la 100 lei/lună, cheile de test ca secrete (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`), adresa webhook-ului, portalul clientului activat.

- [x] Făcut

Note: 1 migrare (`schema_version` = 19), Edge Functions noi `stripe-checkout`, `stripe-portal`, `stripe-webhook`; `delete-account` anulează acum și abonamentul Stripe (altfel cardul ar fi taxat după ștergerea contului). **Ecranul Abonament** (`/s/cont/abonament`, placa din Cont doar pentru proprietar, cu starea: „Perioadă gratuită · 74 de zile”, „Activ”, „Plată restantă”…): starea (coroana și zilele gratuite rămase din 90, cu bară; următoarea plată; plata eșuată și data reîncercării; „Abonamentul a expirat. Service-ul tău nu mai apare în căutări.”), planul unic (100 lei / lună, cu ce include), „Activează abonamentul” / „Plătește abonamentul” (pagina Stripe Checkout), „Gestionează abonamentul” (portalul Stripe: card, plăți, anulare la sfârșitul lunii plătite) și lista plăților cu chitanța Stripe. Se actualizează singur (Realtime): după plată, întors din Stripe, vezi „Mulțumim. Abonamentul e activ.” fără reîncărcare. Colegii nu văd abonamentul (nici în baza de date). **Doar webhook-ul schimbă starea** (semnătură verificată, fiecare eveniment o singură dată în `stripe_events`); funcția citește de fiecare dată abonamentul direct din Stripe, așa că evenimentele venite în altă ordine nu strică nimic. Stările: plată reușită → activ imediat (și înapoi în căutări); plată eșuată → „plată restantă”, service-ul rămâne în căutări cât Stripe reîncearcă (push + email la fiecare încercare eșuată); ultima încercare eșuată → inactiv; anulare din portal → activ până la sfârșitul lunii plătite, apoi „Anulat”; perioada gratuită terminată fără card → inactiv (verificat în fiecare oră). Inactiv înseamnă: nu apare în căutări, nu primește programări noi, programările existente continuă, datele rămân; plata îl reactivează imediat. **Avertizări** (push + email, doar proprietarului): la 7 zile și la 1 zi înainte de sfârșitul perioadei gratuite (la 07:00, doar dacă nu a pus cardul), la plată eșuată, când service-ul devine inactiv; plus email „Plată primită” cu chitanța. Pe Panou: banner în ultimele 7 zile gratuite și la plată restantă, iar motivul „Abonamentul a expirat” duce la Abonament. **Decizii:** (1) cardul pus în perioada gratuită doar se salvează — prima plată e la sfârșitul celor 90 de zile, nu pierzi zilele gratuite (cu mai puțin de 2 zile rămase, Stripe cere plata pe loc); (2) plata cere datele de facturare complete (denumire, CUI, Registrul Comerțului, sediu, email de facturare) — factura fiscală din T14b se emite pe firmă; (3) fiecare service plătește prețul lui (`subscriptions.price_ron`, fixat la înscriere): dacă e egal cu prețul din Stripe se folosește `STRIPE_PRICE_ID`, altfel același produs la suma service-ului — așa primele service-uri își păstrează prețul dacă îl schimbi mai târziu; (4) „Plată restantă” păstrează service-ul în căutări cât timp Stripe reîncearcă; (5) „Anulat” = s-a oprit la cererea service-ului, „Inactiv” = neplată sau sfârșit de perioadă gratuită; ambele scot service-ul din căutări. Testele din browser rulează tot drumul pe un „Stripe de test” local (pagină de plată și portal, webhook-uri semnate): perioadă gratuită → card salvat; inactiv → plată → activ, chitanță, email → anulare → sfârșitul lunii → anulat; plată eșuată → plată restantă → ultima încercare → inactiv; ecranul în engleză. **Pentru T14b:** `invoices` are deja rândul fiecărei plăți (`status = 'paid'`, `stripe_invoice_id`, suma, chitanța); factura fiscală completează `series`, `number`, `pdf_url`, `provider`, `status = 'issued'`, iar ecranul arată „Factura” lângă „Chitanța”. **Pentru T16b:** adminul schimbă starea sau prețul unui abonament (manual overrides) prin funcții cu `admin_audit_log`; `set_subscription_status()` ține deja `shops.active` în pas și anunță proprietarul.

---

## T14b — Facturarea (SmartBill / Oblio, e-Factura)

**Scop:** fiecare plată a abonamentului primește factura fiscală, raportată automat în e-Factura.

**Surse:** SERVICII_EXTERNE §6 · ARCHITECTURE §11, §12 · FR §4.7.

**Include:**
- Edge Function `issue-invoice`, pornită după fiecare plată (`invoices.status = 'paid'`): factura în SmartBill sau Oblio pe datele din `shop_billing`, seria și numărul, TVA după statutul firmei (cota e o setare, nu scrisă în cod), trimiterea în e-Factura.
- Descărcarea facturii din ecranul Abonament („Factura”, lângă „Chitanța”) și emailul cu factura.
- Comutator: fără cheia furnizorului nu se emite nimic (ca acum).

**Gata când:** o plată de test produce factura în contul de test SmartBill/Oblio, cu datele firmei service-ului.

**Pașii tăi:** decizia cu contabilul — SmartBill sau Oblio, seria facturilor, plătitor de TVA sau nu, ce se întâmplă la anulare (storno); contul la furnizor și cheia API ca secret.

- [ ] Făcut

Note: amânat (25 sept 2026) până la decizia cu contabilul; T15 s-a făcut înainte. De inclus și plățile rapoartelor de istoric (T15, persoane fizice).

**Colegi plătiți (cerut de Eduard după T16b, făcut):** abonamentul este 100 lei pe lună plus 20 lei pe lună pentru fiecare coleg care și-a făcut contul în service (invitația nu costă; în perioada gratuită nu se plătește nimic). În Stripe: al doilea rând „Cont angajat” × numărul de colegi (`STRIPE_SEAT_PRICE_ID`); când un coleg intră sau e scos, numărul se schimbă singur, cu calcul pe zile. Prețul pe coleg e în Setări platformă și se fixează la înscrierea fiecărui service (ca abonamentul). Ecranul Abonament arată „100 lei + 2 colegi × 20 lei”, Personal spune cât costă un coleg, adminul vede colegii plătiți și totalul lunar (și în CSV, și în venitul lunar). 1 migrare (`schema_version` = 23). **Pentru T14b:** factura fiscală trebuie să aibă și rândul „Cont angajat”.

**Prețul (hotărât cu Eduard după T19b, făcut):** abonamentul e **149 lei pe lună, fără TVA**; **primele 50 de service-uri** primesc prețul de lansare de **99 lei** și îl păstrează (trecerea la 149 se face singură la al 51-lea); **primul coleg cu cont e inclus**, fiecare coleg în plus **19 lei** (service-urile deja înscrise păstrează 20). Toate patru sunt în Setări platformă (preț, preț de lansare, locuri la lansare, colegi incluși) și se fixează la înscrierea fiecărui service. Pagina de prezentare arată oferta de lansare cât mai sunt locuri (niciodată câte service-uri s-au înscris), „fără TVA” și colegul inclus; Abonament și Personal spun „Primul coleg … e inclus”. Termenii: prețul de lansare, TVA-ul (se adaugă doar dacă firma devine plătitoare, cu anunț cu 30 de zile înainte) și „un cont = o persoană”. 1 migrare (`schema_version` = 26). Service-urile existente primesc și ele colegul inclus (preț mai mic, niciodată mai mare) și își păstrează prețul. 

**Drepturile colegilor (cerut de Eduard după T19b, făcut):** un coleg lucrează cu programările, constatările, devizele, lucrările, mesajele și istoricul; **doar proprietarul** schimbă setările (profil public și logo, program și zile libere, reguli și taxa de constatare, servicii, SMS-ul la cerere nouă și rezumatul zilnic), răspunde la recenzii și le raportează, vede totalul încasărilor (Istoric: colegul vede fiecare lucrare cu suma ei — el scrie devizele — dar nu și totalul și nici exportul CSV), plus ce era deja al lui (abonament, facturare, rapoarte, colegi, ștergerea service-ului). Pus în baza de date, nu doar ascuns: tabelele de setări și folderul logo-ului acceptă doar proprietarul, funcțiile pentru program, servicii și recenzii cer proprietarul. Colegul vede în Setări doar Notificări (push pe telefonul lui) și un rând care spune cine schimbă restul; pe Panou vede pașii de pornire fără linkuri. 1 migrare (`schema_version` = 27).

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 20), Edge Functions noi `report-checkout`, `generate-report`, `report-download`; `stripe-webhook` știe acum și de plata raportului. **Nu trebuie produs separat în Stripe:** plata folosește prețul din setările platformei (`report_price_ron`, 29 lei). **Ce lucrări intră:** doar lucrările finalizate ale clientului pe acea mașină, recunoscută după număr (fără spații, liniuțe sau litere mici) sau, fără număr, după marcă + model + an — exact ca istoricul mașinii. Lucrările altui proprietar pe același număr nu apar niciodată. **Previzualizarea** (`/c/garaj/<mașină>/raport` sau `/c/programari/<programare>/raport`, și pentru o mașină ștearsă din garaj): mașina (număr, an, serie șasiu), numărul de lucrări, perioada, totalul, kilometrajul la ultima lucrare, lista lucrărilor cu ultimele două estompate (o singură lucrare se vede întreagă), fraza „Raportul conține doar lucrările efectuate prin Service-Hub.”, limba raportului (Română / English) și „Plătește 29 lei”. Fără lucrări finalizate: „Nu există lucrări finalizate pentru această mașină.” și niciun buton. **Intrări:** butonul „Generează raport oficial — 29 lei” sub istoricul mașinii, rândul „Raport oficial pentru cumpărător” pe cardul din Garaj (doar cu lucrări) și placa „Rapoartele mele” din Cont. **Plata:** pagina Stripe; doar webhook-ul marchează raportul plătit, ia lucrările din acel moment și face PDF-ul pe loc; „Rapoartele mele” trece singur din „Se pregătește” în „Gata” (Realtime); clientul primește push + email „Raportul e gata”. Dacă PDF-ul nu iese, Stripe retrimite evenimentul, iar după 45 de secunde apare și butonul „Pregătește raportul acum”. **PDF-ul** arată ca `docs/reference-report.pdf`: antet, mașina, codul `SH-2026-000123`, tabelul cu coloana KM, total, „Km la ultima lucrare”, nota când citirile nu sunt crescătoare (datele nu se reordonează), blocul de verificare, mențiunea că nu e istoricul complet, „Pagina 1 din 2” pe rapoartele lungi; diacriticele apar corect (fontul Noto Sans e inclus în fișier). „Descarcă PDF” merge gratuit oricând; fișierul nu are un link public. **`/verifica`** (fără cont, și `?cod=…`): „Raport autentic” cu mașina, numărul, lucrările, perioada și data; „Raport anulat” pentru unul anulat; nimic despre service-uri, sume sau proprietar. Codul se poate scrie cu litere mici sau spații. **Decizii:** (1) PDF-ul se face în limba aleasă la plată (implicit limba aplicației) — util dacă vinzi mașina unui străin; (2) adresa de verificare din PDF e cea a aplicației (`service-hub-app.netlify.app/verifica` acum, `service-hub.ro/verifica` după ce pui `APP_URL` în T19) — altfel cumpărătorul ar ajunge pe pagina „în curând”; (3) un raport rămâne și după ștergerea contului vânzătorului, ca un cumpărător să-l poată verifica (nu conține date personale ale clientului); (4) raportul e o fotografie: lucrările de după plată cer un raport nou; (5) PDF-ul se descarcă prin funcție, nu printr-un link semnat (nu poate fi trimis mai departe din greșeală). **Pentru T14b:** plățile rapoartelor (persoane fizice, 29 lei) au nevoie și ele de document fiscal (bon/factură) — de discutat cu contabilul împreună cu abonamentul. **Pentru T16b:** anularea unui raport de către admin = `status = 'void'` (+ `void_reason`, `voided_at`) printr-o funcție cu `admin_audit_log`; lista „Rapoarte” a adminului citește `history_reports` (RLS o permite deja). **Pentru T18:** un link „Verifică un raport” pe pagina de prezentare. **După T16b (cerut de Eduard):** antet și subsol pe fiecare pagină a PDF-ului (cine l-a emis, mașina, codul, ce conține, unde se verifică, pagina n din m); tabelul curge pe câte pagini e nevoie, iar totalul, cifrele și nota finală merg mereu împreună cu ultima lucrare, deci nu mai rămân singure pe o pagină; caseta de verificare din corp a trecut în subsol (e pe fiecare pagină). Până la ~5 lucrări încap pe o pagină.

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 21), Edge Function nouă `admin-delete-account`; `geocode` primește acum și `{ shop_id }` de la admin; `delete-account` și `admin-delete-account` folosesc același cod (`_shared/accountDeletion.ts`). **Prezentare:** service-uri pe stări (active, perioadă gratuită, inactive, suspendate), clienți, recenzii raportate în așteptare, rezervări noi azi / 7 / 30 de zile cu stările lor, abonamente (plătite, perioadă gratuită care se termină în 7 zile, plată restantă), venitul lunar recurent și ultimele 50 de evenimente (service nou, client nou, rezervare, raportare, plată eșuată), fiecare cu link. **Service-uri:** listă cu căutare (nume, oraș, email, telefon, S-00001) și filtre (active, gratuit, inactive, suspendate, neverificate, șterse), în adresă; detaliul are starea și de ce nu apare în căutări, acțiunile (confirmă telefonul, suspendă / reactivează cu motiv, prelungește perioada gratuită, schimbă statusul abonamentului, editează datele publice, regulile și datele firmei, șterge), apoi proprietarul, profilul, regulile și programul, datele firmei, abonamentul și plățile, personalul, ultimele 20 de programări (+ „Vezi toate”), recenziile și jurnalul. **Clienți:** listă cu căutare și filtre (suspendați, cu neprezentări ≥ 3, email neconfirmat), detaliu cu mașini, programări, recenzii, conversații (doar citire), suspendă / reactivează, șterge. **Rezervări:** toate, filtrate în baza de date (stare, text: cod / număr / client / service, zilele programării, un service, un client), 100 odată până la 500; detaliul are pașii cu ore, fiecare versiune de deviz cu liniile, lucrarea, recenzia, conversația și „Anulează rezervarea” cu motiv (ambele părți anunțate). **Moderare:** recenziile raportate, cele mai vechi primele, cu vechimea (roșu după 5 zile lucrătoare); „Păstrează” / „Șterge” cu notă opțională; media se recalculează singură; dedesubt toate recenziile, cu căutare. **Jurnal de audit:** placă în Cont, fiecare acțiune cu cine, când, ce și „înainte → după”; fiecare detaliu (service, client, rezervare) își arată propriile intrări. Totul e live (Realtime), cu bulină pe Moderare. Doar adminul ajunge la ecrane și la funcții (testat în SQL și în browser). **Decizii:** (1) motivul suspendării și nota de moderare sunt interne (doar în jurnal); persoana suspendată primește emailul din T13, fără motiv; (2) la o recenzie păstrată e anunțat doar service-ul (clientul nici nu știe că a fost raportată); la una ștearsă, și clientul; (3) „Șterge service-ul” șterge contul proprietarului cu aceleași reguli ca „Șterge contul”: refuzat cât are programări active (întâi „Anulează rezervarea”), iar un service cu istoric e anonimizat, nu șters (obligație legală); (4) prelungirea perioadei gratuite e refuzată când abonamentul rulează în Stripe (Stripe ar încasa oricum la data lui) — se schimbă din panoul Stripe; statusul setat de mână poate fi schimbat înapoi de următorul eveniment Stripe; (5) „venit lunar recurent” = prețul abonamentelor active și cu plată restantă; (6) „Activ ultima dată” vine dintr-o ștampilă pusă de aplicație la fiecare pornire (cel mult o dată pe oră). **Pentru T16b:** jurnalul și `admin_audit()` sunt gata de folosit; abonamentele au deja acțiunile de bază în detaliul service-ului.

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 22), nicio Edge Function nouă (`dispatch-notifications` știe acum și de anunțuri). Toate uneltele sunt plăci în Contul adminului. **Abonamente și plăți** (`/admin/cont/abonamente`): fiecare abonament cu starea, prețul, următoarea plată (sfârșitul perioadei gratuite, reînnoirea sau reîncercarea Stripe), plățile și referințele Stripe; căutare și filtre; tab „Plăți” cu chitanța Stripe (și factura, după T14b). Un rând deschide service-ul, unde sunt corecturile: prelungirea perioadei gratuite și statusul (din T16a) și nou **„Schimbă prețul”** (prețul lunar al acelui service, pentru primii clienți cu preț fix; refuzat cât abonamentul rulează în Stripe — acolo se schimbă din panoul Stripe). **Rapoarte de istoric** (`/admin/cont/rapoarte`): toate rapoartele (cod, client, mașină, lucrări, sumă, date), „Descarcă PDF” și „Anulează raportul” cu motiv obligatoriu → pe `/verifica` apare „Raport anulat”, clientul nu-l mai poate descărca; banii nu se întorc singuri (returnarea se face din Stripe). **Catalog** (`/admin/cont/catalog`): categorii și servicii — adaugă, redenumește, pornește/oprește, mută sus/jos, mută un serviciu în altă categorie, iconiță din lista Lucide a catalogului; codurile nu se schimbă niciodată (programările vechi le folosesc); un serviciu oprit rămâne pe programările vechi, dar nu mai poate fi ales; oprirea unei categorii oprește și serviciile ei (le pornești apoi unul câte unul). **Setări platformă** (`/admin/cont/setari`): prețul abonamentului, al raportului, cota TVA (folosită din T14b), zilele gratuite, zilele pentru răspuns la deviz, clasamentul, regulile de pornire ale service-urilor noi și limitele împotriva abuzului; se trimite doar ce s-a schimbat, iar jurnalul păstrează „înainte → după”. Fiecare valoare se citește când se face înregistrarea (devizul la trimitere, prețul și perioada gratuită la înscriere, prețul raportului la plată), deci nimic existent nu se schimbă — testat în SQL (un deviz trimis înainte își păstrează termenul, unul trimis după primește noul termen). **Textele notificărilor** (`/admin/cont/setari/texte`): fiecare notificare push către clienți și service-uri, RO + EN; câmp gol = textul inițial; cuvintele între acolade care nu se completează la acea notificare sunt semnalate înainte de salvare; „Revino la textul inițial”. **Anunțuri** (`/admin/cont/anunturi`): către toți clienții, toate service-urile sau toată lumea, opțional doar într-un oraș; RO obligatoriu, EN opțional (gol = textul în română); „Previzualizează” arată anunțul în ambele limbi și la câți oameni ajunge (și câți primesc push), abia apoi „Trimite”; lista celor trimise cu câți l-au citit; „Retrage anunțul”. Clienții îl văd sus pe Caută, service-urile pe Panou, până la „Am citit” (cel mult 30 de zile), live. **Export** (`/admin/cont/export`, plus butonul „Descarcă CSV” pe Service-uri, Clienți, Rezervări, Moderare și Abonamente, care păstrează filtrele listei): CSV în limba interfeței (RO cu `;` și virgulă zecimală, ca Excel-ul românesc), orele în ora României; fiecare export intră în jurnal (conține date personale). **Jurnalul** arată toate acțiunile noi, cu link la unealta respectivă. **Decizii:** (1) „clienții dintr-un oraș” = clienții care au avut cel puțin o programare la un service din acel oraș (clienții nu au adresă); service-urile după adresa lor; numele orașului se potrivește fără diacritice („Brasov” = „Brașov”); (2) anunțurile se văd 30 de zile, apoi dispar singure; (3) textele modificate se aplică notificărilor push (emailurile păstrează textele lor); (4) anularea unui raport nu anunță clientul automat și nu returnează banii — le faci tu din Stripe; (5) prețul minim acceptat e 1 leu (Stripe nu încasează mai puțin). Testele din browser pentru plata Stripe (abonament, raport) nu au putut rula în mediul meu local (containerul funcțiilor nu poate descărca pachetul PDF de pe npm prin proxy); nu am atins acele funcții, în GitHub rulează normal.

---

## T17 — Rapoarte pentru service

**Scop:** ecranul care îl face pe patron să-și reînnoiască abonamentul.

**Surse:** P22 · FR §4.9 · demo (ecranul Rapoarte).

**Include:** tot din P22 — perioade, cele trei cifre cu comparația față de perioada anterioară, încasările pe 12 luni, lucrările pe tip de serviciu, clienți unici și reveniți, rata de acceptare a devizelor, taxele de constatare încasate, timpul mediu de răspuns la deviz, ocuparea și cea mai aglomerată zi, export CSV, starea „prea puține lucrări” sub 3. Graficele desenate în SVG. Vizibil doar proprietarului (conține încasările) — decizie pe care o poți schimba.

**Gata când:** cifrele se potrivesc cu Istoricul pentru aceeași perioadă.

**Ce testezi tu:** compari încasările din Rapoarte cu totalul din Istoric pe „Ultimele 3 luni”.

**Pașii tăi:** nimic.

- [x] Făcut

Note: 1 migrare (`schema_version` = 23): `shop_reports()` — datele pentru Rapoarte într-un singur apel, doar pentru proprietar (angajații primesc „Doar proprietarul service-ului vede rapoartele.”). Nicio Edge Function nouă, niciun pachet nou. **Unde:** placa „Rapoarte” în Cont, lângă Abonament, doar la proprietar (`/s/cont/rapoarte`; perioada stă în adresă, `?perioada=`). **Ce arată:** perioadele Luna aceasta (implicit) · Ultimele 3 luni · Anul acesta · Tot; trei cifre mari — Încasat, Lucrări, Valoare medie — fiecare cu „Crește cu 12%” / „Scade cu 8%” (săgeată + text, verde/roșu) față de aceeași bucată de perioadă dinainte, scrisă dedesubt („Comparat cu 1 aug – 25 aug.”); graficul „Încasări pe lună” (ultimele 12 luni, bare galbene cu suma deasupra, luna curentă îngroșată); „Lucrări pe tip de serviciu” (cele mai dese primele, număr și sumă, primele 8 + „Altele”); Clienți (unici, care au revenit — număr și procent, evidențiat —, lucrări per client); Devize (rata de acceptare cu bară și, sub 70%, fraza despre prețuri / devize prost explicate; devize refuzate; taxe de constatare încasate; timp mediu de răspuns); Ocupare (procent din capacitate, mașini pe zi, pe câte zile deschise, cea mai aglomerată zi, cu „Ai loc pentru mai multe lucrări.” sub 50% și „Aproape plin…” de la 90%); „Descarcă datele (CSV)” cu lucrările și taxele de constatare din perioadă, în același format ca Istoricul. Sub 3 lucrări finalizate: „Prea puține lucrări încă” + fraza din specificație. Live: o lucrare finalizată pe alt dispozitiv apare fără reîncărcare. Graficele sunt desenate în SVG, iar cititoarele de ecran primesc aceleași cifre ca tabel. **Cifrele se potrivesc cu Istoricul** (testat automat pe „Ultimele 3 luni”): aceeași regulă — lucrarea finalizată contează în ziua în care a fost finalizată (ora României), cu suma ei. **Decizii:** (1) „Luna aceasta” e comparată cu aceleași zile din luna trecută (1–25 aug. pe 25 sept.), nu cu toată luna — altfel orice lună în curs ar părea în scădere; la fel „Anul acesta” (anul trecut până la aceeași zi); „Tot” nu are comparație; (2) graficul pe luni arată mereu ultimele 12 luni, oricare ar fi perioada aleasă (așa cere P22); (3) „clienți care au revenit” = clienții din perioadă care au, în total, mai mult de o lucrare finalizată la tine; un client care și-a șters contul contează o dată pe lucrare; (4) „devize refuzate” include și devizele lăsate să expire (ca în Istoric), iar timpul de răspuns le lasă deoparte (clientul n-a răspuns); devizele înlocuite sau retrase nu sunt decizii; (5) ocuparea numără mașinile care au ocupat un loc (confirmate sau mai departe, inclusiv devize refuzate/expirate), nu cererile, anulările sau neprezentările, pe zilele deschise după programul și zilele libere de acum, de la înscrierea service-ului; (6) valoarea medie e rotunjită la leu. **Date demo locale:** „Atelier Demo” are acum un an de lucrări (doar în baza de test locală, nu în proiectul tău).

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

- [x] Făcut

Note: 1 migrare (`schema_version` = 25): `public_pricing()` — prețurile pentru service-uri (abonament, coleg, zile gratuite), citite fără cont. Nicio Edge Function nouă. Un pachet nou doar pentru teste (`@axe-core/playwright`, verificarea automată de accesibilitate). **Pagina publică** (`/`, P18, cu textele și contactul paginii „în curând”): sus logo, RO/EN, „Intră în cont” și „Creează cont”; titlul „Programarea la service ar trebui să dureze 2 minute.”, „Sunt client” / „Sunt service” (duc la cont nou cu rolul deja ales: `/cont-nou?rol=client` sau `?rol=service` — linkul îl poți trimite și direct unui service), „Pentru șoferi, gratuit”, o machetă a ecranului de căutare; Pentru șoferi (3 carduri); Pentru service-uri (3 carduri, prețul **citit din Setări platformă**: „100 lei pe lună · primele 90 de zile gratuite · fără contract”, plus colegul și „Zero comision”, „Înscrie-ți service-ul” și WhatsApp); Cum funcționează (4 pași); blocul de încredere (recenzii reale, poziția nu se cumpără); subsol cu email, telefon/WhatsApp, documentele legale și „Verifică un raport de istoric”. Fără cifre, testimoniale sau logo-uri inventate. **Distribuire:** titlu, descriere și imaginea `og-image.png` (1200 × 630, `node scripts/gen-og-image.mjs`), cu adresa site-ului pusă la build (Netlify `URL`, deci `service-hub.ro` după T19). **Pagina 404** („Pagina nu există”), și în aplicație pentru un rol. **Titlul tabului** urmează ecranul („Programări · Service-Hub”). **Încărcare:** fișierul de start a scăzut de la 1,16 MB la ~0,73 MB; ecranele clientului, ale service-ului și ale adminului sunt fișiere separate, încărcate după login (un client nu descarcă nimic din admin); după un deploy nou, o pagină deschisă se reîncarcă singură o dată. **Accesibilitate:** fiecare ecran al fiecărui rol (client 15, service 17, admin 17, paginile publice 7, conversația) trece verificarea WCAG 2.1 AA în română și engleză la 390, 820 și 1440 px, plus ținte de minim 44 px; reparat: butoanele RO/EN (40 → 44 px), textul gri de pe etichetele gri (contrast prea mic, acum `--muted-strong`), câteva linkuri mici din admin și din antetul conversației, un text estompat din Rapoarte; „Sari la conținut” la prima apăsare de Tab; titlu (h1) pe ecranul de login. Testat doar cu tastatura: de pe pagina publică la formularul de cont nou, login, sărit peste meniu, deschis un tab, cu inelul galben vizibil. **Fus orar:** testele rulează cu telefonul în Los Angeles, New York și Tokyo: o programare la 09:00 apare 09:00 în aceeași zi la client, la service, în mesajul automat și în alegerea orei, iar ora unui mesaj e ora României; testele unitare rulează și ele cu calculatorul în SUA și Japonia (și în GitHub). Anul maxim al mașinii și al înființării firmei se ia acum după România, nu după telefon. **Tipărirea** programului zilei (Panou) și a istoricului era deja făcută în T08/T10 și rămâne testată. **Decizii:** (1) am păstrat titlul și textele paginii „în curând” (inclusiv „Căutăm primele 10 service-uri… preț fix”) în locul titlului din P18 — sunt ale tale; le schimbăm oricând; (2) prețul de pe pagină vine din baza de date, ca să nu promită un preț vechi după ce îl schimbi din Setări platformă; fără conexiune apare „Perioadă gratuită la început, fără card și fără contract”; (3) macheta din pagină e decorativă (nume inventate „Atelier Demo”, „Service Exemplu”), ascunsă pentru cititoarele de ecran; (4) o adresă greșită din aplicație arată 404 în aplicație, nu mai trimite tăcut la ecranul principal. **Ajutor și contact (cerut de Eduard în T18):** în Contul clientului și al service-ului (și la colegi) un rând nou „Ajutor și contact” (`/c/cont/ajutor`, `/s/cont/ajutor`): „Trimite-ne un email” și „Scrie-ne pe WhatsApp”, care se deschid cu ID-ul contului deja scris (subiectul emailului, textul din WhatsApp), ID-ul afișat și o frază potrivită rolului (clientul scrie întâi service-ului din Mesaje; service-ul ne dă codul programării pentru abonament și plăți). Adminul nu îl are (el e echipa). Fără formular de contact încă: emailul și WhatsApp-ul ajung la început. **Șablon email Resend:** `docs/brand/email-resend.html`, pentru emailurile trimise de mână.

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

**Pașii tăi:** ce listează Claude; mutarea domeniului o faci împreună, pas cu pas. Ghidul: `docs/LANSARE.md`.

Împărțită în trei părți (25 sept 2026), fiecare cu pull request-ul ei:

### T19a — Monitorizare și mediu de test

Sentry (aplicația + Edge Functions) și proiectul Supabase de test pentru pull request-uri.

- [x] Făcut

Note: nicio migrare, niciun pachet nou. **Sentry** fără SDK-ul Sentry (un modul mic, al nostru, `_shared/sentry.ts`, folosit și de aplicație și de funcții — ~4 KB în plus în fișierul de start): pornește doar când există DSN-ul (`VITE_SENTRY_DSN` în Netlify, secretul GitHub `SENTRY_DSN` pentru funcții, pus în Supabase de „Deploy Supabase” împreună cu mediul — `production` / `test` — și commit-ul). **Ce ajunge în Sentry:** erorile neprinse din browser, ecranele care se strică, răspunsurile neașteptate ale bazei de date (cu numele funcției), baza de date rămasă în urmă pe site-ul publicat, orice funcție de pe server care răspunde 500 (webhook Stripe, plăți, ștergerea contului, rapoarte, notificări…), plus avertizări când Resend, SMSO sau Stripe refuză definitiv un email / SMS / o schimbare. **Nu ajung:** refuzurile normale (zi plină, limită), lipsa internetului, zgomotul browserului, erorile extensiilor. **Ce se trimite despre om:** doar id-ul contului și rolul; adresele pierd tokenurile (linkurile din email, invitațiile), iar emailurile, telefoanele și tokenurile din texte sunt înlocuite. Maxim 10 rapoarte pe încărcare de pagină, fiecare eroare o dată. **Ecran stricat:** acum apare „Ceva n-a mers pe acest ecran…” cu „Reîncarcă pagina”, meniul rămâne folosibil (înainte: pagină albă). **Mediul de test:** „Deploy Supabase” trimite pull request-urile pe proiectul de test (`SUPABASE_TEST_PROJECT_REF`, `SUPABASE_TEST_DB_PASSWORD`) și `main` pe cel real; până există proiectul de test, totul merge ca înainte (cu o avertizare); pe proiectul de test permite singur adresele linkurilor de test în Auth; rularea manuală alege proiectul. **Decizii:** (1) fără pachetul Sentry — ar fi adăugat ~25 KB și încă un furnizor de cod; modulul nostru e testat și ține datele personale departe; (2) hărțile de cod (source maps) se publică lângă fișiere, ca Sentry să arate linia exactă din cod fără pași în plus (nu conțin nimic secret; browserele le descarcă doar cu instrumentele de dezvoltator deschise); (3) un singur proiect Sentry pentru aplicație și funcții, separate prin etichetele `side` și `function` și prin mediu; (4) datele demo nu se pun pe proiectul de test (îți faci conturile de test o dată). Testat: 15 teste unitare (DSN, ștergerea tokenurilor și a datelor personale, stive Chrome/Firefox/Deno, limite), teste în browser cu un „Sentry de test” local (eroare de test, ecran stricat RO/EN la 390/820/1440, eroarea unui cont logat doar cu id și rol, webhook-ul Stripe căzut raportat de pe server); după fiecare rulare, toate rapoartele primite sunt în `test-results/sentry-reports.json`.

**După T19a (cerut de Eduard):** eroarea „permission denied” prinsă de Sentry-ul de test la testele automate nu era a aplicației: testul „Ține-mă minte” ștergea singur sesiunea (ca să simuleze browserul închis) cât timp pagina Caută încă își încărca datele; acum așteaptă întâi încărcarea. Rapoartele Sentry arată acum și pașii dinainte (logare, delogare, verificarea sesiunii, cererile refuzate), iar la „permission denied” și dacă sesiunea mai era pe dispozitiv — așa s-a găsit cauza. Rulare completă după reparare: niciun raport neașteptat.

### T19b — Documentele legale

Termenii, confidențialitatea și cookies actualizate (vezi „Include” de mai sus) și versiunile în engleză, afișate în aplicație după limbă. Datele firmei de la tine; forma finală o dai cu avocatul.

- [x] Făcut

Note: nicio migrare, niciun pachet nou. **Documentele** (`docs/legal/*.md` în română — varianta care se aplică — și `docs/legal/en/*.md` în engleză) sunt rescrise după aplicația de acum: rolurile și contul (18+), ordinea din căutare fără plasare plătită, programarea și limitele, anularea și neprezentările (indicatorul de la 3 în 90 de zile), constatarea / devizul pe poziții / taxa de constatare, kilometrajul (obligatoriu, verificat, apare în rapoarte), Garajul și alertele, raportul plătit și `/verifica`, recenziile (60 de zile, „Andrei M.”, verificare în 5 zile lucrătoare), colegii, abonamentul 100 lei + 20 lei / coleg cu 90 de zile gratuite și Stripe, datele clienților la service, mesajele, semnalarea conținutului și contestarea (DSA), suspendarea, ștergerea contului (ce se șterge, ce rămâne anonim), furnizorii (Supabase, Netlify, Resend, SMSO, Stripe, Sentry, Cloudflare Turnstile, Nominatim, serviciile push) și transferurile în afara UE, locația (rămâne pe telefon), notificările push / SMS / email, tot ce se păstrează în browser (cu numele exacte). Scoase: prețurile publice, încărcarea de poze și documente, „posturile”, planurile Start / Pro / Business, notițele interne despre clienți, platforma europeană SOL (închisă în iulie 2025). **Datele firmei** (denumire, sediu, Registrul Comerțului, CUI) stau într-un singur loc, `docs/legal/company.json`; cât sunt goale, documentele arată un chenar portocaliu „[de completat: …]”; emailul și telefonul sunt cele de pe pagina „în curând”. **Raportul plătit:** bifă nouă înainte de „Plătește” — acordul pentru livrarea imediată și pierderea dreptului de retragere de 14 zile (OUG 34/2014 art. 16 lit. m); fără ea nu pleacă nimic, iar funcția `report-checkout` refuză (`waiver_required`); acordul rămâne în datele plății din Stripe. `TERMS_VERSION` = `2026-09-25`. Testat: teste unitare (câmpurile, fără urme din ciorna veche, engleza are exact aceleași secțiuni, tabele și liste ca româna), în browser documentele publice RO/EN la 390/820/1440 și bifa raportului. **Rămas:** datele firmei (de la tine) și forma finală cu avocatul (întrebările sunt în `docs/LANSARE.md`, partea 3); după forma finală, `TERMS_VERSION` se schimbă din nou.

**Ajustări (cerute de Eduard după T19b, făcute):** butoanele de acțiuni din admin (service, client) stau într-o grilă cu celule egale, aceeași lățime și înălțime; la crearea contului parola se scrie de două ori („Repetă parola”); pagina cere browserelor și extensiilor de „dark mode” (Dark Reader) să nu o mai întunece o dată (culorile rămân ca pe telefon). **Reparat:** perioada gratuită se socotește pe calendarul României (un service înscris între 00:00 și 01:00 vara pierdea o zi la trecerea la ora de iarnă — migrarea `trial_local_days`, `schema_version` = 28); datele demo pentru teste folosesc ziua din București.

### T19d — Remindere pentru clienți: recenzie și revizie

Cerut de Eduard după T19b. **Cererea de recenzie:** a doua zi după ce mașina e gata (pe la 10:00, ora României), un push „Cum a fost la Atelier X? Lasă o recenzie” — o singură dată, doar dacă nu a lăsat deja; atingerea deschide programarea cu formularul de recenzie; plus un card pe Caută cât timp recenzia se mai poate lăsa (60 de zile). Fără email. **Reminderul de revizie:** fiecare serviciu din catalog primește un interval opțional în luni (ulei 12, lichid de frână 24…, setat de admin); cu ~2 săptămâni înainte de termen, după data ultimei lucrări de acel fel la mașina respectivă, push „Se apropie schimbul de ulei la Dacia Logan (ultimul: 12 oct., la Atelier X)” → programarea la același service, cu serviciul ales. O dată pe lucrare, oprit din Cont. Ambele merg și în aplicația de telefon (T20): aceeași notificare, același ecran.

- [x] Făcut

Note: 1 migrare (`client_reminders`, `schema_version` = 29), niciun pachet nou. **Cererea de recenzie:** zilnic la 10:00 (ora României), pentru lucrările terminate ieri (sau în ultimele 3 zile, dacă o rulare a fost ratată), fără recenzie, încă în cele 60 de zile: push „Cum a fost la Atelier X? Lasă o recenzie pentru Schimb ulei. Durează un minut și îi ajută pe alți șoferi.” O singură dată pe programare. Atingerea deschide Programări cu cardul lucrării și formularul de recenzie deja deschis. Pe Caută, un card „Cum a fost la Atelier X? Lasă o recenzie.” cu „Lasă recenzia” și „Nu acum” (ascunde cardul până închizi fila); dispare după ce lași recenzia. **Reminderul de revizie:** în Catalog (admin), fiecare serviciu are câmpul „Reminder de revizie (luni)”; completate de la început: schimb ulei 12, revizie 12, filtru aer / polen 12, filtru combustibil 24, bujii 36, lichid de frână 24, antigel 36, distribuție 60, încărcare clima 24, igienizare clima 12, anvelope 6 (vară/iarnă), revizie GPL 12, pregătire de iarnă 12; restul fără. Zilnic la 10:00, pentru fiecare mașină din Garaj și fiecare astfel de serviciu, ultima lucrare terminată prin aplicație dă termenul; cu 14 zile înainte (și până la 30 de zile după) vine push-ul „Dacia Logan: Schimb ulei — Ultima dată pe 12 oct. 2025, la Atelier X. Următoarea se apropie, pe la 12 oct. Programează-te din aplicație.” Atingerea deschide programarea la același service, cu serviciul ales. O dată pe lucrare; nu vine dacă ai deja o programare activă pentru același serviciu la aceeași mașină, dacă mașina nu mai e în Garaj sau dacă ai oprit reminderele din Cont („Remindere de revizie”, pornite implicit). **Decizii:** (1) doar push, fără email (cum ai cerut); (2) cererea de recenzie a doua zi, nu imediat — clientul abia a plecat cu mașina; (3) reminderul pleacă doar după lucrări făcute prin Service-Hub, pentru mașini salvate în Garaj (fără kilometri: nu știm câți km face omul pe lună; termenul e după timp); (4) intervalele sunt la tine în Catalog, le poți schimba oricând; (5) Politica de cookies are numele nou din browser (`sh_review_prompt_hidden`), iar Confidențialitatea menționează reminderele — schimbări mici, `TERMS_VERSION` rămâne. Testat: teste SQL (o singură cerere, nu pentru lucrări cu recenzie sau de azi, termenul și lucrarea nouă, programarea activă, oprit/pornit, ora 10, drepturile), teste unitare (textele RO/EN, datele cu an, linkurile), în browser la 390/820/1440, RO și EN: cardul de pe Caută, formularul deschis, rândul din Cont, câmpul din Catalog. **Rămas:** reminder după kilometri (poate mai târziu, dacă Garajul ține kilometrajul la zi).

**Completări (cerute de Eduard după T19d, făcute):** clientul poate opri din Cont și **cererea de recenzie** (rândul „Cerere de recenzie”, pornită implicit; oprită = fără push și fără cardul de pe Caută); atingerea reminderului de revizie deschide programarea cu **mașina deja bifată** la pasul 4 (`&masina=`); formularul de recenzie se deschide și când clientul e deja pe Programări când atinge notificarea; niciun reminder către un cont suspendat și niciun reminder de revizie pentru un serviciu oprit în catalog. 1 migrare (`review_requests_setting`, `schema_version` = 30).

**Scrisul (cerut de Eduard după T19d, făcut):** un singur font peste tot, **Inter**, inclus în aplicație (arată la fel pe iPhone, Android, Windows și Mac; înainte titlurile foloseau Arial Narrow, care lipsește pe telefoane, iar prețurile și orele un font de tip „mașină de scris”). Totul e scris normal, cu literă mare doar la început — titluri, butoane, etichete, stări; majuscule doar la marca SERVICE-HUB. Cifrele (prețuri, ore, km) au lățime egală, ca să stea aliniate. Aceleași reguli în emailuri (fontul sistemului, emailurile nu pot încărca fonturi) și în imaginea care apare când trimiți linkul pe WhatsApp / Facebook. Ghidul de brand și ARCHITECTURE §17 sunt actualizate. Pachet nou: `@fontsource-variable/inter` (fontul, ~130 KB descărcați o dată). **Rămas:** fișierele de logo din `docs/brand/logo` (pentru Canva, Facebook) au încă vechiul font; le refac după ce confirmi cum arată.

**Scrisul și în portal (cerut de Eduard, făcut):** cifrele „de lățime egală” din Inter lățeau și cratima, punctul și spațiile din jur, așa că în portal ID-urile, telefoanele și orele arătau ca la mașina de scris („C‑00001”, „P‑000001”). Acum doar cifrele 0–9 au lățime egală (un fișier mic, `src/styles/inter-figures.woff2`, 4 KB, inclus direct în CSS), restul rămâne ca pe pagina de prezentare. Notițele clienților nu mai sunt scrise înclinat (Inter e încărcat doar drept; browserul „înclina” literele strâmb). **Raportul PDF de istoric** folosește acum tot Inter (înainte Noto Sans + un font de tip „mașină de scris” la cifre), cu etichete scrise normal („Număr de înmatriculare”, „Cod raport”, „Data”), nu cu majuscule. Scriptul `scripts/gen-fonts.py` reface ambele fișiere de font. Nicio migrare, niciun pachet nou.

**Plata pe 3, 6 sau 12 luni (cerut de Eduard, făcut):** pe lângă plata lunară, service-ul poate plăti o dată la 3, 6 sau 12 luni, cu **5%, 10%, respectiv 15% reducere** (hotărât de Eduard), rotunjit la leu: 149 lei → 425 / 805 / 1.520 lei; prețul de lansare 99 lei → 282 / 535 / 1.010 lei (reducerea se cumulează, tot hotărât de Eduard); colegii plătiți primesc aceeași reducere (19 lei → 54 / 103 / 194 lei). Alegerea se face în Abonament, înainte de „Activează”, cu suma totală și „cam X lei pe lună” la fiecare variantă; abonamentul se reînnoiește pe aceeași perioadă și își păstrează reducerea chiar dacă procentele se schimbă apoi. Procentele se schimbă din Setări platformă (0–50%). Pagina de prezentare spune oferta; Termenii (RO + EN, §4.5) sunt actualizați, versiunea termenilor e `2026-09-26`. Adminul vede perioada în lista de abonamente și pe service. Un coleg adăugat pe un abonament pe mai multe luni se facturează imediat (pe zile), nu la reînnoire. 1 migrare (`billing_periods`, `schema_version` = 31), niciun pachet nou. **Rămas:** schimbarea perioadei unui abonament deja pornit (acum: anulezi și alegi din nou la final); plățile pe mai multe luni intră și ele în facturare (T14b).

**Textele, mai îngrijite (cerut de Eduard, făcut):** în toată aplicația, în emailuri, notificări și documentele legale (RO): „este” în loc de „e”, „aproximativ” în loc de „cam”, „acest / această” în loc de „ăla / asta”, „A apărut o eroare” în loc de „Ceva n-a mers”, „funcționează” în loc de „merge”, „Notificările sunt activate” în loc de „Gata.”. Adresarea rămâne cu „tu”. Emailurile de autentificare sunt refăcute din `authEmails.ts`.

**Verificarea telefonului rămâne (decis de Eduard, 26 sept 2026):** proprietarul service-ului își confirmă numărul prin SMS (o dată, ~0,05–0,08 lei) înainte să apară în căutări — numărul e public pe pagina service-ului și primește SMS-ul „Cerere nouă”. Clienții confirmă doar emailul. Adminul poate confirma numărul manual.

**Telefonul cu prefixul țării (cerut de Eduard, făcut):** la înregistrare și în Cont, lângă număr se alege țara („+40 ⌄”, România implicit; lista: UE, vecinii, Marea Britanie, Elveția, Norvegia, Turcia, SUA, Australia, cu numele în limba aplicației). Exemplul din câmp este acum „07xx xxx xxx” (nu un număr real). Numerele din alte țări se salvează în forma internațională (+49…). SMS-ul de confirmare merge doar la numere din România: un service cu număr din altă țară este confirmat de admin. Telefoanele publice ale service-ului rămân românești. Nicio migrare.

**O singură perioadă gratuită și fără ocolirea suspendării (cerut de Eduard, făcut):** baza de date păstrează o amprentă criptată a emailului și a telefonului (nu valorile în clar) pentru fiecare proprietar de service și pentru conturile / service-urile suspendate. Un service nou cu același email sau telefon ca unul anterior pornește fără perioadă gratuită și fără prețul de lansare („Perioada gratuită a fost folosită deja cu acest email sau acest telefon”). Un cont nou cu datele unui cont sau service suspendat se creează suspendat; adminul vede în jurnal „Cont suspendat automat” și îl poate reactiva (atunci amprentele suspendării se șterg). Amprentele se păstrează cât există contul și 3 ani după ștergere; Politica de confidențialitate (RO + EN, §3 și §5) spune asta. 1 migrare (`account_fingerprints`, `schema_version` = 32). Testele din browser folosesc acum câte un telefon unic pentru fiecare cont.

**Emailurile în Gmail pe iPhone (cerut de Eduard, făcut):** aplicația Gmail pe iPhone, în modul întunecat, inversează toate culorile unui email — al nostru ieșea gri-deschis cu maro. Acum fundalurile sunt făcute din „degradeuri” de o singură culoare (Gmail nu le atinge), marca SERVICE-HUB e o imagine (funcția nouă `email-logo`), iar textul stă în două straturi care, doar în Gmail, întorc culorile inversate înapoi. Rezultat (verificat cu o simulare a inversării Gmail, care reproduce exact captura ta): fundal închis, text deschis, marca portocalie; doar butonul portocaliu iese mai închis acolo — textul închis pe portocaliu nu se poate păstra. Celelalte aplicații (Gmail pe Android și pe web, Apple Mail, Outlook) arată ca înainte. **Reparat tot aici:** site-ul Netlify se numește `service-hubapp`, dar codul și acțiunea „Deploy Supabase” foloseau `service-hub-app` (numele din PORNIRE.md): linkurile din emailuri fără `APP_URL` și adresa principală din Auth pe proiectul de test duceau la o pagină care nu există. Acum e `service-hubapp` peste tot (și vechiul nume e acceptat).

### T19c — Verificarea finală și domeniul

`docs/LAUNCH_CHECK.md` (lista „Final check” + FR, parcursă automat cu Playwright pe mediul de test), CAPTCHA Turnstile pornit, `APP_URL` = `https://service-hub.ro`, mutarea domeniului, Site URL și adresele în Supabase Auth, cheile Stripe live (cu webhook-ul live), contul de admin real, copii de siguranță (planul Supabase Pro are copii zilnice — decizia ta, ~25 $/lună; pe planul gratuit proiectul se oprește după 7 zile fără activitate).

**Ștergerea conturilor de test (pregătită, 26 sep 2026):** `docs/sql/reset_before_launch.sql`, rulat de Eduard în SQL Editor pe proiectul real (`docs/LANSARE.md`, Partea 5), după golirea folderelor `logos` și `reports`. Șterge toate conturile de client și service cu tot ce au făcut, amprentele de cont, jurnalul admin și numerele (C-00001, S-00001, P-000001 de la capăt). Rămân adminii (cu numărul lor; următorul admin vine după ei), setările și catalogul. Refuză peste 300 de conturi. Testat în `tests/sql/93_reset_before_launch.sql` și pe stack-ul Supabase local (conturi, sesiuni, abonament de probă).

- [ ] Făcut

---

## T20 — Aplicațiile pentru iPhone și Android

**Scop:** Service-Hub se instalează din App Store și Google Play, pentru clienți și service-uri. Aceeași aplicație ca pe web, nu o rescriere. Se face după lansarea pe web (T19c).

**Include:**
- Capacitor în jurul aplicației React de acum: același cod, aceleași ecrane, aceeași bază de date; proiectele `ios/` și `android/` în repo.
- Notificări native (APNs pe iPhone, FCM pe Android) în `dispatch-notifications`, lângă Web Push: pe iPhone merg fără „Adaugă pe ecranul principal”. Un dispozitiv înregistrat per telefon, ca la push-ul de acum.
- Linkurile din emailuri (confirmare, parolă, invitații) deschid aplicația când e instalată (Universal Links / App Links pe service-hub.ro).
- Locația, apelul și WhatsApp prin telefon; bara de sus și butonul „Înapoi” de pe Android.
- **Plățile:** regulile Apple și Google pentru conținut digital. Raportul de istoric se cumpără pe site (aplicația deschide browserul), nu în aplicație, ca să nu intre sub comisionul de 15–30%; abonamentul service-urilor rămâne pe site. De confirmat la momentul respectiv cu regulile magazinelor.
- Construirea automată pe GitHub (calculatoare Mac pentru iPhone) și trimiterea spre TestFlight / testarea internă Google Play.
- Iconița, ecranul de pornire, capturile și textele pentru magazine (RO + EN), link spre Politica de confidențialitate; declarațiile de date din App Store și Google Play, după `docs/legal`.

**Gata când:** aplicația de test se instalează pe un iPhone (TestFlight) și pe un Android (testare internă), iar o programare făcută din ea aduce notificarea pe telefonul service-ului.

**Pașii tăi:** contul Apple Developer (99 $/an, pe firmă — cere D-U-N-S, câteva zile) și contul Google Play Console (25 $, o dată); acceptarea contractelor; accesul pentru chei (Claude îți spune exact ce și unde).

- [ ] Făcut
