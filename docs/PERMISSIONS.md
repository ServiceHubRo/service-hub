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
| **Suggestions** (T26) | write, read own | write, read own | — | 👁 all + set state | 👁 all + set state |
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

Every caller check also answers `not_signed_in`, `account_suspended`, `not_allowed`, `mfa_required`.

## 6. Migration and rollback

| Migration | Schema | Rollback | Rollback test |
|---|---|---|---|
| `20261107173549_support_role.sql` (A2) | 109 | `supabase/rollback/20261107173549_support_role.sql`: agents become clients (sessions end), the support functions, triggers and audit columns go, account deletion and the audit list are restored as before | `npm run test:rollback`: structure and data identical byte for byte, then the migration applies again; also run by hand with an agent and its audit entries present |
