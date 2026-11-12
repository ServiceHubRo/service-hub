# Service-Hub — roles and permissions

The matrix of who may do what, as the database enforces it (A2, Eduard, 7 Nov 2026). The interface only
mirrors it: hiding a button is never the protection (CLAUDE.md §6.1). Every row names the mechanism
that enforces it, so a test can prove it. Updated by every task that changes access; A8 checks it end
to end.

## 1. Who exists

| Role | `profiles.role` | How the account comes to exist | ID | Second step of sign-in |
|---|---|---|---|---|
| Client | `client` | Sign-up (Cont nou), Google, Apple | `C-00001` | No |
| Shop owner / colleague | `shop` | Sign-up as a shop; a colleague through the owner's invitation | `S-00001` | No |
| Company member (admin, manager, driver, accountant) | `client` + a row in `company_members` | A client invited into a company (T63b) | `C-…` | No |
| **Support agent** | `support` | **Only** an admin, in the app: Platformă → Echipa de suport (`admin_grant_support`), on a clean client account | `E-00001` | **Required** (aal2) |
| Platform admin | `admin` | Only in the SQL Editor: `promote_to_admin(email)` | `A-00001` | **Required** (aal2) |

- Sign-up accepts only `client` and `shop` (`handle_new_user`, `complete_signup`): nobody becomes an agent
  or an admin by signing up.
- A company role is not a platform role: it lives inside the client interface; shops, agents and admins
  never join companies (`company_clients_only`).
- An agent is appointed only on a **clean** client account: confirmed email, not suspended or deleted,
  no cars, bookings, conversations, companies or shop (`support_not_client`, `support_account_inactive`,
  `support_email_unverified`, `support_account_has_data`). So no client data ever sits behind a staff
  account.

## 2. The agent's life cycle (A2)

| Step | What happens | Where it is enforced | In the audit log |
|---|---|---|---|
| Appointed | `admin_grant_support(account, reason, request)`: role `support`, an `E-` ID (the same one if it had one before) | `require_admin()` (aal2), reason required (≤ 500), clean account | `grant_support`, reason, admin's role and ID |
| No access yet | Until the agent sets up its authenticator app, every `support_*` function answers `mfa_required` | `require_staff()` → `caller_aal() = 'aal2'` | — |
| Works | Solicitări, Căutare, its account card, its own Cont | `require_staff()` in every `support_*` function | every search, opened card and change |
| Suspended | `admin_set_account_suspended`: its sessions are deleted at once | trigger `profiles_end_staff_sessions`; `require_caller()` → `account_suspended` | `suspend_account` |
| Role withdrawn | `admin_revoke_support(user, reason, request)`: back to a client account (its `E-` ID stays), sessions deleted at once | `require_admin()`, reason required; trigger `profiles_end_staff_sessions` | `revoke_support`, reason |
| An old token | Refused by every `support_*` function: the role is read from the database at every call, and an agent's session must still exist | `require_staff()` → `not_allowed`, `caller_session_alive()` → `not_signed_in` | — |
| Appointed again | Possible while the account is still clean; same `E-` ID | as "Appointed" | `grant_support` |
| Deleted | Only after the role is withdrawn (`prepare_account_deletion` refuses an agent, like an admin) | `prepare_account_deletion` | `delete_account` |

The history of an agent's actions never disappears: `admin_audit_log` keeps `admin_id` (no foreign
key) plus `actor_role` and `actor_display_id`, filled by a trigger at insert, so an entry still names
`E-00001` after the account is gone.

## 3. The matrix

✅ allowed · ❌ refused by the database · — not applicable · 👁 read only

| What | Client | Shop | Company member | Support agent | Admin |
|---|---|---|---|---|---|
| **Own account** (name, language, password, own data export) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Delete own account | ✅ | ✅ (owner) | ✅ | ❌ (admin withdraws the role first) | ❌ |
| Change own role, suspension, verification flags | ❌ | ❌ | ❌ | ❌ (no column grant) | ❌ (SQL only) |
| **Bookings, quotes, reviews** of others | ❌ | own shop's | per company right | ❌ | 👁 + listed admin actions |
| Create a booking, decide a quote, write a review | own | — | per right | ❌ (`not_allowed`) | ❌ |
| Change a booking for someone else | ❌ | own shop's (state machine) | per right | ❌ | `admin_force_cancel` only |
| **Private conversations** (client ↔ shop) | own | own shop's | — | ❌ | ❌ (P3) |
| **Companies and fleets** (vehicles, costs, members) | own companies | ❌ | per company right | ❌ (`company_clients_only`) | 👁 list of companies and plans |
| **Subscriptions, payments, invoices, fiscal data** | — | owner | per right (company plan) | ❌ | ✅ |
| **Reviews and ranking** (moderate, remove) | ❌ | reply, report | — | ❌ | ✅ |
| **Support requests** (A3a): write, read own conversation | ✅ own | ✅ own (its shop's bookings linkable) | ✅ (as a client) | — | — |
| Support requests: list, take, assign, answer, set the state | — | — | — | ✅ (not an escalated one) | ✅ |
| Escalate a request (reason required) | — | — | — | ✅ | — |
| Give an escalated request back (reason required) | — | — | — | ❌ | ✅ |
| **Internal notes** of a request | ❌ (no grant, no policy, no function) | ❌ | ❌ | ✅ read and write (read only when escalated) | ✅ |
| Who answered a request | ❌ („Echipa Service-Hub”) | ❌ | ❌ | ✅ | ✅ (also in the audit log) |
| **Attachments** (A3b): send with a request or message | ✅ own requests | ✅ own requests | ✅ (as a client) | ✅ with a reply (not on an escalated request); never on a note | ✅ with a reply |
| Attachments: open | own requests' files | own requests' files | — | ✅ (logged) | ✅ (logged) |
| Who opened a file | ❌ | ❌ | ❌ | ❌ | ✅ (on the request and in the audit log) |
| **Support dashboard** (A3c1): counters, oldest request without answer, the list page by page | — | — | — | ✅ | ✅ (also in Panou) |
| Live signals of a request (Realtime, `support_signals`: only "changed", no content) | own requests, never the team's internal work | own requests, the same | — | every request (aal2, live session) | every request |
| A request's booking | own: code, day, shop, state | its shop's: the same | — | code, day, shop, state only | the same |
| **Legal hold** (A3c2a): place, review, release; see the holds, their reasons and the author's identifiers | ❌ | ❌ | ❌ | ❌ (`not_allowed`) | ✅ (aal2; every step audited) |
| A request under legal hold (also its messages, notes, files, signals, account card line) | ✅ own, while the account exists (no word about the hold) | ✅ own, the same | — | ❌ answers as if it did not exist (`request_not_found`, `file_not_found`); never in lists, counters or Realtime | ✅ marked „Păstrare legală” |
| Delete or change the text of held support data (any path, direct SQL included; TRUNCATE) | ❌ | ❌ | ❌ | ❌ | ❌ (`legal_hold`; release first) |
| **Retention jobs** (A3c2b1): preview, switch on (exact preview numbers, reason) or off, runs, statistics | ❌ | ❌ | ❌ | ❌ (`not_allowed`) | ✅ (aal2; every switch audited) |
| **Suggestions to check** (A3c2b1): the original and proposed text of a suggestion past 12 months; confirm, edit, delete the text | ❌ | ❌ | ❌ | ✅ (aal2, live session; audited) | ✅ (audited) |
| Move a request's real activity date by hand (any path, direct SQL included) | ❌ | ❌ | ❌ | ❌ | ❌ (only a person's message or state change) |
| **Audit log retention** (A3c2b2): support_log job, admin_log job (locked until the legal validation), the privacy report (numbers only) | ❌ | ❌ | ❌ | ❌ | ✅ (aal2; admin_log cannot be switched on) |
| A secret, or a key an action must not keep, in a new log row | ❌ removed at insert (never refused), the paths in `redacted` | | | | |
| **Account search** | — | — | — | ✅ masked: ID, name, role, state, `m***@…`, phone's last 3 digits, shop name and city, created, last active | ✅ full lists |
| **Account card** | — | — | — | ✅ the same fields + its suggestions; never bookings, cars, companies, billing, messages, reviews | ✅ full card |
| Find admin or agent accounts | — | — | — | ❌ (never in results) | ✅ |
| Suspend, delete accounts | ❌ | ❌ | ❌ | ❌ | ✅ (reason required to suspend) |
| Appoint or withdraw agents | ❌ | ❌ | ❌ | ❌ | ✅ (reason required) |
| Promote to admin | ❌ | ❌ | ❌ | ❌ | ❌ (SQL Editor only) |
| **Platform settings**, texts, notices, catalog, zones | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Audit log** | ❌ | ❌ | company log per right | ❌ | ✅ |
| Secrets, keys, configuration | ❌ | ❌ | ❌ | ❌ | ❌ (never in the database API) |
| Resend the confirmation email for someone | — | — | — | after A3 | after A3 |
| Help Center, internal procedures | — | — | — | A4, A5 | A4, A5 |

## 4. How it is enforced

- **Roles are read from the database at every call**, never from the browser or the token:
  `require_caller()` (signed in, not suspended), `require_admin()` (role `admin`, aal2),
  `require_staff()` (role `support` or `admin`, not deleted, aal2; for an agent, the session id of the
  token must still exist in `auth.sessions`).
- **Every `admin_*` function calls `require_admin()`**, which refuses an agent with `not_allowed`.
  `tests/sql/151_support_role.sql` calls every `admin_*` function the API exposes as an agent and fails
  if one answers anything else, including functions added later.
- **`support_*` functions** answer only the fields listed above (`support_account_card`), log every
  search (`support_search`, with the words searched and the number of accounts found), every opened card
  (`support_view_account`) and every change (`update_suggestion`), and limit the search to 120 an hour
  per agent (`limit_searches`).
- **No table grants anything to an agent beyond any signed-in account**: an agent reads its own profile
  and the public data every account reads (shops, hours, services, public reviews, catalog). The SQL
  test checks 36 private tables return no row to an agent.
- **The client, shop and company functions** check the caller's role (`not_allowed`,
  `company_clients_only`) or ownership of the row (`booking_not_found`, `thread_not_found`, …); the SQL
  test calls them as an agent with real ids of other people's rows.
- **The interface:** `/suport/*` is reachable only by an agent (`RoleGuard`); an agent typing an
  admin, client or shop address lands on its own home. `isStaff(role)` keeps the team out of every
  client and shop screen (tour, push, Ajutor și contact, Sugestii, account deletion, the ANPC mark).

## 5. Function reference (A2)

| Function | Caller | Answers | Refusals |
|---|---|---|---|
| `support_search_accounts(q)` | agent, admin (aal2) | `{items: card[], more}` (≤ 20) | `query_too_short` (< 3), `query_too_long` (> 100), `limit_searches` |
| `support_get_account(id)` | agent, admin | card + `suggestions` | `not_found` (not a client's or a shop's account) |
| `support_list_suggestions()` | agent, admin | `{new, items}` | — |
| `support_set_suggestion_status(id, status, request)` | agent, admin | `{id, status, updated_at}` | `status_invalid`, `suggestion_not_found` |
| `admin_list_support_agents()` | admin | `{agents, former}` (`mfa_ready`, `granted_at`, reason of withdrawal) | — |
| `admin_grant_support(account, reason, request)` | admin | `{id, display_id}` | `reason_required`, `reason_too_long`, `not_found`, `wrong_status` (already an agent), `support_not_client`, `support_account_inactive`, `support_email_unverified`, `support_account_has_data` |
| `admin_revoke_support(user, reason, request)` | admin | `{id, role: 'client'}` | `reason_required`, `reason_too_long`, `not_found` |
| `support_list_requests()`, `support_list_staff()` (A3a) | agent, admin | the requests, open first; the team | — |
| `support_get_request(id)` | agent, admin (logged) | request, author card, booking reference, messages with their author, notes, escalation | `request_not_found` |
| `support_take_request`, `support_assign_request`, `support_reply_request`, `support_add_note`, `support_set_request_status` | agent, admin | — | `request_escalated` (agent), `request_closed`, `status_invalid`, `assignee_invalid`, `request_invalid` |
| `support_escalate_request(id, reason, request)` | agent | `{id, escalated}` | `not_allowed` (admin), `reason_required`, `request_escalated` |
| `admin_return_request(id, reason, request)` | admin | `{id, escalated: false, assigned_to}` | `reason_required`, `wrong_status` |
| `my_support_requests()`, `get_my_support_request(id)`, `create_support_request(...)`, `reply_my_support_request(...)` | client, shop (suspended included) | own requests only, never notes or who answered | `request_not_found`, `request_invalid`, `request_closed`, `booking_not_found`, `limit_suggestions`, `limit_support_messages` |
| Edge Function `support-files` (upload, `open`) (A3b) | author (client, shop, suspended included), agent (aal2, live session), admin (aal2) | `{id, name, mime, size}`; `{url}` signed for 60 s | `file_type`, `file_corrupt`, `file_pdf_active`, `file_pdf_encrypted`, `file_too_large`, `too_many_files`, `limit_support_uploads`, `file_not_found` |
| `support_file_begin`, `support_file_register`, `support_file_open`, `support_files_collect`, `support_file_deletions_next/done`, `support_files_stray` | `service_role` only (the function above) | — | — |
| `support_dashboard()`, `support_inbox(owner, status, category, age, after…, limit)` (A3c1) | agent, admin (aal2) | counters + oldest; one page `{me, items, next}` | `request_invalid {field}` |

| `admin_place_legal_hold(request, account, basis, reason, reference, responsible, request_id)` (A3c2a) | admin (aal2) | `{id, review_due_at}` | `field_invalid {field: target, basis, reason, reference, responsible}`, `secret_in_text {field}`, `request_not_found`, `account_not_found`, `hold_exists` |
| `admin_review_legal_hold(id, note, responsible, request_id)` | admin | `{id, review_due_at}` (90 days later) | `field_invalid {field: note}`, `secret_in_text`, `hold_not_found`, `hold_released` |
| `admin_release_legal_hold(id, reason, request_id)` | admin | `{id, released_at, deleted_requests, deleted_files}` | `field_invalid {field: reason}`, `secret_in_text`, `hold_not_found`, `hold_released` |
| `admin_list_legal_holds(state)`, `admin_get_legal_hold(id)` (opening logged), `admin_list_admins()` | admin | the holds; one hold with reviews, covered requests and identifiers | `field_invalid`, `hold_not_found` |
| `admin_list_retention_jobs()`, `admin_retention_preview(job)` (stable: cannot write), `admin_support_stats(from, to)` (A3c2b1) | admin | the jobs with their last runs; the exact numbers and exceptions; the anonymous statistics | `field_invalid {field: job}` |
| `admin_set_retention_job(job, enabled, reason, batch_size, expected, request_id)` | admin | `{job, enabled, batch_size}` | `field_invalid {field: job, enabled, reason, batch_size}`, `secret_in_text`, `preview_changed {counts}`, `job_disabled` |
| `support_list_suggestion_reviews(state)`, `support_review_suggestion_text(id, action, text, request_id)` | agent, admin (aal2) | the texts to check or kept; `{state}` | `field_invalid`, `text_review_not_found`, `text_review_done`, `text_review_expired`, `text_review_needs_edit`, `text_identifies {kinds}` |
| `admin_audit_privacy_report()` (A3c2b2; stable) | admin (aal2) | `{rows, legacy_rows, cutoff, totals, by_action}` — numbers only | — |
| `admin_set_retention_job('support_log' \| 'admin_log', …)` | admin | as above | `job_locked {reason}` for admin_log |
| `run_audit_retention(job, now)` | `pg_cron`; nothing while off or locked; only rows written after the cutoff | the run's numbers | — |
| `run_support_retention(now)`, `run_suggestion_anonymization(now)` | `pg_cron` (and `service_role`); nothing while the job is off; `now` never later than the clock | the run's numbers | — |

Every caller check also answers `not_signed_in`, `account_suspended`, `not_allowed`, `mfa_required`.

## 6. Migration and rollback

| Migration | Schema | Rollback | Rollback test |
|---|---|---|---|
| `20261111204858_audit_log_retention.sql` (A3c2b2) | 116 | `supabase/rollback/20261111204858_audit_log_retention.sql`: **refuses to run** while a log job is on, a log run exists or a log row has removed values (`redacted`); otherwise the A3c2b1 functions return and the classes, triggers and the cutoff go | `npm run test:rollback`: structure and data identical |
| `20261111194435_support_retention.sql` (A3c2b1) | 115 | `supabase/rollback/20261111194435_support_retention.sql`: **refuses to run** (error listing how many) while a job is on or any run, statistics row or anonymised suggestion exists — what a job did cannot be undone; otherwise the A3c2a functions return and the activity column (derived data) goes | `npm run test:rollback`: structure and data identical |
| `20261111142007_legal_hold.sql` (A3c2a) | 114 | `supabase/rollback/20261111142007_legal_hold.sql`: **refuses to run** (error listing how many) while any hold (active or released), review, kept identifiers or request kept after its account went exists — no held data is lost and no request is joined to an account by guess; otherwise the support functions, the foreign key (`ON DELETE CASCADE`, author required) and TRUNCATE for `service_role` return as before | `npm run test:rollback`: structure and data identical; the refusal checked by hand with an active and with a released hold (nothing changed) |
| `20261108054527_support_signals_people_only.sql` (A3c1) | 113 | `supabase/rollback/20261108054527_support_signals_people_only.sql`: jobs signal again; nothing lost | `npm run test:rollback` |
| `20261108045828_support_dashboard.sql` (A3c1) | 112 | `supabase/rollback/20261108045828_support_dashboard.sql`: drops the signals (made again by the next change), the dashboard and list functions, the index; nothing real is lost | `npm run test:rollback` |
| `20261107220601_support_files.sql` (A3b) | 111 | `supabase/rollback/20261107220601_support_files.sql`: **refuses to run** (error listing how many) while a file row, an object in `support-files` or a path waiting for deletion exists; otherwise the A3a functions and export return and everything goes back to schema 110 | `npm run test:rollback`; the refusal checked by hand with one stored object (nothing changed) |
| `20261107193110_support_requests.sql` (A3a) | 110 | `supabase/rollback/20261107193110_support_requests.sql`: **refuses to run** (error listing how many) while a request, message or note written after A3a exists, so real messages and notes are never lost; otherwise everything returns to schema 109 | `npm run test:rollback`; the refusal checked by hand with one message present (nothing changed) |
| `20261107173549_support_role.sql` (A2) | 109 | `supabase/rollback/20261107173549_support_role.sql`: agents become clients (sessions end), the support functions, triggers and audit columns go, account deletion and the audit list are restored as before | `npm run test:rollback`: structure and data identical byte for byte, then the migration applies again; also run by hand with an agent and its audit entries present |
