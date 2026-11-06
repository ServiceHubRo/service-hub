-- M6 — fleet notifications: the outbox written by the business transactions, the recipients of each
-- event (five members: admin, manager, driver, accountant, driver with quotes.approve), no amounts
-- without costs.view, one notice per user and key, obsolete events closed, a poison event failing after
-- 24 attempts without blocking the queue, the admin's list (no private data) and retry, the daily part
-- run twice, a removed member, a plan without extra rights, fleet_can = fleet_user_can, the rights
-- versions. Two workers racing and a crash mid-event: tests/sql/149_fleet_concurrency.sql.
begin;
select test.make_fleet();

-- The worker without its commits (the test runs in one transaction): claim, process, record errors.
create function pg_temp.run() returns int
language plpgsql security definer as $$
declare
  v_id bigint;
  v_n int := 0;
  v_code text;
  v_msg text;
begin
  loop
    v_id := public.fleet_claim_event();
    exit when v_id is null or v_n > 500;
    v_code := null;
    begin
      perform public.fleet_process_event(v_id);
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text;
    end;
    if v_code is not null then
      perform public.fleet_event_failed(v_id, case when v_code = 'P0001' then v_msg else v_code end, v_msg);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
create function pg_temp.got(p_user uuid, p_event text) returns bigint
language sql security definer as $$ select count(*) from public.notification_events where user_id = p_user and event = p_event $$;
create function pg_temp.params(p_user uuid, p_event text) returns jsonb
language sql security definer as $$ select params from public.notification_events where user_id = p_user and event = p_event order by created_at desc limit 1 $$;
create function pg_temp.events(p_event text) returns bigint
language sql security definer as $$ select count(*) from public.fleet_events where event = p_event $$;
create function pg_temp.co_events(p_event text) returns bigint
language sql security definer as $$ select count(*) from public.fleet_events where event = p_event and company_id = test.id('co') $$;
create function pg_temp.due_now() returns void
language sql security definer as $$ update public.fleet_events set next_attempt_at = now() - interval '1 second', locked_until = null where processed_at is null and failed_at is null $$;
grant execute on all functions in schema pg_temp to public;

-- ------------------------------------------------------------------ a quote waiting: the approvers, minus the booker
select set_config('test.b1', test.fleet_booking('v1', test.id('client_b'), 'quote_sent', test.workday(3))::text, true);
select set_config('test.q1', test.raw_quote(current_setting('test.b1')::uuid)::text, true);
select test.eq(pg_temp.events('fleet_quote_waiting'), 1::bigint, 'the quote wrote one event in its own transaction');
select test.eq((select data from public.fleet_events where event = 'fleet_quote_waiting')::text, jsonb_build_object('quote_id', current_setting('test.q1'))::text,
  'the event holds references only');
select pg_temp.run();
select test.eq(pg_temp.got(test.id('client_a'), 'fleet_quote_waiting'), 1::bigint, 'admin: told');
select test.eq(pg_temp.got(test.id('mgr'), 'fleet_quote_waiting'), 1::bigint, 'manager: told');
select test.eq(pg_temp.got(test.id('appr'), 'fleet_quote_waiting'), 1::bigint, 'driver with quotes.approve: told');
select test.eq(pg_temp.got(test.id('client_b'), 'fleet_quote_waiting'), 0::bigint, 'the booker (a driver): not told');
select test.eq(pg_temp.got(test.id('acc'), 'fleet_quote_waiting'), 0::bigint, 'the accountant: not an approver');
select test.eq(pg_temp.got(test.id('drv2'), 'fleet_quote_waiting'), 0::bigint, 'another driver: not told');
select test.ok(pg_temp.params(test.id('mgr'), 'fleet_quote_waiting') ? 'total', 'an approver with costs.view gets the amount');
select test.eq(pg_temp.params(test.id('mgr'), 'fleet_quote_waiting')->>'ref', (select ref from public.bookings where id = current_setting('test.b1')::uuid),
  'and the booking''s code');
-- Processed again: nothing twice.
select pg_temp.due_now();
update public.fleet_events set processed_at = null, attempts = 0 where event = 'fleet_quote_waiting';
select pg_temp.run();
select test.eq(pg_temp.got(test.id('mgr'), 'fleet_quote_waiting'), 1::bigint, 'processed twice: one notification per user and key');

-- ------------------------------------------------------------------ the decision: booker and driver, no amount without costs.view
select test.login(test.id('mgr'));
select public.fleet_decide_quote(current_setting('test.b1')::uuid, current_setting('test.q1')::uuid,
  (select test.quote_item_ids(current_setting('test.q1')::uuid)), gen_random_uuid());
select test.logout();
select pg_temp.run();
select test.eq(pg_temp.got(test.id('client_b'), 'fleet_quote_decided'), 1::bigint, 'the booker (and driver) is told');
select test.ok(not (pg_temp.params(test.id('client_b'), 'fleet_quote_decided') ?| array['total', 'total_sent', 'cost', 'amount', 'inspection_fee']),
  'a driver without costs.view gets no amount');
select test.eq(pg_temp.got(test.id('mgr'), 'fleet_quote_decided'), 0::bigint, 'the actor is left out');

-- ------------------------------------------------------------------ a quote already answered: obsolete, closed without notices
select set_config('test.b2', test.fleet_booking('v2', test.id('drv2'), 'quote_sent', test.workday(4))::text, true);
select set_config('test.q2', test.raw_quote(current_setting('test.b2')::uuid)::text, true);
update public.quotes set status = 'withdrawn' where id = current_setting('test.q2')::uuid;
select pg_temp.run();
select test.eq((select last_error_code from public.fleet_events where entity_id = current_setting('test.q2')::uuid and event = 'fleet_quote_waiting'), 'obsolete',
  'a quote no longer sent: closed as obsolete');
select test.eq(pg_temp.got(test.id('mgr'), 'fleet_quote_waiting'), 1::bigint, 'and nobody is told about it');

-- ------------------------------------------------------------------ issues, expenses, cancel
select test.login(test.id('client_b'));
select public.fleet_report_issue(test.id('co'), gen_random_uuid(),
  jsonb_build_object('vehicle_id', test.id('v1'), 'kind', 'defect', 'title', 'Bec ars', 'happened_on', test.today()), gen_random_uuid());
select public.fleet_save_expense(test.id('co'), null, jsonb_build_object('vehicle_id', test.id('v1'), 'category', 'fuel', 'day', test.today(),
  'amount', 250, 'supplier', 'Petrom'), gen_random_uuid());
select test.logout();
select pg_temp.run();
select test.eq(pg_temp.got(test.id('mgr'), 'fleet_issue_reported') + pg_temp.got(test.id('client_a'), 'fleet_issue_reported'), 2::bigint,
  'an issue: issues.manage (admin, manager)');
select test.eq(pg_temp.got(test.id('acc'), 'fleet_issue_reported'), 0::bigint, 'not the accountant');
select test.eq(pg_temp.got(test.id('acc'), 'fleet_expense_to_check'), 1::bigint, 'a receipt to check: costs.manage (the accountant too)');
select test.eq(pg_temp.got(test.id('client_b'), 'fleet_expense_to_check'), 0::bigint, 'not the driver who added it');

select set_config('test.b3', test.fleet_booking('v2', test.id('drv2'), 'pending', test.workday(6))::text, true);
select test.login(test.id('mgr'));
select public.fleet_cancel_booking(current_setting('test.b3')::uuid, 'Vehiculul nu mai este disponibil', gen_random_uuid());
select test.logout();
select pg_temp.run();
select test.eq(pg_temp.got(test.id('drv2'), 'fleet_booking_cancelled'), 1::bigint, 'cancel by the manager: the booker and driver told');
select test.eq(pg_temp.params(test.id('drv2'), 'fleet_booking_cancelled')->>'reason', 'Vehiculul nu mai este disponibil', 'with the reason');

-- ------------------------------------------------------------------ a removed member gets nothing; a plan without extra rights
select set_config('test.b4', test.fleet_booking('v1', test.id('client_b'), 'quote_sent', test.workday(8))::text, true);
select test.login(test.id('client_a'));
select public.remove_company_member(test.id('m_mgr'), gen_random_uuid());
select test.logout();
select test.login(test.id('admin'));
select public.admin_set_company_plan(test.id('co'), 'fleet_start', gen_random_uuid());
select test.logout();
select test.raw_quote(current_setting('test.b4')::uuid);
select pg_temp.run();
select test.eq(pg_temp.got(test.id('mgr'), 'fleet_quote_waiting'), 1::bigint, 'a removed member: no new notification');
select test.eq(pg_temp.got(test.id('appr'), 'fleet_quote_waiting'), 1::bigint, 'a plan without extra rights: quotes.approve given as extra no longer counts');
select test.eq(pg_temp.got(test.id('client_a'), 'fleet_quote_waiting'), 2::bigint, 'the admin still is');
select test.logout();
select test.login(test.id('admin'));
select public.admin_set_company_plan(test.id('co'), 'fleet_business', gen_random_uuid());
select test.logout();

-- ------------------------------------------------------------------ the daily part, twice
update public.company_vehicles set itp_expiry = test.today() + 7 where id = test.id('v1');
select public.fleet_daily();
select test.eq(pg_temp.co_events('fleet_doc_expiring'), 1::bigint, 'ITP in 7 days: one event');
select public.fleet_daily();
select test.eq(pg_temp.co_events('fleet_doc_expiring'), 1::bigint, 'run twice the same day: nothing twice');
select pg_temp.run();
select test.eq(pg_temp.got(test.id('client_b'), 'fleet_doc_expiring'), 1::bigint, 'the vehicle''s driver is told');
select test.eq(pg_temp.got(test.id('client_a'), 'fleet_doc_expiring'), 1::bigint, 'and vehicles.manage');
-- Renewed before processing: obsolete.
update public.company_vehicles set rca_expiry = test.today() + 30 where id = test.id('v2');
select public.fleet_daily();
update public.company_vehicles set rca_expiry = test.today() + 365 where id = test.id('v2');
select pg_temp.run();
select test.eq(pg_temp.got(test.id('drv2'), 'fleet_doc_expiring'), 0::bigint, 'a document renewed before sending: nobody told');

-- ------------------------------------------------------------------ a poison event
insert into public.fleet_events (company_id, event, entity_id, data, event_key)
values (test.id('co'), 'fleet_doc_expiring', test.id('v1'), '{"doc":"itp","expiry":"not a date"}', 'poison:1');
select set_config('test.poison', (select id::text from public.fleet_events where event_key = 'poison:1'), true);
do $$
begin
  for i in 1..24 loop
    perform pg_temp.due_now();
    perform pg_temp.run();
  end loop;
end
$$;
select test.ok((select failed_at is not null and attempts = 24 from public.fleet_events where id = current_setting('test.poison')::bigint),
  'after 24 attempts the poison event is failed');
select test.eq((select last_error_code from public.fleet_events where id = current_setting('test.poison')::bigint), '22007', 'its SQLSTATE is kept');
select test.eq((select count(*) from public.fleet_events where processed_at is null and failed_at is null and event_key <> 'poison:1'
  and company_id in (test.id('co'), test.id('co2'))), 0::bigint, 'the queue was never blocked');
select test.ok((public.admin_digest_counts()->>'fleet_failed')::int >= 1, 'the daily digest counts it');

-- The admin: the list without private data, and a retry.
select test.login(test.id('client_a'));
select test.fails('select public.admin_list_failed_fleet_events()', 'not_allowed', 'not a platform admin: refused');
select test.login(test.id('admin'));
select test.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_list_failed_fleet_events()->0) k),
  'attempts,company_name,created_at,event,failed_at,id,last_error_code', 'the admin list: no data, no error text, no vehicle, person or amount');
select test.eq((public.admin_retry_fleet_event(current_setting('test.poison')::bigint, gen_random_uuid()))->>'id', current_setting('test.poison'), 'retried');
select test.logout();
select test.ok((select failed_at is null and attempts = 0 from public.fleet_events where id = current_setting('test.poison')::bigint), 'back in the queue');
select test.login(test.id('client_a'));
select test.fails('select 1 from public.fleet_events', 'permission denied', 'the outbox is closed to the browser');
select test.fails('select 1 from public.fleet_notices', 'permission denied', 'and the dedupe log');
select test.fails('call public.process_fleet_events()', 'permission denied', 'nor can it run the worker');
select test.logout();

-- ------------------------------------------------------------------ fleet_can = fleet_user_can, over role × cap × extras × plan
create temp table caps (cap text);
insert into caps values ('vehicles.viewAll'), ('vehicles.manage'), ('bookings.create'), ('bookings.viewAll'), ('quotes.approve'), ('costs.view'),
  ('costs.manage'), ('reports.view'), ('documents.view'), ('documents.manage'), ('issues.report'), ('issues.manage'), ('members.manage'),
  ('budget.manage'), ('audit.view');
grant select on caps to public;
create function pg_temp.mismatches() returns bigint
language plpgsql as $$
declare
  n bigint := 0;
  u record;
  c record;
begin
  for u in select m.user_id from public.company_members m where m.company_id = test.id('co') and m.user_id is not null loop
    perform test.login(u.user_id);
    for c in select cap from caps loop
      if public.fleet_can(test.id('co'), c.cap) is distinct from (select public.fleet_user_can(u.user_id, test.id('co'), c.cap)) then
        n := n + 1;
      end if;
    end loop;
    perform test.logout();
  end loop;
  return n;
end
$$;
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_acc'), array['budget.manage', 'vehicles.manage'], null, gen_random_uuid());
select test.logout();
grant execute on function public.fleet_user_can(uuid, uuid, text) to authenticated;
select test.eq(pg_temp.mismatches(), 0::bigint, 'Business plan: fleet_can equals fleet_user_can for every member and right');
select test.login(test.id('admin'));
select public.admin_set_company_plan(test.id('co'), 'fleet_start', gen_random_uuid());
select test.logout();
select test.eq(pg_temp.mismatches(), 0::bigint, 'Start plan (no extra rights): the same');
revoke execute on function public.fleet_user_can(uuid, uuid, text) from authenticated;

-- ------------------------------------------------------------------ rights versions
select test.login(test.id('admin'));
select public.admin_set_company_plan(test.id('co'), 'fleet_business', gen_random_uuid());
select test.logout();
select set_config('test.v_before', (select version::text from public.member_rights_versions where user_id = test.id('acc') and company_id = test.id('co')), true);
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_acc'), array['vehicles.manage'], null, gen_random_uuid());
select test.login(test.id('acc'));
select test.ok((select version from public.member_rights_versions where company_id = test.id('co')) > current_setting('test.v_before')::bigint,
  'a right changed: the member''s version goes up, readable by them');
select test.eq(test.count('select 1 from public.member_rights_versions'), 1::bigint, 'only their own row');
select test.login(test.id('admin'));
select public.admin_set_company_plan(test.id('co'), 'fleet_start', gen_random_uuid());
select test.login(test.id('client_b'));
select test.ok((select version from public.member_rights_versions where company_id = test.id('co')) > 1, 'a plan change bumps every member');

rollback;
