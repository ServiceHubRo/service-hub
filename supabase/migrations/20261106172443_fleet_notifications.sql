-- M6 / T76 — fleet notifications through a durable outbox (Eduard, 6 Nov 2026: approved in
-- docs/FLEET_EXTENSION_PLAN.md §M6, decisions 5, 7 and 8).
--
-- Write: triggers on quotes, bookings, company_quote_decisions, fleet_issues and fleet_expenses do one
-- plain insert into fleet_events inside the business transaction (on conflict (event_key) do nothing):
-- no recipients, no texts, no external call, no swallowed error. A daily part adds documents and
-- maintenance due. Data holds references only, never amounts.
--
-- Process: `call process_fleet_events()` every minute (pg_cron sh_fleet_events). Per event: claim it and
-- commit (attempt counted, held 5 minutes); then, in its own transaction, check it still matters (a
-- quote no longer sent, a document renewed, maintenance done: closed as obsolete), find the recipients
-- (current accepted members of the non-archived company, by fleet_user_can, the actor left out), insert
-- one fleet_notices row per user and key (on conflict do nothing) and, only for a new row, one
-- notification_events row (amounts only for members with costs.view at that moment), and close it. On an
-- error the work is rolled back and the error recorded; retried after 1, 5, 15, 60 minutes, then hourly;
-- after 24 attempts it is marked failed and never blocks the queue. Delivery stays with the existing
-- dispatcher (unchanged). Processed events are purged after 90 days, notices after 400.
--
-- Admin: the daily digest counts failed fleet events and fleet notifications the dispatcher gave up;
-- Admin → „Notificări flotă eșuate” lists failed events (no data, no error text, no vehicle, person or
-- amount) with a retry.
--
-- Rights changes (decision 8): member_rights_versions, one row per user and company, bumped whenever a
-- membership, role, extra right or the company's plan changes; readable by its user and in the realtime
-- publication, so open screens drop their data and read again.
--
-- fleet_can becomes a call to fleet_user_can (same results). Rollback:
-- supabase/rollback/20261106172443_fleet_notifications.sql.

create table public.fleet_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  event text not null check (event in ('fleet_quote_waiting', 'fleet_quote_decided', 'fleet_quote_changes',
    'fleet_booking_changed', 'fleet_booking_cancelled', 'fleet_issue_reported', 'fleet_expense_to_check',
    'fleet_doc_expiring', 'fleet_maintenance_due')),
  entity_id uuid not null,
  booking_id uuid references public.bookings (id) on delete set null,
  actor uuid,
  data jsonb not null default '{}',
  event_key text not null,
  created_at timestamptz not null default now(),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  last_error_code text check (char_length(last_error_code) <= 100),
  last_error text check (char_length(last_error) <= 1000),
  constraint fleet_events_event_key unique (event_key)
);
create index fleet_events_due_idx on public.fleet_events (next_attempt_at) where processed_at is null and failed_at is null;
create index fleet_events_failed_idx on public.fleet_events (failed_at) where failed_at is not null;

create table public.fleet_notices (
  id bigint generated always as identity primary key,
  fleet_event_id bigint not null references public.fleet_events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  dedupe_key text not null,
  notification_id uuid references public.notification_events (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fleet_notices_user_key unique (user_id, dedupe_key)
);
create index fleet_notices_event_idx on public.fleet_notices (fleet_event_id);
alter table public.fleet_events enable row level security;
alter table public.fleet_notices enable row level security;
revoke all on public.fleet_events, public.fleet_notices from anon, authenticated;

-- ------------------------------------------------------------------ rights of any member (fleet_can's twin)
create function public.fleet_user_can(p_user uuid, p_company uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.fleet_member_can(m.role,
      case when public.fleet_has_feature(p_company, 'member_rights') then m.extra_caps else '{}'::text[] end,
      p_capability)
    from public.company_members m
    where m.company_id = p_company and m.user_id = p_user and m.accepted_at is not null
  ), false)
$$;
revoke execute on function public.fleet_user_can(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.fleet_can(p_company uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.fleet_user_can(auth.uid(), p_company, p_capability)
$$;

-- ------------------------------------------------------------------ write: one plain insert
create function public.fleet_enqueue(p_company uuid, p_event text, p_entity uuid, p_booking uuid, p_data jsonb, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fleet_events (company_id, event, entity_id, booking_id, actor, data, event_key)
  values (p_company, p_event, p_entity, p_booking, auth.uid(), coalesce(p_data, '{}'::jsonb), p_key)
  on conflict (event_key) do nothing
$$;
revoke execute on function public.fleet_enqueue(uuid, text, uuid, uuid, jsonb, text) from public, anon, authenticated;

create function public.fleet_events_from_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select b.company_id into v_company from public.bookings b where b.id = new.booking_id;
  if v_company is null then
    return null;
  end if;
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    perform public.fleet_enqueue(v_company, 'fleet_quote_waiting', new.id, new.booking_id,
      jsonb_build_object('quote_id', new.id), 'quote_waiting:' || new.id);
  elsif tg_op = 'UPDATE' and old.status = 'sent' and new.status in ('accepted', 'partially_accepted', 'refused') then
    perform public.fleet_enqueue(v_company, 'fleet_quote_decided', new.id, new.booking_id,
      jsonb_build_object('quote_id', new.id, 'decision', new.status), 'quote_decided:' || new.id);
  end if;
  return null;
end
$$;
create trigger quotes_fleet_events after insert or update of status on public.quotes
  for each row execute function public.fleet_events_from_quote();

create function public.fleet_events_from_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'changes_requested' then
    perform public.fleet_enqueue(new.company_id, 'fleet_quote_changes', new.quote_id, new.booking_id,
      jsonb_build_object('quote_id', new.quote_id), 'quote_changes:' || new.quote_id);
  end if;
  return null;
end
$$;
create trigger company_quote_decisions_fleet_events after insert on public.company_quote_decisions
  for each row execute function public.fleet_events_from_decision();

create function public.fleet_events_from_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null then
    return null;
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform public.fleet_enqueue(new.company_id, 'fleet_booking_cancelled', new.id, new.id,
      jsonb_build_object('from_status', old.status), 'booking_cancelled:' || new.id);
  elsif (new.status is distinct from old.status and new.status in ('confirmed', 'declined', 'in_inspection', 'in_progress', 'done', 'no_show', 'expired'))
        or new.date is distinct from old.date or new.slot is distinct from old.slot then
    perform public.fleet_enqueue(new.company_id, 'fleet_booking_changed', new.id, new.id,
      jsonb_build_object('status', new.status, 'from_status', old.status), 'booking_changed:' || new.id || ':' || txid_current());
  end if;
  return null;
end
$$;
create trigger bookings_fleet_events after update of status, date, slot on public.bookings
  for each row execute function public.fleet_events_from_booking();

create function public.fleet_events_from_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fleet_enqueue(new.company_id, 'fleet_issue_reported', new.id, new.booking_id,
    jsonb_build_object('issue_id', new.id, 'vehicle_id', new.vehicle_id), 'issue_reported:' || new.id);
  return null;
end
$$;
create trigger fleet_issues_fleet_events after insert on public.fleet_issues
  for each row execute function public.fleet_events_from_issue();

create function public.fleet_events_from_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'to_check' then
    perform public.fleet_enqueue(new.company_id, 'fleet_expense_to_check', new.id, null,
      jsonb_build_object('expense_id', new.id, 'vehicle_id', new.vehicle_id), 'expense_to_check:' || new.id);
  end if;
  return null;
end
$$;
create trigger fleet_expenses_fleet_events after insert on public.fleet_expenses
  for each row execute function public.fleet_events_from_expense();
revoke execute on function public.fleet_events_from_quote(), public.fleet_events_from_decision(), public.fleet_events_from_booking(),
  public.fleet_events_from_issue(), public.fleet_events_from_expense() from public, anon, authenticated;

-- ------------------------------------------------------------------ process
-- Claim one due event: the attempt is counted and the event held for 5 minutes (committed at once by
-- the caller, so a crash later still counts it).
create function public.fleet_claim_event()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with c as (
    select e.id from public.fleet_events e
    where e.processed_at is null and e.failed_at is null and e.next_attempt_at <= now()
      and (e.locked_until is null or e.locked_until < now())
    order by e.id
    limit 1
    for update skip locked
  )
  update public.fleet_events e set attempts = e.attempts + 1, locked_until = now() + interval '5 minutes'
  from c where e.id = c.id
  returning e.id
$$;

-- An error: recorded, retried after 1, 5, 15, 60 minutes, then hourly; failed after attempt 24.
create function public.fleet_event_failed(p_id bigint, p_code text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.fleet_events
  set last_error_code = left(coalesce(p_code, 'unknown'), 100),
      last_error = left(coalesce(p_error, ''), 1000),
      locked_until = null,
      next_attempt_at = now() + case attempts when 1 then interval '1 minute' when 2 then interval '5 minutes'
                                              when 3 then interval '15 minutes' else interval '60 minutes' end,
      failed_at = case when attempts >= 24 then now() end
  where id = p_id
$$;

-- One event: is it still relevant, who gets it, one notice and one notification per new (user, key).
create function public.fleet_process_event(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.fleet_events%rowtype;
  v_company public.companies%rowtype;
  b public.bookings%rowtype;
  q public.quotes%rowtype;
  cv public.company_vehicles%rowtype;
  v_driver uuid;
  v_users uuid[] := '{}';
  v_params jsonb := '{}'::jsonb;
  v_money jsonb := '{}'::jsonb;
  v_obsolete boolean := false;
  v_user uuid;
  v_notice bigint;
  v_notification uuid;
  v_sent int := 0;
  v_item public.fleet_maintenance%rowtype;
  v_state jsonb;
  v_issue public.fleet_issues%rowtype;
  v_expense public.fleet_expenses%rowtype;
begin
  select * into e from public.fleet_events where id = p_id for update;
  if not found or e.processed_at is not null or e.failed_at is not null then
    return jsonb_build_object('skipped', true);
  end if;
  select * into v_company from public.companies c where c.id = e.company_id;
  if v_company.archived_at is not null then
    v_obsolete := true;
  end if;

  if e.booking_id is not null then
    select * into b from public.bookings where id = e.booking_id;
  end if;
  if e.event in ('fleet_quote_waiting', 'fleet_quote_decided', 'fleet_quote_changes') then
    select * into q from public.quotes where id = public.try_uuid(e.data->>'quote_id');
  end if;
  select * into cv from public.company_vehicles
  where id = coalesce(b.company_vehicle_id, public.try_uuid(e.data->>'vehicle_id'));
  if cv.id is not null then
    select m.user_id into v_driver from public.company_members m
    where m.id = cv.driver_member_id and m.accepted_at is not null;
  end if;
  v_params := jsonb_build_object('company_id', e.company_id, 'company_name', v_company.name, 'plate', coalesce(cv.plate, b.car_snapshot->>'plate'),
    'vehicle_id', cv.id);
  if b.id is not null then
    v_params := v_params || jsonb_build_object('booking_id', b.id, 'ref', b.ref, 'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'),
      'shop_name', (select s.name from public.shops s where s.id = b.shop_id));
  end if;

  case e.event
    when 'fleet_quote_waiting' then
      v_obsolete := v_obsolete or q.id is null or q.status <> 'sent' or b.status is distinct from 'quote_sent';
      select coalesce(array_agg(m.user_id), '{}') into v_users from public.company_members m
      where m.company_id = e.company_id and m.accepted_at is not null and public.fleet_user_can(m.user_id, e.company_id, 'quotes.approve')
        and m.user_id is distinct from b.client_id;
      v_params := v_params || jsonb_build_object('quote_id', q.id);
      v_money := jsonb_build_object('total', q.total_sent);
    when 'fleet_quote_decided' then
      v_obsolete := v_obsolete or q.id is null;
      v_users := array[b.client_id, v_driver];
      v_params := v_params || jsonb_build_object('quote_id', q.id, 'decision', q.status);
      v_money := jsonb_build_object('total', coalesce(q.total_approved, 0));
    when 'fleet_quote_changes' then
      v_obsolete := v_obsolete or q.id is null;
      select coalesce(array_agg(m.user_id), '{}') into v_users from public.company_members m
      where m.company_id = e.company_id and m.accepted_at is not null and public.fleet_user_can(m.user_id, e.company_id, 'quotes.approve');
      v_users := v_users || b.client_id;
      v_params := v_params || jsonb_build_object('quote_id', q.id, 'reason',
        (select d.reason from public.company_quote_decisions d where d.quote_id = q.id and d.decision = 'changes_requested' order by d.id desc limit 1));
    when 'fleet_booking_changed' then
      v_obsolete := v_obsolete or b.id is null;
      v_users := case when v_driver is distinct from b.client_id then array[v_driver] else '{}'::uuid[] end;
      v_params := v_params || jsonb_build_object('status', e.data->>'status', 'from_status', e.data->>'from_status');
    when 'fleet_booking_cancelled' then
      v_obsolete := v_obsolete or b.id is null;
      v_users := array[b.client_id, v_driver];
      v_params := v_params || jsonb_build_object('reason', b.cancel_reason);
    when 'fleet_issue_reported' then
      select * into v_issue from public.fleet_issues where id = e.entity_id;
      v_obsolete := v_obsolete or v_issue.id is null;
      select coalesce(array_agg(m.user_id), '{}') into v_users from public.company_members m
      where m.company_id = e.company_id and m.accepted_at is not null and public.fleet_user_can(m.user_id, e.company_id, 'issues.manage');
      v_params := v_params || jsonb_build_object('issue_id', v_issue.id, 'kind', v_issue.kind, 'title', v_issue.title,
        'plate', coalesce(v_issue.vehicle_label->>'plate', cv.plate));
    when 'fleet_expense_to_check' then
      select * into v_expense from public.fleet_expenses where id = e.entity_id;
      v_obsolete := v_obsolete or v_expense.id is null or v_expense.deleted_at is not null or v_expense.status <> 'to_check';
      select coalesce(array_agg(m.user_id), '{}') into v_users from public.company_members m
      where m.company_id = e.company_id and m.accepted_at is not null and public.fleet_user_can(m.user_id, e.company_id, 'costs.manage');
      v_params := v_params || jsonb_build_object('category', v_expense.category);
      v_money := jsonb_build_object('amount', v_expense.amount, 'currency', v_expense.currency);
    when 'fleet_doc_expiring' then
      v_obsolete := v_obsolete or cv.id is null or cv.archived_at is not null
        or (case e.data->>'doc' when 'itp' then cv.itp_expiry when 'rca' then cv.rca_expiry when 'vignette' then cv.vignette_expiry end)
           is distinct from (e.data->>'expiry')::date;
      select coalesce(array_agg(m.user_id), '{}') into v_users from public.company_members m
      where m.company_id = e.company_id and m.accepted_at is not null and public.fleet_user_can(m.user_id, e.company_id, 'vehicles.manage');
      v_users := v_users || v_driver;
      v_params := v_params || jsonb_build_object('doc', e.data->>'doc', 'expiry', e.data->>'expiry',
        'days', (e.data->>'expiry')::date - public.bucharest_today());
    when 'fleet_maintenance_due' then
      select * into v_item from public.fleet_maintenance where id = e.entity_id;
      if v_item.id is not null then
        v_state := public.fleet_maintenance_status(v_item);
      end if;
      v_obsolete := v_obsolete or v_item.id is null or v_item.deleted_at is not null or cv.archived_at is not null
        or v_item.last_done_on is distinct from (e.data->>'last_done_on')::date
        or v_item.last_done_km is distinct from (e.data->>'last_done_km')::int
        or v_state->>'status' not in ('soon', 'overdue');
      select coalesce(array_agg(m.user_id), '{}') into v_users from public.company_members m
      where m.company_id = e.company_id and m.accepted_at is not null and public.fleet_user_can(m.user_id, e.company_id, 'vehicles.manage');
      v_users := v_users || v_driver;
      v_params := v_params || jsonb_build_object('item_id', v_item.id, 'kind', v_item.kind, 'label', v_item.label,
        'status', v_state->>'status', 'due', v_state->>'due_on');
  end case;

  if v_obsolete then
    update public.fleet_events set processed_at = now(), locked_until = null, last_error_code = 'obsolete' where id = e.id;
    return jsonb_build_object('obsolete', true);
  end if;

  -- Current accepted members only, each once, the actor left out.
  for v_user in
    select distinct u from unnest(v_users) u
    where u is not null and u is distinct from e.actor
      and exists (select 1 from public.company_members m where m.company_id = e.company_id and m.user_id = u and m.accepted_at is not null)
  loop
    v_notice := null;
    insert into public.fleet_notices (fleet_event_id, user_id, dedupe_key)
    values (e.id, v_user, e.event_key)
    on conflict (user_id, dedupe_key) do nothing
    returning id into v_notice;
    if v_notice is not null then
      insert into public.notification_events (user_id, event, params, booking_id, channels)
      values (v_user, e.event,
              v_params || case when public.fleet_user_can(v_user, e.company_id, 'costs.view') then v_money else '{}'::jsonb end,
              e.booking_id, array['push'])
      returning id into v_notification;
      update public.fleet_notices set notification_id = v_notification where id = v_notice;
      v_sent := v_sent + 1;
    end if;
  end loop;
  update public.fleet_events set processed_at = now(), locked_until = null where id = e.id;
  return jsonb_build_object('sent', v_sent);
end
$$;
revoke execute on function public.fleet_claim_event(), public.fleet_event_failed(bigint, text, text), public.fleet_process_event(bigint)
  from public, anon, authenticated;

-- The worker: one event per transaction (claim committed first), until none is due or 50 seconds pass.
-- No SET clause and not security definer: a procedure with either cannot commit.
create procedure public.process_fleet_events(p_max int default 200)
language plpgsql
as $$
declare
  v_id bigint;
  v_n int := 0;
  v_code text;
  v_msg text;
  v_start timestamptz := clock_timestamp();
begin
  loop
    exit when v_n >= p_max or clock_timestamp() > v_start + interval '50 seconds';
    v_id := public.fleet_claim_event();
    exit when v_id is null;
    commit;
    v_code := null;
    v_msg := null;
    begin
      perform public.fleet_process_event(v_id);
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text;
    end;
    if v_code is not null then
      -- A business error keeps its code (fail()), any other its SQLSTATE.
      perform public.fleet_event_failed(v_id, case when v_code = 'P0001' then v_msg else v_code end, v_msg);
    end if;
    commit;
    v_n := v_n + 1;
  end loop;
end
$$;
revoke execute on procedure public.process_fleet_events(int) from public, anon, authenticated;

-- ------------------------------------------------------------------ the daily part (10:xx Bucharest)
-- Documents at 30, 7 and 0 days; maintenance soon or overdue (once per item, last service and state);
-- old rows purged. Only non-archived companies and vehicles.
create function public.fleet_daily(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.bucharest_today());
  v_docs int;
  v_maint int;
  v_purged int;
begin
  with docs as (
    select cv.company_id, cv.id vehicle_id, d.doc, d.expiry, d.expiry - v_today days
    from public.company_vehicles cv
    join public.companies c on c.id = cv.company_id and c.archived_at is null
    cross join lateral (values ('itp', cv.itp_expiry), ('rca', cv.rca_expiry), ('vignette', cv.vignette_expiry)) d(doc, expiry)
    where cv.archived_at is null and d.expiry is not null and d.expiry - v_today between 0 and 30
  ), ins as (
    insert into public.fleet_events (company_id, event, entity_id, data, event_key)
    select x.company_id, 'fleet_doc_expiring', x.vehicle_id,
           jsonb_build_object('vehicle_id', x.vehicle_id, 'doc', x.doc, 'expiry', x.expiry, 'threshold', t.threshold),
           'doc:' || x.vehicle_id || ':' || x.doc || ':' || x.expiry || ':' || t.threshold
    from docs x cross join lateral (select case when x.days = 0 then 0 when x.days <= 7 then 7 else 30 end threshold) t
    on conflict (event_key) do nothing
    returning 1
  )
  select count(*) into v_docs from ins;

  with due as (
    select m.*, public.fleet_maintenance_status(m, v_today)->>'status' st
    from public.fleet_maintenance m
    join public.company_vehicles cv on cv.id = m.vehicle_id and cv.archived_at is null
    join public.companies c on c.id = m.company_id and c.archived_at is null
    where m.deleted_at is null
  ), ins as (
    insert into public.fleet_events (company_id, event, entity_id, data, event_key)
    select d.company_id, 'fleet_maintenance_due', d.id,
           jsonb_build_object('vehicle_id', d.vehicle_id, 'item_id', d.id, 'last_done_on', d.last_done_on, 'last_done_km', d.last_done_km, 'status', d.st),
           'maint:' || d.id || ':' || coalesce(d.last_done_on::text, '-') || ':' || coalesce(d.last_done_km::text, '-') || ':' || d.st
    from due d where d.st in ('soon', 'overdue')
    on conflict (event_key) do nothing
    returning 1
  )
  select count(*) into v_maint from ins;

  delete from public.fleet_notices n where n.created_at < now() - interval '400 days';
  with gone as (
    delete from public.fleet_events e where e.processed_at is not null and e.processed_at < now() - interval '90 days'
      and not exists (select 1 from public.fleet_notices n where n.fleet_event_id = e.id)
    returning 1
  )
  select count(*) into v_purged from gone;
  return jsonb_build_object('docs', v_docs, 'maintenance', v_maint, 'purged', v_purged);
end
$$;
revoke execute on function public.fleet_daily(date) from public, anon, authenticated;

-- ------------------------------------------------------------------ admin: failed events, without private data
create function public.admin_list_failed_fleet_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'event', e.event, 'company_name', c.name, 'created_at', e.created_at, 'attempts', e.attempts,
             'last_error_code', e.last_error_code, 'failed_at', e.failed_at) order by e.failed_at desc, e.id desc)
    from public.fleet_events e join public.companies c on c.id = e.company_id
    where e.failed_at is not null), '[]'::jsonb);
end
$$;

create function public.admin_retry_fleet_event(p_id bigint, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.fleet_events%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_retry_fleet_event');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.fleet_events where id = p_id and failed_at is not null for update;
  if not found then
    perform public.fail('fleet_event_not_found');
  end if;
  update public.fleet_events set failed_at = null, attempts = 0, next_attempt_at = now(), locked_until = null where id = p_id;
  perform public.admin_audit('retry_fleet_event', 'fleet_event', null,
    jsonb_build_object('id', v.id, 'event', v.event, 'attempts', v.attempts, 'last_error_code', v.last_error_code),
    jsonb_build_object('id', v.id, 'attempts', 0));
  v_result := jsonb_build_object('id', v.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_list_failed_fleet_events(), public.admin_retry_fleet_event(bigint, uuid) from public, anon;
grant execute on function public.admin_list_failed_fleet_events(), public.admin_retry_fleet_event(bigint, uuid) to authenticated;

-- ------------------------------------------------------------------ rights versions (decision 8)
create table public.member_rights_versions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  version bigint not null default 1,
  changed_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
alter table public.member_rights_versions enable row level security;
revoke all on public.member_rights_versions from anon, authenticated;
grant select on public.member_rights_versions to authenticated;
create policy member_rights_versions_own on public.member_rights_versions for select to authenticated using (user_id = auth.uid());

create function public.bump_rights_version(p_user uuid, p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  -- Nothing when the company or the account is being deleted (its rows go with it).
  insert into public.member_rights_versions (user_id, company_id)
  select p_user, p_company
  where exists (select 1 from public.companies c where c.id = p_company)
    and exists (select 1 from public.profiles p where p.id = p_user)
  on conflict (user_id, company_id) do update set version = public.member_rights_versions.version + 1, changed_at = now()
$$;
revoke execute on function public.bump_rights_version(uuid, uuid) from public, anon, authenticated;

create function public.member_rights_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.user_id is not null then
    perform public.bump_rights_version(old.user_id, old.company_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    perform public.bump_rights_version(new.user_id, new.company_id);
  end if;
  return null;
end
$$;
create trigger company_members_rights_version
  after insert or delete or update of role, extra_caps, approval_limit, accepted_at, user_id on public.company_members
  for each row execute function public.member_rights_changed();

create function public.plan_rights_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bump_rights_version(m.user_id, m.company_id)
  from public.company_members m where m.company_id = new.company_id and m.user_id is not null;
  return null;
end
$$;
create trigger company_subscriptions_rights_version
  after update of plan_key, status, trial_ends_at, current_period_end on public.company_subscriptions
  for each row execute function public.plan_rights_changed();
revoke execute on function public.member_rights_changed(), public.plan_rights_changed() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_rights_versions') then
    alter publication supabase_realtime add table public.member_rights_versions;
  end if;
end
$$;

-- ------------------------------------------------------------------ the admin digest and the hourly jobs
create or replace function public.admin_digest_counts(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.reviews r where r.report_status = 'pending'),
    'suspect', (select count(*) from public.reviews r
                where r.removed_at is null and r.signals_cleared_at is null
                  and r.created_at > p_now - interval '180 days'
                  and public.is_suspect_review(public.review_signals(r))),
    'past_due', (select count(*) from public.subscriptions s where s.status = 'past_due'),
    'company_waiting', (select count(*) from public.shop_billing b
                        where b.anaf_problem_since is not null and b.anaf_hidden_at is null),
    'company_hidden', (select count(*) from public.shop_billing b where b.anaf_hidden_at is not null),
    'unanswered', (select count(*) from public.bookings b
                   where b.closed_reason = 'unanswered' and b.status_changed_at > p_now - interval '24 hours'),
    'no_show_disputes', (select count(*) from public.no_show_disputes d where d.status = 'pending'),
    -- M6: fleet events that failed, and fleet notifications the dispatcher gave up in the last 24 hours.
    'fleet_failed', (select count(*) from public.fleet_events e where e.failed_at is not null),
    'fleet_gave_up', (select count(*) from public.notification_events n
                      where n.event like 'fleet\_%' and n.last_error in ('gave_up', 'stale')
                        and n.processed_at > p_now - interval '24 hours'),
    'new_shops', (select count(*) from public.shops s where s.created_at > p_now - interval '24 hours'),
    'new_clients', (select count(*) from public.profiles p
                    where p.role = 'client' and p.created_at > p_now - interval '24 hours'),
    'new_bookings', (select count(*) from public.bookings b where b.created_at > p_now - interval '24 hours'),
    'done', (select count(*) from public.bookings b where b.status = 'done' and b.done_at > p_now - interval '24 hours'))
$$;

create or replace function public.send_admin_digest(p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := public.admin_digest_counts(p_now);
begin
  if (v->>'reports')::int + (v->>'suspect')::int + (v->>'past_due')::int + (v->>'company_waiting')::int
     + (v->>'company_hidden')::int + (v->>'unanswered')::int + (v->>'no_show_disputes')::int
     + (v->>'fleet_failed')::int + (v->>'fleet_gave_up')::int = 0 then
    return false;
  end if;
  if exists (select 1 from public.notification_events e
             where e.event = 'admin_digest' and e.created_at > p_now - interval '20 hours') then
    return false;
  end if;
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  values (null, 'admin_digest', v || jsonb_build_object('date', (p_now at time zone 'Europe/Bucharest')::date), null, array['email']);
  return true;
end
$$;

create or replace function public.run_hourly_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_result jsonb;
begin
  v_result := jsonb_build_object(
    'appointment_reminders', public.send_appointment_reminders(p_now),
    'digests', public.send_daily_digests(p_now),
    'trials_ended', public.end_expired_trials(p_now),
    'area_launches', public.notify_area_launches(p_now));
  if extract(hour from v_local) = 7 then
    v_result := v_result || jsonb_build_object(
      'trial_warnings', public.send_trial_warnings(p_now),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  -- The month's ANAF checks and the companies due again (verify-company, in the background), then
  -- an hour later the shops whose company stayed unconfirmed past the deadline leave the search.
  if extract(hour from v_local) = 6 then
    v_result := v_result || jsonb_build_object('company_checks', public.kick_company_checks());
  end if;
  if extract(hour from v_local) = 8 then
    v_result := v_result || jsonb_build_object(
      'company_hidden', public.enforce_company_deadlines(p_now),
      'admin_digest', public.send_admin_digest(p_now));
  end if;
  -- Every morning, the requests still waiting for an answer (Eduard, 3 oct).
  if extract(hour from v_local) = 9 then
    v_result := v_result || jsonb_build_object('requests_daily', public.send_request_daily_reminders(p_now));
  end if;
  if extract(hour from v_local) = 10 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'review_requests', public.send_review_requests(p_now),
      'service_reminders', public.send_service_reminders(v_local::date),
      'tire_season', public.send_tire_season_reminders(p_now),
      'welcome_tips', public.send_welcome_tips(p_now),
      'monthly_reports', public.send_monthly_reports(p_now),
      'booking_followups', public.send_booking_followups(p_now),
      'bookings_closed', public.close_stale_bookings(p_now),
      'fleet_daily', public.fleet_daily(v_local::date));
  end if;
  return v_result;
end
$$;

-- Every minute: the fleet outbox (a procedure: it commits after each claim and each event).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('sh_fleet_events', '* * * * *', 'call public.process_fleet_events()');
  end if;
end
$$;

update public.schema_version set version = 106;
