-- A free report given by the admin (Eduard, 15 Oct): only the admin gives it, once per request,
-- the client is told and the log keeps it; it is used like an invitation credit but does not count
-- towards the invitations' yearly limit.
begin;
select test.make_world();
update public.platform_settings
  set limits = limits || '{"referral_friends_per_report": 1, "referral_credits_per_year": 1}' where id = 1;

create function pg_temp.available(p_client uuid) returns int
language sql as $$ select count(*)::int from public.report_credits where client_id = p_client and used_at is null $$;

-- ------------------------------------------------------------------ only the admin
select test.login(test.id('client_a'));
select test.fails($$select public.admin_grant_report_credit(test.id('client_a'), test.rid())$$, 'not_allowed',
  'a client cannot give themselves a free report');
select test.login(test.id('owner1'));
select test.fails($$select public.admin_grant_report_credit(test.id('client_a'), test.rid())$$, 'not_allowed',
  'nor a shop');
select test.logout();
select test.eq(pg_temp.available(test.id('client_a')), 0, 'nothing given');

-- ------------------------------------------------------------------ given
delete from public.notification_events;
select test.login(test.id('admin'));
select test.eq((public.admin_grant_report_credit(test.id('client_a'), '00000000-0000-4000-8000-000000000123')->>'credits_available')::int,
  1, 'the admin gives one');
select test.eq((public.admin_grant_report_credit(test.id('client_a'), '00000000-0000-4000-8000-000000000123')->>'credits_available')::int,
  1, 'the same request twice gives it once');
select test.fails($$select public.admin_grant_report_credit(test.id('owner1'), test.rid())$$, 'not_found', 'only to a client');
select test.fails($$select public.admin_grant_report_credit(test.id('admin'), test.rid())$$, 'not_found', 'not to an admin');
select test.eq(((public.admin_get_client(test.id('client_a'))->'report_credits')->>'available')::int, 1,
  'the client page shows it');
select test.logout();

select test.eq(pg_temp.available(test.id('client_a')), 1, 'one credit');
select test.eq((select source from public.report_credits where client_id = test.id('client_a')), 'admin', 'marked as given by the admin');
select test.eq(count(*), 1::bigint, 'the client is told once, by push and email')
from public.notification_events
where user_id = test.id('client_a') and event = 'report_credit' and params->>'source' = 'admin'
  and channels @> array['push', 'email'];
select test.eq(count(*), 1::bigint, 'and the log keeps it')
from public.admin_audit_log
where entity_id = test.id('client_a')::text and action = 'grant_report_credit'
  and before->>'credits_available' = '0' and after->>'credits_available' = '1';

-- The client sees it as available, not as a reward for invitations.
select test.login(test.id('client_a'));
select test.eq(public.my_client_referrals()->>'credits_available', '1', 'available to the client');
select test.eq(public.my_client_referrals()->>'rewarded', '0', 'not counted as a reward for invitations');
select test.fails($$update public.report_credits set used_at = now() where client_id = test.id('client_a')$$,
  'permission denied', 'the client cannot mark it used');
select test.fails($$insert into public.report_credits (client_id, source) values (test.id('client_a'), 'admin')$$,
  'permission denied', 'nor give one to themselves');
select test.logout();

-- ------------------------------------------------------------------ the invitations' limit
-- With a yearly limit of 1, the admin's credit does not take the place of a friend's.
select set_config('test.friend', test.sign_up('prieten-admin@test.local', jsonb_build_object(
  'role', 'client', 'name', 'Prieten', 'phone', '0756111222', 'lang', 'ro', 'terms_version', '2026-10-08',
  'referral_code', (select display_id from public.profiles where id = test.id('client_a'))))::text, true);
select set_config('test.job', test.raw_booking(test.id('shop1'), current_setting('test.friend')::uuid, 'in_progress',
  test.today() - 1, '10:00', 'B 77 PRT')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set source = 'app', status = 'done', done_at = now(), cost = 300, odometer = 1000
where id = current_setting('test.job')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq((select status from public.client_referrals where client_id = current_setting('test.friend')::uuid),
  'rewarded', 'a friend''s first job still brings its credit');
select test.eq(pg_temp.available(test.id('client_a')), 2, 'two free reports now');

rollback;
