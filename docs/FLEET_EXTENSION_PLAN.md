# Fleet — next stages (T68–T74): audit and proposed migrations

Requested by Eduard on 6 Nov 2026 (stages 0–12). **Nothing here is applied.** Each migration waits for
Eduard's explicit approval; each one is additive (new tables, columns, functions) unless it says
otherwise, never deletes or merges data, and has a rollback migration ready.

## 1. Audit (branch `claude/fleet-management-audit-q9knca`, schema 99; `main` at schema 96)

PR #107 (T65–T67, schema 97–99) is open; `main` has T63a–T64d. Every stage below builds on #107.

### Exists and is reused

| Area | What exists | Reused for |
|---|---|---|
| Companies, members, roles, rights | `companies`, `company_members`, `fleet_can(company, cap)` with role matrix + extra rights (T63i), plan features (T65) | every permission check |
| Company vehicles | `company_vehicles` (plate_norm unique among active, VIN unique among active since T66, ITP/RCA/vignette dates, driver, archive) | expenses, fuel, readings, maintenance, incidents |
| Audit trail | `company_audit_log (company, actor, action, entity_type, entity_id, before, after)` | the history of every new record (no parallel log) |
| Costs from Service-Hub | `fleet_ledger` (finished jobs and refused-quote fees) → `fleet_report`, `fleet_report_entries`, `fleet_vehicle_cost_per_km` | the ledger gains manual expenses (one source of totals) |
| Expense logic in the app | `src/lib/fleet/costs.ts` `buildLedger`: an expense tied to a counted job is listed, never summed; foreign currency never summed (unit tested, T63a) | the same rule moves into SQL |
| Quote approval | `fleet_decide_quote`, `company_quote_decisions`, approval limits, driver cannot approve | „Cere modificări” as a new decision |
| Booking cancel | `cancel_booking` (client, pending/confirmed), `shop_cancel_booking`, `admin_force_cancel` | manager cancel reuses the same path |
| Notifications | `notification_events` outbox, `notify_user`, quiet hours, `templates.ts`, `emails.ts`, hourly job `run_hourly_jobs` | all fleet notices (no parallel system) |
| Private photos | bucket `intake-photos` + its RLS pattern (T52) | receipts and incident photos |
| Odometer | `bookings.odometer` + `last_odometer_for_plate` (decreasing reading checks for shops) | fleet readings |
| Plate normalization | SQL `plate_norm(text)` (T66), generated `plate_norm` columns on `cars`, `company_vehicles`, `shop_client_cars`, bookings' snapshot, `vehicle_key()`; TS `normalizePlate` ×2 | one canonical function |
| Editorial standard, menus | T66b, T67 (in PR #107) | stages 9 and 10 are done |

### Incomplete
- `fleet_overview` returns `expenses: []`, `issues: []`; the screens show „nu este încă disponibilă” for receipts/files.
- Plate normalization is **not one rule**: SQL columns remove spaces and dashes only; `vehicle_key()` and
  `src/lib/history.ts` remove every non-letter/digit; `src/lib/validators.ts` removes spaces and dashes.
  `BV.98.LGY` is one car for the history but two for the duplicate check. No plate validation exists
  beyond „at most 20 characters”: any text is accepted.
- Fleet members get no notifications of their own (only the person who booked, as a client).

### Missing
Manual expenses, receipts storage, fuel and odometer log, consumption, driver issue/incident reports,
maintenance plans, „Cere modificări”, manager cancel with reason, fleet notifications, plate validation.

## 2. Proposed migrations (one per stage, in this order)

Every function: `security definer`, `fleet_can` checks, `request_begin/request_finish` idempotency, a
lock on the vehicle or company row where two requests could race, one transaction, an audit row,
`fail(code)` with RO/EN texts. RLS on every table; no direct writes from the browser.

### M1 — `fleet_expenses` (T63e, stage 1)
```sql
create table public.fleet_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.company_vehicles(id),
  category text not null check (category in ('fuel','parts','external_repair','labor','tolls_parking',
                                             'consumables','insurance','other')),
  day date not null,                       -- never in the future (Bucharest)
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'RON' check (currency ~ '^[A-Z]{3}$'),
  supplier text check (char_length(supplier) <= 120),
  description text check (char_length(description) <= 500),
  odometer int check (odometer between 0 and 2000000),
  liters numeric(8,2) check (liters > 0), fuel_type text check (fuel_type in ('diesel','petrol','lpg','electric','other')),
  full_tank boolean,                       -- fuel only; needed for consumption
  booking_id uuid references public.bookings(id),   -- the Service-Hub job it documents, if any
  receipt_path text,                        -- private bucket fleet-files
  status text not null default 'ok' check (status in ('ok','to_check')),
  created_by uuid not null, created_at timestamptz not null default now(),
  updated_at timestamptz, deleted_at timestamptz   -- soft delete; history in company_audit_log
);
```
- **No double counting:** an expense with `booking_id` of a finished company job is stored and shown
  „Inclusă deja din Service-Hub”, never added to totals; `fleet_ledger` = jobs ∪ expenses without such a
  link, RON only (other currencies listed, not summed) — the rule already unit tested in `costs.ts`.
  A second expense with the same vehicle, day, amount and supplier is refused as a possible duplicate
  unless confirmed (`expense_possible_duplicate`).
- Functions: `fleet_save_expense`, `fleet_delete_expense` (soft), `fleet_mark_expense` (`ok`/`to_check`).
  Rights: `costs.manage` (admin, manager; accountant reads); a driver adds `fuel` only, for the vehicle
  assigned to them, and never sees totals.
- Storage: private bucket `fleet-files` (5 MB, jpeg/png/webp/pdf), path `<company>/<kind>/<id>/<file>`,
  read by members who may see the record, written through the same rights (the `intake-photos` pattern).
- **Rollback:** `drop` the new table, functions and bucket policies; restore the previous `fleet_ledger`
  (no existing row is touched).

### M2 — odometer and fuel (stage 5)
- `fleet_odometer_readings (company, vehicle, day, km, source 'manual'|'fuel'|'job', ref_id, created_by,
  corrected_from int, correction_reason text, deleted_at)`; a fuel expense with `odometer` writes a reading.
- A reading below the last one (any source, jobs included) is refused (`odometer_lower`); a correction is
  allowed only to `vehicles.manage`, with a reason, and logged (before/after).
- `fleet_fuel_stats(company, vehicle, from, to)`: consumption (l/100 km) only between two full-tank fills
  with readings; fuel cost per km only with two readings; otherwise `null` and a reason — never an estimate.
- **Rollback:** drop table and functions.

### M3 — issues and incidents (stages 2 and 7)
- `fleet_issues (company, vehicle, kind 'defect'|'damage'|'accident'|'technical'|'other', title, description,
  happened_on, status 'new'|'in_review'|'scheduled'|'resolved'|'closed', booking_id, reported_by, created_at)`;
  photos in `fleet-files`; `fleet_issue_events (issue, status, note, by, at)` keeps every change.
- A driver reports for the vehicle assigned to them; managers and admins change status and link a booking;
  the accountant reads.
- **Rollback:** drop tables and functions.

### M4 — maintenance (stage 6)
- `fleet_maintenance (company, vehicle, kind 'oil'|'filters'|'brakes'|'tires'|'battery'|'fluids'|'service'|'custom',
  label, interval_km, interval_months, last_done_on, last_done_km)`; status (ok / soon / overdue) computed
  from the last reading and the date, never stored; a finished Service-Hub job of the matching service can
  mark it done (offered, not automatic).
- **Rollback:** drop table and functions.

### M5 — quote flow (stage 4)
- `company_quote_decisions.decision` gains `changes_requested` (check constraint widened);
  `fleet_request_quote_changes(booking, quote, reason, request)`: approvers only, reason required; the
  booking stays `quote_sent`; the shop gets a thread message and a notification and sends a revised quote
  with the existing flow (the old one becomes `superseded`).
- `fleet_cancel_booking(booking, reason, request)`: admin/manager (and approvers) for any company booking
  in `pending`/`confirmed`, reason required; the same transition as `cancel_booking`; the driver and the
  shop are notified with the reason. Nothing changes for personal bookings.
- **Rollback:** narrow the check back after removing `changes_requested` rows (none exist before M5),
  drop the two functions.

### M6 — fleet notifications (stage 3)
- New events through `notify_user` (same outbox, quiet hours, per-user language): `fleet_quote_waiting`,
  `fleet_quote_decided`, `fleet_quote_changes`, `fleet_booking_changed`, `fleet_booking_cancelled`,
  `fleet_issue_reported`, `fleet_fuel_receipt`, `fleet_expense_to_check`, `fleet_doc_expiring`,
  `fleet_maintenance_due`. Recipients from `fleet_can` (approvers, `costs.view`, the assigned driver);
  amounts only in texts for members with `costs.view`. Daily part in `run_hourly_jobs` (at 10:xx),
  once per document/item per period (dedupe key).
- **Rollback:** drop the functions; texts removed from `templates.ts`.

### M7 — one plate rule (stage 8)
- **Canonical value:** upper case; remove spaces, dashes, dots, underscores and slashes; nothing else is
  changed (letters with diacritics and other alphabets stay as typed). One SQL function `plate_norm()`,
  one TS module `src/lib/plate.ts` with the same test vectors on both sides.
- **Validation** (new and changed plates only; existing rows are never rejected): canonical value of 2–10
  letters or digits, at least one digit; Romanian formats (`B 123 ABC`, `BV 98 LGY`, `B 12 ABC`, red and
  temporary plates) recognized and shown spaced; foreign plates accepted. Message: „Numărul de
  înmatriculare nu este valid.”
- **Recomputed, not rewritten:** the generated `plate_norm` columns of `cars`, `company_vehicles`,
  `shop_client_cars` are re-created with the function (the typed `plate` is untouched; snapshots in
  bookings keep their copy, comparisons use `plate_norm(car_snapshot->>'plate')`).
- **Risk:** if two active vehicles of one company or two clients of one shop become equal under the
  wider rule (e.g. `B.123.ABC` and `B123ABC`), the unique index cannot be rebuilt and the migration
  stops before changing anything. A read-only pre-check query lists such pairs first; the Admin screen
  „Vehicule duplicate” lists them after.
- **Rollback:** re-create the columns with the previous expression (`[\s-]` only).

## 3. Order and approvals

Status (6 Nov 2026): M7 and M1 approved and built (T69, T70; schema 100–101). M2–M6 and the money
visibility migration approved by Eduard on 6 Nov („aprob T71–T75”) and built in one PR (T72–T77, schema
102–107) following §4, which replaces §2 for those stages.


1. Merge PR #107 (T65–T67).
2. M7 + M1 (plates, expenses with receipts) — the base the other stages use.
3. M3 (issues/incidents) + driver screens.
4. M2 (odometer, fuel, consumption).
5. M5 (quote changes, manager cancel).
6. M4 (maintenance).
7. M6 (notifications for all of the above).

Each one: its own branch from `main`, SQL tests (rights, isolation between companies, concurrency,
idempotency), unit tests, browser tests at 390/820/1440 in RO and EN, a PR with „Pașii tăi”.


## 4. Final plan for M2–M6 and migration 107 (approved by Eduard, 6 Nov 2026)

This section replaces §2 and §3 for M2–M6 and adds migration 107. Base: `main` at schema 101. One branch,
`t71-fleet-stages`, one PR; migrations 102–107 in this order: M3 (102), M2 (103), M5 (104), M4 (105),
M6 (106), money visibility (107), each a separate file with a tested rollback in `supabase/rollback/`.
PRs deploy only to the TEST project. **No existing data is modified by this delivery.**

### Eduard's decisions (6 Nov 2026)

1. Maintenance: „soon” at 1,000 km / 30 days. A reading older than 60 days, or dated before the last
   maintenance, is never used → `insufficient_data`. Never a false „ok”.
2. Manager cancel: refused after the slot start time, even when the shop has no cancel deadline.
3. Read-only company (expired plan): admin, manager, `quotes.approve` may only cancel existing bookings.
4. An odometer step over 2,000 km/day is an anomaly „de verificat”, not proof of a wrong value.
5. Durable outbox (A), photo protection and cleanup (B), money visibility as migration 107 (C) — accepted.
6. Money visibility: the row-level variant. Only what a driver without `costs.view` can see on company
   bookings changes; protected on the server on every access path.
7. Failed fleet notifications: a count in the admin digest, a list of failed events and a retry —
   without access to the fleets' private data.
8. Rights changes: checked on the server at every operation; open screens read again when they change.
9. Real project on 6 Nov: 0 receipts with an odometer, 0 system messages with amounts → the M2 import
   creates nothing there; the historical message rewrite is dropped.

### M3 — issues and incidents (102)

`fleet_issues` (id from the app = photo folder; vehicle label at report time; kind defect/damage/accident/
technical/other; title 3–120; description ≤ 2,000; day not in the future; status new → in_review →
scheduled → resolved → closed; booking link; ≤ 6 photos) and `fleet_issue_events`. `fleet_report_issue`,
`fleet_update_issue` (`issues.manage`), `fleet_issue_detail`. Report: `issues.manage`, or `issues.report`
on a vehicle the member sees (a driver: their own). Read: reporter while a member, the vehicle's driver,
`issues.manage`, `vehicles.viewAll`. Title and description stay as reported.

Photos `<company>/<vehicle>/issues/<issue>/<file>`; the three M1 policies replaced by variants branching
on the path (receipts keep the M1 expressions). Before the report only the uploader; after it the
report's readers; delete by `issues.manage`. Attach: own upload, ≤ 23 h old (`photo_expired`). Cleanup:
`fleet-files-cleanup` daily (pg_cron 03:23 UTC through `kick_fleet_files_cleanup`), candidates from
`fleet_issue_photo_orphans` (exact issue paths, > 48 h, unattached), re-checked before each delete.
The 14 photo scenarios of the plan: tests 1–12 in `tests/sql/144_fleet_issues.sql`, 13–14 in
`tests/unit/fleetFilesCleanup.test.ts`.

### M2 — odometer and fuel (103)

`fleet_odometer_readings`, `fleet_odometer_ignored_jobs`, `fleet_odometer_import_exceptions`. Rule: a
reading for day D ≥ the highest km before D and ≤ the lowest km after D; same day not compared; evidence
= readings + finished jobs of that vehicle minus ignored jobs (`odometer_lower`,
`odometer_higher_than_later`). Expenses keep their reading in step. `fleet_add_reading` (`vehicles.manage`
or the vehicle's driver), `fleet_correct_reading` (`vehicles.manage`, reason, before/after; a reading of
an expense is corrected on the expense too), `fleet_ignore_job_odometer`, `fleet_fuel_stats`. Import
(`fleet_import_expense_readings`, run once by the migration): a receipt becomes a reading only when
consistent; otherwise listed with `below_earlier`, `above_later`, `jump`; both sides of a contradiction
listed; receipts never modified.

### M5 — quote changes and manager cancel (104)

`company_quote_decisions_decision_check` widened with `changes_requested` (dropped without IF EXISTS),
column `reason`. `fleet_cancel_booking(booking, reason, request)` and
`fleet_request_quote_changes(booking, quote, reason, request)` as in the plan.

### M4 — maintenance (105)

`fleet_maintenance` and `fleet_maintenance_status` (rules in decision 1, reasons `no_last_done_km`,
`no_last_done_on`, `no_reading`, `reading_old`, `reading_before_service`), `fleet_save_maintenance`,
`fleet_delete_maintenance`, `fleet_mark_maintenance_done` (a day and km writes a reading under the M2
rule; a finished job of that vehicle is offered, never automatic).

### M6 — fleet notifications with a durable outbox (106)

`fleet_events` (written by triggers on quotes, bookings, company_quote_decisions, fleet_issues,
fleet_expenses and by the daily part; references only), `fleet_notices` (unique per user and key),
`process_fleet_events()` every minute (claim committed first; one event per transaction; retries after
1, 5, 15, 60 minutes, then hourly; `failed_at` after 24 attempts), recipients by `fleet_user_can` among
current accepted members, actor excluded, amounts only for `costs.view`. Daily part `fleet_daily` at 10:xx
(documents at 30/7/0 days, maintenance soon/overdue, purge after 90/400 days). Admin:
`admin_list_failed_fleet_events` (no data, no error text, no vehicle, person or amount),
`admin_retry_fleet_event`, digest counts `fleet_failed` and `fleet_gave_up`. `member_rights_versions`
(realtime) bumped by membership, role, rights and plan changes.

| Event | Key | Recipients (actor excluded) |
|---|---|---|
| fleet_quote_waiting | `quote_waiting:<quote>` | `quotes.approve`, minus the booker |
| fleet_quote_decided | `quote_decided:<quote>` | booker + vehicle driver |
| fleet_quote_changes | `quote_changes:<quote>` | booker + approvers |
| fleet_booking_changed | `booking_changed:<booking>:<txid>` | vehicle driver if not the booker |
| fleet_booking_cancelled | `booking_cancelled:<booking>` | booker + driver |
| fleet_issue_reported | `issue_reported:<issue>` | `issues.manage` |
| fleet_expense_to_check | `expense_to_check:<expense>` | `costs.manage` |
| fleet_doc_expiring | `doc:<vehicle>:<doc>:<expiry>:<30/7/0>` | `vehicles.manage` + driver |
| fleet_maintenance_due | `maint:<item>:<last_done_on>:<last_done_km>:<soon/overdue>` | `vehicles.manage` + driver |

### 107 — quote money visibility, row-level

For a company booking, a member without `costs.view` in that company cannot obtain amounts through any
path; personal bookings, shops and platform admins unchanged. Paths and fixes (numbered as in the audit):
1 `bookings_select` (company row to its client only with `costs.view`; `my_company_bookings()` without
amounts), 2 realtime follows RLS (refresh on the booking's thread messages), 5–6 the four client RPCs
answer `cost = null` (replays too), 7 `export_my_data`, 8 `job_document_data` refused, 9 `report_jobs`
filtered, 10 `post_booking_event` without money keys for company bookings, 11 `notify_user` without money
keys for such recipients (texts without amounts), 12 quote policies through `can_read_booking_money`.
Unchanged (tested): fleet reads with `p_money`, shop and admin RPCs. Invariant tested: every holder of
`bookings.viewAll` has `costs.view`; the accountant always has it.

### Implementation notes (T72–T77)

- Task numbers: T71 was already used (language in Cont), so the stages are T72 (M3), T73 (M2), T74 (M5),
  T75 (M4), T76 (M6), T77 (107). The branch keeps the approved name `t71-fleet-stages`.
- Error codes: the existing `wrong_status` (with the status) is used where the plan wrote
  `invalid_status`; a started booking answers `booking_started`. New codes: `issue_invalid`,
  `issue_not_found`, `photo_expired`, `odometer_higher_than_later`, `reading_invalid`,
  `reading_not_found`, `changes_already_requested`, `maintenance_invalid`, `maintenance_not_found`,
  `fleet_event_not_found`.
- The manager's cancel writes the thread message `booking_cancelled_company` („Firma a anulat
  programarea …” for the client side); the shop gets `booking_cancelled_client` with the reason, as planned.
- 107 wraps the functions it changes (`cancel_booking`, `decide_quote`, `reschedule_booking`,
  `set_booking_history_share`, `export_my_data`, `job_document_data`, `report_jobs`): the previous
  versions are renamed `…_t77` and called unchanged, so the rollback renames them back.
- Rollbacks: `supabase/rollback/<migration>.sql`, run only in reverse order; `npm run test:rollback`
  builds the database up to the previous migration with the demo seed, applies the migration and its
  rollback, and compares structure (privileges included) and every row byte for byte, then applies the
  migration again.
- pg_cron: `call public.process_fleet_events()` verified on the local Supabase stack (`succeeded`).
- Concurrency (two real sessions): `tests/sql/149_fleet_concurrency.sql` (two cancels, two expenses, a
  worker killed mid-event, two workers at once).
- Not verified from the development container: that `supabase db push` applies each file in its own
  transaction on the TEST project (the CLI's documented behavior); check on the first deploy.
