# Service-Hub — Fleet billing: audit and proposal (T64)

Status: **proposal only (stages A–C). No code, no migration, no Stripe change.** Waiting for
Eduard's approval (stage D). Read with `docs/FLEET_PLAN.md` (fleet architecture) and
`docs/ARCHITECTURE.md` §12 (payments).

Decision already taken (Eduard, 31 Oct 2026): a fleet is a **company space inside client accounts**,
not a fourth role and not a second sign-in (FLEET_PLAN R8).

---

## A. Audit

### A.1 What exists for shops (T14a, live code)
| Piece | What it does | Reusable for fleets? |
|---|---|---|
| Stripe account, `_shared/stripe.ts` | plain fetch, pinned API version, idempotency keys | **Yes**, as is |
| `stripe-webhook` | signature check (`verifyStripeSignature`), each event once (`stripe_events`), reads the subscription as Stripe has it now, out-of-order safe | **Yes**: one endpoint, a new branch for `metadata.kind = 'fleet'`; the shop branch unchanged |
| `stripe-checkout` | hosted Checkout, customer per shop, `price_data` at the shop's own price, 1/3/6/12 months with discounts | **Pattern** reused in a new `fleet-checkout` (the shop function stays untouched) |
| `stripe-portal` | Customer Portal (card, cancel, invoices) | **Pattern** reused (`fleet-portal`) |
| `subscriptions` (PK `shop_id`) | status, trial, period end, seats, launch price; triggers on `shops.active`, seats, referrals, founder badge | **No**: every trigger assumes a shop. Company rows there would risk shop billing → a separate `company_subscriptions` with the same column meanings |
| `invoices` (`shop_id` not null) | one row per paid Stripe invoice; first paid invoice rewards a referral | **No** (same reason) → `company_invoices` |
| `subscription_period_price()`, `platform_settings.period_discount_*` | period price in whole lei | **Yes**, same function |
| Trial warnings (`trial_reminded`, quiet hours), `payment_failed` notices | outbox events | **Pattern** reused with fleet events |
| Admin: `SubscriptionsScreen`, MFA (`aal2`) required for admin writes, `admin_audit_log` | | **Yes**: a "Flote" view; every manual change audited |
| Stripe stand-in for tests (`tests/e2e/providers.ts`) | Checkout, portal, signed webhooks locally | **Yes**: fleet flows tested the same way |

### A.2 What is NOT there yet
- **Fiscal invoices (T14b) are not built**: today a payment gets only Stripe's receipt. Companies are
  B2B, so every invoice must go through **e-Factura**. *Real fleet payments cannot go live before
  T14b* (SmartBill or Oblio, decision pending with the accountant).
- **Companies themselves (T63b) are not built**: no `companies`, `company_members` or company cars.
  Billing tables reference them, so billing comes after T63b/T63c.
- Admin has **one level** (every admin with MFA can do everything). There is no finer admin
  permission system to reuse; proposal in §C.6.
- No fleet feature is live yet. The plan comparison page must list only features that exist when
  it is published (§B.3).

### A.3 How shops and personal accounts stay untouched
- No change to `subscriptions`, `invoices`, `stripe-checkout`, `stripe-portal`, shop triggers, prices
  or Terms §4.5. The only shared code path is `stripe-webhook`, which gets an early branch on
  `metadata.kind === 'fleet'` (subscription and Checkout session metadata) and on the customer found
  in `company_subscriptions`; everything else runs exactly as now. Regression: the existing shop
  e2e flows (`subscription.spec.ts`, `referrals.spec.ts`) and SQL tests 78/83/85/91/97/98 must pass
  unchanged.
- Personal space: no plan, no limit, no banner. Fleet checks are only in company RPCs
  (`company_id` set); `create_booking` without a company keeps today's rules.

---

## B. Commercial model (proposal)

### B.1 Who pays
The **company space** pays (`company_subscriptions.company_id`), never the member who created it.
The Stripe customer is the company (its legal name, CUI, billing email); the card is attached to that
customer. Any company admin can open the portal. Changing the admin changes nothing in billing.

**Admin transfer:** `transfer_company_admin(member, request_id)` — an admin makes another accepted
member admin (then may step down). The last admin can neither leave nor delete their account while
other members exist (`last_admin`). If an admin's account is deleted anyway (account deletion with no
other member), the company and its data stay; a platform admin (MFA, audited) can assign a member who
asks. Vehicles, history, reports and the subscription never move with a person.

### B.2 Plans (all values in a table, editable by the platform admin; nothing hard-coded)
| key | Name | Price / month (hypothesis) | Active vehicles | Members incl. admin |
|---|---|---|---|---|
| `personal` | Personal | free | — (personal garage, unchanged) | — |
| `fleet_start` | Fleet Start | 29 lei | 5 | 1 *(proposed; see question 2)* |
| `fleet_business` | Fleet Business | 59 lei | 15 | 10 *(proposed)* |
| `fleet_pro` | Fleet Pro | 119 lei | 40 | unlimited *(proposed)* |
| `enterprise` | Enterprise | custom (set by admin per company) | custom | custom |

`personal` is not a row: personal accounts are never billed. Prices are fixed on the company's
subscription when it starts (like shops), so a later price change never alters a running one.
3/6/12-month periods reuse the shops' discounts (5/10/15 %), or none at first — question 4.
VAT: none added while the operator is not a VAT payer (same rule as shops).

### B.3 Features per plan — only what is real
Each feature is a key in a registry (`src/lib/fleet/plans.ts` + the same list in SQL) with
`available` = built and released. The comparison page shows a feature only when `available`; a plan
is never sold with a feature that does not exist.

| Feature key | Start | Business | Pro | Exists today? |
|---|---|---|---|---|
| `dashboard`, `vehicles`, `history`, `bookings_quotes`, `doc_alerts` | ✓ | ✓ | ✓ | after T63c/T63d |
| `costs_basic` (ledger, manual expenses, totals) | ✓ | ✓ | ✓ | after T63e |
| `members`, `roles` | – | ✓ | ✓ | after T63b/T63f |
| `reports`, `vehicle_compare`, `export_csv`, `budget`, `cost_per_km`, `approval_flow` | – | ✓ | ✓ | after T63e/T63d |
| `approval_rules` (limits per member / per amount) | – | – | ✓ | **not designed yet** |
| `advanced_permissions`, `advanced_reports`, `trends`, `advanced_exports`, `team_admin`, `cost_analysis` | – | – | ✓ | **not defined yet** |

**Honest consequence:** today Fleet Pro differs from Business only by the vehicle limit. Proposal:
sell Pro as "everything in Business, up to 40 vehicles" until its own features are built, and
add them to the page only when released.

Feature checks live in the database (`fleet_has_feature(company, key)`), inside the RPCs that use the
feature (e.g. `fleet_set_budget` refuses `plan_feature_missing` on Start). The browser only mirrors.

---

## C. Rules, schema and security (proposal — for approval)

### C.1 Active vehicle
A company car with `archived_at is null`. "Unavailable" cars count (they are still in the fleet).
Archived cars do not count, keep all history and can be reopened while under the limit.

### C.2 Limits — always in the database
- `fleet_save_vehicle` (new car) and `fleet_unarchive_vehicle` lock the company's subscription row
  (`for update`) and refuse `fleet_vehicle_limit {limit, active}` when `active ≥ limit`. Two
  admins adding the last place at once: one succeeds. Editing a car never checks the limit.
- `invite_company_member` / `accept_company_invite` refuse `fleet_member_limit` the same way.
- **Nothing is ever deleted or hidden because of a limit.**
- **Over the limit** (after a downgrade, or a limit lowered by the platform admin): all data and work
  continue; only adding/reopening vehicles (or members) is refused. A banner on Panou and Vehicule:
  "Ai 18 vehicule active; planul Fleet Business permite 15. Arhivează 3 vehicule sau alege Fleet Pro."
  with both actions.
- The plan and its limits are read **only** from `company_subscriptions` + `fleet_plans` on the
  server; the browser never sends a plan, a price or a limit that is trusted.

### C.3 Lifecycle and access (the policy to approve)
| State | When | What works |
|---|---|---|
| `trial` | 30 days from creation, no card (off in production until approved) | everything of the trial plan (proposed: Business, 15 vehicles) |
| `active` | Stripe confirms the subscription (webhook only) | everything of the plan |
| `past_due` (grace) | a renewal failed; Stripe retries for up to **7 days** | everything + banner "Plata a eșuat"; admins/accountant notified |
| `read_only` | trial ended without payment, retries exhausted, or a cancellation reached its end | **read everything**: vehicles, history, quotes, documents, reports, CSV export, invoices; **decide quotes already sent** and follow bookings already open (a car at a shop must not get stuck); members can leave, admins can transfer and pay. **Refused**: new vehicles, new company bookings, new expenses, invitations (`fleet_read_only`) |
| `cancelled` | the admin cancels | runs to the end of the paid period (`cancel_at_period_end`), then `read_only` |

- Paying again (Checkout or portal) restores `active` at once — after the webhook, never on
  `?plata=ok` (that page only says "Se confirmă plata…" and waits for the live row).
- Data retention: kept while the company exists; a company is deleted only by its admin after an
  explicit confirmation and an export offer (or by the platform admin, audited). Invoices are kept
  10 years (accounting law) even then.
- Personal space and members' personal bookings are never affected by any state.

### C.4 Upgrade / downgrade
- **Upgrade**: at once, prorated by Stripe (`proration_behavior = create_prorations`); limits rise
  when the webhook confirms the new price.
- **Downgrade**: at the end of the current period (Stripe subscription schedule); until then the old
  plan. If the company is still over the new limit then, C.2 applies (nothing lost, adding refused).
  The page says beforehand how many vehicles would be over.
- During `trial`: changing plan is immediate and free (only the limit and features change).
- Enterprise: set by the platform admin (custom price via `price_data`, custom limits), audited.

### C.5 Trial abuse — proportional
One trial per **company CUI** (public company data, checked with the existing `verify-company` ANAF
lookup) and one trial per **creating account**. No card, no phone, no device fingerprint beyond what
the platform already keeps. A company without a CUI cannot start a trial (it can still pay).

### C.6 Schema (sketch; one migration after T63b/T63c, `schema_version` + 1)
```sql
create table public.fleet_plans (                 -- admin-editable, readable by signed-in users
  key text primary key check (key ~ '^[a-z_]{3,30}$'),
  name_ro text not null, name_en text not null,
  price_ron numeric(10,2) check (price_ron >= 0),   -- null = custom (enterprise)
  vehicle_limit int check (vehicle_limit > 0),     -- null = custom / unlimited
  member_limit int check (member_limit > 0),
  features text[] not null default '{}',
  position int not null default 0, public boolean not null default true,
  active boolean not null default true
);
create table public.company_subscriptions (        -- written only by webhook functions and admin RPCs
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_key text not null references public.fleet_plans(key),
  status text not null check (status in ('trial','active','past_due','read_only','cancelled')),
  ended_reason text check (ended_reason in ('trial_ended','payment_failed','cancelled','admin')),
  price_ron numeric(10,2),                         -- fixed at start
  custom_vehicle_limit int, custom_member_limit int,  -- enterprise / admin overrides
  billing_months int not null default 1 check (billing_months in (1,3,6,12)),
  trial_started_at timestamptz, trial_ends_at timestamptz, trial_reminded jsonb not null default '{}',
  current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  pending_plan_key text references public.fleet_plans(key),   -- downgrade at period end
  stripe_customer_id text unique, stripe_subscription_id text unique, stripe_status text,
  payment_failed_at timestamptz, next_payment_attempt timestamptz, payment_failed_key text,
  status_changed_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.company_invoices (             -- one per paid Stripe invoice; fiscal fields from T14b
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  stripe_invoice_id text unique, amount numeric(10,2) not null, currency text not null default 'RON',
  status text not null check (status in ('paid','issued','failed','void')),
  issued_at timestamptz, period_end timestamptz, receipt_url text,
  series text, number text, pdf_url text, provider text, provider_ref text,
  reversed_at timestamptz, reversed_reason text
);
create table public.fleet_trial_claims (           -- one trial per CUI and per creator
  vat_id text primary key, company_id uuid not null, claimed_by uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.companies add column legal_name text, add column billing_email text;
-- platform_settings: fleet_billing_enabled false, fleet_trial_enabled false, fleet_trial_days 30,
--                    fleet_trial_plan 'fleet_business', fleet_grace_days 7
```
Functions: `company_plan(company)` (effective plan, limits, features, state — the one source for
every check), `fleet_has_feature`, `fleet_can_add_vehicle`, `start_company_trial` (inside
`create_company`, only when `fleet_trial_enabled`), `sync_company_subscription(customer, company,
state)` + `record_company_invoice` + `record_company_payment_failed` (service role, webhook),
`company_billing_view(company)` (admin: everything; accountant: status, invoices; manager: plan and
limits; driver: `not_allowed`), `admin_set_company_plan` / `admin_extend_company_trial` /
`admin_set_company_limits` (admin at `aal2`, `admin_audit_log` before/after), the job
`expire_company_trials()` in the existing hourly runner, reminders at 7 and 1 days (quiet events).

**RLS:** `fleet_plans` select for `authenticated`, no writes; `company_subscriptions` and
`company_invoices` select only through `fleet_can(company, 'subscription.view')` (admin + accountant)
and platform admin; **no insert/update/delete grant to `authenticated` at all**. SQL tests prove
company A cannot read B's subscription or invoices and that no member can change plan, status,
price, limits or trial dates by a direct write.

### C.7 Payments (Stripe — already the project's provider; stage F, separate approval)
- **Why Stripe:** already integrated, tested, with signature checks and idempotency; recurring
  billing, retries, prorations, portal. Cost ~1.4 % + ~1 leu per EU card payment (SERVICII_EXTERNE):
  on 29 lei ≈ 1.4 lei (~4.9 %), on 59 lei ≈ 1.8 lei, on 119 lei ≈ 2.7 lei. Paying 3/6/12 months at
  once lowers the share.
- **Flow:** `fleet-checkout` (admin only; company billing data complete, else `billing_incomplete`) →
  Stripe customer for the company → Checkout `mode = subscription`, `price_data` at the plan's price
  on one product `STRIPE_FLEET_PRODUCT_ID`, metadata `{kind: 'fleet', company_id, plan_key,
  billing_months}` → **only the webhook** activates (`customer.subscription.*`, `invoice.paid`,
  `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`) → Realtime updates the page.
- **Failed payments:** Stripe Smart Retries within the grace days; `past_due` + notices (admin,
  accountant; amounts only to them); last failure → `read_only`.
- **Cancel / refund:** cancel in the portal (end of period). Refunds only by Eduard in the Stripe
  dashboard; the webhook records them (`company_invoices.reversed_*`).
- **Secrets** (Edge Function secrets only): reuse `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; new
  `STRIPE_FLEET_PRODUCT_ID`. No card data ever in Service-Hub.
- **Romanian invoicing:** each payment needs a fiscal invoice reported in e-Factura (B2B) — **T14b
  must be done first** (SmartBill or Oblio, series, VAT status, storno on refund). Until then: test
  mode only.
- **Legal:** Terms need a fleet section (who pays, plans, trial, read-only after expiry, cancellation,
  data kept); companies are not consumers, so the 14-day withdrawal right of OUG 34/2014 does not
  apply to them (to confirm with the lawyer for PFA/II).

### C.8 Interface (stage E, in test builds first)
- Company Cont → **Abonament și facturare** (admin full; accountant read-only; manager sees plan and
  limits; driver: no tile): plan, price and period, state with days of trial left (bar, like the
  shop screen), active vehicles `12 / 15` and members `4 / 10`, next payment, invoices, upgrade /
  downgrade with the effect stated, cancellation (inline confirm panel), over-limit banner.
- **Compară planurile**: from `fleet_plans` + the feature registry, only available features.
- While payments are not integrated (`fleet_billing_enabled = false`): no pay or change buttons;
  one line "Plata cu cardul nu este încă disponibilă." — no simulated transaction.
- Platform admin → Abonamente gets a **Flote** tab: companies, plan, state, start/expiry, active
  vehicles, payment problems, the audit history; actions only at `aal2`, each audited.

---

## D. Stages
| Stage | Content | Needs |
|---|---|---|
| T63b | companies, members, admin transfer, space switcher | migration (approved architecture; SQL to show) |
| T63c | company cars, active-vehicle count | migration |
| **T64a** | `fleet_plans`, `company_subscriptions`, limits and read-only rules in RPCs, trial (flag off), billing page + plan comparison, admin Flote tab — **no Stripe** | migration, approval of §C |
| **T64b** | `fleet-checkout`, `fleet-portal`, webhook branch — Stripe **test mode** only | separate approval |
| **T64c** | fiscal invoices for companies (with T14b), e-Factura | T14b decision |
| **T64d** | live: `fleet_billing_enabled` / `fleet_trial_enabled` on in production, Terms updated | Eduard's go |

## E. Tests (what will be run, by stage)
| # | Scenario | How | Stage |
|---|---|---|---|
| 1–3 | create company, trial starts (flag on in test), correct plan shown | SQL + e2e | T64a |
| 4–5 | vehicle limit, concurrent last place, refusal via direct API call | SQL (two sessions) | T64a |
| 6 | read-only after expiry: reads OK, writes refused, open quotes still decidable | SQL + e2e | T64a |
| 7 | upgrade at once, downgrade at period end, over-limit banner | SQL + e2e (stand-in) | T64a/T64b |
| 8–10 | paid via webhook only, failed payment → grace → read-only, cancellation | e2e with the Stripe stand-in, signed webhooks | T64b |
| 11 | company A vs B: subscriptions and invoices isolated | SQL RLS | T64a |
| 12 | billing page by role (admin, accountant, manager, driver) | SQL + e2e | T64a |
| 13 | personal account: no plan, no limit, all features | e2e regression | every stage |
| 14 | shop subscriptions unchanged | existing SQL 78/83/85/91/97/98 + e2e subscription/referrals | every stage |

## F. Decisions for Eduard
1. Approve the access policy §C.3 (grace 7 days, then read-only; open quotes stay decidable).
2. Fleet Start with **one member** only (the admin, no drivers)? Proposed member limits 1 / 10 / unlimited. **Replaced on 31 Oct 2026 (T64d): colleagues included 1 / 3 / 5, then 19 lei each a month, prices set in Admin → Flote; no fixed member limit.**
3. Trial plan: Fleet Business for 30 days, no card, one per CUI — and kept **off in production**
   until you switch it on.
4. Longer periods (3/6/12 months with the shops' discounts) from the start, or monthly only first.
5. Fleet Pro sold as "Business + up to 40 vehicles" until its own features exist.
