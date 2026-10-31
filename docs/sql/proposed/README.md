# Proposed migrations (not applied)

Files here are **not** in `supabase/migrations/`, so the "Deploy Supabase" Action never runs them.
Each one waits for Eduard's approval. Checked locally (PostgreSQL 16 with the auth stub): every
migration, then the proposed one, then every test in `tests/sql/` plus the proposed test, then the
demo seed — all passed on 31 Oct 2026.

## t63b_companies.sql — companies and members (T63b)
Adds only: `platform_settings.fleet_enabled` (false), tables `companies`, `company_members`,
`company_audit_log` (RLS on, select only, no write grants), the rights helpers (`company_role`,
`fleet_can`, `fleet_role_can`) and the functions `create_company`, `update_company`,
`set_company_rules`, `invite_company_member`, `get_company_invite`, `accept_company_invite`,
`set_company_member_role`, `remove_company_member`, `transfer_company_admin`, `my_companies`,
`list_company_members`, `company_deletion_blockers`. Changes no existing table, row, policy or
function. `schema_version` 91.

When approved, in one commit:
1. `npx supabase migration new companies`, paste the file; `src/lib/schema.ts` → 91.
2. `t63b_companies.test.sql` → `tests/sql/134_companies.sql`.
3. Apply `t63b_50_platform.diff` to `tests/sql/50_platform.sql` (the lists of functions callable by
   visitors and by signed-in users gain the new ones, on purpose).
4. The new error codes in `src/data/rpc.ts` + `ro.ts`/`en.ts`: `fleet_disabled`, `company_clients_only`,
   `company_not_found`, `company_name_invalid`, `company_vat_invalid`, `company_regcom_invalid`,
   `company_address_invalid`, `limit_companies`, `company_rules_invalid`, `company_role_invalid`,
   `member_exists`, `limit_members`, `invite_other_email`, `member_not_found`, `last_admin`,
   `transfer_invalid`.
5. A unit test that the SQL capability matrix equals `src/lib/fleet/permissions.ts`.
6. `npm run db:types`; the Cont screens (create a company, invite, members, the space switcher) and
   `delete-account` refusing while the user is a company's only admin with other members.
