# Service-Hub — Architecture

The technical decisions every task builds on. Where this file and `lovable-prompts.md` disagree, this file wins (list of overrides in §19).

---

## 1. Shape of the system

```
Browser (React SPA on Netlify)
  ├─ reads public data + own rows directly (supabase-js, RLS decides)
  ├─ changes state only through RPC functions (Postgres, SECURITY DEFINER)
  └─ subscribes to Realtime (bookings, messages, reviews, counters)

Supabase (Frankfurt)
  ├─ Postgres: tables + RLS + triggers + RPC functions + pg_cron jobs
  ├─ Auth: email/password, email confirmation, custom SMTP (Resend)
  ├─ Storage: logos (public), reports (private, signed URLs)
  └─ Edge Functions: notifications, payments, PDF, geocoding, exports, SMS

Outside: Resend · Web Push (VAPID) · SMSO · Stripe · SmartBill/Oblio · Geocoding · Sentry
```

Rule of thumb: **anything that changes a booking, a quote, money, visibility or verification is a database function or an Edge Function — never a direct table write from the browser.**

---

## 2. Data model

All tables have RLS enabled. `id uuid primary key default gen_random_uuid()` unless stated. `created_at timestamptz default now()` everywhere.

### Identity

**profiles** — one per auth user
- `id` → `auth.users(id)` on delete cascade
- `role text not null check (role in ('client','shop','admin'))`
- `display_id text unique not null` — `C-00001` / `S-00001` / `A-00001`, from one sequence per role, never reused
- `name`, `phone`, `lang text check (lang in ('ro','en')) default 'ro'`
- `email_verified_at`, `phone_verified_at`, `phone_verified_by_admin boolean default false`
- `suspended boolean default false`
- `terms_version text`, `terms_accepted_at`
- `push_prompt_dismissed_at`, `location_prompt_dismissed_at`, `last_active_at`
- `deleted_at` — set when the account is deleted (§11 `delete-account`); only kept rows are anonymized shop owners
- Created by a trigger on `auth.users` insert from sign-up metadata. Metadata role may only be `client` or `shop`; anything else becomes `client`. **The trigger can never create an admin.**
- `email_verified_at` is synced by a trigger when `auth.users.email_confirmed_at` changes.
- Browser may update only `name`, `phone`, `lang`, `*_prompt_dismissed_at` (column grants).

**shops** — public profile and booking rules (no secret columns here)
- `owner_id unique` → profiles
- Public: `name`, `description`, `logo_url`, `street`, `city not null`, `county`, `postal_code`, `phone`, `phone2`, `website`, `facebook`, `year_established`, `latitude`, `longitude`, `lang`
- Rules: `daily_capacity int not null default 5 check (between 1 and 100)`, `cars_per_slot int not null default 1 check (between 1 and 20)`, `slot_minutes int not null default 60 check (slot_minutes in (30,60))`, `min_notice_hours int default 2`, `max_advance_days int default 30`, `cancel_deadline_hours int default 2` (0 = anytime), `inspection_fee numeric(10,2) default 0`
- Preferences: `sms_on_new_booking boolean default false`, `daily_digest boolean default false`
- Controlled by system/admin only: `active boolean default true`, `suspended boolean default false`, `setup_completed_at`, `hours_reviewed_at` (set by `save_shop_hours`)
- First-run checklist and Panou (T05): `capacity_reviewed_at`, `billing_reminder_dismissed_at` — the browser may set them, but a trigger (`shops_stamp_times`) always stores the server time and never clears them
- Read access: any signed-in user when `is_shop_public(id)`; always for the shop's members, admin, and clients who have a booking with that shop (so history keeps showing the shop even if it later becomes inactive).
- On shop sign-up the trigger also creates: the `shops` row (name + city from metadata), default `shop_hours` (Mon–Fri 08:00–18:00, Sat–Sun closed), a `subscriptions` row in `trial`, and the owner row in `shop_staff`.

**shop_billing** — fiscal data, owner + admin only, never public
- `shop_id` primary key → shops
- `legal_name`, `vat_id`, `reg_com`, `legal_address`, `vat_payer boolean`, `bank_name`, `iban`, `billing_email`, `legal_rep`, `updated_at`
- Check constraints call the same validators as the frontend (§14), so invalid data is refused even if sent directly.

**shop_hours** — `(shop_id, weekday)` primary key, `weekday 0–6` (0 = Sunday), `is_closed`, `open_time time`, `close_time time`

**shop_closures** — `shop_id`, `start_date`, `end_date`, `label`

**shop_staff** — `shop_id`, `user_id` (null until the invite is accepted), `invited_email`, `role in ('owner','staff')`, `invite_token_hash`, `invited_at`, `accepted_at`
- Helpers (SQL, `stable`, `security definer`): `my_shop_id()`, `is_shop_member(shop_id)`, `is_shop_owner(shop_id)`, `is_admin()`.
- **Invitations (T05):** the owner's browser makes a random 256-bit token; `invite_staff(email, token, request_id)` stores only its SHA-256 (at most 10 staff rows per shop; inviting the same address again replaces the token). The owner sends the link `/invitatie/<token>` (by hand until invitation emails, T13). `get_staff_invite(token)` (callable signed out) shows shop name, city and the invited address; an invitation is valid 14 days. Sign-up with `invite_token` in the metadata makes the account a `shop` account **joined to that shop** (no shop of its own) — only when the token is valid and the address is the invited one; otherwise the sign-up is refused (`invite_invalid`). `list_shop_staff()` gives members the team with names; the owner removes staff with a plain delete (RLS: staff rows only, owner only). A removed member keeps a `shop` account with no shop and sees "Contul tău nu mai e legat de niciun service".
- Staff operate bookings, quotes, messages, reviews and settings; **only the owner** sees `shop_billing`, subscription, staff management, and can delete the shop.

### Catalog

**service_categories** — `key text primary key` (`cat_rev`…), `name_ro`, `name_en`, `position`, `enabled`
**services** — `id text primary key` (`ulei`, `frane`…, **never changes**), `category_key`, `icon` (Lucide name), `name_ro`, `name_en`, `position`, `enabled`
- Seeded from `docs/service-catalog.json` by a generated migration. Disabled services stay valid on old bookings but cannot be selected.

**shop_services** — `(shop_id, service_id)` primary key

Settings writes (T05): public data, booking rules, fee, preferences, closures and billing are plain row updates limited by column grants, RLS and check constraints; the week's hours go through `save_shop_hours(hours[7], request_id)` (all seven days in one transaction, half-hour times, close after open) and the offered services through `set_shop_services(ids[], request_id)` (the whole set, enabled services only).

### Client data

**cars** — owner only; **shops have no access at all**
- `owner_id`, `make not null`, `model not null`, `year int`, `plate`, `plate_norm` (generated: upper-case, no spaces or dashes), `vin` (17 chars, upper-case, no I/O/Q), `itp_expiry date`, `rca_expiry date`, `vignette_expiry date`
- `reminded jsonb default '{}'` — thresholds already notified per document and expiry date, e.g. `{"itp":{"2026-11-02":[30,7]}}`, so a reminder is never sent twice
- Written by the browser as plain rows (column grants + RLS). **A new car's `id` is made in the browser once per form** (T07), so a save retried after a lost answer hits the primary key and the app reads back the row it already wrote instead of adding the car twice.

**favorites** — `(client_id, shop_id)` primary key

### Bookings and quotes

**bookings**
- `ref text unique` (short human reference, e.g. `P-004213`), `shop_id`, `client_id`, `service_id`
- Snapshots: `client_name`, `client_phone`, `client_lang`, `car_id` (on delete set null), `car_snapshot jsonb` (`make, model, year, plate, plate_norm, vin`)
- `date date`, `slot time` (local Europe/Bucharest), `note`
- `status` — see §3
- Timestamps: `status_changed_at`, `confirmed_at`, `inspection_started_at`, `started_at`, `done_at`, `cancelled_at`, `reminder_sent_at`
- `cancelled_by in ('client','shop','admin')`, `cancel_reason`, `decline_reason`
- Completion: `work text`, `cost numeric(10,2)`, `odometer int`
- Indexes: `(shop_id, date, status)`, `(client_id, created_at desc)`, `((car_snapshot->>'plate_norm'))`
- **No direct insert/update grants for `authenticated`.** Reads: client sees own; shop members see their shop's; admin sees all.

**quotes**
- `booking_id`, `version int` (1, 2, … per booking), `status in ('sent','accepted','partially_accepted','refused','expired','superseded','withdrawn')`
- `note`, `inspection_fee` (snapshot at sending), `total_sent`, `total_approved`, `sent_at`, `expires_at`, `decided_at`, `sent_by`
**quote_items** — `quote_id`, `position`, `name`, `price numeric(10,2) check (price >= 0)`, `approved boolean` (null until decided)
- Items and totals are immutable once sent. "Edit quote" creates version N+1 and marks the old one `superseded` (kept for history).

**reviews**
- `booking_id unique`, `shop_id`, `client_id`, `client_display_name` ("Andrei M."), `rating int check (1..5)`, `text`
- `reply`, `reply_at` — shop members may update only these (column grants)
- Reports: `report_reason in ('fake','abusive','wrong_shop','personal_data')`, `reported_at`, `report_status in ('pending','kept','removed')`, `report_decided_at`, `report_note`, `removed_at`
- Removed reviews disappear from public lists and from averages. A reported review stays visible until admin decides.
- Read access (T06): a visible review is readable together with its shop (`can_read_shop`); the author, the shop's members and admin also see removed ones.

**shop_ratings** (view) — `shop_id`, `review_count`, `rating_sum`, `average`, `weighted_score` (formula §8), excluding removed reviews.

### Messages

**threads** — one per `(shop_id, client_id)` pair, `client_name` (kept in sync with the profile by trigger, so shops never read client profiles), `last_message_at`, `client_last_read_at`, `shop_last_read_at` (unread badges)
**messages** — `thread_id`, `kind in ('user','system')`, `sender_id` (null for system), `body` (user messages), `event text` + `params jsonb` (system messages), `booking_id`
- System messages store an **event code and parameters, not text**. The UI renders them in the **reader's** language, so each side always reads its own language. Rendered centered with the label "mesaj automat" / "automatic message".
- **T11.** `list_threads()` gives the caller's threads (a client's own, or their shop's; admin: none yet) newest first, with the other side's name, the last message as stored and `unread` = the other side's messages after the caller's side read marker. "Own side" (`message_is_own_side`, mirrored by `isOwnSide()` in `src/lib/messages.ts`): a client's own messages and the automatic messages with `params.by = 'client'`; for a shop, every sender who is not the thread's client and `by = 'shop'`; `by = 'admin'/'system'` belong to neither side. `booking_thread(booking)` returns the thread of a booking's pair (the "Mesaj" button on booking cards, both sides). The app loads the list once per interface (`ThreadsProvider`, Realtime on `threads` filtered to the client or the shop: every message and read marker touches the row) and the open conversation subscribes to `messages` of that thread; after a reconnect the newest page (50) is read again. `systemMessageText()` turns event + params into the reader's sentence from the reader's side. The shop's reviews (`/s/cont/recenzii`) are read straight from `reviews` (RLS) and kept live through Realtime on `reviews` filtered by `shop_id`; the public shop page re-reads itself on the same changes.

### Notifications

**push_subscriptions** — `endpoint text primary key`, `user_id`, `subscription jsonb`, `user_agent`, `last_success_at`. Several per user (one per device).
**notification_events** (outbox) — `user_id` (recipient), `event`, `params jsonb`, `booking_id`, `channels text[]`, `created_at`, `processed_at`, `attempts`, `last_error`. Written by the RPC functions in the same transaction as the change.
**notifications_log** — `event_id`, `user_id`, `channel in ('push','email','sms')`, `status`, `error`, `sent_at`
**notices** (admin broadcasts) — `audience in ('shops','clients','all','city')`, `city`, `title_ro`, `body_ro`, `title_en`, `body_en`, `send_push`, `created_by`; **notice_reads** — `(user_id, notice_id)`

### Money

**subscriptions** — `shop_id` primary key, `status in ('trial','active','past_due','cancelled','inactive')`, `trial_ends_at`, `current_period_end`, `cancel_at_period_end`, `price_ron`, `stripe_customer_id`, `stripe_subscription_id`. Written only by the Stripe webhook function or admin.
**invoices** — `shop_id`, `series`, `number`, `amount`, `vat_amount`, `currency`, `issued_at`, `pdf_url`, `provider`, `provider_ref`, `stripe_invoice_id`, `status`
**history_reports** — as in Prompt 16e, plus `status in ('pending_payment','paid','generated','void')`, `stripe_session_id`, `void_reason`, `latest_odometer`, `odometer_out_of_order boolean`
**stripe_events** — `id text primary key` (Stripe event id), `type`, `payload jsonb`, `processed_at` — makes the webhook idempotent

### Platform

**platform_settings** — single row (`id = 1`): `subscription_price_ron 100`, `trial_days 90`, `quote_expiry_days 3`, `report_price_ron 29`, `ranking_prior_avg 4.3`, `ranking_prior_weight 3`, defaults for new shops (capacity, slot, notice, advance, cancel deadline), `limits jsonb` (§6), `notification_texts jsonb` (admin overrides of RO/EN texts). Readable by everyone signed in; writable by admin only. Changes never alter existing bookings, quotes or subscriptions.
**admin_audit_log** — `admin_id`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `created_at`. Every admin write inserts here, inside the same function.
**request_log** — `request_id uuid primary key`, `user_id`, `fn`, `result jsonb`, `created_at` (idempotency, purged after 7 days)
**phone_verifications** — `user_id`, `phone`, `code_hash`, `expires_at`, `attempts`, `verified_at`
**schema_version** — single row `version int` (§18)

### Storage

- `logos` bucket — public read; write only by that shop's members, path `shop_id/…`, images ≤ 2 MB.
- `reports` bucket — private; downloads through short-lived signed URLs created by an Edge Function after checking ownership.

---

## 3. Booking and quote state machine

Main path:

```
pending → confirmed → in_inspection → quote_sent → approved → in_progress → done
```

Side exits:
- `pending` → `declined` (shop) or `cancelled` (client)
- `confirmed` → `cancelled` (client before the deadline, or shop with a reason) or `no_show` (shop, after the slot time)
- `quote_sent` → `quote_refused` (client refuses all lines), `expired` (no answer in time), or back to `in_inspection` (shop withdraws the quote)
- any active status → `cancelled` (admin, with a reason)

**Active** (count toward capacity): `pending, confirmed, in_inspection, quote_sent, approved, in_progress`
**Terminal:** `done, declined, cancelled, quote_refused, expired, no_show`

| RPC function | Caller | From → To | Rules and side effects |
|---|---|---|---|
| `create_booking(shop_id, service_id, date, slot, car_id \| car jsonb, save_car, note, request_id)` | client | — → `pending` | client email verified, not suspended; shop public (§5); service offered and enabled; **slot strictly in the future** and available (§4); limits (§6); snapshots; creates thread if missing; event `booking_requested` → shop (+SMS if enabled) |
| `confirm_booking(id)` | shop | `pending → confirmed` | event `booking_confirmed` → client |
| `decline_booking(id, reason?)` | shop | `pending → declined` | event → client |
| `reschedule_booking(id, date, slot)` | shop | `pending/confirmed → confirmed` | re-checks that the new slot is in the future and re-checks capacity at submit; fails safely with `past_slot`/`day_full`/`slot_full`, booking unchanged; event → client |
| `cancel_booking(id)` | client | `pending/confirmed → cancelled` | only before `date+slot − cancel_deadline_hours`; event → shop |
| `shop_cancel_booking(id, reason)` | shop | `confirmed → cancelled` | reason required, included in message; event → client |
| `mark_no_show(id)` | shop | `confirmed → no_show` | only after the slot time has passed |
| `start_inspection(id)` | shop | `confirmed → in_inspection` | `inspection_started_at` |
| `send_quote(id, items[], note)` | shop | `in_inspection → quote_sent` | ≥ 1 item, total > 0; snapshots `inspection_fee`; `expires_at = now + quote_expiry_days`; max 20 quote versions per booking; event → client |
| `replace_quote(id, items[], note)` | shop | `quote_sent → quote_sent` | old version `superseded`, new version, clock restarts; event → client |
| `withdraw_quote(id)` | shop | `quote_sent → in_inspection` | quote `withdrawn` |
| `decide_quote(id, quote_id, approved_item_ids[])` | client | `quote_sent → approved` or `quote_refused` | `quote_id` = the version the client saw (a replaced one → `quote_changed`); all items → `accepted`; some → `partially_accepted`; none → refusal: quote `refused`, booking `quote_refused`, `cost = inspection_fee`; events → shop |
| `start_work(id)` | shop | `approved → in_progress` | `started_at`; event → client |
| `complete_job(id, odometer, work, cost, confirm_jump)` | shop | `in_progress → done` | odometer rules (§7); work/cost prefilled from approved items, editable; `done_at`; event → client |
| `admin_force_cancel(id, reason)` | admin | any active → `cancelled` | both parties notified; audit log |
| `expire_quotes()` | cron | `quote_sent → expired` | quote `expired`; capacity released; events → both |

Every function: `security definer`, `set search_path = ''`, fully-qualified names, checks `auth.uid()` membership, locks the booking row (`for update`), validates the current status, records `request_id`, writes the thread message and the outbox event, returns the updated booking. Errors are raised with stable codes (`raise … using message = code, detail = JSON parameters`, e.g. `odometer_lower` + `{"previous":105400}`) (`past_slot`, `day_full`, `slot_full`, `limit_active_shop`, `not_allowed`, `wrong_status`, `odometer_lower`, `odometer_jump`, …) that the UI maps to translated messages (`src/data/rpc.ts`; its code list is checked against the migrations by a unit test). **A raw database error is never shown to a user.** `mark_thread_read` and `get_shop_setup` (which stamps `setup_completed_at`) are the writes without `request_id`: repeating them is harmless.

---

## 4. Availability

**Never in the past.** `date + slot` must be strictly in the future in Europe/Bucharest, in `create_booking` **and** in `reschedule_booking`, checked at the moment of the write — not only when the calendar was drawn. A screen left open overnight, a stale cached day list, a replayed request or a call made straight against the API all get the error `past_slot`; the UI shows a translated message and reloads the day list. The `BEFORE INSERT OR UPDATE` trigger on `bookings` repeats the same check, so no path can write a booking into the past. Today's already-passed slots are also excluded from `get_availability`, and a day whose last slot has passed no longer appears as bookable.

For a shop, a date is bookable when all hold:
- the slot has not passed (above);
- `shop_hours` for that weekday is open, and the date is not inside any `shop_closures` range;
- `date ≥ today` and the first slot respects `min_notice_hours`; `date ≤ today + max_advance_days` (all in Europe/Bucharest);
- active bookings that day `< daily_capacity`.

Slots: from `open_time` to `close_time − slot_minutes`, every `slot_minutes`. A slot is available when its start is at least `min_notice_hours` from now and active bookings at that exact slot `< cars_per_slot`.

The booking calendar shows the next 12 bookable days (3 columns mobile, 6 desktop) with "places left" per day; full days dimmed and disabled. The time grid shows taken slots struck through and disabled.

**Booking flow (T07).** `/c/service/:id/programare?pas=&serviciu=&zi=&ora=` — the choices live in the address, so Back goes one step back and a reload keeps them. The day list is `get_availability` from today up to `max_advance_days`, filtered by `bookingDays()` (`src/lib/bookingDays.ts`): closed days, closures and `too_far` never show; `full` shows dimmed; `no_slots` shows dimmed only after the minimum-notice window (before it the day simply has no time left: today after the last slot, or inside the notice). Times that are `past`/`too_soon` are hidden, `full` struck through. When `create_booking` answers one of the codes in `RELOAD_AVAILABILITY_CODES` (`past_slot`, `day_full`, `slot_full`, …), the flow shows that message above a freshly loaded day list; the car and note stay. A client without a confirmed email sees the explanation instead of the send button.

Enforcement: `create_booking` and `reschedule_booking` lock the shop row (`select … for update` on `shops`) before counting, so concurrent requests serialize. A `BEFORE INSERT OR UPDATE` trigger on `bookings` repeats the capacity check as a safety net.

A read function `get_availability(shop_id, from_date, days, slots_for, exclude_booking)` returns days with remaining places and, for the date `slots_for`, slots with their state — the UI never counts bookings itself. Shop members get their own grid without the client notice/advance rules (for rescheduling); with `exclude_booking` (one of their own bookings, T08) the place that booking holds now counts as free, as `reschedule_booking` counts it at submit — ignored for anyone else.

**Shop Panou and Programări (T08).** One read, `list_shop_bookings()`, gives the caller's shop every active booking with what the cards need: service names and icon, the client's account id (`C-00012`) and no-show count for the last 90 days (clients' profiles stay unreadable for shops), and from `quote_sent` on the current quote (the waiting or accepted version) with its lines; plus the shop's capacity and inspection fee and `quote_expiry_days`. It is loaded once for the whole shop interface (`ShopBookingsProvider`) and kept live through Realtime on `bookings` filtered by `shop_id`: a changed row is applied at once, then the list is read again quietly. Panou's counters, "Programul de azi" and the badge on the Programări tab (new requests) are computed from that list (`src/lib/shopBookings.ts`). Programări: tabs Cereri (`pending`) and Programate (confirmed until done); the address carries the tab, a Panou filter or one booking (`/s/programari?tab=programate&filtru=azi|7zile|constatare|deviz|lucru&p=<id>`). A booking that ends (declined, cancelled, no-show) leaves the list; the history screen is T10.

**Client Programări and the job flow (T09).** The client's bookings are read straight from the tables (RLS: own bookings, their quotes with lines, the own review, the shop's public columns incl. `phone` and `cancel_deadline_hours`) plus `platform_settings.limits.review_window_days`, once for the whole client interface (`ClientBookingsProvider`), kept live through Realtime on `bookings` filtered by `client_id` (the changed row is applied at once, then the list is read again quietly for the new quote). The card shows the quote version that matches the status (`currentQuote` in `src/lib/clientBookings.ts`: `sent` while waiting, `accepted`/`partially_accepted` from approval to done, `refused`, `expired`); partial approval sends the ticked line ids to `decide_quote` with the version seen. Cancelling mirrors `cancel_booking` (pending always, confirmed until `cancel_deadline_hours` before the slot, 0 = no deadline); the review form mirrors `submit_review`. The badge on the client's Programări tab counts `quote_sent` bookings. Shop side: "În lucru" calls `start_work`; "Finalizare" reads `last_odometer_for_booking`, checks the reading with `checkOdometer()` (`src/lib/validators.ts`, same order as `complete_job`) and sends `confirm_jump` only after the explicit tick.

---

## 5. Who appears in search

`is_shop_public(shop_id)` is true only when:
- owner's email is verified, and phone is verified (by SMS or by admin);
- subscription status is `trial`, `active` or `past_due`, and `shops.active` is true;
- `shops.suspended` is false;
- at least one enabled service is selected and at least one weekday is open.

Search, the shop page, and `create_booking` all use this function. A shop that is not public sees a banner explaining exactly which condition is missing ("Alege cel puțin un serviciu", "Confirmă numărul de telefon", "Abonamentul a expirat").

**Panou (T05)** reads `get_shop_setup()`: the four checklist steps (services · hours saved · capacity saved · owner phone verified), the reasons the shop is hidden — the same conditions as `is_shop_public`, in the order to fix them (`account_suspended, shop_suspended, shop_inactive, subscription_inactive, email_unverified, phone_unverified, no_services, no_open_days`) — and, for the owner, whether billing data is complete (legal name, CUI, Trade Register, registered office, billing email) and whether to show the billing reminder (trial from day 60, hidden for 7 days after "Mai târziu"). When all four steps are done it stamps `setup_completed_at`, and the checklist never returns. Like `mark_thread_read` it takes no `request_id` (repeating it is harmless). Until SMS verification (T13) the phone is confirmed by hand: `select public.verify_phone_manually('email');` in the SQL Editor (not callable through the API, audit-logged).

---

## 6. Abuse limits (values in `platform_settings.limits`)

| Limit | Default | Enforced in |
|---|---|---|
| Active bookings per client at one shop | 3 | `create_booking` |
| Active bookings per client in total | 10 | `create_booking` |
| New bookings per client per 24 h | 5 | `create_booking` |
| Messages per thread per hour | 30 | `send_message` |
| Messages allowed only if the pair has at least one booking | — | `send_message` |
| Review window after completion | 60 days | `submit_review` |
| Quote versions per booking | 20 | `send_quote` / `replace_quote` |
| Sign-ups | Supabase Auth rate limits + Cloudflare Turnstile CAPTCHA on sign-up | Auth |

No-shows: `client_no_show_count(client_id, 90 days)`. At 3 or more, shops see a discreet muted line "Client cu 3 neprezentări" on that client's bookings, and admin sees the flag. No automatic block.

---

## 7. Odometer

`complete_job` requires `odometer`. Last known reading = highest `odometer` among `done` bookings with the same `car_snapshot->>'plate_norm'` (any shop). Checked in this order:
1. missing → `odometer_required`
2. `< 100` or `> 2 000 000` → `odometer_invalid`
3. lower than the last known reading → `odometer_lower` (message names the previous value)
4. more than 50 000 km above the last reading and `confirm_jump` is false → `odometer_jump` (UI asks "Sunt {n} km în plus față de ultima lucrare. Confirmi?" and resubmits with `confirm_jump = true`)
5. first reading for the plate → any value in range

Shops get the last reading through `last_odometer_for_booking(booking_id)`, which returns only the number, and only for a booking of their own shop.

Shown on: completed booking cards (both sides), shop history (column + searchable), client vehicle history, the PDF report (own column + "Kilometraj la ultima lucrare"). If readings in a report are not increasing by date, the report carries the note "Citirile de kilometraj nu sunt în ordine crescătoare" — data is never re-sorted or corrected.

---

## 8. Ranking

`weighted_score = (rating_sum + prior_avg × prior_weight) / (review_count + prior_weight)` with `prior_avg = 4.3`, `prior_weight = 3` from settings. Order: score desc, then review count desc, then name asc. Filters narrow, never reorder. "Aproape de tine" is a separate section sorted by straight-line distance (Haversine), and "Cele mai apropiate" is an explicit sort option; distance never enters the score. The client's location stays in memory only — it is never written to the database.

**Search (T06).** `search_shops(q, category, city, lat, lng, sort)` matches **word by word**: the query is folded (no case, no diacritics) and split into at most 8 words by `search_words()`, each with an optional English plural "s" and then an optional last vowel ("brakes" → `brak`, "frane" → `fran`; same rule as `searchWords()` in `src/lib/text.ts`). A shop matches when every word is in its name or city, or — for the words that are not — all in **one** offered service (service or category name, RO or EN); that service is returned as `matched_service_*` ("Oferă: …"). So "schimb ulei", "oil change" and "frane brasov" work; "frane ulei" (two different services) does not. The city chips come from `search_cities()` (cities with public shops, one chip per city whatever the spelling, most shops first). The client computes distances itself (`src/lib/geo.ts`), so the position is never sent anywhere; the `lat`/`lng` parameters stay for other callers. "Aproape de tine" shows the 3 nearest shops within 25 km of the filtered results; it is hidden when the list is already sorted by distance. The shop page reads `get_shop_page(shop_id)`: public shop columns only (never `shop_billing`, preferences or internal stamps), `bookable` (= `is_shop_public`), rating, the week's hours, closures from today on, offered services with their category and icon, and the 50 newest visible reviews with replies — `shop_not_found` when the caller may not read the shop. The filters live in the address (`/c/cauta?q=&cat=&oras=&fav=1&sort=aproape`), so Back and reload keep them.

---

## 9. Notifications

Flow: RPC writes `notification_events` → `dispatch-notifications` Edge Function (triggered by a database webhook on insert, with a 1-minute cron sweep as backup) → renders the text in the **recipient's** `profiles.lang` → sends on each channel → writes `notifications_log`.

- **Push (Web Push, VAPID):** both roles, after permission. Permission flow exactly as Prompt 15b: in-app banner first, native prompt only on tap, never on load; status and control in Cont; iOS Home Screen note. 404/410 from the push service deletes that subscription.
- **Email (Resend):** auth emails through Supabase custom SMTP; app emails (invoice, trial ending, payment failed, suspension, staff invite, reported review to admin) through the Resend API.
- **SMS (SMSO):** new booking request to shops that enabled it; phone verification codes.
- **In-app:** banners and unread badges.

The event → recipient matrix is FR §7. Event codes: `booking_requested, booking_confirmed, booking_declined, booking_rescheduled, booking_cancelled_client, booking_cancelled_shop, booking_cancelled_admin, inspection_started, quote_sent, quote_replaced, quote_withdrawn, quote_accepted, quote_partially_accepted, quote_refused, quote_expiring, quote_expired, work_started, job_done, no_show, appointment_reminder, doc_expiry, new_message, new_review, review_reply, review_report_decided, daily_digest, trial_ending, payment_failed, shop_inactive, report_ready, broadcast`.

Templates live in `supabase/functions/_shared/templates.ts` (RO + US English), overridable from `platform_settings.notification_texts`.

---

## 10. Scheduled jobs (`pg_cron`, times in UTC, logic in Europe/Bucharest)

| Every | Job |
|---|---|
| 1 min | sweep unprocessed `notification_events` |
| 15 min | `expire_quotes()`; `quote_expiring` reminders 24 h before `expires_at` (once) |
| 1 h | appointment reminders for confirmed bookings starting in 23–24 h (once, `reminder_sent_at`); daily digest for shops whose opening hour is now |
| daily 07:00 Bucharest | document expiry reminders at 30 / 7 / 0 days (once per threshold, `cars.reminded`); trial warnings at 7 and 1 days; trials ended without payment → `inactive`; purge `request_log` older than 7 days |

---

## 11. Edge Functions

`dispatch-notifications` · `geocode` (T05: reads the caller's shop address from the database and asks Nominatim with an identifying User-Agent, 1 req/s — street + city + county + postal code, then without the postal code, then the city alone; stores the coordinates, clears them when the place is unknown, changes nothing when Nominatim is unreachable; the app calls it after "Salvează" only when the address changed. Google Geocoding can be added later behind a key) · `stripe-checkout` (subscription or report) · `stripe-portal` · `stripe-webhook` (signature verified, idempotent via `stripe_events`; the only writer of subscription status besides admin) · `issue-invoice` (SmartBill/Oblio + e-Factura after `invoice.paid`) · `generate-report` (PDF with `pdf-lib` + embedded TTF font that has Romanian diacritics ș ț ă â î; stored in `reports`) · `report-download` (signed URL after ownership check) · `delete-account` · `invite-staff` · `phone-verify-start` / `phone-verify-check` (SMSO OTP, hashed codes, 5 attempts, 10 min).

Shared code in `supabase/functions/_shared/`. Every function validates input, checks the caller's JWT, and never trusts ids from the body without checking ownership. Functions call the Auth and REST APIs with plain `fetch` (`_shared/admin.ts`), check the caller with the Auth server (`/auth/v1/user`) and run with `verify_jwt = false` in `supabase/config.toml`, so they work with both the legacy JWT keys and the new publishable/secret keys.

**Account data (T04).** "Descarcă datele mele" is the RPC `export_my_data()` (read-only JSON of the caller's own data; a shop member also gets the shop's settings, the owner also billing, subscription and invoices; never other people's data). "Șterge contul" is the Edge Function `delete-account`:
1. `prepare_account_deletion(user)` (SQL, service role only): refuses `account_has_active_bookings` / `shop_has_active_bookings` / `not_allowed` (admin); removes name and phone from booking snapshots and threads, empties `reviews.client_display_name` (the UI shows an empty name as a deleted account), deletes cars, favorites, push subscriptions, phone verifications, notice reads and pending notifications; answers `delete` or `anonymize`;
2. `delete` → the login is deleted (Auth admin API); the database cascades (bookings keep anonymous snapshots with `client_id` null, reviews and messages stay without an author);
3. `anonymize` → a shop owner whose shop has bookings or invoices (legal retention): the shop gets `active = false` and subscription `inactive`, staff rows are removed, the profile keeps no name or phone and gets `deleted_at`; the login is closed for good (banned 100 years, email replaced with `deleted-<id>@deleted.invalid`, random password).
Both steps are idempotent, so a retry after a half-failure finishes the job. Pending email changes are cancelled with `cancel_email_change()` (Supabase Auth has no API for it).

---

## 12. Payments

- **Subscription:** one Stripe product, monthly recurring price in RON. Checkout (hosted) to start, Customer Portal to change card / cancel / see invoices. Trial is tracked by us (`subscriptions.trial_ends_at`, 90 days from sign-up); the first charge happens when the shop subscribes. Webhook events: `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid`, `invoice.payment_failed`. Final failed retry or trial end without payment → `status = inactive`, `shops.active = false`. Payment → `active`, `shops.active = true` immediately.
- **History report:** one-off Checkout of `report_price_ron`. Only the webhook marks it paid and triggers `generate-report`.
- Card data never touches the app. VAT handling depends on the operator's VAT status (decision for Eduard + accountant; the rate is a setting, never hard-coded).

---

## 13. Paid history report

As Prompt 16e plus §7. Report code `SH-YYYY-NNNNNN` from a sequence. Public page `/verifica` calls `verify_report(code)` (security definer, granted to `anon`), which returns only: make, model, plate, job count, period, generation date, and whether it is void. Never shop names, amounts, work or personal data.

---

## 14. Validation (same rules in `src/lib/validators.ts` and in SQL)

- **CUI:** optional `RO` prefix, then 2–10 digits. Control digit: key `753217532` right-aligned against the digits before the control digit, `sum × 10 mod 11`, 10 → 0. Test vectors: valid `RO14872301`, `160796`, `5022670`, `14399840`; invalid `14872302`, `160797`.
- **Trade Register:** accept both formats — old `J08/1234/2015` (`^[JFC]\d{1,2}/\d{1,7}/\d{4}$`) and new since 2024 `J2024000123010` (`^[JFC]\d{13}$`: letter + year + 6-digit number + 2-digit county + check digit).
- **IBAN:** `RO` + 2 digits + 20 alphanumerics (24 total), mod-97 = 1. Valid test: `RO49AAAA1B31007593840000`.
- **Postal code:** exactly 6 digits.
- **Phone:** Romanian numbers normalized to `+40…`; display `0723 375 248`.
- **VIN:** 17 characters, `A–Z` and `0–9` without I, O, Q.
- **Plate:** stored as typed; `plate_norm` = upper-case without spaces/dashes, used for matching.
- Invalid values are refused with a specific translated message — never accepted silently.

---

## 15. Auth details

- Email + password. Email confirmation required (link valid 24 h; "Retrimite" at most once per 60 s).
- **Sign-up metadata:** `role`, `name`, `phone`, `lang`, `terms_version`, and for shops `shop_name`, `city`.
- **Remember me** (ticked by default): session kept in `localStorage`; unticked: `sessionStorage` (ends when the browser closes). Chosen per device via a custom storage adapter (`src/lib/remember.ts`); the choice is stored in `localStorage` key `sh_remember`, never on the profile. Sessions not used for 30 days on a device are signed out (`sh_last_seen`). Signing out ends the session on this device only (`scope: 'local'`).
- **Email links** use the implicit flow (tokens in the address), so a link opened in another browser or device still works. Links land on `/` (confirmation, email change) or `/parola-noua` (reset); an expired or used link lands on `/intra` with an explanation. Supabase Auth → URL Configuration must list the Netlify site and preview URLs.
- **Supabase answers an existing address on sign-up with a user without identities** (no error, to stop address probing); the app shows "Există deja un cont cu acest email".
- **Session ending by itself** (refresh refused, token revoked): the screen stays mounted under a sign-in panel (`ReauthPanel`); signing in again removes it and nothing typed is lost. An RPC answering `not_signed_in` triggers the same check.
- **CAPTCHA:** Cloudflare Turnstile, shown only when the public site key `VITE_TURNSTILE_SITE_KEY` is set. When CAPTCHA is on in Supabase Auth it guards sign-up, sign-in, password reset and resend, so every one of those forms (and the password check in Cont) carries the widget.
- Routes: `/intra` (sign in), `/cont-nou` (sign up), `/confirma-email`, `/parola-uitata`, `/parola-noua`, `/invitatie/:token` (staff invitation sign-up), `/legal/:doc` (public legal documents), `/<role>/cont/legal/:doc` (inside Cont). Shop settings live inside Cont: `/s/cont/setari` and its sections `profil`, `program`, `reguli`, `servicii`, `facturare` (owner), `personal` (owner), `notificari`.
- **Language before login:** `navigator.language` starting with `ro` → Romanian, anything else → English; stored in `localStorage` `sh_lang`. After login, `profiles.lang` wins; the switch updates both (the profile save is best effort: the interface switches even offline).
- **Password reset:** always the same neutral confirmation, whether the address exists or not.
- **Admin:** created only with the SQL function `promote_to_admin(email)`, which is owned by `postgres` and not granted to any API role. Eduard runs it in the SQL Editor after creating a normal account. There is no UI path to admin.
- Routing: signed-out → public routes (landing, auth, legal, `/verifica`); client → `/c/...`; shop → `/s/...`; admin → `/admin/...`. A guard redirects anyone hitting another role's route to their own home.

---

## 16. i18n

- `src/i18n/ro.ts` exports a flat object of keys → Romanian strings; `en.ts` is typed `Record<keyof typeof ro, string>`.
- `t(key, params?)` with `{name}` interpolation; a tiny plural helper for RO (1 / 2–19 / 20+ "de") and EN (1 / other).
- Formatters in `src/i18n/format.ts`: money, km, date, time, relative days — always `timeZone: 'Europe/Bucharest'`.
- Catalog names come from the database (`name_ro`, `name_en`).
- Legal documents: `docs/legal/*.md` (Romanian) rendered in-app; English versions to be added before launch (T19).

---

## 17. Design system and layout

**Tokens** (`src/styles/tokens.css`): `--bg #14161A`, `--surface #1D2026`, `--surface2 #242830`, `--border #2C313A`, `--border-lit #3A404B`, `--text #EAE8E2`, `--muted #8A909B`, `--amber #F5A524`, `--green #34C759`, `--red #FF453A`, `--blue #5AA9FF`, `--ink #151515` (text on amber).

**Type:** headings and big numbers — `"Arial Narrow", "Helvetica Neue", sans-serif`, bold, uppercase, `letter-spacing: .02em`; body — system stack; plates, times, phones, prices, km — monospace stack.

**Shape:** cards radius 12, buttons 10, inputs 9, pills fully rounded, card padding 14 (20 on desktop), page padding 18 (32 on desktop).

**Status pills:** pending amber · confirmed green · in_inspection amber · quote_sent amber · approved green · in_progress amber · done blue · declined red · cancelled muted · quote_refused muted · expired muted · no_show red. Always text + color.

**Shell:**
- **Mobile (< 768 px):** fixed header (logo tile + wordmark), scrolling content (max 560 px, centered), fixed bottom bar with 5 items. The page itself never scrolls; only the content area.
- **Tablet (768–1023 px):** same as mobile, content max 720 px; settings catalog may use 2 columns.
- **Desktop (≥ 1024 px):** fixed left sidebar 240 px (`--surface`, right border) with logo + wordmark on top, nav rows (icon + label; active: amber tint 12 %, amber text, 3 px amber left bar), **Cont pinned to the bottom** above a divider, with **Deconectare** under it. No bottom bar. Content max 900 px, centered, padding 32. Headings 32 px, body 15 px.
- **Lists stay single-column at every width** (search results, bookings, history, messages). Only these gain columns on desktop: booking days 3 → 6, booking times 3 → 6, settings catalog 1 → 2. Dashboard stat cards stay in rows, wider.
- Inline panels (reschedule, quote composer, completion, review form, report) stay inline on desktop — no modal dialogs.
- **Print** (shop daily schedule, repair history): hide navigation and buttons, dark text on white, keep table borders.

**Public pages** (landing, legal, `/verifica`) scroll normally, no app shell, same tokens.

---

## 18. Schema version check

- Migration files are created with `npx supabase migration new <name>` (`supabase/migrations/<timestamp>_<name>.sql`) and deployed by the **"Deploy Supabase"** GitHub Action on every push to a pull request and on every merge to `main` (`supabase db push`, then `supabase functions deploy`). Until T19 both go to the one project; from T19, pull requests go to the test project and `main` to the real one. The Action uses the GitHub secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. If the runner cannot reach the database directly (IPv6), it connects through the Supabase connection pooler.
- Table `schema_version(version int not null)` with one row. Every migration ends with `update public.schema_version set version = N;` where N is the next integer (1, 2, 3 …), independent of the file timestamp.
- Function `get_schema_version()` is callable by `anon` and `authenticated`.
- `src/lib/schema.ts` exports `EXPECTED_SCHEMA_VERSION`. On start, preview and development builds compare the two and show a red bar: "Baza de date nu e la zi (versiunea X, aștept Y). Verifică în GitHub → Actions dacă «Deploy Supabase» a rulat." Production reports the mismatch to Sentry instead.
- When the version cannot be read at all, the bar says why instead of "unknown": the build has no usable `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (missing, example values, or a URL with a path), or the database's answer (HTTP status, code, message). On Netlify (`NETLIFY=true`) the build itself fails with the same explanation when those two variables are missing or malformed (`vite.config.ts`, `src/lib/supabaseConfig.ts`), so a preview can never be published without a database.
- A migration is never edited after being pushed (it may already be applied); fixes go in a new migration. An abandoned pull request with migrations gets a reverting migration.

**Grants — nothing is reachable by default** (set in the first migration, T02):
- Default privileges are revoked: a new table, sequence or function in `public` is **not** readable, writable or callable by `anon`/`authenticated` (nor by `PUBLIC`) until its migration grants it. `service_role` keeps its defaults.
- Every new table: `enable row level security`, policies, then explicit grants. Browser writes are **always column-scoped** (`grant update (col, …)`), never whole-table.
- Every new RPC: `security definer`, `set search_path = ''`, then `grant execute … to authenticated` explicitly.
- `tests/sql/50_platform.sql` checks this structurally: every table has RLS, every security-definer function pins `search_path`, no whole-table insert/update grants, and the **exact list** of functions callable by `anon` and by `authenticated`. Adding an RPC means adding it to that list on purpose.
- Access helpers for policies: `is_admin()`, `my_shop_id()`, `is_shop_member(shop)`, `is_shop_owner(shop)`, `is_shop_public(shop)`, `can_read_shop(shop)`, `can_read_booking(booking)`, `can_read_thread(thread)`, `can_read_notice(audience, city)`.
- Validators and normalizers in SQL: `is_valid_cui`, `is_valid_regcom`, `is_valid_iban`, `is_valid_postal_code`, `is_valid_vin`, `normalize_code`; triggers store CUI/IBAN/Trade Register/VIN upper-case without spaces. Test vectors shared with `src/lib/validators.ts`: `tests/fixtures/validator-vectors.json`.
- Database types for the frontend: `src/data/database.types.ts`, regenerated with `npm run db:types` after every schema change (see the header of that file).

---

## 19. Overrides of `lovable-prompts.md`

The prompts were written to be sent to Lovable one after another, so early prompts contain things later ones replace. Build the final state directly:

| Prompt | Says | Build instead |
|---|---|---|
| 1 | inline style objects; content max 520 px | CSS variables + CSS Modules; responsive shell from day one (§17) |
| 2 | role `'service'` | role `'shop'` |
| 2 | `shops.open_hour/close_hour/closed_days`, `services text[]`, `plan`, fiscal columns on `shops` | `shop_hours`, `shop_services`, `subscriptions`, `shop_billing` |
| 2, 15 | partial status lists; `quotes.items jsonb` | full state machine (§3); `quote_items` table with per-line approval |
| 3 | capacity counts only pending + confirmed | counts all active statuses; enforced with row locking |
| 4 | catalog as a fixed frontend constant | catalog tables seeded from JSON, admin-managed (Prompt 21) |
| 5b | "max cars per hour, empty = only daily cap" | `cars_per_slot` (default 1): how many cars may start at the same time |
| 7b | `last_reminded_at` per date | `cars.reminded jsonb` per threshold |
| 8 | three tabs incl. "Închise"; "Finalizează" on confirmed; optional completion fields | two tabs (Cereri, Programate); history in Istoric (16b); full flow (15); odometer mandatory (15d) |
| 9 | automatic messages stored in the recipient's language | stored as event + params, rendered in the reader's language (§2 Messages) |
| 11 | search by name/city only | Prompt 16 search (name, city, service, category chips, city chips) |
| 14b | 3 accounts per IP per day | Supabase Auth rate limits + Turnstile CAPTCHA |
| 17 | desktop layout added at the end | responsive from the first screen |
| repair prompt | shop nav with Recenzii | Panou · Programări · Istoric · Mesaje · Cont (Prompt 16b) |
| all | British spellings ("catalogue", "licence", "tyres") in English copy | US English in every user-facing English string |
