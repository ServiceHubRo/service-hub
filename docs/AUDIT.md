# Audit complet Service-Hub — 13 noiembrie 2026

Audit doar de citire, pe `main` la `6f07613` (după A12, `schema_version` 123). Niciun alt fișier din
proiect nu a fost modificat. Unde un lucru nu se poate dovedi din cod sau din testele rulate aici, scrie
„de verificat manual”.

**Ce s-a rulat efectiv în această sesiune**

| Verificare | Rezultat |
|---|---|
| `npm run typecheck` | trece, 0 erori |
| `npm run lint` | trece, 0 erori, 2 avertismente (`react-refresh/only-export-components` în `src/screens/admin/ActionPanels.tsx:85` și `src/screens/help/parts.tsx:25`) |
| `npm test` (Vitest) | 88 fișiere, 787 teste, toate trec |
| `npm run build` | trece; avertisment: fișierul de start are 1,12 MB (314 KB comprimat) — vezi PERF-01 |
| `npm run test:sql` (Postgres 16 local, toate cele 124 de migrări de la zero) | 115 fișiere de teste SQL, toate trec; datele demo se încarcă |
| Supabase local complet (Docker) + inspecție directă a bazei | 99 de tabele în `public`, toate cu RLS pornit; 613 funcții `security definer`, toate cu `search_path` fixat |
| Verificare vizuală în Chromium (Playwright), toate rolurile, la 375 / 768 / 1024 / 1440 / 1920 px, română (+ engleză la 375 și 1440) | 1.164 de măsurători pe 178 de ecrane și stări, 12 vederi (vizitator, client cu date și nou, firmă: administrator / manager / șofer / contabil, service cu date și nou, coleg de service, agent de suport, admin), 16 grupe de test trecute. 0 scroll orizontal, 0 elemente ieșite din ecran, 0 texte tăiate, 0 suprapuneri, 0 ținte sub 44 px, 0 câmpuri sub 16 px, 0 erori de pagină. Copie a testului din A9 (`tests/visual/audit.spec.ts`), rulată din folderul temporar, cu lățimile cerute aici și măsurători noi pentru calculator |
| Testele în browser din `tests/e2e` (Playwright, ~75 de fișiere) | **nu au fost rulate** (au nevoie de Edge Functions locale și de serviciile simulate; rulează pe CI la fiecare PR) |

---

## 1. Rezumat pe o pagină (pentru Eduard)

**Pe scurt: platforma e construită serios, iar partea de siguranță a datelor e foarte bună. Problemele
reale sunt trei: (1) lipsesc două lucruri obligatorii legal înainte de a încasa bani reali, (2) pe
calculator și pe tabletă multe ecrane arată ca un telefon întins, (3) aspectul nu e construit pe un
set fix de mărimi, deci micile diferențe se adună.**

Ce merge bine:

- **Datele sunt protejate în baza de date, nu doar în ecran.** Fiecare tabel are reguli de acces.
  Un client nu poate citi datele altui client, un service nu poate citi alt service, iar stările
  programărilor și devizelor se schimbă doar prin funcții verificate. Cele 115 seturi de teste ale
  bazei de date trec toate.
- **Nicio cheie secretă în aplicația din browser.** Doar valori publice, cum trebuie.
- **Pe telefon nu am găsit nimic stricat:** nicio pagină care se mișcă lateral, niciun câmp care
  mărește ecranul pe iPhone, niciun buton prea mic pentru deget, pe niciunul din ecranele măsurate.
- **Butoanele de salvare** nu pot trimite de două ori, arată că lucrează și spun ce s-a întâmplat
  dacă pică internetul, cu „Încearcă din nou”.
- Textele sunt în română corectă, cu diacritice corecte (ș, ț cu virgulă, nu cu sedilă), peste tot.

Ce trebuie rezolvat, în ordinea importanței:

1. **Facturile fiscale nu există încă.** Când un service plătește abonamentul, primește doar
   chitanța Stripe, fără factură fiscală și fără e-Factura. Nu există nicio numerotare de facturi.
   Înainte de plăți reale, legea cere factură. (SEC-01)
2. **Termenii și condițiile afișează public „[de completat: denumirea firmei]”** — datele firmei
   lipsesc. (SEC-02)
3. **Pe laptop și PC, listele importante sunt o singură coloană de carduri foarte late:** clienții,
   service-urile și programările din admin, programările clientului. Pe un ecran mare ar trebui tabele
   cu coloane, sortare și pagini. (DESK-01, DESK-02)
4. **Pe tabletă (768 px, iPad în picioare) aplicația e exact cea de telefon, doar mai lată.** (DESK-03)
5. **Multe formulare nu se trimit cu tasta Enter** pe calculator (adăugare programare la service,
   cheltuieli și kilometraj la flotă, catalog, centrul de ajutor). (FUN-01)
6. **Listele din admin încarcă tot deodată și se reîncarcă întregi la fiecare schimbare din țară.**
   Acum, cu puține conturi, nu se simte; la mii de clienți va fi lent. (PERF-02)
7. **Prima încărcare a aplicației e mare** (314 KB comprimat), pentru că trimite toate textele în
   română și în engleză oricui. Pe 4G slab se simte. (PERF-01)
8. **Aspectul:** 29 de mărimi de font diferite și peste 1.000 de spațieri scrise de mână în loc de
   valorile fixe ale designului. Nu se vede o greșeală mare nicăieri, dar se vede o lipsă de
   uniformitate între ecrane. (DS-01 … DS-04)

Ce nu e terminat (știut, în plan): plata abonamentelor pentru firme (flote), aplicația de iPhone,
publicarea în magazine, pașii de lansare (domeniu, Stripe real, CAPTCHA) și pornirea ștergerii
automate a datelor vechi după avizul juridic.

**Ce nu am putut verifica de aici** e la secțiunea 10: iPhone și Safari reale, Firefox, Edge,
tastatura pe un telefon real, plățile Stripe, emailurile, SMS-urile, proiectul Supabase real.

---

## 2. Harta ecranelor și a funcțiilor

### 2.1 Roluri și navigație

| Rol (în cerere) | Rol în aplicație | Adrese | Meniu (telefon: bara de jos · ≥1024 px: bara laterală) |
|---|---|---|---|
| Vizitator neautentificat | — | `/`, `/intra`, `/cont-nou`, `/confirma-email`, `/parola-uitata`, `/parola-noua`, `/invitatie/:token`, `/p/:token`, `/atelier/:shopId`, `/legal/:doc`, `/verifica` | fără meniu; pagina principală are antet propriu |
| Șofer | client (`/c/*`) + spațiul firmei (`/c/firme/:id`) | vezi 2.3 | Caută · Garaj · Programări · Mesaje · Cont; în spațiul firmei: Panou · Vehicule · Programări · Costuri (+ Cont) |
| Service | shop (`/s/*`), proprietar sau coleg | vezi 2.4 | Panou · Programări · Istoric · Mesaje · Cont |
| Admin | admin (`/admin/*`), după al doilea pas de autentificare | vezi 2.5 | Panou · Parteneri · Activitate · Suport · Platformă (Cont din antet) |
| Agent de suport | support (`/suport/*`), după al doilea pas | vezi 2.6 | Solicitări · Căutare · Centrul de ajutor · Proceduri · Cont |

Garda pe rol: `src/app/RoleGuard.tsx` (în browser) și RLS + funcții (în baza de date). Un rol care
intră pe adresa altui rol e trimis la propria pagină de start.

Navigația e completă pe ambele forme: telefon/tabletă (< 1024 px) au bara de jos cu 5 intrări și
antet; de la 1024 px bara laterală are aceleași intrări plus „Cont” și „Deconectare” jos. Nicio
funcție nu e accesibilă doar pe una din forme (verificat în `src/app/roles.ts`, `src/app/AppShell.tsx`).

Legendă stare: **C** = complet · **P** = parțial · **X** = doar placeholder / neînceput.
Coloanele „Tabele” = citiri directe; „Funcții DB” = RPC-uri; „Edge” = Edge Functions. Lista a fost
extrasă automat din importurile fiecărui ecran (`src/data/*`), deci poate omite apeluri indirecte.

### 2.2 Vizitator

| Adresă | Ecran (fișier) | Ce face | Componente principale | Tabele / Funcții DB / Edge | Stare |
|---|---|---|---|---|---|
| `/` | `screens/public/Landing.tsx` | Prezentare, prețuri, „Ai un service?”, desenată dinainte la build | Wordmark, LangSwitch, LandingMockups | `public_pricing` | C |
| `/intra`, `/cont-nou` | `screens/auth/AuthScreen.tsx` (+ `SignUpForm`, `SocialSignIn`) | Intrare, cont nou client/service, Google/Apple | Field, PasswordField, PhoneField, ActionButton, Checkbox | `complete_signup`, `check_referral_code`, `check_client_invite_code`, `email_domain_blocked`, `public_pricing` | C (Apple apare doar după configurare, LANSARE 4.5c) |
| `/confirma-email`, `/parola-uitata`, `/parola-noua` | `CheckEmail`, `ForgotPassword`, `NewPassword` | Confirmare email, resetare parolă | Field, ActionButton | Supabase Auth | C |
| `/invitatie/:token` | `InviteScreen.tsx` | Coleg invitat în service | idem | `get_staff_invite` + cele de la înscriere | C |
| `/p/:token` | `public/BookingLinkScreen.tsx` | Linkul din SMS pentru o programare adăugată de service | Card | `invite_preview` | C |
| `/atelier/:shopId` | `public/ShopLinkScreen.tsx` | Linkul / QR-ul propriu al service-ului | Card | — (redirecționează după cont) | C |
| `/legal/:doc` | `legal/LegalPages.tsx` | Termeni, confidențialitate, cookies (RO/EN) | LegalDocument | — | **P** — datele firmei goale (SEC-02) |
| `/verifica` | `public/VerifyScreen.tsx` | Verificarea unui raport oficial de istoric | Field | funcție publică de verificare | C |
| `*` | `public/NotFound.tsx` | 404 | EmptyState | — | C |
| `/dev/componente`, `/dev/flota` | doar în build-uri de test | Galeria de componente, previzualizare flotă | — | — | C (doar test) |

### 2.3 Șofer (client) și spațiul firmei

| Adresă | Ecran | Ce face | Componente | Tabele / Funcții DB / Edge | Stare |
|---|---|---|---|---|---|
| `/c/cauta` | `client/search/SearchScreen.tsx` | Căutare service-uri, filtre, hartă, „Aproape de tine”, zone în curând, alerte documente | Filters (dialog), SearchField, ShopsMap (Leaflet), Card, Skeleton, EmptyState | `shops`, `cars`, `profiles`, `area_waitlist`, `service_categories` / `search_shops`, `search_card_extras`, `shop_offers`, `list_service_areas`, `join/leave_area_waitlist` / `dispatch-notifications` (cheia push) | C |
| `/c/service/:id` | `client/shop/ShopPage.tsx` | Pagina publică a service-ului, galerie, recenzii, hartă | PhotoGallery (dialog), Stars, ShopAvatar | `get_shop_page` (timp real) | C |
| `/c/service/:id/programare` (+`/trimisa`) | `client/booking/BookingFlow.tsx` + `CarStep` | Programare în 4 pași, listă de așteptare pe oră | Stepper, Checkbox, BottomBar, ActionButton | `cars`, `slot_waitlist` / `get_availability`, `create_booking`, `fleet_bookable_vehicles`, `join/leave_slot_waitlist`, `my_no_show_summary` | C |
| `/c/garaj`, `/c/garaj/nou`, `/c/garaj/:id` | `client/garage/*` | Mașinile, ITP/RCA/rovinietă, ulei, unire dubluri | Card, Field, SelectField | `cars` (scriere directă cu reguli), `services` / `merge_cars`, `my_imported_jobs` | C |
| `/c/garaj/:id/istoric`, `/c/programari/:id/istoric`, `/c/cont/istoric` | `client/history/*` | Istoricul fiecărei mașini | Card | `cars`, `platform_settings` (coloane publice) / `my_imported_jobs` | C |
| `/c/garaj/:id/raport`, `/c/programari/:id/raport`, `/c/cont/rapoarte` | `client/report/*` | Raport oficial de istoric (29 lei), descărcare | Card, ActionButton | `history_reports` / `history_report_preview`, `my_client_referrals` / `report-checkout`, `generate-report`, `report-download` | C |
| `/c/programari` | `client/bookings/ClientBookingsScreen.tsx` | Programări active/încheiate, deviz (acceptare totală/parțială), anulare, recenzie, contestare neprezentare | ClientBookingCard, InlinePanel, ActionButton, Stepper | `bookings`, `services` / `my_company_bookings`, `cancel_booking`, `decide_quote`, `submit_review`, `dispute_no_show`, `review_window_days` (timp real) | C |
| `/c/programari/:id/preluare` | `client/intake/ClientIntakeScreen.tsx` | Confirmarea fișei de preluare | Intake | `vehicle_intakes` / `confirm_vehicle_intake` | C |
| `/c/mesaje`, `/c/mesaje/:threadId`, `/c/mesaje/echipa` | `messages/*`, `notices/TeamNoticesScreen` | Conversații live, anunțurile echipei | composer lipit jos | `messages`, `notices`, `notice_reads` / `list_threads`, `send_message`, `mark_thread_read` (timp real) | C |
| `/c/cont` (+ `legal`, `notificari`, `favorite`, `firma`) | `account/*`, `client/favorites` | Profil, limbă, notificări, date pentru deviz, descărcare date, ștergere cont, favorite | Section, Tile, ActionSwitch | `profiles`, `favorites` / `export_my_data`, `cancel_email_change`, `my_client_referrals` / `delete-account` | C |
| `/c/cont/ajutor` (+ `categorie`, `articol`, `solicitari`, `sugestii`) | `account/HelpScreen`, `help/*`, `requests/My*`, `suggestions/*` | Centrul de ajutor, solicitări către suport cu fișiere, sugestii | Attachments | `suggestions` / `help_center`, `create_support_request`, `my_support_requests`, `reply_my_support_request`, `submit_suggestion` / `support-files` | C |
| `/c/cont/firme`, `/c/cont/firme/:id`, `/c/firme/invitatie/:token` | `client/companies/*` | Firmele mele, membri, roluri și drepturi, bugete, invitații | Disclosure, SelectField | `fleet_plans` / `create_company`, `get_company`, `invite_company_member`, `set_company_member_rights`, `set_company_rules`, `transfer_company_admin` … | C (vizibil doar cu `fleet_enabled`) |
| `/c/firme/:id?sectiune=…` | `fleet/FleetSpaceScreen.tsx` + `FleetSections` | Spațiul firmei: Panou, Vehicule, Vehicul, Programări, **Costuri (cheltuieli)**, Rapoarte, Membri, Cont, Abonament | FleetCharts (SVG), PlanGate | `cars`, `fleet_plans` / ~40 funcții `fleet_*` (cheltuieli, mentenanță, kilometraj, incidente, aprobare devize, rapoarte, export) / `fleet-files` | **P** — „Abonament și facturare”: „Plata cu cardul și schimbarea planului nu sunt încă disponibile” (FUN-02) |
| `/c/preia/:token` | `client/claim/ClaimScreen.tsx` | Preluarea unei programări adăugate de service | Card | `claim_booking`, `invite_preview` | C |

### 2.4 Service (proprietar și coleg)

| Adresă | Ecran | Ce face | Componente | Tabele / Funcții DB / Edge | Stare |
|---|---|---|---|---|---|
| `/s/panou` | `shop/dashboard/Dashboard.tsx` | Azi, cereri, primii pași, avertizări abonament | TodayBoard (tabel), Banner, Guide | `shops` / `get_shop_setup` | C |
| `/s/programari` (+ `noua`, `import`) | `shop/bookings/*` | Cereri și programate, confirmare, reprogramare, constatare, lucru, finalizare cu km, neprezentare; programare adăugată de service; import Excel/CSV | ShopBookingCard, ViewSelect, InlinePanel, ActionButton | `services`, `shop_services`, `shop_clients`, `shop_imports` / `list_shop_bookings`, `confirm_booking`, `decline_booking`, `reschedule_booking`, `start_inspection`, `start_work`, `complete_job`, `mark_no_show`, `shop_create_booking`, `shop_import_*` (timp real) | C |
| `/s/programari/deviz/:id`, `/s/programari/preluare/:id` | `QuoteEditorScreen`, `IntakeScreen` | Devizul (manoperă, piese, TVA, variante), fișa de preluare | bară de trimitere lipită jos | `send_quote`, `replace_quote`, `withdraw_quote`, `save_vehicle_intake` | C |
| `/s/programari/fisa/:id`, `/s/istoric/fisa/:id` | `shop/vehicle/VehicleFileScreen.tsx` | Fișa mașinii | Card | `shop_vehicle_file` | C |
| `/s/istoric` | `shop/history/ShopHistoryScreen.tsx` | Istoricul reparațiilor, căutare, tipărire, paginat | tabel pe calculator | `list_shop_history` (paginat), `list_imported_jobs` (timp real) | C |
| `/s/mesaje` | idem client | Conversații | | | C |
| `/s/cont`, `/s/cont/recenzii`, `/s/cont/link`, `/s/cont/rapoarte` | `account/*`, `shop/reviews`, `shop/link`, `shop/reports` | Recenzii (răspuns, raportare), link și QR, rapoarte (încasări, ocupare) | Charts (SVG, tabel) | `list_my_shop_reviews`, `reply_review`, `report_review`, `shop_reports`, `my_shop_id` | C |
| `/s/cont/abonament` | `shop/subscription/SubscriptionScreen.tsx` | Stare, perioadă gratuită, plată Stripe, portal, lista plăților cu chitanța | Card, Banner, ActionButton | `subscriptions`, `invoices`, `shop_billing` / `my_subscription_offers`, `my_referrals` / `stripe-checkout`, `stripe-portal` | **P** — fără factură fiscală (SEC-01) |
| `/s/cont/setari/*` | `shop/settings/*` | Profil public, program și închideri, reguli (capacitate, avans, anulare), servicii, vitrina (poze), devize (numerotare), facturare (date fiscale, ANAF), personal (colegi) | SettingsLayout, bară de salvare lipită jos | `shops`, `shop_hours`, `shop_closures`, `shop_services`, `shop_photos`, `shop_billing`, `shop_staff` / `save_shop_hours`, `set_shop_services`, `set_quote_next_number`, `list_shop_staff`, `invite_staff` / `geocode`, `verify-company`, `invite-staff` | C |
| `/s/cont/notificari` | `NotificationSettings.tsx` | Push, email, SMS, rezumat zilnic | Switch | `shops`, `profiles` | C |

### 2.5 Admin

| Adresă | Ecran | Ce face | Funcții DB / Edge | Stare |
|---|---|---|---|---|
| `/admin/panou` | `admin/OverviewScreen.tsx` | Cifre, activitate, suport | `admin_overview`, `support_dashboard` (timp real) | C |
| `/admin/parteneri/clienti` (+ `/:id`) | `ClientsScreen`, `ClientDetailScreen` | Listă, fișă, suspendare, credit raport, ștergere | `admin_list_clients` (**fără paginare**), `admin_get_client`, `admin_set_account_suspended`, `admin_grant_report_credit` / `admin-delete-account` | C |
| `/admin/parteneri/service-uri` (+ `/:id`) | `ShopsScreen`, `ShopDetailScreen` | Listă, fișă, suspendare, abonament manual, telefon verificat | `admin_list_shops` (**fără paginare**), `admin_get_shop`, `admin_set_shop_suspended`, `admin_set_subscription_*`, `admin_extend_trial`, `admin_verify_phone` / `geocode`, `verify-company`, `admin-delete-account` | C |
| `/admin/parteneri/firme`, `/anaf`, `/duplicate` | `FleetsScreen`, `AnafScreen`, `VehicleDuplicatesScreen` | Firme și planuri, verificare ANAF, vehicule duble | `admin_list_fleet_companies`, `admin_set_company_plan`, `admin_list_company_checks`, `admin_vehicle_duplicates` / `verify-company` | C |
| `/admin/activitate/programari` (+ `/:id`) | `BookingsScreen`, `BookingDetailScreen` | Programări cu filtre, „mai multe”, anulare forțată | `admin_list_bookings` (cu limită), `admin_get_booking`, `admin_force_cancel` | C |
| `/admin/activitate/moderare`, `/contestatii` | `ModerationScreen`, `NoShowDisputesScreen` | Recenzii raportate și suspecte, contestații | `admin_list_reviews` (fără limită), `admin_decide_review`, `admin_list_suspect_reviews`, `admin_decide_no_show_dispute` | C |
| `/admin/activitate/abonamente`, `/rapoarte`, `/export` | `SubscriptionsScreen`, `ReportsScreen`, `ExportScreen` | Abonamente și plăți, rapoarte de istoric, exporturi Excel | `admin_list_subscriptions` (fără limită), `admin_list_history_reports`, `admin_export` / `report-download` | C |
| `/admin/suport/*` | `requests/*`, `LegalHoldsScreen`, `HelpAdminScreen`, `HelpArticleEditScreen`, `procedures/*`, `TextReviewsScreen` | Solicitări, păstrare legală, centrul de ajutor, proceduri, sugestii de verificat | `support_*`, `admin_*_legal_hold`, `admin_help_*`, `admin_procedure_*`, `staff_procedure_*` / `support-files` | C |
| `/admin/platforma/*` | `SettingsScreen`, `TextsScreen`, `NoticesScreen`, `ZonesScreen`, `CatalogScreen`, `AuditScreen`, `SecurityScreen`, `FleetFailedEventsScreen`, `TeamScreen`, `AdminsScreen`, `RetentionScreen` | Setări platformă, textele notificărilor, anunțuri, zone, catalog servicii, jurnal, securitate, echipa de suport, administratori, retenția datelor | `admin_get/update_settings`, `admin_send_notice`, `admin_set_area_mode`, `admin_*catalog*`, `admin_list_audit` (paginat), `admin_security_events` (paginat), `admin_grant/revoke_support`, `admin_set_retention_job` … | C; retenția **P** (oprită până la avizul juridic) |
| adresele vechi | `LegacyRedirect.tsx` | Redirecționări de dinainte de A1 | — | C |

### 2.6 Agent de suport

| Adresă | Ecran | Ce face | Funcții DB / Edge | Stare |
|---|---|---|---|---|
| `/suport/solicitari` (+ `/:id`) | `requests/InboxScreen`, `RequestScreen` | Coada de solicitări, preluare, răspuns, note interne, escaladare | `support_inbox` (paginat), `support_get_request`, `support_reply_request`, `support_add_note`, `support_escalate_request` / `support-files` | C |
| `/suport/cautare` (+ `/:id`) | `support/SearchScreen`, `AccountScreen` | Căutarea unui cont, fișa fără date private | `support_search_accounts`, `support_get_account` | C |
| `/suport/centrul-de-ajutor/*` | `help/*` | Centrul de ajutor (citire) | `help_center` | C |
| `/suport/proceduri/*` | `procedures/*` | Proceduri interne, confirmare de citire | `staff_procedure_*` | C |
| `/suport/sugestii-de-verificat` | `TextReviewsScreen` | Textele sugestiilor vechi | `support_list_suggestion_reviews` | C |

### 2.7 Funcțiile platformei, pe domenii

| Domeniu | Unde | Stare | Note |
|---|---|---|---|
| Autentificare | Supabase Auth, `complete_signup`, `RoleGuard`, al doilea pas (TOTP) pentru admin și suport (`MfaGate`), „Ține-mă minte”, Google, Apple | C | CAPTCHA Turnstile pregătit, pornit la lansare (T19e) |
| Programări | `create_booking` cu blocare pe zi și pe oră, mașina de stări prin funcții, listă de așteptare, programări adăugate de service, neprezentări | C | testat la concurență în SQL |
| Devize | numerotare pe service alocată în baza de date cu blocare (`assign_quote_number`), variante, acceptare parțială, expirare | C | |
| Cheltuieli (flote) | `FleetCosts.tsx`, `fleet_*expense*`, bugete, rapoarte, export | C | doar pentru firme, cu `fleet_enabled` |
| Abonament service | Stripe Checkout + portal + webhook semnat, perioadă gratuită, preț de lansare pe oraș, colegi plătiți | C (test) | Stripe real la lansare (T19e) |
| Facturare fiscală | `invoices.series/number/pdf_url` există dar nu se completează nicăieri | **X** | T14b, SEC-01 |
| Abonament flote | planuri, perioadă de test, limite în baza de date | **P** | fără plată (FUN-02) |
| Raport oficial de istoric | `report-checkout`, `generate-report`, `report-download`, `/verifica` | C | |
| Recenzii | `submit_review`, răspuns, raportare, moderare, detecție suspecte | C | |
| Notificări | `notification_events` → `dispatch-notifications` (pg_cron): Web Push, FCM (Android), email (Resend), SMS (SMSO), ore de liniște | C | iPhone fără „Adaugă pe ecranul principal”: T20d |
| Căutare | `search_shops` (nota ponderată, fără plasare plătită), distanță separată, hartă | C | hartă: OSM implicit (SEC-05) |
| Setări | service: 9 pagini; platformă: setări, texte, zone, catalog | C | |
| Suport și ajutor | solicitări cu fișiere, centrul de ajutor, proceduri, păstrare legală | C | retenția oprită |
| Aplicații native | Android de test (Capacitor) | P | iPhone (T20d) și magazinele (T20c) neîncepute |

---

## 3. Funcționalitate

### 3.1 Ce am verificat în cod și e în regulă

- **Fără butoane moarte și fără link-uri goale:** 0 `href="#"`, 0 `onClick` gol, 0 `window.confirm` /
  `alert()`, 0 `console.log`, 0 `TODO/FIXME` în `src/` și `supabase/functions/`.
- **Dublu-submit:** fiecare scriere trece prin `ActionButton` (`src/components/ActionButton.tsx`):
  se blochează la apăsare, spinner fără să-și schimbe lățimea, eroare în pagină cu „Încearcă din nou”
  care reia **același** `request_id` (serverul întoarce primul rezultat dacă primul apel a ajuns).
- **Eroare de rețea:** citirile au termen (`fetchTimeout`), ecranele au `LoadError` cu reîncercare,
  bara „offline” apare la pierderea conexiunii, timpul real se resincronizează după reconectare.
- **Stări:** încărcare = schelete, gol = `EmptyState`, eroare = `LoadError`, fără permisiune =
  ecran dedicat (ex. `OwnerOnlySettings`, colegul care deschide Abonament). Măsurătoarea vizuală
  a parcurs și stările goale (cont nou de client și de service) și o stare de eroare.
- **Validare:** validatoare comune pentru CUI, IBAN, Registrul Comerțului, cod poștal, telefon,
  kilometraj (`src/lib/validators`), repetate în baza de date.

### 3.2 Probleme găsite

Sunt în tabelul general (secțiunea 8): FUN-01 (Enter nu trimite multe formulare), FUN-02 (plata
flotelor), FUN-03 (Esc nu închide panourile de confirmare), FUN-04 (pașii de lansare), FUN-05
(retenția oprită), FUN-06 (iPhone/magazine).

---

## 4. Securitate și date

### 4.1 RLS, tabel cu tabel (rezumat din baza locală, după toate migrările)

- **99 / 99 tabele au RLS pornit.** Niciun tabel fără RLS.
- **67 de reguli (policies)**; ~30 de tabele au RLS fără nicio regulă = nimeni nu le citește direct,
  doar prin funcții (ex. `notification_events`, `push_config`, `stripe_events`, `shop_quote_numbers`).
- **Scriere directă din browser** (în afară de funcții) doar pe coloane anume:
  `cars` (proprietarul), `profiles` (propriul rând: nume, telefon, limbă, preferințe — schimbarea
  telefonului anulează verificarea lui prin `profiles_before_update`), `shops` și `shop_hours`,
  `shop_closures`, `shop_services`, `shop_photos`, `shop_billing` (doar proprietarul și doar cât
  service-ul poate scrie: `shop_writable`), `notice_reads` (propriul rând), `push_subscriptions` și
  `shop_staff` (ștergere). **Starea programărilor, devizele după trimitere, abonamentul, `active`,
  `suspended`, verificările, notele recenziilor nu pot fi scrise din browser.**
- **Citire de către oricine** (`using (true)`): `services`, `service_categories` (catalogul, public
  intenționat), `fleet_plans` (prețurile planurilor), `platform_settings` — ultima e restrânsă pe
  coloane din A11 (se citesc doar prețul raportului, TVA, comutatorul flotelor și valorile clasamentului).
- **Date fiscale:** `shop_billing` și `invoices` doar proprietar și admin. Corect.
- Vederea `shop_ratings` are `security_invoker = true` (respectă RLS).
- 613 funcții `security definer`, **toate** cu `search_path` fixat (protecție contra deturnării).
- Spațiile de stocare: `logos` și `shop-photos` publice (intenționat); `intake-photos`, `reports`,
  `fleet-files`, `support-files` private, cu reguli pe cale. **De verificat manual** pe proiectul
  real că bucket-urile au aceeași configurare (aici am citit doar migrările).
- Testele SQL acoperă izolarea între doi clienți, două service-uri, firme și roluri, coloanele
  protejate, concurența la ultimul loc și mașina de stări — toate trec.

Concluzie: **nu am găsit niciun tabel fără RLS și nicio regulă prea largă.** Auditul anterior
(A10–A12) a închis ultimele citiri prea largi (bugetul firmei, nota de moderare, raportările).

### 4.2 Secrete

- Browserul folosește doar `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`,
  `VITE_SENTRY_DSN`, `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION`, `VITE_WEB_URL` — toate publice.
- Nicio apariție de `service_role`, `sk_live`, `sk_test` în `src/`, `public/`, `index.html`.
  `.env` nu e în git; `.env.example` are doar nume.
- Cheile Stripe, Resend, SMSO, VAPID, Firebase stau doar în secretele Edge Functions.
- Toate Edge Functions au `verify_jwt = false`, dar **fiecare** își verifică singură apelantul:
  token de utilizator (`userFromToken`), semnătura Stripe (`stripe-webhook`) sau tokenul intern
  `x-dispatch-token` (funcțiile pornite de `pg_cron`). `email-logo` e public intenționat (imagini).
  Limite de frecvență pe SMS (`limit_phone_codes`) și geocodare (`rate_take`, 10/oră).
- Antete de securitate (CSP cu `frame-ancestors 'none'`, HSTS etc.) generate la build
  (`src/lib/securityHeaders.ts`) și testate.
- Observații minore: SEC-03 (hărțile sursă publice), SEC-04 (CORS `*` pe funcții).

### 4.3 Numerotarea facturilor

- **Facturi fiscale: nu există numerotare.** Tabelul `invoices`
  (`supabase/migrations/20260923200300_notifications_and_money.sql:135`) are `series`, `number` și
  `unique (series, number)`, dar nimic nu le completează: `record_stripe_invoice` scrie doar rândul
  plății Stripe (`provider_ref` = numărul Stripe, `status = 'paid'`). T14b (SmartBill/Oblio,
  e-Factura) nu e făcut. → **SEC-01, Critic înainte de plăți reale.**
- **Devize: numerotarea e corectă** — alocată în baza de date, cu blocare pe rândul service-ului
  (`assign_quote_number`: `select … for no key update` pe `shops`, apoi `shop_quote_numbers`),
  fără dubluri chiar dacă service-ul își schimbă numărul de start.
- Alte numere (C-00001, S-00001, P-000001, codul raportului) vin din secvențe Postgres — unice,
  pot avea goluri (normal pentru ID-uri, **nu** acceptabil pentru facturi fiscale; de aceea
  propunerea de la SEC-01 cere contor cu blocare, nu secvență).

---

## 5. Mobil (prioritate iPhone Safari)

Măsurat automat pe toate ecranele, la 375 px (și 768 px), în Chromium cu dimensiunea unui iPhone —
nu pe un iPhone real (vezi secțiunea 10).

| Verificare | Rezultat |
|---|---|
| Scroll orizontal | 0 din 1.164 de măsurători |
| Câmpuri cu font sub 16 px (zoom pe iPhone) | 0; regula globală `font-size: 16px` pe `input, select, textarea` (`src/styles/global.css:79`) |
| Zone de atingere sub 44 px | 0 (butoane, linkuri, liste, bife) |
| Elemente ieșite din ecran / suprapuse / text tăiat | 0 / 0 / 0 |
| `100vh` fără `100dvh` | 0 — cele 2 apariții (`App.module.css:5`, `AppShell.module.css:193`) au `100dvh` imediat după |
| Safe-area (notch, bara de jos) | tratată: `viewport-fit=cover`, `--safe-*` în `tokens.css:18-21`, folosite în antet, bara de jos, autentificare, pagini legale, onboarding, filtre |
| Tastatura peste câmpuri | rezolvată în cod pentru orice telefon (`src/lib/keyboard.ts`: bara de jos se ascunde, câmpul e adus în vedere); **de confirmat pe iPhone real** (marcat așa și în TASKS.md, 11 nov) |
| Modale | două `<dialog>` native: Filtre (foaie de jos pe telefon, `max-height: 88dvh`, corp cu scroll propriu) și Galeria (`max-height: calc(100dvh - 32px)`). Confirmările sunt panouri în pagină, nu modale. **De verificat manual pe iPhone:** dacă pagina din spate se mai derulează sub foaia de filtre (nu există blocare explicită a scroll-ului) |
| Text sub 12 px | etichetele barei de jos (11 px) pe toate ecranele cu meniu; în plus: etichetele din fișele vehiculelor de flotă (11,5 px), eticheta mesajelor automate (11 px), locurile libere la programarea adăugată de service (11,5 px), ora și marcajul „nou” la anunțurile echipei (10,5 / 11,5 px) (MOB-02) |

Probleme: MOB-01 … MOB-04 în tabelul general.

---

## 6. Desktop și tabletă

Măsurat la 768, 1024, 1440 și 1920 px. Pe lângă verificările de la telefon am măsurat lățimea zonei
de conținut, cel mai lung rând de text, cel mai lat câmp și listele de carduri late puse una sub alta.

**Cum e construit acum** (`src/styles/tokens.css`, `global.css`): sub 1024 px — aspectul de telefon cu
bara de jos, conținut de cel mult 720 px; de la 1024 px — bara laterală de 240 px, conținut până la
1480 px, liste marcate cu `data-layout` care trec pe 2–3 coloane (căutare, panouri, setări pe
secțiuni). Decizia lui Eduard din T51/T58: „tot ecranul liber pe laptop”, cardurile pe toată lățimea.

**Ce s-a găsit pe fiecare lățime**

| Lățime | Ce arată | Unde se rupe sau arată ca un telefon întins |
|---|---|---|
| 375 px (telefon) | aspectul de bază | nimic stricat (secțiunea 5) |
| 768 px (tabletă în picioare) | aspectul de telefon, conținut de cel mult 720 px, bara de jos | totul pe o coloană: Caută (carduri de service una sub alta), Garaj, Favorite, Programări — un telefon lățit (DESK-03) |
| 1024 px (iPad culcat, laptop mic) | bara laterală, conținutul pe ~720 px | grilele pornesc; corect, fără probleme măsurate |
| 1440 px (laptop) | conținut de ~1.100 px | liste de admin pe o coloană; paragrafe de ~150 de caractere pe rând; câmpuri simple și liste derulante de ~1.054 px (DESK-01, DESK-05) |
| 1920 px (PC) | conținut până la 1.480 px (~1.384 px utili) | aceleași, mai accentuate: carduri de ~1.380 px una sub alta, rânduri de până la ~197 de caractere, butonul principal lipit în colțul din dreapta jos (DESK-02, DESK-04) |

Ce merge bine pe ecran mare: Caută (3 coloane de carduri), Panoul flotei (cifre pe 6 coloane, grafice pe 2),
Setările service-ului și formularul de mașină (2 coloane simetrice), Istoricul service-ului (tabel),
pagina principală, autentificarea (coloană îngustă centrată), documentele legale (760 px, ușor de citit).

Ecrane cu o singură coloană de rânduri late (≥ 3 rânduri, fiecare peste 700 px) la 1920 px, măsurate:
Admin → Panou (activitatea), Clienți, Service-uri, Programări, Moderare, Abonamente, Export, ANAF,
Centrul de ajutor, Proceduri, Texte, Zone, Catalog, Jurnal, Retenție; client → Programări (active și
încheiate), Ajutor; service → Ajutor; firmă → Membri; conversațiile.

**Navigație:** completă pe ambele forme (secțiunea 2.1). Pe tabletă în picioare (768–1023 px) e bara
de jos de telefon; de la 1024 px (iPad culcat, laptop) bara laterală.

**Tabele:** doar 7 componente folosesc `<table>` (istoricul service-ului, rapoarte, import, panoul
zilei, flote, documente legale, ajutor). Listele din admin (clienți, service-uri, programări,
abonamente, recenzii) sunt carduri: fără coloane, fără sortare pe coloane, fără paginare (DESK-01,
PERF-02). Singura sortare explicită e în căutare („Cum este ordonată lista?”).

**Modale pe ecran mare:** Filtre — panou centrat de 600 px de la 768 px; Galerie — până la 1100 px,
centrată; corect.

**Mouse și tastatură:**
- focus vizibil: regulă globală `:focus-visible` cu inel chihlimbar (`global.css:83`) + 26 de reguli
  locale; 0 `tabIndex` pozitiv, deci ordinea la Tab urmează pagina.
- hover: 74 de reguli `:hover`, doar una sub `@media (hover: hover)` (MOB-03).
- Enter: doar 31 de `<form>`; 26 de ecrane cu câmpuri și buton de salvare nu sunt formulare (FUN-01).
- Esc: închide filtrele și galeria (dialog nativ), meniurile, confirmarea de deconectare, turul;
  **nu** închide panourile de confirmare din pagină (FUN-03).

**Browsere:** build-ul țintește `chrome80, edge80, firefox78, safari14` (`vite.config.ts:111`), dar
CSS-ul folosește `:has()` (9 locuri; Safari ≥ 15.4, Chrome ≥ 105, **Firefox ≥ 121**), container
queries (21; Safari ≥ 16, Chrome ≥ 105, Firefox ≥ 110), `dvh` (cu rezervă `vh`) și `<dialog>`
(Safari ≥ 15.4). Pe Chrome/Edge/Safari actuale nu e problemă; **de verificat manual** pe Firefox ESR
115 (folosit în firme) și pe telefoane Android vechi (WebView < 105, ținta declarată pentru Huawei):
ex. perioada aleasă la abonament e evidențiată doar prin `:has(:checked)`
(`src/screens/shop/subscription/subscription.module.css:278`). → BRW-01.

---

## 7. Design și UX

### 7.1 Tokenii de design de acum (`src/styles/tokens.css`)

| Grup | Valori |
|---|---|
| Fundaluri | `--bg-deep #0f1114`, `--bg #131519`, `--surface #1a1d22`, `--surface2 #22262c`, `--surface3 #2a2e35`, `--surface-hover`, `--field-bg #15181c` |
| Margini | `--border #272b32`, `--border-lit #363c46` |
| Text | `--text #eae8e2`, `--text-2 #b9bdc5`, `--muted #8a909b`, `--muted-strong #a4aab4`, `--red-text #ff7a72` |
| Accente | `--amber #f5a524`, `--green #34c759`, `--red #ff453a`, `--blue #5aa9ff`, `--ink #151515` + variantele „soft/tint/line” |
| Font | Inter Variable (+ „Inter Figures” pentru cifre); `--heading-size` 26 → 30 px, `--body-size` 14 → 15 px |
| Raze | `--radius-card 14px`, `--radius-button 10px`, `--radius-input 10px`, `--radius-pill 999px`, `--glass-radius 14px` |
| Spațiere | `--space-1…12` = 4, 8, 12, 16, 20, 24, 32, 40, 48 px; `--card-pad` 16 → 24; `--page-pad` 18 → 32 → 48; `--section-gap` |
| Mișcare | `--ease`, `--motion-quick .18s`, `--motion .4s`, `--motion-long .5s` |
| Altele | `--tap 44px`, `--sidebar-w 240px`, `--content-max` 560 → 720 → 1480 px, `--focus-ring` |

### 7.2 Unde se abat ecranele de la tokeni (măsurat pe cele 122 de fișiere CSS)

| Aspect | Folosit prin tokeni | Scris de mână | Detaliu |
|---|---|---|---|
| Mărimi de font | 2 (`--heading-size`, `--body-size`) | ~520 | **29 de valori diferite**: 13 px (107×), 14 (82×), 13,5 (66×), 12,5 (50×), 12 (45×), 15 (33×), 16 (26×), 17, 22, 18, 14,5, 11,5, 20, 19, 11, 24, 15,5, 10,5, 32, 30, 26, 9,5 … Nu există o scară de tipografie (DS-01) |
| Spațieri (gap, padding, margin) | 156 | 1.097 | `gap` are 12 valori: 8, 12, 10, 6, 4, 2, 14, 3, 9, 5, 1, 7 px — multe în afara pasului de 4 px (DS-02) |
| Raze de colț | 165 | ~75 | pe lângă tokeni: 8, 14, 6, 12, 10, 9, 2, 11, 4, 16, 7, 3 px și `999px` scris direct (DS-03) |
| Culori | — | 16 fișiere cu hex direct, 31 de `rgba()` | `#f5a524` scris de 5 ori în loc de `var(--amber)`, `#000`/`#fff`, `#0a1a0e`, `#14161a`, `#46505c`, `#c9ccd2` (DS-04) |
| Înălțimi minime de butoane/câmpuri | 61 × `var(--tap)` | 44 px scris de 11 ori, plus 48, 52, 56 px | butoanele de 44 px stau lângă câmpuri de 48 px (păstrat intenționat în A9) |

Înălțimile de butoane măsurate în pagină: 44 px de departe cel mai des (12.043), apoi 56 px (bara de jos, 2.335) și 48 px (336); restul sunt carduri-link înalte (71–141 px). Titlurile de pagină pe calculator: 30 px pe ~95% din ecrane; 17–23 px pe paginile de autentificare, pe fișele din admin, în conversații și pe linkurile publice (DS-05).

### 7.3 Ierarhie vizuală, câmpuri, texte

- Ierarhia e consecventă: titlu de pagină, o acțiune principală chihlimbar (sau verde pentru
  „Accept”), acțiunile secundare ca butoane conturate sau în meniul „Mai multe”.
- Formularele au etichete deasupra fiecărui câmp, grupate pe secțiuni (setări pe secțiuni
  simetrice pe calculator). Ordinea e logică (marcă → model → an → număr → VIN).
- **Texte:** 5.067 de chei în `ro.ts`, toate traduse în `en.ts` (build-ul pică altfel). Diacritice
  corecte: 0 caractere cu sedilă (ş ţ), 1.830 cu virgulă (ș ț). Ton conform `docs/EDITORIAL.md`, verificat
  automat de `tests/unit/editorial.test.ts`. Cuvinte rămase la fel ca în engleză: „Status” (5 locuri:
  `ro.ts:1367, 1696, 1736, 1813, 2295`), „Total”, „Export”, „Email”, „Client”, „Text” — sunt și
  cuvinte românești; „Status” ar fi mai firesc „Stare” (TXT-01, cosmetic).
- Documentele legale afișează „[de completat …]” (SEC-02).

### 7.4 Accesibilitate

- Contrast (calculat din tokeni): textul principal 11–15:1, secundar 7–10:1, `--muted` 5,7:1 pe
  fundal și 5,3:1 pe card — bine. **Sub 4,5:1:** `--muted` pe `--surface3` (4,25:1) și `--red` pe
  `--surface2` / `--surface3` (4,46 / 4,00:1) → A11Y-01 (de verificat unde apar combinațiile).
- Focus vizibil global; 178 `aria-label`; toate `<img>` au `alt`; 21 de reguli
  `prefers-reduced-motion`; etichete `<label>` legate de câmpuri prin componenta `Field`.
- Starea nu e arătată doar prin culoare (pastilele au text). Testul `a11y.spec.ts` (axe) rulează pe CI.

---

## 7b. Performanță

| Ce | Măsurat | Observație |
|---|---|---|
| Fișierul de start `index-*.js` | 1.122 KB (314 KB gzip) | conține React, routerul, clientul Supabase și **ambele dicționare** (`ro.ts` 295 KB + `en.ts` 279 KB sursă), importate static (`src/i18n/translate.ts:1`). Oricine deschide pagina principală descarcă și engleza (PERF-01) |
| Codul pe roluri | client 164 KB, service 214 KB, admin 212 KB, suport 7 KB (necomprimat) | bine: încărcat doar după autentificare |
| Harta (Leaflet) | 151 KB, separat | bine: încărcată doar la nevoie |
| CSS total | 270 KB în 3+ fișiere | acceptabil |
| Imagini | `public/` are doar `og-image.png` (45 KB) și `anpc-sal.png` (39 KB); pozele încărcate de service sunt micșorate în browser (`src/lib/image.ts`) | bine; doar 4 din 9 `<img>` au `loading="lazy"` (PERF-04) |
| Sunetul de programare | `public/sounds/new-booking.wav` 110 KB | un `.mp3`/`.ogg` ar avea ~10 KB (PERF-05) |
| Liste fără paginare | `admin_list_clients`, `admin_list_shops`, `admin_list_subscriptions`, `admin_list_reviews`, `list_threads`, programările clientului (toate) | PERF-02, PERF-03 |
| Reîncărcări | listele cu timp real se recitesc întregi după fiecare schimbare (cu întârziere de 150–300 ms ca să grupeze schimbările). Ecranul Clienți din admin ascultă **toate** schimbările din `profiles` și `bookings` din țară | PERF-02 |
| Re-randări | contextele mari (programări, conversații, notificări) sunt memorizate (`useMemo`); nu am găsit re-randări inutile evidente din cod. Profilarea în browser nu a fost făcută (de verificat manual) | — |
| Hărți sursă | publicate (`sourcemap: true`), descărcate doar când sunt deschise uneltele de dezvoltator | fără impact pe viteză (SEC-03) |

---

## 8. Tabelul problemelor

Severitate: **Critic** = risc legal / de date sau blochează lansarea · **Major** = strică vizibil
folosirea pe un tip de dispozitiv sau va strica la volum · **Minor** · **Cosmetic**.
Efort: **S** ≤ o zi · **M** 2–4 zile · **L** o săptămână sau mai mult.

| ID | Ecran | Dispozitiv | Descriere | Fișier și linie | Severitate | Efort | Soluție propusă |
|---|---|---|---|---|---|---|---|
| SEC-01 | Abonament (service), Admin → Abonamente | toate | Nu se emit facturi fiscale și nu există numerotare de facturi; service-ul primește doar chitanța Stripe. `invoices.series/number` rămân goale | `supabase/migrations/20260923200300_notifications_and_money.sql:135`; `supabase/functions/stripe-webhook/index.ts` (`record_stripe_invoice`) | Critic (înainte de plăți reale) | L | T14b: după decizia cu contabilul, fie SmartBill/Oblio alocă numărul (salvat în `series/number/pdf_url`, `status='issued'`), fie contor propriu `invoice_series(series, next_number)` incrementat într-o funcție `security definer` cu `select … for update`, apelată doar din webhook; trimitere e-Factura; „Factura” lângă „Chitanța” |
| SEC-02 | Termeni, Confidențialitate (public și în Cont) | toate | Datele firmei sunt goale: pagina publică arată „[de completat: denumirea firmei / sediul / Registrul Comerțului / CUI]” | `docs/legal/company.json:2-5` | Critic (înainte de lansare) | S | Completare cu datele firmei după înființare; test care pică dacă rămâne „[de completat” într-un build de producție |
| SEC-03 | — | toate | Hărțile sursă (`.map`) sunt publicate: oricine poate citi codul sursă complet | `vite.config.ts:117` | Minor | S | `sourcemap: 'hidden'` și încărcarea hărților doar în Sentry |
| SEC-04 | Edge Functions | toate | CORS `Access-Control-Allow-Origin: *` pe toate funcțiile | `supabase/functions/_shared/http.ts:4` | Minor | S | Lista de origini permise: service-hub.ro, previzualizările Netlify, aplicația Android; funcțiile cer oricum token, deci riscul e mic |
| SEC-05 | Caută, pagina service-ului | toate | Fără `VITE_MAP_TILE_URL`, harta folosește serverul OpenStreetMap, interzis pentru trafic de producție | `.env.example:12`, `src/components/map/ShopsMap.tsx` | Minor (lansare) | S | Cheia MapTiler setată în Netlify la lansare (LANSARE.md, Partea 4); build de producție care avertizează dacă lipsește |
| SEC-06 | Stocare | toate | Regulile pe bucket-uri n-au putut fi verificate pe proiectul real | migrările cu `storage.objects` | de verificat manual | S | Comparat în Supabase Dashboard → Storage → Policies cu migrările |
| FUN-01 | Adaugă programare (service), Deviz, Fișa de preluare, Costuri / Kilometraj / Mentenanță / Incidente (flotă), Catalog, Centrul de ajutor și articol (admin), Firme (admin), Pasul „Mașina” din programare | desktop, tabletă cu tastatură | Câmpurile nu sunt într-un `<form>`, deci **Enter nu trimite** formularul | `src/screens/shop/bookings/AddBookingScreen.tsx:209`; `QuoteEditorScreen.tsx:540`; `IntakeScreen.tsx`; `src/screens/fleet/FleetCosts.tsx:158,480`; `FleetOdometer.tsx:150,184`; `FleetMaintenance.tsx:91,177`; `FleetIssues.tsx:190,443`; `src/screens/admin/CatalogScreen.tsx:62,131`; `HelpArticleEditScreen.tsx:329,368`; `HelpAdminScreen.tsx`; `FleetsScreen.tsx`; `src/screens/client/booking/CarStep.tsx:395` | Major | M | Învelire în `<form onSubmit>` cu `ActionButton submit` (componenta suportă deja `submit`, `ActionButton.tsx:55`); pentru deviz, Enter într-o poziție adaugă rândul următor, nu trimite |
| FUN-02 | Spațiul firmei → Abonament și facturare | toate | Plata și schimbarea planului pentru firme nu există: „Plata cu cardul și schimbarea planului nu sunt încă disponibile”, doar „Cere o ofertă”; planul îl pune adminul | `src/i18n/ro.ts:3475,3504`; `src/screens/fleet/FleetSubscription.tsx` | Major (de business) | L | Etapa de plăți din `docs/FLEET_BILLING_PLAN.md` (Stripe, ramură nouă în webhook), după T14b |
| FUN-03 | Programări (client și service), Recenzii, Abonament: panourile de confirmare (anulare, refuz deviz, recenzie) | desktop | Esc nu închide panoul de confirmare din pagină | `src/components/InlinePanel.tsx:13` | Minor | S | `onKeyDown` Escape → același efect ca „Renunță”, focusul înapoi pe butonul care l-a deschis |
| FUN-04 | — | toate | Pașii de lansare nefăcuți: domeniul, Stripe real, CAPTCHA, admin, copii de siguranță | `docs/TASKS.md` (T19e), `docs/LANSARE.md` Partea 4 | Critic pentru lansare (pașii lui Eduard) | M | Parcurs ghidul din LANSARE.md |
| FUN-05 | Admin → Retenția datelor | toate | Ștergerea automată a datelor vechi e oprită până la avizul juridic | `docs/TASKS.md` (A3c2, A12 „Rămas”) | Minor | S | Pornire după avizul avocatului |
| FUN-06 | — | iPhone | Fără aplicație de iPhone: notificările push pe iPhone cer „Adaugă pe ecranul principal”; aplicațiile nu sunt în magazine | T20d, T20c | Minor | L | După contul Apple Developer |
| MOB-01 | Toate formularele | iPhone | Rezolvarea tastaturii peste câmpuri e testată doar în simulare | `src/lib/keyboard.ts` | de verificat manual | S | Test pe iPhone real pe linkul de previzualizare: programare, setări, deviz, mesaje |
| MOB-02 | Bara de jos, mesaje, anunțuri, rapoarte, flotă, programare | mobil | Text sub 12 px (11, 10,5, 9,5 px): etichetele barei de jos, ora mesajelor, legenda graficelor | `src/app/AppShell.module.css:145,312`; `src/screens/messages/messages.module.css:99,240,258`; `src/screens/notices/notices.module.css:64,77`; `src/screens/shop/reports/reports.module.css:271`; `src/screens/fleet/fleet.module.css:261,599,683`; `src/screens/client/booking/booking.module.css:270,392`; `src/screens/shop/bookings/shopBookings.module.css:585,590` | Minor | S | Minimum 12 px (11 px doar pentru etichetele barei de jos, ca iOS), dintr-un token `--text-xs` |
| MOB-03 | Toate | mobil (iPhone, Android) | 73 din 74 de reguli `:hover` nu sunt sub `@media (hover: hover)`: după o atingere, elementul rămâne „luminat” pe iPhone | ex. `src/components/Button.module.css`, `src/app/AppShell.module.css`, `src/screens/client/search/ShopCard.module.css` | Cosmetic | S | Învelire în `@media (hover: hover)` |
| MOB-04 | Caută → Filtre, galeria foto | iPhone | Fără blocarea derulării paginii din spatele ferestrei | `src/components/Filters.tsx:80`, `PhotoGallery.tsx:21` | de verificat manual | S | Dacă se confirmă: `overflow: hidden` pe `html` cât e deschis dialogul |
| DESK-01 | Admin → Clienți, Service-uri, Programări, Abonamente, Moderare | desktop | Liste de carduri late (~1.300 px la 1920) cu textul înghesuit în stânga; fără coloane și fără sortare pe coloane | `src/screens/admin/ClientsScreen.tsx`, `ShopsScreen.tsx`, `BookingsScreen.tsx`, `SubscriptionsScreen.tsx`, `ModerationScreen.tsx` | Major | M | O componentă `DataTable` (antet lipit, coloane, sortare la clic, paginare, rând = link spre fișă) de la 1024 px; sub 1024 px rămân cardurile |
| DESK-02 | Programări (client), Programări (service), Istoric, Recenzii | desktop | O singură coloană de carduri late de ~1.380 px la 1920 px: programările clientului (6 active + 7 încheiate), conversația, articolele din Centrul de ajutor, lista procedurilor, Zone, Catalog, Texte, Jurnal din admin. În interiorul cardului conținutul stă în stânga, acțiunea („Mesaj”) în dreapta, la ~1.300 px distanță | `src/screens/client/bookings/ClientBookingsScreen.tsx`, `ClientBookingCard.tsx`; `src/styles/global.css:116-170` (`data-layout`) | Minor | M | Pe ≥ 1440 px: carduri pe 2 coloane (încheiatele) sau listă + detaliu (lista în stânga, programarea aleasă în dreapta) |
| DESK-03 | Toate ecranele cu liste | tabletă (768–1023 px) | Aspectul de telefon, lățit la 720 px: o coloană de carduri (Caută, Garaj, Programări), bara de jos | `src/styles/tokens.css:114-118`; `src/styles/global.css:116` (grilele pornesc doar de la 1024 px) | Major | M | Grile pe 2 coloane de la 768 px pentru Caută, Garaj, Favorite, panouri; formulare pe 2 coloane unde au peste 6 câmpuri |
| DESK-04 | Programare (pașii 1–4), setări, deviz | desktop mare | Butonul principal lipit jos-dreapta, departe de conținut (la 1920 px ~1.000 px de câmpuri) | `src/components/BottomBar.module.css:16-25` | Minor | S | Pe ≥ 1440 px butonul la capătul conținutului (nu lipit de marginea ecranului) sau în coloana formularului |
| DESK-05 | Notele și avertismentele (Solicitare nouă, Abonament, Deviz, ecranele de admin cu descriere), listele derulante și câmpurile simple din formulare | desktop | Paragrafe de până la ~190–197 de caractere pe rând la 1920 px (ex. „Nu atașa parole, date bancare…”, „Primul coleg cu cont…”, „Taxa de constatare…”, descrierile din Retenție, Securitate, Administratori); ideal 60–90. Liste derulante și câmpuri de un rând late de 1.054 px (Categorie la solicitare, Limba raportului, Persoană fizică / juridică, titlul procedurii, numele articolului) | `src/styles/global.css`, modulele ecranelor | Minor | S | `max-width: 72ch` pentru paragrafe și note; câmpurile simple cel mult ~560 px |
| BRW-01 | Abonament (service), câmpuri, carduri cu container queries | browsere vechi | CSS-ul folosește `:has()`, container queries și `<dialog>`, mai noi decât ținta declarată (Safari 14, Chrome 80, Firefox 78) | `vite.config.ts:111`; `src/screens/shop/subscription/subscription.module.css:278-288` și alte 8 `:has`; 21 `@container` | Minor | M | Fie ținta ridicată la Safari 15.4 / Chrome 105 / Firefox 121, fie rezerve fără `:has` pentru starea aleasă; test pe Firefox ESR 115 |
| PERF-01 | Toate (prima încărcare) | mobil pe rețea slabă | Fișierul de start are 314 KB comprimat pentru că include ambele limbi | `src/i18n/translate.ts:1`; `vite.config.ts:113` | Major | M | Dicționarul englez încărcat doar la nevoie (`import()`), româna în start; separarea textelor admin/suport/flotă pe rolurile lor. Câștig estimat ~120–150 KB comprimat |
| PERF-02 | Admin → Clienți, Service-uri, Abonamente, Moderare | toate | Listele întorc toate rândurile și se recitesc întregi la fiecare schimbare (Clienți ascultă orice `profiles` și `bookings` din țară) | `supabase/migrations/20261112150000_a6_security.sql:772,788,824`; `supabase/migrations/20260925120213_admin_tools.sql:169`; `src/screens/admin/ClientsScreen.tsx:27`; `src/screens/admin/useLiveData.ts:22-33` | Major (la volum) | M | Paginare cu cursor și căutare în baza de date (ca `admin_list_bookings`); timp real doar pentru contoare, cu „Lista s-a schimbat · Reîncarcă” |
| PERF-03 | Mesaje, Programări (client) | toate | `list_threads` și programările clientului fără limită | `supabase/migrations/20260924155814_messages_and_reviews.sql:35`; `src/data/bookings.ts:142` | Minor | M | Paginare la încheiate (ex. ultimele 50 + „Mai vechi”) și la conversații |
| PERF-04 | Pagina service-ului, favorite | toate | 5 din 9 `<img>` fără `loading="lazy"` | `grep "<img" src` | Cosmetic | S | `loading="lazy"` + `decoding="async"` pe imaginile din liste |
| PERF-05 | Panou service | toate | Sunetul de programare e WAV de 110 KB | `public/sounds/new-booking.wav` | Cosmetic | S | Variantă `.mp3`/`.ogg` (~10 KB) |
| DS-01 | Toate | toate | 29 de mărimi de font scrise de mână, inclusiv jumătăți de pixel (13,5 / 12,5 / 14,5 / 11,5 / 10,5 / 15,5); doar 2 tokeni de mărime | toate cele 122 de fișiere `*.module.css` | Major (consecvență) | L | Scară de 7 trepte în `tokens.css` (`--text-xs 12`, `--text-sm 13`, `--text-base 14/15`, `--text-md 16`, `--text-lg 18`, `--text-xl 22`, `--text-2xl` = titlu); înlocuire treptată + regulă de lint (stylelint) care interzice `font-size` în px în afara tokenilor |
| DS-02 | Toate | toate | 1.097 de spațieri în px față de 156 prin `--space-*`; `gap` cu valori 1, 2, 3, 5, 7, 9, 14 px în afara pasului de 4 px | toate modulele CSS | Minor | L | Înlocuire cu `--space-*` (rotunjire la pasul de 4 px), apoi regulă de lint |
| DS-03 | Toate | toate | ~75 de raze de colț în px (2–16 px) pe lângă cei 4 tokeni | ex. `Filters.module.css`, `fleet.module.css`, `Landing.module.css` | Minor | S | `--radius-sm 6px` pentru elemente mici + tokenii existenți; `999px` → `--radius-pill` |
| DS-04 | 16 fișiere | toate | Culori hex scrise direct (ex. `#f5a524` de 5 ori în loc de `--amber`, `#000`, `#fff`, `#0a1a0e`, `#14161a`) și 31 de `rgba()` | `grep -E "#[0-9a-f]{3,8}" src/**/*.module.css` | Minor | S | Tokeni pentru umbre și suprapuneri (`--overlay`, `--scrim`), restul prin variabilele existente |
| A11Y-01 | Unde textul gri sau roșu stă pe `--surface2/3` | toate | Contrast sub 4,5:1: `--muted` pe `--surface3` 4,25:1, `--red` pe `--surface2` 4,46:1 și pe `--surface3` 4,00:1 | `src/styles/tokens.css:37-44` | Minor | S | Pe fundalurile ridicate: `--muted-strong` și `--red-text` (au deja contrast suficient) |
| TXT-01 | Istoric, Abonament, Admin, tipărire | toate | „Status” în interfața românească (5 chei) | `src/i18n/ro.ts:1367,1696,1736,1813,2295` | Cosmetic | S | „Stare” (și în `glossary.ts`) |
| LINT-01 | — | — | 2 avertismente de lint (fișiere care exportă și componente, și funcții) | `src/screens/admin/ActionPanels.tsx:85`, `src/screens/help/parts.tsx:25` | Cosmetic | S | Mutarea funcțiilor exportate într-un fișier separat |
| DS-05 | Autentificare, fișele din admin, conversații, linkurile publice | desktop | Titlul paginii are 5 mărimi (17, 19, 20, 22, 23 px) pe lângă standardul de 30 px | `src/screens/auth/auth.module.css`, `src/screens/admin/admin.module.css`, `src/screens/messages/messages.module.css` | Cosmetic | S | Două trepte doar: titlu de pagină (`--heading-size`) și titlu de fișă / conversație (un token nou) |

---

## 9. Plan de reparații pe loturi

Fiecare lot = un pull request separat, testat pe linkul de previzualizare.

**Lotul 1 — Securitate și date (înainte de plăți reale)**
1. SEC-02 — datele firmei în `docs/legal/company.json` + test că nu rămâne „[de completat” (S, după firmă).
2. SEC-01 — facturarea fiscală (T14b): decizia cu contabilul (SmartBill / Oblio / contor propriu), numerotare
   cu blocare, e-Factura, „Factura” pe Abonament (L).
3. SEC-03, SEC-04 — hărți sursă ascunse, CORS restrâns (S).
4. SEC-05, SEC-06 — cheia de hartă și verificarea bucket-urilor la lansare (S, pașii lui Eduard).

**Lotul 2 — Fluxuri rupte și incomplete**
1. FUN-01 — Enter trimite formularele (M).
2. FUN-03 — Esc închide panourile de confirmare (S).
3. FUN-02 — plata abonamentelor pentru firme, după Lotul 1 (L).
4. FUN-04 — pașii de lansare (ghidul LANSARE.md).

**Lotul 3 — Mobil**
1. MOB-01, MOB-04 — test pe iPhone real (tastatură, derularea sub filtre); reparat doar ce se confirmă (S).
2. MOB-02 — text minim 12 px (S).
3. MOB-03 — hover doar pe dispozitive cu mouse (S).

**Lotul 4 — Desktop și tabletă**
1. DESK-01 + PERF-02 — tabele cu coloane, sortare și paginare în admin, cu paginare în baza de date (M+M).
2. DESK-03 — grile de 2 coloane pe tabletă (M).
3. DESK-02, DESK-04, DESK-05 — liste pe 2 coloane sau listă + detaliu pe ecran mare, butonul principal lângă
   conținut, lățimi maxime pentru text și câmpuri (M).
4. BRW-01 — decizia pe browserele suportate + test pe Firefox ESR și Safari 15 (M).
5. PERF-01, PERF-03 — engleza încărcată la nevoie, paginare la conversații și programări încheiate (M).

**Lotul 5 — Sistemul de design**
1. DS-01 — scara de fonturi (tokeni) + înlocuire + regulă de lint (L).
2. DS-02, DS-03, DS-04 — spațieri, raze, culori prin tokeni (L, se poate face ecran cu ecran).
3. A11Y-01 — culorile pe fundalurile ridicate (S).

**Lotul 6 — Finisaje**
TXT-01, PERF-04, PERF-05, LINT-01.

---

## 10. Ce nu am putut verifica din cod (de verificat manual)

1. **iPhone și Safari reale** — toate măsurătorile au fost în Chromium cu dimensiunile unui telefon.
   Tastatura peste câmpuri (MOB-01), derularea sub filtre (MOB-04), zona de siguranță pe un iPhone cu
   notch, notificările push din Safari după „Adaugă pe ecranul principal”.
2. **Firefox, Edge, Safari pe Mac** — nerulate (BRW-01). Edge folosește același motor ca Chrome, deci
   riscul e mic; Firefox ESR 115 și Safari < 15.4 sunt riscurile reale.
3. **Testele în browser (`tests/e2e`, ~75 de fișiere)** — nerulate aici (au nevoie de Edge Functions
   locale); rulează pe CI la fiecare PR.
4. **Edge Functions în funcțiune** — citite doar în cod; plăți Stripe, emailuri Resend, SMS SMSO,
   push, geocodare, ANAF nu au fost apelate.
5. **Proiectul Supabase real** — configurarea bucket-urilor, Auth (Google, Apple, CAPTCHA), `pg_cron`,
   copiile de siguranță; nu am rulat nimic pe el (regula 16).
6. **Netlify** — antetele pe domeniul real, variabilele de mediu (`VITE_MAP_TILE_URL`, Turnstile, Sentry).
7. **Hărțile** — serverul de hărți e blocat în acest mediu, deci imaginile hărții nu s-au încărcat în
   test (normal aici, nu e o problemă a aplicației).
8. **Performanța reală** — timpul de încărcare pe 4G, profilarea re-randărilor în React DevTools,
   comportamentul listelor din admin la mii de rânduri.
9. **Detaliul unei proceduri văzut de agent** — în datele demo nu există o procedură publicată pentru
   agenți; pagina a arătat „Pagina nu există” (corect pentru o procedură la care nu are acces).
10. **Datele în format lună/zi/an** în câmpurile de dată din capturi vin din limba browserului de test;
   pe un telefon setat în română apar zi.lună.an (de confirmat pe un dispozitiv real).
11. **Conținutul juridic** — documentele legale cer forma finală de la avocat.
