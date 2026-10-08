-- T31a: a shop brings its clients, cars and past jobs from another program (a CSV or Excel file).
--
-- The file is read and checked in the browser; the rows come here in chunks of at most 1 000,
-- under one import (`shop_import_begin` → `shop_import_add` … → done), and every row is checked
-- again. What comes in is the shop's own record: its clients (`shop_clients`, found again by
-- phone when the shop adds a booking), their cars (`shop_client_cars`) and the jobs done before
-- Service-Hub (`imported_jobs`), shown in Istoric and in Fișa mașinii marked as imported. Imported
-- jobs are never bookings: they do not count in the reports, the paid history report, the
-- odometer checks or reviews. An import can be undone as a whole. Owner only; nothing is sent
-- to anyone (Eduard, 5 oct: no messages to imported clients without their consent).

create table public.shop_imports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  file_name text check (char_length(file_name) <= 200),
  clients int not null default 0,
  cars int not null default 0,
  jobs int not null default 0,
  row_count int not null default 0,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index shop_imports_shop_idx on public.shop_imports (shop_id, created_at desc);
alter table public.shop_imports enable row level security;
grant select on public.shop_imports to authenticated;
create policy shop_imports_select_member on public.shop_imports for select to authenticated
  using (public.is_shop_member(shop_id));

create table public.shop_clients (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  import_id uuid references public.shop_imports (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  created_at timestamptz not null default now()
);
create unique index shop_clients_phone_idx on public.shop_clients (shop_id, phone) where phone is not null;
create index shop_clients_import_idx on public.shop_clients (import_id);
alter table public.shop_clients enable row level security;
grant select on public.shop_clients to authenticated;
create policy shop_clients_select_member on public.shop_clients for select to authenticated
  using (public.is_shop_member(shop_id));

create table public.shop_client_cars (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  import_id uuid references public.shop_imports (id) on delete cascade,
  client_id uuid references public.shop_clients (id) on delete set null,
  make text not null check (char_length(btrim(make)) between 1 and 60),
  model text not null default '' check (char_length(model) <= 60),
  year int check (year between 1900 and 2100),
  plate text check (char_length(plate) <= 20),
  plate_norm text generated always as (
    nullif(regexp_replace(upper(coalesce(plate, '')), '[^A-Z0-9]', '', 'g'), '')
  ) stored,
  vin text check (vin is null or public.is_valid_vin(vin)),
  created_at timestamptz not null default now()
);
create unique index shop_client_cars_plate_idx on public.shop_client_cars (shop_id, plate_norm) where plate_norm is not null;
create index shop_client_cars_client_idx on public.shop_client_cars (client_id);
create index shop_client_cars_import_idx on public.shop_client_cars (import_id);
alter table public.shop_client_cars enable row level security;
grant select on public.shop_client_cars to authenticated;
create policy shop_client_cars_select_member on public.shop_client_cars for select to authenticated
  using (public.is_shop_member(shop_id));

create table public.imported_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  import_id uuid not null references public.shop_imports (id) on delete cascade,
  client_id uuid references public.shop_clients (id) on delete set null,
  car_id uuid references public.shop_client_cars (id) on delete set null,
  day date not null check (day >= date '1990-01-01'),
  work text check (char_length(work) <= 2000),
  odometer int check (odometer between 0 and 2000000),
  cost numeric(10, 2) check (cost >= 0 and cost < 10000000),
  -- What the job was done for, as the file had it (like a booking's snapshots).
  client_name text check (char_length(client_name) <= 120),
  client_phone text,
  car_snapshot jsonb not null default '{}'::jsonb,
  -- The same job imported twice (the same file again) is kept once.
  dedupe_key text not null,
  created_at timestamptz not null default now()
);
create unique index imported_jobs_dedupe_idx on public.imported_jobs (shop_id, dedupe_key);
create index imported_jobs_shop_idx on public.imported_jobs (shop_id, day desc);
create index imported_jobs_import_idx on public.imported_jobs (import_id);
create index imported_jobs_plate_idx on public.imported_jobs (shop_id, (car_snapshot->>'plate_norm'));
alter table public.imported_jobs enable row level security;
grant select on public.imported_jobs to authenticated;
create policy imported_jobs_select_member on public.imported_jobs for select to authenticated
  using (public.is_shop_member(shop_id));

-- ---------------------------------------------------------------------------------------------
-- Begin, add rows, undo
-- ---------------------------------------------------------------------------------------------

create function public.shop_import_begin(p_file_name text, p_request_id uuid)
returns public.shop_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v public.shop_imports%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'shop_import_begin');
  if v_seen is not null then
    return jsonb_populate_record(null::public.shop_imports, v_seen);
  end if;
  v_shop := public.require_my_shop_owner();
  perform 1 from public.shops where id = v_shop for no key update;
  if (select count(*) from public.shop_imports
      where shop_id = v_shop and created_at > now() - interval '24 hours') >= public.app_limit('imports_per_day', 10) then
    perform public.fail('limit_imports', jsonb_build_object('limit', public.app_limit('imports_per_day', 10)));
  end if;
  insert into public.shop_imports (shop_id, created_by, file_name)
  values (v_shop, auth.uid(), left(nullif(btrim(p_file_name), ''), 200))
  returning * into v;
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;
revoke execute on function public.shop_import_begin(text, uuid) from public, anon;
grant execute on function public.shop_import_begin(text, uuid) to authenticated;

-- One chunk of checked rows: {row, name, phone, email, make, model, year, plate, vin, day, work,
-- odometer, cost}. A row may carry a client, a car, a job, or all three. A wrong value refuses
-- the whole chunk with `import_row_invalid` and {row, field}; the browser checks the same first.
create function public.shop_import_add(p_import_id uuid, p_rows jsonb, p_request_id uuid)
returns public.shop_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_import public.shop_imports%rowtype;
  r jsonb;
  v_row int;
  v_name text;
  v_phone text;
  v_email text;
  v_make text;
  v_model text;
  v_year int;
  v_plate text;
  v_plate_norm text;
  v_vin text;
  v_day date;
  v_work text;
  v_odometer int;
  v_cost numeric;
  v_client uuid;
  v_car uuid;
  v_new_clients int := 0;
  v_new_cars int := 0;
  v_new_jobs int := 0;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'shop_import_add');
  if v_seen is not null then
    return jsonb_populate_record(null::public.shop_imports, v_seen);
  end if;
  v_shop := public.require_my_shop_owner();
  select * into v_import from public.shop_imports where id = p_import_id for update;
  if not found or v_import.shop_id <> v_shop or v_import.undone_at is not null then
    perform public.fail('import_not_found');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.fail('import_empty');
  end if;
  if jsonb_array_length(p_rows) > 1000
     or v_import.row_count + jsonb_array_length(p_rows) > public.app_limit('import_rows', 20000) then
    perform public.fail('import_too_large', jsonb_build_object('limit', public.app_limit('import_rows', 20000)));
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := case when coalesce(r->>'row', '') ~ '^\d{1,7}$' then (r->>'row')::int end;
    v_name := nullif(btrim(coalesce(r->>'name', '')), '');
    v_phone := nullif(btrim(coalesce(r->>'phone', '')), '');
    v_email := nullif(lower(btrim(coalesce(r->>'email', ''))), '');
    v_make := nullif(btrim(coalesce(r->>'make', '')), '');
    v_model := coalesce(btrim(r->>'model'), '');
    v_plate := nullif(btrim(coalesce(r->>'plate', '')), '');
    v_plate_norm := nullif(regexp_replace(upper(coalesce(v_plate, '')), '[^A-Z0-9]', '', 'g'), '');
    v_vin := public.normalize_code(r->>'vin');
    v_work := nullif(btrim(coalesce(r->>'work', '')), '');

    if v_name is not null and char_length(v_name) > 120 then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'name'));
    end if;
    if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'phone'));
    end if;
    if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'email'));
    end if;
    if (v_make is not null and char_length(v_make) > 60) or char_length(v_model) > 60
       or (v_plate is not null and char_length(v_plate) > 20) or (v_make is null and v_model <> '') then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'car'));
    end if;
    if v_vin is not null and not public.is_valid_vin(v_vin) then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'vin'));
    end if;
    v_year := null;
    if coalesce(r->>'year', '') <> '' then
      if (r->>'year') !~ '^\d{4}$' or (r->>'year')::int not between 1900 and 2100 then
        perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'year'));
      end if;
      v_year := (r->>'year')::int;
    end if;
    v_day := null;
    if coalesce(r->>'day', '') <> '' then
      if (r->>'day') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'day'));
      end if;
      begin
        v_day := (r->>'day')::date;
      exception when others then
        perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'day'));
      end;
      if v_day < date '1990-01-01' or v_day > public.bucharest_today() then
        perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'day'));
      end if;
    end if;
    v_odometer := null;
    if coalesce(r->>'odometer', '') <> '' then
      if (r->>'odometer') !~ '^\d{1,7}$' or (r->>'odometer')::int > 2000000 then
        perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'odometer'));
      end if;
      v_odometer := (r->>'odometer')::int;
    end if;
    v_cost := null;
    if coalesce(r->>'cost', '') <> '' then
      if (r->>'cost') !~ '^\d{1,7}(\.\d{1,2})?$' then
        perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'cost'));
      end if;
      v_cost := (r->>'cost')::numeric;
    end if;
    if char_length(v_work) > 2000 then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'work'));
    end if;
    -- Something to keep: a client (a name) or a car (a make or a plate).
    if v_name is null and v_make is null and v_plate is null then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'name'));
    end if;
    -- A job: its day and something about it.
    if v_day is not null and v_work is null and v_cost is null and v_odometer is null then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'work'));
    end if;
    if v_day is null and (v_work is not null or v_cost is not null or v_odometer is not null) then
      perform public.fail('import_row_invalid', jsonb_build_object('row', v_row, 'field', 'day'));
    end if;

    -- The client: found again by phone, else by name among those without a phone.
    v_client := null;
    if v_name is not null or v_phone is not null then
      if v_phone is not null then
        select id into v_client from public.shop_clients where shop_id = v_shop and phone = v_phone;
      else
        select id into v_client from public.shop_clients
        where shop_id = v_shop and phone is null and lower(name) = lower(v_name)
        order by created_at limit 1;
      end if;
      if v_client is null then
        insert into public.shop_clients (shop_id, import_id, name, phone, email)
        values (v_shop, p_import_id, coalesce(v_name, v_phone), v_phone, v_email)
        returning id into v_client;
        v_new_clients := v_new_clients + 1;
      elsif v_email is not null then
        update public.shop_clients set email = coalesce(email, v_email) where id = v_client;
      end if;
    end if;

    -- The car: found again by plate, else by make and model of the same client.
    v_car := null;
    if v_make is not null or v_plate is not null then
      if v_plate_norm is not null then
        select id into v_car from public.shop_client_cars where shop_id = v_shop and plate_norm = v_plate_norm;
      elsif v_client is not null then
        select id into v_car from public.shop_client_cars
        where shop_id = v_shop and client_id = v_client and plate_norm is null
          and lower(make) = lower(v_make) and lower(model) = lower(v_model)
        order by created_at limit 1;
      end if;
      if v_car is null then
        insert into public.shop_client_cars (shop_id, import_id, client_id, make, model, year, plate, vin)
        values (v_shop, p_import_id, v_client, coalesce(v_make, v_plate), v_model, v_year, v_plate, v_vin)
        returning id into v_car;
        v_new_cars := v_new_cars + 1;
      else
        update public.shop_client_cars
          set client_id = coalesce(client_id, v_client), year = coalesce(year, v_year), vin = coalesce(vin, v_vin)
        where id = v_car;
      end if;
    end if;

    if v_day is not null then
      insert into public.imported_jobs (shop_id, import_id, client_id, car_id, day, work, odometer, cost,
                                        client_name, client_phone, car_snapshot, dedupe_key)
      values (v_shop, p_import_id, v_client, v_car, v_day, v_work, v_odometer, v_cost, v_name, v_phone,
              jsonb_strip_nulls(jsonb_build_object('make', v_make, 'model', nullif(v_model, ''), 'year', v_year,
                                                   'plate', v_plate, 'plate_norm', v_plate_norm, 'vin', v_vin)),
              md5(concat_ws('|', v_day, coalesce(v_plate_norm, lower(coalesce(v_make, '')) || '/' || lower(v_model)),
                            coalesce(v_phone, lower(v_name)), lower(coalesce(v_work, '')), v_cost, v_odometer)))
      on conflict (shop_id, dedupe_key) do nothing;
      if found then
        v_new_jobs := v_new_jobs + 1;
      end if;
    end if;
  end loop;

  update public.shop_imports
    set clients = clients + v_new_clients, cars = cars + v_new_cars, jobs = jobs + v_new_jobs,
        row_count = row_count + jsonb_array_length(p_rows)
  where id = p_import_id
  returning * into v_import;
  perform public.request_finish(p_request_id, to_jsonb(v_import));
  return v_import;
end
$$;
revoke execute on function public.shop_import_add(uuid, jsonb, uuid) from public, anon;
grant execute on function public.shop_import_add(uuid, jsonb, uuid) to authenticated;

-- Everything an import brought in goes; the import stays in the list as undone.
create function public.shop_import_undo(p_import_id uuid, p_request_id uuid)
returns public.shop_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v public.shop_imports%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'shop_import_undo');
  if v_seen is not null then
    return jsonb_populate_record(null::public.shop_imports, v_seen);
  end if;
  v_shop := public.require_my_shop_owner();
  select * into v from public.shop_imports where id = p_import_id for update;
  if not found or v.shop_id <> v_shop then
    perform public.fail('import_not_found');
  end if;
  if v.undone_at is null then
    delete from public.imported_jobs where import_id = p_import_id;
    delete from public.shop_client_cars where import_id = p_import_id;
    delete from public.shop_clients where import_id = p_import_id;
    update public.shop_imports set undone_at = now() where id = p_import_id returning * into v;
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;
revoke execute on function public.shop_import_undo(uuid, uuid) from public, anon;
grant execute on function public.shop_import_undo(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Istoric: the imported jobs, beside the bookings (never mixed into them)
-- ---------------------------------------------------------------------------------------------
create or replace function public.list_shop_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'ref', b.ref,
          'status', b.status,
          'date', b.date,
          'slot', to_char(b.slot, 'HH24:MI'),
          'note', b.note,
          'service_id', b.service_id,
          'service_ro', s.name_ro,
          'service_en', s.name_en,
          'service_icon', s.icon,
          'extra_services', public.service_names(b.extra_service_ids),
          'client_name', b.client_name,
          'client_phone', b.client_phone,
          'has_client', b.client_id is not null,
          'car_snapshot', b.car_snapshot,
          'odometer', b.odometer,
          'work', b.work,
          'cost', b.cost,
          'done_at', b.done_at,
          'cancelled_by', b.cancelled_by,
          'cancel_reason', b.cancel_reason,
          'closed_reason', b.closed_reason,
          'ended_at', e.ended_at,
          'quote', q.quote
        ) order by e.ended_at desc, b.id)
      from public.bookings b
      cross join lateral (select coalesce(b.done_at, b.cancelled_at, b.status_changed_at) as ended_at) e
      left join public.services s on s.id = b.service_id
      left join lateral (
        select jsonb_build_object(
            'id', qq.id,
            'version', qq.version,
            'status', qq.status,
            'note', qq.note,
            'inspection_fee', qq.inspection_fee,
            'total_sent', qq.total_sent,
            'total_approved', qq.total_approved,
            'sent_at', qq.sent_at,
            'decided_at', qq.decided_at,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved)
                order by qi.position)
              from public.quote_items qi where qi.quote_id = qq.id), '[]'::jsonb)
          ) as quote
        from public.quotes qq
        where qq.booking_id = b.id
          and case b.status
                when 'done' then qq.status in ('accepted', 'partially_accepted')
                when 'quote_refused' then qq.status = 'refused'
                when 'expired' then qq.status = 'expired'
                else false
              end
        order by qq.version desc
        limit 1
      ) q on true
      where b.shop_id = v_shop.id
        and b.status in ('done', 'quote_refused', 'expired', 'cancelled', 'no_show')
        and b.closed_reason is distinct from 'unanswered'
    ), '[]'::jsonb),
    -- T31a: the jobs brought from another program, newest first.
    'imported', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', j.id,
          'day', j.day,
          'client_name', j.client_name,
          'client_phone', j.client_phone,
          'car_snapshot', j.car_snapshot,
          'odometer', j.odometer,
          'work', j.work,
          'cost', j.cost
        ) order by j.day desc, j.created_at desc, j.id)
      from public.imported_jobs j
      where j.shop_id = v_shop.id
    ), '[]'::jsonb)
  );
end
$$;
grant execute on function public.list_shop_history() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fișa mașinii: the imported jobs of the same plate at this shop
-- ---------------------------------------------------------------------------------------------
create or replace function public.shop_vehicle_file(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_key text;
  v_has_plate boolean;
  v_share text;
  v_active_share boolean;
begin
  perform public.require_reader();
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or not public.is_shop_member(v_booking.shop_id) then
    perform public.fail('booking_not_found');
  end if;

  v_key := public.vehicle_key(v_booking.car_snapshot);
  v_has_plate := v_key like 'plate:%';

  -- The agreement: an active booking of this client for this car at this shop.
  select bool_or(x.share_history) into v_active_share
  from public.bookings x
  where x.shop_id = v_booking.shop_id
    and v_booking.client_id is not null
    and x.client_id = v_booking.client_id
    and public.is_active_status(x.status)
    and public.vehicle_key(x.car_snapshot) = v_key;
  v_share := case when v_active_share is null then 'no_active'
                  when v_active_share then 'shared'
                  else 'not_shared' end;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'car', v_booking.car_snapshot,
    'client_name', v_booking.client_name,
    'client_phone', v_booking.client_phone,
    'has_client', v_booking.client_id is not null,
    'share', v_share,
    'own', coalesce((
      select jsonb_agg(j.job order by j.sort_at desc, j.id)
      from (
        select b.id,
               coalesce(b.done_at, (b.date + b.slot) at time zone 'Europe/Bucharest') as sort_at,
               jsonb_build_object(
                 'id', b.id,
                 'ref', b.ref,
                 'date', coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date),
                 'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
                 'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
                 'service_icon', sv.icon,
                 'items', public.accepted_quote_lines(b.id),
                 'work', nullif(btrim(b.work), ''),
                 'odometer', b.odometer,
                 'cost', b.cost,
                 'client_name', b.client_name
               ) as job
        from public.bookings b
        left join public.services sv on sv.id = b.service_id
        where b.shop_id = v_booking.shop_id
          and b.status = 'done'
          and public.vehicle_key(b.car_snapshot) = v_key
          and (v_has_plate or b.client_id = v_booking.client_id)
      ) j), '[]'::jsonb),
    -- T31a: jobs this shop brought from another program, for the same plate.
    'imported', case when not v_has_plate then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', ij.id,
          'date', ij.day,
          'work', ij.work,
          'odometer', ij.odometer,
          'cost', ij.cost,
          'client_name', ij.client_name
        ) order by ij.day desc, ij.id)
      from public.imported_jobs ij
      where ij.shop_id = v_booking.shop_id
        and 'plate:' || (ij.car_snapshot->>'plate_norm') = v_key), '[]'::jsonb) end,
    'others', case when v_share <> 'shared' then '[]'::jsonb else coalesce((
      select jsonb_agg(j.job order by j.sort_at desc, j.id)
      from (
        select b.id,
               coalesce(b.done_at, (b.date + b.slot) at time zone 'Europe/Bucharest') as sort_at,
               jsonb_build_object(
                 'id', b.id,
                 'date', coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date),
                 'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
                 'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
                 'service_icon', sv.icon,
                 'items', public.accepted_quote_lines(b.id),
                 'work', nullif(btrim(b.work), ''),
                 'odometer', b.odometer
               ) as job
        from public.bookings b
        left join public.services sv on sv.id = b.service_id
        where b.client_id = v_booking.client_id
          and b.shop_id <> v_booking.shop_id
          and b.status = 'done'
          and public.vehicle_key(b.car_snapshot) = v_key
      ) j), '[]'::jsonb) end
  );
end
$$;

update public.schema_version set version = 61;
