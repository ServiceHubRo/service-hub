> **Referință.** Specificațiile inițiale, scrise pentru Lovable. În proiectul de acum se folosesc pentru detalii (texte, etichete, aspect). Deciziile tehnice care le înlocuiesc sunt în `ARCHITECTURE.md` §19, iar ordinea de lucru în `TASKS.md`.

# Service-Hub — Build Prompts for Lovable

**How to use this.** Send **one prompt at a time**, in this order. Wait for each to finish, click through the result, and confirm it works before sending the next. Do not paste several at once — that is what produces missing screens.

After each prompt, if something is wrong, fix it with a short follow-up ("the daily capacity stepper is missing, add it") before moving on. Fixing later is much harder.

> **Read this first — the most common mistake.** Service-Hub has **two completely separate interfaces** in the same app: one for **clients** (car owners) and one for **shops**. They share nothing except sign-in. If this is not stated explicitly, the tool will build a single interface and put client screens into the shop's menu. Prompt 1b below establishes the split — **send it before any screen prompt**, and note that every screen prompt from 5 onwards is labelled with the role it belongs to.

**Before you start:** connect Supabase, and tell Lovable once:

> Use React + TypeScript, Supabase for database and auth, and inline style objects with a central theme token file. Do not use a component library for layout. Keep all user-facing text in a central dictionary with Romanian and English versions — never hard-code display text.

---

## Ordinea de trimitere

Trimite in ordinea asta. Fiecare se trimite separat, se verifica in aplicatie, apoi urmeaza urmatorul.

| # | Prompt | Ce construieste |
|---|---|---|
| 1 | Theme and shell | Culori, fonturi, structura ecranului |
| 1b | Two separate interfaces | **Cele doua meniuri. Nu sari peste** |
| 2 | Database schema | Tabelele de baza si regulile de acces |
| 2b | Schema additions | ID cont, program pe zile, concedii, deviz pe linii, personal, audit |
| 3 | Capacity trigger | Blocarea suprarezervarii. **Critic** |
| 4 | Service catalogue | Cele 150 de servicii (incarca fisierul JSON) |
| 4b | Sign in / sign up | Autentificarea |
| 4c | Password reset | Resetare parolă, schimbare email |
| 5 | Shop settings | Program, capacitate, servicii, taxa de constatare |
| 5b | Advanced shop settings | Logo, coordonate, ore pe zi, concedii, reguli, personal |
| 5c | Company & fiscal data | Date firmă, CUI, IBAN, sediu social — cu validare |
| 5d | First-run setup | Ghidarea service-ului nou, 4 pași |
| 6 | Booking flow | Programarea in 4 pasi |
| 7 | Client garage | Garajul clientului |
| 7b | Push reminder documente | ITP/RCA/rovinieta pe telefon |
| 8 | Shop bookings | Confirma, reprogrameaza, refuza |
| 8b | Shop dashboard | Panoul de dimineata al service-ului |
| 8c | Carduri apasabile | Fiecare cifra din panou duce la lista filtrata |
| 9 | Messaging | Conversatii si mesaje automate |
| 9b | Realtime updates | Fara refresh manual, pe programari si mesaje |
| 9c | Erori & offline | Fara dubluri, stari de incarcare, fara conexiune |
| 10 | Reviews | Recenzii, raspuns, raportare |
| 10b | Client bookings | Programarile clientului |
| 11 | Search and ranking | Cautarea si ordonarea |
| 11b | Shop profile page | Pagina unui atelier |
| 12 | Subscription | Abonamentul |
| 12b | Subscription enforcement | Neplata = invizibil in cautari |
| 13 | Legal documents | Termeni, GDPR, cookies |
| 13b | Account screen | Ecranul Cont, ambele roluri |
| 14 | Email verification | Confirmarea adresei |
| 15 | Job flow with quote | Constatare, deviz, acceptare, lucru, finalizare |
| 14b | Abuse protection | Limite de programari, mesaje, conturi |
| 15b | Push permission | Cerere de voie WhatsApp-style, ambele roluri |
| 15c | Quote expiry & cazuri reale | Expirare deviz, aprobare partiala, anulari, neprezentare |
| 15d | Kilometraj obligatoriu | Cerut la finalizare, cu validare fata de istoric |
| 16 | Search by service | Cautare dupa interventie + filtre |
| 16b | Repair history (shop) | Istoric cu cautare dupa numar, export CSV |
| 16c | Vehicle history (client) | Istoricul fiecarei masini din garaj |
| 16d | Location & "Near you" | Permisiune locatie, service-uri din apropiere |
| 16e | Raport istoric platit | PDF oficial pe o masina, 29 lei, cu verificare publica |
| 17 | Desktop layout | Adaptarea pentru calculator |
| 17b | Accesibilitate & fus orar | Tastatura, contrast, UTC, tiparire |
| 18 | Landing page | Pagina publica |
| 19 | Admin role and access | Rolul de admin, rutare, audit, ecran de prezentare |
| 20 | Admin management | Service-uri, clienti, rezervari, moderare recenzii |
| 21 | Admin platform tools | Abonamente, catalog, setari, difuzare, export |
| 22 | Rapoarte si grafice | Incasari, clienti reveniti, rata devizelor — **ultimul** |

**Fundatia** e 1 – 4b: fara ele, restul nu are pe ce se aseza. De la 5 incolo ordinea conteaza mai putin, dar ramane cea mai sigura.

**Daca ai deja aplicatia construita partial**, trimite doar ce lipseste — fiecare prompt spune in prima linie ce extinde.

---

## Prompt 1 — Theme and shell

> Create the app shell and design system.
>
> Theme tokens (exact hex values, put them in one file and use them everywhere):
> bg #14161A, surface #1D2026, surface2 #242830, border #2C313A, borderLit #3A404B, text #EAE8E2, muted #8A909B, amber #F5A524, green #34C759, red #FF453A, blue #5AA9FF.
>
> Typography: headings and large numbers use font-family 'Arial Narrow', 'Helvetica Neue', sans-serif with letter-spacing 0.02em, uppercase, bold. Body text uses the system font stack. Times, licence plates, phone numbers and prices use a monospace stack.
>
> Shape: cards radius 12px, buttons radius 10px, inputs radius 9px, pills fully rounded, card padding 13-16px, page padding 18px, content max-width 520px centred. All inputs must use font-size 16px to prevent iOS zoom.
>
> Layout: the app fills exactly the viewport height and does not scroll as a whole. Fixed header at top, fixed bottom navigation, and only the middle content area scrolls. Use height 100vh, overflow hidden, flex column; header and nav flex-shrink 0; content flex 1 with overflow-y auto.
>
> Header: an amber rounded square (radius 7) containing a black wrench icon, then the wordmark.
>
> **The wordmark is SERVICE-HUB**, uppercase, written as three parts in two colours: "SERVICE" in `#EAE8E2`, the hyphen "-" also in `#EAE8E2`, and "HUB" in `#F5A524`. No spaces around the hyphen. Build it as one reusable component so the two colours never drift, and make sure it never wraps onto two lines — the hyphen must not become a line-break point.

---

## Prompt 1b — Two separate interfaces (send before any screen)

> The app has **two completely separate interfaces**, chosen by the account's role. A user is either a client or a shop, never both, and the role is fixed at registration. After signing in, the app must show only that role's navigation and screens. A client must never see a shop screen, and a shop must never see a client screen.
>
> **Client interface — five items in the bottom navigation:**
> 1. Caută (search) — magnifier icon
> 2. Garaj (garage) — car icon
> 3. Programări (bookings) — calendar icon
> 4. Mesaje (messages) — message icon
> 5. Cont (account) — user icon
>
> **Shop interface — five items in the bottom navigation:**
> 1. Panou (dashboard) — dashboard icon
> 2. Programări (bookings) — calendar icon
> 3. Istoric (repair history) — history icon
> 4. Mesaje (messages) — message icon
> 5. Cont (account) — user icon
>
> Recenzii is **not** a navigation item — it is a tile inside the shop's Cont screen, together with Setări service and Abonament.
>
> Note what is **not** in the shop navigation: there is no garage, no search. **The garage belongs to clients only** — a shop never has vehicles of its own and must not see that screen anywhere.
>
> Shop settings and subscription are **not** navigation items either. They are reached as tiles inside the shop's Cont screen, so the navigation bar stays at five items.
>
> Build the routing so that the role determines the entire navigation set. Do not build one shared menu containing everything.

---

## Prompt 2 — Database schema

> Create these Supabase tables with Row Level Security enabled on every one.
>
> **profiles**: id (uuid, references auth.users), role ('client' or 'service'), name, phone, lang, email_verified_at (nullable timestamp), terms_version, terms_accepted_at, created_at. Created by a trigger on auth.users insert, reading role/name/phone/lang from the signup metadata.
>
> **shops**: id, owner_id (unique, references profiles), name, address, phone, city (NOT NULL, indexed), open_hour int default 8, close_hour int default 18, closed_days int array default '{0}', daily_capacity int NOT NULL default 5, services text array, inspection_fee numeric default 0, lang, verified boolean default false, plan text default 'trial', trial_ends timestamptz, legal_name, vat_id, billing_email.
>
> **cars**: id, owner_id (references profiles), make NOT NULL, model NOT NULL, year, plate, vin, itp_expiry date, rca_expiry date, vignette_expiry date, created_at. RLS: only the owner can read or write. Shops must have no access at all.
>
> **bookings**: id, ref, shop_id, client_id, client_name, client_phone, client_lang, car_snapshot jsonb, service_id, service_name, date date, slot text, note, status text check in ('pending','confirmed','declined','done','cancelled'), work text, cost numeric, done_at, created_at.
>
> **reviews**: id, booking_id unique, shop_id, client_id, client_name, rating int 1-5, text, reply text, reply_at, reported boolean default false, report_reason text, reported_at, created_at.
>
> **threads**: id, shop_id, client_id, client_name, created_at, unique(shop_id, client_id).
> **messages**: id, thread_id, sender_id, body, system boolean default false, created_at.
>
> RLS rules: a client reads and writes only their own rows; a shop owner reads and writes only rows belonging to their shop. Shops are publicly readable by any authenticated user. For reviews, the shop owner may update ONLY reply/reported/report_reason and must not be able to change rating or text — use column-level GRANTs, not just policies, because RLS policies cannot restrict individual columns.

---

## Prompt 2b — Schema additions (send right after Prompt 2)

**-> DATABASE.** Extends the schema from Prompt 2 with everything the later prompts rely on. Send this before building any screen.

> Add the following to the schema.
>
> **Account IDs.** Every profile gets a short human-readable identifier, generated automatically and never reused: `C-00001` for clients, `S-00001` for shops, `A-00001` for admins. Use a sequence per role. Column `display_id text unique not null`. It is shown in the account screen and in all admin lists, and is the reference used in support conversations.
>
> **profiles** — add: `display_id`, `phone_verified_at timestamptz`, `suspended boolean default false`, `push_prompt_dismissed_at timestamptz`, `location_prompt_dismissed_at timestamptz`.
>
> **shops** — add: `description text`, `logo_url text`, `latitude double precision`, `longitude double precision`, `suspended boolean default false`, `active boolean default true`, `slot_minutes int default 60`, `min_notice_hours int default 2`, `max_advance_days int default 30`, `cancel_deadline_hours int default 2`, `max_per_hour int` (nullable = no hourly limit), `sms_on_new_booking boolean default false`, `daily_digest boolean default false`.
>
> **shop_hours** — per-weekday opening hours, replacing the single open/close pair:
> ```sql
> create table shop_hours (
>   shop_id uuid references shops(id) on delete cascade,
>   weekday int not null check (weekday between 0 and 6),
>   is_closed boolean not null default false,
>   open_hour int, close_hour int,
>   primary key (shop_id, weekday)
> );
> ```
>
> **shop_closures** — holidays and one-off closed days:
> ```sql
> create table shop_closures (
>   id uuid primary key default gen_random_uuid(),
>   shop_id uuid not null references shops(id) on delete cascade,
>   start_date date not null,
>   end_date date not null,
>   label text
> );
> ```
>
> **cars** — add `itp_reminded_at`, `rca_reminded_at`, `vignette_reminded_at` (each `jsonb`, storing which thresholds have already been notified, so the same expiry never notifies twice).
>
> **bookings** — add `cancel_reason text`, `cancelled_by text check (cancelled_by in ('client','shop','admin'))`, and extend the status check to include `expired` and `no_show`.
>
> **quotes** — add `expires_at timestamptz`, and `status` gains `'expired'` and `'partially_accepted'`.
>
> **quote_items** — split line items out of the jsonb so each can be approved individually:
> ```sql
> create table quote_items (
>   id uuid primary key default gen_random_uuid(),
>   quote_id uuid not null references quotes(id) on delete cascade,
>   name text not null,
>   price numeric not null,
>   approved boolean,          -- null until the client decides
>   position int not null
> );
> ```
>
> **favorites** — `client_id`, `shop_id`, `created_at`, primary key on the pair.
>
> **shop_staff** — extra logins operating the same shop:
> ```sql
> create table shop_staff (
>   id uuid primary key default gen_random_uuid(),
>   shop_id uuid not null references shops(id) on delete cascade,
>   user_id uuid references profiles(id) on delete cascade,
>   invited_email text,
>   role text not null default 'staff' check (role in ('owner','staff')),
>   created_at timestamptz default now()
> );
> ```
> Staff see and operate the same shop as the owner but cannot access Subscription or delete the shop.
>
> **notifications_log** — every push/email/SMS sent: `user_id`, `channel`, `event`, `title`, `body`, `sent_at`, `delivered boolean`.
>
> **platform_settings** — a single-row table holding: subscription price, trial days, quote expiry days, ranking prior average and weight, default booking limits. Admin edits these; changing a value never alters existing bookings or quotes.
>
> **admin_audit_log** — `admin_id`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `created_at`. Every admin write is recorded here.
>
> RLS on all new tables. Clients touch only their own rows; shops only their own shop's rows; `platform_settings` and `admin_audit_log` are readable and writable only by the admin role.

---

## Prompt 3 — Capacity trigger (critical, do not skip)

> Add a PostgreSQL trigger function that runs BEFORE INSERT OR UPDATE on bookings.
>
> It must count that shop's bookings on the same date with status 'pending' or 'confirmed', excluding the row being updated, and RAISE EXCEPTION 'day_full' if the count is already greater than or equal to shops.daily_capacity.
>
> This must be enforced in the database, not in the frontend, so two people booking the last slot at the same moment cannot both succeed. In the app, catch the 'day_full' error and show a localised message that returns the user to the day-selection step.

---

## Prompt 4 — Service catalogue

> I am uploading service-catalog.json. It contains 19 categories and 150 services, each with an id, category, icon name and Romanian and English names.
>
> Import it as a fixed catalogue constant — do not retype it and do not shorten it. Shops select from this catalogue; they cannot add their own entries. The service `id` values are stable and must never be renamed, because bookings reference them.
>
> Add the Romanian and English names into the central text dictionary.

---

## Prompt 4b — Sign in and sign up screens

**→ BEFORE LOGGING IN.** The first thing anyone sees.

> Build the authentication screen. It fills the viewport, is vertically centred, and scrolls if needed on small phones.
>
> **Top:** the amber logo tile with the wrench icon, the two-colour wordmark, and below it the tagline "Programări auto, fără telefoane". A compact language switch (RO / EN) sits top-right.
>
> **Tab switch** between "Autentificare" and "Cont nou": a container in `#1D2026` with 4px padding, the active tab amber with near-black text, the inactive one transparent with muted text.
>
> **Sign in:** email and password fields, a **"Ține-mă minte" checkbox ticked by default**, an error line, and the submit button "Intră în cont".
>
> **Remember me behaviour.** When ticked, configure Supabase Auth to persist the session (30 days) so the user stays signed in across browser restarts — a shop owner must not have to sign in every morning. When unticked, use a session that ends when the browser closes, for shared or workshop computers. Store this choice per device, never on the profile.
>
> **Language on first visit.** Before any account exists, detect the browser's language: Romanian interface for `ro`, English for anything else. The RO/EN switch on this screen overrides it immediately. Once signed in, the language saved on the profile takes over.
>
> **Sign up:** first a role choice presented as two selectable cards side by side — "Sunt client" with a car icon and "Sunt service" with a wrench icon; the selected one gets an amber border. Then: name, and **only for shops** the shop name and city (city is mandatory), then phone, email and password. Then the terms acceptance checkbox from Prompt 13. Submit button "Creează cont".
>
> **Errors are specific, not generic.** Wrong credentials, email already registered, missing city for a shop, terms not accepted — each gets its own message in Romanian or English.
>
> After signing in, route the user to their own interface: shops land on Panou, clients on Caută.
>
> Add a "Ai uitat parola?" link that sends a reset email.

---

## Prompt 4c — Password reset and email change

**-> BEFORE LOGGING IN, and inside Cont.** Prompt 4b builds sign-in; this builds what happens when someone forgets their password. Shop owners forget passwords — this will be your first support request.

> **"Ai uitat parola?" link** on the sign-in screen, under the password field.
>
> **Request screen.** One email field and a send button. After sending, always show the same neutral confirmation — "Dacă adresa există, ți-am trimis un link de resetare." — whether or not the address is registered. Revealing which emails exist lets anyone enumerate your users.
>
> **Reset link:** single-use, expires after 60 minutes. Opening it shows a screen with the new password, a confirmation field, and a save button. Minimum 8 characters, with a visible strength hint. On success, sign the user in and route them to their own interface.
>
> **Rate limit:** at most 3 reset requests per address per hour. Beyond that, show "Prea multe încercări. Încearcă peste o oră."
>
> **Change password while signed in**, in Cont: current password, new password, confirmation. Wrong current password gives a specific error, not a generic one.
>
> **Change email**, in Cont: the new address must be verified before it takes effect; the old one keeps working until then. Show "Verificare trimisă la {noua adresă}" and a way to cancel the pending change.
>
> All screens in RO/EN.

---

## Prompt 5 — Shop settings screen

**→ SHOP INTERFACE.** Reached from a tile inside the shop's Cont screen, not from the navigation bar.

> Build the shop settings screen. It must contain, in this order:
>
> 1. Text fields: shop name, city, address, phone.
> 2. A card containing opening hours: two steppers labelled "Deschide" and "Închide", each a minus button, the value shown as HH:00 in monospace, and a plus button. Steppers are 32x32px, radius 8, surface2 background.
> 3. Closed days: seven small toggle pills, one per weekday. A selected (closed) day shows red text on a red-tinted background with a red border.
> 4. A divider, then **daily capacity**: label "Comenzi pe zi", help text "Câte mașini preiei într-o zi. Tu decizi — nicio limită din partea platformei.", and a stepper from 1 to 100 with the value in monospace at font-size 19.
> 5. Services section: a header showing "Servicii oferite" plus a count of how many are currently selected, with "Alege tot" and "Scoate tot" text buttons on the right.
> 6. A search input that filters the 150-service catalogue by service name or category name, case-insensitive and diacritic-insensitive so that typing "frane" matches "Frâne". Categories with no matching service are hidden while filtering. Show an empty state if nothing matches.
> 7. The catalogue itself, grouped by category. Each row is a card with a custom square checkbox (amber when selected, with a black check mark) and the service name. **There is no price field.** Shops do not publish prices — pricing is done per job through the quote flow in Prompt 15, because the real price depends on the car brand and the complexity of the work.
> 7b. A separate card labelled "Taxă de constatare", with help text "Se percepe dacă clientul refuză devizul după ce ai constatat problema. Pune 0 dacă nu percepi.", and a numeric input in RON. Saved to `shops.inspection_fee`.
> 8. A save button at the bottom that writes everything to the shops table and shows "✓ Salvat" for 1.5 seconds after saving.
>
> Every label must come from the RO/EN dictionary.

---

## Prompt 5b — Advanced shop settings

**-> SHOP INTERFACE.** Extends the settings screen from Prompt 5.

> Add to shop settings, below what Prompt 5 already builds.
>
> **Shop identity.** A description field (short free text shown on the public shop page) and a logo upload (stored in Supabase Storage, shown instead of the initials avatar wherever the shop appears).
>
> **Address and coordinates.** When the address or city is saved, geocode it automatically to latitude and longitude and store them on the shop. Also offer a "Foloseste locatia curenta" button that fills the coordinates from the browser's location API, for shops whose address does not geocode cleanly. Coordinates are what the "Near you" search section uses.
>
> **Hours per weekday.** Replace the single open/close pair with one row per weekday: a closed toggle, plus opening and closing hour steppers when open. A shop that works 8-18 on weekdays and 9-13 on Saturday must be able to express that.
>
> **Closed periods.** A list of holiday and closed-day entries: start date, end date, optional label ("Concediu", "Sarbatori"). Add, edit, delete. Days inside a closed period never appear in the booking calendar.
>
> **Booking rules**, each a stepper or select with help text:
> - Slot length: 30 or 60 minutes (default 60)
> - Minimum notice: how many hours ahead a client must book (default 2)
> - Maximum advance: how many days into the future bookings are allowed (default 30)
> - Cancellation deadline: how many hours before the slot a client can still cancel (default 2; 0 = anytime)
> - Max cars per hour: optional; empty means only the daily cap applies
>
> **Notification preferences:** push status (link to the control from Prompt 15b), SMS on new booking on/off, daily digest on/off.
>
> **Staff accounts.** A section listing people who can operate this shop: invite by email (sends an invitation email; on sign-up that account is linked to this shop as staff), list with name and email, remove. The owner row cannot be removed. Staff do not see Subscription.
>
> All of these feed the booking calendar in Prompt 6 — day and time availability must respect weekday hours, closed periods, minimum notice, maximum advance, the daily cap and the hourly cap together.

---

## Prompt 5c — Company and fiscal data

**-> SHOP INTERFACE.** A separate section inside shop settings. Required before the shop can be invoiced.

> A repair shop is a registered business, and the platform issues it a monthly invoice. Collect the data properly instead of a single free-text address field.
>
> **Two distinct groups, with different visibility. This distinction is not optional.**
>
> **A. Public profile data** — shown to clients on the shop page:
> - Trading name (the name customers know)
> - Street and number, city, county, postal code — **as separate fields**, not one free-text box. The booking search and the "near you" section geocode these; a single blob geocodes badly.
> - Phone, optional second phone
> - Optional: website, Facebook page, year established
> - Short description
>
> **B. Fiscal data** — used only for invoicing, **never displayed publicly**:
> - Legal name (`denumire legală`) — often different from the trading name
> - **CUI / VAT code** (`RO12345678` or `12345678`)
> - Trade Register number (`J08/1234/2015`)
> - Registered office address (`sediu social`) — **may differ from the workshop address**, and often does
> - VAT payer: yes / no (affects how the invoice is issued)
> - Bank name and IBAN
> - Billing email — where invoices are sent, may differ from the login email
> - Legal representative name
>
> Store these in `shops` as `legal_name`, `vat_id`, `reg_com`, `legal_address`, `vat_payer boolean`, `bank_name`, `iban`, `billing_email`, `legal_rep`.
>
> **Validation, applied on save:**
> - CUI: digits only after an optional `RO` prefix, 2–10 digits. Apply the official Romanian CUI checksum — key `753217532` right-aligned against the digits before the control digit, sum × 10 mod 11, with 10 treated as 0. Reject an invalid one with a clear message rather than accepting silently.
> - Trade Register number: pattern `J` + county digits + `/` + number + `/` + year.
> - IBAN: must start with `RO`, 24 characters, and pass the IBAN mod-97 checksum.
> - Postal code: exactly 6 digits.
>
> **When it is required.** A shop can register, configure its profile and receive bookings **without** fiscal data — do not block onboarding with a form. Fiscal data becomes mandatory only at the point the first invoice must be issued, which is when the 90-day trial ends. Show a dismissible reminder in the shop's dashboard from day 60 onward: "Completează datele de facturare până la sfârșitul perioadei gratuite."
>
> **Convenience:** offer a "Copiază adresa atelierului" button on the registered-office field, since for many small shops they are the same.
>
> Never show CUI, registered office, IBAN or legal representative on the public shop page. A client browsing garages has no reason to see them.

---

## Prompt 5d — First-run setup for a new shop

**-> SHOP INTERFACE.** What a shop owner sees immediately after registering. Right now they land on an empty dashboard with no idea what to do.

> A newly registered shop has no services, no hours confirmed and no bookings. Do not drop them on an empty Panou.

> **Setup checklist**, shown at the top of Panou until complete, as a card titled "Pune service-ul pe picioare":
> 1. "Alege serviciile pe care le faci" — links to the catalogue in settings
> 2. "Verifică programul de lucru" — links to hours
> 3. "Stabilește câte mașini iei pe zi" — links to capacity
> 4. "Confirmă numărul de telefon" — the SMS verification from Prompt 14
>
> Each row shows a check mark when done, muted when not. Show progress as "2 din 4". **The card disappears permanently once all four are done** — do not keep nagging.
>
> **A shop with no services selected must not appear in search results**, since a client could open it and find nothing bookable. Show the shop a clear banner explaining this: "Service-ul tău nu apare încă în căutări. Alege cel puțin un serviciu."
>
> Keep it to four steps. A longer checklist gets abandoned.

---

## Prompt 6 — Booking flow

**→ CLIENT INTERFACE.** Opens from a shop's page inside Caută.

> Build the client booking flow as four steps, with a four-segment progress bar at the top where completed segments are amber and the rest use the border colour.
>
> Step 1 — service: only the services this shop offers, grouped by category with the category name as a small uppercase muted label. Each row shows the service icon in amber and the name. No prices are shown anywhere — the price is agreed later, through the quote.
>
> Step 2 — day: a 3-column grid of the next 12 open days, skipping the shop's closed days. Each tile shows the weekday abbreviation and the day number. Under each, show how many places remain that day. Days that reached daily_capacity are shown at 35% opacity and are not clickable.
>
> Step 3 — time: a 3-column grid of hourly slots between open_hour and close_hour. Slots already taken are shown struck through at 45% opacity and are not clickable.
>
> Step 4 — vehicle: if the client has saved cars, list them first as selectable cards showing make, model, year and plate, with an amber check mark on the selected one, plus a dashed-border "Altă mașină" button that opens the manual form. The manual form has make, model, year, plate, and a checkbox "Salvează mașina în garaj" that is ticked by default. Clients with no saved cars see the manual form directly. Below that, an optional notes textarea, then a summary card listing shop, service, date and time, then the submit button.
>
> On submit, copy the vehicle details onto the booking as a snapshot — later edits to the saved car must never change past bookings. New bookings get status 'pending'. Show a success screen with a 66px green circle containing a white check, a heading, an explanation line, and a single button.

---

## Prompt 7 — Client garage

**→ CLIENT INTERFACE ONLY.** This is the *Garaj* tab in the client's navigation. It must not appear anywhere in the shop interface — a shop has no garage.

> Build the client garage screen.
>
> List saved cars as cards: an amber rounded tile with a car icon, make and model in bold, year and plate below (plate in amber monospace), and an edit pencil on the right. When any expiry date is set, show a row of small pills below a divider: ITP, RCA and Rovinieta, each showing the remaining time. Pills are muted when more than 30 days remain, amber within 30 days, and red on or after the expiry day, with a bell icon when urgent.
>
> The car form has make, model, year, plate, an optional VIN field limited to 17 uppercase alphanumeric characters, and a nested panel headed "Expirări documente (opțional)" containing three date pickers for ITP, RCA and vignette, with help text explaining the app will alert before expiry. Save is disabled until make and model are filled. When editing, add a red delete button that asks for confirmation.
>
> On the search screen, when any of the client's documents expires within 30 days or has expired, show a tappable alert banner at the very top with a bell icon, the line "ITP la Golf 7 în 12 zile", a "+N de verificat" line when more than one applies, and a chevron. Tapping it opens the garage. Border and icon colour follow the urgency.

---

## Prompt 7b — Push reminder for document expiry

**-> CLIENT INTERFACE.** Upgrades the garage alert from Prompt 7: the in-app banner stays, and a push notification is added alongside it.

> When a car's ITP, RCA or vignette reaches the 30-day or expired threshold, also send a push notification to the client (subject to the permission flow in Prompt 15b), in addition to the existing in-app banner on Cauta. Title the shop's app name; body names the document and the car, e.g. "ITP la Golf 7 expira in 12 zile." Do not send this more than once per threshold per document - track a `last_reminded_at` per date field on `cars` so the same expiry does not notify repeatedly.

---

## Prompt 8 — Shop bookings

**→ SHOP INTERFACE.** The *Programări* tab of the shop navigation. The client's own bookings screen is a separate, simpler screen.

> Build the shop bookings screen with three tabs — Cereri, Programate, Închise — each showing a count.
>
> Each booking card shows the service icon and name, the full date and the time in monospace, and a status badge. Below that, a nested surface2 panel with the vehicle, the plate in amber monospace on the right, the client name, and the phone as a tap-to-call link in blue monospace, plus the client's note in italics when present.
>
> Actions: pending bookings get green "Confirmă" and red "Respinge"; confirmed bookings get "Finalizează"; both get "Reprogramează" and a message button.
>
> "Reprogramează" opens a panel inside the card: a 4-column grid of the next 8 open days with full days dimmed, then an hour grid with taken slots struck through, then "Mută și confirmă". It must re-check capacity and slot availability at submit time and refuse with a message if the day filled up meanwhile, leaving the original booking unchanged.
>
> "Finalizează" opens a panel with an optional "Ce s-a lucrat" textarea and an optional "Cost total" numeric field, help text saying both may be left empty, and a confirm button. Save these to the booking and show them on the closed card.

---

## Prompt 8b — Shop dashboard (Panou)

**→ SHOP INTERFACE.** The shop's home screen, first thing they see after signing in.

> Build the shop dashboard. It is the screen a shop owner opens in the morning.
>
> **Heading:** "Panou", with the shop name and city as the subline.
>
> **Statistic cards in one row**, each a card with a large number in the display font and a small muted label below:
> - "Cereri noi" — count of pending bookings, in amber
> - "Azi" — confirmed bookings dated today, in green
> - "7 zile" — confirmed bookings in the next seven days, in blue
>
> **Capacity line.** Below the cards, a slim card with a trending icon showing: "Comenzi pe zi: {daily_capacity} · Azi: {count of today's active bookings}". This tells the owner at a glance how full the day is.
>
> **Today's schedule.** A section headed "Programul de azi" listing today's confirmed bookings sorted by time. Each row: the time in monospace amber at 18px on the left with a fixed width, then the service name in bold and, below it in muted text, the vehicle and the client's name.
>
> Empty state when there is nothing today: a calendar icon and "Nicio programare azi."
>
> Tapping a row opens that booking in the Programări tab.

---

## Prompt 8c — Dashboard cards are navigation

**-> SHOP INTERFACE.** Small change, large effect: right now the dashboard shows numbers you cannot act on.

> **Every statistic card on Panou is a button**, not a label. Tapping one opens the relevant list, already filtered. A shop owner who sees "3 cereri noi" must reach those three requests in one tap, not by navigating to Programări and hunting.

> | Card | Opens |
> |---|---|
> | Cereri noi | Programări, tab Cereri |
> | Azi | Programări, tab Programate, filtered to today |
> | 7 zile | Programări, tab Programate, next 7 days |
> | În constatare | Programări, filtered to `in_inspection` |
> | Așteaptă deviz | Programări, filtered to `quote_sent` — the shop must chase these |
> | În lucru | Programări, filtered to `in_progress` |
>
> Give each card the pressed state used elsewhere (slight background lift) and a chevron, so it reads as tappable. A card showing **zero** is not tappable and sits at 45% opacity — do not open an empty list.
>
> **Also tappable:** each row in "Programul de azi" opens that booking directly, and the capacity line opens settings at the capacity field.
>
> When a filtered list is opened this way, show a removable chip above it naming the filter — "În lucru ✕" — so the shop understands why the list is short and can clear it.

---

## Prompt 9 — Messaging

**→ BOTH INTERFACES.** The *Mesaje* tab exists in each, showing only that user's own conversations.

> Build messaging. Exactly one conversation thread per shop-client pair, created on demand.
>
> The conversation list shows an avatar with initials, the other party's name, and a preview of the last message, ordered by most recent.
>
> The conversation screen shows message bubbles: my messages amber with black text aligned right, theirs surface2 aligned left, both radius 14 with the corner nearest the sender reduced to 4. Timestamps below each in 10.5px muted text. Input row at the bottom with a round 44px amber send button.
>
> Automatic messages are different: centred, surface2 background, muted text, with a small label underneath reading "mesaj automat". They are not attributed to a person.
>
> Write an automatic message into the thread on every status change: confirmed, rescheduled, declined, completed by the shop, and cancelled by the client. Each message must be written in the RECIPIENT's language — use bookings.client_lang for messages to the client and shops.lang for messages to the shop, not the sender's current interface language.
>
> Add a message button to every booking card on both sides that opens the right thread directly.

---

## Prompt 9b — Realtime updates, no manual refresh

**-> BOTH INTERFACES.** Layers on top of Prompt 8 (shop bookings), Prompt 8b (dashboard), Prompt 9 (messaging), Prompt 10b (client bookings) and Prompt 11b (shop profile reviews). This is what makes the product feel alive instead of static.

> Every screen that shows bookings, messages or reviews must update live, using Supabase Realtime Postgres Changes subscriptions over websockets. Do not implement this with polling (repeated fetch on a timer) and do not require the user to reload the page to see a change made by the other party.

> **Bookings.** A shop viewing Panou or Programari must see a new booking appear, and a status change happen, within roughly a second of it occurring - without any action from the shop. Subscribe to the `bookings` table filtered to that shop's `shop_id`. A client viewing Programari must see their own booking's status change live the same way, filtered to their `client_id`. Update local state directly from the incoming change payload rather than refetching the whole list on every event.

> **Messages.** An open conversation must show a new message the instant the other party sends it, with no refresh. Subscribe to `messages` for the open thread's `thread_id`. The conversation list (unopened threads) must also update its "last message" preview live when a new message arrives in any of the user's threads.

> **Reviews.** A shop viewing Recenzii should see a newly submitted review appear live, without reloading.

> **Connection handling.** Reconnect automatically if the websocket drops (e.g. the laptop sleeps or wifi flickers), and resync any events missed while disconnected. Never show stale data silently - if the connection is lost, a small, unobtrusive indicator is acceptable, but do not block the interface.

> **What this replaces.** Anywhere an earlier prompt implied checking for updates on an interval or expecting a manual reload, replace that with a realtime subscription instead.

---

## Prompt 9c — Error states, offline handling and loading

**-> BOTH INTERFACES.** A mechanic uses this under a car, on bad signal. Every action must survive a dropped connection without creating duplicates.

> **Every button that writes to the database** — confirm, decline, reschedule, send quote, accept quote, start work, complete, send message, save settings — must:
> 1. disable itself immediately on tap and show a spinner inside the button, keeping its width so the layout doesn't jump;
> 2. re-enable only after the server answers;
> 3. **never allow a second submission of the same action.** Tapping "Confirmă" three times on bad signal must produce one confirmation, not three. Guard on the client and make the write idempotent server-side.
>
> **On failure**, show an inline message directly under the action — never a browser alert, never a silent failure: "Nu s-a putut trimite. Verifică internetul și încearcă din nou." with a "Încearcă din nou" button that repeats the same action.
>
> **Offline detection.** Listen for the browser's online/offline events. When offline, show a slim fixed bar at the top of the screen: "Fără conexiune. Modificările nu se salvează." in the alert colour. Hide it the moment the connection returns. Do not block the interface — reading cached content is still useful.
>
> **Loading states, consistently:**
> - Lists (bookings, messages, history, search results) show 3 skeleton cards while loading, not a spinner and not a blank screen.
> - Screens that depend on one record show a centred spinner.
> - Never show an empty state while data is still loading — an empty list and a loading list must look different, otherwise a shop with bookings sees "Nicio programare" for a second and panics.
>
> **Session expiry.** If a write fails because the session expired, do not dump the user at the login screen losing their input. Show "Sesiunea a expirat. Autentifică-te din nou." with a sign-in action, and restore what they were doing afterwards where feasible.

---

## Prompt 10 — Reviews

**→ Writing a review: CLIENT INTERFACE.** → **Reply and report: SHOP INTERFACE**, in the shop's *Recenzii* tab.

> Clients can leave exactly one review per completed booking: a 1-5 star rating and optional text. Ratings and text are immutable once submitted.
>
> Build a shop-side reviews screen: an average score block showing the average at font-size 40 in amber next to stars and the review count, then review cards with the reviewer's avatar and name, stars, date, and text.
>
> Each card has two actions: "Răspunde" and "Raportează".
>
> Reply opens a textarea inside the card; the saved reply appears in a nested surface2 panel headed "Răspunsul service-ului" and can be edited later. The reply is shown wherever the review appears, including the public shop profile.
>
> Report opens a panel with four radio options — falsă / limbaj abuziv / alt service / date personale — plus send and cancel. After sending, the card gets an amber border and a "Raportată" label, and a confirmation appears saying the review will be checked within 5 working days. The review must stay publicly visible; reporting never hides content.

---

## Prompt 10b — Client bookings screen

**→ CLIENT INTERFACE.** The *Programări* tab. Different and simpler than the shop's version.

> Build the client's own bookings list, newest first.
>
> Each card shows: the service icon in amber and the service name in bold, the shop name and city in muted text below it, and a status badge on the right. Then a row with the date and the time in monospace, and the vehicle.
>
> **Status badges** use the shared style. The full set is defined in Prompt 15; this screen must render all of them.
>
> **The quote decision happens on this screen** — when a booking is `quote_sent`, the card shows the full quote with Accept and Refuz, exactly as specified in Prompt 15.
>
> **Actions per status:**
> - pending or confirmed → "Mesaj" and a red "Anulează" that asks for confirmation first
> - quote_sent → the quote block with Accept / Refuz, plus "Mesaj"
> - in_inspection, approved, in_progress → "Mesaj" only; cancelling is not allowed once the car is in the workshop
> - done → "Mesaj", plus "Lasă o recenzie" if not yet reviewed; if already reviewed, show a muted line with a filled star reading "Recenzie trimisă"
>
> The review form opens inline inside the card: five tappable stars at 28px, an optional textarea, and send / cancel buttons.
>
> When the client cancels, write the automatic message to the shop as specified in Prompt 9.
>
> Empty state: a calendar icon and "Nicio programare încă."

---

## Prompt 11 — Search and ranking

**→ CLIENT INTERFACE ONLY.** Shops do not search for other shops.

> Build the client search screen: a search input with a magnifier icon that matches shop name or city, case-insensitive and diacritic-insensitive so "Brasov" finds "Brașov".
>
> Result cards show the avatar, shop name, star rating, review count, city and number of services offered.
>
> Ranking uses a weighted average, NOT a raw average:
> score = (sum_of_ratings + 4.3 * 3) / (review_count + 3)
> Ties break by higher review count, then alphabetically. This ensures a shop with no reviews scores 4.30 and lands mid-list instead of last, and stops a single 5-star review from outranking a shop with fifty reviews averaging 4.8.
>
> Add a small underlined text toggle "Cum e ordonată lista?" that reveals a short explanation: ordering is by customer rating and number of reviews, and newly joined shops start mid-list so they get a fair chance at their first bookings.
>
> Do not build any paid-placement mechanism in this release: no promoted labels, no sponsored slots, no ranking tiers. Ranking is by the weighted score only.

---

## Prompt 11b — Shop profile page

**→ CLIENT INTERFACE.** Opens when a client taps a search result. This is where the decision to book is made.

> Build the page a client sees when they open a shop from the search results.
>
> **Header:** a back link reading "Toate service-urile", then the shop avatar with initials, the shop name in the display font at 23px uppercase, the star rating with the review count beside it, and the address with city under a small pin icon.
>
> **Info card** with rows separated by thin dividers:
> - "Program" — opening and closing hour, e.g. 08:00 – 18:00
> - "Închis" — the closed weekdays, abbreviated
> - "Comenzi pe zi" — the shop's daily capacity
> - "Telefon" — in blue monospace, tappable to call
>
> **Services.** A section headed "Servicii oferite" listing every service the shop offers, each row a compact card with the service icon in amber and the name. No prices. Below the list, one muted line: "Prețul se stabilește prin deviz, după ce service-ul vede mașina."
>
> If the shop charges an inspection fee, show it in the info card as a row: "Taxă de constatare" with the amount, and a muted note that it applies only if the client refuses the quote.
>
> **Primary button:** "Programează-te", full width, amber. It opens the booking flow from Prompt 6 for this shop.
>
> **Reviews.** Below the button, a section headed "Recenzii" listing the reviews for this shop, newest first: reviewer name, stars, date, and the text. **When the shop has replied, show the reply beneath that review** in a nested panel with the heading "Răspunsul service-ului" — the same way it appears on the shop side.
>
> If the shop has no reviews, omit the section entirely rather than showing an empty state.

---

## Prompt 12 — Subscription

**→ SHOP INTERFACE.** Reached from a tile inside the shop's Cont screen, not from the navigation bar.

> Build the subscription screen. There is ONE plan for everyone: 100 RON per month, with a 90-day free trial. There are no tiers and no feature differences.
>
> Show a trial banner with a crown icon and the days remaining out of 90 while the shop is on trial. Then a single plan card showing the price at font-size 34 in amber, a feature list with green check marks — all app features, unlimited daily capacity, equal visibility with position earned through reviews, no contract and cancel anytime — and an activate button.
>
> The shops.plan column must be writable only by the service role, never by the browser. Use column-level GRANTs so an authenticated user cannot update it directly.

---

## Prompt 12b — Subscription enforcement

**-> SYSTEM RULE.** Extends Prompt 12. Without this, the subscription has no consequence and nobody needs to pay.

> A shop's visibility depends on its subscription being in good standing.
>
> **When a shop becomes inactive** — the 90-day trial ends without payment, or the payment provider reports a final failed retry — set `shops.active = false`. An inactive shop:
> - does not appear in search results at all
> - cannot receive new bookings (enforce in the database, not only the UI)
> - keeps every existing booking, message, review and history record untouched
> - can still sign in and operate the bookings it already has
> - sees a persistent banner: "Abonamentul a expirat. Service-ul tau nu mai apare in cautari." with a button to the checkout
>
> **Paying reactivates immediately**: `active = true` on the provider's verified webhook, no manual step.
>
> **Warnings before it happens:** push and email to the shop 7 days and 1 day before the trial ends, and immediately on a failed payment.
>
> **Also excluded from search:** suspended shops (`suspended = true`, set by admin) and shops whose email or phone is not yet verified.
>
> Plan status and `active` are writable **only by the service role** — the provider webhook or the admin. The browser must be structurally incapable of changing them.

---

## Prompt 13 — Legal documents, terms acceptance, GDPR

**→ BOTH INTERFACES**, inside each role's Cont screen.

> Add three legal documents readable inside the app in both Romanian and English, rendered as titled sections in cards: Termeni și condiții, Politica de confidențialitate, Politica de cookies. They must be readable without an account.
>
> On the registration screen add an unticked checkbox reading "Am citit și accept Termenii și condițiile și Politica de confidențialitate", where both names are amber underlined links that open the documents without leaving the screen. Registration must fail with a clear message if it is not ticked. Store terms_version and terms_accepted_at on the user record.
>
> In the account screen add a "Datele mele" section with a line explaining GDPR rights, a "Descarcă datele mele" button that exports the user's profile, bookings, reviews and messages as structured JSON, and a red "Șterge contul" button that asks for explicit confirmation before deleting.
>
> Also add tiles in the account screen linking to shop settings and subscription for shop accounts.

---

## Prompt 13b — Account screen (Cont)

**→ BOTH INTERFACES**, with different tiles per role.

> Build the account screen, the *Cont* tab. It is a hub, not a settings form.
>
> **Identity card at the top:** avatar with initials, the user's name in bold, their phone in muted monospace, and — for shops — the shop name and city on a third line.
>
> **Language card:** a globe icon, the label "Limbă", and the RO / EN switch on the right. Changing it updates the interface immediately and saves the choice to the user's profile.
>
> **For shops only**, two navigation tiles: "Setări service" and "Abonament". Each tile is a full-width card with an amber icon on the left, the label, and a chevron on the right. These are the only way to reach those screens — they are not in the navigation bar.
>
> **Legal section**, headed "Documente legale", with three tiles opening the documents from Prompt 13: Termeni și condiții, Politica de confidențialitate, Politica de cookies.
>
> **Data section**, headed "Datele mele": a short line explaining GDPR rights, a dark "Descarcă datele mele" button, and a red "Șterge contul" button that requires explicit confirmation.
>
> **Log out** at the bottom, as a dark full-width button.
>
> Reaching a legal document from here replaces the screen content and offers a back link — it does not open a new tab or leave the app.

---

## Prompt 14 — Email verification

**→ BOTH INTERFACES**, with different consequences per role.

> Require email verification at signup. Send a verification link that is single-use and expires after 24 hours.
>
> Until verified: a shop must NOT appear in search results and must not be able to receive bookings; a client must not be able to submit a booking. Both can sign in and see a banner explaining what is pending, with a "Retrimite emailul" action rate-limited to once per 60 seconds.
>
> Enforce this in the database as well as the interface — search queries and booking inserts must both filter on verification status.

---

## Prompt 14b — Abuse protection and rate limits

**-> SYSTEM RULE.** Nothing currently stops one person from flooding a shop's calendar. A single annoyed competitor could fill a shop's entire week overnight.

> Enforce all of these **in the database**, not only in the interface.
>
> **Booking limits per client:**
> - at most 3 active bookings (pending, confirmed, in inspection, quote sent, approved, in progress) at the same shop simultaneously;
> - at most 10 active bookings across all shops;
> - at most 5 new bookings created per 24 hours.
> Exceeding any of these is refused with a localised message naming the limit, e.g. "Ai deja 3 programări active la acest service."
>
> **Cancellation abuse.** Count how many bookings a client cancels or fails to show up for. After 3 no-shows in 90 days, flag the account for the admin and show the shop a discreet marker on that client's bookings — a small muted line, "Client cu 3 neprezentări", visible only to the shop. Do not block the client automatically; that is an admin decision.
>
> **Messaging:** at most 30 messages per thread per hour, and no messages at all in a thread with no booking between the parties. This prevents the messaging system being used for unsolicited advertising.
>
> **Reviews:** one per completed booking, already enforced. Additionally, a review can only be submitted within 60 days of completion — older bookings no longer accept one.
>
> **Registration:** at most 3 accounts per IP per 24 hours. Combined with mandatory email verification, this makes bulk fake accounts impractical.
>
> **Shop side:** at most 20 quotes sent per booking (prevents an accidental loop), and a quote cannot be sent for a booking that is not in inspection.
>
> Every refusal returns a clear, translated message — never a raw database error.

---

## Prompt 15 — Job flow with quote approval

**→ Buttons and quote composer: SHOP INTERFACE.** → **Quote decision and status display: CLIENT INTERFACE.**

> Replace the simple "mark as done" action with the real workshop flow: the car arrives, the shop inspects it, sends a quote, the client approves or refuses, and only then the work starts.
>
> **Status sequence:**
> `pending` → `confirmed` → `in_inspection` → `quote_sent` → `approved` → `in_progress` → `done`
> Plus terminal states: `declined`, `cancelled`, and `quote_refused`.
>
> **Database changes.**
> ```sql
> alter table bookings drop constraint if exists bookings_status_check;
> alter table bookings add constraint bookings_status_check
>   check (status in ('pending','confirmed','in_inspection','quote_sent',
>                     'approved','in_progress','done','declined','cancelled','quote_refused'));
> alter table bookings add column if not exists inspection_started_at timestamptz;
> alter table bookings add column if not exists started_at timestamptz;
> ```
> New table for quotes:
> ```sql
> create table quotes (
>   id uuid primary key default gen_random_uuid(),
>   booking_id uuid not null references bookings(id) on delete cascade,
>   items jsonb not null,          -- [{name, price}]
>   total numeric not null,
>   note text,
>   inspection_fee numeric default 0,   -- snapshot of shops.inspection_fee when sent
>   status text not null default 'sent' check (status in ('sent','accepted','refused')),
>   sent_at timestamptz default now(),
>   decided_at timestamptz
> );
> ```
> RLS: the shop owning the booking may insert and update its quotes; the client on the booking may read them and may update **only** `status` and `decided_at`, and only from `sent` to `accepted` or `refused`. Use column-level GRANTs — a client must not be able to change the items or the total, and a shop must not be able to accept a quote on the client's behalf.
>
> The capacity trigger must count `in_inspection`, `quote_sent`, `approved` and `in_progress` as active bookings, alongside `pending` and `confirmed`.
>
> ---
>
> **Shop actions, one per stage:**
>
> | Current status | Button | Result |
> |---|---|---|
> | `confirmed` | **"În constatare"** (amber) | Sets `in_inspection`, records `inspection_started_at`. The car has arrived and is being inspected. |
> | `in_inspection` | **"Trimite deviz"** (amber) | Opens the quote composer. |
> | `quote_sent` | *(no action, waiting)* | Shows a muted line: "Deviz trimis — se așteaptă răspunsul clientului". An "Editează devizul" link replaces the sent quote with a new one. |
> | `approved` | **"În lucru"** (green) | Sets `in_progress`, records `started_at`. |
> | `in_progress` | **"Finalizare"** (green) | Opens the completion panel, which **requires the odometer reading** (Prompt 15d), then sets `done`. |
>
> **Reschedule stays available only while `confirmed`.** Once the car is physically in the shop, rescheduling is gone. The message button is always available.
>
> **Quote composer.** Opens inline in the booking card:
> - A repeating row: service or part name (text) and price (numeric, monospace, 74px wide), with a delete button per row
> - A dashed "Adaugă poziție" button that appends a row
> - An optional note field
> - A live total in amber, right-aligned, recalculated as rows change
> - "Trimite devizul", disabled while the total is zero
>
> When sent, snapshot the shop's current `inspection_fee` onto the quote, so a later change to the setting cannot alter an already-sent quote.
>
> ---
>
> **Client side.**
>
> When status is `quote_sent`, the booking card gets an amber border and shows the quote in full: every line item with its price on the right, the note if present, and the total in amber above a divider. Below it, the question "Service-ul a trimis un deviz. Îl accepți?" and two buttons:
> - **"Accept"** (green) → quote `accepted`, booking `approved`
> - **"Refuz"** (red) → asks for confirmation first, naming the fee: "Refuzi devizul? Se percepe taxa de constatare de {sumă}." On confirm: quote `refused`, booking `quote_refused`, and the inspection fee is recorded as the job's cost.
>
> If the shop's inspection fee is zero, the confirmation says simply "Refuzi devizul?" with no fee mentioned.
>
> **Status display for the client**, each with its own visual state on the card:
> - `in_inspection` — amber dot, "Mașina ta este în constatare"
> - `quote_sent` — the full quote with the two buttons
> - `approved` — green text, "Deviz acceptat — {total}. Lucrarea urmează."
> - `in_progress` — pulsing amber dot, "Mașina ta este în lucru", with the start time below as "din 09:20"
> - `quote_refused` — muted, "Deviz refuzat. Taxă de constatare: {sumă}."
>
> The client cannot cancel from `in_inspection` onwards — the car is already in the workshop.
>
> ---
>
> **Status badges** to add, following the existing pill style: În constatare (amber), Deviz trimis (amber), Deviz acceptat (green), În lucru (amber), Deviz refuzat (muted red). Plus the English equivalents.
>
> ---
>
> **Automatic messages**, written into the conversation thread at every transition, always in the **recipient's** language:
>
> | Transition | To | Message |
> |---|---|---|
> | În constatare | client | "Am primit mașina și o verificăm. Îți trimitem devizul în scurt timp." |
> | Deviz trimis | client | "Ți-am trimis devizul: {total}. Îl poți accepta sau refuza în aplicație." |
> | Client acceptă | shop | "Am acceptat devizul de {total}. Puteți începe lucrarea." |
> | Client refuză | shop | "Am refuzat devizul." |
> | În lucru | client | "Am început lucrarea la {marca} {model}. Te anunțăm când e gata." |
> | Finalizare | client | "Lucrarea la {marca} {model} este finalizată. Poți veni să ridici mașina." |
>
> **Every one of these must also trigger a push notification to the recipient**, with the same text and the counterpart's name as the title. The client must find out about the quote and about the car being ready without opening the app.
>
> ---
>
> **Completion panel.** When finalising, the work description and total cost are prefilled from the accepted quote — the shop can edit both, since the final amount sometimes differs. Both remain optional.
>
> **Shop dashboard.** Add statistic cards for how many jobs are currently `in_inspection`, `quote_sent` and `in_progress`. Bookings waiting on a client's quote decision are the ones the shop needs to chase, so surface that count clearly.
>
> All new labels go into the RO/EN dictionary — no hard-coded text.

---

## Prompt 15b - Push notification permission (both roles)

**-> BOTH INTERFACES.** Required for every push notification specified in Prompt 15 and Prompt 9 to actually work. Without this, "trigger a push notification" has nothing to trigger through.

> Implement the full permission flow for Web Push, for both clients and shops. Follow the pattern used by WhatsApp Web: an in-app explanation first, the browser's native permission dialog only on a deliberate tap, and no nagging afterwards. Never call the browser's permission API automatically on page load - it must always be triggered by a user tapping a button.
>
> Database:
> ```sql
> create table push_subscriptions (
>   endpoint text primary key,
>   user_id uuid not null references profiles(id) on delete cascade,
>   subscription jsonb not null,
>   created_at timestamptz default now()
> );
> create index on push_subscriptions (user_id);
> ```
> RLS: a user may insert, read and delete only their own subscriptions. One user may have several rows - one per device or browser they've enabled notifications on.
>
> The in-app banner (the "soft ask"). Check `Notification.permission` on load. If it is "default" (never decided) and the banner has not been dismissed this session, show a dismissible card:
> - Bell icon, amber
> - For a shop: "Activeaza notificarile ca sa afli imediat de cereri noi si de raspunsul clientilor la deviz."
> - For a client: "Activeaza notificarile ca sa afli imediat de deviz, de expirarea documentelor si cand e gata masina."
> - A primary button "Activeaza" and a muted "Nu acum" / close icon
>
> Show this banner once, near the top of Panou for shops and Cauta for clients - the first screen each role lands on. If dismissed with "Nu acum", do not show it again within the same session.
>
> The hard ask. Only when "Activeaza" is tapped:
> 1. Register the service worker if not already registered.
> 2. Call `Notification.requestPermission()`. This is a browser-native dialog - do not build a custom one.
> 3. If granted: subscribe via `pushManager.subscribe()` using the VAPID public key, then upsert the resulting subscription to `push_subscriptions` keyed by `endpoint` (so re-enabling on the same device updates the row instead of duplicating it).
> 4. If denied: hide the banner for this session and do not prompt again automatically.
> 5. If dismissed by the browser without a clear answer: treat the same as denied for this session.
>
> Manual control in Cont. Add a row in the account screen, both roles: "Notificari push" with a status - "Activate", "Dezactivate", or "Blocate de browser" - and a button to enable them if not already active. If the browser reports `Notification.permission === "denied"`, the button cannot re-trigger the native dialog (browsers block that); instead show the muted instruction "Le poti activa din setarile browserului pentru acest site."
>
> Cleanup. When a push send fails with an expired or invalid endpoint (HTTP 404/410 from the push service), delete that row from `push_subscriptions` server-side.
>
> iOS note. Web Push on iPhone only works if the app has been added to the Home Screen (iOS 16.4+) - it does not work from a normal Safari tab. Where this can be detected, adjust the banner copy to mention it rather than offering a control that will silently fail.
>
> All banner and settings text goes into the RO/EN dictionary.

---

## Prompt 15c — Quote expiry, partial approval, cancellations, no-show

**-> BOTH INTERFACES.** Completes the job flow from Prompt 15 with the cases that occur in real workshops.

> **Partial approval of a quote.** Each quote line gets a checkbox on the client's side, all ticked by default. The total recalculates live as lines are unticked. The primary action becomes "Accept selectate" when some lines are unticked, "Accept" when all are.
> - If the client accepts at least one line: the quote becomes `partially_accepted` (or `accepted` if all lines), the booking becomes `approved`, and only the approved lines form the job. Unapproved lines are kept and shown struck through in history.
> - If the client unticks everything and confirms, treat it exactly as a refusal, inspection fee included.
> - The shop sees which lines were approved before starting work, and the completion panel prefills from the approved lines only.
>
> **Quote expiry.** A quote carries `expires_at`, set when sent, using the platform's quote-expiry setting (default 3 days).
> - 24 hours before expiry: push reminder to the client, "Devizul de la {shop} expira maine."
> - On expiry with no answer: quote becomes `expired`, booking becomes `expired`, **the slot's capacity is released**, and both parties are notified. The shop can send a new quote, which restarts the clock.
>
> **Shop cancels a confirmed booking.** Add a "Anuleaza" action on confirmed bookings, requiring a short reason. The booking becomes `cancelled` with `cancelled_by = 'shop'` and the reason stored; the client is notified with the reason included in the automatic message. A shop cannot cancel once the car is in inspection — it must finish the flow or mark no-show.
>
> **Client cancellation deadline.** The client's cancel button disappears once the shop's `cancel_deadline_hours` threshold is passed, replaced by a muted line: "Contacteaza service-ul pentru a anula." Cancellation remains impossible from `in_inspection` onward regardless.
>
> **No-show.** On a confirmed booking whose slot time has passed, the shop gets a "Neprezentat" action. It sets status `no_show`, releases nothing (the day is gone anyway), and is counted per client. Visible to admin; no automatic penalty for the client. It appears in the shop's history like any other terminal state.
>
> **Appointment reminder.** 24 hours before a confirmed booking's slot, push the client: "Maine la {ora} ai programare la {shop}." Send once per booking.
>
> All new statuses need badges consistent with the existing pill style, in both languages: Expirat / Expired, Neprezentat / No-show, Acceptat partial / Partially accepted.

---

## Prompt 15d — Mandatory odometer reading

**-> SHOP INTERFACE, with consequences for the client's history and reports.**

> The shop **cannot close a job without entering the vehicle's odometer reading**. This is what turns the service history from a list of jobs into proof of maintenance: a buyer sees the oil was changed at 90,000 and again at 105,000, not merely that it was changed twice.
>
> **Database.** Add `odometer int` to `bookings`. Also store the last known reading per vehicle so it can be compared — derive it from the highest `odometer` across that plate's completed bookings rather than duplicating it on `cars`.
>
> **In the completion panel**, above the work description, add a required numeric field labelled "Kilometraj" with the unit `km` shown beside it, numeric keyboard on mobile. The confirm button stays disabled until it holds a valid value. There is no skip option: a car that came into the workshop has a readable odometer.
>
> **Validation, in this order:**
> 1. **Lower than the last known reading for this plate** → refuse, naming the previous value: "Ultima valoare înregistrată a fost 105.000 km. Verifică cifra." The shop can still correct and resubmit. Never accept silently — a decreasing odometer is either a typo or a tampered car, and both matter.
> 2. **More than 50.000 km above the last reading** → do not refuse, but require an explicit confirmation: "Sunt {n} km în plus față de ultima lucrare. Confirmi?" Long gaps between visits are normal; a mistyped extra digit is not.
> 3. **Below 100 or above 2.000.000** → refuse as an obvious typo.
> 4. First ever reading for a plate → accept any value inside the sane range, with no comparison.
>
> **Where it appears afterwards:**
> - On the completed booking card, both sides, next to the date: "105.400 km" in monospace.
> - In the shop's repair history, as a column, and searchable.
> - In the client's vehicle history, on each job.
> - **In the paid PDF report (Prompt 16e), as its own column** — this is the single most valuable field in that document for a buyer.
> - In the report's summary block, add "Kilometraj la ultima lucrare".
>
> **Consistency check for the report.** If any reading in the history is lower than an earlier one — possible when jobs were recorded out of order — flag the report with a discreet note rather than hiding it: "Citirile de kilometraj nu sunt în ordine crescătoare." Do not silently sort or correct the data.
>
> Labels in RO/EN: Kilometraj / Odometer, km / mi is **not** offered — Romania uses kilometres.

---

## Prompt 16 — Search by city, shop and service

**→ CLIENT INTERFACE ONLY.** Replaces the search behaviour from Prompt 11.

> Upgrade the client search so a driver can find shops by **what they need done**, not only by shop name.
>
> **One search field, three kinds of match.** A single input matches, simultaneously:
> - shop name
> - city
> - **any service the shop offers**, by its name from the catalogue
>
> All matching is case-insensitive and diacritic-insensitive: "vulcanizare" matches "Vulcanizare", "brasov" matches "Brașov", "frane" matches "Frâne". A shop matches if the query hits any of the three.
>
> Do not build three separate dropdowns. On a phone, one field that searches everything is faster, and a dropdown listing 150 services is unusable.
>
> **Category filter row.** Below the search field, a horizontally scrollable row of rounded chips, one per catalogue category (Revizii & Întreținere, Motor, Frânare, Anvelope & Jante, …), plus a "Toate" chip selected by default. Selecting a chip narrows results to shops offering at least one service in that category. Chips combine with the text query — both apply at once. Selected chip: amber text on an amber-tinted background with an amber border; unselected: muted text on a plain border.
>
> **City filter.** Add a second, smaller row of chips listing only the cities that actually have shops in the database — do not hard-code a city list, derive it from the data. A "Toate orașele" chip is selected by default. When the user types a city name in the search field, the matching city chip should become selected automatically.
>
> **Result cards must show why they matched.** When the query or the category filter matched a *service* rather than the shop name, add a line to the result card naming that service, for example: "Oferă: Vulcanizare". This tells the driver why this shop appeared without opening it.
>
> **Ordering stays exactly as specified in Prompt 11** — the weighted rating score. Filters narrow the set; they never reorder it and they never promote a shop.
>
> **Empty state.** When nothing matches, show a message naming what was searched, and — if a category chip or city chip is active — a button to clear the filters and search again across everything.
>
> **Result count.** Show the number of shops found above the list, e.g. "7 service-uri în Brașov".
>
> Keep the "Cum e ordonată lista?" explanation from Prompt 11 visible on this screen.

---

## Prompt 16b — Repair history (shop side)

**→ SHOP INTERFACE.** A new tab in the shop navigation, replacing the "Închise" tab inside Programări.

> Build a dedicated repair-history screen for shops. It answers one question a mechanic asks constantly: *"what did we do to this car last time?"*
>
> **Navigation change.** The shop navigation becomes: Panou · Programări · Istoric · Mesaje · Cont. Recenzii moves to a tile inside Cont, alongside Setări service and Abonament, so the bar stays at five items. The "Închise" tab is removed from Programări — completed and refused jobs live in Istoric now; Programări keeps only Cereri and Programate.
>
> **Heading:** "Istoric reparații", with a subline showing the totals: "{n} reparații · {sumă} încasat", where the sum adds up the `cost` of all completed jobs.
>
> **Search field** matching, simultaneously and diacritic-insensitively: licence plate, car make and model, client name, and service name. Typing "BV 12" finds every job on that plate; typing "Popescu" finds that client's jobs; typing "frâne" finds every brake job.
>
> **Filter chips** below it: "Toate" (default), "Finalizate", "Deviz refuzat", "Anulate". A second row with quick date ranges: "Ultima lună", "Ultimele 3 luni", "Anul acesta", "Tot".
>
> **Job cards**, newest first, one per row at every screen size. Each shows:
> - the service icon and name, with the completion date beneath
> - the total collected on the right, in monospace green
> - a divider, then the car with make, model and the plate in amber monospace, plus the client's name in muted text
> - when work was recorded, the description on its own line
> - a status badge for anything other than a completed job (Deviz refuzat, Anulată)
>
> **Tapping a card expands it inline** to show the accepted quote in full — every line item with its price and the total — plus the client's original note. This is the record a shop needs when a client returns with a complaint about a previous repair.
>
> Empty state when there are no completed jobs: "Nicio reparație finalizată încă." When a search returns nothing: "Niciun rezultat pentru „{query}"." with a button clearing the filters.
>
> **Export.** Add a small text button "Descarcă istoricul" that downloads the filtered list as CSV: date, plate, car, client, service, work performed, cost. Shops keep their own records and their accountant will ask for this.

---

## Prompt 16c — Vehicle history (client side)

**→ CLIENT INTERFACE.** Inside Garaj, per vehicle.

> Give the client the service history of each of their cars.
>
> **Entry point.** On each car card in Garaj, add a row at the bottom, above the expiry pills: "Istoric — {n} lucrări", tappable, with a chevron. Tapping it opens the vehicle's history screen. When the car has no completed jobs, show "Nicio lucrare încă" in muted text, not tappable.
>
> **Vehicle history screen.** Back link to Garaj. Header: the car's make, model, year and plate, plus a summary line: "{n} lucrări · {sumă} cheltuit în total".
>
> **Job list**, newest first, one per row. Each card shows the service icon and name, the shop name and city beneath it, the date, and the amount paid in monospace on the right. Tapping a card expands it inline to reveal the accepted quote with all line items, and the work description recorded by the shop.
>
> A "Programează din nou" button on each expanded card starts the booking flow pre-filled with the same shop and the same service — a returning oil change or inspection becomes four taps.
>
> **Matching bookings to a car.** Bookings store a `car_snapshot`, not a foreign key, so match on the **licence plate** from the snapshot, case-insensitively and ignoring spaces. Where a car has no plate recorded, match on make plus model plus year. Deliberately imperfect but correct in practice, and it keeps historical bookings intact when a car is later edited or deleted.
>
> **Client Programări stays as it is** — a chronological list of all bookings across all cars, with the active ones at the top. The vehicle history is a different view of the same data, grouped by car. Do not merge the two screens.

---

## Prompt 16d — Location permission and "Near you"

**-> CLIENT INTERFACE.** Extends search from Prompt 16. Same two-step permission pattern as push.

> Let clients find shops near them, without making location mandatory.
>
> **Permission, asked properly.** Never call the browser's location API on page load. Show an in-app banner on the search screen, once per session while permission is undecided: a pin icon, "Activeaza locatia ca sa vezi service-urile din apropiere", a primary "Activeaza" and a dismiss. Only the tap triggers the browser's native location prompt.
>
> **If granted:**
> - Store the coordinates in memory for the session; do not write a client's location to the database.
> - Above the normal results, add a section headed "Aproape de tine" listing the closest shops within a sensible radius, sorted by straight-line distance, each showing the distance ("2,3 km").
> - Show the distance on every result card in the main list too.
> - Add a sort control: "Recomandate" (the weighted rating ranking, default) and "Cele mai apropiate".
>
> **If denied or dismissed:** nothing else changes. Search by name, city and service continues to work exactly as before. Do not re-prompt automatically; leave a control in Cont to enable it later.
>
> **Distance is a display and sort option, never a ranking factor.** The default "Recomandate" order stays the weighted rating from Prompt 11. Do not blend distance into that score.
>
> Shops without coordinates simply never appear in the "Near you" section; they remain fully searchable by text.

---

## Prompt 16e — Paid vehicle history report

**-> CLIENT INTERFACE.** Extends the vehicle history from Prompt 16c. This is a paid product, sold to the client, separate from the free GDPR data export.

> Let a client buy a clean, verifiable PDF report of everything done to **one specific car** through the platform. It is meant to be handed to a buyer when selling the car.
>
> **This is not the GDPR export.** The free "Descarca datele mele" in Cont stays exactly as it is and must remain free — it is a legal right. This report is a different product: formatted, branded, and independently verifiable by a third party. Never remove or degrade the free export to push this one.
>
> **Entry point.** On the vehicle history screen for a car (Prompt 16c), add a button "Genereaza raport oficial — 29 lei". Also add it as a secondary action on the car card in Garaj. The client must have selected a specific car; there is no "all my cars" report.
>
> **Step 1 — preview, before paying.** Show what the report will contain, for that car only:
> - the car: make, model, year, plate, VIN if recorded
> - the number of completed jobs and the date range covered
> - a preview list of the jobs (service, shop, city, date, amount) with the **last two rows blurred or truncated**, so the value is visible but the content is not usable for free
> - the total amount spent
> - a clear line: "Raportul contine doar lucrarile efectuate prin Service-Hub."
>
> If the car has **no completed jobs**, do not offer the report at all — show "Nu exista lucrari finalizate pentru aceasta masina."
>
> **Step 2 — payment.** One-off payment of 29 RON through the same payment provider as the subscription, using hosted checkout. Card data never touches the app. On successful payment, the provider's verified webhook — not the browser — marks the report as paid and triggers generation.
>
> **Step 3 — the PDF.** Generate server-side, never in the browser. Contents:
> - Header: the Service-Hub wordmark, the title "Raport istoric service", and the generation date
> - **An odometer column in the jobs table** — the most valuable field in the document for a buyer
> - The car: make, model, year, plate, VIN if recorded
> - A unique report code, e.g. `SH-2026-000123`, printed prominently
> - A chronological table of every completed job: date, shop name and city, service, work performed, amount
> - Totals: number of jobs, total spent, period covered
> - A verification block: a short URL plus the code, e.g. `service-hub.ro/verifica` + `SH-2026-000123`
> - A disclaimer in small print: the report covers only work carried out through Service-Hub and does not represent the vehicle's complete service history
> - Same colour palette and fonts as the app
>
> Only jobs with status `done` appear. Refused quotes, cancellations and no-shows are excluded.
>
> **Step 4 — public verification page.** A page at `/verifica`, reachable **without an account**, where anyone can enter a report code and see a minimal confirmation: the car (make, model, plate), the number of jobs, the period covered, and the generation date. It must **not** show shop names, amounts, work descriptions or any personal data — it only confirms the report is genuine and unaltered. A buyer checks it; a stranger learns nothing.
>
> **Database.**
> ```sql
> create table history_reports (
>   id uuid primary key default gen_random_uuid(),
>   code text unique not null,              -- SH-2026-000123
>   client_id uuid not null references profiles(id) on delete cascade,
>   car_id uuid references cars(id) on delete set null,
>   car_snapshot jsonb not null,            -- make, model, year, plate, vin
>   job_count int not null,
>   total_amount numeric not null,
>   period_from date, period_to date,
>   amount_paid numeric not null,
>   paid_at timestamptz,
>   pdf_url text,
>   created_at timestamptz default now()
> );
> ```
> RLS: a client reads only their own reports. The verification page reads a **restricted view** exposing only code, car make/model/plate, job count, period and creation date — never the client, the shops or the amounts.
>
> **Re-download.** Purchased reports stay available in the client's Cont, under "Rapoartele mele", with the code, the car, the date and a download link. A report is a snapshot: if the car gets more work later, that is a new report, not an update to the old one. Downloading again is free.
>
> **Price** comes from `platform_settings` (default 29 RON) so it can be changed by admin without a code change. Admin sees all generated reports in the admin area, with the ability to void one if it was issued in error.
>
> All text in RO/EN.

---

## Prompt 17 — Layout pentru desktop

**→ BOTH INTERFACES.** Send after all screens exist and work on mobile.

> The app is currently mobile-only: fixed bottom navigation, content capped at 520px. On a desktop screen that looks like a phone floating in an empty page. Make it adapt properly, **without changing the mobile experience at all**.
>
> Use a single breakpoint at **1024px**. Below it, everything stays exactly as it is now. Above it, apply the desktop layout below.
>
> **Navigation moves from bottom to left.** On desktop, replace the bottom bar with a fixed left sidebar, 240px wide, full height, background `#1D2026` with a 1px right border in `#2C313A`. The logo tile and the two-colour wordmark sit at the top of the sidebar, with 20px padding. Below them, the same navigation items, but as full-width rows: icon on the left, label beside it, 14px text, 12px vertical padding. The active item gets an amber-tinted background (`#F5A524` at 12% alpha), amber text, and a 3px amber bar on its left edge. The bottom navigation must not be visible on desktop, and the sidebar must not be visible on mobile.
>
> **The sidebar is split into two groups.** The main navigation items sit at the top, directly under the wordmark. **Cont is pinned to the bottom of the sidebar**, separated from the rest by a 1px divider in `#2C313A` and pushed down with `margin-top: auto` so it always sits at the very bottom regardless of how many items are above it. This fills the empty vertical space and matches how desktop apps place account settings.
>
> Directly beneath Cont, add a **"Deconectare" row** in muted text with a log-out icon, styled like the other rows but without the active state. On mobile, log out stays inside the Cont screen as it is now — do not add it to the bottom navigation bar.
>
> **Content area.** To the right of the sidebar, content is capped at **900px** and centred within the remaining space, with 32px padding. Do not stretch content to the full window width — long lines of text are hard to read.
>
> **Lists stay in a single column at every screen size:**
> - **Search results: one shop per row, full width of the content area, listed one under another.** Never side by side.
> - **Shop bookings: one booking per row.**
> - **Client bookings: one booking per row.**
>
> **Only these grids gain columns on desktop:**
> - Booking step 2, day selection: 6 columns instead of 3
> - Booking step 3, time selection: 6 columns instead of 3
> - Settings service catalogue: 2 columns instead of 1
> - Shop dashboard statistic cards: stay in one row, but wider
>
> **Type scale increases slightly on desktop:** page headings 32px instead of 27px, body text 15px instead of 13-14px. Card padding goes from 13-16px to 20px. Keep every colour, radius and border exactly as specified.
>
> **Use the extra width inside the card, not by adding columns.** A full-width search result card places the avatar and shop name on the left, the rating, review count, city and service count on a line beneath, and — when the shop matched by a service search — the matched service on the right-hand side of the same card, vertically centred. The card grows in width, not in height.
>
> **Modal-like panels.** The reschedule, completion and report panels currently open inline inside a card. On desktop, keep them inline — do not convert them to pop-up dialogs. The behaviour must be identical across sizes.
>
> **Tablet range, 768px to 1024px.** Keep the bottom navigation. The service catalogue may go to 2 columns; search results and all booking lists stay single-column. Content cap becomes 720px.
>
> **Test all of this at three widths: 390px, 820px and 1440px.** At each one, every screen must be usable and nothing may overflow horizontally.
>
> Do not build a separate desktop version of the app. One codebase, responsive rules only.

---

## Prompt 17b — Accessibility, time zones and printing

**-> BOTH INTERFACES.** Cheap to do now, expensive to retrofit.

> **Accessibility.**
> - Every interactive element is a real `<button>` or `<a>`, reachable by keyboard, with a visible focus ring in the amber accent. Do not use clickable `<div>`s.
> - Every icon-only button carries an `aria-label` in the current language.
> - Form fields have real `<label>` elements tied to them, not just placeholder text — a placeholder disappears when typing and is invisible to screen readers.
> - Status is never communicated by colour alone: a red badge also reads "Respinsă", a green one "Confirmată". A colour-blind mechanic must be able to use this.
> - Text contrast meets WCAG AA. The muted grey `#8A909B` on `#14161A` passes; do not go lighter for body text.
> - Tap targets at least 44 × 44 px. Mechanics have thick fingers and dirty screens.
> - `prefers-reduced-motion` disables the pulsing dot and any transitions.
>
> **Time zones.** Store every timestamp in UTC. Display every date and time in **Europe/Bucharest**, regardless of the viewer's device — a booking at 09:00 means 09:00 at the shop, whether the client opens the app from Brașov or from Germany. Never format using the browser's local zone.
>
> **Printing.** The shop's daily schedule and the repair history must print cleanly: hide navigation and buttons, switch to dark text on white, keep table borders. Many small shops still pin the day's list on the wall.

---

## Prompt 18 — Public landing page

**→ NO ACCOUNT NEEDED.** A separate page at the root URL, for people who are not signed in.

> Build a public landing page shown at the root URL to visitors who are not signed in. Signed-in users skip it and go straight to their own interface.
>
> This page is a website, not an app screen — it scrolls normally, has no bottom navigation, and is fully responsive from 390px to 1440px.
>
> **Top bar:** logo tile and the two-colour wordmark on the left; on the right, a language switch and two buttons — "Intră în cont" (dark) and "Creează cont" (amber).
>
> **Hero section.** Headline: "Programări auto, fără telefoane." Subline: "Cauți service, te programezi din telefon și primești deviz înainte să se lucreze ceva. Fără să suni pe nimeni." Two buttons: "Sunt client" and "Sunt service", each leading to registration with that role preselected. On the right of the hero on desktop, or below it on mobile, place a mockup of the app screen — a rounded rectangle in `#1D2026` containing a simplified version of the search screen.
>
> **Section: for drivers.** Three cards side by side on desktop, stacked on mobile: "Cauți după oraș sau intervenție", "Primești deviz și decizi tu", "Afli când e gata mașina". Each with an icon, a heading and two lines of text.
>
> **Section: for shops.** Same three-card layout, dark background to separate it visually: "Clienții se programează singuri", "Tu decizi câte mașini iei pe zi", "Deviz digital, acceptat de client în aplicație". Below the cards, a price block: "100 lei pe lună · primele 90 de zile gratuite · fără contract", and a button "Înscrie-ți service-ul".
>
> **Section: how it works.** Four numbered steps in a row on desktop, vertical on mobile: caută → alege ora → service-ul confirmă → afli când e gata.
>
> **Trust block.** A short section stating plainly: "Recenzii de la clienți reali. Poziția în listă se câștigă din notele primite după lucrări finalizate." Give it visual weight.
>
> **Footer:** links to Termeni și condiții, Politica de confidențialitate, Politica de cookies, plus a contact email. Do not put a fake address, fake phone number or fake social links — leave placeholders clearly marked if the data is missing.
>
> Use exactly the same theme tokens, fonts and radii as the app. The landing page must look like the same product, not a separate marketing site.
>
> Do not invent statistics, customer counts, testimonials or logos of companies. We do not have them yet.

---

## Prompt 19 — Admin role and access

**-> ADMIN INTERFACE.** A third role, entirely separate from client and shop.

> Add an **admin** role. It is never available through public sign-up: an admin account is created directly in the database by setting `profiles.role = 'admin'`. There must be no UI anywhere that can create, request or escalate to an admin account.
>
> **Access.** Admin signs in through the normal sign-in form; on success, the role routes them to the admin interface instead of client or shop screens. Optionally place admin screens under a path that is not linked from anywhere public.
>
> **Admin navigation** (sidebar on desktop, bottom bar on mobile, five items): Prezentare · Service-uri · Clienti · Rezervari · Moderare. Everything else — abonamente, catalog, setari platforma, export, difuzare — lives as tiles inside a sixth screen reached from the account menu.
>
> **Every admin write is logged.** Insert into `admin_audit_log`: who, what action, which entity, the values before and after, and when. This is not optional — it is what makes the role safe to hold.
>
> **Database access.** The admin role bypasses the per-user RLS restrictions for reading, but writes still go through explicit, audited actions — do not simply grant blanket write access to every table from the browser.
>
> **Overview screen (Prezentare).** Statistic cards: shops by state (active / trial / inactive / suspended), total clients, bookings today / 7 days / 30 days, reported reviews awaiting a decision, subscriptions (active, trial ending within 7 days, past due), monthly recurring revenue. Below them, a recent-activity feed of the last 50 significant events (new shop, new booking, review reported, payment failed).

---

## Prompt 20 — Admin management screens

**-> ADMIN INTERFACE.**

> **Service-uri.** Searchable list: account ID, name, city, email/phone verification, plan status, created date, last activity. Filters by state. Opening one shows the full profile, its settings, bookings, reviews, subscription, staff and audit history. Actions: verify phone manually, suspend and unsuspend, edit any field, extend the trial by N days, set plan status manually, delete the shop. Suspending hides the shop from search immediately and blocks new bookings.
>
> **Clienti.** Searchable list: account ID, name, email, phone, verification, created, booking count, no-show count. Opening one shows profile, saved cars, bookings, reviews and message threads read-only. Actions: suspend, unsuspend, delete.
>
> **Rezervari.** All bookings across the platform, filterable by status, shop, client and date range. Detail view shows the quote, the work performed and the full conversation. Action: force-cancel with a reason, notifying both parties.
>
> **Moderare.** The reported-reviews queue first, oldest first, each showing the review text, the reason given, the shop, and how long it has been waiting — the platform promises a decision within 5 working days, so the age must be visible. Two actions: **Pastreaza** (dismiss the report, review stays) or **Sterge** (remove it, and recalculate that shop's average rating and review count). A free-text note can be attached to the decision. Both parties are notified of the outcome. Below the queue, a searchable list of all reviews.
>
> Every one of these actions writes to the audit log.

---

## Prompt 21 — Admin platform tools

**-> ADMIN INTERFACE.** Reached as tiles from the admin account screen.

> **Abonamente si facturi.** All subscriptions with status, next billing date and provider reference. Manual overrides (extend trial, mark active, cancel). Invoice list with download links.
>
> **Catalog de servicii.** Manage the service catalogue from the database rather than from a static file: add a service, rename it, enable or disable it, reorder categories and services, add or rename categories. **Service IDs are permanent and must never change**, because bookings reference them. A disabled service stays intact on historical bookings but can no longer be selected by shops or clients.
>
> **Setari platforma.** Editable values: subscription price, trial length in days, quote expiry in days, ranking prior average and weight, default booking limits for new shops, and the RO/EN text of each notification. Changing any of these affects only future records — never existing bookings, quotes or subscriptions.
>
> **Difuzare.** Compose an in-app notice and optionally a push notification, addressed to all shops, all clients, or everyone in one city. Preview before sending. Every broadcast is logged with its audience and content.
>
> **Export.** CSV download of shops, clients, bookings, reviews and subscriptions, honouring any filters applied.
>
> **Mesaje.** Open any client–shop thread read-only, for resolving disputes. Admin never writes into a thread.

---

## Prompt 22 — Reports and charts (build last)

**-> SHOP INTERFACE.** A sixth tile inside the shop's Cont screen, next to Setări, Abonament and Recenzii.

> **Build this last.** It reads data the rest of the app produces and delivers nothing in a shop's first weeks — a workshop with 10 completed jobs has nothing to analyse. It matters from month three onward, and it is the screen that makes a shop renew.
>
> **Screen: "Rapoarte".** A period selector at the top as chips: "Luna aceasta", "Ultimele 3 luni", "Anul acesta", "Tot". Everything below recalculates with it. All figures come from completed jobs (`done`) unless stated.
>
> **Top row — three headline numbers**, each a card with a large figure in the display font and the change against the previous comparable period beneath it, in green or red with an arrow:
> - **Încasat** — sum of `cost`
> - **Lucrări** — count of completed jobs
> - **Valoare medie** — encasat ÷ lucrări
>
> **Chart 1 — Încasări pe lună.** A bar chart, last 12 months, amber bars, value above each bar, month names beneath. This is the one a shop owner screenshots.
>
> **Chart 2 — Lucrări pe tip de serviciu.** A horizontal bar list, most frequent first, showing service name, count, and revenue from it. Top 8 only, then "Altele". Tells the shop where its money actually comes from — often not where the owner assumes.
>
> **Clienți.** A card with three figures:
> - **Clienți unici** in the period
> - **Clienți care au revenit** — those with more than one completed job ever, shown as a count and a percentage. **This is the single most valuable number on the screen**: a shop that keeps customers has a business; one that does not is buying new ones forever.
> - **Lucrări per client**, average
>
> **Devize.** Acceptance behaviour, which no shop currently measures:
> - **Rata de acceptare** — accepted ÷ sent, as a percentage with a progress bar
> - **Devize refuzate** and the total inspection fees collected from refusals
> - **Timp mediu de răspuns** — how long clients take to decide
> A low acceptance rate means prices are too high or quotes are badly explained. Add one muted line saying so, since most owners will not draw the conclusion themselves.
>
> **Ocupare.** Average cars per day against the configured capacity, as a percentage, plus the busiest weekday. A shop consistently at 40% can take more work; one at 95% should raise its capacity or its prices.
>
> **Export.** A button downloading the period's data as CSV, for the accountant.
>
> **Empty state.** With fewer than 3 completed jobs, do not draw charts of nothing. Show: "Rapoartele se completează pe măsură ce finalizezi lucrări. Revino după câteva săptămâni."
>
> **Charts must be drawn with SVG or canvas, not an external charting library** — the app has no other dependency and this screen does not justify one.
>
> All labels in RO/EN.

---

## Prompt de reparație — dacă totul a ajuns în interfața de service

Trimite asta dacă tool-ul a construit deja o singură interfață, cu ecrane de client în meniul service-ului.

> The app currently mixes both roles into one interface. Fix it.
>
> There must be **two separate interfaces**, selected by the signed-in account's role, sharing nothing except authentication.
>
> **Client navigation (5 items):** Caută · Garaj · Programări · Mesaje · Cont
> **Shop navigation (5 items):** Panou · Programări · Mesaje · Recenzii · Cont
>
> Specifically:
> - **Remove the Garage entirely from the shop interface.** A shop has no vehicles of its own. The garage exists only for clients, holding the client's own cars.
> - **Remove Search from the shop interface.** Shops do not browse other shops.
> - **Remove shop settings and subscription from the client interface.**
> - Shop settings and subscription must **not** be navigation items even for shops — they are tiles inside the shop's Cont screen, so the bar stays at five items.
> - The client's bookings screen and the shop's bookings screen are **different screens**. The client sees their own bookings with cancel and review actions. The shop sees received requests in three tabs, with confirm, reschedule, decline and complete actions.
> - The reviews screen in the shop navigation is for **reviews received**, with reply and report. Clients do not have a reviews tab; they write a review from a completed booking.
>
> Enforce this in routing: the role decides the whole navigation set and which screens are reachable. A client hitting a shop route and a shop hitting a client route must both be redirected to their own home screen.
>
> Also enforce it in the database: a shop must have no read access to the `cars` table at all.

---

## Final check

Parcurge lista in aplicatia care ruleaza, inainte sa accepti rezultatul.

**Structura si roluri**
- [ ] Clientul are 5 taburi: Cauta, Garaj, Programari, Mesaje, Cont
- [ ] Service-ul are 5 taburi: Panou, Programari, Istoric, Mesaje, Cont
- [ ] Clientul ajunge la istoricul unei masini din trei locuri: Garaj, Cont, si de pe o programare finalizata
- [ ] Un CUI gresit e respins cu mesaj clar, nu acceptat in tacere
- [ ] Un IBAN gresit e respins
- [ ] CUI, sediul social si IBAN-ul nu apar nicaieri pe profilul public al atelierului
- [ ] Un atelier poate primi programari fara sa fi completat datele fiscale
- [ ] „Ai uitat parola?" trimite link si raspunsul e la fel, indiferent daca adresa exista
- [ ] Apas „Confirma" de trei ori pe semnal prost — se creeaza o singura confirmare
- [ ] Cu internetul oprit apare bara „Fara conexiune", iar la revenire dispare
- [ ] Listele arata schelete la incarcare, nu „Nicio programare" urmat de continut
- [ ] Al 4-lea booking activ la acelasi service e refuzat cu mesaj clar
- [ ] Un service nou vede lista de 4 pasi si nu apare in cautari pana nu alege servicii
- [ ] Navighez toata aplicatia doar cu tastatura, cu inel de focus vizibil
- [ ] O programare la 09:00 arata 09:00 si daca deschid aplicatia din Germania
- [ ] Nu pot finaliza o lucrare fara sa introduc kilometrajul
- [ ] Un kilometraj mai mic decat ultimul e refuzat, cu afisarea valorii anterioare
- [ ] Un salt de peste 50.000 km cere confirmare, dar nu blocheaza
- [ ] Kilometrajul apare in istoricul clientului si in raportul PDF
- [ ] Fiecare card din panou deschide lista filtrata corespunzatoare
- [ ] Un card cu zero nu e apasabil
- [ ] Rapoartele arata clientii reveniti si rata de acceptare a devizelor
- [ ] Cu sub 3 lucrari finalizate, rapoartele afiseaza mesaj, nu grafice goale
- [ ] Garajul nu apare nicaieri in interfata de service
- [ ] Nu exista nicio cale publica de a crea un cont de admin
- [ ] Adminul vede toate cele 5 ecrane si fiecare actiune a lui apare in jurnalul de audit
- [ ] Fiecare cont are ID vizibil (C-00001 / S-00001) in ecranul Cont

**Fluxul complet, cap la cap**
- [ ] Cont nou de client, cu bifa de termeni obligatorie si email de confirmare
- [ ] Pana la confirmarea emailului, service-ul nu apare in cautari
- [ ] Caut „vulcanizare" si gasesc service-urile care ofera serviciul
- [ ] Ma programez in 4 pasi si primesc ecranul de confirmare
- [ ] Service-ul confirma, apoi apasa „In constatare"
- [ ] Service-ul trimite deviz; clientul il vede cu pozitii si total
- [ ] Clientul debifeaza o pozitie si accepta restul — totalul se recalculeaza
- [ ] Service-ul apasa „In lucru", apoi „Finalizare"
- [ ] Clientul lasa recenzie; service-ul raspunde public
- [ ] Pe alt flux: clientul refuza devizul si se inregistreaza taxa de constatare

**Cazurile care se uita**
- [ ] Un deviz fara raspuns expira dupa N zile si elibereaza locul din zi
- [ ] Clientul primeste reminder cu 24h inainte de programare
- [ ] Service-ul isi pune concediu si zilele alea dispar din calendar
- [ ] Sambata cu program scurt afiseaza doar orele corecte
- [ ] Dupa termenul de anulare, clientul nu mai poate anula singur
- [ ] Service-ul marcheaza neprezentare pe o programare trecuta
- [ ] Un service neplatitor dispare din cautari dar isi pastreaza datele
- [ ] Raportul de istoric se genereaza pe o masina anume, selectata de client
- [ ] Exportul gratuit din Cont a ramas gratuit si complet
- [ ] Pagina publica de verificare arata doar masina si numarul de lucrari, fara sume si fara nume de service-uri
- [ ] O masina fara lucrari finalizate nu ofera deloc butonul de raport

**Notificari si timp real**
- [ ] Bannerul de notificari apare o data, la ambele roluri
- [ ] „Activeaza" declanseaza popup-ul nativ al browserului, nu unul construit
- [ ] Refuzul nu redeschide bannerul; ramane un buton in Cont
- [ ] Bannerul de locatie functioneaza la fel si apare sectiunea „Aproape de tine"
- [ ] O programare noua apare la service fara refresh, in cateva secunde
- [ ] Un mesaj nou apare in conversatie fara refresh

**Reguli care nu se vad, dar conteaza**
- [ ] Pun capacitatea pe 1, fac o programare, ziua devine gri pentru a doua
- [ ] Reprogramez intr-o zi plina si e refuzat, programarea ramane neschimbata
- [ ] Un service nou, fara recenzii, apare la mijlocul listei, nu ultimul
- [ ] Incerc din consola browserului `UPDATE shops SET plan='standard'` — baza refuza
- [ ] Un cont de service nu poate citi tabelul `cars`
- [ ] Un client nu poate modifica pozitiile sau totalul unui deviz primit
- [ ] Un service nu poate accepta el insusi devizul in locul clientului
- [ ] Nicaieri in aplicatie nu apar preturi publicate pe servicii

**Prezentare**
- [ ] Logotipul: SERVICE- alb, HUB portocaliu, pe acelasi rand, peste tot
- [ ] La 390px, 820px si 1440px nimic nu iese pe orizontala
- [ ] La 1440px navigarea e in stanga, cu Cont si Deconectare jos
- [ ] Rezultatele cautarii sunt unul sub altul, la orice marime
- [ ] Comut pe engleza: niciun text netradus
- [ ] Pagina publica se vede fara cont, cu documentele legale in subsol
