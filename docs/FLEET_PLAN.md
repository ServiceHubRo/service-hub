# Service-Hub — Fleet accounts: audit and plan (T63)

Status: **stage 1 delivered (audit, plan, pure logic, design preview). No schema change is applied.**
Every database change below is a *proposal* waiting for Eduard's approval. Nothing in this file is in
`supabase/migrations/`, so the "Deploy Supabase" Action cannot apply it.

Read with `CLAUDE.md` and `docs/ARCHITECTURE.md` (they win where this file disagrees).

---

## 1. Audit — what exists today (inspected 31 Oct 2026, `main` at `cdd490f`, schema 90)

### 1.1 Stack and architecture (unchanged)
Vite + React 19 + TypeScript strict, React Router 7, CSS Modules + `tokens.css`, Lucide icons,
hand-drawn SVG charts. Supabase Postgres with RLS on every table; every booking/quote change is a
`security definer` RPC with `request_id` idempotency (`request_log`), stable error codes mapped in
`src/data/rpc.ts`; Realtime for live lists; outbox `notification_events` → `dispatch-notifications`
(push, email, SMS, quiet hours). Netlify deploy previews; "Deploy Supabase" Action on PRs.

### 1.2 Identity and permissions
- `profiles.role in ('client','shop','admin')`, fixed at sign-up; `RoleGuard` + `/c`, `/s`, `/admin`
  route trees; RLS mirrors it. **No multi-space or membership concept for clients exists.**
- The only membership pattern is `shop_staff` (owner/staff, invitation by hashed token, `invite-staff`
  Edge Function, `list_shop_staff`, seat counting). It is the model to copy for company members.
- Audit log exists only for admins (`admin_audit_log`).

### 1.3 Reusable as-is
| Area | What exists | How fleet reuses it |
|---|---|---|
| Auth | Supabase Auth, email/Google/Apple, one account per person | Company members are ordinary client accounts. No second auth. |
| Cars | `cars` (make, model, year, plate, plate_norm, VIN, ITP/RCA/vignette dates, oil interval), owner-only RLS | Company cars are `cars` rows with a `company_id` (proposed). |
| Document expiry | `expiry.ts`, `doc_expiry` reminders (30/7/1 days) | Same dates, same urgency rules; recipients become the fleet managers. |
| Booking engine | `create_booking`, capacity, state machine §3, snapshots, T60 one-active-booking-per-car | A company booking is a normal booking with `company_id`. No second booking system. |
| Quotes | versions, variants, labor/part lines with quantity, immutable after sending, `decide_quote` | Approval through the same `apply_quote_answer`; a fleet wrapper adds the permission + threshold check and the decision log. |
| Intake, final quote, job documents (T50) | `vehicle_intakes`, `job-document` PDFs, `quote_recipient` (person or company) | Company bookings print the company as recipient. |
| Repair history | `done` jobs with odometer, work, cost, warranty (T37a), `vehicleKey()` | The fleet history is the company's `done` bookings — no manual re-entry. |
| Odometer rules | `complete_job` checks (§7), `last_odometer_for_booking` | The only trusted readings for cost per km. |
| Messages | `threads` per (shop, client), system messages as event codes | The booking member's thread; "request changes" = a message, no new state. |
| Notifications | outbox, templates RO/EN, quiet hours, per-channel retries | New fleet events only; same dispatcher. |
| Exports | `toCsv`/`csvField` (formula-safe), `xlsx.ts`, `saveFile`, print stylesheet | Costs and reports export with the same helpers. |
| Charts | `MonthlyChart`, `Meter` (shop Rapoarte) | Same drawing style; fleet charts in `src/screens/fleet/FleetCharts.tsx`. |
| Company check | `verify-company` Edge Function (ANAF CUI lookup), CUI/Reg. Com. validators | Validate the company's CUI at creation. |
| Client company details | `profiles.doc_party` / `company_*` (Cont → Date pentru deviz) | Prefill a new company from them; not moved, not changed. |
| Subscriptions | `subscriptions` keyed by `shop_id`, Stripe functions | **Not reused directly** (keyed by shop); a parallel `company_subscriptions` is proposed for later. |

### 1.4 Missing (to build)
1. Company entity and membership with roles (admin, manager, driver, accountant), invitations.
2. Space switcher (personal ↔ company) and the company interface.
3. Company ownership of cars, driver assignment, archive, department/type, an "unavailable" mark.
4. Company bookings (`bookings.company_id`, who booked) and approval rules with thresholds; decision log.
5. Manual expenses with categories and receipts; budgets.
6. Driver issue reports, notes and incidents.
7. Company audit log; fleet notifications; fleet plans and limits.
8. PDF export of fleet reports (print-to-PDF first, an Edge Function later).
9. A current odometer for a car outside jobs (today readings exist only on finished jobs).

### 1.5 Tests today
Vitest unit tests (`tests/unit`, ~70 files), SQL tests (`tests/sql`, ~90 files, local Postgres),
Playwright flows (`tests/e2e`, ~50 specs). Stage 1 adds `tests/unit/fleet.test.ts` (31 tests).

---

## 2. Compatibility and security risks found

| # | Risk | Mitigation in the proposal |
|---|---|---|
| R1 | `fetchCars()` reads every car RLS returns. Once members can read company cars, they would appear in the personal Garaj. | Same PR as the migration: the garage reads `company_id is null`; the personal RLS policy stays owner-only for personal cars, company cars get their own policy. |
| R2 | `decide_quote` lets the booking's client decide. A driver who booked a company car could approve any amount. | For a booking with `company_id`, `decide_quote` refuses (`fleet_use_company_approval`); `fleet_decide_quote` checks role + threshold server-side. |
| R3 | Abuse limits are per client (10 active bookings, 3 per shop, 5 new per 24 h). A manager booking 15 cars hits them. | Company bookings use company limits (`limits.fleet_*`, configurable), still enforced in `create_booking` with row locks. |
| R4 | Reminder jobs (`doc_expiry`, oil, `service_due`) notify `cars.owner_id`. | For company cars the recipients are members with `vehicles.manage` (+ the assigned driver for documents, without amounts). |
| R5 | A personal user creating a car with a company's plate could see company data. | Access is never derived from a plate: company rows are reached only through `company_members`. `vehicleKey` stays for a person's own bookings. Tested. |
| R6 | Notifications carry amounts (`{total}`, `{cost}`). | Fleet events send amounts only to roles with `costs.view`; driver events carry none. |
| R7 | Deleting the account of the last company admin. | `delete-account` refuses while the user is the last admin of a company with other members (transfer first). |
| R8 | `CLAUDE.md` §1: "one role, three interfaces". | Fleet is **not a new role**: it is membership for client accounts. Shops and admins cannot join companies (checked in SQL). Needs Eduard's approval as a rule change. |
| R9 | Threads are per (shop, client); a manager cannot read the driver's conversation. | v1: messages stay with the member who booked; managers see status, quote and documents in the fleet screens. A company thread is a later option. |
| R10 | Totals that sum estimates, approvals and final costs. | One ledger rule (§5): only final costs and manual expenses; estimates/approvals never summed. Unit tested. |

---

## 3. Proposed data model (NOT applied — for approval)

All new tables: RLS on, no direct browser writes except where stated, every write an RPC with
`p_request_id`, every RPC `security definer`, `set search_path = ''`, error codes added to
`src/data/rpc.ts`. One migration per stage; each ends with `schema_version` + 1.

### 3.1 Stage 2 — companies and membership (`fleet_companies`)
```sql
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  vat_id text check (vat_id is null or public.is_valid_cui(vat_id)),
  reg_com text check (reg_com is null or public.is_valid_reg_com(reg_com)),
  address text check (length(address) <= 300),
  manager_approval_limit numeric(12,2) check (manager_approval_limit >= 0), -- null = no limit
  budget_monthly numeric(12,2) check (budget_monthly > 0),                  -- null = none set
  budget_yearly  numeric(12,2) check (budget_yearly  > 0),
  plan_key text not null default 'fleet_trial',        -- written by admin / webhook only
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,  -- null until accepted
  invited_email text,
  role text not null check (role in ('admin','manager','driver','accountant')),
  invite_token_hash text, invite_emailed_hash text,
  invited_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create table public.company_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid, action text not null, entity_type text, entity_id uuid,
  before jsonb, after jsonb, created_at timestamptz not null default now()
);
```
Helpers (`stable security definer`): `company_role(company)` → the caller's role or null;
`fleet_can(company, capability)` — the SQL copy of `src/lib/fleet/permissions.ts` (a unit test
compares both lists, like the error codes). Only `profiles.role = 'client'` may create or join.
RPCs: `create_company(name, vat_id, reg_com, address, request_id)` (caller becomes admin; at most
`limits.companies_per_user` = 3), `update_company(...)` (admin), `invite_company_member(email, role,
token, request_id)` / `accept_company_invite(token)` / `set_member_role` / `remove_member` (admin;
never the last admin), `set_company_budget`, `set_approval_limit` (admin). Read: RLS on `companies`
and `company_members` for members; `my_companies()` for the space switcher.

### 3.2 Stage 3 — company cars

> **Built differently (T63c, 31 Oct 2026):** a separate table `company_vehicles`, not columns on `cars`. Reason found while building: `cars.owner_id` cascades on delete and the garage and personal reminders follow the owner, so a company vehicle stored in `cars` would disappear with the member who added it. See ARCHITECTURE §2. The sketch below is kept for the record.

```sql
alter table public.cars
  add column company_id uuid references public.companies(id),
  add column archived_at timestamptz,
  add column unavailable boolean not null default false,
  add column driver_member_id uuid references public.company_members(id) on delete set null,
  add column department text check (length(department) <= 60),
  add column vehicle_type text check (vehicle_type in ('car','van','truck','motorcycle','other'));
```
- Personal policies unchanged but narrowed to `company_id is null`; new policy
  `cars_select_company`: `fleet_can(company_id,'vehicles.viewAll')` or the assigned driver.
- No browser writes on company cars: `fleet_save_vehicle(company, car jsonb, request_id)`,
  `fleet_archive_vehicle`, `fleet_assign_driver`, `fleet_set_unavailable` (managers/admin).
  Archive never deletes; a company car cannot be deleted while it has bookings.
- Existing personal cars are **never moved**. Copying a personal car into a company is an explicit
  action that creates a new company row (history of the personal car stays personal).
- Plan limit: `fleet_save_vehicle` refuses a new car above the plan's vehicle limit
  (`fleet_plan_limit`); existing cars, history and edits are never blocked or deleted.

### 3.3 Stage 4 — company bookings and approvals (built in T63d; ARCHITECTURE.md §2 is the reference)
```sql
alter table public.bookings add column company_id uuid references public.companies(id);
alter table public.quotes   add column decided_by_user uuid references public.profiles(id);
create table public.quote_decisions (            -- the decision log
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes(id), booking_id uuid not null,
  company_id uuid not null, member_id uuid not null, decision text not null
    check (decision in ('approved','partially_approved','refused','changes_requested')),
  amount numeric(12,2), created_at timestamptz not null default now()
);
```
- `create_booking(..., p_company_id)`: the caller needs `bookings.create`; the car must belong to
  that company; `client_id` = the caller (so messages, reminders and history keep working);
  company limits replace the personal ones (R3).
- `fleet_decide_quote(booking, quote, item_ids, request_id)`: `approvalDecision()` server-side on the
  total of the approved lines (`not_allowed`, `fleet_over_limit {limit}`), then the same path as
  `decide_quote`, `decided_by_user`, a `quote_decisions` row and an audit row, all in one transaction.
- `decide_quote` (replaced in a new migration) refuses company bookings (R2).
- `fleet_request_changes(booking, text, request_id)`: a message in the booking thread + a decision
  row; no new booking state.
- Read: `fleet_overview(company)` → one jsonb (the shape of `src/lib/fleet/types.ts`) already
  narrowed: drivers get only assigned cars and their bookings **without** cost, quote totals or
  expenses; accountants get everything read-only.

### 3.4 Stage 5 — expenses and documents
```sql
create table public.fleet_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  car_id uuid not null references public.cars(id),
  category text not null check (category in ('repairs','maintenance','parts','labor','tires',
    'consumables','itp','insurance','tolls','fuel','other')),
  day date not null, amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'RON' check (currency ~ '^[A-Z]{3}$'),
  description text check (length(description) <= 500), supplier text check (length(supplier) <= 120),
  odometer int check (odometer between 0 and 2000000),
  booking_id uuid references public.bookings(id),
  receipt_path text, created_by uuid not null, created_at timestamptz not null default now(),
  deleted_at timestamptz
);
```
- `fleet_add_expense` / `fleet_update_expense` / `fleet_delete_expense` (soft) for `costs.manage`;
  a driver may add `fuel` for an assigned car (configurable later). `day` never in the future
  (Bucharest). An expense's odometer below the car's last reading → `odometer_lower`.
- Private bucket `fleet-receipts` (path `<company>/<expense>/<file>`, 5 MB, pdf/jpeg/png/webp),
  read/write by `costs.manage`, read by `costs.view` — the `intake-photos` pattern.
- `fleet_issues` (problem / incident / note, status open → scheduled → closed, `booking_id` when a
  booking was made from it) — drivers create for assigned cars; managers manage.

### 3.5 Stage 7 — notifications and plans
- Events: `fleet_quote_waiting` (approvers; amount only to `costs.view`), `fleet_quote_decided`,
  `fleet_job_done`, `fleet_issue_reported` (managers), `fleet_doc_expiry` (managers + driver),
  `fleet_budget_exceeded` (admin + accountant, once per period), `fleet_invite` (email).
  Same outbox, same quiet hours, one event per action (dedupe key = event + entity).
- `fleet_plans` (admin-editable): `key`, `name_ro/en`, `price_ron`, `vehicle_limit` (null = custom),
  `features jsonb`, `active`. Seed as **hypotheses**: Start 29 lei/5 cars, Business 59/15,
  Pro 119/40, Enterprise custom. **No Stripe, no charging, no change to the shop subscription flow**
  until Eduard approves a separate payments task.

---

## 4. Interface (stage 3 onward)

- **Space switcher** in the client's sidebar/header: "Personal" or the company name, always visible
  with a building icon and the company name in the page header, so it is clear which space is open.
  Switching changes the route tree: `/c/...` (personal) ↔ `/f/:companyId/...` (company), still under
  the client `RoleGuard`.
- **Company navigation (5 items):** Panou · Vehicule · Programări · Costuri · Cont (Rapoarte, Membri,
  Buget, Abonament, Setări firmă are tiles in Cont). A driver sees Panou · Vehicule · Programări ·
  Probleme · Cont.
- Screens: Panou (KPI cards, charts, activity), Vehicule (search, filters, sort, CSV), Vehicul
  (tabs: prezentare, istoric, costuri, programări, devize, documente, șofer, note), Costuri (filters,
  manual expense form, CSV), Rapoarte (6 reports, CSV, print/PDF), Membri (roles, invitations).
- Stage 1 delivers these screens as a **design preview** at `/dev/flota` (test builds only, sample
  data clearly labelled, switchable role / empty / loading), built from components that take the
  `FleetOverview` shape, so stage 3 wires them to `fleet_overview()` without redrawing.

## 5. Calculation rules (implemented in `src/lib/fleet/`, unit tested)

1. **One ledger, two sources.** `service`: a `done` booking counts once, for `cost`, on the day it was
   finished (Bucharest); a `quote_refused` booking counts its inspection fee. `manual`: the company's
   expenses. Sent/approved quotes are never costs. A manual expense linked to a counted booking is
   listed as a duplicate and not summed. Other currencies are listed, never converted.
2. **Categories.** A job's category comes from its first service's catalog category (cat_rev →
   maintenance, cat_anv → tires, cat_itp → ITP, cat_det → consumables, else repairs). Parts/labor of a
   job are a *split* of its cost from the approved typed lines, never added to it.
3. **Average per vehicle** = total in the range ÷ cars that were in the fleet during the range
   (added before its end, not archived before its start).
4. **Cost per km** = costs after the baseline reading, from the range start, up to the last reading
   ÷ (last − baseline km). No figure when there are no readings, one reading, readings that go down,
   or zero distance — the screen says which.
5. **Budget**: used, remaining (≥ 0), percent over; nothing when the company set no budget.
6. **Comparison** (as in the shop's Rapoarte): this month's 1st to today against the same days of last month; the last 3 months against the 3 before; this year against last year to the same day.
7. **Statuses**: archived (date) > in service (inspection … in progress) > unavailable (explicit) >
   scheduled (pending/confirmed) > active.

## 6. Roles (capability matrix — `src/lib/fleet/permissions.ts`, mirrored by `fleet_can` in SQL)

| Capability | Admin | Manager | Driver | Accountant |
|---|---|---|---|---|
| Company settings, members, subscription, budget | ✓ | – | – | – |
| See all cars | ✓ | ✓ | assigned only | ✓ |
| Manage cars, assign drivers | ✓ | ✓ | – | – |
| Book a service, see all bookings | ✓ | ✓ | own only | read only |
| Approve quotes | ✓ | up to the limit | – | – |
| See costs and reports, export | ✓ | ✓ | – | ✓ |
| Add/edit manual expenses | ✓ | ✓ | fuel only (later) | ✓ |
| Documents | ✓ | ✓ | assigned cars, no money | ✓ |
| Report a problem | ✓ | ✓ | ✓ | – |
| Audit log | ✓ | – | – | ✓ |

## 7. Stages

| Stage | Content | Needs approval |
|---|---|---|
| 1 ✅ | Audit, plan, `src/lib/fleet/` logic + tests, `/dev/flota` design preview | – |
| 2 | `companies`, `company_members`, audit log, invitations, space switcher, create company | **Migration** + rule change R8 |
| 3 | Company cars, Panou and Vehicule on real data | **Migration** (cars columns) |
| 4 ✅ | Company bookings, approvals with thresholds, decision log, vehicle history (T63d, migration `fleet_bookings`) | **Migration** (bookings/quotes, `decide_quote` replaced) |
| 5 | Expenses, receipts bucket, reports, exports | **Migration** + storage bucket |
| 6 | Driver/accountant flows, issues | **Migration** |
| 7 | Fleet notifications; plans and billing → `docs/FLEET_BILLING_PLAN.md` (T64) | **Migration**; payments = separate decision |
| 8 | SQL tests (isolation between companies, driver scope, approval bypass via API, limits), Playwright flows A–H, regression pass | – |

## 8. Tests per stage
- SQL: company A cannot read/write company B (every table); a driver reads only assigned cars and
  no costs; a personal user with the same plate reads nothing; `decide_quote` refuses company
  bookings; `fleet_decide_quote` refuses drivers/accountants and managers over the limit; the same
  `request_id` twice; plan limit refuses a new car but never edits or history; last admin cannot leave.
- Unit: ledger/dedupe, cost per km, budget, permissions mirror (SQL list = TS list).
- Playwright: scenarios A–H of the request at 390 / 820 / 1440 px, RO and EN.

## 9. Open decisions for Eduard
1. ~~Fleet as membership inside client accounts (not a fourth role) — R8.~~ **Approved by Eduard, 31 Oct 2026.** CLAUDE.md §1 is updated together with T63b, when the first company table exists.
2. Manager approval limit when none is set: proposed "no limit" (the company chooses a limit when it
   wants one).
3. Plan prices and limits are hypotheses; payments stay off until a separate approval.
