# A3c2b3 — Audit of the historical logs (read-only) and cleanup proposal

Status: **audit done 12 Nov 2026, nothing changed. Eduard's decision (12 Nov): no A3c2b3 migration; the 7
legacy rows go with the launch reset (`docs/sql/reset_before_launch.sql`). §8 stays as the fallback, not approved.** No migration, no data change, no permission change in this stage.

## 0. What was checked, and how

| Check | Result |
|---|---|
| A3c2b1 (#120) and A3c2b2 (#121) merged on `main` | yes, `main` = `5e43f42` |
| "Deploy Supabase" on `main` after #121 | success, 12 Nov 2026 04:20 UTC → the real project has schema 116 |
| `npm run test:sql` (all migrations + every SQL test, 155–158 included) | passed, local throw-away Postgres |
| Unit tests `auditClasses`, `retention`, `legalHolds` | 15/15 passed |
| Inventory of every table / source that keeps history | static analysis of the 117 migrations + local DB catalogue |
| Read-only audit query `docs/sql/a3c2b3_audit_readonly.sql` | validated on a local DB with synthetic legacy rows (fake values) |
| Real-project numbers | **not available to Claude** (no access to the real database, by rule). Eduard runs the query. |

The audit query was proven harmless locally: a digest of every row of every `public` and `auth` table is
identical before and after it, and it also runs inside `begin read only` (where Postgres refuses any
write). Its output was checked to contain none of the fake names, emails, phones, IBANs, search words or
secrets planted in the fixture; every count matched the planted rows.

**The A3c2b2 cutoff on the real project is the deploy moment (12 Nov 2026, ~04:19 UTC).** Every log row
written before it is "legacy": no job touches it, and only an A3c2b3 migration can.

## 1. Sources of historical data

| # | Source | Personal data it can hold | Retention today | Covered by A3c2b1/b2 |
|---|---|---|---|---|
| A1 | `suggestions` (requests + suggestions) | title/body free text, author, shop, booking | 12 months after real activity (job, off) | yes |
| A2 | `suggestion_messages`, `suggestion_notes` | free text | with the request | yes |
| A3 | `suggestion_files` + Storage `support-files` | file name, content | 24 h unattached / 90 days after closing (daily) | yes |
| A4 | `support_signals` | ids only | with the request | yes |
| A5 | `notification_events` `support_*` | request id + title (start of the text) | with the request (job) | partly: orphans of requests deleted before A3c2a stay |
| A6 | `suggestions_anonymous`, `support_stats_monthly` | anonymised text / numbers | 30-day review | yes |
| B1 | `admin_audit_log` (classes support/admin/security/legal) | see §2 | new rows: by class (jobs off, admin_log locked); **legacy rows: none** | new rows only |
| B2 | `auth.audit_log_entries` (Supabase Auth) | email, IP address, sign-in events | none in the app (Supabase-managed) | no |
| B3 | `account_fingerprints` | hashes (phone, CUI, card, device) | 3 years after release (daily job) | own rule |
| C1 | `admin_audit_log` `support_search.after.q` | search words: names, emails, phones, plates | new rows: 90 days (job off); **legacy: none** | new rows only |
| C2 | `rate_events` `support_search` | agent id only | 2 days, purged lazily per subject | own rule |
| D1 | `legal_holds`, `legal_hold_reviews` | reason, reference, notes (free text) | no end (a hold record is evidence) | A3c2a |
| D2 | `legal_hold_subjects` | name, email, phone of a held subject | deleted at release | A3c2a |
| E1 | `notification_events`, `notifications_log` (all other events) | params (names, titles), error texts | **none** | no |
| E2 | `company_audit_log` | invited member emails, plates/VINs, vehicle data | **none** (with the company) | no |
| E3 | `signup_completions` (Google sign-up copy) | original email + sign-up metadata | with the login | no — see §8.4 |
| E4 | `auth.identities` | provider email, name | with the login | no — see §8.4 |
| E5 | `stripe_events` | Stripe payloads (customer email, address) | **none** | no |
| E6 | `request_log` | RPC results | 7 days (hourly) | own rule |
| E7 | `phone_verifications`, `fleet_events`, `engagement_log`, `push_subscriptions`, `history_reports`, `car_merges` | phone, snapshots | own rules or with the account | n/a |
| X | Supabase platform logs, Sentry, Resend, SMSO, Stripe dashboard, Netlify | IPs, emails, phones | provider-managed | **not verifiable from the repo** |

## 2. What the legacy admin log can contain (from the code that wrote it)

| Action (legacy rows) | Personal data | Consequence |
|---|---|---|
| `delete_account` | name, email, shop name of the **deleted** person | contradicts the A3c2b2 rule "after deletion no name/email in the log" |
| `verify_phone_manually` | the phone number (before/after) | stays after the account is deleted |
| `support_search` | the agent's search words (since A2, 7 Nov 2026) | the 90-day rule never applies to them |
| `open_request_file` | the file name (since A3b, 8 Nov 2026) | may contain a name |
| `update_shop` | changed shop fields **and billing diffs (IBAN, CUI, legal name, address)** | fiscal data of a person (PFA) for 3 years |
| `auto_suspend_account`, `auto_no_trial` | which fingerprint kinds matched (no value) | low |
| every row | `entity_id`, `actor_display_id` | pseudonymised data (A3C2B_PLAN §1) |

## 3. Retention: what can already be past its period

By construction, **no row can be past any period today**: the oldest table dates from 23 Sep 2026, the
support role (search words) from 7 Nov 2026, requests from 7 Nov 2026, suggestions from Oct 2026. The
query confirms it with `oldest_month` and the `past_*` / `older_than_*` counters (expected 0).

First dates when legacy rows would breach the policy **if nothing is done**:

| Legacy data | Breach from | Why |
|---|---|---|
| search words (`support_search.q`) | **~5 Feb 2027** (7 Nov 2026 + 90 days) | `support_log` job never touches rows before the cutoff |
| `support` class rows | ~7 Nov 2027 | same |
| `admin` / `security` rows | Sep 2029 | admin_log job locked until legal validation |

So there is no urgency to delete anything now; there is **one real deadline: 5 Feb 2027**.

## 4. Contradictions and issues found

1. **Legacy rows are outside every job** (by A3c2b2 design): search words, file names and the names/
   emails of deleted accounts written before 12 Nov stay forever unless A3c2b3 changes the cutoff.
2. **Plan vs implementation (A3c2b2 §4.3):** the plan listed `session`, `iban`, `card` among the key
   names stripped from new rows; the migration strips `password`, `token`, `secret`, `api_key`,
   `private_key`, `otp`, `totp`, `recovery`, `authorization`, `cookie`, `cvv`, `cvc` — **not `iban`,
   `card`, `session`**. Card numbers are still caught by value (Luhn); IBANs in `update_shop` billing
   diffs are kept. Likely deliberate (the billing change is evidence), but undocumented: needs a decision.
3. **"Possible secrets" counts are upper bounds:** an IBAN or another long digit string can pass the card
   checksum (seen on the fixture). A non-zero number needs a manual look at the action names, not an
   automatic deletion.
4. **Anonymised shop owners** (`removeLogin` mode `anonymize`): the login keeps `auth.identities`
   (provider email and name) and, for Google sign-ups, `signup_completions` (original email and metadata).
   The A3c2a/A3c2b2 deletion path does not clear them. Counted by the query.
5. **`company_audit_log`** keeps invited member emails and vehicle data with no retention and no scrub; it
   is visible to the company's admins and outlives a member's account. Not in the A3c2 scope.
6. **`notification_events` / `notifications_log`** have no retention at all outside support; support
   notifications of requests deleted before A3c2a (cascade) stay as orphans with the request title.
7. **`auth.audit_log_entries`** (Supabase Auth) keeps emails and IP addresses with no end inside the
   database; its retention is a Supabase setting, not app code.
8. Known A3c2b2 limit (unchanged): an account deleted directly in `auth.users` by SQL loses its log
   identifiers but not search words by its email.

No security defect found: every log table has RLS on and no browser grant except the admin reads through
`require_admin`; no code path writes a password, token or key into the log (11 Nov audit, re-checked).
Secrets can only come from free text typed by people (support texts, admin reasons); the query counts them.

## 5. Dependencies (before any cleanup)

- `admin_audit_log` has **no foreign keys** in or out; nothing cascades.
- Features that **read** it (deleting rows would break them; removing keys would not):
  - `admin_list_support_agents` — `grant_support` / `revoke_support` rows give "granted at" and the list of
    withdrawn agents;
  - `support_request_files` — `open_request_file` rows give "who opened which file" (joins on `file_id`, not
    on the name);
  - `audit_entries` (history on the admin account/shop pages) and `admin_list_audit` (Jurnal);
  - `support_initial_activity` — used once by the A3c2b1 migration only.
- Legal hold: rows about a held request/account and rows of an active hold must stay
  (`audit_row_held`, `legal_hold_has_subject`); `legal_hold_reviews → legal_holds` is `RESTRICT`.
- Requests: messages, notes, files, signals cascade from `suggestions`; held rows are protected by triggers
  (A3c2a), a delete of one aborts the whole transaction.
- Companies: `company_audit_log` cascades with the company; members' accounts set `actor_id` to null.
- Fiscal: `invoices`, `history_reports`, `shop_billing` are kept by law; nothing here touches them.

Deletion risks: breaks the features above, loses evidence (security incidents, disputes, legal holds),
irreversible. Anonymisation risks: low for the features (ids kept), irreversible for the removed values,
reduces the evidence value of an old `delete_account` row to "account C-000xx deleted on date".

## 6. Legal points to validate

1. The 3-year period for admin/security/legal rows (already pending).
2. Keeping, after deletion, the name and email of a deleted person in the legacy `delete_account` rows
   (GDPR art. 17: the proof of deletion needs only the account code and the date).
3. Keeping IBAN / fiscal diffs of a shop in the log for 3 years after the shop is anonymised.
4. Pseudonymised account codes kept in logs (A3C2B_PLAN §1) — privacy-policy text pending.
5. IP addresses and emails in Supabase Auth's own audit log — retention to set in Supabase.
6. `company_audit_log` member emails after a member leaves or deletes the account.
7. `stripe_events` payloads — retention to agree with the accountant (financial records).

## 7. Recommendation per category

| Category | Recommendation | Reason / impact |
|---|---|---|
| A. support requests, messages, notes, files | **keep**; let the A3c2b1 job handle them once Eduard enables it | none past 12 months before Nov 2027; already covered |
| A5. orphan support notifications | **anonymise/delete in A3c2b3** (if count > 0) | request no longer exists; title is personal text; no feature reads them |
| B. legacy `delete_account` name/email/shop name | **anonymise** (remove the keys) | contradicts the deletion rule; row stays as proof (code, role, date) |
| B. legacy rows about deleted accounts (phone, names) | **anonymise** (same keys as `audit_forget_account`), never held ones | same rule as new rows |
| B. legacy `open_request_file` file names | **anonymise** (remove `file_name`) | "who opened" keeps working via `file_id` |
| B. `update_shop` IBAN / fiscal diffs | **additional check** (legal point 3) | could be evidence of a fraudulent IBAN change |
| B. possible secrets | **additional check** (manual, per action) then replace the value with `[eliminat]` | false positives likely |
| B. `admin`/`security`/`legal` rows | **keep** | 3 years not validated; none past 3 years |
| C. legacy search words | **include in the 90-day job** by moving the cutoff (A3c2b3), job stays off until the admin enables it | deadline 5 Feb 2027 |
| D. legal hold | **keep everything** | evidence; no hold released > 3 years |
| E2. `company_audit_log` | **additional check** / separate decision | outside A3c2; visible to companies |
| E1. other notifications | **separate decision** (proposal: 12 months after processing) | no rule today |
| E3/E4. anonymised shops' `signup_completions` / `auth.identities` | **separate fix** (functional change to account deletion) | personal data after anonymisation |
| B2. Supabase Auth audit log | **verify the Supabase setting** | outside the app |
| X. external providers | **verify in each dashboard** | not visible from the repo |

## 8. Proposal for A3c2b3 (NOT executed — needs Eduard's approval)

**Step 0 (Eduard, read-only).** Supabase → SQL Editor → paste `docs/sql/a3c2b3_audit_readonly.sql` →
Run → send the JSON (numbers only). It decides which items below are needed (an item with 0 is dropped).

**Categories and estimated rows:** the counters named in the query —
`B…after_cutoff_contradictions` (expected 0), `B…by_action_with_findings` for `delete_account`,
`verify_phone_manually`, `open_request_file`, `update_shop`; `C_search_words.words_legacy_total`;
`A_support.notification_events.request_no_longer_exists`. Before launch volumes are expected to be small
(tens, not thousands).

**Method:** one migration `audit_legacy_correction` (schema 117), same pattern as A3c2b1/b2:
1. A new retention job `legacy_log`, **created disabled**, with a `stable` preview (exact numbers +
   exceptions: legal hold, active hold, rows needed by the features in §5).
2. When the admin enables it with the confirmed preview (second sign-in step, reason), one run:
   - removes `name`, `email`, `shop_name` from legacy `delete_account` rows;
   - removes `file_name` from legacy `open_request_file` rows;
   - removes `name`, `email`, `phone`, `shop_name`, `admin_name`, `owner_name` from legacy rows whose
     entity is a deleted/anonymised account (the `audit_forget_account` rule), never held ones;
   - deletes orphan `support_*` notification events whose request no longer exists;
   - records every removed path in `redacted` (as A3c2b2), one `retention_run` audit row with numbers only.
3. `audit_retention_cutoff()` is replaced by the oldest-row date, so the existing `support_log` job
   (still off) also covers legacy search words and support rows. No row changes at migration time.
4. Possible secrets and IBAN diffs: **not** in the automatic run; only after Eduard decides (§6.3, §4.3).

**Order:** migration (nothing changes) → Eduard checks Database → Backups shows a recent backup →
preview on Retenția datelor → admin enables with the confirmed numbers → one run → preview again shows 0
→ job switches itself off.

**Legal hold protection:** every row passes `audit_row_held` and `legal_hold_has_subject`; rows of class
`legal` are never touched; the run re-checks after `for update skip locked`.

**Rollback:** the migration's rollback refuses once the job has run or a legacy row has `redacted`. The
removed values are **not** copied anywhere (a copy would defeat the purpose); the only way back is the
Supabase backup, for a bug only.

**Tests (local throw-away DB only):** legacy fixtures like the one used here; digest of every untouched
row identical; held rows untouched; `admin_list_support_agents`, `support_request_files`, `audit_entries`
return the same ids/dates before and after; preview equals the effect; idempotent run; only admin with
aal2; job disabled after the migration; rollback refusal.

**Impact on features:** none on client, shop or agent screens. The admin Jurnal shows "[eliminat]" for the
removed values on old rows; agents list and "who opened the file" unchanged.

**Separate decisions (not A3c2b3):** retention of `notification_events`/`notifications_log`,
`company_audit_log`, `stripe_events`; clearing `auth.identities` / `signup_completions` when a shop is
anonymised; the Supabase Auth audit log setting; IBAN in the log.

## 9. Confirmations

- No historical data modified, no row deleted, no migration created, no permission or RLS changed, no
  job switched on, legal hold untouched; nothing run against the test or the real Supabase project.
- The report contains no personal value: only counts, action names and months.
- Not verified by Claude: the real-project numbers (Eduard's query), external providers' logs, the Supabase
  Auth log setting, and whether production rows have backdated timestamps (the query's `oldest_month` says).

## 10. Results on the real project (run by Eduard, 12 Nov 2026)

Schema 116, cutoff Nov 2026. The database holds only pre-launch test data (the PR previews and `main`
still share it, `docs/LANSARE.md`).

| Area | Result |
|---|---|
| A. support (requests, messages, notes, files, Storage, notifications) | 0 rows |
| C. search words | 0 rows |
| D. legal hold (holds, reviews, subjects, held rows) | 0 rows |
| B. admin log | 16 rows, all from Sep 2026, all before the cutoff (13 security, 3 admin) |
| B. rows with identifiers of deleted accounts | **7**: 5 `delete_account` (name + email), 2 `verify_phone` (phone) |
| B. rows about deleted accounts without identifiers | 3 (`promote_to_admin` 1, `extend_trial` 1, `set_subscription_price` 1) |
| B. possible secrets, IBAN / fiscal, file names, CNP, plates | 0 |
| B. unclassified actions; contradictions after the cutoff | 0; 0 (A3c2b2 works as intended) |
| Past any retention period | 0 everywhere |
| E. other sources | `company_audit_log` 1 row (no email/plate), notification events 2 + log 2 (no personal data), everything else 0 |
| Anonymised accounts (`signup_completions`, `auth.identities`) | 0 (the code gap of §4.4 has no data today) |
| Supabase Auth table `auth.audit_log_entries` | 0 rows (the Auth events are in Supabase's platform logs, outside the database) |
| Retention jobs | all off, `admin_log` locked, 0 runs; the pg_cron entries are active, as designed (a run returns at once while its switch is off) |

**Consequence for A3c2b3.** The only data to correct are 7 legacy rows of test accounts deleted in
September. `docs/sql/reset_before_launch.sql` (LANSARE, Part 5, run by Eduard right before the launch)
already empties `admin_audit_log`, the notifications and every test account; the SQL test
`93_reset_before_launch.sql` passes on schema 116. Recommendation: **no A3c2b3 migration**; the launch
reset removes the 7 rows together with all other test data, and every row written after the launch is
covered by the A3c2b2 jobs (it is after the cutoff). Fallback if the launch reset is not run: a small
migration that removes `name`/`email` from the 5 rows and `phone` from the 2 rows, with the preview and
activation pattern of §8.

Still open, unrelated to historical data (separate decisions, none urgent): retention of
`notification_events`/`notifications_log`, `company_audit_log`, `stripe_events`; clearing
`auth.identities`/`signup_completions` when a shop is anonymised; the IBAN key in the log (§4.2).
