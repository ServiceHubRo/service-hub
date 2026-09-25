-- The paid history report (T15, ARCHITECTURE §7, §13, FR §3.6b): which jobs belong to a car,
-- the preview, the checkout row, payment only through the webhook, the finished report, the
-- public verification (nothing but the car, the count and the dates) and who may read what.
begin;
select test.make_world();

-- ------------------------------------------------------------------ the car key (mirror of vehicleKey)
select test.eq(public.vehicle_key('{"plate":"bv-12 abc"}'), 'plate:BV12ABC', 'plate without case, spaces or dashes'),
       test.eq(public.vehicle_key('{"plate":"  ","make":" Dacia ","model":"Logan  MCV","year":2015}'),
               'car:dacia|logan mcv|2015', 'no plate: make, model, year'),
       test.eq(public.vehicle_key('{"make":"Dacia","model":"Logan"}'), 'car:dacia|logan|', 'no year'),
       test.eq(public.vehicle_key('{}'), 'car:||', 'nothing known');

-- ------------------------------------------------------------------ more jobs for client A
-- Same car (plate typed differently), finished later with a LOWER odometer: kept as it is, noted.
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', current_date - 5, '09:00', 'bv12abc', 104900);
-- Same plate, not finished: never in a report.
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'cancelled', current_date - 4, '09:00', 'BV 12 ABC');
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_refused', current_date - 3, '09:00', 'BV 12 ABC');
-- Another car of client A, and client B's job on the same plate: not in A's report.
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', current_date - 6, '09:00', 'CJ 99 XYZ', 50000);
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'done', current_date - 7, '09:00', 'BV 12 ABC', 90000);

-- ------------------------------------------------------------------ preview (browser)
select test.login(test.id('client_a'));
select set_config('test.preview', public.history_report_preview(test.id('car_a'), null)::text, true);
select test.eq(jsonb_array_length(p->'jobs'), 2, 'two finished jobs on the car'),
       test.eq(p->'jobs'->0->>'date', (current_date - 5)::text, 'newest first'),
       test.eq((p->'jobs'->1->>'cost')::numeric, 340::numeric, 'with the amount'),
       test.eq(p->'jobs'->1->'items', '["Ulei 5W30", "Manoperă"]'::jsonb, 'the accepted quote lines'),
       test.eq(p->'jobs'->1->>'shop_name', 'Atelier Unu', 'the shop'),
       test.eq(p->'jobs'->1->>'service_ro', 'Schimb ulei + filtru ulei', 'the service in Romanian'),
       test.eq((p->'facts'->>'job_count')::int, 2, 'facts: count'),
       test.eq((p->'facts'->>'latest_odometer')::int, 104900, 'facts: odometer at the newest job'),
       test.eq((p->'facts'->>'odometer_out_of_order')::boolean, true, 'facts: readings go down'),
       -- booking_a was finished 10 days ago (now() - 10 days): its day in Bucharest, not in UTC.
       test.eq(p->'facts'->>'period_from', (test.today() - 10)::text, 'facts: first day'),
       test.eq(p->'car'->>'vin', 'WVWZZZAUZGW123456', 'the garage car with its VIN'),
       test.eq((p->>'price')::numeric, 29::numeric, 'price from the platform settings')
from (select current_setting('test.preview')::jsonb p) q;
select test.eq(public.history_report_preview(null, test.id('booking_a'))->>'car_id', test.id('car_a')::text,
  'from a booking: the same car, found in the garage');
select test.fails(format($$select public.history_report_preview(%L, null)$$, test.id('car_b')), 'car_not_found',
  'not someone else''s car');
select test.fails(format($$select public.history_report_preview(null, %L)$$, test.id('booking_b')), 'booking_not_found',
  'not someone else''s booking');
select test.fails($$select public.history_report_preview(null, null)$$, 'car_not_found', 'a car is required');
select test.fails($$select public.begin_history_report(auth.uid(), null, null, 'ro', gen_random_uuid())$$,
  'permission denied', 'the browser cannot start a report itself');
select test.fails(format($$select public.mark_history_report_paid(%L, 'cs_x', 29)$$, gen_random_uuid()),
  'permission denied', 'the browser cannot mark a report paid');
select test.logout();

select test.login(test.id('owner1'));
select test.fails(format($$select public.history_report_preview(%L, null)$$, test.id('car_a')), 'not_allowed', 'shops get nothing');
select test.logout();
select test.login_anon();
select test.fails(format($$select public.history_report_preview(%L, null)$$, test.id('car_a')), 'permission denied',
  'signed-out visitors get nothing');
select test.logout();

-- A car of client B with no finished job (only a pending booking): the preview is empty and no
-- report can be started.
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.history_report_preview(test.id('car_b'), null)->'jobs'), 0, 'no jobs, empty preview');
select test.logout();
select test.fails(format($$select public.begin_history_report(%L, %L, null, 'en', gen_random_uuid())$$,
  test.id('client_b'), test.id('car_b')), 'no_jobs', 'never a report for a car without finished jobs');

-- ------------------------------------------------------------------ checkout row (report-checkout)
select set_config('test.rid', gen_random_uuid()::text, true);
select set_config('test.begin', public.begin_history_report(test.id('client_a'), test.id('car_a'), null, 'en',
  current_setting('test.rid')::uuid)::text, true);
select set_config('test.report', current_setting('test.begin')::jsonb->>'id', true);
select test.ok((b->>'code') ~ '^SH-\d{4}-\d{6}$', 'a report code SH-YYYY-NNNNNN'),
       test.eq(b->>'status', 'pending_payment', 'waiting for the payment'),
       test.eq((b->>'price')::numeric, 29::numeric, 'at the platform price'),
       test.eq(b->>'lang', 'en', 'in the chosen language'),
       test.eq(b->>'email', 'ana@test.local', 'with the account email for Stripe')
from (select current_setting('test.begin')::jsonb b) q;
select test.eq(public.begin_history_report(test.id('client_a'), test.id('car_a'), null, 'en',
  current_setting('test.rid')::uuid)->>'id', current_setting('test.report'), 'the same tap gives the same report');
select test.fails(format($$select public.begin_history_report(%L, %L, null, 'en', %L)$$,
  test.id('client_b'), test.id('car_b'), current_setting('test.rid')), 'request_id_reused', 'a request id is one person''s');
select test.fails(format($$select public.begin_history_report(%L, %L, null, 'ro', gen_random_uuid())$$,
  test.id('owner1'), test.id('car_a')), 'not_allowed', 'only clients buy reports');
select test.fails(format($$select public.begin_history_report(%L, %L, null, 'ro', gen_random_uuid())$$,
  test.id('client_b'), test.id('car_a')), 'car_not_found', 'only for one''s own car');

select public.set_history_report_session(current_setting('test.report')::uuid, 'cs_1');
select public.set_history_report_session(current_setting('test.report')::uuid, 'cs_2');
select test.eq(stripe_session_id, 'cs_1', 'the first checkout session stays')
from public.history_reports where id = current_setting('test.report')::uuid;

select test.eq((public.verify_report(code)->>'found')::boolean, false, 'an unpaid report cannot be verified')
from public.history_reports where id = current_setting('test.report')::uuid;

-- The client sees the pending row (Rapoartele mele hides it) but cannot change it.
select test.login(test.id('client_a'));
select test.fails(format($$update public.history_reports set status = 'generated' where id = %L$$, current_setting('test.report')),
  'permission denied', 'the browser cannot change a report');
select test.logout();

-- ------------------------------------------------------------------ paid (stripe-webhook)
-- A job finished between the preview and the payment is included.
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', current_date - 1, '09:00', 'BV 12 ABC', 106000);
delete from public.notification_events;
select test.eq(r->>'status', 'paid', 'paid'),
       test.eq((r->>'amount_paid')::numeric, 29::numeric, 'with the amount Stripe took'),
       test.eq((r->>'job_count')::int, 3, 'jobs taken again at payment'),
       test.eq((r->>'latest_odometer')::int, 106000, 'odometer at the newest job')
from (select public.mark_history_report_paid(current_setting('test.report')::uuid, 'cs_1', 29) r) q;
select test.eq(public.mark_history_report_paid(current_setting('test.report')::uuid, 'cs_1', 99)->>'amount_paid', '29.00',
  'a repeated webhook changes nothing');
select test.ok(public.mark_history_report_paid(gen_random_uuid(), 'cs_x', 29) is null, 'an unknown report is ignored');

-- ------------------------------------------------------------------ generated
select test.eq(public.finish_history_report(current_setting('test.report')::uuid, 'x/SH.pdf'), true, 'the PDF is stored');
select test.eq(public.finish_history_report(current_setting('test.report')::uuid, 'x/SH.pdf'), false, 'once');
select test.eq(count(*), 1::bigint, 'the client is told once'),
       test.eq(min(user_id::text), test.id('client_a')::text, 'the client'),
       test.eq(min(channels::text), '{push,email}', 'by push and email'),
       test.eq(min(params->>'plate'), 'BV 12 ABC', 'naming the car')
from public.notification_events where event = 'report_ready';
select test.eq(status, 'generated', 'generated'), test.ok(generated_at is not null, 'with the time')
from public.history_reports where id = current_setting('test.report')::uuid;

-- ------------------------------------------------------------------ who may download
select test.eq(public.history_report_for(test.id('client_a'), current_setting('test.report')::uuid)->>'pdf_url', 'x/SH.pdf',
  'the client gets the file');
select test.eq(public.history_report_for(test.id('admin'), current_setting('test.report')::uuid)->>'pdf_url', 'x/SH.pdf',
  'the admin too');
select test.fails(format($$select public.history_report_for(%L, %L)$$, test.id('client_b'), current_setting('test.report')),
  'not_found', 'nobody else');

-- ------------------------------------------------------------------ /verifica (signed out)
select set_config('test.code', code, true) from public.history_reports where id = current_setting('test.report')::uuid;
select test.login_anon();
select set_config('test.verify', public.verify_report(lower(replace(current_setting('test.code'), '-', ' ')))::text, true);
select test.eq((v->>'found')::boolean, true, 'the code is found, typed in lower case with spaces'),
       test.eq(v->>'code', current_setting('test.code'), 'the code'),
       test.eq(v->>'make', 'Volkswagen', 'the make'),
       test.eq(v->>'plate', 'BV 12 ABC', 'the plate'),
       test.eq((v->>'job_count')::int, 3, 'the number of jobs'),
       test.eq((v->>'void')::boolean, false, 'not void'),
       test.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(v) k),
               'code,found,generated_at,job_count,make,model,period_from,period_to,plate,void',
               'nothing else: no shops, amounts, work or people')
from (select current_setting('test.verify')::jsonb v) q;
select test.eq(public.verify_report('SH-2026-999999')->>'found', 'false', 'an unknown code'),
       test.eq(public.verify_report('<script>')->>'found', 'false', 'garbage'),
       test.eq(public.verify_report(null)->>'found', 'false', 'nothing typed');
select test.fails('select 1 from public.history_reports', 'permission denied', 'signed out, the table itself stays closed');
select test.logout();

-- ------------------------------------------------------------------ void (admin, T16)
update public.history_reports set status = 'void', void_reason = 'test', voided_at = now()
where id = current_setting('test.report')::uuid;
select test.eq((public.verify_report(current_setting('test.code'))->>'void')::boolean, true, 'a void report says so');
select test.fails(format($$select public.history_report_for(%L, %L)$$, test.id('client_a'), current_setting('test.report')),
  'report_void', 'the client no longer downloads a void report');
select test.eq(public.history_report_for(test.id('admin'), current_setting('test.report')::uuid)->>'status', 'void',
  'the admin still can');
update public.history_reports set status = 'generated' where id = current_setting('test.report')::uuid;

-- ------------------------------------------------------------------ the account is deleted
-- The buyer must still be able to verify the report after the seller deleted the account.
delete from auth.users where id = test.id('client_a');
select test.eq(count(*), 2::bigint, 'the reports stay'),
       test.ok(bool_and(client_id is null), 'without an owner')
from public.history_reports where car_snapshot->>'make' = 'Volkswagen';
select test.eq((public.verify_report(current_setting('test.code'))->>'found')::boolean, true, 'and still verify');

rollback;
