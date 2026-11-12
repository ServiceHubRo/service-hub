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
| An old token | Refused by every `support_*` function: the role is read from the database at every call, and an agent's session must still exist and be younger than 8 hours (A6) | `require_staff()` → `not_allowed`, `caller_session_alive()` → `not_signed_in` | — |
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
| Suspend, reactivate, delete accounts | ❌ | ❌ | ❌ | ❌ | ✅ (reason required for each, A6) |
| Sensitive admin changes (A6): a shop's data and billing, a price, a free period, a report credit, a phone confirmed by hand, a company plan, the platform settings | ❌ | ❌ | ❌ | ❌ | ✅ reason required (1–500 characters, in the audit log); the owner is told when the IBAN or the billing email changes |
| **Exports** (A6) | ❌ | ❌ | ❌ | ❌ | ✅ reason required, at most 100 rows and 5 exports an hour per admin, without phone numbers or VINs |
| **Admin accounts** (A6, Platformă → Administratori): see the admins, end another admin's sessions, suspend or reactivate it, end one's own other sessions | ❌ | ❌ | ❌ | ❌ | ✅ reason required; never oneself, never the last active admin |
| **Security log** (A6, Platformă → Securitate) | ❌ | ❌ | ❌ | ❌ | ✅ read only |
| Write one's own data directly (profile, cars, shop, billing, hours, closures, photos, files) while **suspended** | ❌ (A6: only the language and the hints it reads) | ❌ (A6; a suspended shop too) | ❌ | — | — |
| Appoint or withdraw agents | ❌ | ❌ | ❌ | ❌ | ✅ (reason required) |
| Promote to admin | ❌ | ❌ | ❌ | ❌ | ❌ (SQL Editor only) |
| **Platform settings**, texts, notices, catalog, zones | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Audit log** | ❌ | ❌ | company log per right | ❌ | ✅ |
| Secrets, keys, configuration | ❌ | ❌ | ❌ | ❌ | ❌ (never in the database API) |
| Resend the confirmation email for someone | — | — | — | after A3 | after A3 |
| **Help Center** (A4): read published articles meant for it, search, frequent questions | ✅ client and general articles (company articles when fleets are on) | ✅ shop and general articles | ✅ + fleet articles for its company role | ✅ every audience (aal2, live session) | ✅ every audience |
| Help Center: drafts, withdrawn articles, the team-only articles | ❌ (never returned) | ❌ | ❌ | ✅ team-only articles once published; ❌ drafts | ✅ in the administration |
| Help Center: vote „Ți-a fost util acest articol?” (own vote, changeable; in the own data export) | ✅ on an article it may read | ✅ | ✅ | ✅ (the app does not ask) | ✅ |
| Help Center: write, publish, withdraw, delete, order, categories, see vote totals and history | ❌ | ❌ | ❌ | ❌ (`not_allowed`) | ✅ (aal2; every write audited) |
| Who voted on an article | ❌ | ❌ | ❌ | ❌ | ❌ (only totals; no grant on `help_feedback`) |
| **Internal procedures** (A5): read the published procedures | ❌ (`not_allowed`; never in `help_center` or any public function) | ❌ | ❌ | ✅ those for agents (aal2, live session) | ✅ all, every status |
| Procedures: create a draft, propose one | ❌ | ❌ | ❌ | ✅ for agents, not critical | ✅ |
| Procedures: edit a draft | ❌ | ❌ | ❌ | ✅ its own, and those of a category it is responsible for | ✅ any |
| Procedures: send for approval, back to draft, discard a draft | ❌ | ❌ | ❌ | ✅ on a draft it may edit | ✅ |
| Procedures: approve, publish, archive, restore; who reads it; critical | ❌ | ❌ | ❌ | ❌ (`not_allowed`) | ✅ any admin, its own draft included |
| Procedures: change an approved version | ❌ | ❌ | ❌ | ❌ (`version_locked`) | ❌ (`version_locked`, by any path; a new version instead) |
| Procedures: „Am citit” on a critical one | ❌ | ❌ | ❌ | ✅ own, the version shown | ✅ own, the version shown |
| Procedures: see who confirmed | ❌ | ❌ | ❌ | ❌ | ✅ |
| Procedures: name or remove a category's responsible | ❌ | ❌ | ❌ | ❌ (reads who it is) | ✅ |
| Procedures next to a support request | ❌ | ❌ | ❌ | ✅ published, for agents (not on a request under legal hold) | ✅ |

## 3b. Internal procedures (A5)

- **Who reads:** an admin reads every procedure in every state. An agent reads only the published
  procedures meant for agents (`visibility = 'support'`), never one for admins only, a draft of someone
  else or an archived one. Clients, shops, company members and signed-out visitors reach nothing: the
  tables have no grant and every function refuses them (`not_allowed`, `permission denied`).
- **Who writes:** an agent creates drafts (always for agents and not critical), edits its own drafts and
  the drafts of the categories it is responsible for, sends them for approval and proposes a new version
  of a published procedure it reads. An admin does all of that on any procedure and decides who reads it
  and whether it is critical.
- **Who approves and publishes:** any admin, its own draft included; one admin is enough. An approved
  version is fixed for ever (`version_locked` on every path, direct SQL included); every change is a new
  version, and readers keep seeing the published one until an admin approves and publishes the new one.
  An older approved version can be published again.
- **„Am citit”:** required on exceptional procedures marked critical. It belongs to one version: a new
  version published asks everyone again, the earlier confirmations stay in the history. Only the caller's
  own explicit call writes it (opening the page writes nothing; nobody confirms for someone else; a repeat
  changes nothing). The admin sees who confirmed the version shown and who did not.
- **Responsibles:** one per category, named by an admin among the active agents and admins. A responsible
  who leaves the team, is suspended or deleted is marked „Necesită reatribuire”; nobody is named in its
  place automatically.
- **History:** every version is kept with its author, approver, approval and publication dates; the admin
  sees them all, an agent the published ones and the version it edits. Every write is in the audit log.
- **Escalation:** unchanged from A3 (agent → admin, `support_escalate_request` / `admin_return_request`).
  A procedure only describes it; no new level, no automatic deadline.

## 4. How it is enforced

- **Roles are read from the database at every call**, never from the browser or the token:
  `require_caller()` (signed in, not suspended), `require_admin()` (role `admin`, not deleted, aal2,
  and since A6 the session id of the token must still exist in `auth.sessions`, not past its end and
  younger than 8 hours), `require_staff()` (role `support` or `admin`, not deleted, aal2, the same
  session check). `is_admin()` (the access rules) and `support_file_caller()` (the support files'
  Edge Function) apply the same session check since A6: an admin who signed out, whose sessions
  another admin ended, or who signed in more than 8 hours ago, is refused at once (`not_signed_in`).
- **A suspended account cannot write directly** (A6): every write rule on its own rows asks
  `caller_can_write()` (signed in, not suspended, not deleted), every write rule on a shop's rows and
  files `shop_writable(shop)` (also the shop not suspended and its owner not suspended); the trigger
  `profiles_suspended_guard` lets a suspended person change only its language and the hints it reads.
  Fleet files are written only through the Edge Function `fleet-files` (a ticket per file).
- **Refusals that matter** (an admin function called without the right, a missing second step, a
  dead session, a suspended account trying to act, a change attempted on the audit log) are written to
  the Postgres log as `sh_security {json}` (codes and ids, never a name or what was typed), which a
  rolled-back transaction keeps; events of committed work (an admin's sessions ended, a file refused,
  a limit reached, a failed session cleanup) are kept in `security_events` and shown in Platformă →
  Securitate.
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

| `help_center(lang)` (A4) | any signed-in account (an agent at aal2 with a live session) | `{lang, me: {staff, types, company_roles}, categories, articles (with text), untranslated, votes}` | `field_invalid {field: lang}` |
| `help_send_feedback(article, helpful, request_id)` | the same readers | `{article_id, helpful}` | `article_not_found` (draft, withdrawn, hidden category or not meant for the caller), `field_invalid {field: helpful}` |
| `admin_help_list()`, `admin_help_get_article(id)` | admin (aal2) | categories and articles (every status) with vote totals; one article with its last 50 versions | `article_not_found` |
| `admin_help_save_article(id, article, request_id)`, `admin_help_set_article_status(id, status, request_id)`, `admin_help_delete_article(id, request_id)` | admin | the article; `{id, deleted}` | `field_invalid {field: help_title_ro, help_body_en, help_slug, help_audience, help_company_roles, …}`, `slug_taken`, `category_not_found`, `article_not_found`, `wrong_status`, `article_published` (withdraw before deleting) |
| `admin_help_save_category(id, category, request_id)`, `admin_help_delete_category(id, request_id)`, `admin_help_move(kind, id, direction, request_id)` | admin | the category; `{id, deleted}`; the new position | `field_invalid {field: help_name_ro, help_icon, …}`, `slug_taken`, `category_not_found`, `category_not_empty`, `cannot_move` |

| `staff_procedures()` (A5) | agent, admin (aal2; agent: live session) | `{me, categories (with responsible), procedures (published text; version in work when editable), support_categories, team (admin only)}` | — |
| `staff_procedure_get(id)` | agent, admin | the procedure with the versions the caller may see | `procedure_not_found` (not readable or editable by the caller) |
| `support_procedures_for_request(request)` | agent, admin | published procedures of the request's category the caller reads | `request_not_found` (also a request under legal hold, for an agent) |
| `staff_procedure_create(settings, content_ro, content_en, request_id)` | agent, admin | `{id, version_id, version}` | `field_invalid {field: proc_category, proc_kind, proc_support_categories, proc_title_ro, proc_steps_en, …}`, `secret_in_text {field}`, `not_allowed` (an agent setting who reads it or critical) |
| `staff_procedure_save(version, content_ro, content_en, settings, request_id)` | agent (its drafts, its categories' drafts), admin | `{id, version_id, version, changed}` | as above, `procedure_not_found`, `version_locked`, `wrong_status` (not a draft; settings of a published procedure) |
| `staff_procedure_new_version(procedure, request_id)` | agent (a published procedure for agents), admin | `{id, version_id, version}` | `procedure_not_found`, `version_open`, `wrong_status` |
| `staff_procedure_step(version, submit \| to_draft \| discard, request_id)` | the version's editors, admin | `{…, status}` or `{discarded, procedure_deleted}` | `procedure_not_found`, `version_locked`, `wrong_status`, `field_invalid {field: proc_step}` |
| `staff_procedure_acknowledge(version, request_id)` | agent, admin (own confirmation only) | `{version, acknowledged_at}` (the first one on a repeat) | `procedure_not_found`, `wrong_status` (not the version shown), `ack_not_required` |
| `admin_procedure_approve(version, publish, request_id)`, `admin_procedure_publish(version, request_id)` | admin (any, its own draft included) | `{id, version_id, version, …}` | `procedure_not_found`, `version_locked`, `wrong_status` |
| `admin_procedure_set_settings(id, settings, request_id)`, `admin_procedure_archive(id, archived, request_id)` | admin | the settings; `{id, status}` | `field_invalid {field: proc_critical, proc_visibility, …}`, `procedure_not_found`, `wrong_status` |
| `admin_procedure_acknowledgements(id)` | admin | `{version, people: [{display_id, name, role, acknowledged_at}]}` | `procedure_not_found` |
| `admin_procedure_set_responsible(category, user \| null, request_id)` | admin | `{category, responsible}` | `field_invalid {field: proc_category}`, `assignee_invalid` (not an active agent or admin), `wrong_status` (nothing to remove) |

Every caller check also answers `not_signed_in`, `account_suspended`, `not_allowed`, `mfa_required`.

## 5b. Function reference (A6)

| Function | Caller | Answers | Refusals |
|---|---|---|---|
| `admin_team_admins()` | admin | `[{id, display_id, name, suspended, me, mfa_ready, sessions, last_sign_in_at}]` (never a deleted one) | — |
| `admin_set_admin_suspended(user, suspended, reason, request_id)` | admin | `{id, suspended}`; suspending ends its sessions | `reason_required`, `reason_too_long`, `cannot_target_self`, `not_found` (not an admin), `wrong_status`, `last_platform_admin` |
| `admin_end_admin_sessions(user, reason, request_id)` | admin | `{id, sessions_ended}` | `reason_required`, `cannot_target_self`, `not_found`, `sessions_not_ended` |
| `admin_end_my_other_sessions(reason, request_id)` | admin | `{sessions_ended}` (the session in use stays) | `reason_required`, `sessions_not_ended` |
| `admin_security_events(severity, before, limit)` | admin | grouped events, newest first (≤ 200) | `field_invalid {field: severity}` |
| `admin_export(kind, filters, reason)` | admin | ≤ 100 rows, no phone numbers or VINs; `filters.ids` = the rows a screen shows | `reason_required`, `limit_exports` (5 an hour), `kind_invalid` |
| `admin_verify_phone`, `admin_grant_report_credit`, `admin_set_subscription_price`, `admin_extend_trial`, `admin_extend_company_trial`, `admin_set_company_plan`, `admin_update_settings`, `admin_update_shop` | admin | as before; `p_reason` added (last argument) | `reason_required`, `reason_too_long` |
| `admin_set_account_suspended`, `admin_set_shop_suspended` | admin | as before; a reason now also to reactivate | `reason_required` |
| Edge Function `admin-delete-account` `{user_id, reason}` | admin (aal2, live session) | `{ok, mode}` | `not_signed_in`, `not_allowed`, `reason_required`, as before |
| Edge Function `fleet-files` (multipart `file`, `company`, `vehicle`, `issue?`) | company member with the right for that vehicle or report | `{path, mime, size}` | `file_type`, `file_corrupt`, `file_pdf_active`, `file_pdf_encrypted`, `file_too_large`, `not_allowed`, `account_suspended`, `too_many_photos` (6 a report), `limit_fleet_uploads` (60 an hour), `limit_fleet_storage` (500 MB a company) |
| `document_limit(user, kind)` (service role, from `job-document` and `generate-report`) | — | nothing | `limit_documents` (job documents 30 an hour, reports made again 10 an hour, per person) |

## 6. Migration and rollback

| Migration | Schema | Rollback | Rollback test |
|---|---|---|---|
| `20261112150000_a6_security.sql` (A6) | 119 | `supabase/rollback/20261112150000_a6_security.sql` (generated from schema 118): **refuses to run** (error listing how many) once a security event, an audit entry written by A6 (views, admin suspensions, sessions ended, or any entry with a session id) or a pending fleet file ticket exists; otherwise every function, rule and grant returns to schema 118. The app must go back with it (git revert of the A6 pull request) | `npm run test:rollback`: structure and data identical, applies again; the refusal checked by hand with one security event |
| `20261112120000_procedures.sql` (A5) | 118 | `supabase/rollback/20261112120000_procedures.sql`: **refuses to run** (error listing how many) once a version written by a person, a changed procedure or version (sent, approved, published, archived, saved), a confirmation, a responsible or a procedure entry in the audit log exists; otherwise the tables, functions and audit classes go (the 16 untouched first drafts with them) | `npm run test:rollback`: structure and data identical, applies again; the refusal in `tests/sql/160_procedures.sql` |
| `20261112060000_help_center.sql` (A4) | 117 | `supabase/rollback/20261112060000_help_center.sql`: **refuses to run** (error listing how many) once a vote, a saved version, a changed, moved or added article or category, or a Help Center entry in the audit log exists; otherwise the tables, functions and audit classes go and the data export is the one before A4 | `npm run test:rollback`: structure and data identical; the refusal checked by hand with one changed article |
| `20261111204858_audit_log_retention.sql` (A3c2b2) | 116 | `supabase/rollback/20261111204858_audit_log_retention.sql`: **refuses to run** while a log job is on, a log run exists or a log row has removed values (`redacted`); otherwise the A3c2b1 functions return and the classes, triggers and the cutoff go | `npm run test:rollback`: structure and data identical |
| `20261111194435_support_retention.sql` (A3c2b1) | 115 | `supabase/rollback/20261111194435_support_retention.sql`: **refuses to run** (error listing how many) while a job is on or any run, statistics row or anonymised suggestion exists — what a job did cannot be undone; otherwise the A3c2a functions return and the activity column (derived data) goes | `npm run test:rollback`: structure and data identical |
| `20261111142007_legal_hold.sql` (A3c2a) | 114 | `supabase/rollback/20261111142007_legal_hold.sql`: **refuses to run** (error listing how many) while any hold (active or released), review, kept identifiers or request kept after its account went exists — no held data is lost and no request is joined to an account by guess; otherwise the support functions, the foreign key (`ON DELETE CASCADE`, author required) and TRUNCATE for `service_role` return as before | `npm run test:rollback`: structure and data identical; the refusal checked by hand with an active and with a released hold (nothing changed) |
| `20261108054527_support_signals_people_only.sql` (A3c1) | 113 | `supabase/rollback/20261108054527_support_signals_people_only.sql`: jobs signal again; nothing lost | `npm run test:rollback` |
| `20261108045828_support_dashboard.sql` (A3c1) | 112 | `supabase/rollback/20261108045828_support_dashboard.sql`: drops the signals (made again by the next change), the dashboard and list functions, the index; nothing real is lost | `npm run test:rollback` |
| `20261107220601_support_files.sql` (A3b) | 111 | `supabase/rollback/20261107220601_support_files.sql`: **refuses to run** (error listing how many) while a file row, an object in `support-files` or a path waiting for deletion exists; otherwise the A3a functions and export return and everything goes back to schema 110 | `npm run test:rollback`; the refusal checked by hand with one stored object (nothing changed) |
| `20261107193110_support_requests.sql` (A3a) | 110 | `supabase/rollback/20261107193110_support_requests.sql`: **refuses to run** (error listing how many) while a request, message or note written after A3a exists, so real messages and notes are never lost; otherwise everything returns to schema 109 | `npm run test:rollback`; the refusal checked by hand with one message present (nothing changed) |
| `20261107173549_support_role.sql` (A2) | 109 | `supabase/rollback/20261107173549_support_role.sql`: agents become clients (sessions end), the support functions, triggers and audit columns go, account deletion and the audit list are restored as before | `npm run test:rollback`: structure and data identical byte for byte, then the migration applies again; also run by hand with an agent and its audit entries present |
