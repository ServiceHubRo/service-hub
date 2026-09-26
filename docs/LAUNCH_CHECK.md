# Verificarea finală înainte de lansare

Lista „Final check” din `docs/lovable-prompts.md` și cerințele din `docs/FUNCTIONAL_REQUIREMENTS.md` (FR), fiecare cu testul automat care o dovedește. Testele rulează singure la fiecare pull request (GitHub → **CI**), pe o bază de date de test făcută de la zero, cu toate migrările și datele demo, în Chrome la **390, 820 și 1440 px**.

**Cum citești lista**

- ✅ — dovedit de un test automat (numele testului e în coloana a doua; fișierele sunt în `tests/`).
- 👤 — îl verifici tu, pe site-ul real, pentru că depinde de ceva ce un test nu poate atinge (telefonul tău, un email adevărat, o plată reală). Sunt adunate și în partea C.
- Coloana **Tu** e pentru bifa ta, după ce ai parcurs partea C.

**Ultima rulare completă:** 26 sept 2026, pe codul T19c (stack-ul Supabase local, ca în CI).

| Teste | Rezultat |
|---|---|
| Unitare (Vitest), 28 de fișiere | 381 trec |
| Baza de date (SQL), 41 de fișiere | toate trec |
| În browser (Playwright), 378 de rulări (126 de teste × 3 lățimi) | 368 trec, 10 sărite cu intenție (teste care au sens la o singură lățime, de exemplu meniul lateral doar la 1440 px) |
| Verificarea tipurilor, lint, build | trec |

---

## A. Lista „Final check”

### Structură și roluri

| Punct | Dovedit de | Tu |
|---|---|---|
| Clientul are 5 taburi: Caută, Garaj, Programări, Mesaje, Cont | ✅ `e2e/shell` „client sees exactly its five navigation items” | ☐ |
| Service-ul are 5 taburi: Panou, Programări, Istoric, Mesaje, Cont | ✅ `e2e/shell` „shop sees exactly its five navigation items” | ☐ |
| Clientul ajunge la istoricul unei mașini din trei locuri: Garaj, Cont și o programare finalizată | ✅ `e2e/history` „… client: the same car from three places” | ☐ |
| Un CUI greșit e respins cu mesaj clar | ✅ `e2e/shop-settings` „public profile and billing: validation …” („CUI invalid. Verifică cifrele …”); `unit/validators` | ☐ |
| Un IBAN greșit e respins | ✅ același test („IBAN invalid.”); `unit/validators` | ☐ |
| CUI, sediul social și IBAN-ul nu apar pe profilul public | ✅ `e2e/search` „shop page: … no fiscal data”; `sql/30_rls_isolation`, `sql/68_shop_page` | ☐ |
| Un atelier primește programări fără date fiscale | ✅ `e2e/booking` „four steps …” și `e2e/launch-check` (service-uri fără date de facturare) | ☐ |
| „Ai uitat parola?” trimite link, răspunsul e același indiferent dacă adresa există | ✅ `e2e/accounts` „password reset: neutral answer, link, new password, signed in” | ☐ |
| „Confirmă” apăsat de trei ori → o singură confirmare | ✅ `e2e/shop-bookings` „… one confirmation for three taps …”; `sql/60_create_booking` (același `request_id`) | ☐ |
| Fără internet apare bara „Fără conexiune”, la revenire dispare | ✅ `e2e/shell` „offline bar appears and disappears” | ☐ |
| Listele arată schelete la încărcare, nu „Nicio programare” urmat de conținut | ✅ `e2e/launch-check` „loading shows three skeleton cards, never the empty state first” | ☐ |
| Al 4-lea booking activ la același service e refuzat cu mesaj clar | ✅ `e2e/launch-check` „the fourth active booking …” („Ai deja 3 programări active la acest service.”); `sql/65_limits` | ☐ |
| Un service nou vede lista de 4 pași și nu apare în căutări până nu alege servicii | ✅ `e2e/shop-settings` „new shop: the four steps …”; `sql/71_shop_settings` (motivul `no_services`), `sql/67_search` | ☐ |
| Toată aplicația doar cu tastatura, cu inel de focus vizibil | ✅ `e2e/a11y` „keyboard only …”, `e2e/public` „keyboard only …”; verificările WCAG pe fiecare ecran | ☐ |
| O programare la 09:00 arată 09:00 și din Germania | ✅ `e2e/timezones` (Berlin, New York, Tokyo); toate testele din browser rulează cu ora Germaniei | ☐ |
| Nu pot finaliza o lucrare fără kilometraj | ✅ `e2e/job-flow` „partial approval, refusal with the fee, work, odometer …”; `sql/64_odometer` | ☐ |
| Un kilometraj mai mic decât ultimul e refuzat, cu valoarea anterioară | ✅ `e2e/job-flow` „odometer: lower than the last reading is refused and named …” | ☐ |
| Un salt de peste 50.000 km cere confirmare, dar nu blochează | ✅ același test („a big jump needs a tick”); `sql/64_odometer` | ☐ |
| Kilometrajul apare în istoricul clientului și în raportul PDF | ✅ `e2e/history` („105.400 km”), `e2e/report` (previzualizarea), `unit/report` (PDF-ul) | ☐ |
| Fiecare card din Panou deschide lista filtrată | ✅ `e2e/shop-bookings` „Panou counters open filtered lists …” | ☐ |
| Un card cu zero nu e apăsabil | ✅ `e2e/shop-bookings` „… a request arrives live …” („A counter at zero is not a link”) | ☐ |
| Rapoartele arată clienții reveniți și rata de acceptare a devizelor | ✅ `e2e/shop-reports` „Rapoarte: tile in Cont, periods …”; `sql/82_shop_reports` | ☐ |
| Cu sub 3 lucrări finalizate, rapoartele arată un mesaj, nu grafice goale | ✅ `e2e/shop-reports` „English: too few jobs, then the reports appear live …” | ☐ |
| Garajul nu apare nicăieri la service | ✅ `e2e/shell` „a shop never sees the garage” | ☐ |
| Nicio cale publică de a crea un cont de admin | ✅ `sql/20_signup` („nobody became admin through sign-up”), `e2e/launch-check` (rolul nu se poate schimba din consolă), `e2e/admin` „only the admin reaches the admin screens” | ☐ |
| Adminul vede cele 5 ecrane și fiecare acțiune a lui apare în jurnal | ✅ `e2e/admin` „overview and lists …”, „a shop: suspend, reactivate, extend, status, edit — each in the audit log”; `sql/80_admin` | ☐ |
| Fiecare cont are ID vizibil (C-00001 / S-00001) în Cont | ✅ `e2e/accounts` „client: sign up … see the account ID”, „shop: sign up …” | ☐ |

### Fluxul complet, cap la cap

| Punct | Dovedit de | Tu |
|---|---|---|
| Cont nou de client, cu bifa de termeni obligatorie și email de confirmare | ✅ `e2e/accounts` „sign-up refuses missing data …”, „client: sign up, confirm the email …” | ☐ |
| Până la confirmarea emailului, service-ul nu apare în căutări | ✅ `sql/71_shop_settings` (`email_unverified` → ascuns), `sql/20_signup` | ☐ |
| Caut „vulcanizare” și găsesc service-urile care oferă serviciul | ✅ `e2e/search` „name, city and service without diacritics …” | ☐ |
| Mă programez în 4 pași și primesc ecranul de confirmare | ✅ `e2e/booking` „four steps, success, Programări …” | ☐ |
| Service-ul confirmă, apoi apasă „În constatare” | ✅ `e2e/shop-bookings` „a request arrives live … inspection …” | ☐ |
| Service-ul trimite deviz; clientul îl vede cu poziții și total | ✅ același test („a quote of 3 lines the client sees”) | ☐ |
| Clientul debifează o poziție și acceptă restul — totalul se recalculează | ✅ `e2e/job-flow` „partial approval …” | ☐ |
| Service-ul apasă „În lucru”, apoi „Finalizare” | ✅ același test | ☐ |
| Clientul lasă recenzie; service-ul răspunde public | ✅ `e2e/job-flow`, `e2e/messages` „reviews: reply, edit, report …”, `e2e/search` „shop page: … reviews with replies” | ☐ |
| Pe alt flux: clientul refuză devizul și se înregistrează taxa de constatare | ✅ `e2e/job-flow` („refusal with the fee”); `sql/63_quotes` | ☐ |

### Cazurile care se uită

| Punct | Dovedit de | Tu |
|---|---|---|
| Un deviz fără răspuns expiră după N zile și eliberează locul din zi | ✅ `sql/63_quotes` („expiry releases the place”) | ☐ |
| Clientul primește reminder cu 24 h înainte de programare | ✅ `sql/76_notifications` („appointment 24 h before”) | ☐ |
| Service-ul își pune concediu și acele zile dispar din calendar | ✅ `e2e/shop-settings` („days off”), `sql/61_availability_capacity` („no slots on a holiday”) | ☐ |
| Sâmbăta cu program scurt afișează doar orele corecte | ✅ `sql/94_launch_check` (09:00–13:00 → 09:00…12:00; 08:00 și 13:00 refuzate) | ☐ |
| După termenul de anulare, clientul nu mai poate anula singur | ✅ `e2e/job-flow` „after the shop’s deadline the client is told to contact the shop” | ☐ |
| Service-ul marchează neprezentare pe o programare trecută | ✅ `e2e/shop-bookings` („Neprezentat” doar după ora programării), `sql/62_transitions` (`mark_no_show`, `too_early`) | ☐ |
| Un service neplătitor dispare din căutări, dar își păstrează datele | ✅ `e2e/subscription` „inactive after the free period: pay, back in search …”; `sql/78_subscription` | ☐ |
| Raportul de istoric se generează pe o mașină anume, aleasă de client | ✅ `e2e/report` „preview, pay, PDF …” | ☐ |
| Exportul gratuit din Cont a rămas gratuit și complet | ✅ `e2e/accounts` „Cont: … data export”; `sql/70_accounts` | ☐ |
| Pagina publică de verificare arată doar mașina și numărul de lucrări, fără sume și fără nume de service-uri | ✅ `e2e/report` („verified on /verifica without an account”: fără lei, fără service, fără nume) | ☐ |
| O mașină fără lucrări finalizate nu oferă butonul de raport | ✅ `e2e/report` „… a car without finished jobs gets no report” | ☐ |

### Notificări și timp real

| Punct | Dovedit de | Tu |
|---|---|---|
| Bannerul de notificări apare o dată, la ambele roluri | ✅ `e2e/push` „the banner asks in the app first …”, „the shop sees the banner on Panou …” | 👤 ☐ |
| „Activează” deschide fereastra browserului, nu una construită | ✅ `e2e/push` (cererea ajunge la browser); 👤 pe telefonul tău | ☐ |
| Refuzul nu redeschide bannerul; rămâne un buton în Cont | ✅ `e2e/push` „blocked in the browser: no second ask, Cont says where to allow them” | ☐ |
| Bannerul de locație funcționează la fel și apare „Aproape de tine” | ✅ `e2e/search` „"Aproape de tine", distances …”, „"Nu acum" hides the location banner for good” | ☐ |
| O programare nouă apare la service fără refresh | ✅ `e2e/shop-bookings` „a request arrives live …” | ☐ |
| Un mesaj nou apare în conversație fără refresh | ✅ `e2e/messages` „a conversation live on both sides …” | ☐ |

### Reguli care nu se văd, dar contează

| Punct | Dovedit de | Tu |
|---|---|---|
| Capacitatea pe 1, o programare → ziua devine gri pentru a doua | ✅ `e2e/booking` „… with capacity 1 the day turns grey for the next client” | ☐ |
| Reprogramare într-o zi plină → refuzată, programarea rămâne neschimbată | ✅ `e2e/shop-bookings` „in English: reschedule onto a day that fills up is refused and nothing moves …”; `sql/61_availability_capacity` | ☐ |
| Un service nou, fără recenzii, apare la mijlocul listei | ✅ `sql/67_search` („no reviews start mid-list at 4.3”) | ☐ |
| `UPDATE shops SET plan='standard'` din consola browserului — baza refuză | ✅ `e2e/launch-check` „the browser console cannot change what the database protects” (abonamentul, activ/suspendat, rolul); `sql/40_protected_columns` | ☐ |
| Un cont de service nu poate citi tabelul `cars` | ✅ același test (răspuns gol); `sql/30_rls_isolation` | ☐ |
| Un client nu poate modifica pozițiile sau totalul unui deviz primit | ✅ același test; `sql/40_protected_columns`, `sql/63_quotes` | ☐ |
| Un service nu poate accepta el însuși devizul în locul clientului | ✅ același test (`decide_quote` refuzat); `sql/62_transitions` | ☐ |
| Nicăieri nu apar prețuri publicate pe servicii | ✅ `sql/94_launch_check` (catalogul nu are unde să țină un preț); `e2e/booking` (pasul 1, fără prețuri) | ☐ |

### Prezentare

| Punct | Dovedit de | Tu |
|---|---|---|
| Logotipul: SERVICE- alb, HUB portocaliu, pe același rând, peste tot | ✅ `e2e/shell` „landing shows the logo without wrapping the wordmark …”, „logo wrench is black …” | ☐ |
| La 390, 820 și 1440 px nimic nu iese pe orizontală | ✅ `e2e/a11y` și `e2e/public`: **fiecare ecran** al fiecărui rol, RO și EN, la toate trei lățimile | ☐ |
| La 1440 px navigarea e în stânga, cu Cont și Deconectare jos | ✅ `e2e/launch-check` „at 1440 px the navigation is on the left …” | ☐ |
| Rezultatele căutării sunt unul sub altul, la orice mărime | ✅ `e2e/launch-check` „search results stand one under another, at every width” | ☐ |
| Comut pe engleză: niciun text netradus | ✅ build-ul (o cheie lipsă din `en.ts` oprește build-ul); `e2e/a11y` și `e2e/public`: pe fiecare ecran în engleză, niciun text din `ro.ts` | ☐ |
| Pagina publică se vede fără cont, cu documentele legale în subsol | ✅ `e2e/public` „landing: every section …”; `e2e/accounts` „legal documents are public …” | ☐ |

---

## B. Cerințele funcționale (FR), pe capitole

| FR | Ce | Dovedit de |
|---|---|---|
| §1 | Rolurile, rutele separate | ✅ `e2e/shell`, `unit/roles`, `sql/30_rls_isolation` |
| §2 | Conturi, „Ține-mă minte”, confirmare, parolă, email, ștergere, sesiune expirată | ✅ `e2e/accounts`, `sql/20_signup`, `sql/70_accounts`, `sql/92_account_fingerprints` |
| §3.1–3.2 | Căutare, filtre, favorite, „Aproape de tine”, pagina service-ului | ✅ `e2e/search`, `sql/67_search`, `sql/68_shop_page` |
| §3.3 | Programarea în 4 pași | ✅ `e2e/booking`, `sql/60_create_booking`, `sql/61_availability_capacity` |
| §3.4 | Garajul și alertele ITP / RCA / rovinietă | ✅ `e2e/booking` („garage”), `sql/72_garage` |
| §3.5 | Programările clientului, devizul, anularea | ✅ `e2e/job-flow`, `e2e/booking` |
| §3.6–3.6b | Istoricul mașinii, raportul plătit, `/verifica` | ✅ `e2e/history`, `e2e/report`, `sql/79_history_report`, `unit/report` |
| §3.7, §4.4 | Mesajele | ✅ `e2e/messages`, `sql/74_threads` |
| §3.8, §4.8 | Cont, ajutor și contact | ✅ `e2e/accounts`, `e2e/help`, `e2e/reminders` |
| §4.1–4.2 | Panoul și programările service-ului | ✅ `e2e/shop-bookings`, `sql/73_shop_bookings` |
| §4.3 | Istoricul reparațiilor | ✅ `e2e/history`, `sql/75_shop_history` |
| §4.5 | Recenziile | ✅ `e2e/messages`, `sql/66_messages_reviews_favorites` |
| §4.5b, §4.6 | Datele firmei, setările, colegii | ✅ `e2e/shop-settings`, `sql/71_shop_settings`, `sql/83_staff_seats`, `sql/86_staff_rights` |
| §4.7 | Abonamentul, perioadele de plată | ✅ `e2e/subscription`, `sql/78_subscription`, `sql/85_pricing`, `sql/91_billing_periods`; 👤 plata reală (partea C) |
| §4.9 | Rapoartele service-ului | ✅ `e2e/shop-reports`, `sql/82_shop_reports` |
| §5 | Adminul și uneltele lui | ✅ `e2e/admin`, `e2e/admin-tools`, `sql/80_admin`, `sql/81_admin_tools` |
| §6 | Regulile de business (capacitate, stări, taxa, limite, clasament) | ✅ `sql/60`–`sql/67`, `sql/90_concurrency` (două programări în aceeași clipă) |
| §7 | Notificările push, email, SMS, în aplicație, timp real | ✅ `e2e/push`, `e2e/email-sms`, `e2e/reminders`, `sql/76_notifications`, `sql/77_email_sms`, `sql/88_client_reminders`; 👤 pe telefon (partea C) |
| §10 | Calitate: butoane, offline, schelete, sesiune, accesibilitate, fus orar | ✅ `e2e/shell`, `e2e/a11y`, `e2e/launch-check`, `e2e/timezones`, `unit/ActionButton` |
| §11 | Aranjarea pe ecran | ✅ `e2e/a11y`, `e2e/public`, `e2e/launch-check` |
| T19a | Erorile ajung în Sentry | ✅ `e2e/monitoring`, `unit/monitoring` |
| T19c | Google vede doar site-ul publicat | ✅ `e2e/published` (robots.txt + sitemap), `e2e/public` (linkurile de test: „stați departe”), `unit/seoFiles` |

---

## C. Ce verifici tu, pe site-ul real

După pașii din `docs/LANSARE.md`, Partea 4, cu un service și un client reali (de exemplu un prieten cu service și telefonul tău ca client). Bifezi aici.

**Domeniul și contul**
- ☐ `https://service-hub.ro` deschide aplicația, cu lacăt; `www.service-hub.ro` și `service-hubapp.netlify.app` duc singure acolo.
- ☐ La **Intră în cont** apare căsuța Cloudflare și logarea merge.
- ☐ Cont nou de client: emailul de confirmare vine de la `notificari@service-hub.ro`, linkul începe cu `https://service-hub.ro` și te duce în aplicație.
- ☐ **Ai uitat parola?**: emailul vine, linkul merge, parola nouă funcționează.

**Service-ul**
- ☐ Cont nou de service: SMS-ul cu codul vine pe telefon; după cod și după alegerea serviciilor, service-ul apare în **Caută**.
- ☐ Cu SMS-ul „Cerere nouă” pornit, la o programare nouă vine SMS-ul.
- ☐ **Abonament → Activează**: pagina Stripe reală, cardul se salvează, nu se plătește nimic în perioada gratuită (apoi anulezi abonamentul de probă din Stripe).

**Pe telefon**
- ☐ Android (Chrome): **Activează** notificările → fereastra telefonului → la o schimbare de programare vine notificarea; atingerea deschide programarea.
- ☐ iPhone: bannerul spune să adaugi aplicația pe ecranul principal; după asta notificările funcționează la fel.
- ☐ Locația: „Aproape de tine” arată service-urile apropiate.

**Fluxul întreg** (client pe telefon, service pe laptop): programare → confirmare → constatare → deviz → acceptare parțială → în lucru → finalizare cu kilometraj → recenzie → răspunsul service-ului. Pe fiecare pas, celălalt vede schimbarea fără refresh și primește notificarea.
- ☐ Totul a mers.

**Raportul de istoric (29 lei, plată reală)**
- ☐ Clientul cumpără raportul pentru mașina reparată, descarcă PDF-ul, codul din PDF merge pe `https://service-hub.ro/verifica`. (Poți returna banii din Stripe → **Payments → Refund**.)

**Emailurile**
- ☐ Emailurile arată bine în Gmail (telefon și calculator) și în aplicația de mail a telefonului.

---

## D. Ce rămâne după lansare

- **T14b** — factura fiscală (SmartBill / Oblio, e-Factura), după decizia cu contabilul. Până atunci, fiecare plată are chitanța Stripe.
- **Datele firmei și forma finală a documentelor legale** cu avocatul (`docs/LANSARE.md`, Partea 3).
- **T20** — aplicațiile pentru iPhone și Android.
