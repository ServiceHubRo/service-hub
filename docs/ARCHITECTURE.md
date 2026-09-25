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
- **Invitations (T05, email T13):** the owner's browser makes a random 256-bit token; `invite_staff(email, token, request_id)` stores only its SHA-256 (at most 10 staff rows per shop; inviting the same address again replaces the token). The app then calls `invite-staff` (§11), which emails the link `/invitatie/<token>` to the invited address (once per link: `shop_staff.invite_emailed_hash`); the link is also shown to copy, for WhatsApp or when the email does not arrive. `get_staff_invite(token)` (callable signed out) shows shop name, city and the invited address; an invitation is valid 14 days. Sign-up with `invite_token` in the metadata makes the account a `shop` account **joined to that shop** (no shop of its own) — only when the token is valid and the address is the invited one; otherwise the sign-up is refused (`invite_invalid`). `list_shop_staff()` gives members the team with names; the owner removes staff with a plain delete (RLS: staff rows only, owner only). A removed member keeps a `shop` account with no shop and sees "Contul tău nu mai e legat de niciun service".
- Staff operate bookings, quotes, jobs, messages and the history; **only the owner** sees `shop_billing`, subscription, staff management, and can delete the shop. **Colleagues' rights (after T19b, migration `staff_rights`, `schema_version` 27):** the settings are the owner's too — `shops` updates, `shop_hours`, `shop_closures`, `shop_services` and the logo folder accept the owner alone (RLS), `save_shop_hours` / `set_shop_services` / `reply_review` / `report_review` go through `require_my_shop_owner()` (`not_allowed` for a colleague), `geocode` looks up the caller's shop as owner. A colleague reads the reviews, and Istoric shows them each job and its amount but no total and no CSV (the takings are the owner's). The app knows the role from the caller's `shop_staff` row (`ShopRoleProvider`, `useIsShopOwner()`); owner-only controls stay hidden until it is known. Settings for a colleague: only Notificări (push on their own phone); the other sections answer "Doar proprietarul…".

### Catalog

**service_categories** — `key text primary key` (`cat_rev`…), `name_ro`, `name_en`, `position`, `enabled`
**services** — `id text primary key` (`ulei`, `frane`…, **never changes**), `category_key`, `icon` (Lucide name), `name_ro`, `name_en`, `position`, `enabled`
- Seeded from `docs/service-catalog.json` by a generated migration. Disabled services stay valid on old bookings but cannot be selected.
- `reminder_months int null` (T19d, 1–120): after how many months a job of this service is due again (oil 12, brake fluid 24, timing belt 60…); null = no service reminder. Set by the admin in Catalog (`admin_set_service_reminder(id, months, request_id)`, audited as `update_service`).

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

**push_subscriptions** — `endpoint text primary key`, `user_id`, `subscription jsonb`, `user_agent`, `last_success_at`. Several per user (one per device, at most 10). Written only through `save_push_subscription(endpoint, subscription, user_agent)` (T12): the endpoint must be a real push service (FCM, Mozilla, Apple, Windows — `is_push_endpoint()`, so the server never posts to an arbitrary address), and a browser signed in with another account moves to the caller. The browser reads and deletes its own rows (turning push off on a device, signing out).
**push_config** (T12) — one row, service role only: the VAPID key pair (made by `dispatch-notifications` on its first call), the function's own address (`dispatch_url`), the `dispatch_token` the database sends it, and `extra_push_origins` (local tests only).
**notification_events** (outbox) — `user_id` (recipient; null only for platform events sent to `ADMIN_EMAIL`, i.e. `review_reported`), `event`, `params jsonb`, `booking_id`, `channels text[]`, `channels_done text[]` (T13: each channel is finished once; a retry repeats only the others), `created_at`, `processed_at`, `attempts`, `last_error`, `locked_until` (T12: held by the dispatcher, or waiting before a retry). Written by the RPC functions (and by the T13 triggers for reported reviews and suspensions) in the same transaction as the change.
**notifications_log** — `event_id`, `user_id`, `channel in ('push','email','sms')`, `status`, `error`, `sent_at`
**client_reminders** (T19d) — `(booking_id, kind in ('review','service'))` primary key, `sent_at`: the review request and the service reminder already sent for a finished job, so each goes once. RLS on, no grants (job functions only). `profiles.service_reminders boolean default true` — the client's switch in Cont (column grant to `authenticated`).
**notices** (admin broadcasts) — `audience in ('shops','clients','all','city')`, `city`, `title_ro`, `body_ro`, `title_en`, `body_en`, `send_push`, `created_by`; **notice_reads** — `(user_id, notice_id)`
- **T16b.** `audience` is who (`shops`, `clients`, `all`; the old `city` = everyone) and `city`, when set, narrows it: a shop member whose shop is in that city, a client who has booked with a shop there (clients have no address); spelling-proof (`fold_text`). `in_notice_audience(user, audience, city)` decides it for `can_read_notice` (RLS) and for sending; `recipients` / `push_recipients` are counted when sent. The app shows unread notices of the last 30 days at the top of Caută and Panou (`NoticeBanner`, live through Realtime on `notices`); "Am citit" inserts into `notice_reads`. A push notice is event `broadcast` (params: `notice_id` and the texts in both languages), rendered by `renderBroadcast` in the recipient's language, a tap opens Caută / Panou; only recipients with a device get the event.

### Money

**subscriptions** — `shop_id` primary key, `status in ('trial','active','past_due','cancelled','inactive')` (T16a: `ended_reason` may also be `admin`), `trial_ends_at`, `current_period_end`, `cancel_at_period_end`, `price_ron`, `stripe_customer_id` (unique), `stripe_subscription_id`. Written only by the Stripe webhook function or admin. T14: `stripe_status` (Stripe's own status of that subscription), `ended_reason in ('trial_ended','payment_failed','cancelled')`, `status_changed_at`, `payment_failed_at`, `next_payment_attempt`, `payment_failed_key` (the attempt already notified), `trial_reminded jsonb` (free-period warnings sent, per end date). `cancelled` = ended at the owner's request; `inactive` = free period over without a card, or the last payment try failed. **Paid colleagues (after T16b):** `seat_price_ron` (copied from `platform_settings.staff_seat_price_ron`, 20 lei, at sign-up), `seats` (staff with an account in the shop — `shop_staff` role staff, `user_id` and `accepted_at` set — kept by a trigger; invitations are free), `billed_seats` (what Stripe charges now). The monthly total is `subscription_monthly_ron()` = `price_ron + seats × seat_price_ron` (admin lists, MRR, the trial warning, the Abonament screen). **Pricing after T19b** (migration `first_colleague_included`, `schema_version` 26): `free_seats` (copied from `platform_settings.staff_free_seats`, 1) colleagues are included, so `seats` = paid colleagues = colleagues with an account (`shop_colleague_count`) − `free_seats`, never below 0 (`shop_seat_count`); Stripe's quantity, the monthly total, MRR and the trial warning follow `seats` as before. **Launch price:** `platform_settings.launch_price_ron` (99; 0 = none) for the first `launch_shops` (50) subscriptions: the `subscriptions_seat_price` before-insert trigger (settings row locked) sets `price_ron` to it and `launch_offer = true` while fewer than `launch_shops` subscriptions carry `launch_offer`; afterwards a new shop gets `subscription_price_ron` (149). The price per colleague became 19 lei for new shops (`staff_seat_price_ron`). `public_pricing()` answers `free_seats`, `launch_price_ron` (null once the places are gone — never how many signed up) and `launch_shops`. Prices are without VAT (landing page, Terms §4.5). The SQL tests run with the first prices (`05_fixtures.sql` sets 100 lei and 20 lei per colleague, no launch price; `85_pricing.sql` checks the migrated values and the launch places).
**invoices** — `shop_id`, `series`, `number`, `amount`, `vat_amount`, `currency`, `issued_at`, `pdf_url`, `provider`, `provider_ref`, `stripe_invoice_id`, `status in ('paid','issued','failed','void')`, `receipt_url` (Stripe's receipt page), `period_end`. One row per paid Stripe invoice (`status = 'paid'`, `provider = 'stripe'`, Stripe's number in `provider_ref`); the fiscal invoice (T14b) fills `series`, `number`, `pdf_url` and sets `issued`.
**history_reports** — as in Prompt 16e, plus `status in ('pending_payment','paid','generated','void')`, `stripe_session_id`, `void_reason`, `latest_odometer`, `odometer_out_of_order boolean`; T15: `vehicle_key`, `lang` (of the PDF), `price` (at checkout), `jobs jsonb` (the jobs printed, taken at payment), `request_id uuid unique`. `client_id` is `on delete set null`: a report outlives the account, so a buyer can still verify it (the PDF holds no personal data of the client).
**stripe_events** — `id text primary key` (Stripe event id), `type`, `payload jsonb`, `processed_at` — makes the webhook idempotent

### Platform

**platform_settings** — single row (`id = 1`): `subscription_price_ron 100`, `trial_days 90`, `quote_expiry_days 3`, `report_price_ron 29`, `ranking_prior_avg 4.3`, `ranking_prior_weight 3`, defaults for new shops (capacity, slot, notice, advance, cancel deadline), `limits jsonb` (§6), `notification_texts jsonb` (admin overrides of RO/EN texts). Readable by everyone signed in; writable by admin only. Changes never alter existing bookings, quotes or subscriptions.
**admin_audit_log** — `admin_id`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `created_at`. Every admin write inserts here, inside the same function.
**request_log** — `request_id uuid primary key`, `user_id`, `fn`, `result jsonb`, `created_at` (idempotency, purged after 7 days)
**phone_verifications** — `user_id`, `phone`, `code_hash` (SHA-256 of id + code), `expires_at`, `attempts`, `verified_at`. Server only (T13, §11).
**schema_version** — single row `version int` (§18)

### Storage

- `logos` bucket — public read; write only by that shop's members, path `shop_id/…`, images ≤ 2 MB.
- `reports` bucket — private; downloads through an Edge Function after checking ownership (T15: `report-download` answers the file itself instead of a signed link).

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

Every function: `security definer`, `set search_path = ''`, fully-qualified names, checks `auth.uid()` membership, locks the booking row (`for update`), validates the current status, records `request_id`, writes the thread message and the outbox event, returns the updated booking. Errors are raised with stable codes (`raise … using message = code, detail = JSON parameters`, e.g. `odometer_lower` + `{"previous":105400}`) (`past_slot`, `day_full`, `slot_full`, `limit_active_shop`, `not_allowed`, `wrong_status`, `odometer_lower`, `odometer_jump`, …) that the UI maps to translated messages (`src/data/rpc.ts`; its code list is checked against the migrations by a unit test). **A raw database error is never shown to a user.** `mark_thread_read`, `get_shop_setup` (which stamps `setup_completed_at`), `save_push_subscription` (an upsert of this device) and `touch_last_active` (T16a) are the writes without `request_id`: repeating them is harmless.

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

**Repair history (T10).** Shop: `list_shop_history()` gives the caller's shop every finished booking — `done`, `quote_refused`, `expired`, `cancelled`, `no_show` (declined requests never became jobs) — newest first by `ended_at` (`done_at`, else `cancelled_at`, else `status_changed_at`), with the service names and icon, the snapshots, odometer, work, cost, the client's note and phone, `has_client` (false after the client deleted the account) and the quote that belongs to how it ended (accepted/partially accepted, refused, expired) with its lines; one jsonb answer, so a long history is never cut at PostgREST's row limit. Istoric (`/s/istoric?q=&filtru=done|refused|cancelled|no_show&perioada=month|quarter|year`) filters that list in the browser (`src/lib/history.ts`): the search matches every word, without diacritics or case, in the plate (as typed and without spaces), make, model, year, client name, service (RO/EN), odometer and booking code; "Deviz refuzat" covers refused and expired quotes; periods are counted in Europe/Bucharest on the day the job ended; the totals line counts only `done` jobs and their `cost`. It is kept live through Realtime on `bookings` filtered by `shop_id` (quiet re-read). "Descarcă istoricul" writes the filtered list as CSV in the interface language (RO: `;` and decimal comma, EN: `,` and decimal point; UTF-8 with BOM; cells a spreadsheet would run as a formula get a leading apostrophe); printing shows a bordered table instead of the cards. Client: no new database function — the vehicle history reads the client's own bookings (`ClientBookingsProvider`) and garage. A booking belongs to a car by `vehicleKey()`: the plate without spaces or case, or make + model + year when there is no plate (so editing or deleting the car changes nothing). One screen, three ways in: `/c/garaj/:carId/istoric` (the garage card's "Istoric — n lucrări"), `/c/cont/istoric` ("Istoricul mașinilor mele": the garage cars, then "Alte mașini" — cars with finished jobs that are no longer in the garage) and `/c/programari/:bookingId/istoric` ("Vezi istoricul mașinii" on a finished booking, which also works for a car that is not in the garage). Only `done` jobs count as history.

**Shop reports (T17).** Rapoarte (`/s/cont/rapoarte?perioada=quarter|year|all`, default this month) is the owner's tile in Cont, next to Abonament; the owner is recognized the way Abonament does it (the subscription row is readable by the owner alone), so staff get no tile. One read, `shop_reports()`: `null` for staff (the takings are the owner's), `not_allowed` for anyone without a shop; for the owner the raw rows — the shop's `daily_capacity` and `since` (the day it joined, Bucharest), the open weekdays and closures, every `done` job and `quote_refused` booking (`ended_at` = `done_at`, else `status_changed_at`; `cost`; service names; the client's account id, null once deleted; the car snapshot), every decided quote (`accepted`, `partially_accepted`, `refused`, `expired` with `sent_at` and `decided_at` — replaced and withdrawn versions are not decisions) and the cars per day up to today (statuses `confirmed` … `done`, `quote_refused`, `expired`; never pending, declined, cancelled or no-show). Everything is summed in the browser (`src/lib/shopReports.ts`), so a period chip never reads again, and with Istoric's rules: a job counts on the day it was finished (Bucharest) for its `cost`; "Ultimele 3 luni" and "Anul acesta" start on the same day as in Istoric; "Luna aceasta" is the 1st to today. Compared with the same stretch before (the 1st–25th of last month, the three months before, last year to the same day; "Tot" has no comparison). Revenue by month is always the last 12 calendar months. Returning customers = the period's unique customers with more than one `done` job at this shop ever (a deleted account counts once per job). Acceptance = accepted (in full or in part) ÷ decided, on the day of the decision; refused counts refused and expired; the fees are the `cost` of `quote_refused` bookings; the time to decide leaves expired quotes out. Utilization = cars ÷ open days (the week and closures as set now, from `since`) ÷ `daily_capacity`. With fewer than 3 `done` jobs ever the screen shows a message instead. Live through Realtime on `bookings` filtered by `shop_id` (quiet re-read). The CSV holds the period's finished jobs and charged inspection fees, in the Istoric format. Charts are hand-drawn SVG at the card's measured width, with the figures also in a visually hidden table.

---

## 5. Who appears in search

`is_shop_public(shop_id)` is true only when:
- owner's email is verified, and phone is verified (by SMS or by admin);
- the subscription is in good standing — `subscription_ok(status, trial_ends_at, stripe_status)`: `active`, `past_due` (Stripe still retrying), or `trial` while `trial_ends_at` is in the future **or** a card was given in the free period (`stripe_status = 'trialing'`: Stripe charges at its end and the webhook says how it went) — and `shops.active` is true;
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

The event → recipient matrix is FR §7. Event codes: `booking_requested, booking_confirmed, booking_declined, booking_rescheduled, booking_cancelled_client, booking_cancelled_shop, booking_cancelled_admin, inspection_started, quote_sent, quote_replaced, quote_withdrawn, quote_accepted, quote_partially_accepted, quote_refused, quote_expiring, quote_expired, work_started, job_done, no_show, appointment_reminder, doc_expiry, new_message, new_review, review_reply, review_report_decided, daily_digest, trial_ending, payment_failed, shop_inactive, invoice_paid, report_ready, broadcast, review_request, service_due`.

Templates live in `supabase/functions/_shared/templates.ts` (RO + US English), overridable from `platform_settings.notification_texts`.

**Push delivery (T12).**
- **Waking the dispatcher:** an `after insert` statement trigger on `notification_events` calls `kick_dispatcher()` once per transaction: `net.http_post` (pg_net, sent after commit) to `push_config.dispatch_url` with the `x-dispatch-token` header. `dispatch_sweep()` does the same every minute when due events remain. Without pg_net, or before the function stored its address, both do nothing (plain Postgres in CI).
- **`dispatch-notifications`:** `GET` answers the VAPID public key (and on the very first call makes the key pair and records its address — no manual step; the "Deploy Supabase" Action calls it once after deploying). `POST` (token checked) loops for up to 20 s: `claim_notifications(50)` (locks due events for 2 minutes, closes events older than 12 h as `stale` and after 5 attempts; answers recipient language and role, service names, devices and text overrides) → renders each (`renderNotification`: title, body, the app path a tap opens, a tag so a newer notification replaces the older one of the same booking / conversation) → Web Push to every device (`_shared/webpush.ts`: VAPID ES256 JWT, RFC 8291 aes128gcm encryption, WebCrypto only; TTL 4–24 h by event, urgency high for requests, quotes, messages, job done) → `finish_notifications(results)`: log per channel, 404/410 devices deleted, working devices stamped `last_success_at`. A retry happens only when no device got it (never twice on a device), at 2, 4, 6 … minutes. SMS and email are logged `not_configured` until T13; an event with no text for the recipient's side is logged `no_template`.
- **Text keys** (`notification_texts` overrides use the same): `<side>.<event>` plus variants — `client.booking_declined_reason`, `shop.quote_refused_fee`, `client.appointment_reminder_today`, `client.doc_expiry_today` / `_past`. Placeholders: `{shop} {client} {sender} {preview} {car} {car_plate} {service} {ref} {when} {slot} {reason} {total} {total_sent} {cost} {fee} {deadline} {deadline_rel} {rating} {doc} {days} {expiry} {digest} {code}`. T15: `report_ready` (push + email to the client: the car, the code, a tap opens `/c/cont/rapoarte`). T19d: `client.review_request` (`{shop} {service}`; a tap opens `/c/programari?p=<booking>&recenzie=1`, the card with the review form open) and `client.service_due` (`{car} {service} {shop} {last_done} {due}`, dates with the year only when it is not this year; a tap opens `/c/service/<shop>/programare?pas=2&serviciu=<service>`, booking the same service at the same shop). Both push only, quiet (no sound or vibration forced).
- **Taps:** client → `/c/programari?p=<booking>` (the card is scrolled to and outlined), `/c/mesaje/<thread>`, `/c/garaj/<car>`; shop → `/s/programari?tab=cereri&p=` for requests, `/s/programari?p=` for active bookings, `/s/istoric?q=<ref>` for ended ones, `/s/mesaje/<thread>`, `/s/cont/recenzii`, `/s/panou` (digest). The service worker (`public/sw.js`, caches nothing) focuses an open window and posts the path to the app (`PushBridge` routes it without a reload), or opens a new window.
- **In the browser** (`src/data/push.ts`, `src/lib/push.ts`): states `unsupported`, `ios_install` (iPhone/iPad in a Safari tab — the app explains "Adaugă pe ecranul principal" instead of a button), `prompt`, `off` (allowed, not on for this device), `on`, `denied`. The banner (Caută, Panou) shows only for `prompt`/`ios_install`; the browser's prompt only after "Activează"; "Nu acum" hides it for the session and saves `push_prompt_dismissed_at` (it returns after 7 days); a refusal hides it for the session. Cont (both roles) and the shop's Notificări settings have the row: state, Activează / Dezactivează (this device only), and where to allow them when blocked. Every start of the signed-in app re-saves this device's subscription for whoever is signed in; signing out deletes this device's row first (best effort).

**Email and SMS delivery (T13).**
- **Per channel:** `dispatch-notifications` runs push, email and SMS of an event side by side; each finished channel goes into `channels_done` and its log row is written in that round; `done = false` (only for a push with no device reached, or an email/SMS answered 429/5xx/network) retries just the unfinished channels. A channel without its secret is logged `not_configured`; an email with no address `no_address`; an SMS without a verified phone `no_phone`.
- **Email (Resend API, `_shared/resend.ts`):** from `Service-Hub <notificari@service-hub.ro>` (`EMAIL_FROM` overrides), reply-to `ADMIN_EMAIL`, HTML + plain text (`_shared/emails.ts`, the Service-Hub look: dark card, amber button, the wordmark; Inter or the system font, sentence case), `Idempotency-Key: notification-<event id>` so Resend never sends one event twice. App emails now: `account_suspended` (trigger on `profiles.suspended` / `shops.suspended` false → true; to the person / the shop owner, in their language) and `review_reported` (trigger on `reviews.reported_at` set; to `ADMIN_EMAIL`, Romanian: shop, reason, stars, client, booking, dates, text). T14 adds, to the shop's owner (`notify_shop_owner`): `invoice_paid` (email only: amount, date, active until, Stripe's receipt), `trial_ending`, `payment_failed`, `shop_inactive` (push + email; texts in `_shared/templates.ts` and `_shared/emails.ts`, all leading to `/s/cont/abonament`).
- **SMS (SMSO API, `_shared/smso.ts`):** `POST https://app.smso.ro/api/v1/send` (form `to`, `sender`, `body`; header `X-Authorization`), sender `SMSO_SENDER` or the account's first sender. Numbers as `+40…`; texts without diacritics (GSM alphabet, 160 characters). `booking_requested` to the owner when `sms_on_new_booking` and the owner's phone is verified: "Service-Hub: cerere noua de la {client}, {when}: {service}. Raspunde in aplicatie. Oprire SMS: Setari > Notificari" (`_shared/sms.ts`; the service name, then the name, are shortened to fit).
- **Dark mode in the Gmail app on iPhone** (it inverts every color of an email except images and gradients): the page and card backgrounds are one-color `linear-gradient`s (plus `bgcolor`), the card border is a 1 px gradient cell, the wordmark is a PNG served by the `email-logo` function (`scripts/gen-email-logo.mjs` → `_shared/emailLogo.ts`; the address is `SUPABASE_URL` in the functions, the local stack in the committed Auth templates, replaced by the project's at install), and the text sits in two `div`s that only Gmail styles (`u + .body .gm-screen` / `.gm-diff`: black background, `mix-blend-mode` screen / difference), which turn the inverted text colors back. Elsewhere those classes do nothing. The amber button is still darkened there (dark text on amber cannot be restored); links and the quote bar turn neutral in Gmail only (`gm-link`, `gm-quote`).
- **Auth emails** (confirmation, "Retrimite", password reset, email change) go through Supabase Auth's SMTP, set to Resend in the dashboard (`smtp.resend.com`, port 465, user `resend`, the Resend key as password). Their templates are Go templates holding both languages, chosen by `.Data.lang`: the sign-up metadata, kept equal to `profiles.lang` by the `profiles_sync_lang` trigger. Source `_shared/authEmails.ts` → `node scripts/build-auth-templates.mjs` → `supabase/templates/` (used by the local stack through `config.toml`); the "Deploy Supabase" Action installs them on the project with the Management API (`scripts/auth-email-config.mjs`, also `mailer_otp_exp` = 24 h). A unit test fails when the files are out of date.
- **Links** in emails and SMS use `APP_URL` (default `https://service-hubapp.netlify.app` until T19) or, for the staff invitation, the site the owner is using when it is one of ours (service-hub.ro, the Netlify site and its deploy previews, localhost) — never an address from the request otherwise (`_shared/app.ts`).
- **Local tests:** `config.toml` `[edge_runtime.secrets]` points Resend and SMSO at stand-ins the browser tests run (`tests/e2e/providers.ts`, port 54398); the real project's secrets live only in Supabase.

---

## 10. Scheduled jobs (`pg_cron`, times in UTC, logic in Europe/Bucharest)

| Every | Job |
|---|---|
| 1 min | sweep unprocessed `notification_events` |
| 15 min | `expire_quotes()`; `quote_expiring` reminders 24 h before `expires_at` (once) |
| 1 h | appointment reminders for confirmed bookings starting in 23–24 h (once, `reminder_sent_at`); daily digest for shops whose opening hour is now |
| daily 10:00 Bucharest | review requests the day after a job (T19d); service reminders ~14 days before due (T19d) |
| daily 07:00 Bucharest | document expiry reminders at 30 / 7 / 0 days (once per threshold, `cars.reminded`); trial warnings at 7 and 1 days; trials ended without payment → `inactive`; purge `request_log` older than 7 days |

**T12 implementation.** Three pg_cron jobs, created by `schedule_notification_jobs()` (in the migration; it can be run again from the SQL Editor after pg_cron is turned on by hand): `sh_dispatch_sweep` (`* * * * *`, `dispatch_sweep()`), `sh_quote_jobs` (`*/15 * * * *`, `run_quote_jobs()` = `expire_quotes()` + `remind_expiring_quotes()`), `sh_hourly_jobs` (`2 * * * *`, `run_hourly_jobs()` = appointment reminders + daily digests, and when it is 07:xx in Bucharest the document reminders and the `request_log` purge). Every job function takes the time as a parameter (default `now()`), is `security definer`, and is not callable from the API. Rules:
- `remind_expiring_quotes`: quotes `sent` with 0–24 h left, once per quote version (`quotes.expiry_reminded_at`), to the client and every shop member (`quote_expiring`).
- `send_appointment_reminders`: `confirmed` bookings starting in 22–24 h, once (`reminder_sent_at`, cleared by a reschedule); `params.day` = `today`/`tomorrow` in Bucharest at sending time (a 23:00 slot reminded at 00:30 is "today").
- `send_doc_expiry_reminders`: ITP / RCA / vignette with 30, 7 or 0 days left (or up to 30 days past): one reminder for the smallest threshold reached, recording it and every larger one in `cars.reminded` (`{"itp":{"2026-11-02":[30,7]}}`), so a document entered 5 days before expiry gets one reminder, not two; a new expiry date starts over.
- `send_daily_digests`: shops with `daily_digest`, active, open today (hours and closures), in the first 2 hours after opening, once a day, only when there is something to say (today's bookings from confirmed on, the first time, pending requests), to every member.
- **T19d**, at 10:xx in Bucharest: `send_review_requests`: jobs finished (`done`) on one of the last 3 Bucharest days before today, still inside `review_window_days`, with no review → `review_request` to the client, once per booking (`client_reminders`). `send_service_reminders`: for each (client, car in their Garage, service with `reminder_months`) the newest `done` job of that car (`bookings.car_id`; a booking without a saved car gets no reminder); due = its Bucharest day + `reminder_months`; sent from 14 days before due until 30 days after, once per job (`client_reminders`), not when the client turned reminders off, the account is deleted, or an active booking for that car and service exists → `service_due`. A newer job of the same service starts over. In the app: Caută shows a card for the newest job still waiting for a review (`reviewToAsk`, from the client's bookings already loaded; "Nu acum" hides it for the session, `sh_review_prompt_hidden`); Cont has the "Remindere de revizie" row (`profiles.service_reminders`).
- **T14:** `end_expired_trials` every hour (free periods over with no card given → `inactive`, `trial_ended`, event `shop_inactive`); `send_trial_warnings` at 07:00: `trial_ending` 7 days and 1 day before the end (Bucharest calendar days), once per threshold and end date (`trial_reminded`), the smallest threshold reached only, not when a card is given.

---

## 11. Edge Functions

`email-logo` (the wordmark PNG in emails, public, cached a week) · `dispatch-notifications` (T12, §9: `GET` → VAPID public key, first call sets itself up; `POST` with the database's token → sends the outbox) · `geocode` (T05: reads the caller's shop address from the database and asks Nominatim with an identifying User-Agent, 1 req/s — street + city + county + postal code, then without the postal code, then the city alone; stores the coordinates, clears them when the place is unknown, changes nothing when Nominatim is unreachable; the app calls it after "Salvează" only when the address changed. Google Geocoding can be added later behind a key) · `stripe-checkout` (T14: the owner's subscription — `subscription_checkout_info` answers only for the owner; refuses `subscription_exists`, `billing_incomplete`, `nothing_to_pay`, `payments_unavailable`; makes the Stripe customer once (`set_stripe_customer`); the shop's own `price_ron` — `STRIPE_PRICE_ID` when the amounts match, else the same product at the shop's amount; inside the free period with ≥ 2 days left `subscription_data.trial_end` = our `trial_ends_at`, so only the card is saved; the tap's request id is the idempotency key; answers `{ url }`. The history report has its own checkout, `report-checkout`, below) · `stripe-portal` (T14: Stripe's customer portal for the owner's customer: card, receipts, cancel at period end) · `stripe-webhook` (signature verified with `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance; idempotent via `stripe_events` (`stripe_event_begin` / `stripe_event_done`); the only writer of subscription status besides admin — see §12; any API version on the endpoint works: only the event's type and object id are read, the session, subscription or invoice is read back from the API in `STRIPE_API_VERSION`) · `issue-invoice` (SmartBill/Oblio + e-Factura after `invoice.paid`) · `report-checkout` (T15: `begin_history_report(user, car | booking, lang, request_id)` — clients only, their own car, refuses `no_jobs` — then a one-off Checkout, card, RON, `report_price_ron`, metadata `kind = history_report` + `report_id`; the request id is the idempotency key; back to `/c/cont/rapoarte?plata=ok&raport=<id>` or the preview with `?plata=anulata`) · `generate-report` (T15: makes the PDF of a `paid` report again, for its owner — the "Pregătește raportul acum" button; the webhook makes it first, both through `_shared/reportGenerate.ts`: `pdf-lib` + fontkit from npm, Noto Sans / Noto Sans Mono cut to Latin + ș ț and embedded as base64 (`_shared/reportFonts.ts`, OFL), drawing in `_shared/reportPdf.ts` (no Deno, unit-tested); stored at `reports/<client>/<report>/<code>.pdf`; `finish_history_report` → `generated` + `report_ready`) · `report-download` (T15: `history_report_for(user, report)` checks the owner (admin: any; a void report is refused to the client), then the function reads the file with the service role and answers the PDF itself — no link that could be passed on) · `delete-account` · `admin-delete-account` (T16a, §15) · `invite-staff` (T13: emails a staff invitation after `invite_staff`; checks the caller owns the invitation found by the token's hash, once per link, `{ sent }` or `{ sent: false, reason }`) · `phone-verify-start` (T13: a random 6-digit code; `phone_verify_begin(user, code)` — shops only, one code a minute, 5 a day per account and per number, only the hash stored, 10 minutes — then SMSO; a failed SMS is forgotten with `phone_verify_cancel`). The check is the RPC `check_phone_code(code, request_id)` instead of a second function: `verified` / `wrong` (+ tries left) / `locked` (5 wrong) / `expired`, a wrong try is an answer so it stays counted; `my_phone_verification()` lets the app show a waiting code after a reload. A verified phone sets `profiles.phone_verified_at` (step 4 of the Panou checklist); a new number clears it (T02 trigger). `verify_phone_manually(email)` stays for Eduard.

Shared code in `supabase/functions/_shared/`. Every function validates input, checks the caller's JWT, and never trusts ids from the body without checking ownership. Functions call the Auth and REST APIs with plain `fetch` (`_shared/admin.ts`), check the caller with the Auth server (`/auth/v1/user`) and run with `verify_jwt = false` in `supabase/config.toml`, so they work with both the legacy JWT keys and the new publishable/secret keys.

**Account data (T04).** "Descarcă datele mele" is the RPC `export_my_data()` (read-only JSON of the caller's own data; a shop member also gets the shop's settings, the owner also billing, subscription and invoices; never other people's data). "Șterge contul" is the Edge Function `delete-account`:
1. `prepare_account_deletion(user)` (SQL, service role only): refuses `account_has_active_bookings` / `shop_has_active_bookings` / `not_allowed` (admin); removes name and phone from booking snapshots and threads, empties `reviews.client_display_name` (the UI shows an empty name as a deleted account), deletes cars, favorites, push subscriptions, phone verifications, notice reads and pending notifications; answers `delete` or `anonymize`;
2. `delete` → the login is deleted (Auth admin API); the database cascades (bookings keep anonymous snapshots with `client_id` null, reviews and messages stay without an author);
3. `anonymize` → a shop owner whose shop has bookings or invoices (legal retention): the shop gets `active = false` and subscription `inactive`, staff rows are removed, the profile keeps no name or phone and gets `deleted_at`; the login is closed for good (banned 100 years, email replaced with `deleted-<id>@deleted.invalid`, random password).
Both steps are idempotent, so a retry after a half-failure finishes the job. Pending email changes are cancelled with `cancel_email_change()` (Supabase Auth has no API for it).

---

## 12. Payments

- **Subscription:** one Stripe product, monthly recurring price in RON. Checkout (hosted) to start, Customer Portal to change card / cancel / see invoices. Trial is tracked by us (`subscriptions.trial_ends_at`, 90 days from sign-up); a card given during the trial is only saved and the first charge is at the end of the trial (Stripe `trialing`); after the trial the first charge is at checkout. Webhook events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`. Final failed retry or trial end without payment → `status = inactive`, `shops.active = false`. Payment → `active`, `shops.active = true` immediately.
- **Colleagues (after T16b):** a second item on the subscription, "Cont angajat" (`STRIPE_SEAT_PRICE_ID`, 20 lei a month; a shop's own `seat_price_ron` when it differs, as `price_data` on the same product), quantity = `seats` (the paid colleagues, beyond `free_seats`). Checkout starts with the current seats. When `seats` change and Stripe runs the subscription, a trigger writes one `seats_changed` outbox event with the `stripe` channel; `dispatch-notifications` sets the item's quantity (`_shared/seats.ts`: add the item for the first colleague, change the quantity, remove it at zero; `proration_behavior = create_prorations`, so both ways are prorated by day) and records `billed_seats`. The webhook re-checks the seats when a subscription starts (`checkout.session.completed`, `customer.subscription.created`), for a colleague who joined while Checkout was open.
- **Webhook → database (T14).** Every Stripe call pins `Stripe-Version` (`_shared/stripe.ts`, plain fetch + WebCrypto, no npm package). For each event the function reads the subscription **as Stripe has it now** (`GET /v1/subscriptions/:id`) and calls `sync_stripe_subscription(customer, shop hint, state)`, so out-of-order events change nothing; paid / failed invoices are recorded first (`record_stripe_invoice`, `record_payment_failed`). Mapping: `trialing → trial`, `active → active` (`cancel_at_period_end` kept: "stops on …"), `past_due → past_due`, `canceled / unpaid / incomplete_expired / paused → cancelled` when the owner cancelled (`cancellation_details.reason = cancellation_requested` or cancel at period end), else `inactive` (`payment_failed`); an end inside our free period gives the free period back; `incomplete` changes nothing; the end of an older subscription never touches a newer live one. `set_subscription_status()` keeps `shops.active` in step (never back to true for a deleted owner) and sends `shop_inactive` when good standing is lost. Failed payments are notified once per attempt (`payment_failed_key`). The shop is found by `stripe_customer_id` (the checkout's `client_reference_id` only for a shop without a customer yet).
- **Browser (T14).** `/s/cont/abonament` (`SubscriptionScreen`) reads `subscriptions`, `invoices` and `shop_billing` straight from the tables (RLS: owner and admin; staff get nothing and see "Doar proprietarul…") and follows `subscriptions` / `invoices` through Realtime. `subscriptionView()` (`src/lib/subscription.ts`) mirrors `subscription_ok()`: `trial`, `trial_card`, `active`, `ending`, `past_due`, `inactive`, `cancelled`. Stripe returns to `?plata=ok` / `?plata=anulata`. Panou (`get_shop_setup().subscription`, owner only) warns in the last 7 days of the trial without a card and while past due. `delete-account` cancels a live Stripe subscription before deleting (fails with `subscription_cancel_failed` when Stripe cannot be reached, nothing deleted).
- **Local tests:** `config.toml` points the Stripe functions at a stand-in (`tests/e2e/providers.ts`: customers, prices, Checkout and portal test pages, signed webhooks to the local `stripe-webhook`).
- **History report (T15):** one-off Checkout of `report_price_ron` (`report-checkout`, no Stripe product needed: `price_data` at the platform price). Only the webhook marks it paid: `checkout.session.completed` (or `async_payment_succeeded`) with `mode = payment`, `metadata.kind = history_report`, `payment_status = paid` → `mark_history_report_paid(report, session, amount)` (jobs taken again at that moment; idempotent) → the PDF at once (`_shared/reportGenerate.ts`). A PDF that fails answers 500, so Stripe delivers the event again; the client can also retry (`generate-report`). The fiscal document for these payments belongs to T14b.
- **Right of withdrawal (T19b):** the report preview has an unticked checkbox — the report is made at once and the client loses the 14-day right of withdrawal (OUG 34/2014 art. 16 m; Terms §3.6); "Plătește" without it shows the message under the box and sends nothing, and `report-checkout` answers `waiver_required` (400) unless the body has `withdrawal_waiver: true`; the Checkout session and payment carry `metadata.withdrawal_waiver = accepted` as proof.
- Card data never touches the app. VAT handling depends on the operator's VAT status (decision for Eduard + accountant; the rate is a setting, never hard-coded).

---

## 13. Paid history report

As Prompt 16e plus §7. Report code `SH-YYYY-NNNNNN` from a sequence. Public page `/verifica` calls `verify_report(code)` (security definer, granted to `anon`), which returns only: make, model, plate, job count, period, generation date, and whether it is void. Never shop names, amounts, work or personal data.

**T15.**
- **Which jobs:** the client's own `done` bookings on one car, matched by `vehicle_key(car_snapshot)` — the plate upper-case without spaces or dashes, or make + model + year for a car without a plate; the SQL mirror of `vehicleKey()` in `src/lib/history.ts` (same vectors in `tests/sql/79_history_report.sql` and `tests/unit/report.test.ts`). Another owner's jobs on the same plate never appear. `report_jobs()` answers them newest first with the day finished (Bucharest), shop name and city, the service (RO/EN), the accepted quote lines, the work, the odometer and the amount; `report_facts()` adds count, total, period, the odometer at the newest job and whether the readings go down read oldest to newest (the note; nothing is re-sorted).
- **Browser:** `history_report_preview(car | booking)` (clients, own cars) → the preview at `/c/garaj/:carId/raport` or `/c/programari/:bookingId/raport` (a car no longer in the garage): facts, the jobs with the last two blurred (`hiddenFrom()`: never the only one), the report's language (RO/EN chips, default the interface), "Plătește 29 lei". Three ways in: the vehicle history ("Generează raport oficial — 29 lei"), the garage card ("Raport oficial pentru cumpărător", only with finished jobs), Cont → "Rapoartele mele" (`/c/cont/rapoarte`: reports bought, live through Realtime on `history_reports`, "Descarcă PDF", and "Raport nou" for each car with finished jobs). `/verifica` (also `?cod=`) is public, outside the shell, and accepts a code typed in any case, with spaces or without dashes.
- **The PDF:** A4, white, the look of `docs/reference-report.pdf`. **Every page** has the running header (mark + wordmark, title, generated date and time in Bucharest, the site; from page 2 also the car, plate, VIN and the code, "continuare") and the running footer (what the report covers — only work through Service-Hub, not the full history —, "Verifică la `<APP_URL host>/verifica` cu codul …", "Pagina n din m"). Page 1 then has the car (plate, year, VIN) and the code box; the jobs table (date, shop + city, service + accepted lines + work, **km**, cost) flows over as many pages as needed, a row is never split and the table header repeats; the closing block (total, jobs / period / "KM la ultima lucrare", the odometer note, the full notice) always travels with the last job, so it never sits alone on a page. Up to about five jobs fit on one page. In the language chosen at checkout; text the fonts cannot print (emoji, other scripts) is left out.
- **Void:** an admin sets `status = void` (screen in T16b); `/verifica` then says "Raport anulat", the client can no longer download it.

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
- **Admin interface (T16a).** Routes `/admin/prezentare`, `/admin/service-uri[/:shop]`, `/admin/clienti[/:client]`, `/admin/rezervari[/:booking]` (filters in the address: `?q=&stare=&de_la=&pana_la=&service=&client=`), `/admin/moderare`, `/admin/mesaje/:thread` (read-only), `/admin/cont/jurnal` (audit log, a tile in the admin's Cont). **Reads:** one admin-only function per screen, each answering one jsonb (`require_admin()` → `not_allowed` for anyone else): `admin_overview` (shops by `shop_state()` — `active / trial / inactive / suspended / deleted` —, clients, new bookings today / 7 / 30 days by status, reports waiting, subscriptions, MRR = `price_ron` of active + past-due, the last 50 events: new shop, new client, new booking, reported review, failed payment), `admin_list_shops`, `admin_get_shop` (everything incl. billing, hours, staff, invoices, `shop_hidden_reasons()`, audit), `admin_list_clients`, `admin_get_client`, `admin_list_bookings(statuses[], shop, client, from, to, q, limit ≤ 500)` (filtered in the database, with the total), `admin_get_booking` (quotes with lines, review, the pair's conversation, audit), `admin_get_thread`, `admin_list_reviews(q)` (the pending queue oldest first, then the newest 200), `admin_list_audit(before, limit)`. Emails come from `auth.users` (`account_email()`), "last active" is `profiles.last_active_at` (stamped by the app at every start through `touch_last_active()`, at most once an hour, no request id) or the last sign-in. **Actions** (request id, row lock, notifications and an `admin_audit_log` row with before/after, one transaction; `admin_audit()` stamps `clock_timestamp()`): `admin_verify_phone`, `admin_set_shop_suspended` / `admin_set_account_suspended` (reason required to suspend, kept only in the log; the T13 triggers email the person), `admin_update_shop(shop, p_shop jsonb, p_billing jsonb)` (listed fields only; a refused value answers `field_invalid` with `{field}`; the log keeps only what changed; `address_changed` → the app calls `geocode` with `{ shop_id }`, admin only), `admin_extend_trial(days 1–365)` (from the later of today and the old end, back to `trial`; refused `subscription_in_stripe` while Stripe runs a subscription), `admin_set_subscription_status(active | past_due | cancelled | inactive)` (through `set_subscription_status`, `ended_reason = 'admin'`, the owner gets `shop_inactive` with `reason = admin`; Stripe's next event about a live subscription applies again), `admin_decide_review(keep | remove, note)` (pending reports only; remove sets `removed_at`, so `shop_ratings` drops it; event `review_report_decided` to the shop's members, and to the client only when removed; the note is internal), `admin_force_cancel` (T03). **Deleting** a client or a shop (= its owner's account) is the Edge Function `admin-delete-account` (`{ user_id }`): `admin_account_deletion(admin, user)` (service role; checks the caller is an admin, the same rules as `prepare_account_deletion`, audit row), then `_shared/accountDeletion.ts` (shared with `delete-account`) stops Stripe and deletes or closes the login; an account already gone answers ok. **Live:** every screen re-reads quietly on Realtime changes (`useLiveData`; `shops` and `profiles` joined the publication in T16a); `AdminProvider` counts pending reports for the badge on Moderare. The age of a report is shown in days, and in red once 5 working days have passed (`reportAge()` in `src/lib/admin.ts`).
- **Platform tools (T16b).** Tiles in the admin's Cont: `/admin/cont/abonamente` (`admin_list_subscriptions`: every subscription with `next_billing` = end of the free period, renewal or Stripe's next retry, and the newest 1000 payments; `admin_set_subscription_price(shop, price, request)` — 1–10 000 lei, refused `subscription_in_stripe` while Stripe runs one), `/admin/cont/rapoarte` (`admin_list_history_reports`, `admin_void_history_report(report, reason, request)` — paid or generated only, reason required), `/admin/cont/catalog` (`admin_list_catalog` with how many shops offer and bookings use each service; `admin_create_category` / `admin_update_category` (off → its services off) / `admin_create_service` / `admin_update_service` (on only in a category that is on; another category → its end) / `admin_move_catalog_item(kind, id, ±1)` (positions renumbered first); ids never change; icons from `src/lib/serviceIcons.ts`), `/admin/cont/setari` (read straight from `platform_settings`; `admin_update_settings(jsonb, request)` — listed keys only, limits merged key by key with their ranges, `field_invalid {field}`; the log keeps only what changed) and `/setari/texte` (`admin_set_notification_text(key, title/body RO/EN, request)` — `client.*`/`shop.*` keys of `_shared/templates.ts`, which the screen imports for the built-in texts; empty = built-in), `/admin/cont/anunturi` (`admin_notice_preview`, `admin_send_notice` — English empty = Romanian, `no_recipients` when nobody matches —, `admin_list_notices` with reads, `admin_withdraw_notice` — also closes its pushes not sent yet), `/admin/cont/export` and a "Descarcă CSV" on the lists (`admin_export(kind, filters)`: shops, clients, subscriptions whole — the screen applies its filters —, bookings with the Rezervări filters and no limit, reviews with the text; every export is an audit row). CSV in the interface language (`src/lib/adminTools.ts`, same format as the T10 history). Catalog and settings rows are audited with their text key (`admin_audit_key`).
- Routing: signed-out → public routes (landing, auth, legal, `/verifica`); client → `/c/...`; shop → `/s/...`; admin → `/admin/...`. A guard redirects anyone hitting another role's route to their own home.

---

## 16. i18n

- `src/i18n/ro.ts` exports a flat object of keys → Romanian strings; `en.ts` is typed `Record<keyof typeof ro, string>`.
- `t(key, params?)` with `{name}` interpolation; a tiny plural helper for RO (1 / 2–19 / 20+ "de") and EN (1 / other).
- Formatters in `src/i18n/format.ts`: money, km, date, time, relative days — always `timeZone: 'Europe/Bucharest'`.
- Catalog names come from the database (`name_ro`, `name_en`).
- Legal documents (T19b): `docs/legal/*.md` (Romanian, the version that applies) and `docs/legal/en/*.md` (US English translation), shown in the interface language by `LegalDocument` (`loadLegalDoc(id, lang)`, one lazy chunk per file) through the small reader in `src/lib/markdown.ts` (headings, lists, tables, quotes, bold/italic, `code`, web/mail links). The operator's data is written `{{company}} {{address}} {{regcom}} {{cui}} {{email}} {{phone}}`: the first four come from `docs/legal/company.json`, email and phone from `src/lib/contact.ts`; an empty value shows an amber "[de completat: …]" mark. `tests/unit/legal.test.ts` checks that only known fields are used, that no old draft placeholder is left, and that each English document has the same outline (headings, tables and their rows, lists) as the Romanian one. `TERMS_VERSION` (`src/lib/legal.ts`) changes whenever the texts change in substance.

---

## 17. Design system and layout

**Tokens** (`src/styles/tokens.css`): `--bg #14161A`, `--surface #1D2026`, `--surface2 #242830`, `--border #2C313A`, `--border-lit #3A404B`, `--text #EAE8E2`, `--muted #8A909B`, `--amber #F5A524`, `--green #34C759`, `--red #FF453A`, `--blue #5AA9FF`, `--ink #151515` (text on amber).

**Type:** one typeface, **Inter** (variable, bundled with the app: `@fontsource-variable/inter`, the browser loads only the Latin + Latin Extended files, ~130 KB once), system stack as fallback. Headings bold 700 with slightly tight letter-spacing; buttons bold; labels semibold. **Sentence case everywhere** — no forced capitals, except the wordmark (Inter 800, uppercase). Plates, times, phones, prices, km use the same font with even-width digits (`.mono` / `--font-mono` = Inter + `tabular-nums`). The tokens `--font-display` and `--font-mono` remain as names for the roles and point to the same font. (Changed after T19d at Eduard's request; overrides the reference demo's Arial Narrow uppercase.)

**Shape:** cards radius 12, buttons 10, inputs 9, pills fully rounded, card padding 14 (20 on desktop), page padding 18 (32 on desktop).

**Status pills:** pending amber · confirmed green · in_inspection amber · quote_sent amber · approved green · in_progress amber · done blue · declined red · cancelled muted · quote_refused muted · expired muted · no_show red. Always text + color.

**Shell:**
- **Mobile (< 768 px):** fixed header (logo tile + wordmark), scrolling content (max 560 px, centered), fixed bottom bar with 5 items. The page itself never scrolls; only the content area.
- **Tablet (768–1023 px):** same as mobile, content max 720 px; settings catalog may use 2 columns.
- **Desktop (≥ 1024 px):** fixed left sidebar 240 px (`--surface`, right border) with logo + wordmark on top, nav rows (icon + label; active: amber tint 12 %, amber text, 3 px amber left bar), **Cont pinned to the bottom** above a divider, with **Deconectare** under it. No bottom bar. Content max 900 px, centered, padding 32. Headings 32 px, body 15 px.
- **Lists stay single-column at every width** (search results, bookings, history, messages). Only these gain columns on desktop: booking days 3 → 6, booking times 3 → 6, settings catalog 1 → 2. Dashboard stat cards stay in rows, wider.
- Inline panels (reschedule, quote composer, completion, review form, report) stay inline on desktop — no modal dialogs.
- **Print** (shop daily schedule, repair history): hide navigation and buttons, dark text on white, keep table borders.

**Public pages** (landing, legal, `/verifica`, 404) scroll normally, no app shell, same tokens. The landing page (T18) reads the shop prices through `public_pricing()` (callable signed out: subscription price, price per colleague, trial days from `platform_settings`, nothing else), so it never shows an old price. Unknown addresses show a 404 page (inside the shell for a signed-in role).

**Code splitting (T18):** `src/app/App.tsx` keeps the public and sign-in screens in the start file; each role's screens are one file loaded after sign-in (`src/app/routes/ClientApp.tsx`, `ShopApp.tsx`, `AdminApp.tsx`, routes relative to `/c`, `/s`, `/admin`). A file that fails to load after a new deploy reloads the page once (`lazyChunk`), then shows "Reîncarcă pagina".

**Accessibility checks (T18):** `tests/e2e/a11y.spec.ts` and `public.spec.ts` run axe-core (WCAG 2.1 AA) on every screen of every role in RO and EN, plus a 44 px tap-target check (links inside a sentence excepted). Muted text on a tinted background uses `--muted-strong`. The shell starts with a "Sari la conținut" link; every page sets the tab title ("Programări · Service-Hub").

---

## 18. Schema version check

- Migration files are created with `npx supabase migration new <name>` (`supabase/migrations/<timestamp>_<name>.sql`) and deployed by the **"Deploy Supabase"** GitHub Action on every push to a pull request and on every merge to `main` (`supabase db push`, then `supabase functions deploy`). The Action uses the GitHub secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. If the runner cannot reach the database directly (IPv6), it connects through the Supabase connection pooler.
- **Two projects (T19a).** Pull requests deploy to the **test** project (`SUPABASE_TEST_PROJECT_REF`, `SUPABASE_TEST_DB_PASSWORD`), `main` to the **real** one; a manual run chooses (`workflow_dispatch` input `target`). Until both test secrets exist, pull requests still go to the real project with a warning; only one of the two, or the test ref equal to the real one, fails the run. On the test project the Action also allows every deploy preview (`https://*--service-hubapp.netlify.app/**`) as an Auth redirect, since the app sends its own origin as the email-link target. Netlify gives each deploy context its own `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Production → real, Deploy Previews and Branch deploys → test). Each project has its own Edge Function secrets (Stripe test keys and its own webhook on the test project). Steps for Eduard: `docs/LANSARE.md`, part 2.
- Table `schema_version(version int not null)` with one row. Every migration ends with `update public.schema_version set version = N;` where N is the next integer (1, 2, 3 …), independent of the file timestamp.
- Function `get_schema_version()` is callable by `anon` and `authenticated`.
- `src/lib/schema.ts` exports `EXPECTED_SCHEMA_VERSION`. On start, preview and development builds compare the two and show a red bar: "Baza de date nu e la zi (versiunea X, aștept Y). Verifică în GitHub → Actions dacă «Deploy Supabase» a rulat." Production shows nothing and, when Sentry is on, reports the mismatch to Sentry instead (one warning per page load, grouped as `schema-version`).
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

## 18b. Error reports (Sentry, T19a)

- **No SDK.** `supabase/functions/_shared/sentry.ts` (pure, shared by the browser, the Edge Functions and the unit tests) parses the DSN, turns a stack (V8, Firefox/Safari, Deno) into frames, builds one event and posts it as a Sentry envelope (`text/plain`, so the browser sends it without a CORS preflight). Nothing is sent without a DSN.
- **Browser** (`src/lib/monitoring.ts`, DSN from the public `VITE_SENTRY_DSN`, environment = Netlify context, release = `COMMIT_REF`): uncaught errors and unhandled rejections (`installGlobalHandlers`, not browser noise or extension stacks); errors while drawing a screen (the React root's `onCaughtError` / `onUncaughtError` in `src/main.tsx`; a chunk that cannot load only as a warning when online); RPC and table answers that are neither a business code nor a lost connection (`failure()` in `src/data/rpc.ts`, tagged `rpc: <function>`); the schema mismatch in production. At most 10 reports per page load, each distinct error once; the last 20 steps go along as breadcrumbs: screens visited, auth events (`SIGNED_IN`, `TOKEN_REFRESHED`, `SIGNED_OUT`… and the result of a session check) and database answers that failed (function or `query`, with the code). A `42501` ("permission denied": the request went without the user's session) also carries `stored_session` — whether this device still held the session and for how long — never the token itself.
- **Screens that break** show a message instead of a blank page: `ScreenErrorBoundary` around the shell's content (the menu keeps working; another screen resets it) and around all routes (full page); `ChunkBoundary` tells a chunk that could not load (`ChunkLoadError` from `lazyChunk`) from a crash.
- **Edge Functions** (`_shared/monitor.ts`, secrets `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, set by the "Deploy Supabase" Action from the GitHub secret `SENTRY_DSN`): every function's final `catch` calls `reportError(name, error)` (log + Sentry, 3 s at most) before answering 500; a staff invitation email or a verification SMS the provider refused is a warning; `dispatch-notifications` sends one warning per channel and round when email, SMS or Stripe fail for good (grouped by channel; push left out).
- **Privacy:** the user is only their id and role; addresses lose the `#…` part (email links carry the session there), token / code / email query values and the invitation token; emails, Romanian phone numbers and JWTs in any text become `[email]`, `[phone]`, `[token]`. The Sentry organization is in the EU (Frankfurt), with IP storage off.
- **Source maps** are published next to the files (`build.sourcemap: true`), so Sentry resolves minified stacks by itself; browsers fetch them only with the developer tools open.
- **Testing:** `/dev/componente` (test builds only) has "Trimite o eroare de test" and "Strică ecranul (test)". The browser-test builds and the local stack send to a Sentry stand-in (`tests/e2e/providers.ts`); after a run, every report received is in `test-results/sentry-reports.json`.

---

## 19. Overrides of `lovable-prompts.md`

The prompts were written to be sent to Lovable one after another, so early prompts contain things later ones replace. Build the final state directly:

| Prompt | Says | Build instead |
|---|---|---|
| 1 | inline style objects; content max 520 px | CSS variables + CSS Modules; responsive shell from day one (§17) |
| 1 | Arial Narrow uppercase headings and main buttons, monospace figures | Inter everywhere, sentence case, even-width digits; capitals only in the wordmark (§17) |
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
