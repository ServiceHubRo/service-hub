-- A11 — the rest of the master audit (13 Nov 2026): a suspended shop's bookings that have not
-- started are cancelled and their clients told, jobs already begun go on; one company per CUI;
-- the platform settings are read through functions. Fails on schema 121.
begin;
select test.make_fleet();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';

create function pg_temp.events(p_booking uuid, p_event text) returns bigint
language sql security definer as $$ select count(*) from public.notification_events where booking_id = p_booking and event = p_event $$;
create function pg_temp.event_of(p_booking uuid, p_event text) returns public.notification_events
language sql security definer as $$ select * from public.notification_events where booking_id = p_booking and event = p_event limit 1 $$;
create function pg_temp.messages(p_booking uuid, p_event text) returns bigint
language sql security definer as $$ select count(*) from public.messages where booking_id = p_booking and event = p_event $$;
create function pg_temp.booking(p_id uuid) returns public.bookings
language sql security definer as $$ select * from public.bookings where id = p_id $$;
grant execute on all functions in schema pg_temp to public;

-- ------------------------------------------------------------------ 1. a suspended shop's bookings
-- shop1: a waiting request (Ana, Romanian), a confirmed booking (Bogdan, English), and two jobs
-- already begun (in inspection, in work).
select set_config('test.pending', test.book(test.id('client_a'), test.id('shop1'), test.workday(1), '09:00', 'ulei', 'B 11 SUS')::text, true);
select set_config('test.confirmed', test.book(test.id('client_b'), test.id('shop1'), test.workday(1), '10:00', 'ulei', 'B 12 SUS')::text, true);
select set_config('test.inspection', test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '09:00', 'frane', 'B 13 SUS')::text, true);
select set_config('test.working', test.raw_booking(test.id('shop1'), test.id('client_b'), 'in_progress', test.today(), '08:00')::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.confirmed')::uuid, gen_random_uuid());
select public.confirm_booking(current_setting('test.inspection')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.inspection')::uuid, gen_random_uuid());
select test.logout();
-- Another shop's booking must not be touched.
update public.profiles set phone_verified_by_admin = true where id = test.id('owner2');
insert into public.shop_services (shop_id, service_id) values (test.id('shop2'), 'ulei') on conflict do nothing;

select set_config('test.rid', gen_random_uuid()::text, true);
select test.login(test.id('admin'));
select test.eq(public.admin_set_shop_suspended(test.id('shop1'), true, 'Reclamații repetate', current_setting('test.rid')::uuid)->>'suspended', 'true',
  'the shop is suspended');
select test.logout();

select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).status, 'cancelled', 'the waiting request is cancelled');
select test.eq((pg_temp.booking(current_setting('test.confirmed')::uuid)).status, 'cancelled', 'the confirmed booking is cancelled');
select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).cancelled_by, 'admin', 'by the platform');
select test.ok((pg_temp.booking(current_setting('test.pending')::uuid)).cancelled_at is not null, 'with its time');
select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).cancel_reason, 'Service-ul nu mai este disponibil pe Service-Hub.',
  'the reason is the platform''s sentence, in Romanian for a Romanian booking');
select test.eq((pg_temp.booking(current_setting('test.confirmed')::uuid)).cancel_reason, 'The shop is no longer available on Service-Hub.',
  'and in English for an English one');
select test.ok(position('Reclamații' in (pg_temp.booking(current_setting('test.pending')::uuid)).cancel_reason) = 0,
  'never the admin''s reason for the suspension');
select test.eq((pg_temp.booking(current_setting('test.inspection')::uuid)).status, 'in_inspection', 'a job in inspection goes on');
select test.eq((pg_temp.booking(current_setting('test.working')::uuid)).status, 'in_progress', 'a job in work goes on');
select test.eq((pg_temp.booking(test.id('booking_b'))).status, 'pending', 'another shop''s booking is untouched');

-- Each client is told once, with the platform's reason; the thread has the automatic message.
select test.eq(pg_temp.events(current_setting('test.pending')::uuid, 'booking_cancelled_admin'), 1::bigint, 'one notification for the waiting request');
select test.eq(pg_temp.events(current_setting('test.confirmed')::uuid, 'booking_cancelled_admin'), 1::bigint, 'one for the confirmed booking');
select test.eq((pg_temp.event_of(current_setting('test.pending')::uuid, 'booking_cancelled_admin')).user_id, test.id('client_a'), 'sent to its client');
select test.eq((pg_temp.event_of(current_setting('test.confirmed')::uuid, 'booking_cancelled_admin')).params->>'reason',
  'The shop is no longer available on Service-Hub.', 'with the reason the client reads');
select test.eq(pg_temp.events(current_setting('test.inspection')::uuid, 'booking_cancelled_admin'), 0::bigint, 'none for a job that goes on');
select test.eq(pg_temp.messages(current_setting('test.pending')::uuid, 'booking_cancelled_admin'), 1::bigint, 'the thread says who cancelled, once');

-- The same request again changes nothing and tells nobody twice.
select test.login(test.id('admin'));
select test.eq(public.admin_set_shop_suspended(test.id('shop1'), true, 'Reclamații repetate', current_setting('test.rid')::uuid)->>'suspended', 'true',
  'the same request replayed answers the same');
select test.logout();
select test.eq(pg_temp.events(current_setting('test.pending')::uuid, 'booking_cancelled_admin'), 1::bigint, 'and sends nothing again');

-- The suspended shop finishes what it began, takes nothing new.
select test.login(test.id('owner1'));
select test.eq((public.send_quote(current_setting('test.inspection')::uuid, '[{"name":"Plăcuțe","price":280}]'::jsonb, gen_random_uuid(), null, null)).status,
  'quote_sent', 'the suspended shop still sends the quote of a job it began');
select test.logout();
select test.fails(format($$select test.book(%L, %L, %L, '11:00', 'ulei', 'B 14 SUS')$$, test.id('client_a'), test.id('shop1'), test.workday(3)),
  'shop_unavailable', 'nobody books a suspended shop');

-- Reactivated: nothing comes back by itself, new bookings are possible again.
select test.login(test.id('admin'));
select public.admin_set_shop_suspended(test.id('shop1'), false, 'Verificat', gen_random_uuid());
select test.logout();
select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).status, 'cancelled', 'a cancelled booking stays cancelled after reactivation');
select test.ok(test.book(test.id('client_a'), test.id('shop1'), test.workday(3), '11:00', 'ulei', 'B 14 SUS') is not null, 'and the shop takes bookings again');

-- Only an admin; the helper is not callable.
select test.login(test.id('owner1'));
select test.fails(format($$select public.admin_set_shop_suspended(%L, true, 'x', gen_random_uuid())$$, test.id('shop2')), 'not_allowed', 'a shop cannot suspend a shop');
select test.fails(format($$select public.cancel_unstarted_bookings_of_suspended_shop(%L)$$, test.id('shop2')), 'permission denied', 'nor call the helper');
select test.fails(format($$select public.admin_set_shop_suspended_a10(%L, true, 'x', gen_random_uuid())$$, test.id('shop2')), 'permission denied', 'nor the inner function');
select test.logout();

-- ------------------------------------------------------------------ 2. one company per CUI
select test.login(test.id('client_a'));
select test.eq(public.update_company(test.id('co'), 'Flota SRL', 'RO14872301', null, null, gen_random_uuid())->>'vat_id', 'RO14872301', 'a company takes a CUI');
select test.eq(public.update_company(test.id('co'), 'Flota Nouă SRL', 'RO14872301', null, 'Str. Lungă 1', gen_random_uuid())->>'name', 'Flota Nouă SRL',
  'and keeps saving its other details with the same CUI');
select test.logout();

select test.login(test.id('out'));
select test.fails($$select public.create_company('Clona SRL', 'RO14872301', null, null, gen_random_uuid())$$, 'company_vat_taken', 'a second company with the same CUI is refused');
select test.fails($$select public.create_company('Clona SRL', '14872301', null, null, gen_random_uuid())$$, 'company_vat_taken', 'without the RO prefix too');
select test.fails($$select public.create_company('Clona SRL', 'ro 14872301', null, null, gen_random_uuid())$$, 'company_vat_taken', 'and in another spelling');
select test.fails(format($$select public.update_company(%L, 'Alta SRL', '14872301', null, null, gen_random_uuid())$$, test.id('co2')), 'company_vat_taken',
  'an existing company cannot change to a CUI that is taken');
select test.eq(test.count($$select 1 from public.companies where name like 'Clona%'$$), 0::bigint, 'a refused company is not left behind');
select test.eq(test.count($$select 1 from public.companies$$), 1::bigint, 'the caller still has only their own company');
-- Without a CUI, and with another CUI, as before.
select test.ok(public.create_company('Fără CUI SRL', null, null, null, gen_random_uuid())->>'id' is not null, 'a company without a CUI is created');
select set_config('test.rid2', gen_random_uuid()::text, true);
select set_config('test.co3', public.create_company('Auto Unu Flotă SRL', '160796', null, null, current_setting('test.rid2')::uuid)->>'id', true);
select test.eq(public.create_company('Auto Unu Flotă SRL', '160796', null, null, current_setting('test.rid2')::uuid)->>'id', current_setting('test.co3'),
  'the same request replayed answers the company it made, not a refusal');
select test.logout();
select test.fails($$select public.company_vat_key('RO1')$$ , 'permission denied', 'the key helper is not callable') from (select test.login(test.id('out'))) x;
select test.logout();

-- Companies that already shared a CUI before the rule keep working: only a change is checked.
update public.companies set vat_id = 'RO14872301' where id = test.id('co2');
select test.login(test.id('out'));
select test.eq(public.update_company(test.id('co2'), 'Alta Nouă SRL', 'RO14872301', null, null, gen_random_uuid())->>'name', 'Alta Nouă SRL',
  'a company that already shared a CUI still saves its name');
select test.logout();

-- ------------------------------------------------------------------ 3. platform settings
select set_config('test.window', (select limits->>'review_window_days' from public.platform_settings), true);
select test.login(test.id('client_a'));
select test.eq(test.count($$select report_price_ron, vat_rate, fleet_enabled from public.platform_settings$$), 1::bigint,
  'a client reads the three columns the app shows');
select test.ok(test.count($$select weighted_score from public.shop_ratings$$) >= 1, 'and the ratings view, which needs the two ranking columns');
select test.fails($$select limits from public.platform_settings$$, 'permission denied', 'not the limits');
select test.fails($$select notification_texts from public.platform_settings$$, 'permission denied', 'nor the notification texts');
select test.fails($$select subscription_price_ron from public.platform_settings$$, 'permission denied', 'nor the other settings');
select test.fails($$select * from public.platform_settings$$, 'permission denied', 'nor the whole row');
select test.eq(public.review_window_days(), current_setting('test.window')::int, 'review_window_days answers the one limit a client needs');
select test.fails($$select public.admin_get_settings()$$, 'not_allowed', 'a client cannot read the admin''s settings');
select test.logout();
select test.login(test.id('owner1'));
select test.fails($$select public.admin_get_settings()$$, 'not_allowed', 'nor a shop');
select test.logout();
select test.login_anon();
select test.fails($$select public.review_window_days()$$, 'permission denied', 'a visitor calls neither');
select test.fails($$select public.admin_get_settings()$$, 'permission denied', 'nor the admin''s');
select test.logout();
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_get_settings()$$, 'mfa_required', 'an admin without the second step is refused');
select test.logout();
select test.login(test.id('admin'));
select test.ok((select s ? 'limits' and s ? 'notification_texts' and s ? 'subscription_price_ron' and (s->'limits'->>'review_window_days') is not null
                from public.admin_get_settings() s), 'the admin gets the whole row');
select test.eq(public.admin_get_settings()->>'subscription_price_ron',
  (public.admin_update_settings('{"trial_days": 91}'::jsonb, gen_random_uuid(), 'Test A11')->>'subscription_price_ron'),
  'in the same shape admin_update_settings answers');
select test.logout();

select test.ok((select version from public.schema_version) >= 122, 'schema 122 or later');
rollback;
