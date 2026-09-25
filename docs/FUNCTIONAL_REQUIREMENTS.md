# Service-Hub — Complete Functional Requirements

**Final platform scope · Version 3.3 · 22.09.2026**

This document lists every page and every function of the platform, in plain terms. It supersedes earlier specifications for **what** must be built. Visual design tokens, legal texts and the service catalog data live in separate files and are not repeated here.

Stack: React + Supabase (PostgreSQL, Auth, Realtime, Storage). Bilingual RO/EN. Mobile-first, responsive to desktop.

---

## 1. Roles

| Role | Who | How the account is created |
|---|---|---|
| **Client** | Car owner | Public sign-up |
| **Shop** | Repair shop (owner + optional staff) | Public sign-up |
| **Admin** | Platform owner only | Created directly in the database. **Never available through public sign-up.** |

A user has exactly one role. The role decides the entire interface. A client can never reach a shop screen; a shop can never reach a client screen; only admin reaches admin screens.

---

## 2. Accounts & authentication (all roles)

- Sign up with email + password, choosing Client or Shop.
- **Email verification required.** Single-use link, expires in 24 h. "Resend" button, max once per 60 s.
- Until verified: a shop is hidden from search and cannot receive bookings; a client cannot book. Both can sign in and see a banner explaining this.
- Sign in, sign out.
- **"Ține-mă minte" checkbox on the sign-in form**, ticked by default. When ticked, the session persists for 30 days across browser restarts. When unticked, the session ends when the browser closes — for shared or workshop computers. Store the choice per device, not on the profile.
- A session must survive closing and reopening the app; a shop owner should not have to sign in every morning.
- Password reset by email.
- Change password while signed in.
- Change email → new address must be verified; old one stays active until then.
- **Account ID:** every account gets a short human-readable ID, generated automatically: `C-00001` for clients, `S-00001` for shops. Shown in the account screen and in all admin lists. Used as the reference in support conversations.
- Terms & Privacy acceptance checkbox at sign-up (unticked by default, blocks sign-up if unticked). Store version + timestamp.
- Language RO/EN, switchable anywhere, saved to profile.
- **On first visit, before any account exists, the interface language follows the browser's language setting**: Romanian for `ro`, English for anything else. The user can override it immediately from the switch on the sign-in screen. Once signed in, the profile setting wins.
- Edit own name and phone.
- Delete own account (with confirmation). Data removed/anonymized within 30 days except legally retained records.
- Export own data as JSON.
- **Shop phone verification:** before a shop appears publicly, its phone must be verified by SMS code, or marked verified manually by admin.
- **Shop staff:** shop owner can invite additional logins (by email) that see and operate the same shop; owner can remove them. Staff cannot access subscription or delete the shop.

---

## 3. Client — pages and functions

### 3.1 Search (home)
- One search field matching shop name, city, or any service the shop offers. Case- and diacritic-insensitive.
- Category filter chips (one per catalog category) + city filter chips (derived from actual shops).
- Result list, **one shop per row**, showing: logo/initials, name, star rating, review count, city, distance (if location known), service count, and "Offers: X" when matched by service.
- Result count line.
- Ranking: weighted rating (see §6). Filters narrow; they never reorder.
- "How is this list ordered?" toggle with a short explanation.
- **Location:** on first visit after login, an in-app banner asks permission to use location ("to suggest shops near you"). Tapping it triggers the browser's native location prompt. If granted: a "Near you" section appears above results, sorted by straight-line distance, and a distance is shown on every result card. If denied or dismissed: nothing changes, search works by text and city. Never trigger the native prompt automatically.
- **Document expiry alert** banner at the top when any saved car's ITP/RCA/vignette expires within 30 days or has expired; tapping opens the Garage.
- **Push permission** banner on first visit (see §7).
- **Favorites:** heart icon on each result and on the shop page; "Favorites" filter chip.

### 3.2 Shop page
- Logo, name, rating + count, description, address, city, distance if known.
- Hours per weekday, closed days, special closed dates (holidays).
- Cars per day, minimum booking notice.
- Inspection fee, with a note that it applies only if the client refuses the quote.
- Phone, tap to call.
- Services offered (no prices) + line "Price is set through a quote after the shop inspects the car."
- Reviews with the shop's public replies.
- Favorite toggle.
- **Book** button.

### 3.3 Booking flow (4 steps with progress bar)
1. **Service** — only what this shop offers, grouped by category.
2. **Day** — next available days; respects weekly closed days, special closed dates, minimum notice, maximum advance. Shows remaining places per day; full days greyed out.
3. **Time** — slots of the shop's slot length (default 60 min) within that day's hours; a slot is taken when it holds the shop's "cars per slot" (default 1); taken slots struck through.
4. **Car** — pick from Garage in one tap, or enter manually with "save to garage" ticked by default. Optional note. Summary. Submit.
- Booking is created as **Pending**. Confirmation screen.
- Booking stores a snapshot of client name/phone/language and car details.

### 3.4 Garage
- List of saved cars: make, model, year, plate, optional VIN.
- Per car: expiry dates for ITP, RCA, vignette (optional). Color pills: neutral >30 days, amber ≤30 days, red on/after expiry.
- Add / edit / delete car (delete asks confirmation; past bookings keep their snapshot).
- Per car: "History — N jobs" → vehicle history page (§3.6).

### 3.5 My bookings
- Chronological list, active first. Each card: service, shop + city, date/time, car, status badge.
- **Status badges:** Pending · Confirmed · In inspection · Quote sent · Quote accepted · In progress · Done · Declined · Cancelled · Quote refused · Expired · No-show.
- **Quote decision** happens here when status is Quote sent: full quote (line items, note, total), then **Accept** / **Refuse**. Optional **partial approval**: each line has a checkbox; total recalculates; "Accept selected". Refuse asks confirmation naming the inspection fee.
- State displays: In inspection ("Your car is being inspected"), In progress (pulsing dot + start time), Done ("Ready for pickup", with odometer reading, work performed and amount).
- **Cancel:** allowed while Pending or Confirmed, before the shop's cancellation deadline if it set one. Not allowed from In inspection onward.
- After Done: **Leave review** (once). Shows "Review sent" afterwards.
- Message button on every card.
- Book again from any Done booking.

### 3.6 Vehicle history (per car)
- **Three entry points, all opening the same screen:** the car card in Garaj; a "My vehicle history" tile in Cont; and a "See vehicle history" link on every completed booking. A client must never have to guess where their history lives.
- Header: car + total spent.
- List of completed jobs: service, shop, date, **odometer reading**, amount. Expand → accepted quote and work performed.
- "Book again" pre-fills shop + service.

### 3.6b Paid history report (per car)
- **Reachable from three places** — vehicle history screen, car card in Garaj, and a "My reports" tile in Cont. A client who wants to sell their car looks in Cont first.
- Button: "Download official report — 29 RON".
- **Only for a specific car**, chosen by the client. No combined report across cars.
- Preview before paying: car details, job count, period, partial job list (last rows truncated), total spent, and the line "This report covers only work carried out through Service-Hub."
- Not offered at all when the car has no completed jobs.
- One-off payment via hosted checkout. Report is generated server-side only after the provider's verified webhook confirms payment.
- PDF contains: branded header, car details, **unique report code** (e.g. `SH-2026-000123`), chronological table of completed jobs (date, shop, city, service, **odometer**, work performed, amount), totals, "odometer at last job", a verification URL + code, and a disclaimer that it is not the vehicle's complete service history. If odometer readings are not increasing by date, the report carries a discreet note; data is never re-sorted or corrected.
- Only `done` jobs appear. Refused, cancelled and no-show are excluded.
- **Public verification page** at `/verifica`, no account required: enter a code, see only car make/model/plate, job count, period and generation date. Never shop names, amounts or personal data.
- Purchased reports remain in Cont under "My reports", free to re-download. A report is a snapshot; later work requires a new report.
- Price lives in platform settings (default 29 RON), changeable by admin.
- **This is separate from, and never replaces, the free GDPR data export**, which remains free and complete.

### 3.7 Messages
- One thread per client–shop pair. List sorted by latest message with preview and unread badge.
- Conversation: chat bubbles; **automatic status messages** rendered centered and labelled as automatic.
- Live updates, no refresh.

### 3.8 Account
- Name, phone, email, account ID, language.
- Push notifications: status + enable control.
- Location: status + enable control.
- Favorites list.
- My reports: purchased history reports, free to re-download.
- Legal documents (3), readable in-app.
- My data: export, delete account.
- Log out.

---

## 4. Shop — pages and functions

### 4.1 Dashboard
- Counters: new requests · today · next 7 days · in inspection · awaiting quote decision · in progress. **Each counter is a button** opening Bookings already filtered, with a removable filter chip; a counter at zero is not tappable.
- Capacity line: "Cars per day: N · Today: M", tap → settings at the capacity field.
- Today's schedule (time, service, car, client), tap → booking.
- **First-run checklist** for a new shop, until complete: choose services · check hours · set cars per day · verify phone. Progress "2 of 4"; disappears for good once done.
- Banner stating exactly why the shop is not visible in search, when it is not (no services, phone not verified, subscription expired, suspended).
- Dismissible reminder to complete billing data from day 60 of the trial.
- Optional **daily digest push** at opening hour with today's count (setting, off by default).

### 4.2 Bookings
- Tabs: **Requests** (Pending) · **Scheduled** (Confirmed onward until Done).
- Card: service, date/time, status, car + plate, client name + tap-to-call phone, client note, account ID.
- Actions by status:
  - Pending → **Confirm** / **Decline** / **Reschedule**
  - Confirmed → **Reschedule** / **Cancel** (with reason, notifies client) / **In inspection** / **No-show**
  - In inspection → **Send quote** (opens composer)
  - Quote sent → waiting state; **Edit quote** (replaces it) ; **Withdraw quote**
  - Quote accepted → **In progress**
  - In progress → **Finalize**
- Reschedule re-checks capacity at submit; fails safely if the day filled up.
- **Quote composer:** repeating rows (item, price), optional note, live total, send. Inspection fee snapshotted onto the quote.
- **Finalize panel:** **odometer reading, mandatory** (no skip), then work performed + total cost, prefilled from the accepted lines, editable. Odometer rules: below the last known reading for that plate → refused, naming the previous value; more than 50,000 km above it → explicit confirmation; below 100 or above 2,000,000 → refused.
- Message button always.
- Unread/new-request badge on the tab.

### 4.3 Repair history
- All terminal jobs: Done, Quote refused, Cancelled, Expired, No-show.
- Search across plate, car, client, service. Filters: status, date range. Odometer shown on each job.
- Totals: job count, revenue.
- Expand a job → quote, work performed, client note, messages link.
- **Export CSV** of the filtered list (including odometer).
- Printable (navigation and buttons hidden, dark on white).

### 4.4 Messages
- Same as client side, from the shop's perspective. Unread badge on tab.

### 4.5 Reviews
- Average + count. List with reviewer, stars, date, text.
- **Reply** (public, editable). **Report** with reason (fake / abusive / wrong shop / personal data). Reported → amber border, "Reported", assessed by admin.
- Shop cannot edit or delete the review itself.

### 4.5b Company & fiscal data
- **Public profile data:** trading name; street and number, city, county, postal code **as separate fields** (single free-text addresses geocode badly); phone, optional second phone; optional website, Facebook page, year established; short description.
- **Fiscal data — never shown publicly:** legal name, **CUI/VAT code**, Trade Register number, registered office address (may differ from the workshop), VAT payer yes/no, bank name, IBAN, billing email, legal representative.
- **Validation on save:** CUI with the official Romanian checksum; Trade Register in either format — old `J08/1234/2015` or new (since 2024) `J2024000123010`; IBAN starting `RO`, 24 chars, checksum verified; postal code exactly 6 digits. Invalid values are rejected with a clear message, never accepted silently.
- **Not required to onboard.** A shop registers, configures and receives bookings without fiscal data. It becomes mandatory only when the first invoice is due, at the end of the 90-day trial. A dismissible reminder appears on the dashboard from day 60.
- "Copy workshop address" button on the registered-office field.

### 4.6 Settings
- Name, description, logo upload, city, address (geocoded automatically on save → latitude/longitude; button "Use my current location" as fallback), phone.
- **Hours per weekday** (open/close or closed), **special closed dates** (single days or ranges, with label).
- **Cars per day** (1–100, no platform limit). **Cars per slot** (how many cars may start at the same time, default 1). **Slot length** (30 / 60 min). **Minimum notice** (e.g. 2 h). **Maximum advance** (e.g. 30 days). **Cancellation deadline** for clients (e.g. 2 h before; 0 = anytime).
- **Inspection fee** (RON, may be 0).
- **Services offered:** searchable catalog with checkboxes, select all / clear all. No prices.
- **Staff accounts:** invite by email, list, remove.
- Notifications: push status, SMS on/off for new requests, daily digest on/off.

### 4.7 Subscription
- Single plan: **100 RON / month**, plus **20 RON / month for each colleague** whose account has joined the shop (an invitation is free; removing a colleague lowers the price; changes are prorated by day), **90-day free trial** (colleagues included), cancel anytime (effective end of period).
- Shows: trial days left or next billing date, status (Trial / Active / Past due / Cancelled), amount.
- Hosted checkout to start; hosted customer portal to change card, view invoices, cancel.
- Invoice list with download.
- **Rule:** when the trial ends without payment, or after final failed payment retry, the shop becomes **inactive**: hidden from search and unable to receive new bookings. Existing bookings continue. All data kept. Paying reactivates immediately.

### 4.8 Account
- Same as client account, plus: shop account ID, tiles for Settings, Subscription, Reviews and Reports.

### 4.9 Reports (owner only)
- Period chips: this month · last 3 months · this year · all time.
- Headline numbers with change vs. the previous period: revenue, completed jobs, average job value.
- Revenue by month (last 12 months, bar chart); jobs by service type (top 8 + "Other", count and revenue).
- Customers: unique, **returning** (more than one completed job ever; count and %), jobs per customer.
- Quotes: acceptance rate, quotes refused, inspection fees collected, average time to decide; a short note when acceptance is below 70%.
- Utilization: average cars per day vs. capacity, busiest weekday.
- CSV export. With fewer than 3 completed jobs, a message instead of empty charts.

---

## 5. Admin — pages and functions

Admin has a separate login route. No public link to it. Every admin action is written to an audit log (who, what, when, before/after).

### 5.1 Overview
- Totals: shops (active / trial / inactive / suspended), clients, bookings by status (today, 7 days, 30 days), reported reviews pending, subscriptions (active, trial ending within 7 days, past due), monthly recurring revenue.
- Recent activity feed.

### 5.2 Shops
- Searchable list: account ID, name, city, verified (email / phone), plan status, created, last active.
- Detail: full profile, settings, bookings, reviews, subscription, staff, audit history.
- Actions: **verify phone manually**, **suspend / unsuspend** (suspended = hidden + no bookings), edit any field, **extend trial**, **set plan status** manually, **delete**.

### 5.3 Clients
- Searchable list: account ID, name, email, phone, verified, created, bookings count, no-show count.
- Detail: profile, cars, bookings, reviews, messages (read-only).
- Actions: suspend / unsuspend, delete.

### 5.4 Bookings
- All bookings, filter by status / shop / client / date range. Detail with quote and thread.
- Action: force-cancel with reason (both parties notified).

### 5.5 Reviews
- **Reported queue** first: review, reason, shop, timestamp, age. Actions: **keep** / **remove** (removal recalculates the shop's average). Decision + note logged.
- All reviews list, searchable.

### 5.6 Subscriptions & invoices
- List with status, next billing, provider reference. Manual overrides. Invoice list.

### 5.6b History reports
- All generated reports: code, client, car, date, amount paid. Void a report issued in error.

### 5.7 Catalog
- Manage categories and services: add, rename, enable/disable, reorder. **Service IDs never change** (bookings reference them). Disabled services stay on old bookings but cannot be selected anymore.

### 5.8 Messages
- Open any thread read-only, for dispute resolution.

### 5.9 Broadcast
- Send an in-app notice and/or push to all shops, all clients, or one city. Logged.

### 5.10 Platform settings
- Subscription price, trial length, quote expiry days, ranking constants, default booking limits, notification texts (RO/EN). Changing a value never alters existing bookings/quotes.

### 5.11 Exports
- CSV: shops, clients, bookings, reviews, subscriptions.

---

## 6. Business rules

**Capacity**
- Daily capacity enforced in the database (trigger). Active statuses count: Pending, Confirmed, In inspection, Quote sent, Quote accepted, In progress.
- Optional per-hour limit enforced the same way.
- Concurrent bookings cannot exceed either limit.

**Job flow**
- **A booking can never be created or moved into the past.** The date and time must be in the future (Europe/Bucharest), checked in the database at the moment of saving, not only in the calendar. Past days and today's past hours are never offered.
- Pending → Confirmed → In inspection → Quote sent → Quote accepted → In progress → Done.
- Terminal: Declined, Cancelled, Quote refused, Expired, No-show.
- Work never starts before a quote is accepted.
- **Inspection fee** applies only when the client refuses the quote; it is snapshotted on the quote when sent; if the shop's fee is 0, the refusal flow never mentions a fee.
- **Partial approval:** accepted lines form the job; refused lines are recorded; if the client refuses **all** lines it counts as a refusal (fee applies).
- **Quote expiry:** if the client does not answer within N days (platform setting, default 3), the quote expires, the booking becomes Expired, capacity is released, both parties notified. Reminder push to the client 24 h before expiry.
- Reschedule is possible only while Pending or Confirmed.
- Client cancellation is possible only while Pending or Confirmed, and only before the shop's cancellation deadline.
- Shop cancellation of a Confirmed booking requires a reason; client notified.
- **No-show:** shop can mark a Confirmed booking as No-show once the slot time has passed. Counted per client, visible to admin. No automatic penalty.
- Quote items and totals are immutable once sent; "edit" creates a new quote and supersedes the old one, which is kept for history.

**Odometer**
- Required to complete a job. Last known reading = highest reading among completed jobs for the same plate. Rules as in §4.2.

**Abuse limits** (values editable by admin)
- Per client: at most 3 active bookings at one shop, 10 in total, 5 new per 24 h.
- Messages: at most 30 per thread per hour; only between a client and a shop that have a booking together.
- Reviews: only within 60 days of completion.
- Quotes: at most 20 versions per booking; a quote can be sent only for a booking in inspection.
- Sign-up: rate-limited and protected by CAPTCHA.
- After 3 no-shows in 90 days, shops see a discreet marker on that client's bookings; admin sees the flag. No automatic block.

**Search & ranking**
- Weighted score = (sum of ratings + 4.3 × 3) / (review count + 3). Tie-break: more reviews, then name.
- No paid placement, ever.
- "Near you" is a separate section by distance; it does not change the main ranking.
- Suspended, inactive (unpaid) and unverified shops never appear in search.

**Reviews**
- One review per Done booking, by the client, immutable.
- Shop reply editable. Reports go to the admin queue; a reported review stays visible until admin decides.

**Subscription**
- One plan, one price, 90-day trial, cancel anytime effective at period end.
- Plan status is changed only by the payment provider's verified webhook or by admin. The browser can never change it.
- Unpaid → inactive (hidden, no new bookings), data kept, reactivation on payment.

**Data**
- Vehicle and client details are snapshotted onto bookings; later edits never change history.
- Vehicle history matches by plate (case/space-insensitive), fallback make+model+year.

---

## 7. Notifications

### Push (both roles, after permission)
Permission is asked WhatsApp-Web style: in-app banner first, native browser prompt only on tap, never on page load. Status and manual control in Account. Multiple devices per user supported. Dead endpoints cleaned up automatically. iOS requires Add-to-Home-Screen; the banner says so.

| Event | Client gets | Shop gets |
|---|---|---|
| New booking request | — | ✓ (+ SMS if enabled) |
| Confirmed / declined / rescheduled / cancelled by shop | ✓ | — |
| Cancelled by client | — | ✓ |
| In inspection | ✓ | — |
| Quote sent | ✓ | — |
| Quote accepted / refused / partially accepted | — | ✓ |
| Quote expiring in 24 h | ✓ | ✓ |
| Quote expired | ✓ | ✓ |
| In progress | ✓ | — |
| Done — ready for pickup | ✓ | — |
| **Appointment reminder, 24 h before** | ✓ | — |
| New message | ✓ | ✓ |
| Document expiry (30 d, 7 d, day-of; once per threshold) | ✓ | — |
| New review / reply to review / report decided | reply → ✓ | review, decision → ✓ |
| Daily digest at opening (optional) | — | ✓ |
| Trial ending (7 d, 1 d), payment failed, account inactive | — | ✓ |
| Admin broadcast | ✓ | ✓ |

Every event also writes an **automatic message** into the client–shop thread where one exists, in the **recipient's** language.

### Email
Verification, resend, password reset, email-change verification, invoice/receipt, trial ending, payment failed, account suspended, staff invitation, reported-review notice to admin.

### SMS (shops, optional per shop)
New booking request. Provider: SMSO.

### In-app
Banners: email pending, push permission, location permission, document expiry. **Unread badges** on Bookings and Messages tabs for both roles; reported-reviews badge for admin.

### Realtime
Bookings, messages, reviews, dashboard counters and admin lists update live over Supabase Realtime — no polling, no manual refresh. Auto-reconnect and resync after connection loss.

---

## 8. Data (summary)

profiles (role, display_id, verified flags, terms version) · shop_staff · shops (+ description, logo, split address fields, lat/lng, per-day hours, special closed dates, limits, fee, suspended, active) · shop_billing (legal_name, vat_id, reg_com, legal_address, vat_payer, bank_name, iban, billing_email, legal_rep — owner and admin only) · cars · bookings (+ snapshots, all statuses, no_show) · quotes + quote_items (with per-line approval) · reviews (+ reply, report) · threads · messages · favorites · history_reports (code, car snapshot, totals, payment, pdf) · push_subscriptions · notifications_log · subscriptions + invoices · service_catalog (DB-managed) · platform_settings · admin_audit_log.

Row Level Security on every table. Column-level grants where a role may change only some columns (e.g. client may change only a quote's decision, shop may change only a review's reply/report fields, nobody but the service role changes plan status).

---

## 9. External services

Email (Resend or Amazon SES, with SPF/DKIM/DMARC) · Web Push (VAPID) · SMS (SMSO) · Payments (Stripe) · Invoicing + e-Factura (SmartBill or Oblio) · **Geocoding** (address → coordinates; Google Geocoding or Nominatim) · Storage for logos (Supabase Storage) · Error monitoring (Sentry).

---

## 10. Quality rules (all screens)

- Every write button disables on tap, shows a spinner, submits once (idempotent on the server), and shows an inline error with "Try again" on failure — never a browser alert.
- Slim offline bar while the connection is down; the interface stays usable for reading.
- Lists show skeletons while loading; an empty state never appears before data has loaded.
- Session expiry during a write: a clear message and a sign-in action, keeping what the user was doing where feasible.
- Keyboard-accessible, visible focus ring, labels on every field, status never by color alone, tap targets ≥ 44 px, reduced motion respected, WCAG AA contrast.
- All times stored in UTC and displayed in Europe/Bucharest regardless of the device's time zone.
- US English for all English text.

## 11. Responsive rules (short)

- Mobile: fixed header, scrolling content, fixed bottom bar with 5 tabs per role.
- ≥1024 px: left sidebar (Account + Log out pinned at the bottom), content capped at 900 px, **lists stay single-column**; only day/time grids and the settings catalog gain columns.
- Public landing page at the root for visitors without an account.
- Full design tokens are in the separate design document.
