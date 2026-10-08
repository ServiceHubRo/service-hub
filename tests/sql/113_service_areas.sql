-- Zones (Eduard, 8 Oct): the counties, a shop's zone, the client's waiting list, the zone that
-- starts (automatic or by the admin) and the one message to each waiting client; constatare tehnică.
begin;
select test.make_world();
delete from public.notification_events;

create function pg_temp.events(p_event text, p_user uuid) returns bigint
language sql as $$ select count(*) from public.notification_events where event = p_event and user_id = p_user $$;

-- ------------------------------------------------------------------ the zones
select test.eq((select count(*) from public.service_areas), 42::bigint, '41 counties and Bucharest');
select test.eq((select area from public.shops where id = test.id('shop1')), 'BV', 'Brașov → BV');
select test.eq((select area from public.shops where id = test.id('shop2')), 'BV', 'Codlea → BV (a town we know)');

select test.eq(public.area_for_address('jud. Bistrița Năsăud', 'Altundeva', null, null), 'BN', 'the county typed wins');
select test.eq(public.area_for_address('cj', null, null, null), 'CJ', 'a two-letter code');
select test.eq(public.area_for_address(null, 'Sector 3', null, null), 'B', 'a sector of Bucharest');
select test.eq(public.area_for_address(null, 'Municipiul București', null, null), 'B', 'Bucharest, spelled out');
select test.eq(public.area_for_address(null, 'Satul Nimănui', 46.77, 23.60), 'CJ', 'an unknown village: its coordinates');
select test.ok(public.area_for_address(null, 'Satul Nimănui', null, null) is null, 'nothing known: no zone');
-- The same towns the browser uses (src/lib/areas.ts, tests/unit/areas.test.ts).
select test.eq(public.area_for_point(45.86, 25.79), 'CV', 'Sfântu Gheorghe → Covasna, not Brașov');
select test.eq(public.area_for_point(44.55, 26.07), 'IF', 'Otopeni → Ilfov');
select test.eq(public.area_for_point(44.43, 26.10), 'B', 'Piața Unirii → Bucharest');
select test.eq(public.area_for_point(45.70, 25.45), 'BV', 'Codlea → Brașov');
select test.ok(public.area_for_point(48.85, 2.35) is null, 'Paris: no zone');

-- The address changes, the zone follows (the browser cannot write it).
update public.shops set county = 'Covasna' where id = test.id('shop2');
select test.eq((select area from public.shops where id = test.id('shop2')), 'CV', 'a new county → a new zone');
update public.shops set county = null where id = test.id('shop2');
select test.login(test.id('owner2'));
select test.fails(format('update public.shops set area = %L where id = %L', 'CJ', test.id('shop2')),
  'permission denied', 'the owner cannot set the zone');
select test.logout();

-- ------------------------------------------------------------------ what the client sees
select test.login(test.id('client_a'));
select test.eq((select (z->>'live')::boolean from jsonb_array_elements(public.list_service_areas()) z where z->>'code' = 'BV'),
  true, 'Brașov works: shop1 is public');
select test.eq((select (z->>'live')::boolean from jsonb_array_elements(public.list_service_areas()) z where z->>'code' = 'CJ'),
  false, 'Cluj does not yet');
select test.ok(jsonb_array_length((select z->'anchors' from jsonb_array_elements(public.list_service_areas()) z
  where z->>'code' = 'IF')) > 3, 'with the towns to place a position');
select test.logout();
select test.login_anon();
select test.fails('select public.list_service_areas()', 'permission denied', 'not signed out');
select test.logout();

-- ------------------------------------------------------------------ the waiting list
select test.login(test.id('client_a'));
select set_config('test.r1', gen_random_uuid()::text, true);
select test.eq(public.join_area_waitlist('CJ', '  Florești ', array['cat_fra', 'cat_rev', 'cat_fra'],
  current_setting('test.r1')::uuid)->>'area', 'CJ', 'client_a waits for Cluj');
select test.eq((select locality from public.area_waitlist where client_id = test.id('client_a')), 'Florești', 'trimmed');
select test.eq((select categories from public.area_waitlist where client_id = test.id('client_a')),
  array['cat_fra', 'cat_rev'], 'categories once each');
select test.eq(public.join_area_waitlist('SM', null, null, current_setting('test.r1')::uuid)->>'area', 'CJ',
  'the same request again: the first answer, nothing changed');
select test.eq((select area from public.area_waitlist where client_id = test.id('client_a')), 'CJ', 'still Cluj');
select test.fails(format('select public.join_area_waitlist(%L, null, null, %L)', 'BV', gen_random_uuid()),
  'area_live', 'Brașov already works: book there');
select test.fails(format('select public.join_area_waitlist(%L, null, null, %L)', 'XX', gen_random_uuid()),
  'area_not_found', 'an unknown zone');
select test.fails(format('select public.join_area_waitlist(%L, null, array[%L], %L)', 'CJ', 'cat_nope', gen_random_uuid()),
  'category_not_found', 'an unknown category');
select test.fails(format('select public.join_area_waitlist(%L, %L, null, %L)', 'CJ', repeat('x', 81), gen_random_uuid()),
  'field_invalid', 'a locality too long');
select test.fails(format('insert into public.area_waitlist (client_id, area) values (%L, %L)', test.id('client_a'), 'TM'),
  'permission denied', 'no direct writes');
select test.logout();

select test.login(test.id('client_b'));
select test.eq(test.count('select 1 from public.area_waitlist'), 0::bigint, 'client_b cannot see client_a''s entry');
select public.join_area_waitlist('CV', null, null, gen_random_uuid());
select test.eq(test.count('select 1 from public.area_waitlist'), 1::bigint, 'only their own');
select test.logout();

select test.login(test.id('owner1'));
select test.fails(format('select public.join_area_waitlist(%L, null, null, %L)', 'CJ', gen_random_uuid()),
  'not_allowed', 'shops do not wait');
select test.logout();

-- ------------------------------------------------------------------ the admin starts a zone
select test.login(test.id('client_a'));
select test.fails('select public.admin_list_service_areas()', 'not_allowed', 'admin only');
select test.fails(format('select public.admin_set_area_mode(%L, %L, %L)', 'CJ', 'on', gen_random_uuid()),
  'not_allowed', 'admin only');
select test.logout();

select test.login(test.id('admin'));
select test.eq((select (z->>'waiting')::int from jsonb_array_elements(public.admin_list_service_areas()->'areas') z
  where z->>'code' = 'CJ'), 1, 'one client waits in Cluj');
select test.eq((select z->'localities'->0->>'name' from jsonb_array_elements(public.admin_list_service_areas()->'areas') z
  where z->>'code' = 'CJ'), 'Florești', 'from Florești');
select test.eq((select (z->'categories'->0->>'count')::int from jsonb_array_elements(public.admin_list_service_areas()->'areas') z
  where z->>'code' = 'CJ'), 1, 'counted per kind of work');
select test.fails(format('select public.admin_set_area_mode(%L, %L, %L)', 'CJ', 'soon', gen_random_uuid()),
  'mode_invalid', 'auto, on or off');
select test.eq((public.admin_set_area_mode('CJ', 'on', gen_random_uuid())->>'notified')::int, 1, 'Cluj on: one message');
select test.logout();

select test.eq(pg_temp.events('area_launched', test.id('client_a')), 1::bigint, 'client_a is told');
select test.eq((select channels from public.notification_events where event = 'area_launched'), array['push', 'email'],
  'push and email (the app may be gone)');
select test.eq((select params->>'area_ro' from public.notification_events where event = 'area_launched'), 'Cluj', 'which zone');
select test.ok((select notified_at is not null from public.area_waitlist where client_id = test.id('client_a')), 'marked told');
select test.ok((select launched_at is not null from public.service_areas where code = 'CJ'), 'the day it started');
select test.eq((select count(*) from public.admin_audit_log where action = 'update_area' and entity_id = 'CJ'), 1::bigint, 'audited');
select public.notify_area_launches();
select test.eq(pg_temp.events('area_launched', test.id('client_a')), 1::bigint, 'never twice');
select test.ok(public.is_quiet_event('area_launched'), 'it waits out the quiet hours');

-- ------------------------------------------------------------------ automatic: the first public shop
select test.eq(public.notify_area_launches(), 0, 'Covasna has no shop yet');
update public.shops set county = 'Covasna' where id = test.id('shop1');
select test.eq(public.notify_area_launches(), 1, 'shop1 moved to Covasna: client_b is told');
select test.eq(pg_temp.events('area_launched', test.id('client_b')), 1::bigint, 'client_b got it');
select test.ok(not public.area_live('BV'), 'Brașov has no public shop left (shop2 is not public)');

-- Forced off: hidden from the card even with a public shop; a client may wait again.
select test.login(test.id('admin'));
select public.admin_set_area_mode('CV', 'off', gen_random_uuid());
select test.logout();
select test.ok(not public.area_live('CV'), 'off is off');
select test.login(test.id('client_b'));
select test.ok((public.join_area_waitlist('CV', 'Covasna', null, gen_random_uuid())->>'notified_at') is not null,
  'the same zone again keeps the earlier message (never twice)');
select public.join_area_waitlist('TM', null, null, gen_random_uuid());
select test.ok((select notified_at is null from public.area_waitlist), 'a new zone starts over');
select test.ok(public.export_my_data() ? 'area_waitlist', 'in "Datele mele"');
select test.eq(public.export_my_data()->'area_waitlist'->>'area', 'Timiș', 'with the zone');
select test.eq((public.leave_area_waitlist(gen_random_uuid())->>'removed')::int, 1, '"Nu mai vreau"');
select test.eq(test.count('select 1 from public.area_waitlist'), 0::bigint, 'gone');
select test.logout();

-- ------------------------------------------------------------------ welcome tips while waiting
delete from public.notification_events;
delete from public.engagement_log;
select set_config('test.c', test.sign_up('waiting@test.local',
  '{"role":"client","name":"Ina Pop","phone":"0722000999","lang":"ro","terms_version":"2026-09"}')::text, true);
update public.profiles set created_at = now() - interval '4 days' where id = current_setting('test.c')::uuid;
insert into public.push_subscriptions (endpoint, user_id, subscription)
values ('https://push.test/waiting', current_setting('test.c')::uuid, '{"keys":{"p256dh":"x","auth":"y"}}');
select test.login(current_setting('test.c')::uuid);
select public.join_area_waitlist('SV', null, null, gen_random_uuid());
select test.logout();
select public.send_welcome_tips();
select test.eq(pg_temp.events('welcome', current_setting('test.c')::uuid), 0::bigint,
  'no "find a shop near you" while the zone does not work');
delete from public.area_waitlist;
select public.send_welcome_tips();
select test.eq(pg_temp.events('welcome', current_setting('test.c')::uuid), 1::bigint, 'off the list: the tip goes');

-- ------------------------------------------------------------------ constatare tehnică
select test.ok(exists (select 1 from public.services where id = 'constatare' and enabled), 'the service exists');
select test.eq((select category_key from public.services where id = 'constatare'), 'cat_itp', 'under checks');
select test.eq((select position from public.services where id = 'constatare'), 0, 'first there');

rollback;
