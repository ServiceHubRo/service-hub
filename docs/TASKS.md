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

Note: 1 migrare (`schema_version` = 20), Edge Functions noi `report-checkout`, `generate-report`, `report-download`; `stripe-webhook` știe acum și de plata raportului. **Nu trebuie produs separat în Stripe:** plata folosește prețul din setările platformei (`report_price_ron`, 29 lei). **Ce lucrări intră:** doar lucrările finalizate ale clientului pe acea mașină, recunoscută după număr (fără spații, liniuțe sau litere mici) sau, fără număr, după marcă + model + an — exact ca istoricul mașinii. Lucrările altui proprietar pe același număr nu apar niciodată. **Previzualizarea** (`/c/garaj/<mașină>/raport` sau `/c/programari/<programare>/raport`, și pentru o mașină ștearsă din garaj): mașina (număr, an, serie șasiu), numărul de lucrări, perioada, totalul, kilometrajul la ultima lucrare, lista lucrărilor cu ultimele două estompate (o singură lucrare se vede întreagă), fraza „Raportul conține doar lucrările efectuate prin Service-Hub.”, limba raportului (Română / English) și „Plătește 29 lei”. Fără lucrări finalizate: „Nu există lucrări finalizate pentru această mașină.” și niciun buton. **Intrări:** butonul „Generează raport oficial — 29 lei” sub istoricul mașinii, rândul „Raport oficial pentru cumpărător” pe cardul din Garaj (doar cu lucrări) și placa „Rapoartele mele” din Cont. **Plata:** pagina Stripe; doar webhook-ul marchează raportul plătit, ia lucrările din acel moment și face PDF-ul pe loc; „Rapoartele mele” trece singur din „Se pregătește” în „Gata” (Realtime); clientul primește push + email „Raportul e gata”. Dacă PDF-ul nu iese, Stripe retrimite evenimentul, iar după 45 de secunde apare și butonul „Pregătește raportul acum”. **PDF-ul** arată ca `docs/reference-report.pdf`: antet, mașina, codul `SH-2026-000123`, tabelul cu coloana KM, total, „Km la ultima lucrare”, nota când citirile nu sunt crescătoare (datele nu se reordonează), blocul de verificare, mențiunea că nu e istoricul complet, „Pagina 1 din 2” pe rapoartele lungi; diacriticele apar corect (fontul Noto Sans e inclus în fișier). „Descarcă PDF” merge gratuit oricând; fișierul nu are un link public. **`/verifica`** (fără cont, și `?cod=…`): „Raport autentic” cu mașina, numărul, lucrările, perioada și data; „Raport anulat” pentru unul anulat; nimic despre service-uri, sume sau proprietar. Codul se poate scrie cu litere mici sau spații. **Decizii:** (1) PDF-ul se face în limba aleasă la plată (implicit limba aplicației) — util dacă vinzi mașina unui străin; (2) adresa de verificare din PDF e cea a aplicației (`service-hub-app.netlify.app/verifica` acum, `service-hub.ro/verifica` după ce pui `APP_URL` în T19) — altfel cumpărătorul ar ajunge pe pagina „în curând”; (3) un raport rămâne și după ștergerea contului vânzătorului, ca un cumpărător să-l poată verifica (nu conține date personale ale clientului); (4) raportul e o fotografie: lucrările de după plată cer un raport nou; (5) PDF-ul se descarcă prin funcție, nu printr-un link semnat (nu poate fi trimis mai departe din greșeală). **Pentru T14b:** plățile rapoartelor (persoane fizice, 29 lei) au nevoie și ele de document fiscal (bon/factură) — de discutat cu contabilul împreună cu abonamentul. **Pentru T16b:** anularea unui raport de către admin = `status = 'void'` (+ `void_reason`, `voided_at`) printr-o funcție cu `admin_audit_log`; lista „Rapoarte” a adminului citește `history_reports` (RLS o permite deja). **Pentru T18:** un link „Verifică un raport” pe pagina de prezentare.

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
