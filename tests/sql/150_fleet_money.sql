-- 107 — quote money visibility, row-level: the regression matrix of docs/FLEET_EXTENSION_PLAN.md §6.
-- A driver who booked a company vehicle and has no costs.view never obtains an amount (direct read,
-- RPC answers and their replays, export, PDFs, the history report, thread messages, notifications,
-- quotes); a personal client, the shop, the company's approvers and the platform admin are unchanged;
-- rights granted or revoked apply at the next request; every holder of bookings.viewAll has costs.view.
begin;
select test.make_fleet();

-- The driver-booker (client_b): a finished company job of v1 with its quote, a pending one, and a
-- finished personal job (make_world's booking_b1 at shop1).
select set_config('test.cb', test.fleet_booking('v1', test.id('client_b'), 'done', test.today() - 4, '10:00', 400, 120000)::text, true);
select set_config('test.cq', test.raw_quote(current_setting('test.cb')::uuid)::text, true);
update public.quotes set status = 'accepted', total_approved = 400 where id = current_setting('test.cq')::uuid;
select set_config('test.cp', test.fleet_booking('v2', test.id('client_b'), 'pending', test.workday(5))::text, true);
update public.bookings set cost = 99 where id = current_setting('test.cp')::uuid;
select set_config('test.pb', test.id('booking_b1')::text, true);
update public.bookings set cost = 300 where id = test.id('booking_b1');
select test.raw_quote(test.id('booking_b1'));

create function pg_temp.msg_params(p_booking uuid) returns jsonb
language sql security definer as $$ select params from public.messages where booking_id = p_booking order by created_at desc limit 1 $$;
create function pg_temp.notice_params(p_user uuid, p_booking uuid) returns jsonb
language sql security definer as $$ select params from public.notification_events where user_id = p_user and event = 'job_done' and booking_id = p_booking limit 1 $$;
create function pg_temp.ref_of(p_id uuid) returns text
language sql security definer as $$ select ref from public.bookings where id = p_id $$;
grant execute on all functions in schema pg_temp to public;

-- ------------------------------------------------------------------ 1, 12: direct reads
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select 1 from public.bookings where id = %L$$, current_setting('test.cb'))), 0::bigint,
  '1: the driver-booker cannot read the company booking directly');
select test.eq(test.count(format($$select 1 from public.bookings where id = %L and cost is not null$$, current_setting('test.pb'))), 1::bigint,
  '1: their personal booking keeps its cost');
select test.eq(test.count(format($$select 1 from public.quotes where booking_id = %L$$, current_setting('test.cb'))), 0::bigint, '12: nor its quotes');
select test.eq(test.count(format($$select 1 from public.quote_items qi join public.quotes q on q.id = qi.quote_id where q.booking_id = %L$$,
  current_setting('test.cb'))), 0::bigint, '12: nor its quote lines');
-- Through my_company_bookings: the booking, without any amount.
select test.ok((select x->>'cost' is null and (x->>'money_hidden')::boolean and x->'quotes'->0->>'total_sent' is null
                       and x->'quotes'->0->'items'->0->>'price' is null and x->'quotes'->0->'items'->0->>'name' = 'Plăcuțe'
                from jsonb_array_elements(public.my_company_bookings()) x where x->>'id' = current_setting('test.cb')),
  '1: my_company_bookings shows it without cost, totals or prices');
select test.eq(jsonb_array_length(public.my_company_bookings()), 2, 'both company bookings, none personal');

-- ------------------------------------------------------------------ 5–6: RPC answers and their replay
select set_config('test.rid', gen_random_uuid()::text, true);
select test.ok((public.cancel_booking(current_setting('test.cp')::uuid, current_setting('test.rid')::uuid)).cost is null,
  '5: cancel_booking answers cost = null');
select test.ok((public.cancel_booking(current_setting('test.cp')::uuid, current_setting('test.rid')::uuid)).cost is null,
  '6: the same request replayed: still null');

-- ------------------------------------------------------------------ 7: „Datele mele”
select test.ok((select not (x ? 'cost') and not (x->'quotes'->0 ? 'total_sent') and not (x->'quotes'->0->'items'->0 ? 'price')
                from jsonb_array_elements(public.export_my_data()->'bookings') x where x->>'ref' = pg_temp.ref_of(current_setting('test.cb')::uuid)),
  '7: the export has no amounts for the company booking');
select test.ok((select (x->>'cost') is not null from jsonb_array_elements(public.export_my_data()->'bookings') x
                where x->>'ref' = pg_temp.ref_of(current_setting('test.pb')::uuid)),
  '7: and keeps them for the personal one');
select test.logout();

-- ------------------------------------------------------------------ 8, 9: PDFs and the history report (service role)
select test.fails(format($$select public.job_document_data(%L, %L, 'final')$$, test.id('client_b'), current_setting('test.cb')), 'not_found',
  '8: the job document of the company booking is refused to the driver');
select test.ok(exists (select 1 from jsonb_array_elements(public.report_jobs_t77(test.id('client_b'), public.vehicle_key(
                 (select car_snapshot from public.bookings where id = current_setting('test.cb')::uuid)))) j where j->>'id' = current_setting('test.cb')),
  '9: (before 107 the report would list it)');
select test.ok(not exists (select 1 from jsonb_array_elements(public.report_jobs(test.id('client_b'), public.vehicle_key(
                 (select car_snapshot from public.bookings where id = current_setting('test.cb')::uuid)))) j where j->>'id' = current_setting('test.cb')),
  '9: the history report leaves it out');

-- ------------------------------------------------------------------ 10, 11: messages and notifications
select public.post_booking_event(b, 'job_done', 'shop', jsonb_build_object('cost', 400, 'odometer', 120000)) from public.bookings b where b.id = current_setting('test.cb')::uuid;
select test.ok(not (pg_temp.msg_params(current_setting('test.cb')::uuid) ? 'cost'), '10: a company booking''s thread message has no amount');
select public.post_booking_event(b, 'job_done', 'shop', jsonb_build_object('cost', 300)) from public.bookings b where b.id = current_setting('test.pb')::uuid;
select test.eq(pg_temp.msg_params(current_setting('test.pb')::uuid)->>'cost', '300', '10: a personal booking''s keeps it');
select public.notify_user(test.id('client_b'), 'job_done', jsonb_build_object('cost', 400), current_setting('test.cb')::uuid);
select test.ok(not (pg_temp.notice_params(test.id('client_b'), current_setting('test.cb')::uuid) ? 'cost'), '11: the driver''s notification has no amount');
select public.notify_user(test.id('owner1'), 'job_done', jsonb_build_object('cost', 400), current_setting('test.cb')::uuid);
select test.eq(pg_temp.notice_params(test.id('owner1'), current_setting('test.cb')::uuid)->>'cost', '400', '11: the shop''s keeps it');
select public.notify_user(test.id('client_a'), 'job_done', jsonb_build_object('cost', 400), current_setting('test.cb')::uuid);
select test.eq(pg_temp.notice_params(test.id('client_a'), current_setting('test.cb')::uuid)->>'cost', '400', '11: the company admin (costs.view) keeps it');
select public.notify_user(test.id('client_b'), 'job_done', jsonb_build_object('cost', 300), current_setting('test.pb')::uuid);
select test.eq(pg_temp.notice_params(test.id('client_b'), current_setting('test.pb')::uuid)->>'cost', '300', '11: a personal booking: unchanged');

-- ------------------------------------------------------------------ the others are unchanged
select test.login(test.id('client_a'));
select test.eq(test.count(format($$select 1 from public.bookings where id = %L and cost = 400$$, current_setting('test.cb'))), 1::bigint,
  'the company admin reads it with its cost (bookings.viewAll)');
select test.login(test.id('owner1'));
select test.eq(test.count(format($$select 1 from public.quote_items qi join public.quotes q on q.id = qi.quote_id where q.booking_id = %L and qi.price > 0$$,
  current_setting('test.cb'))), 2::bigint, 'the shop reads the quote with prices');
select test.login(test.id('admin'));
select test.eq(test.count(format($$select 1 from public.bookings where id = %L and cost = 400$$, current_setting('test.cb'))), 1::bigint, 'the platform admin too');

-- ------------------------------------------------------------------ rights granted and revoked: the next request reflects it
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_drv'), array['costs.view'], null, gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select 1 from public.bookings where id = %L and cost = 400$$, current_setting('test.cb'))), 1::bigint,
  'costs.view granted: the driver reads it with its cost');
select test.eq(jsonb_array_length(public.my_company_bookings()), 0, 'and it leaves my_company_bookings');
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_drv'), '{}', null, gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select 1 from public.bookings where id = %L$$, current_setting('test.cb'))), 0::bigint, 'revoked: hidden again at once');
-- A plan without extra rights: the extra costs.view stops counting.
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_drv'), array['costs.view'], null, gen_random_uuid());
select test.login(test.id('admin'));
select public.admin_set_company_plan(test.id('co'), 'fleet_start', gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select 1 from public.bookings where id = %L$$, current_setting('test.cb'))), 0::bigint,
  'a plan without extra rights: the amounts are hidden again');
-- Removed from the company: still the booker, still without amounts.
select test.login(test.id('client_a'));
select public.remove_company_member(test.id('m_drv'), gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.my_company_bookings()), 2, 'a removed member still sees their bookings, without amounts');
select test.logout();

-- ------------------------------------------------------------------ the invariant: bookings.viewAll ⇒ costs.view; the accountant always has it
select test.eq((select count(*) from (values ('admin'), ('manager'), ('driver'), ('accountant')) r(role)
                cross join lateral (select array_agg(c) caps from unnest(array['quotes.approve', 'budget.manage', 'bookings.create', 'vehicles.manage',
                                    'costs.view', 'reports.view', 'members.manage']) c where random() >= 0) all_caps
                cross join lateral (select array(select c from unnest(all_caps.caps) with ordinality u(c, i) where (m >> (i::int - 1)) & 1 = 1) extras
                                    from generate_series(0, 127) m) e
                where public.fleet_member_can(r.role, e.extras, 'bookings.viewAll') and not public.fleet_member_can(r.role, e.extras, 'costs.view')),
  0::bigint, 'every role with every combination of extra rights: bookings.viewAll implies costs.view');
select test.ok(public.fleet_member_can('accountant', '{}', 'costs.view'), 'the accountant always has costs.view');

rollback;
