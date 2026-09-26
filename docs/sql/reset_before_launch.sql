-- One-off, before the launch (docs/LANSARE.md): deletes every client and shop account and
-- everything they made, and starts the numbers again (C-00001, S-00001, P-000001, SH-…-000001).
--
-- Kept: admin accounts (with their number), the platform settings, the service catalog, the push
-- keys. The free-period and suspension fingerprints go too, so nobody is blocked by a test account.
--
-- Run by Eduard in the Supabase SQL Editor, after emptying the `logos` and `reports` buckets
-- (Storage → bucket → Empty bucket). It is one transaction: it either does everything or nothing.
-- It refuses on a database with more than 300 client and shop accounts, so it cannot wipe a
-- platform already in use by mistake. Never part of the migrations.

do $$
declare
  v_accounts int;
  v_admin_max bigint;
begin
  select count(*) into v_accounts from public.profiles where role <> 'admin';
  if v_accounts > 300 then
    raise exception 'Refused: % client and shop accounts. This script is only for test data before the launch.', v_accounts;
  end if;

  -- Everything accounts made (no row triggers run, and bookings no longer hold shops back).
  truncate public.bookings, public.quotes, public.quote_items, public.reviews, public.messages,
    public.threads, public.notification_events, public.notifications_log, public.client_reminders,
    public.history_reports, public.invoices, public.cars, public.favorites, public.shops,
    public.shop_billing, public.shop_hours, public.shop_closures, public.shop_services,
    public.shop_staff, public.subscriptions, public.notices, public.notice_reads,
    public.admin_audit_log, public.request_log, public.stripe_events
    restart identity cascade;

  -- The accounts themselves (their profiles, push subscriptions, phone codes and sign-ins go with them).
  delete from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id and p.role = 'admin');

  truncate public.account_fingerprints restart identity;

  -- The numbers start again; an admin keeps theirs and the next admin comes after it.
  alter sequence public.display_id_client_seq restart with 1;
  alter sequence public.display_id_shop_seq restart with 1;
  alter sequence public.booking_ref_seq restart with 1;
  alter sequence public.history_report_code_seq restart with 1;
  select max(regexp_replace(display_id, '\D', '', 'g')::bigint) into v_admin_max
  from public.profiles where role = 'admin';
  if v_admin_max is null then
    alter sequence public.display_id_admin_seq restart with 1;
  else
    perform setval('public.display_id_admin_seq', v_admin_max);
  end if;
end
$$;

-- What is left: only the admins.
select
  (select count(*) from auth.users) as accounts,
  (select count(*) from public.profiles where role = 'admin') as admins,
  (select count(*) from public.shops) as shops,
  (select count(*) from public.bookings) as bookings;
