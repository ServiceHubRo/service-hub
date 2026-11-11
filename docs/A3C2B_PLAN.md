# A3c2b — Retention of support data and of the team's log: final specification

Status: **specification only, waiting for Eduard's approval. Nothing here is implemented.** No file in
`supabase/migrations/` comes from this document, so "Deploy Supabase" cannot apply any of it. The
privacy policy files are unchanged.

Written 11 Nov 2026, after Eduard's answers of the same day (below). It builds on A3c2a (PR #119,
migration `legal_hold`, schema 114), which is not merged yet.

## 0. Eduard's decisions (11 Nov 2026)

| # | Decision |
|---|---|
| 1 | Suggestions: after 12 months the text waits **30 days** for a human confirmation. Not confirmed by then → the original text is deleted automatically; only the agreed anonymous statistics stay. |
| 2 | **An authorised support agent or an admin** may confirm. Every confirmation is in the log with the user, date and time. Existing permissions and least privilege stay. |
| 3 | Requests: deleted after **12 months without real activity, whatever their state**. An active legal hold is the mandatory exception. The automatic closing after 14 days does **not** extend the period. |
| 4 | Admin log: **3 years**, not unlimited. Entries protected by a legal obligation or a legal hold are exempt. The 3 years must be **validated legally** before the privacy policy changes. |
| 5 | Old log entries: analysed in A3c2b2. First **identify and count** the entries holding names, emails or values that could be secrets, and report numbers and types. **No existing entry is changed or deleted** before a separate explicit approval. |
| 6 | Two PRs: **A3c2b1** (real activity, request retention, suggestion anonymisation, preview, controlled activation of the jobs) and **A3c2b2** (log classification, support-log retention, secret protection, log correction at account deletion). |
| + | The account code kept in the log after an account is deleted is **not** automatically anonymous; check indirect identification and treat it as pseudonymised data. Jobs start **disabled**; the preview has **no effect on data** and shows the **exact** numbers, exceptions included; only an **admin** turns a job on. No privacy-policy change before Eduard approves the full RO + EN text. No change to historical data without a separate approval. No real deletion in tests or production without the matching approval. Everything approved in A3c2a stays. |

## 1. What the code does today (audit, 11 Nov)

- `suggestions` has `created_at`, `updated_at`, `last_user_message_at`, `last_staff_message_at`,
  `resolved_at`, `closed_at`. The daily `close_resolved_support_requests` (03:17) sets `closed_at` and
  `updated_at`: neither column can measure real activity.
- `notification_events` keeps `{request_id, title}` of `support_reply` / `support_resolved` /
  `support_escalated` with no end date (the title of an old suggestion is the start of its text).
- `request_log` (idempotency) is purged after 7 days: nothing to add.
- `admin_audit_log` has no retention and holds, among others:
  - `delete_account`: `name`, `email`, and for a shop `shop_name`, `city` of the deleted account;
  - `verify_phone_manually`: the phone number (before and after);
  - `support_search`: the agent's search words (`after.q`: names, emails, phones);
  - `open_request_file`: the file name, which may contain a name;
  - `auto_suspend_account`, `auto_no_trial`: `matched` (which fingerprint matched; to be checked in the
    report, §4.6);
  - `actor_display_id` and `entity_id` of every row.
- **The account code (`C-00012`, `S-00003`) is not anonymous after deletion.** It also appears in the
  emails sent to the person (their mailbox links code and address), in Stripe metadata of a shop
  (`account`), in invoices and in `legal_hold_subjects` while a hold exists. Anyone holding one of those
  can re-identify the person. Conclusion: **a kept account code or account UUID is pseudonymised personal
  data**. It stays under the log retention below, only the admin reads it, and the privacy policy says so.

## 2. Order and dependencies

```
#119 A3c2a (schema 114)  ──merge──►  A3c2b1 (schema 115)  ──merge──►  A3c2b2 (schema 116)
                                                                         │
                                                                         ▼
                                     report on the real project (read-only, run by Eduard)
                                                                         │ separate approval
                                                                         ▼
                                                        A3c2b3: correction of old log entries
```

- A3c2b1 starts from `main` **after #119 is merged**: it uses `legal_holds`, `legal_hold_covers*`,
  `former_author_id`, `legal_hold_apply_rules` and `text_has_secret`.
- A3c2b2 starts after A3c2b1 is merged: it reuses the job switches, the preview pattern and the run log.
- **A3c2b3** (new, outside A3c2b2): only if Eduard approves it after reading the report. Until then the
  log jobs never touch an entry written before the A3c2b2 migration (§4.4).
- If #119 changes before merge, this plan is checked again before A3c2b1 starts.

## 3. A3c2b1 — Real activity, request retention, suggestion anonymisation, jobs

### 3.1 Real activity

**Definition (decision of this plan, to confirm):** an action of a signed-in person that changes what
the author sees in the conversation or the state of the request:

| Counts (moves the 12 months) | Does not count |
|---|---|
| the request is created | opening or reading it (team or author, `author_read_at`) |
| a message from the author or from the team | the daily automatic closing after 14 days |
| a file sent with a message | internal notes, taking, assigning, escalating, returning |
| a state change made by a person (reopening included) | placing, reviewing or releasing a legal hold |
| | any job, migration, Edge Function or service-key action |

Internal notes do not count, so the team alone cannot keep a request alive indefinitely; a request that
must be kept for a legal reason gets a legal hold (A3c2a).

**Implementation:**
- New column `suggestions.last_activity_at timestamptz` (nullable, default `now()` for new rows).
  **No backfill**: existing rows keep `null`, no existing value is written.
- Triggers move it to `clock_timestamp()` only when `auth.uid()` is not null (the same rule as the
  A3c1 signals): after insert on `suggestion_messages`; when a file of `suggestion_files` is attached to
  a sent message; before update of `status` on `suggestions`.
- `support_activity_at(s suggestions) returns timestamptz` (stable): `last_activity_at` when set;
  otherwise, for rows written before A3c2b1, the latest of `created_at`, `last_user_message_at`,
  `last_staff_message_at`, `resolved_at`, the latest sent file, and the latest `set_request_status` /
  `update_suggestion` / `reply_request` audit entry for that request made by a person. `closed_at` and
  `updated_at` are never used.
- Eligible: `support_activity_at(s) + interval '12 months' <= p_now` (calendar months, Europe/Bucharest
  irrelevant because both sides are `timestamptz`; 29 Feb + 12 months = 28 Feb, tested).

### 3.2 Job switches, preview, runs (shared with A3c2b2)

- `retention_jobs` — `key` (pk), `enabled boolean not null default false`, `batch_size int` (1–500,
  default 50 for the first activation), `changed_by`, `changed_at`, `reason`, `enabled_counts jsonb`
  (the preview numbers confirmed at activation). Seeded **disabled**: `support_requests`,
  `suggestions` (A3c2b1); `support_log`, `admin_log` are added by A3c2b2. RLS on, no policy, no grant to
  anybody; read and written only by the functions below. A trigger refuses `enabled = true` written by
  anything other than `admin_set_retention_job` (a direct SQL update in the dashboard is the only way
  around it, and only to switch **off**, §3.9).
- `retention_runs` — `id`, `job`, `started_at`, `finished_at`, `counts jsonb`, `failed int`,
  `remaining int`, `error text`. Only numbers, never ids or text.
- **Preview** `admin_retention_preview(job)` — admin, aal2. Declared `stable`: PostgreSQL itself refuses
  any write inside it, so it cannot change data (tested). It returns the exact numbers the next run
  would act on, **with the exceptions**, plus the date the next rows become eligible. It writes nothing,
  not even an audit row.
- **Activation** `admin_set_retention_job(job, enabled, reason, batch_size, expected jsonb, request_id)` —
  admin only, aal2, reason 10–500 characters (refused with `secret_in_text` like A3c2a). To switch
  **on**, `expected` must equal the preview computed again inside the function; if anything changed
  since the admin looked, it answers `preview_changed {counts}` and changes nothing. Switching **off**
  needs only a reason and works at once. Audit row `set_retention_job` with job, on/off, batch size and
  the confirmed numbers. Agents, clients, shops: `not_allowed`.
- **Runs**: each job has one `run_*` function (no grant; `pg_cron` only). Disabled → it returns at once,
  writes nothing (not even a run row). Enabled → it takes at most `batch_size` rows, oldest first, each
  `for update skip locked`, checks the rule again after the lock (activity and hold may have changed),
  acts on each row in its own sub-transaction (a refused or failing row is counted in `failed` and does
  not undo the others), then writes one `retention_runs` row and one audit row `retention_run` (job and
  numbers only). What is left waits for the next day (`remaining`).
- Schedule: `sh_support_retention` 03:47, `sh_suggestion_anonymization` 03:53 (after the closing at
  03:17 and the files at 03:37). The cron entries exist from the migration; the switch decides.

### 3.3 Request retention (job `support_requests`)

Scope: every request whose category is not `suggestions`, **any state** (new, in progress, waiting,
escalated, resolved, closed), eligible per §3.1, not covered by an active legal hold (request or
account).

One request, in one sub-transaction:
1. Its contribution is added to `support_stats_monthly` (§3.5).
2. Deleted: the request, its messages, internal notes, file rows (Storage paths queued in
   `support_file_deletions`, removed by `support-files` after the commit, as in A3b/A3c2a), its signals,
   and every `notification_events` row whose `params->>'request_id'` is the request (processed or not).
3. The A3c2a guards stay: a held row makes the delete fail → counted as `failed`, nothing of that
   request deleted.

Preview numbers: requests by state; messages; notes; files and Storage objects; notification events;
statistics rows touched; **exceptions**: held by a request hold, held by an account hold, kept after an
account deletion (A3c2a); rows locked at preview time (normally 0); next eligible date.

Requests of a shop anonymised with history (A3c2a "Decizii") follow the same rule.

### 3.4 Suggestion anonymisation (job `suggestions`)

Scope: requests in category `suggestions`, eligible per §3.1, not held.

**Step 1 — at 12 months (one sub-transaction per suggestion):**
- A row in a new table `suggestions_anonymous`: a **new random id** (never the old one), `created_month`
  (first day of the month), `author_role`, `final_status`, `pending_text` (the original text),
  `proposed_text` (the text with every finding masked, e.g. `[email]`, `[telefon]`), `findings`
  (number per kind), `review_due_at = step-1 time + 30 days`, `text_state = 'pending'`.
- The original suggestion is deleted with its messages, notes, files and notification events, exactly as
  §3.3. From this moment nothing links the text to an account: no author, shop, booking, request id or
  exact date.
- No audit row names both ids.

**Step 2 — human confirmation, within 30 days (§0 decisions 1 and 2):**
- Detector `suggestion_text_findings(text)` (immutable): emails, Romanian phone numbers, license plates
  (county + digits + letters), VINs, booking references (`P-000123`), account codes (`C-`/`S-`/`A-`/
  support), report codes (`SH-…`), IBANs, CNPs (checksum), card numbers (Luhn), URLs, and everything
  `text_has_secret` finds. Names cannot be detected reliably: the reviewer must read the text.
- `support_list_suggestion_reviews()` and `support_review_suggestion_text(id, action, text, request_id)`
  — agent or admin through the existing `require_staff` (active, aal2, live session; a withdrawn agent
  is refused at once). Actions:
  - `confirm` — keeps `proposed_text`;
  - `edit` — keeps the reviewer's text, accepted only if the detector and `text_has_secret` find
    nothing in it and it is not longer than the original;
  - `remove` — keeps no text.
  The original text (`pending_text`) is deleted in the same transaction. Audit row
  `review_suggestion_text`: who (role and code, added by the existing trigger), when, the action, the
  number of findings; never the text, never the anonymous row's id.
- Clients and shops: no access. Agents see these rows only through these two functions.

**Step 3 — at 30 days without confirmation:** the same job sets `pending_text = null`,
`proposed_text = null`, `text_state = 'expired'`. Only `created_month`, `author_role`, `final_status`
remain. A confirmation after the term answers `review_expired`.

Preview numbers: suggestions entering review (with the number of findings per kind); reviews expiring
(text deleted); reviews open (and how many expire within 7 days); **exceptions**: held suggestions.

### 3.5 Anonymous statistics

`support_stats_monthly` — `month`, `category`, `author_role` (unique together): requests deleted,
created in that month, resolved, escalated, sum and count of minutes to the first answer, sum and count of
minutes to resolution. No id, no text, no person. RLS on, no grant; `admin_support_stats(from, to)`
(admin) reads them. These are the "statistici anonime stabilite" of decision 1 and 3.

### 3.6 Legal hold release (A3c2a) and retention

`legal_hold_apply_rules` (A3c2a) is replaced to also apply §3.3 and §3.4 step 1 to the released requests
**only when the matching job is enabled**. When it is disabled, nothing happens at release beyond what
A3c2a already does; the job acts once the admin enables it. The release result adds the numbers.

### 3.7 Screens

- **Admin → Platformă → Retenția datelor** (`/admin/platforma/retentie`): one card per job — state
  (Dezactivat / Activ, by whom, when, why), the last run (date, numbers, failed, remaining) —, buttons
  "Previzualizează", "Activează" (inline panel: the exact numbers and exceptions, batch size, reason,
  "Confirm numerele"), "Dezactivează" (inline panel with reason). `preview_changed` shows the new numbers
  and asks again. Panou → Suport shows a line only when a job failed rows.
- **Solicitări → Sugestii de verificat** (agent `/suport/sugestii-de-verificat`, admin
  `/admin/suport/sugestii-de-verificat`): the list with days left (amber under 7 days, always in words),
  the original text with the findings marked, the proposed text, and "Confirmă textul propus",
  "Editează și confirmă", "Șterge textul" (inline confirm). A counter "Sugestii de verificat" in the
  support dashboard (A3c1).
- Nothing changes on client or shop screens.
- All strings in `ro.ts` / `en.ts`, following `docs/EDITORIAL.md` and the glossary.

### 3.8 Tests (local disposable database only)

SQL `tests/sql/156_support_retention.sql`:
- every real activity in §3.1 moves `last_activity_at`; every "does not count" item does not, the
  14-day closing included;
- legacy rows (null) are read through the fallback; `closed_at` / `updated_at` never decide;
- limits: 12 months minus 1 minute vs exactly 12 months; 29 Feb; 30-day review term at the minute;
- jobs are disabled after the migration; a disabled run changes nothing (full digest of every table
  before and after) and writes no run row;
- the preview changes nothing (full digest), cannot write (a `stable` function attempting a write
  fails), and its numbers equal exactly what the following run does, exceptions included;
- only an admin with aal2 enables/disables; agent, client, shop, anonymous, admin without aal2:
  refused; reason required and checked for secrets; `preview_changed` when data changed; audit rows;
  a direct `update retention_jobs set enabled = true` refused;
- holds (request, account, kept after deletion) are skipped and counted; release with the job on applies
  the rules at once, with the job off does nothing more than A3c2a;
- a deletion removes messages, notes, files (Storage queue), signals, notification events of that
  request and **nothing else** (digest of every other table);
- statistics: correct sums, no column able to hold an id or a text;
- suggestions: new id, no link anywhere (audit included); detector cases (each kind, false positives on
  ordinary numbers and prices); confirm/edit/remove by an agent and by an admin; edit with an email
  refused; client, shop, agent without aal2, withdrawn agent refused; expiry at 30 days; confirmation
  after expiry refused; audit has who/when/action and no text;
- batch size respected; one failing row does not undo the others; a concurrent author reply wins over
  the job (two sessions, the row stays and its activity moves);
- every mutating RPC is idempotent (`p_request_id`).

Unit: the detector's labels and masks in both languages; editorial test; no privileged key in the app.
Browser (`tests/e2e/retention.spec.ts`, `tests/e2e/suggestion-review.spec.ts`; 390/820/1440, RO and
EN; local Supabase stack): preview, activation with changed numbers, deactivation; the review list as
agent and as admin; agent without aal2 and client refused.

**No test runs against the Supabase test project or the real one.** Every deletion in tests is of rows
the test itself created in a local, throw-away database. On the PR's preview the jobs stay disabled;
"Cum testezi" uses only the preview and the review list.

### 3.9 Migration and rollback (A3c2b1)

- Migration `<timestamp>_support_retention.sql`, schema **115**, `EXPECTED_SCHEMA_VERSION = 115`. Adds
  one nullable column, the new tables, functions, triggers and two cron entries; replaces
  `legal_hold_apply_rules`, `support_dashboard`, and the A3a functions that must leave the conversation's
  triggers in place. **No existing row is written** (checked by a full before/after comparison, as in
  A3c2a).
- Rollback `supabase/rollback/<timestamp>_support_retention.sql`: **refuses to run** (and says how many)
  while any `retention_runs` row with an effect, `support_stats_monthly` row or `suggestions_anonymous`
  row exists — those cannot be put back and the statistics would be lost; otherwise drops everything new
  and restores the A3c2a functions, schema 114. Tested with `npm run test:rollback`.
- **Emergency stop** (for Eduard, in Supabase → SQL Editor, real project):
  `update public.retention_jobs set enabled = false;` — allowed directly (switching off only), takes
  effect for the next run.
- **What cannot be undone:** a deletion done by an enabled job. Protections: disabled by default,
  exact preview confirmed at activation, first batch 50 per day, the run log, the stop above. Before the
  first activation on the real project, check that Supabase shows a recent backup (Database →
  Backups); a restore is only for a bug, followed by the deletion again.

## 4. A3c2b2 — Log classification, support-log retention, secrets, account deletion

### 4.1 Classification (no write to existing rows)

- `audit_action_classes(action pk, class)` — classes and periods:

  | Class | Actions (examples) | Kept |
  |---|---|---|
  | `support` | `support_search`, `support_view_account`, `support_view_request`, `open_request_file`, `take_request`, `assign_request`, `reply_request`, `add_request_note`, `set_request_status`, `escalate_request`, `return_request`, `review_suggestion_text` | 12 months; the search words (`after.q`) 90 days |
  | `admin` | settings, prices, plans, notices, reviews removed, shops verified, `grant_support`, `revoke_support`, `delete_account`, `set_retention_job`, `retention_run` | 3 years (**to validate legally**) |
  | `security` | `auto_suspend_account`, `auto_no_trial`, `verify_phone*`, `promote_to_admin` | 3 years (to validate) |
  | `legal` | `place_legal_hold`, `review_legal_hold`, `release_legal_hold`, `view_legal_hold` | while the hold is active, then 3 years after release (to validate) |

- The class is read through a join on `action`; **no column is added to old rows and no old row is
  written**. An action missing from the table counts as `admin` (the longer period) and a unit test fails
  until it is classified (the test lists every action written by any migration).
- Exempt from every job: rows about a request or an account covered by an active legal hold (A3c2a
  coverage functions); rows of class `legal` while their hold is active.

### 4.2 Retention jobs (disabled, same switches, preview and run log as §3.2)

- `support_log`: removes `after.q` from `support_search` rows older than 90 days; deletes `support` rows
  older than 12 months.
- `admin_log`: deletes `admin` and `security` rows older than 3 years and `legal` rows 3 years after the
  release. **Stays disabled until the 3 years are validated**; the first rows reach 3 years in
  September 2029.
- **Cutoff:** both jobs act only on rows written at or after the A3c2b2 migration
  (`audit_retention_cutoff()`, a constant written into the migration). Only a later migration (A3c2b3,
  after Eduard's separate approval) can include older rows; no admin switch can.
- Preview: rows per action and per class to delete, search words to remove, exceptions (held, `legal`
  class active, **older than the cutoff**), next eligible date.

### 4.3 Secrets in the log (forward only)

- `before insert` trigger on `admin_audit_log`: walks `before` and `after` (nested objects and arrays)
  and removes every key whose name looks like a secret (`password`, `parola`, `token`, `secret`,
  `api_key`, `private_key`, `otp`, `totp`, `recovery`, `authorization`, `cookie`, `session`, `iban`,
  `card`, `cvv`, case-insensitive) and every string value `text_has_secret` flags; the same for
  `reason`. It never refuses (the admin's action must not fail because of the log); it replaces the value
  with `[eliminat]` and lists the paths in a new column `redacted text[]` (null on old rows).
- Ordinary ids (`display_id`, `file_id`, `request_id`, `message_id`) are not touched (tested).
- Today nothing writes a secret into the log (audit 11 Nov); this protects future code.

### 4.4 The log at account deletion (forward only)

- New `delete_account` entries keep only `display_id`, `role` and, for a shop, the `city`; no name, email
  or shop name.
- `support_file_open` stops writing the file name (the `file_id` stays; the admin's "who opened" list
  joins on it while the file exists).
- When an account is deleted (the A3c2a `profiles_support_on_delete` path, so every route), the log rows
  written **after the cutoff** that concern it (its id or its shop's id as entity, or its email or phone as
  a value) lose `name`, `email`, `phone`, `shop_name` and search words matching its email or phone; the
  paths go into `redacted`. Exception: an account under an active legal hold — nothing changes (the
  identifiers are kept in `legal_hold_subjects`, A3c2a).
- The remaining account code / UUID is **pseudonymised data** (§1): only the admin reads the log, and it
  goes with the periods of §4.1.

### 4.5 Report on the existing log (read-only; decision 5)

- `admin_audit_privacy_report()` — admin, aal2, `stable` (cannot write). For every row (old ones
  included) it counts, per `action` and per kind: names (keys `name`, `shop_name`, `admin_name` holding a
  value, since a deleted account's name can no longer be compared with its profile), emails
  (pattern), phone numbers (pattern), search words, file names, values `text_has_secret` flags, rows of a
  deleted account (entity id no longer in `profiles`), and the date range. **Only numbers, never a
  value.**
- Shown on Admin → Platformă → Jurnal ("Raport date personale"), and the same query handed to Eduard as
  a read-only SQL for the SQL Editor.
- Eduard runs it on the real project after A3c2b2 is merged, sends the numbers, and decides. Only then
  A3c2b3 (a migration that corrects or deletes old rows, with its own preview and approval).

### 4.6 Tests (A3c2b2)

SQL `tests/sql/157_audit_retention.sql`: every action written by any function has a class (the test reads
the function sources from `pg_proc`); no old row is written by the migration (digest); the scrub trigger
on nested keys, arrays, `reason`, with no false positive on ids; `redacted` paths; the jobs disabled by
default; the preview read-only and exact; the cutoff (a row one second older than the cutoff is never
touched, even with the job on); 90 days for `after.q` and 12 months for `support` rows at the limit;
held rows exempt; account deletion: new `delete_account` without name/email, older-than-cutoff rows
unchanged, newer rows scrubbed, held account unchanged; the report's numbers on known fixtures and its
`stable` guarantee; only an admin with aal2 runs the report and the switches. Unit
`tests/unit/auditClasses.test.ts` (every action literal in `supabase/migrations` is classified). Browser
`tests/e2e/audit-retention.spec.ts` (390/820/1440, RO and EN).

### 4.7 Migration and rollback (A3c2b2)

- Migration `<timestamp>_audit_log_retention.sql`, schema **116**. Adds `audit_action_classes`,
  `admin_audit_log.redacted` (nullable, no default value written), the trigger, the cutoff, the two jobs
  (disabled), the report, and replaces the account-deletion and file-opening functions. No existing row is
  written.
- Rollback: **refuses** while a log job has had an effect or a row has `redacted` set (that information
  would be lost); otherwise drops everything new and restores the previous functions, schema 115.
- Emergency stop: the same SQL as §3.9.

## 5. First effects in time (if Eduard enables the jobs)

| Job | First rows eligible |
|---|---|
| Requests (`support_requests`) | from 7 Nov 2027 (A3a requests started 7 Nov 2026) |
| Suggestions (`suggestions`) | from 17 Oct 2027 (T26); the text then waits 30 days |
| Search words (`support_log`) | 90 days after the A3c2b2 migration (older words: only after A3c2b3) |
| Support log rows | 12 months after the A3c2b2 migration |
| Admin log (`admin_log`) | 3 years after the A3c2b2 migration; stays off until the legal validation |

## 6. Privacy policy — proposed text (NOT applied; the files stay unchanged until Eduard approves)

It adds to the A3c2a text (still pending in #119). Recommended: one new policy version once A3c2a and
A3c2b1 are approved, and the log paragraph after the legal validation of the 3 years (A3c2b2).

### RO

**§3, rândul „Solicitările trimise echipei Service-Hub…” — formulare nouă:**
> | Solicitările trimise echipei Service-Hub, fișierele atașate și jurnalul celor care le deschid; statistici anonime despre suport | Contractul cu tine (lit. b); interesul legitim (lit. f) ca accesul la datele tale să poată fi verificat și ca suportul să poată fi îmbunătățit |

**§4.2, după fraza despre jurnalul agenților:**
> Agenții de suport și administratorul verifică, înainte de păstrarea anonimă, textul sugestiilor mai vechi de 12 luni (secțiunea 5). Codul contului rămas în jurnal după ștergerea contului îl vede doar administratorul.

**§5, puncte noi (după punctul despre păstrarea legală din A3c2a):**
> - **Solicitările de suport:** se șterg la 12 luni după ultima activitate (un mesaj al tău sau al echipei, un fișier trimis sau o schimbare a stării), indiferent dacă solicitarea este deschisă sau închisă. Închiderea automată a unei solicitări rezolvate nu prelungește termenul. Se șterg textul, mesajele, notele echipei, fișierele atașate și notificările legate de solicitare. Rămân doar statistici anonime (de exemplu, numărul de solicitări pe lună și categorie și timpii medii de răspuns), din care nu poți fi identificat. Excepție: solicitările aflate sub păstrare legală.
> - **Sugestiile:** la 12 luni după ultima activitate, sugestia se desparte de contul tău: se șterg legătura cu contul, cu service-ul și cu programarea, conversația, notele și fișierele. Textul este verificat în cel mult 30 de zile de un agent de suport sau de administrator, care elimină orice informație care te-ar putea identifica (nume, email, telefon, număr de înmatriculare, serie de șasiu, coduri). Dacă textul nu este verificat în 30 de zile, se șterge. Rămân doar textul verificat, luna, tipul contului și starea sugestiei, fără nicio legătură cu tine.
> - **Jurnalul echipei de suport:** cuvintele căutate de agenți se șterg după 90 de zile; celelalte înregistrări ale activității de suport (căutări, deschideri de conturi, solicitări și fișiere, răspunsuri) se șterg după 12 luni.
> - **Jurnalul acțiunilor administrative:** 3 ani, cu excepția înregistrărilor necesare pentru o obligație legală sau pentru o păstrare legală în curs. *(Termenul de 3 ani așteaptă validarea juridică.)*
> - **Codul contului după ștergere:** după ștergerea contului, numele, emailul și telefonul tău nu mai apar în jurnale. Codul contului (de exemplu, C-00012) poate rămâne în jurnal pe durata de mai sus. Codul nu este anonim: împreună cu alte informații (de exemplu, un email primit de la noi) poate duce la tine, așa că îl tratăm ca dată pseudonimizată, vizibilă doar administratorului.

### EN

**§3, the row “Requests sent to the Service-Hub team…” — new wording:**
> | Requests sent to the Service-Hub team, attached files and the log of who opens them; anonymous support statistics | The contract with you (b); legitimate interest (f) in being able to check access to your data and in improving support |

**§4.2, after the sentence about the agents' log:**
> Before a suggestion older than 12 months is kept anonymously, a support agent or the administrator checks its text (section 5). Only the administrator sees the account ID left in the log after an account is deleted.

**§5, new items (after the legal hold item from A3c2a):**
> - **Support requests:** deleted 12 months after the last activity (a message from you or from the team, a file sent or a change of state), whether the request is open or closed. The automatic closing of a resolved request does not extend this period. The text, messages, the team's notes, attached files and the notifications about the request are deleted. Only anonymous statistics remain (for example, the number of requests per month and category and average response times), which cannot identify you. Exception: requests under legal hold.
> - **Suggestions:** 12 months after the last activity, the suggestion is separated from your account: the link to your account, shop and booking, the conversation, notes and files are deleted. Within 30 days a support agent or the administrator checks the text and removes anything that could identify you (name, email, phone, license plate, VIN, codes). If the text is not checked within 30 days, it is deleted. Only the checked text, the month, the account type and the suggestion's state remain, with no link to you.
> - **The support team's log:** the words searched by agents are deleted after 90 days; the other records of support activity (searches, opened accounts, requests and files, replies) are deleted after 12 months.
> - **The log of administrative actions:** 3 years, except records needed for a legal obligation or an ongoing legal hold. *(The 3-year period awaits legal validation.)*
> - **Your account ID after deletion:** after your account is deleted, your name, email and phone no longer appear in the logs. The account ID (for example, C-00012) may stay in the log for the periods above. It is not anonymous: combined with other information (for example, an email you received from us) it can lead to you, so we treat it as pseudonymised data, seen only by the administrator.

## 7. Points to confirm before A3c2b1 starts

1. **Real activity** as in §3.1 (internal notes, assignment and escalation do not count).
2. **Requests that exist today** fall under the rule when they reach 12 months (first in November
   2027), once the admin enables the job with the exact preview. Proposed: the admin's activation with the
   confirmed numbers is the separate approval for those rows. The log is different: rows older than
   A3c2b2 are never touched without A3c2b3.
3. The **3 years** for the admin log stay "to validate"; the `admin_log` job stays off until then.
