-- Bookings added by the shop (T29): a client without an account, typed in by the shop; the
-- invitation; the shop records the answer to the quote; the client takes it into an account with
-- the same verified phone or email.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

create function pg_temp.add(p_slot text, p_phone text, p_email text default null, p_invite boolean default true)
returns uuid language plpgsql as $$
begin
  return (public.shop_create_booking(
    p_service_id => 'ulei', p_date => current_setting('test.day')::date, p_slot => p_slot::time,
    p_client_name => 'Dan Marin', p_client_phone => p_phone,
    p_car => '{"make":"Opel","model":"Astra","plate":"BV 07 DAN","year":"2016"}',
    p_request_id => gen_random_uuid(), p_client_email => p_email, p_send_invite => p_invite)).id;
end $$;
grant execute on function pg_temp.add(text, text, text, boolean) to public;

-- ------------------------------------------------------------------ adding
select test.login(test.id('owner1'));
select set_config('test.b', pg_temp.add('11:00', '0745 111 222', 'Dan@Example.ro')::text, true);
select test.logout();
select test.eq(status, 'confirmed', 'confirmed at once') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(source, 'shop', 'marked as added by the shop') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(client_id, null::uuid, 'no account') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(client_phone, '+40745111222', 'phone normalized') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(client_email, 'dan@example.ro', 'email in lower case') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(car_snapshot->>'plate_norm', 'BV07DAN', 'the car with its plate') from public.bookings where id = current_setting('test.b')::uuid;
select test.ok(invite_sent_at is not null, 'the invitation went out') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(channels, array['sms', 'email'], 'by SMS and email'),
       test.eq(params->>'phone', '+40745111222', 'to that phone'),
       test.eq(char_length(params->>'token'), 16, 'with the link token')
from public.notification_events where event = 'walk_in_invite' and booking_id = current_setting('test.b')::uuid;

select test.login(test.id('staff1'));
select test.ok(pg_temp.add('16:00', '0745111333', null, false) is not null, 'a colleague can add one too');
select test.logout();
select test.eq(count(*), 0::bigint, 'no invitation when the shop says so')
from public.notification_events e join public.bookings b on b.id = e.booking_id
where e.event = 'walk_in_invite' and b.client_phone = '+40745111333';

select test.login(test.id('owner1'));
select test.fails($$select pg_temp.add('12:00', '12345')$$, 'phone_invalid', 'a real Romanian phone');
select test.fails($$select pg_temp.add('12:00', '0745111222', 'not-an-email')$$, 'email_invalid', 'a real email or none');
select test.fails(format($f$select public.shop_create_booking(p_service_id => 'ulei', p_date => %L, p_slot => '12:00',
  p_client_name => 'Dan', p_client_phone => '0745111222', p_car => '{"make":"Opel","model":"Astra"}',
  p_request_id => gen_random_uuid())$f$, current_setting('test.day')), 'car_plate_required', 'the plate is required');
select test.fails(format($f$select public.shop_create_booking(p_service_id => 'ulei', p_date => %L, p_slot => '12:00',
  p_client_name => '  ', p_client_phone => '0745111222', p_car => '{"make":"Opel","model":"Astra","plate":"B1"}',
  p_request_id => gen_random_uuid())$f$, current_setting('test.day')), 'client_name_required', 'a name is required');
select test.fails(format($f$select public.shop_create_booking(p_service_id => 'ulei', p_date => %L, p_slot => '12:00',
  p_client_name => 'Dan', p_client_phone => '0745111222', p_car => '{"make":"Opel","model":"Astra","plate":"B1"}',
  p_request_id => gen_random_uuid())$f$, test.today() - 1), 'past_slot', 'never in the past');
select test.logout();

-- The day's capacity counts them like any other booking.
update public.shops set daily_capacity = (select count(*) from public.bookings b
  where b.shop_id = test.id('shop1') and b.date = current_setting('test.day')::date and public.is_active_status(b.status))
where id = test.id('shop1');
select test.login(test.id('owner1'));
select test.fails($$select pg_temp.add('13:00', '0745111444')$$, 'day_full', 'a full day stays full');
select test.logout();
update public.shops set daily_capacity = 10 where id = test.id('shop1');

-- Only a shop adds them.
select test.login(test.id('client_a'));
select test.fails($$select pg_temp.add('13:00', '0745111444')$$, 'not_allowed', 'a client cannot');
select test.logout();

-- At most `walk_in_invites_per_day` invitations a day.
update public.platform_settings set limits = limits || '{"walk_in_invites_per_day": 1}'::jsonb where id = 1;
select test.login(test.id('owner1'));
select set_config('test.over', pg_temp.add('13:00', '0745111555')::text, true);
select test.logout();
select test.eq(invite_sent_at, null::timestamptz, 'over the daily limit: booked, but no message')
from public.bookings where id = current_setting('test.over')::uuid;
update public.platform_settings set limits = limits - 'walk_in_invites_per_day' where id = 1;

-- ------------------------------------------------------------------ the link, without an account
select set_config('test.token', (select invite_token from public.bookings where id = current_setting('test.b')::uuid), true);
select test.login_anon();
select test.eq(public.invite_preview(current_setting('test.token'))->>'shop_name', 'Atelier Unu', 'the link shows the shop');
select test.eq(public.invite_preview(current_setting('test.token')) ? 'client_phone', false, 'and no personal data');
select test.eq(public.invite_preview('0000000000000000'), null::jsonb, 'a wrong link shows nothing');
select test.fails(format('select public.claim_booking(%L)', current_setting('test.token')), 'permission denied',
  'taking it needs an account');
select test.logout();

-- ------------------------------------------------------------------ the quote, answered at the shop
select test.login(test.id('owner1'));
select public.start_inspection(current_setting('test.b')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.b')::uuid, '[{"name":"Ulei","price":200},{"name":"Filtru","price":80}]', gen_random_uuid());
select set_config('test.q', (select id from public.quotes where booking_id = current_setting('test.b')::uuid and status = 'sent')::text, true);
select test.fails(format('select public.shop_decide_quote(%L, %L, array[]::uuid[], gen_random_uuid())',
  current_setting('test.b'), gen_random_uuid()), 'quote_changed', 'the quote on screen');
select public.shop_decide_quote(current_setting('test.b')::uuid, current_setting('test.q')::uuid,
  array(select id from public.quote_items where quote_id = current_setting('test.q')::uuid and name = 'Ulei'), gen_random_uuid());
select test.logout();
select test.eq(status, 'approved', 'the client said yes, at the shop') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(decided_by, 'shop', 'recorded by the shop'),
       test.eq(status, 'partially_accepted', 'only the oil'),
       test.eq(total_approved, 200::numeric, 'its price')
from public.quotes where id = current_setting('test.q')::uuid;
-- A booking of a client with an account is answered by the client.
select test.login(test.id('owner1'));
select test.fails(format('select public.shop_decide_quote(%L, gen_random_uuid(), array[]::uuid[], gen_random_uuid())',
  (select id from public.bookings where client_id = test.id('client_a') limit 1)), 'not_allowed', 'not for app bookings');
select test.logout();
select test.login(test.id('owner2'));
select test.fails(format('select public.shop_decide_quote(%L, %L, array[]::uuid[], gen_random_uuid())',
  current_setting('test.b'), current_setting('test.q')), 'not_allowed', 'not another shop');
select test.logout();

-- ------------------------------------------------------------------ taking it into an account
select set_config('test.dan', test.sign_up('dan.other@test.local',
  '{"role":"client","name":"Dan Marin","phone":"0745111222","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.eve', test.sign_up('eve@test.local',
  '{"role":"client","name":"Eva","phone":"0745999888","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(current_setting('test.eve')::uuid);
select test.fails(format('select public.claim_booking(%L)', current_setting('test.token')), 'invite_mismatch',
  'another phone and email: refused');
select test.logout();
select test.login(current_setting('test.dan')::uuid);
select test.fails(format('select public.claim_booking(%L)', current_setting('test.token')), 'phone_not_verified',
  'the same phone, not confirmed yet');
select test.logout();
update public.profiles set phone_verified_at = now() where id = current_setting('test.dan')::uuid;
-- A second booking for the same phone, at the same shop.
select test.login(test.id('owner1'));
select set_config('test.b2', pg_temp.add('14:00', '+40 745 111 222', null, false)::text, true);
select test.logout();
select test.login(current_setting('test.dan')::uuid);
select test.eq((public.claim_booking(current_setting('test.token'))->>'claimed')::int, 2, 'both bookings for that phone');
select test.eq((public.claim_booking(current_setting('test.token'))->>'claimed')::int, 0, 'a second tap does nothing');
select test.eq(test.count('select 1 from public.bookings where source = ''shop'''), 2::bigint, 'the client sees them now');
select test.eq(test.count($$select 1 from public.cars where plate_norm = 'BV07DAN'$$), 1::bigint, 'the car in the garage, once');
select test.eq(public.invite_preview(current_setting('test.token'))->>'mine', 'true', 'the link knows it is mine');
select test.logout();
select test.eq(client_id, current_setting('test.dan')::uuid, 'linked to the account'),
       test.ok(claimed_at is not null, 'with the time'),
       test.ok(car_id is not null, 'and the car')
from public.bookings where id = current_setting('test.b')::uuid;
select test.ok(exists (select 1 from public.threads where shop_id = test.id('shop1') and client_id = current_setting('test.dan')::uuid),
  'messages with the shop are open');
select test.login(current_setting('test.eve')::uuid);
select test.fails(format('select public.claim_booking(%L)', current_setting('test.token')), 'invite_used', 'taken already');
select test.logout();
-- A no-show of a booking the shop added never counts against the client.
update public.bookings set status = 'no_show' where id = current_setting('test.b2')::uuid;
select test.login(current_setting('test.dan')::uuid);
select test.eq(public.client_no_show_count(current_setting('test.dan')::uuid), 0, 'not a no-show of the client');
select test.logout();
select test.ok(public.instant_for_client(current_setting('test.dan')::uuid), 'still confirmed at once elsewhere');
update public.bookings set status = 'confirmed' where id = current_setting('test.b2')::uuid;
-- Now the client answers in the app, not the shop.
select test.login(test.id('owner1'));
select test.fails(format('select public.shop_decide_quote(%L, gen_random_uuid(), array[]::uuid[], gen_random_uuid())',
  current_setting('test.b2')), 'not_allowed', 'the shop no longer answers for the client');
select test.logout();

-- By email: an account with the same (confirmed) email takes it without a phone code.
select test.login(test.id('owner1'));
select set_config('test.b3', pg_temp.add('15:00', '0745777666', 'ioana@test.local')::text, true);
select test.logout();
select set_config('test.ioana', test.sign_up('ioana@test.local',
  '{"role":"client","name":"Ioana","phone":"0712000000","lang":"en","terms_version":"2026-09"}')::text, true);
select set_config('test.token3', (select invite_token from public.bookings where id = current_setting('test.b3')::uuid), true);
select test.login(current_setting('test.ioana')::uuid);
select test.eq((public.claim_booking(current_setting('test.token3'))->>'claimed')::int,
  1, 'the same email takes it');
select test.logout();
select test.eq(client_lang, 'en', 'in the client''s language from now on') from public.bookings where id = current_setting('test.b3')::uuid;

-- ------------------------------------------------------------------ reviews of them are checked
insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text)
values (current_setting('test.b')::uuid, test.id('shop1'), current_setting('test.dan')::uuid, 'Dan M.', 5, 'Super');
select test.ok('shop_added' = any (public.review_signals(r)), 'flagged: added by the shop'),
       test.ok(public.is_suspect_review(public.review_signals(r)), 'and shown to the admin')
from public.reviews r where r.booking_id = current_setting('test.b')::uuid;

rollback;
