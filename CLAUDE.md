# Service-Hub — rules for Claude

> Notă pentru Eduard: fișierul ăsta e pentru Claude. Îl citește la începutul fiecărei sesiuni. Nu trebuie să-l modifici decât dacă vrei să schimbi regulile proiectului.

## 1. What this project is

Service-Hub (always written with the hyphen) is a car-repair booking marketplace for Romania, starting in Brașov. Car owners find a repair shop, book a slot online, receive a **quote (deviz)** after the shop inspects the car, approve or refuse it in the app, and get notified when the car is ready. Shops manage bookings, quotes, messages, reviews and history, and pay one subscription: 100 lei/month plus 20 lei/month for each colleague with an account in the shop (90-day free trial). Domain: `service-hub.ro`.

Three roles, three completely separate interfaces:

| Role | Navigation (5 items) | Notes |
|---|---|---|
| **Client** | Caută · Garaj · Programări · Mesaje · Cont | Garage exists only here |
| **Shop** | Panou · Programări · Istoric · Mesaje · Cont | Setări, Abonament, Recenzii, Rapoarte are tiles inside Cont |
| **Admin** | Prezentare · Service-uri · Clienți · Rezervări · Moderare | Platform tools are tiles inside the admin Cont. Admin accounts are created only in the database |

A user has exactly one role, fixed at sign-up. The role decides the whole navigation and every reachable route. A client can never reach a shop screen and vice versa; this is enforced in routing **and** in the database.

## 2. Who you are working with

- **Eduard** owns the product. He is not a programmer. He reads Romanian best, understands English.
- **Talk to him in Romanian**, in plain language, short and direct. No jargon without a one-line explanation. Code, comments, commit messages, branch names and technical docs are in English.
- He tests on the **Netlify deploy preview link** of each pull request, by clicking through the app on his phone and laptop. He merges pull requests himself.
- Database migrations and Edge Functions reach Supabase automatically: the GitHub Action **"Deploy Supabase"** runs on every push to a pull request and on every merge to `main` (set up in T02, using secrets stored in GitHub, which you never see), so the preview link always has the database it needs. Until launch (T19) there is one Supabase project; T19 splits it into a test project for pull requests and the real one for `main`. Eduard only runs one-off SQL you hand him (for example `promote_to_admin`) and changes dashboard settings you describe step by step.
- He expects you to make reasonable decisions yourself and to tell him what you decided. Ask him only when a choice is expensive to undo or genuinely his (money, legal, business rules). Ask one clear question at a time.
- Never ask him to paste a secret key into the chat. Tell him the exact name of the secret and where to create it (Netlify env vars, Supabase Edge Function secrets).

## 3. Where the truth lives (read in this order)

1. **This file** — rules and conventions.
2. **`docs/ARCHITECTURE.md`** — data model, booking/quote state machine, database functions, visibility rules, notifications, scheduled jobs, design system. Read it before any database, flow or layout work.
3. **`docs/TASKS.md`** — the ordered build plan. Each session does one task (or one part of a task).
4. **`docs/FUNCTIONAL_REQUIREMENTS.md`** — every page and function, in plain terms.
5. **`docs/lovable-prompts.md`** — the original detailed feature specs (written for Lovable). Use them for detail: exact copy, labels, layout specifics. When a later prompt contradicts an earlier one, the later one wins; when a prompt contradicts ARCHITECTURE.md, ARCHITECTURE.md wins (the list of known overrides is at the end of ARCHITECTURE.md).
6. **`docs/reference-demo.html`** — a working single-file demo of both client and shop interfaces. Open it to see the intended look, copy, flow and tone. It is a reference, not code to copy (it stores everything in localStorage and has no backend).
7. `docs/service-catalog.json` (the 150 services), `docs/brand/`, `docs/legal/`, `docs/SERVICII_EXTERNE.md` (external services and costs).

If two documents disagree and the order above does not settle it, pick the safer option, implement it, and mention it in the PR under "Decizii".

## 4. Stack (fixed — do not swap without asking)

- **Frontend:** Vite + React + TypeScript (`strict: true`), React Router. Single-page app.
- **Styling:** CSS custom properties defined once in `src/styles/tokens.css`, plus CSS Modules per component. No Tailwind, no component library. Icons from `lucide-react` (the logo wrench is Lucide's `wrench`). Charts are hand-written SVG — no charting library.
- **Backend:** Supabase — Postgres, Auth, Realtime, Storage, Edge Functions (Deno), `pg_cron` for scheduled jobs. Project region: Frankfurt (eu-central-1).
- **Hosting:** Netlify, connected to this GitHub repo. Every pull request gets a deploy preview automatically. SPA routing via `public/_redirects` (`/* /index.html 200`).
- **External services (added in their tasks):** Resend (email), Web Push with VAPID keys, SMSO (SMS), Stripe (subscription + one-off report payments), SmartBill or Oblio (invoices + e-Factura), Nominatim or Google Geocoding (addresses → coordinates), Sentry (errors).
- **Tests:** Vitest (unit), Playwright (browser), SQL tests against a local Postgres (see §9).
- Keep dependencies few. Every new npm package must be justified in one line in the PR.

## 5. Repository layout

```
src/
  app/          router, role guards, shells (mobile bottom bar, desktop sidebar)
  screens/      auth/ public/ client/ shop/ admin/   — one folder per screen
  components/   shared UI (Button, ActionButton, Card, Pill, Stepper, Skeleton, Banner, ...)
  data/         Supabase queries, RPC calls, realtime subscriptions, typed per domain
  lib/          pure logic: validators (cui, iban, regcom, zip, phone, odometer), time, ranking, format
  i18n/         ro.ts (source of keys), en.ts, t() helper, formatters
  styles/       tokens.css, global.css
supabase/
  migrations/   <timestamp>_<name>.sql, never edited after merge
  functions/    Edge Functions (Deno)
  seed/         dev_seed.sql — demo data for local tests only
tests/
  sql/          database tests (triggers, RLS, state machine)
  e2e/          Playwright flows
docs/           specs (see §3)
```

## 6. Non-negotiable rules

1. **Security lives in the database.** Row Level Security on every table. The browser can never change: booking status, quote items/totals after sending, subscription/plan state, `active`, `suspended`, verification flags, review rating/text, admin data. The UI hiding a button is never the protection.
2. **Every booking and quote state change goes through a Postgres function** (RPC) listed in ARCHITECTURE.md. Direct `UPDATE` of `bookings.status` is revoked from the `authenticated` role. Each function checks who is calling, checks the current status, applies the change, writes the automatic thread message and the notification event **in the same transaction**.
3. **Daily capacity, per-slot limits and abuse limits are enforced in the database** with row locking, so two people booking the last slot at the same moment cannot both succeed. The UI only mirrors them.
4. **No hard-coded user-facing text.** Every string comes from `src/i18n/ro.ts` + `en.ts`. `en.ts` is typed against the keys of `ro.ts`, so a missing translation fails the build. English is **US English** ("tires", "color", "license plate", "windshield", "transmission", "canceled"; status codes in the database stay as defined, e.g. `cancelled`). Romanian uses correct diacritics (ș ț ă â î).
5. **Time:** store timestamps as `timestamptz` (UTC). A booking's `date` + `slot` mean local time in **Europe/Bucharest**. Always display dates and times in Europe/Bucharest via `Intl` with an explicit `timeZone`, never the device zone.
6. **Snapshots:** a booking copies the client's name/phone/language and the car's details at creation. Editing or deleting a car never changes past bookings.
7. **Idempotent writes:** every mutating RPC takes a `p_request_id uuid`. The same request id twice returns the first result and does nothing else. In the UI every write goes through the shared `ActionButton`: disables on tap, spinner inside, one submission only, inline error with "Încearcă din nou" under the action — never `alert()`, never silent failure. Confirmations (refuse a quote, cancel, delete) are inline confirm panels, never `window.confirm`.
8. **Loading is not empty.** Lists show 3 skeleton cards while loading. An empty state appears only after data has loaded and is empty. A slim offline bar appears when the browser is offline.
9. **Realtime, not polling.** Screens with bookings, messages, reviews and dashboard counters subscribe to Supabase Realtime, filtered to the user's rows, update local state from the payload, reconnect and resync after a drop.
10. **Secrets:** the frontend only ever has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the public "anon"/"publishable" key). The service role key, Stripe secret, webhook secrets, VAPID private key, Resend and SMSO keys exist only as Supabase Edge Function secrets. Nothing secret is committed. `.env` is git-ignored; `.env.example` lists names only.
11. **Fiscal data is never public.** It lives in `shop_billing`, readable only by the shop owner and admin. The public shop page reads only public columns.
12. **No paid placement, ever.** Search order is the weighted rating only (ARCHITECTURE.md). Distance is a separate section and a sort option, never mixed into the score.
13. **Accessibility:** real `<button>`/`<a>` elements, visible amber focus ring, `aria-label` on icon-only buttons, `<label>` tied to every input, status never shown by color alone, tap targets ≥ 44 px, `prefers-reduced-motion` respected, inputs at 16 px font size (prevents iOS zoom).
14. **Responsive from the first screen**, not retrofitted: every screen must work at 390, 820 and 1440 px wide with no horizontal scroll (layout rules in ARCHITECTURE.md).
15. **Migrations are append-only.** Create them with `npx supabase migration new <name>` (timestamped files). Never edit a migration after it has been pushed to GitHub — it may already be applied; add a new one instead. If a pull request with migrations is abandoned, add a migration that reverts it. Every migration ends by setting `schema_version` to the next integer (see ARCHITECTURE.md §18), and `src/lib/schema.ts` holds `EXPECTED_SCHEMA_VERSION`. Preview builds show a red banner when the database is behind.
16. **Never destructive on the real project.** Do not run SQL against Eduard's Supabase project yourself; changes reach it only through the "Deploy Supabase" Action. A migration never drops or rewrites existing data without Eduard's explicit approval in the PR. Do not merge pull requests. Do not push to `main`.

## 7. How every session works

1. Read this file, `docs/ARCHITECTURE.md` and `docs/TASKS.md`. Eduard will say which task ("Fă T05") or say "următoarea" — then take the first task not marked done.
2. Tell Eduard in Romanian, in 3–5 lines, what you are about to build. Then start. If the task is too large for one session, split it into parts (T05a, T05b) in TASKS.md and deliver a working part — never a half-built screen.
3. Create a branch `tNN-short-name` from the latest `main`.
4. Build it. Read the relevant prompts in `docs/lovable-prompts.md` and the demo for detail before writing UI.
5. Verify (see §8). Fix what you find. Look at the screenshots yourself.
6. Update `docs/TASKS.md`: tick the task, add short notes on decisions and anything deferred.
7. Open a pull request titled `TNN — <nume în română>` with this body, in Romanian:
   - **Ce am făcut** — 3–8 bullets, plain words.
   - **Cum testezi** — numbered click-by-click steps on the Netlify preview link, including which test account/role to use.
   - **Pașii tăi** — exactly what Eduard must do besides Merge: secrets to add (name and where), dashboard settings (click path), one-off SQL. When the PR contains migrations or functions, tell him to check that "Deploy Supabase" is green on the PR before testing. Write "Doar Merge" if nothing else.
   - **Decizii** — anything you decided that he might want to know.
   - **Rămas / riscuri** — what is not done yet.
8. End the session with a short message to Eduard: the PR link, "Pașii tăi" repeated, and what to test first.

If the network blocks a download or API you need, stop and tell Eduard the exact domain to add in the cloud environment settings (**Network access → Custom → Allowed domains**). Do not work around the allowlist.

## 8. Definition of done (every task)

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass. `npm run test:sql` passes when the database changed.
- Every screen touched was opened in Playwright at **390 px and 1440 px** (and 820 px when layout differs), in **Romanian and English**, and in every role that can see it. Every new button was clicked. Screenshots were checked by you.
- Loading, empty and error states exist and look different from each other.
- Changing a value on a screen (a stepper, a checkbox, a chip) never jumps the page back to the top; focus stays in the field being typed in.
- No hard-coded strings; no `console.log` left; no secrets in code.
- RLS covers every new table; a SQL test proves a user cannot read or change another user's rows where it matters.
- TASKS.md updated; PR body complete; "Pașii tăi" lists every manual step.

## 9. Testing the database

- Preferred: start a local Supabase stack with Docker (`npx supabase start`) and apply all migrations; run SQL tests and Playwright flows against it. In the cloud environment start the daemon first (`dockerd &`) and pull from Docker Hub, since `public.ecr.aws` is blocked: `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start -x studio,imgproxy,vector,logflare,supavisor,edge-runtime`. Run `tests/sql/00_test_helpers.sql`, `05_fixtures.sql` and the numbered tests against `postgresql://postgres:postgres@127.0.0.1:54322/postgres` after `npx supabase db reset --no-seed`. `npm run db:types` needs this stack.
- Fallback when Docker images cannot be pulled: the preinstalled PostgreSQL 16 (`service postgresql start`) with a stub `auth` schema (`tests/sql/00_auth_stub.sql`: `auth.users`, `auth.uid()` reading `request.jwt.claim.sub`, roles `anon`/`authenticated`/`service_role`). Apply every migration in order, then run `tests/sql/*.sql`.
- SQL tests must cover at least: capacity under concurrency, every state-machine transition (allowed and refused), abuse limits, odometer validation, RLS isolation between two clients and two shops, and that `authenticated` cannot update protected columns.
- Seed data for local tests: `supabase/seed/dev_seed.sql` — the four demo shops from the reference demo (Brașov, Codlea), one client with two cars, bookings in every status. Never run it on the real project unless Eduard asks.

## 10. Copy and tone

- Romanian UI copy follows the reference demo and the Lovable prompts: short, concrete, friendly, no exclamation marks, no marketing words. Address the user with "tu".
- English copy: natural US English, same brevity ("Book now", "Send quote", "Your car is being inspected").
- Money: RO `1.250 lei`, EN `1,250 RON`. Odometer: RO `105.400 km`, EN `105,400 km`. Dates: RO `Mar 14 oct`, EN `Tue, Oct 14`.
- Brand: "Service-Hub" in text; wordmark `SERVICE-` in `#EAE8E2` and `HUB` in `#F5A524`, one component, never wraps.
