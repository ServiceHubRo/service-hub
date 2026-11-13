-- A12 — what was left of the master audit (13 Nov 2026): a suspended account's bookings that have
-- not started are cancelled and the other side told; a review's report is read only through
-- functions. Fails on schema 122.
begin;
select test.make_fleet();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';
-- shop2 becomes bookable too.
update public.profiles set phone_verified_by_admin = true where id = test.id('owner2');
insert into public.shop_services (shop_id, service_id) values (test.id('shop2'), 'ulei') on conflict do nothing;
update public.shops set lang = 'en' where id = test.id('shop2');

create function pg_temp.booking(p_id uuid) returns public.bookings
language sql security definer as $$ select * from public.bookings where id = p_id $$;
create function pg_temp.events(p_booking uuid, p_user uuid) returns bigint
language sql security definer as $$ select count(*) from public.notification_events
  where booking_id = p_booking and event = 'booking_cancelled_admin' and user_id is not distinct from p_user $$;
create function pg_temp.reason_sent(p_booking uuid, p_user uuid) returns text
language sql security definer as $$ select params->>'reason' from public.notification_events
  where booking_id = p_booking and event = 'booking_cancelled_admin' and user_id = p_user limit 1 $$;
create function pg_temp.messages(p_booking uuid) returns bigint
language sql security definer as $$ select count(*) from public.messages where booking_id = p_booking and event = 'booking_cancelled_admin' $$;
grant execute on all functions in schema pg_temp to public;

-- ------------------------------------------------------------------ 1a. a suspended client
-- Ana: a waiting request at shop1 (Romanian), a confirmed booking at shop2 (English), a job in
-- inspection at shop1, and a company booking she made for the fleet.
select set_config('test.pending', test.book(test.id('client_a'), test.id('shop1'), test.workday(1), '09:00', 'ulei', 'B 21 SUS')::text, true);
select set_config('test.confirmed', test.book(test.id('client_a'), test.id('shop2'), test.workday(1), '10:00', 'ulei', 'B 22 SUS')::text, true);
select set_config('test.begun', test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '09:00', 'frane', 'B 23 SUS')::text, true);
select set_config('test.fleet', test.fleet_booking('v1', test.id('client_a'), 'confirmed', test.workday(3))::text, true);
-- Bogdan's booking at shop1 must not be touched.
select set_config('test.other', test.book(test.id('client_b'), test.id('shop1'), test.workday(1), '11:00', 'ulei', 'B 24 SUS')::text, true);
select test.login(test.id('owner2'));
select public.confirm_booking(current_setting('test.confirmed')::uuid, gen_random_uuid());
select test.logout();
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.begun')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.begun')::uuid, gen_random_uuid());
select test.logout();

select set_config('test.rid', gen_random_uuid()::text, true);
select test.login(test.id('admin'));
select test.eq(public.admin_set_account_suspended(test.id('client_a'), true, 'Abuz repetat', current_setting('test.rid')::uuid)->>'suspended', 'true',
  'the client is suspended');
select test.logout();

select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).status, 'cancelled', 'the waiting request is cancelled');
select test.eq((pg_temp.booking(current_setting('test.confirmed')::uuid)).status, 'cancelled', 'the confirmed booking is cancelled');
select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).cancelled_by, 'admin', 'by the platform');
select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).cancel_reason, 'Contul clientului nu mai este disponibil pe Service-Hub.',
  'the reason in Romanian for a Romanian shop');
select test.eq((pg_temp.booking(current_setting('test.confirmed')::uuid)).cancel_reason, 'The client''s account is no longer available on Service-Hub.',
  'and in English for an English one');
select test.ok(position('Abuz' in (pg_temp.booking(current_setting('test.pending')::uuid)).cancel_reason) = 0, 'never the admin''s reason');
select test.eq((pg_temp.booking(current_setting('test.begun')::uuid)).status, 'in_inspection', 'a job already begun goes on');
select test.eq((pg_temp.booking(current_setting('test.fleet')::uuid)).status, 'confirmed', 'a company''s booking stays: it is the company''s');
select test.eq((pg_temp.booking(current_setting('test.other')::uuid)).status, 'pending', 'another client''s booking is untouched');

select test.eq(pg_temp.events(current_setting('test.pending')::uuid, test.id('owner1')), 1::bigint, 'the shop''s owner is told once');
select test.eq(pg_temp.events(current_setting('test.confirmed')::uuid, test.id('owner2')), 1::bigint, 'the other shop too');
select test.eq(pg_temp.reason_sent(current_setting('test.confirmed')::uuid, test.id('owner2')),
  'The client''s account is no longer available on Service-Hub.', 'with the reason the shop reads');
select test.eq(pg_temp.events(current_setting('test.pending')::uuid, test.id('client_a')), 0::bigint, 'the suspended client gets no notification per booking');
select test.eq(pg_temp.messages(current_setting('test.pending')::uuid), 1::bigint, 'the thread says who cancelled, once');
select test.eq(pg_temp.events(current_setting('test.begun')::uuid, test.id('owner1')), 0::bigint, 'nothing for the job that goes on');

-- The same request again tells nobody twice; the day's place is free for someone else.
select test.login(test.id('admin'));
select public.admin_set_account_suspended(test.id('client_a'), true, 'Abuz repetat', current_setting('test.rid')::uuid);
select test.logout();
select test.eq(pg_temp.events(current_setting('test.pending')::uuid, test.id('owner1')), 1::bigint, 'the same request replayed sends nothing again');
select test.ok(test.book(test.id('client_b'), test.id('shop1'), test.workday(1), '09:00', 'ulei', 'B 25 SUS') is not null, 'the freed place can be booked');

-- Reactivated: nothing comes back by itself.
select test.login(test.id('admin'));
select public.admin_set_account_suspended(test.id('client_a'), false, 'Verificat', gen_random_uuid());
select test.logout();
select test.eq((pg_temp.booking(current_setting('test.pending')::uuid)).status, 'cancelled', 'a cancelled booking stays cancelled after reactivation');

-- ------------------------------------------------------------------ 1b. a suspended shop owner
select set_config('test.own_pending', test.book(test.id('client_b'), test.id('shop2'), test.workday(4), '09:00', 'ulei', 'B 26 SUS')::text, true);
select test.login(test.id('admin'));
select public.admin_set_account_suspended(test.id('owner2'), true, 'Date false', gen_random_uuid());
select test.logout();
select test.eq((pg_temp.booking(current_setting('test.own_pending')::uuid)).status, 'cancelled', 'the owner''s account suspended: the shop''s waiting request is cancelled');
select test.eq((pg_temp.booking(current_setting('test.own_pending')::uuid)).cancel_reason, 'The shop is no longer available on Service-Hub.',
  'with the shop reason, in the client''s language');
select test.eq(pg_temp.events(current_setting('test.own_pending')::uuid, test.id('client_b')), 1::bigint, 'and its client is told');
select test.eq((pg_temp.booking(current_setting('test.other')::uuid)).status, 'pending', 'another shop''s booking is untouched');

-- A colleague's suspension cancels nothing at the shop.
select test.login(test.id('admin'));
select public.admin_set_account_suspended(test.id('staff1'), true, 'Test', gen_random_uuid());
select test.logout();
select test.eq((pg_temp.booking(current_setting('test.other')::uuid)).status, 'pending', 'a colleague suspended: the shop''s bookings stay');

-- Only an admin; the helpers and the inner function are not callable.
select test.login(test.id('owner1'));
select test.fails(format($$select public.admin_set_account_suspended(%L, true, 'x', gen_random_uuid())$$, test.id('client_b')), 'not_allowed', 'a shop cannot suspend an account');
select test.fails(format($$select public.cancel_unstarted_bookings_of_suspended_client(%L)$$, test.id('client_b')), 'permission denied', 'nor call the helper');
select test.fails(format($$select public.admin_set_account_suspended_a11(%L, true, 'x', gen_random_uuid())$$, test.id('client_b')), 'permission denied', 'nor the inner function');
select test.logout();

-- ------------------------------------------------------------------ 2. a review's report
update public.reviews
  set report_reason = 'fake', reported_at = now(), report_status = 'pending', report_note = 'Notă internă', signals_cleared_at = now()
  where booking_id = test.id('booking_a');

-- Another client: the public review, without anything about its report.
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at, removed_at, created_at
  from public.reviews where booking_id = %L$$, test.id('booking_a'))), 1::bigint, 'another client still reads the public review');
select test.fails($$select report_status from public.reviews$$, 'permission denied', 'not whether it was reported');
select test.fails($$select report_reason from public.reviews$$, 'permission denied', 'nor why');
select test.fails($$select reported_at from public.reviews$$, 'permission denied', 'nor when');
select test.fails($$select public.list_my_shop_reviews()$$, 'not_allowed', 'a client has no shop reviews to list');
select test.fails($$select public.admin_pending_reports()$$, 'not_allowed', 'nor the admin''s count');
select test.logout();

-- The shop: its reviews through the function, in the shape Recenzii shows.
select test.login(test.id('owner1'));
select test.fails($$select report_status from public.reviews$$, 'permission denied', 'the shop does not read the report from the table either');
select test.eq(public.list_my_shop_reviews()->>'shop_id', test.id('shop1')::text, 'list_my_shop_reviews names the shop');
select test.eq(jsonb_array_length(public.list_my_shop_reviews()->'reviews'), 2, 'both reviews of the shop, the removed one included');
select test.ok((select r->>'report_status' = 'pending' and r->>'report_reason' = 'fake' and r->>'reported_at' is not null
                       and r->>'client_display_name' = 'Ana M.' and (r->>'rating')::int = 5 and r->>'text' = 'Prompt, deviz clar.'
                       and r->'booking'->>'ref' is not null and r->'booking'->'service'->>'name_ro' is not null
                       and not (r ? 'report_note') and not (r ? 'client_id') and not (r ? 'signals_cleared_at')
                from jsonb_array_elements(public.list_my_shop_reviews()->'reviews') r where r->>'booking_id' = test.id('booking_a')::text),
  'a reported review: its state and reason, its booking and service, never the note or the author''s account');
select test.ok((select r->>'removed_at' is not null from jsonb_array_elements(public.list_my_shop_reviews()->'reviews') r
                where r->>'booking_id' = test.id('booking_b1')::text), 'the removed review says so');
-- Its own actions answer the review without the moderation fields.
select test.ok((select r.reply = 'Mulțumim.' and r.report_note is null and r.signals_cleared_at is null and r.report_status = 'pending'
                from public.reply_review((select (x->>'id')::uuid from jsonb_array_elements(public.list_my_shop_reviews()->'reviews') x
                                          where x->>'booking_id' = test.id('booking_a')::text), 'Mulțumim.', gen_random_uuid()) r),
  'reply_review answers the review without the admin''s note');
select test.logout();
select test.login(test.id('staff1'));
select test.eq(jsonb_array_length(public.list_my_shop_reviews()->'reviews'), 2, 'a colleague reads them too (readable while suspended)');
select test.logout();
select test.login(test.id('owner2'));
select test.eq(jsonb_array_length(public.list_my_shop_reviews()->'reviews'), 0, 'another shop gets only its own: none');
select test.logout();
select test.login_anon();
select test.fails($$select public.list_my_shop_reviews()$$, 'permission denied', 'a visitor cannot call it');
select test.logout();

-- The admin's badge.
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_pending_reports()$$, 'mfa_required', 'an admin without the second step is refused');
select test.logout();
select test.login(test.id('admin'));
select test.eq(public.admin_pending_reports(), 1, 'the admin counts the reports waiting');
select test.ok((select r->>'report_note' = 'Notă internă' from jsonb_array_elements(public.admin_list_reviews(null)->'queue') r
                where r->>'booking_id' = test.id('booking_a')::text), 'and still reads the note through admin_list_reviews');
select test.logout();

select test.ok((select version from public.schema_version) >= 123, 'schema 123 or later');
rollback;
