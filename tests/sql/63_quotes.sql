-- Quotes (ARCHITECTURE §3, FR §6 "Job flow"): validation, fee snapshot, immutability, versions,
-- partial approval, refusal with the inspection fee, withdrawal, expiry releasing the place.
begin;
select test.make_world();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';
update public.shops set inspection_fee = 80, daily_capacity = 20 where id = test.id('shop1');
select set_config('test.day1', test.workday(1)::text, true);

-- A booking in inspection, through the real flow.
create function pg_temp.in_inspection(p_slot time) returns uuid
language plpgsql as $$
declare
  v uuid := test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, p_slot);
begin
  perform test.login(test.id('owner1'));
  perform public.confirm_booking(v, gen_random_uuid());
  perform public.start_inspection(v, gen_random_uuid());
  perform test.logout();
  return v;
end $$;

select set_config('test.b', pg_temp.in_inspection('09:00')::text, true);

-- ------------------------------------------------------------------ validation
select test.login(test.id('owner1'));
select test.fails(format($$select public.send_quote(%L, '[]', gen_random_uuid())$$, current_setting('test.b')), 'quote_items_required', 'at least one line');
select test.fails(format($$select public.send_quote(%L, '{"name":"x"}', gen_random_uuid())$$, current_setting('test.b')), 'quote_items_required', 'lines must be a list');
select test.fails(format($$select public.send_quote(%L, '[{"name":"Verificare","price":0}]', gen_random_uuid())$$, current_setting('test.b')), 'quote_total_zero', 'total must be above zero');
select test.fails(format($$select public.send_quote(%L, '[{"name":"Plăcuțe","price":-5}]', gen_random_uuid())$$, current_setting('test.b')), 'quote_item_invalid', 'no negative prices');
select test.fails(format($$select public.send_quote(%L, '[{"name":"Plăcuțe","price":12.345}]', gen_random_uuid())$$, current_setting('test.b')), 'quote_item_invalid', 'at most 2 decimals');
select test.fails(format($$select public.send_quote(%L, '[{"name":"Plăcuțe","price":"abc"}]', gen_random_uuid())$$, current_setting('test.b')), 'quote_item_invalid', 'price must be a number');
select test.fails(format($$select public.send_quote(%L, '[{"name":"  ","price":10}]', gen_random_uuid())$$, current_setting('test.b')), 'quote_item_invalid', 'every line needs a name');
select test.eq(test.error_params(format($$select public.send_quote(%L, '[{"name":"ok","price":10},{"name":"","price":10}]', gen_random_uuid())$$, current_setting('test.b')))->>'position',
  '2', 'the refusal names the bad line');
select test.fails(format($$select public.send_quote(%L, %L, gen_random_uuid())$$, current_setting('test.b'),
  (select jsonb_agg(jsonb_build_object('name', 'Linie ' || i, 'price', 1)) from generate_series(1, 51) i)),
  'quote_too_many_items', 'at most 50 lines');
select test.fails(format($$select public.send_quote(%L, '[{"name":"Plăcuțe","price":10}]', gen_random_uuid(), repeat('x', 2001))$$, current_setting('test.b')),
  'note_too_long', 'note up to 2000 characters');
select test.logout();
select test.eq(test.status_of(current_setting('test.b')::uuid), 'in_inspection', 'refused quotes changed nothing');
select test.eq(count(*), 0::bigint, 'and stored no quote') from public.quotes where booking_id = current_setting('test.b')::uuid;

-- ------------------------------------------------------------------ send: snapshot and immutability
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.b')::uuid,
  '[{"name":"Plăcuțe frână față","price":280},{"name":"Discuri frână față","price":"420.50"},{"name":"Manoperă","price":150}]',
  gen_random_uuid(), 'Discurile sunt sub limită.');
select test.logout();
select set_config('test.q1', test.sent_quote(current_setting('test.b')::uuid)::text, true);
select test.eq(test.status_of(current_setting('test.b')::uuid), 'quote_sent', 'booking waits for the client');
select test.eq(version, 1, 'version 1'),
       test.eq(total_sent, 850.50::numeric(10,2), 'total of the lines'),
       test.eq(inspection_fee, 80.00::numeric(10,2), 'inspection fee snapshot'),
       test.eq(sent_by, test.id('owner1'), 'sent by'),
       test.eq(note, 'Discurile sunt sub limită.', 'note'),
       test.ok(expires_at between now() + interval '3 days' - interval '1 minute' and now() + interval '3 days', 'expires after quote_expiry_days (3)')
from public.quotes where id = current_setting('test.q1')::uuid;
select test.eq(array_agg(name || '=' || price order by position),
               array['Plăcuțe frână față=280.00', 'Discuri frână față=420.50', 'Manoperă=150.00'], 'lines in order'),
       test.eq(count(*) filter (where approved is not null), 0::bigint, 'nothing decided yet')
from public.quote_items where quote_id = current_setting('test.q1')::uuid;
select test.eq(params->>'total', '850.50', 'automatic message carries the total')
from public.messages where booking_id = current_setting('test.b')::uuid and event = 'quote_sent';
select test.eq(count(*), 1::bigint, 'client notified of the quote') from public.notification_events
where booking_id = current_setting('test.b')::uuid and event = 'quote_sent' and user_id = test.id('client_a');

-- A later fee change never alters a sent quote.
update public.shops set inspection_fee = 200 where id = test.id('shop1');
select test.eq(inspection_fee, 80.00::numeric(10,2), 'fee on the sent quote unchanged') from public.quotes where id = current_setting('test.q1')::uuid;

-- Nobody edits a sent quote directly.
select test.login(test.id('client_a'));
select test.eq(test.count(format('select 1 from public.quote_items where quote_id = %L', current_setting('test.q1'))), 3::bigint, 'client reads the lines');
select test.fails($$update public.quote_items set price = 1$$, 'permission denied', 'client cannot change prices');
select test.fails($$update public.quote_items set approved = true$$, 'permission denied', 'client cannot approve lines directly');
select test.fails($$update public.quotes set total_sent = 1$$, 'permission denied', 'client cannot change the total');
select test.fails($$delete from public.quote_items$$, 'permission denied', 'client cannot delete lines');
select test.logout();
select test.login(test.id('owner1'));
select test.fails($$update public.quote_items set price = 1$$, 'permission denied', 'shop cannot change a sent line');
select test.fails($$update public.quotes set status = 'accepted'$$, 'permission denied', 'shop cannot mark its quote accepted');
select test.fails($$insert into public.quote_items (quote_id, position, name, price) values (test.sent_quote(test.id('shop1')), 9, 'x', 1)$$,
  'permission denied', 'shop cannot add a line to a sent quote');
select test.logout();

-- ------------------------------------------------------------------ replace (edit) = new version
select test.login(test.id('owner1'));
select public.replace_quote(current_setting('test.b')::uuid,
  '[{"name":"Plăcuțe frână față","price":280},{"name":"Discuri frână față","price":420},{"name":"Manoperă","price":150}]', gen_random_uuid());
select test.logout();
select set_config('test.q2', test.sent_quote(current_setting('test.b')::uuid)::text, true);
select test.eq(status, 'superseded', 'old version superseded') from public.quotes where id = current_setting('test.q1')::uuid;
select test.eq(count(*), 3::bigint, 'old version keeps its lines for history') from public.quote_items where quote_id = current_setting('test.q1')::uuid;
select test.eq(version, 2, 'new version 2'), test.eq(total_sent, 850.00::numeric(10,2), 'new total'),
       test.eq(inspection_fee, 200.00::numeric(10,2), 'new version snapshots the current fee')
from public.quotes where id = current_setting('test.q2')::uuid;
select test.eq(test.status_of(current_setting('test.b')::uuid), 'quote_sent', 'still waiting for the client');

-- The client answers the version they saw; a stale answer is refused.
select test.login(test.id('client_a'));
select test.fails(format($$select public.decide_quote(%L, %L, %L, gen_random_uuid())$$, current_setting('test.b'), current_setting('test.q1'),
  test.quote_item_ids(current_setting('test.q1')::uuid)), 'quote_changed', 'answer to a replaced version refused');
select test.fails(format($$select public.decide_quote(%L, %L, %L, gen_random_uuid())$$, current_setting('test.b'), current_setting('test.q2'),
  test.quote_item_ids(current_setting('test.q1')::uuid)), 'quote_item_invalid', 'lines from another version refused');

-- ------------------------------------------------------------------ partial approval recalculates the total
select public.decide_quote(current_setting('test.b')::uuid, current_setting('test.q2')::uuid,
  (test.quote_item_ids(current_setting('test.q2')::uuid))[1:1] || (test.quote_item_ids(current_setting('test.q2')::uuid))[3:3], gen_random_uuid());
select test.logout();
select test.eq(status, 'partially_accepted', 'quote partially accepted'),
       test.eq(total_approved, 430.00::numeric(10,2), 'total = approved lines only (280 + 150)'),
       test.ok(decided_at is not null, 'decided_at set')
from public.quotes where id = current_setting('test.q2')::uuid;
select test.eq(array_agg(approved order by position), array[true, false, true], 'per-line decision stored')
from public.quote_items where quote_id = current_setting('test.q2')::uuid;
select test.eq(test.status_of(current_setting('test.b')::uuid), 'approved', 'booking approved');
select test.eq(params->>'total', '430.00', 'shop told the approved total')
from public.notification_events where booking_id = current_setting('test.b')::uuid and event = 'quote_partially_accepted'
  and user_id = test.id('owner1');

-- Work, then completion prefilled from the approved lines.
select test.login(test.id('owner1'));
select public.start_work(current_setting('test.b')::uuid, gen_random_uuid());
select public.complete_job(current_setting('test.b')::uuid, 120000, gen_random_uuid());
select test.logout();
select test.eq(status, 'done', 'job done'),
       test.eq(work, 'Plăcuțe frână față, Manoperă', 'work defaults to the approved lines'),
       test.eq(cost, 430.00::numeric(10,2), 'cost defaults to the approved total'),
       test.ok(started_at is not null and done_at is not null, 'timestamps set')
from public.bookings where id = current_setting('test.b')::uuid;

-- ------------------------------------------------------------------ full acceptance
select set_config('test.full', pg_temp.in_inspection('10:00')::text, true);
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.full')::uuid, '[{"name":"Ulei","price":210},{"name":"Filtru","price":45}]', gen_random_uuid());
select test.logout();
select test.login(test.id('client_a'));
select public.decide_quote(current_setting('test.full')::uuid, test.sent_quote(current_setting('test.full')::uuid),
  test.quote_item_ids(test.sent_quote(current_setting('test.full')::uuid)), gen_random_uuid());
select test.logout();
select test.eq(q.status, 'accepted', 'all lines → accepted'), test.eq(q.total_approved, 255.00::numeric(10,2), 'approved total = sent total'),
       test.eq(b.status, 'approved', 'booking approved')
from public.quotes q join public.bookings b on b.id = q.booking_id where q.booking_id = current_setting('test.full')::uuid;
select test.eq(count(*), 2::bigint, 'owner and staff told the quote was accepted') from public.notification_events
where booking_id = current_setting('test.full')::uuid and event = 'quote_accepted';
select test.login(test.id('owner1'));
select public.start_work(current_setting('test.full')::uuid, gen_random_uuid());
select public.complete_job(current_setting('test.full')::uuid, 120500, gen_random_uuid(), 'Schimb ulei și filtru, verificare lichide', 300);
select test.logout();
select test.eq(work, 'Schimb ulei și filtru, verificare lichide', 'work edited by the shop'), test.eq(cost, 300.00::numeric(10,2), 'final cost edited')
from public.bookings where id = current_setting('test.full')::uuid;

-- ------------------------------------------------------------------ refusal applies the inspection fee
select set_config('test.ref', pg_temp.in_inspection('11:00')::text, true);
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.ref')::uuid, '[{"name":"Compresor clima","price":1600}]', gen_random_uuid());
select test.logout();
update public.shops set inspection_fee = 999 where id = test.id('shop1'); -- after sending: must not matter
select test.login(test.id('client_a'));
select public.decide_quote(current_setting('test.ref')::uuid, test.sent_quote(current_setting('test.ref')::uuid), '{}', gen_random_uuid());
select test.logout();
select test.eq(b.status, 'quote_refused', 'no line approved → refused'),
       test.eq(b.cost, 200.00::numeric(10,2), 'cost = inspection fee snapshotted on the quote'),
       test.eq(q.status, 'refused', 'quote refused'),
       test.eq(q.total_approved, 0.00::numeric(10,2), 'nothing approved')
from public.bookings b join public.quotes q on q.booking_id = b.id where b.id = current_setting('test.ref')::uuid;
select test.eq(bool_and(approved = false), true, 'every line marked refused') from public.quote_items qi
join public.quotes q on q.id = qi.quote_id where q.booking_id = current_setting('test.ref')::uuid;
select test.eq(params->>'inspection_fee', '200.00', 'shop told the fee applies') from public.notification_events
where booking_id = current_setting('test.ref')::uuid and event = 'quote_refused' and user_id = test.id('owner1');
select test.login(test.id('owner1'));
select test.fails(format($$select public.start_work(%L, gen_random_uuid())$$, current_setting('test.ref')), 'wrong_status', 'no work after a refusal');
select test.logout();
update public.shops set inspection_fee = 80 where id = test.id('shop1');

-- ------------------------------------------------------------------ withdraw, then quote again
select set_config('test.w', pg_temp.in_inspection('12:00')::text, true);
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.w')::uuid, '[{"name":"Senzor","price":380}]', gen_random_uuid());
select set_config('test.wq', test.sent_quote(current_setting('test.w')::uuid)::text, true);
select public.withdraw_quote(current_setting('test.w')::uuid, gen_random_uuid());
select test.logout();
select test.eq(status, 'withdrawn', 'quote withdrawn') from public.quotes where id = current_setting('test.wq')::uuid;
select test.eq(test.status_of(current_setting('test.w')::uuid), 'in_inspection', 'back in inspection');
select test.login(test.id('client_a'));
select test.fails(format($$select public.decide_quote(%L, %L, '{}', gen_random_uuid())$$, current_setting('test.w'), current_setting('test.wq')),
  'wrong_status', 'withdrawn quote cannot be answered');
select test.logout();

-- ------------------------------------------------------------------ at most 20 versions per booking
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.w')::uuid, '[{"name":"Senzor","price":1}]', gen_random_uuid()); -- version 2
select public.replace_quote(current_setting('test.w')::uuid, format('[{"name":"Senzor","price":%s}]', i)::jsonb, gen_random_uuid())
from generate_series(3, 20) i;
select test.eq((select max(version) from public.quotes where booking_id = current_setting('test.w')::uuid), 20, '20 versions allowed');
select test.fails(format($$select public.replace_quote(%L, '[{"name":"Senzor","price":21}]', gen_random_uuid())$$, current_setting('test.w')),
  'limit_quote_versions', 'the 21st version is refused');
select test.eq(test.error_params(format($$select public.replace_quote(%L, '[{"name":"Senzor","price":21}]', gen_random_uuid())$$, current_setting('test.w')))->>'limit',
  '20', 'the refusal names the limit');
select public.withdraw_quote(current_setting('test.w')::uuid, gen_random_uuid());
select test.fails(format($$select public.send_quote(%L, '[{"name":"Senzor","price":21}]', gen_random_uuid())$$, current_setting('test.w')),
  'limit_quote_versions', 'withdrawing does not reset the count');
select test.logout();

-- ------------------------------------------------------------------ expiry releases the place
update public.shops set daily_capacity = 1 where id = test.id('shop1');
select set_config('test.day2', test.workday(2)::text, true);
select set_config('test.e', test.book(test.id('client_b'), test.id('shop1'), current_setting('test.day2')::date, '09:00')::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.e')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.e')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.e')::uuid, '[{"name":"Senzor ABS","price":380}]', gen_random_uuid());
select test.logout();
select test.eq(test.error_of(format($$select test.book(%L, %L, %L, '12:00')$$, test.id('client_a'), test.id('shop1'), current_setting('test.day2'))),
  'day_full', 'a quote waiting for an answer holds the day''s only place');

-- Answering after the deadline is refused even before the job runs.
update public.quotes set expires_at = now() - interval '1 minute' where booking_id = current_setting('test.e')::uuid and status = 'sent';
select test.login(test.id('client_b'));
select test.fails(format($$select public.decide_quote(%L, %L, %L, gen_random_uuid())$$, current_setting('test.e'),
  test.sent_quote(current_setting('test.e')::uuid), test.quote_item_ids(test.sent_quote(current_setting('test.e')::uuid))),
  'quote_expired', 'expired quote cannot be accepted');
select test.fails($$select public.expire_quotes()$$, 'permission denied', 'expire_quotes is not callable from the browser');
select test.logout();

select test.ok(public.expire_quotes() >= 1, 'expire_quotes expired the overdue quote');
select test.eq(b.status, 'expired', 'booking expired'), test.eq(q.status, 'expired', 'quote expired')
from public.bookings b join public.quotes q on q.booking_id = b.id where b.id = current_setting('test.e')::uuid;
select test.eq(count(distinct user_id), 3::bigint, 'client, owner and staff notified')
from public.notification_events where booking_id = current_setting('test.e')::uuid and event = 'quote_expired';
select test.eq(params->>'by', 'system', 'automatic message from the system')
from public.messages where booking_id = current_setting('test.e')::uuid and event = 'quote_expired';
select test.eq(public.expire_quotes(), 0, 'running again finds nothing');
select test.eq(test.error_of(format($$select test.book(%L, %L, %L, '12:00')$$, test.id('client_a'), test.id('shop1'), current_setting('test.day2'))),
  'ok', 'the expired booking released its place');

rollback;
