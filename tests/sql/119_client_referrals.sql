-- Invite a friend (T35): the friend's first job finished by a shop gives the inviter one report
-- credit; the same person never invites themselves, one credit per friend, at most
-- `referral_credits_per_year` a year, a credit used once; the browser never reads the invitations.
begin;
select test.make_world();
-- The rules one friend at a time; two friends per report are tested at the end.
update public.platform_settings set limits = limits || '{"referral_friends_per_report": 1}' where id = 1;

create function pg_temp.client(p_n int, p_code text default null, p_phone text default null) returns uuid
language sql as $$
  select test.sign_up('invitat' || p_n || '@test.local', jsonb_build_object(
    'role', 'client', 'name', 'Client ' || p_n,
    'phone', coalesce(p_phone, '07' || lpad((56000000 + p_n)::text, 8, '0')),
    'lang', 'ro', 'terms_version', '2026-10-08', 'referral_code', p_code))
$$;
create function pg_temp.code(p_id uuid) returns text
language sql as $$ select display_id from public.profiles where id = p_id $$;
-- A job of this client at shop1 finished by the shop (as complete_job would), at this amount.
create function pg_temp.finish(p_client uuid, p_cost numeric, p_source text default 'app') returns uuid
language plpgsql as $$
declare
  v uuid := test.raw_booking(test.id('shop1'), p_client, 'in_progress', test.today() - 1, '10:00',
                             'B ' || left(p_client::text, 6));
begin
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set source = p_source where id = v;
  update public.bookings set status = 'done', done_at = now(), cost = p_cost, odometer = 1000 where id = v;
  alter table public.bookings enable trigger bookings_guard;
  return v;
end
$$;
create function pg_temp.credits(p_client uuid) returns int
language sql as $$ select count(*)::int from public.report_credits where client_id = p_client $$;
create function pg_temp.state(p_friend uuid) returns text
language sql as $$
  select status || coalesce(':' || refused_reason, '') from public.client_referrals where client_id = p_friend
$$;

select set_config('test.inviter', pg_temp.client(1)::text, true);
create function pg_temp.inviter() returns uuid language sql as $$ select current_setting('test.inviter')::uuid $$;

-- ------------------------------------------------------------------ the code
select set_config('test.code', pg_temp.code(pg_temp.inviter()), true),
       set_config('test.shop_code', pg_temp.code(test.id('owner1')), true);
select test.login_anon();
select test.eq(public.check_client_invite_code(current_setting('test.code')), true, 'anyone can check a client code');
select test.eq(public.check_client_invite_code(lower(replace(current_setting('test.code'), '-', ' '))), true,
  'typed loosely');
select test.eq(public.check_client_invite_code('C-99999'), false, 'an unknown code');
select test.eq(public.check_client_invite_code(current_setting('test.shop_code')), false,
  'a shop code is not a client invitation');
select test.logout();

-- ------------------------------------------------------------------ auto-invitation refused
select set_config('test.self', pg_temp.client(2, pg_temp.code(pg_temp.inviter()), '0756000001')::text, true);
select test.eq(pg_temp.state(current_setting('test.self')::uuid), 'refused:same_person',
  'a second account with the inviter''s phone: refused at sign-up');
select pg_temp.finish(current_setting('test.self')::uuid, 300);
select test.eq(pg_temp.credits(pg_temp.inviter()), 0, 'and its job brings nothing');

-- ------------------------------------------------------------------ the first job brings one credit
select set_config('test.f3', pg_temp.client(3, pg_temp.code(pg_temp.inviter()))::text, true);
select test.eq(pg_temp.state(current_setting('test.f3')::uuid), 'signed_up', 'a real friend is recorded');
select pg_temp.finish(current_setting('test.f3')::uuid, 0);
select test.eq(pg_temp.credits(pg_temp.inviter()), 0, 'a job finished at 0 lei does not count');
select pg_temp.finish(current_setting('test.f3')::uuid, 250, 'shop');
select test.eq(pg_temp.credits(pg_temp.inviter()), 0, 'nor a job the shop wrote in without the app');
select pg_temp.finish(current_setting('test.f3')::uuid, 250);
select test.eq(pg_temp.credits(pg_temp.inviter()), 1, 'the first job with an amount: one credit');
select test.eq(pg_temp.state(current_setting('test.f3')::uuid), 'rewarded', 'the invitation is rewarded');
select test.eq((select channels from public.notification_events where user_id = pg_temp.inviter() and event = 'report_credit'),
  array['push', 'email'], 'the inviter is told by push and email');

-- ------------------------------------------------------------------ one credit per friend
select pg_temp.finish(current_setting('test.f3')::uuid, 400);
select test.eq(pg_temp.credits(pg_temp.inviter()), 1, 'a second job of the same friend: nothing more');
-- The same person again (a new account, the same phone) invited by someone else.
select set_config('test.other', pg_temp.client(4)::text, true);
select set_config('test.f3bis', pg_temp.client(5, pg_temp.code(current_setting('test.other')::uuid),
  (select phone from public.profiles where id = current_setting('test.f3')::uuid))::text, true);
select pg_temp.finish(current_setting('test.f3bis')::uuid, 300);
select test.eq(pg_temp.state(current_setting('test.f3bis')::uuid), 'refused:same_friend',
  'the same friend (same phone) already brought a credit: refused');
select test.eq(pg_temp.credits(current_setting('test.other')::uuid), 0, 'no credit for the second inviter');

-- ------------------------------------------------------------------ at most 3 a year; the 4th refused
select pg_temp.finish(pg_temp.client(6, pg_temp.code(pg_temp.inviter())), 100);
select pg_temp.finish(pg_temp.client(7, pg_temp.code(pg_temp.inviter())), 100);
select test.eq(pg_temp.credits(pg_temp.inviter()), 3, 'three friends, three credits');
select set_config('test.f8', pg_temp.client(8, pg_temp.code(pg_temp.inviter()))::text, true);
select pg_temp.finish(current_setting('test.f8')::uuid, 100);
select test.eq(pg_temp.credits(pg_temp.inviter()), 3, 'the 4th credit in a year is refused');
select test.eq(pg_temp.state(current_setting('test.f8')::uuid), 'refused:limit', 'as over the limit');

-- The admin setting decides: at 0 nobody gets credits.
update public.platform_settings set limits = limits || '{"referral_credits_per_year": 0}' where id = 1;
select pg_temp.finish(pg_temp.client(9, pg_temp.code(current_setting('test.other')::uuid)), 100);
select test.eq(pg_temp.credits(current_setting('test.other')::uuid), 0, 'limit 0: the reward is off');
update public.platform_settings set limits = limits || '{"referral_credits_per_year": 3}' where id = 1;

-- An inviter who deleted the account gets nothing.
select set_config('test.gone', pg_temp.client(10)::text, true);
select set_config('test.f11', pg_temp.client(11, pg_temp.code(current_setting('test.gone')::uuid))::text, true);
update public.profiles set deleted_at = now() where id = current_setting('test.gone')::uuid;
select pg_temp.finish(current_setting('test.f11')::uuid, 100);
select test.eq(pg_temp.state(current_setting('test.f11')::uuid), 'refused:referrer_gone', 'the inviter is gone');

-- A shop owner with the inviter's phone finishing the friend's job: the same person.
select set_config('test.inv2', pg_temp.client(12, null,
  (select phone from public.profiles where id = test.id('owner1')))::text, true);
select set_config('test.f13', pg_temp.client(13, pg_temp.code(current_setting('test.inv2')::uuid))::text, true);
select pg_temp.finish(current_setting('test.f13')::uuid, 100);
select test.eq(pg_temp.state(current_setting('test.f13')::uuid), 'refused:same_person',
  'the shop that finished the job is the inviter''s: refused');

-- ------------------------------------------------------------------ the browser
select test.login(current_setting('test.inviter')::uuid);
select test.fails('select * from public.client_referrals', 'permission denied', 'the invitations are not readable');
select test.eq((select count(*)::int from public.report_credits), 3, 'the client reads their own credits');
select test.fails($$update public.report_credits set used_at = null$$, 'permission denied', 'and never changes them');
select test.fails(format($$select public.redeem_report_credit(%L, gen_random_uuid())$$, current_setting('test.inviter')::uuid),
  'permission denied', 'only report-checkout uses a credit');
select test.eq(public.my_client_referrals() - 'code',
  '{"invited": 5, "rewarded": 3, "credits_available": 3, "credits_per_year": 3, "friends_per_report": 1, "progress": 0}'::jsonb, 'the counts for the card');
select test.eq(public.my_client_referrals()->>'code', current_setting('test.code'), 'and the code');
select test.login(current_setting('test.f3')::uuid);
select test.eq((select count(*)::int from public.report_credits), 0, 'another client sees none of them');
select test.login(test.id('owner1'));
select test.eq(public.my_client_referrals(), null::jsonb, 'nothing for a shop');
select test.logout();

-- ------------------------------------------------------------------ a credit is used once
-- The inviter needs a finished job of their own for a report.
select pg_temp.finish(pg_temp.inviter(), 500);
select set_config('test.r1', (public.begin_history_report(pg_temp.inviter(), null,
  (select id from public.bookings where client_id = pg_temp.inviter() limit 1), 'ro', gen_random_uuid())->>'id'), true);
select test.eq(public.redeem_report_credit(pg_temp.inviter(), current_setting('test.r1')::uuid)->>'status', 'paid',
  'the report is paid with a credit');
select test.eq((select amount_paid from public.history_reports where id = current_setting('test.r1')::uuid), 0::numeric(10,2),
  'at 0 lei');
select test.eq((select code from public.history_reports where id = current_setting('test.r1')::uuid) is not null, true,
  'and numbered like any report');
select test.eq((select count(*)::int from public.report_credits where client_id = pg_temp.inviter() and used_at is null), 2,
  'one credit used');
select public.redeem_report_credit(pg_temp.inviter(), current_setting('test.r1')::uuid);
select test.eq((select count(*)::int from public.report_credits where client_id = pg_temp.inviter() and used_at is null), 2,
  'the same report again uses nothing');
select test.fails(format($$select public.redeem_report_credit(%L, %L)$$, current_setting('test.other'),
  current_setting('test.r1')), 'not_found', 'another client''s report');

-- The last two credits, then none.
select public.redeem_report_credit(pg_temp.inviter(), (public.begin_history_report(pg_temp.inviter(), null,
  (select id from public.bookings where client_id = pg_temp.inviter() limit 1), 'ro', gen_random_uuid())->>'id')::uuid)
from generate_series(1, 2);
select test.fails(format($$select public.redeem_report_credit(%L, (public.begin_history_report(%L, null, %L, 'ro', gen_random_uuid())->>'id')::uuid)$$,
  pg_temp.inviter(), pg_temp.inviter(), (select id from public.bookings where client_id = pg_temp.inviter() limit 1)),
  'no_credit', 'no credit left: refused');
select test.eq((select count(distinct report_id)::int from public.report_credits where client_id = pg_temp.inviter()), 3,
  'each credit made exactly one report');

-- "Datele mele" holds them.
select test.login(current_setting('test.inviter')::uuid);
select test.eq(jsonb_array_length(public.export_my_data()->'report_credits'), 3, 'the export lists the credits');
select test.login(current_setting('test.f3')::uuid);
select test.eq(public.export_my_data()->>'invited_with_code', current_setting('test.code'), 'and who invited the friend');
select test.logout();

-- The friend's invitation (and its fingerprints) goes 3 years after the account is deleted.
update public.profiles set deleted_at = now() - interval '3 years 1 day' where id = current_setting('test.f8')::uuid;
select public.purge_account_fingerprints();
select test.eq(pg_temp.state(current_setting('test.f8')::uuid), null::text, 'purged 3 years after the friend left');
select test.eq(pg_temp.state(current_setting('test.f3')::uuid), 'rewarded', 'the others stay');

-- ------------------------------------------------------------------ two friends per report (Eduard, 9 Oct)
update public.platform_settings set limits = limits || '{"referral_friends_per_report": 2}' where id = 1;
select set_config('test.inv3', pg_temp.client(20)::text, true);
select set_config('test.code3', pg_temp.code(current_setting('test.inv3')::uuid), true);
select set_config('test.g1', pg_temp.client(21, current_setting('test.code3'))::text, true);
select set_config('test.g2', pg_temp.client(22, current_setting('test.code3'))::text, true);
select pg_temp.finish(current_setting('test.g1')::uuid, 200);
select test.eq(pg_temp.state(current_setting('test.g1')::uuid), 'qualified', 'the first friend counts');
select test.eq(pg_temp.credits(current_setting('test.inv3')::uuid), 0, 'but one friend is not a report yet');
select test.eq((select count(*)::int from public.notification_events where user_id = current_setting('test.inv3')::uuid
                and event = 'report_credit'), 0, 'and nothing is announced');
select test.login(current_setting('test.inv3')::uuid);
select test.eq(public.my_client_referrals() - 'code',
  '{"invited": 2, "rewarded": 0, "credits_available": 0, "credits_per_year": 3, "friends_per_report": 2, "progress": 1}'::jsonb,
  'the card shows 1 of 2');
select test.logout();
-- A second job of the same friend does not count twice.
select pg_temp.finish(current_setting('test.g1')::uuid, 200);
select test.eq(pg_temp.credits(current_setting('test.inv3')::uuid), 0, 'the same friend twice is still one');
select pg_temp.finish(current_setting('test.g2')::uuid, 200);
select test.eq(pg_temp.credits(current_setting('test.inv3')::uuid), 1, 'the second friend: one report');
select test.eq(pg_temp.state(current_setting('test.g1')::uuid) || ' ' || pg_temp.state(current_setting('test.g2')::uuid),
  'rewarded rewarded', 'both friends are counted into it');
select test.eq((select count(distinct credit_id)::int from public.client_referrals
                where client_id in (current_setting('test.g1')::uuid, current_setting('test.g2')::uuid)), 1, 'the same report');
select test.eq((select count(*)::int from public.notification_events where user_id = current_setting('test.inv3')::uuid
                and event = 'report_credit'), 1, 'announced once');
select test.login(current_setting('test.inv3')::uuid);
select test.eq(public.my_client_referrals()->>'progress', '0', 'progress starts again');
select test.logout();

rollback;
