-- T37b — "Anunță-mă dacă se eliberează un loc" (Eduard, 16 Oct 2026). ARCHITECTURE §4, §12.
--
-- · On a full day of a shop, a client asks to be told when a place frees (join_slot_waitlist);
--   they can take it back (leave_slot_waitlist). At most 10 days waited for at once.
-- · When a booking of that day leaves it (canceled, declined, a no-show, moved to another day or
--   shop) and the day has a place again, everyone waiting for it is told at once (push,
--   `slot_freed`); the first to book gets it. Each request tells once; asking again re-arms it.
-- · Booking that day at that shop ends the wait. Past days are dropped.

create table public.slot_waitlist (
  client_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  primary key (client_id, shop_id, date)
);
create index slot_waitlist_day_idx on public.slot_waitlist (shop_id, date) where notified_at is null;
alter table public.slot_waitlist enable row level security;
revoke all on public.slot_waitlist from public, anon, authenticated;
grant select on public.slot_waitlist to authenticated;
create policy slot_waitlist_own on public.slot_waitlist for select to authenticated
  using (client_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Asking and taking it back
-- ---------------------------------------------------------------------------------------------
create function public.join_slot_waitlist(p_shop_id uuid, p_date date, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_result jsonb;
begin
  v_me := public.require_caller();
  if v_me.role <> 'client' or v_me.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  v_seen := public.request_begin(p_request_id, 'join_slot_waitlist');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_date is null or p_date < public.bucharest_today() then
    perform public.fail('past_slot');
  end if;
  if not public.is_shop_public(p_shop_id) then
    perform public.fail('shop_not_found');
  end if;

  delete from public.slot_waitlist where client_id = v_me.id and date < public.bucharest_today();
  if (select count(*) from public.slot_waitlist w
      where w.client_id = v_me.id and not (w.shop_id = p_shop_id and w.date = p_date)) >= 10 then
    perform public.fail('waitlist_limit');
  end if;

  insert into public.slot_waitlist (client_id, shop_id, date) values (v_me.id, p_shop_id, p_date)
  on conflict (client_id, shop_id, date) do update set notified_at = null, created_at = now();

  v_result := jsonb_build_object('shop_id', p_shop_id, 'date', p_date);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.join_slot_waitlist(uuid, date, uuid) from public, anon;
grant execute on function public.join_slot_waitlist(uuid, date, uuid) to authenticated;

create function public.leave_slot_waitlist(p_shop_id uuid, p_date date, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_result jsonb;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'leave_slot_waitlist');
  if v_seen is not null then
    return v_seen;
  end if;
  delete from public.slot_waitlist where client_id = v_me.id and shop_id = p_shop_id and date = p_date;
  v_result := jsonb_build_object('shop_id', p_shop_id, 'date', p_date);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.leave_slot_waitlist(uuid, date, uuid) from public, anon;
grant execute on function public.leave_slot_waitlist(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A place frees: everyone waiting for that day is told once
-- ---------------------------------------------------------------------------------------------
create function public.notify_slot_waitlist(p_shop_id uuid, p_date date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_taken int;
  r record;
  v_n int := 0;
begin
  if p_date < public.bucharest_today() then
    return 0;
  end if;
  select * into v_shop from public.shops where id = p_shop_id;
  if not found or not public.is_shop_public(p_shop_id) then
    return 0;
  end if;
  select count(*) into v_taken from public.bookings b
  where b.shop_id = p_shop_id and b.date = p_date and public.is_active_status(b.status);
  if v_taken >= v_shop.daily_capacity then
    return 0;
  end if;

  for r in
    select w.client_id from public.slot_waitlist w
    join public.profiles p on p.id = w.client_id and p.deleted_at is null and not p.suspended
    where w.shop_id = p_shop_id and w.date = p_date and w.notified_at is null
    for update of w
  loop
    update public.slot_waitlist set notified_at = now()
    where client_id = r.client_id and shop_id = p_shop_id and date = p_date;
    perform public.notify_user(r.client_id, 'slot_freed', jsonb_build_object(
      'shop_id', p_shop_id, 'shop_name', v_shop.name, 'date', p_date), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.notify_slot_waitlist(uuid, date) from public, anon, authenticated;

create function public.bookings_slot_waitlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A booking made that day ends the client's wait for it.
  if public.is_active_status(new.status) and new.client_id is not null
     and (tg_op = 'INSERT' or not public.is_active_status(old.status)
          or new.date <> old.date or new.shop_id <> old.shop_id) then
    delete from public.slot_waitlist
    where client_id = new.client_id and shop_id = new.shop_id and date = new.date;
  end if;
  -- A booking that leaves its day: that day may have a place again.
  if tg_op = 'UPDATE' and public.is_active_status(old.status)
     and (not public.is_active_status(new.status) or new.date <> old.date or new.shop_id <> old.shop_id) then
    perform public.notify_slot_waitlist(old.shop_id, old.date);
  end if;
  return null;
end
$$;
revoke execute on function public.bookings_slot_waitlist() from public, anon, authenticated;
create trigger bookings_slot_waitlist after insert or update of status, date, shop_id on public.bookings
  for each row execute function public.bookings_slot_waitlist();

-- In "Datele mele" (export_my_data): the days waited for.
alter function public.export_my_data() rename to export_my_data_t35;
revoke execute on function public.export_my_data_t35() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_t35() || jsonb_build_object(
    'slot_waitlist', coalesce((
      select jsonb_agg(jsonb_build_object('shop', s.name, 'date', w.date, 'created_at', w.created_at,
        'notified_at', w.notified_at) order by w.date)
      from public.slot_waitlist w join public.shops s on s.id = w.shop_id
      where w.client_id = auth.uid()), '[]'::jsonb))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

update public.schema_version set version = 77;
