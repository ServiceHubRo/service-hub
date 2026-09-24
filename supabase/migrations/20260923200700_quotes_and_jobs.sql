-- T03 · 2/3 — Quotes, work, completion with the odometer rules, quote expiry, no-show count.
-- ARCHITECTURE §3, §6, §7.

-- ---------------------------------------------------------------------------------------------
-- Quote lines from the composer: [{"name": "Plăcuțe frână", "price": 280}, …].
-- 1–50 lines, name 1–200 characters, price 0–1 000 000 with at most 2 decimals, total > 0.
-- Returns the cleaned lines with their position.
-- ---------------------------------------------------------------------------------------------
create function public.clean_quote_items(p_items jsonb)
returns table (pos int, name text, price numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_pos int := 0;
  v_name text;
  v_price_text text;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public.fail('quote_items_required');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform public.fail('quote_too_many_items', jsonb_build_object('limit', 50));
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_name := btrim(v_item->>'name');
    v_price_text := v_item->>'price';
    if coalesce(v_name, '') = '' or char_length(v_name) > 200 then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_pos));
    end if;
    if v_price_text is null or v_price_text !~ '^\d{1,7}(\.\d{1,2})?$'
       or v_price_text::numeric > 1000000 then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_pos));
    end if;
    pos := v_pos;
    name := v_name;
    price := v_price_text::numeric(10,2);
    v_total := v_total + price;
    return next;
  end loop;
  if v_total <= 0 then
    perform public.fail('quote_total_zero');
  end if;
end
$$;

-- Inserts version N+1 of the booking's quote with its lines. Caller holds the booking lock and has
-- closed the previous version.
create function public.insert_quote(p_booking public.bookings, p_items jsonb, p_note text)
returns public.quotes
language plpgsql
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_versions int;
  v_quote public.quotes%rowtype;
begin
  if char_length(v_note) > 2000 then
    perform public.fail('note_too_long');
  end if;
  select count(*) into v_versions from public.quotes where booking_id = p_booking.id;
  if v_versions >= public.app_limit('quote_versions_max', 20) then
    perform public.fail('limit_quote_versions', jsonb_build_object('limit', public.app_limit('quote_versions_max', 20)));
  end if;

  insert into public.quotes (booking_id, version, status, note, inspection_fee, total_sent, sent_at,
                             expires_at, sent_by)
  select p_booking.id, v_versions + 1, 'sent', v_note, s.inspection_fee,
         (select sum(l.price) from public.clean_quote_items(p_items) l), now(),
         now() + make_interval(days => ps.quote_expiry_days), auth.uid()
  from public.shops s cross join public.platform_settings ps
  where s.id = p_booking.shop_id and ps.id = 1
  returning * into v_quote;

  insert into public.quote_items (quote_id, position, name, price)
  select v_quote.id, l.pos, l.name, l.price from public.clean_quote_items(p_items) l;
  return v_quote;
end
$$;

-- The quote currently waiting for the client (status 'sent'), locked.
create function public.current_sent_quote(p_booking_id uuid)
returns public.quotes
language sql
set search_path = ''
as $$
  select * from public.quotes where booking_id = p_booking_id and status = 'sent'
  order by version desc limit 1
  for no key update
$$;

-- ---------------------------------------------------------------------------------------------
-- send_quote — in_inspection → quote_sent. Snapshots the shop's inspection fee; the quote
-- expires after platform_settings.quote_expiry_days.
-- ---------------------------------------------------------------------------------------------
create function public.send_quote(p_booking_id uuid, p_items jsonb, p_request_id uuid, p_note text default null)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_quote public.quotes%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'send_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'in_inspection');

  v_quote := public.insert_quote(v, p_items, p_note);
  update public.bookings set status = 'quote_sent' where id = v.id returning * into v;

  perform public.post_booking_event(v, 'quote_sent', 'shop',
    jsonb_build_object('quote_id', v_quote.id, 'version', v_quote.version, 'total', v_quote.total_sent));
  perform public.notify_user(v.client_id, 'quote_sent', public.booking_event_params(v) ||
    jsonb_build_object('quote_id', v_quote.id, 'total', v_quote.total_sent, 'expires_at', v_quote.expires_at), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- replace_quote — "edit quote": the waiting version becomes `superseded` (kept for history), a new
-- version is sent and the expiry clock restarts.
create function public.replace_quote(p_booking_id uuid, p_items jsonb, p_request_id uuid, p_note text default null)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_old public.quotes%rowtype;
  v_quote public.quotes%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'replace_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'quote_sent');

  v_old := public.current_sent_quote(v.id);
  update public.quotes set status = 'superseded', decided_at = now() where id = v_old.id;
  v_quote := public.insert_quote(v, p_items, p_note);
  -- Touch the booking so realtime subscribers see the change.
  update public.bookings set status = 'quote_sent' where id = v.id returning * into v;

  perform public.post_booking_event(v, 'quote_replaced', 'shop',
    jsonb_build_object('quote_id', v_quote.id, 'version', v_quote.version, 'total', v_quote.total_sent));
  perform public.notify_user(v.client_id, 'quote_replaced', public.booking_event_params(v) ||
    jsonb_build_object('quote_id', v_quote.id, 'total', v_quote.total_sent, 'expires_at', v_quote.expires_at), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- withdraw_quote — quote_sent → in_inspection; the quote becomes `withdrawn`.
create function public.withdraw_quote(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_old public.quotes%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'withdraw_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'quote_sent');

  v_old := public.current_sent_quote(v.id);
  update public.quotes set status = 'withdrawn', decided_at = now() where id = v_old.id;
  update public.bookings set status = 'in_inspection' where id = v.id returning * into v;

  perform public.post_booking_event(v, 'quote_withdrawn', 'shop', jsonb_build_object('quote_id', v_old.id));
  perform public.notify_user(v.client_id, 'quote_withdrawn', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- decide_quote — the client's answer. p_quote_id is the version the client was looking at: if the
-- shop replaced it meanwhile, the answer is refused with `quote_changed` instead of landing on a
-- quote the client never saw.
--   all lines approved   → quote accepted,            booking approved
--   some lines approved  → quote partially_accepted,  booking approved (only those lines form the job)
--   no line approved     → quote refused,             booking quote_refused, cost = inspection fee
-- ---------------------------------------------------------------------------------------------
create function public.decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_quote public.quotes%rowtype;
  v_ids uuid[] := coalesce(p_approved_item_ids, '{}');
  v_lines int;
  v_approved int;
  v_total numeric;
  v_event text;
  v_params jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'decide_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_client(p_booking_id);
  perform public.require_status(v, 'quote_sent');

  v_quote := public.current_sent_quote(v.id);
  if v_quote.id is distinct from p_quote_id then
    perform public.fail('quote_changed');
  end if;
  if v_quote.expires_at is not null and v_quote.expires_at <= now() then
    perform public.fail('quote_expired');
  end if;
  if exists (select 1 from unnest(v_ids) i
             where not exists (select 1 from public.quote_items qi where qi.id = i and qi.quote_id = v_quote.id)) then
    perform public.fail('quote_item_invalid');
  end if;

  update public.quote_items set approved = (id = any (v_ids)) where quote_id = v_quote.id;
  select count(*), count(*) filter (where approved), coalesce(sum(price) filter (where approved), 0)
    into v_lines, v_approved, v_total
  from public.quote_items where quote_id = v_quote.id;

  if v_approved = 0 then
    update public.quotes set status = 'refused', total_approved = 0, decided_at = now() where id = v_quote.id;
    update public.bookings set status = 'quote_refused', cost = v_quote.inspection_fee
    where id = v.id returning * into v;
    v_event := 'quote_refused';
    v_params := jsonb_build_object('quote_id', v_quote.id, 'inspection_fee', v_quote.inspection_fee);
  else
    update public.quotes
      set status = case when v_approved = v_lines then 'accepted' else 'partially_accepted' end,
          total_approved = v_total, decided_at = now()
    where id = v_quote.id;
    update public.bookings set status = 'approved' where id = v.id returning * into v;
    v_event := case when v_approved = v_lines then 'quote_accepted' else 'quote_partially_accepted' end;
    v_params := jsonb_build_object('quote_id', v_quote.id, 'total', v_total, 'total_sent', v_quote.total_sent);
  end if;

  perform public.post_booking_event(v, v_event, 'client', v_params);
  perform public.notify_shop(v.shop_id, v_event, public.booking_event_params(v) || v_params, v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- start_work — approved → in_progress.
create function public.start_work(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'start_work');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'approved');

  update public.bookings set status = 'in_progress', started_at = now() where id = v.id returning * into v;

  perform public.post_booking_event(v, 'work_started', 'shop');
  perform public.notify_user(v.client_id, 'work_started', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Odometer (§7). Last known reading = highest odometer among `done` bookings of the same plate,
-- at any shop.
-- ---------------------------------------------------------------------------------------------
create function public.last_odometer_for_plate(p_plate_norm text)
returns int
language sql
stable
set search_path = ''
as $$
  select max(b.odometer) from public.bookings b
  where p_plate_norm is not null
    and b.car_snapshot->>'plate_norm' = p_plate_norm
    and b.status = 'done'
    and b.odometer is not null
$$;

-- For the completion panel: only the number, only for a booking of the caller's own shop.
create function public.last_odometer_for_booking(p_booking_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
begin
  perform public.require_caller();
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  if not public.is_shop_member(v.shop_id) then
    perform public.fail('not_allowed');
  end if;
  return public.last_odometer_for_plate(v.car_snapshot->>'plate_norm');
end
$$;

-- complete_job — in_progress → done. Odometer checked in this order: required, 100–2 000 000,
-- not lower than the last reading, more than 50 000 km above it only with p_confirm_jump.
-- Work and cost default to the approved lines of the accepted quote.
create function public.complete_job(
  p_booking_id uuid,
  p_odometer int,
  p_request_id uuid,
  p_work text default null,
  p_cost numeric default null,
  p_confirm_jump boolean default false
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_last int;
  v_work text := nullif(btrim(p_work), '');
  v_cost numeric := p_cost;
  v_quote public.quotes%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'complete_job');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'in_progress');

  if p_odometer is null then
    perform public.fail('odometer_required');
  end if;
  if p_odometer < 100 or p_odometer > 2000000 then
    perform public.fail('odometer_invalid');
  end if;
  v_last := public.last_odometer_for_plate(v.car_snapshot->>'plate_norm');
  if v_last is not null and p_odometer < v_last then
    perform public.fail('odometer_lower', jsonb_build_object('previous', v_last));
  end if;
  if v_last is not null and p_odometer - v_last > 50000 and not coalesce(p_confirm_jump, false) then
    perform public.fail('odometer_jump', jsonb_build_object('previous', v_last, 'diff', p_odometer - v_last));
  end if;

  if char_length(v_work) > 4000 then
    perform public.fail('work_too_long');
  end if;
  if v_cost is not null and (v_cost < 0 or v_cost > 1000000 or v_cost <> round(v_cost, 2)) then
    perform public.fail('cost_invalid');
  end if;

  select * into v_quote from public.quotes
  where booking_id = v.id and status in ('accepted', 'partially_accepted')
  order by version desc limit 1;
  if v_work is null and v_quote.id is not null then
    select string_agg(qi.name, ', ' order by qi.position) into v_work
    from public.quote_items qi where qi.quote_id = v_quote.id and qi.approved;
  end if;
  if v_cost is null then
    v_cost := v_quote.total_approved;
  end if;

  update public.bookings
    set status = 'done', done_at = now(), odometer = p_odometer, work = left(v_work, 4000), cost = v_cost
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'job_done', 'shop', jsonb_build_object('odometer', v.odometer, 'cost', v.cost));
  perform public.notify_user(v.client_id, 'job_done',
    public.booking_event_params(v) || jsonb_build_object('odometer', v.odometer, 'cost', v.cost), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- expire_quotes — run by the scheduler (T12), never from the browser. Quotes past expires_at
-- become `expired`, their booking `expired` (capacity released), both sides notified.
-- Returns how many bookings expired.
-- ---------------------------------------------------------------------------------------------
create function public.expire_quotes()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_quote public.quotes%rowtype;
  v_n int := 0;
  v_params jsonb;
begin
  for v_quote in
    select q.* from public.quotes q
    where q.status = 'sent' and q.expires_at <= now()
    order by q.expires_at
  loop
    -- Skip bookings someone else is changing right now; the next run picks them up.
    select * into v from public.bookings
    where id = v_quote.booking_id and status = 'quote_sent'
    for no key update skip locked;
    if not found then
      continue;
    end if;
    -- Still the waiting version once we hold the lock?
    if not exists (select 1 from public.quotes where id = v_quote.id and status = 'sent') then
      continue;
    end if;

    update public.quotes set status = 'expired', decided_at = now() where id = v_quote.id;
    update public.bookings set status = 'expired' where id = v.id returning * into v;

    v_params := public.booking_event_params(v) || jsonb_build_object('quote_id', v_quote.id, 'total', v_quote.total_sent);
    perform public.post_booking_event(v, 'quote_expired', 'system', jsonb_build_object('quote_id', v_quote.id));
    perform public.notify_user(v.client_id, 'quote_expired', v_params, v.id);
    perform public.notify_shop(v.shop_id, 'quote_expired', v_params, v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.expire_quotes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- client_no_show_count — no-shows of a client in the last N days (default 90). Readable by the
-- client, by shops that have a booking with that client, and by admin. No automatic block (§6).
-- ---------------------------------------------------------------------------------------------
create function public.client_no_show_count(p_client_id uuid, p_days int default 90)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_caller();
  if not (
    p_client_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.bookings b
               where b.client_id = p_client_id and public.is_shop_member(b.shop_id))
  ) then
    perform public.fail('not_allowed');
  end if;
  return (
    select count(*)::int from public.bookings b
    where b.client_id = p_client_id and b.status = 'no_show'
      and b.date > public.bucharest_today() - least(greatest(coalesce(p_days, 90), 1), 3650)
  );
end
$$;

grant execute on function
  public.send_quote(uuid, jsonb, uuid, text),
  public.replace_quote(uuid, jsonb, uuid, text),
  public.withdraw_quote(uuid, uuid),
  public.decide_quote(uuid, uuid, uuid[], uuid),
  public.start_work(uuid, uuid),
  public.last_odometer_for_booking(uuid),
  public.complete_job(uuid, int, uuid, text, numeric, boolean),
  public.client_no_show_count(uuid, int)
to authenticated;

update public.schema_version set version = 8;
