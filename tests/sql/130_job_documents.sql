-- The complete quote, the intake sheet and the final quote (T50): labor and part lines with
-- quantities, the VAT and the shop's identity kept on the quote, the shop's quote numbers, the
-- intake sheet written by the shop and confirmed by the client, who did the work, and the data a
-- PDF prints — each side only for its own bookings.
begin;
select test.make_world();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';
update public.shops set daily_capacity = 20, labor_rate = 181.50, quote_terms = 'Piesele rămân proprietatea service-ului până la plată.'
where id = test.id('shop1');
update public.shop_billing set vat_payer = true, legal_address = 'Str. Lungă 1, Brașov' where shop_id = test.id('shop1');
update public.profiles set company_name = 'Firma Anei SRL', company_vat_id = 'ro 14872301', company_address = 'Str. Scurtă 2, Brașov'
where id = test.id('client_a');
select set_config('test.day1', test.workday(1)::text, true);

select test.eq(company_vat_id, 'RO14872301', 'the client''s company code is stored in one form')
from public.profiles where id = test.id('client_a');

create function pg_temp.in_inspection(p_slot time, p_plate text default 'BV 50 DOC') returns uuid
language plpgsql as $$
declare
  v uuid := test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, p_slot, 'ulei', p_plate);
begin
  perform test.login(test.id('owner1'));
  perform public.confirm_booking(v, gen_random_uuid());
  perform public.start_inspection(v, gen_random_uuid());
  perform test.logout();
  return v;
end $$;

select set_config('test.b', pg_temp.in_inspection('09:00')::text, true);

-- ------------------------------------------------------------------ the composer's lines
select test.login(test.id('owner1'));
select test.eq(test.error_of(format($$select public.send_quote(%L, '[{"name":"Revizie","kind":"labor","qty":1.5,"unit_price":181.5,"brand":"Mann"}]', gen_random_uuid())$$,
  current_setting('test.b'))), 'quote_item_invalid', 'labor has no producer');
select test.eq(test.error_of(format($$select public.send_quote(%L, '[{"name":"Filtru","kind":"part","qty":0,"unit_price":63}]', gen_random_uuid())$$,
  current_setting('test.b'))), 'quote_item_invalid', 'a quantity above zero');
select test.eq(test.error_of(format($$select public.send_quote(%L, '[{"name":"Filtru","kind":"part","qty":1.555,"unit_price":63}]', gen_random_uuid())$$,
  current_setting('test.b'))), 'quote_item_invalid', 'a quantity with at most 2 decimals');
select test.eq(test.error_of(format($$select public.send_quote(%L, '[{"name":"Filtru","kind":"part","qty":2}]', gen_random_uuid())$$,
  current_setting('test.b'))), 'quote_item_invalid', 'a quantity needs a unit price');
select test.eq(test.error_of(format($$select public.send_quote(%L, '[{"name":"Filtru","qty":2,"unit_price":63}]', gen_random_uuid())$$,
  current_setting('test.b'))), 'quote_item_invalid', 'a quantity only on a labor or part line');
select test.eq(test.error_of(format($$select public.send_quote(%L, '[{"name":"Revizie","kind":"labor","price":100}]', gen_random_uuid(), null, 0)$$,
  current_setting('test.b'))), 'est_hours_invalid', 'the duration is 1–720 hours');

select (public.send_quote(current_setting('test.b')::uuid,
  '[{"name":"Revizie ulei + filtre","kind":"labor","qty":1.5,"unit_price":181.5},
    {"name":"Diagnoză tester","kind":"labor","price":18.15},
    {"name":"Ulei motor 0W-30 1L","kind":"part","qty":4,"unit_price":129,"brand":"Petronas"},
    {"name":"Filtru ulei","kind":"part","qty":1,"unit_price":63,"brand":"Mann","alt":{"unit_price":40,"brand":"Filtron"}}]',
  gen_random_uuid(), 'Piesele ajung mâine.', 2)).status;
select test.logout();
select set_config('test.q', test.sent_quote(current_setting('test.b')::uuid)::text, true);

select test.eq(array_agg(position || ':' || coalesce(kind, '-') || ':' || coalesce(quantity::text, '-') || 'x' || coalesce(unit_price::text, '-')
    || '=' || price || ':' || coalesce(variant, '-') || ':' || coalesce(brand, '-') order by position),
  array['1:labor:1.50x181.50=272.25:-:-', '2:labor:-x-=18.15:-:-', '3:part:4.00x129.00=516.00:-:Petronas',
        '4:part:1.00x63.00=63.00:original:Mann', '5:part:1.00x40.00=40.00:alternative:Filtron'],
  'quantity × unit price, a fixed price, a producer, both variants with their producers')
from public.quote_items where quote_id = current_setting('test.q')::uuid;
select test.eq(total_sent, 869.40::numeric(10,2), 'the total counts the original, not both'),
       test.eq(vat_rate, 21.00::numeric(4,2), 'a VAT payer''s quote carries the VAT rate'),
       test.eq(est_hours, 2::smallint, 'the duration'),
       test.eq(issuer->>'legal_name', 'AUTO UNU SRL', 'the shop''s company is kept on the quote'),
       test.eq(issuer->>'vat_id', 'RO14872301', 'with its code'),
       test.eq(recipient->>'company_name', 'Firma Anei SRL', 'the client''s company is kept on the quote'),
       test.eq(terms, 'Piesele rămân proprietatea service-ului până la plată.', 'the shop''s terms are kept on the quote')
from public.quotes where id = current_setting('test.q')::uuid;

-- The quote number: the first of the shop's sequence, the same for every version.
select test.eq(quote_number, 1, 'the first quote of the shop is number 1')
from public.bookings where id = current_setting('test.b')::uuid;
select test.login(test.id('owner1'));
select public.replace_quote(current_setting('test.b')::uuid,
  '[{"name":"Revizie ulei + filtre","kind":"labor","qty":1.5,"unit_price":181.5}]', gen_random_uuid());
select test.eq((select b->>'quote_number' from jsonb_array_elements(public.list_shop_bookings()->'bookings') b
  where b->>'id' = current_setting('test.b')), '1', 'a new version keeps the number');
select test.ok((select b->'quote'->'items' from jsonb_array_elements(public.list_shop_bookings()->'bookings') b
  where b->>'id' = current_setting('test.b')) @> '[{"kind":"labor","quantity":1.5,"unit_price":181.5}]',
  'the shop''s list carries kind, quantity and unit price');
select test.eq((public.list_shop_bookings()->'shop'->>'vat_rate')::numeric, 21::numeric, 'the shop''s list says the VAT a quote carries now');
select test.logout();
-- Not a VAT payer: no VAT on the quote.
update public.shop_billing set vat_payer = false where shop_id = test.id('shop1');
select test.login(test.id('owner1'));
select public.replace_quote(current_setting('test.b')::uuid,
  '[{"name":"Revizie","kind":"labor","qty":1,"unit_price":150}]', gen_random_uuid());
select test.logout();
select test.eq(vat_rate, null::numeric, 'no VAT when the shop is not a VAT payer')
from public.quotes where id = test.sent_quote(current_setting('test.b')::uuid);
update public.shop_billing set vat_payer = true where shop_id = test.id('shop1');

-- The owner moves the sequence on; never onto a number already used; staff cannot.
select test.login(test.id('staff1'));
select test.eq(test.error_of('select public.set_quote_next_number(470, gen_random_uuid())'), 'not_allowed', 'staff cannot move the sequence');
select test.login(test.id('owner1'));
select test.eq(test.error_of('select public.set_quote_next_number(1, gen_random_uuid())'), 'quote_number_used', 'not onto a used number');
select test.eq(test.error_params('select public.set_quote_next_number(1, gen_random_uuid())')->>'next', '2', 'the error names the first free number');
select public.set_quote_next_number(477, gen_random_uuid());
select test.eq(public.my_quote_numbering()->>'next', '477', 'the owner reads where the sequence stands');
select test.logout();
select test.eq(test.count('select * from public.shop_quote_numbers'), 1::bigint, 'the sequence row exists');
select test.login(test.id('client_a'));
select test.fails('select * from public.shop_quote_numbers', 'permission denied', 'nobody reads the sequence from the API');
select test.logout();
select set_config('test.b2', pg_temp.in_inspection('10:00', 'BV 51 DOC')::text, true);
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.b2')::uuid, '[{"name":"Revizie","kind":"labor","qty":1,"unit_price":150}]', gen_random_uuid());
select test.logout();
select test.eq(quote_number, 477, 'the next quote continues from 477')
from public.bookings where id = current_setting('test.b2')::uuid;

-- ------------------------------------------------------------------ the intake sheet
select set_config('test.b3', pg_temp.in_inspection('11:00', 'BV 52 DOC')::text, true);
select set_config('test.intake', format($${"odometer": 23611, "fuel": 2,
  "damages": [{"x": 0.2, "y": 0.31, "kind": "scratch", "note": "Ușa stânga spate"}, {"x": 0.8, "y": 0.9, "kind": "dent"}],
  "photos": ["%s/a1.jpg"], "personal_items": "Scaun copil", "notes": "Jante zgâriate", "keep_parts": true, "road_test": true}$$,
  current_setting('test.b3')), true);

select test.login(test.id('owner2'));
select test.eq(test.error_of(format('select public.save_vehicle_intake(%L, %L, gen_random_uuid())', current_setting('test.b3'), current_setting('test.intake'))),
  'not_allowed', 'another shop cannot write the sheet');
select test.login(test.id('client_a'));
select test.eq(test.error_of(format('select public.save_vehicle_intake(%L, %L, gen_random_uuid())', current_setting('test.b3'), current_setting('test.intake'))),
  'not_allowed', 'the client cannot write the sheet');
select test.login(test.id('staff1'));
select test.eq(test.error_of(format($$select public.save_vehicle_intake(%L, '{"fuel": 5}', gen_random_uuid())$$, current_setting('test.b3'))),
  'intake_invalid', 'fuel is 0–4 quarters');
select test.eq(test.error_of(format($$select public.save_vehicle_intake(%L, '{"damages": [{"x": 2, "y": 0, "kind": "scratch"}]}', gen_random_uuid())$$, current_setting('test.b3'))),
  'intake_invalid', 'a mark inside the drawing');
select test.eq(test.error_of(format($$select public.save_vehicle_intake(%L, '{"damages": [{"x": 0.5, "y": 0.5, "kind": "rust"}]}', gen_random_uuid())$$, current_setting('test.b3'))),
  'intake_invalid', 'a known kind of damage');
select test.eq(test.error_of(format($$select public.save_vehicle_intake(%L, '{"photos": ["other-booking/a.jpg"]}', gen_random_uuid())$$, current_setting('test.b3'))),
  'intake_invalid', 'photos only from this booking''s folder');
select test.eq((public.save_vehicle_intake(current_setting('test.b3')::uuid, current_setting('test.intake')::jsonb, gen_random_uuid()))->>'odometer',
  '23611', 'a colleague writes the sheet');
select test.logout();
select test.eq(jsonb_array_length(damages), 2, 'two marks'),
       test.eq(photos, array[current_setting('test.b3') || '/a1.jpg'], 'the photo')
from public.vehicle_intakes where booking_id = current_setting('test.b3')::uuid;
select test.ok(intake_sent_at is not null, 'the booking says the sheet went out')
from public.bookings where id = current_setting('test.b3')::uuid;
select test.ok(exists (select 1 from public.notification_events where event = 'intake_sent' and user_id = test.id('client_a')
  and booking_id = current_setting('test.b3')::uuid), 'the client is told');

-- Who reads it: the client and the shop; not another client or shop.
select test.login(test.id('client_a'));
select test.eq(test.count(format('select * from public.vehicle_intakes where booking_id = %L', current_setting('test.b3'))), 1::bigint, 'the client reads it');
select test.login(test.id('client_b'));
select test.eq(test.count(format('select * from public.vehicle_intakes where booking_id = %L', current_setting('test.b3'))), 0::bigint, 'another client does not');
select test.login(test.id('owner2'));
select test.eq(test.count(format('select * from public.vehicle_intakes where booking_id = %L', current_setting('test.b3'))), 0::bigint, 'another shop does not');
select test.login(test.id('client_a'));
select test.fails(format($$update public.vehicle_intakes set odometer = 1 where booking_id = %L$$, current_setting('test.b3')),
  'permission denied', 'nobody writes the sheet from the browser');
select test.logout();

-- The photos folder: the shop adds, the client reads, others neither.
select test.login(test.id('owner2'));
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('intake-photos', '%s/x.jpg')$$, current_setting('test.b3')),
  'row-level security', 'another shop cannot add photos');
select test.login(test.id('owner1'));
insert into storage.objects (bucket_id, name) values ('intake-photos', current_setting('test.b3') || '/a1.jpg');
select test.login(test.id('client_a'));
select test.eq(test.count(format($$select * from storage.objects where bucket_id = 'intake-photos' and name like '%s/%%'$$, current_setting('test.b3'))),
  1::bigint, 'the client sees the photo');
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select * from storage.objects where bucket_id = 'intake-photos' and name like '%s/%%'$$, current_setting('test.b3'))),
  0::bigint, 'another client does not');
select test.logout();

-- A second save changes the sheet and tells the client it changed.
select test.login(test.id('owner1'));
select public.save_vehicle_intake(current_setting('test.b3')::uuid, '{"odometer": 23611, "fuel": 3}', gen_random_uuid());
select test.logout();
select test.ok(exists (select 1 from public.notification_events where event = 'intake_updated' and booking_id = current_setting('test.b3')::uuid),
  'a changed sheet is announced');

-- The client confirms; from then on the sheet is fixed.
select test.login(test.id('client_b'));
select test.eq(test.error_of(format('select public.confirm_vehicle_intake(%L, gen_random_uuid())', current_setting('test.b3'))),
  'not_allowed', 'only the booking''s client confirms');
select test.login(test.id('client_a'));
select test.ok((public.confirm_vehicle_intake(current_setting('test.b3')::uuid, gen_random_uuid()))->>'confirmed_at' is not null, 'the client confirms');
select test.eq(test.error_of(format('select public.confirm_vehicle_intake(%L, gen_random_uuid())', current_setting('test.b3'))),
  'intake_confirmed', 'once');
select test.login(test.id('owner1'));
select test.eq(test.error_of(format($$select public.save_vehicle_intake(%L, '{"fuel": 1}', gen_random_uuid())$$, current_setting('test.b3'))),
  'intake_confirmed', 'a confirmed sheet no longer changes');
select test.logout();
select test.ok(intake_confirmed_at is not null, 'the booking says the client confirmed')
from public.bookings where id = current_setting('test.b3')::uuid;
select test.ok(exists (select 1 from public.notification_events where event = 'intake_confirmed' and user_id = test.id('owner1')),
  'the shop is told');

-- ------------------------------------------------------------------ the finished job
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.b3')::uuid, '[{"name":"Revizie","kind":"labor","qty":1,"unit_price":150}]', gen_random_uuid());
select test.logout();
select test.login(test.id('client_a'));
select public.decide_quote(current_setting('test.b3')::uuid, test.sent_quote(current_setting('test.b3')::uuid),
  array(select id from public.quote_items where quote_id = test.sent_quote(current_setting('test.b3')::uuid)), gen_random_uuid());
select test.login(test.id('owner1'));
select public.start_work(current_setting('test.b3')::uuid, gen_random_uuid());
select test.eq(public.last_odometer_for_booking(current_setting('test.b3')::uuid), 23611, 'Finalizare shows the reading at intake');
select test.eq(test.error_of(format('select public.complete_job(%L, 23000, gen_random_uuid())', current_setting('test.b3'))),
  'odometer_lower', 'never below the odometer at intake');
select test.eq(test.error_params(format('select public.complete_job(%L, 23000, gen_random_uuid())', current_setting('test.b3')))->>'previous',
  '23611', 'the error names the intake reading');
select test.eq(test.error_of(format('select public.complete_job(%L, 23611, gen_random_uuid(), p_work_by => %L)', current_setting('test.b3'), repeat('x', 121))),
  'name_too_long', 'names up to 120 characters');
select (public.complete_job(current_setting('test.b3')::uuid, 23611, gen_random_uuid(),
  p_work_by => '  Roland Iordănescu ', p_checked_by => 'Marian Ghiță')).status;
select test.ok((select b from jsonb_array_elements(public.list_shop_history()->'bookings') b
  where b->>'id' = current_setting('test.b3')) @> '{"work_by":"Roland Iordănescu","checked_by":"Marian Ghiță"}',
  'Istoric shows who did the work and who checked it');
select test.logout();

-- ------------------------------------------------------------------ what a PDF prints
select test.eq((public.job_document_data(test.id('client_a'), current_setting('test.b3')::uuid, 'final'))->>'side', 'client', 'the client reads the final quote');
select test.eq((public.job_document_data(test.id('staff1'), current_setting('test.b3')::uuid, 'intake'))->'intake'->>'odometer', '23611', 'a colleague reads the sheet');
select test.eq(test.error_of(format('select public.job_document_data(%L, %L, %L)', test.id('client_b'), current_setting('test.b3'), 'final')),
  'not_found', 'another client does not');
select test.eq(test.error_of(format('select public.job_document_data(%L, %L, %L)', test.id('owner2'), current_setting('test.b3'), 'quote')),
  'not_found', 'another shop does not');
select test.eq(test.error_of(format('select public.job_document_data(%L, %L, %L)', test.id('client_a'), current_setting('test.b2'), 'final')),
  'not_ready', 'no final quote before the job is done');
select test.eq(test.error_of(format('select public.job_document_data(%L, %L, %L)', test.id('client_a'), current_setting('test.b2'), 'intake')),
  'not_ready', 'no sheet before the shop writes one');
select test.eq(test.error_of(format('select public.job_document_data(%L, %L, %L, %L)', test.id('admin'), current_setting('test.b3'), 'final', 'aal1')),
  'not_found', 'an admin needs the second step');
select test.eq((public.job_document_data(test.id('admin'), current_setting('test.b3')::uuid, 'final', 'aal2'))->>'side', 'admin', 'an admin with the second step reads it');
select test.eq((d->'quote'->'items'->0->>'kind'), 'labor', 'the lines carry their kind'),
       test.eq((d->'booking'->>'work_by'), 'Roland Iordănescu', 'who did the work'),
       test.eq((d->'shop'->>'legal_name'), 'AUTO UNU SRL', 'the shop''s company as the quote kept it')
from (select public.job_document_data(test.id('owner1'), current_setting('test.b3')::uuid, 'final') d) x;
select test.login(test.id('client_a'));
select test.eq(test.error_of(format('select public.job_document_data(%L, %L, %L)', test.id('client_a'), current_setting('test.b3'), 'final')),
  'permission denied for function job_document_data', 'only the Edge Function (service role) calls it');
select test.logout();

-- The client's company: their own row only, a valid code.
select test.login(test.id('client_a'));
select test.fails($$update public.profiles set company_vat_id = '123' where id = auth.uid()$$, 'check', 'a valid company code');
update public.profiles set company_name = '' where id = auth.uid();
select test.logout();
select test.eq(company_name, null::text, 'an empty company name clears it')
from public.profiles where id = test.id('client_a');

rollback;
