-- T50 — The complete quote, the vehicle intake sheet and the final quote, each as a PDF for the
-- shop and the client (Eduard, 28 Oct 2026, after a paper quote from a Brașov shop).
-- ARCHITECTURE §2 (Bookings and quotes), §3, §5.
--
-- · Quote lines say what they are: labor (hours × hourly rate) or part (quantity × unit price,
--   producer). A line without hours keeps a fixed price, as before. Older lines keep kind null.
-- · A sent quote keeps what its document prints: the VAT rate (null when the shop is not a VAT
--   payer), the estimated duration, the shop's legal identity, the client's company (when the
--   client gave one) and the shop's own terms.
-- · Every booking gets a quote number at its first quote, from the shop's own sequence
--   (shop_quote_numbers, private); the owner may set where it continues from.
-- · vehicle_intakes: the intake sheet (odometer in, fuel, damage marked on a drawing, photos,
--   personal items, the client's options). The shop saves it while the car is in the workshop;
--   the client confirms it in the app; once confirmed it no longer changes.
-- · complete_job also takes who did the work and who checked it; the odometer at completion is
--   never below the one written at intake.
-- · job_document_data() gives the Edge Function job-document what a PDF prints, after checking the
--   caller is the booking's client, a member of its shop, or an admin.

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
alter table public.platform_settings
  add column vat_rate numeric(4,2) not null default 21 check (vat_rate between 0 and 30);

alter table public.shops
  add column labor_rate numeric(10,2) check (labor_rate is null or labor_rate between 0 and 100000),
  add column quote_terms text check (char_length(quote_terms) <= 2000);
grant update (labor_rate, quote_terms) on public.shops to authenticated;

-- The shop's quote numbers: private (the shops table is readable by every signed-in user).
create table public.shop_quote_numbers (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  next_number int not null default 1 check (next_number between 1 and 99999999)
);
alter table public.shop_quote_numbers enable row level security;

alter table public.bookings
  add column quote_number int check (quote_number between 1 and 99999999),
  add column work_by text check (char_length(work_by) <= 120),
  add column checked_by text check (char_length(checked_by) <= 120),
  add column intake_sent_at timestamptz,
  add column intake_confirmed_at timestamptz;
create unique index bookings_quote_number_idx on public.bookings (shop_id, quote_number) where quote_number is not null;

alter table public.quotes
  add column vat_rate numeric(4,2) check (vat_rate between 0 and 30),
  add column est_hours smallint check (est_hours between 1 and 720),
  add column issuer jsonb,
  add column recipient jsonb,
  add column terms text check (char_length(terms) <= 2000);

alter table public.quote_items
  add column kind text check (kind in ('labor', 'part')),
  add column quantity numeric(10,2) check (quantity > 0 and quantity <= 10000),
  add column unit_price numeric(10,2) check (unit_price between 0 and 1000000),
  add constraint quote_items_quantity_pair check ((quantity is null) = (unit_price is null)),
  add constraint quote_items_labor_plain check (kind is distinct from 'labor' or (variant is null and brand is null));
-- A part line may name its producer without being an original or alternative part.
alter table public.quote_items drop constraint quote_items_brand_variant;
alter table public.quote_items
  add constraint quote_items_brand_variant check (brand is null or variant is not null or kind = 'part');

-- The client's company, printed on quotes when the client gives one (Cont → Date pentru deviz).
alter table public.profiles
  add column company_name text check (char_length(btrim(company_name)) between 1 and 200),
  add column company_vat_id text check (company_vat_id is null or public.is_valid_cui(company_vat_id)),
  add column company_address text check (char_length(btrim(company_address)) between 1 and 300);
grant update (company_name, company_vat_id, company_address) on public.profiles to authenticated;

create function public.profiles_company_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_name := nullif(btrim(new.company_name), '');
  new.company_vat_id := public.normalize_code(nullif(btrim(new.company_vat_id), ''));
  new.company_address := nullif(btrim(new.company_address), '');
  return new;
end
$$;
create trigger profiles_company_normalize before insert or update of company_name, company_vat_id, company_address
  on public.profiles for each row execute function public.profiles_company_normalize();

-- ---------------------------------------------------------------------------------------------
-- Quote numbers: the owner reads where the sequence stands and may move it forward (never onto a
-- number already used).
-- ---------------------------------------------------------------------------------------------
create function public.my_quote_numbering()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid := public.require_my_shop_owner();
  v_last int;
begin
  select max(quote_number) into v_last from public.bookings where shop_id = v_shop;
  return jsonb_build_object(
    'next', greatest(coalesce((select n.next_number from public.shop_quote_numbers n where n.shop_id = v_shop), 1),
                     coalesce(v_last, 0) + 1),
    'last', v_last);
end
$$;
revoke execute on function public.my_quote_numbering() from public, anon;
grant execute on function public.my_quote_numbering() to authenticated;

create function public.set_quote_next_number(p_next int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_last int;
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'set_quote_next_number');
  if v_seen is not null then
    return v_seen;
  end if;
  v_shop := public.require_my_shop_owner();
  if p_next is null or p_next < 1 or p_next > 99999999 then
    perform public.fail('quote_number_invalid');
  end if;
  perform 1 from public.shops where id = v_shop for no key update;
  select max(quote_number) into v_last from public.bookings where shop_id = v_shop;
  if v_last is not null and p_next <= v_last then
    perform public.fail('quote_number_used', jsonb_build_object('next', v_last + 1));
  end if;
  insert into public.shop_quote_numbers (shop_id, next_number) values (v_shop, p_next)
  on conflict (shop_id) do update set next_number = excluded.next_number;
  v_result := jsonb_build_object('next', p_next, 'last', v_last);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.set_quote_next_number(int, uuid) from public, anon;
grant execute on function public.set_quote_next_number(int, uuid) to authenticated;

-- The booking's quote number: its own, or the next of the shop's sequence (under the shop's lock,
-- skipping any number already taken).
create function public.assign_quote_number(p_booking public.bookings)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_next int;
begin
  if p_booking.quote_number is not null then
    return p_booking.quote_number;
  end if;
  perform 1 from public.shops where id = p_booking.shop_id for no key update;
  insert into public.shop_quote_numbers (shop_id) values (p_booking.shop_id) on conflict (shop_id) do nothing;
  select n.next_number into v_next from public.shop_quote_numbers n where n.shop_id = p_booking.shop_id;
  while exists (select 1 from public.bookings b where b.shop_id = p_booking.shop_id and b.quote_number = v_next) loop
    v_next := v_next + 1;
  end loop;
  update public.shop_quote_numbers set next_number = least(v_next + 1, 99999999) where shop_id = p_booking.shop_id;
  update public.bookings set quote_number = v_next where id = p_booking.id;
  return v_next;
end
$$;
revoke execute on function public.assign_quote_number(public.bookings) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The composer's lines (T50): [{"name", "kind": "labor" | "part", "qty", "unit_price"} or
-- {"name", "kind", "price"} (fixed price), with for parts "brand" (producer), "part" and "alt"
-- as in T37c]. A line with qty costs round(qty × unit_price, 2); qty 0.01–10 000 with at most 2
-- decimals. Labor lines have no producer and no variants. Lines without "kind" work as before.
-- ---------------------------------------------------------------------------------------------
create function public.is_quote_quantity(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null and p_text ~ '^\d{1,5}(\.\d{1,2})?$' and p_text::numeric > 0 and p_text::numeric <= 10000
$$;
revoke execute on function public.is_quote_quantity(text) from public, anon, authenticated;

drop function public.clean_quote_lines(jsonb);
create function public.clean_quote_lines(p_items jsonb)
returns table (pos int, name text, price numeric, option_group smallint, variant text, brand text,
               kind text, quantity numeric, unit_price numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_line int := 0;
  v_pos int := 0;
  v_group smallint := 0;
  v_name text;
  v_kind text;
  v_qty numeric;
  v_unit numeric;
  v_price numeric;
  v_alt jsonb;
  v_alt_unit numeric;
  v_alt_price numeric;
  v_brand text;
  v_alt_brand text;
  v_part text;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public.fail('quote_items_required');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform public.fail('quote_too_many_items', jsonb_build_object('limit', 50));
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if jsonb_typeof(v_item) <> 'object' then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
    end if;
    v_name := btrim(v_item->>'name');
    v_kind := nullif(v_item->>'kind', '');
    v_alt := v_item->'alt';
    if jsonb_typeof(v_alt) = 'null' then
      v_alt := null;
    end if;
    v_part := nullif(v_item->>'part', '');
    v_brand := nullif(btrim(v_item->>'brand'), '');
    if coalesce(v_name, '') = '' or char_length(v_name) > 200
       or (v_kind is not null and v_kind not in ('labor', 'part'))
       or char_length(v_brand) > 80
       or (v_kind = 'labor' and (v_brand is not null or v_part is not null or v_alt is not null)) then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
    end if;

    -- Quantity × unit price, or a fixed price.
    if v_item ? 'qty' and jsonb_typeof(v_item->'qty') <> 'null' then
      if v_kind is null or not public.is_quote_quantity(v_item->>'qty') or not public.is_quote_price(v_item->>'unit_price') then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_qty := (v_item->>'qty')::numeric(10,2);
      v_unit := (v_item->>'unit_price')::numeric(10,2);
      v_price := round(v_qty * v_unit, 2);
    else
      if not public.is_quote_price(v_item->>'price') then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_qty := null;
      v_unit := null;
      v_price := (v_item->>'price')::numeric(10,2);
    end if;
    if v_price > 1000000 then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
    end if;

    if v_alt is null then
      -- A single line may say which part it is; a part line may name its producer on its own.
      if (v_part is not null and v_part not in ('original', 'alternative'))
         or (v_brand is not null and v_part is null and v_kind is distinct from 'part') then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := v_price;
      option_group := null; variant := v_part; brand := v_brand;
      kind := v_kind; quantity := v_qty; unit_price := v_unit;
      v_total := v_total + price;
      return next;
    else
      v_alt_brand := nullif(btrim(v_alt->>'brand'), '');
      if jsonb_typeof(v_alt) <> 'object' or char_length(v_alt_brand) > 80 or v_part is not null
         or (v_brand is not null and v_kind is distinct from 'part') then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      if v_qty is not null then
        if not public.is_quote_price(v_alt->>'unit_price') then
          perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
        end if;
        v_alt_unit := (v_alt->>'unit_price')::numeric(10,2);
        v_alt_price := round(v_qty * v_alt_unit, 2);
      else
        if not public.is_quote_price(v_alt->>'price') then
          perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
        end if;
        v_alt_unit := null;
        v_alt_price := (v_alt->>'price')::numeric(10,2);
      end if;
      if v_alt_price > 1000000 then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_group := v_group + 1;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := v_price;
      option_group := v_group; variant := 'original'; brand := v_brand;
      kind := v_kind; quantity := v_qty; unit_price := v_unit;
      v_total := v_total + price;
      return next;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := v_alt_price;
      option_group := v_group; variant := 'alternative'; brand := v_alt_brand;
      kind := v_kind; quantity := v_qty; unit_price := v_alt_unit;
      return next;
    end if;
  end loop;
  if v_total <= 0 then
    perform public.fail('quote_total_zero');
  end if;
end
$$;
revoke execute on function public.clean_quote_lines(jsonb) from public, anon, authenticated;

-- The shop's identity as a document prints it: public data, plus the company (shop_billing).
create function public.quote_issuer(p_shop_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'name', s.name,
    'street', s.street,
    'city', s.city,
    'county', s.county,
    'phone', s.phone,
    'legal_name', nullif(btrim(b.legal_name), ''),
    'vat_id', b.vat_id,
    'reg_com', b.reg_com,
    'legal_address', nullif(btrim(b.legal_address), '')))
  from public.shops s
  left join public.shop_billing b on b.shop_id = s.id
  where s.id = p_shop_id
$$;
revoke execute on function public.quote_issuer(uuid) from public, anon, authenticated;

-- The client's company, when the client gave one.
create function public.quote_recipient(p_client_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p.company_name is null then null else jsonb_strip_nulls(jsonb_build_object(
    'company_name', p.company_name,
    'vat_id', p.company_vat_id,
    'address', p.company_address)) end
  from public.profiles p
  where p.id = p_client_id
$$;
revoke execute on function public.quote_recipient(uuid) from public, anon, authenticated;

drop function public.insert_quote(public.bookings, jsonb, text);
create function public.insert_quote(p_booking public.bookings, p_items jsonb, p_note text, p_est_hours int default null)
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
  if p_est_hours is not null and (p_est_hours < 1 or p_est_hours > 720) then
    perform public.fail('est_hours_invalid');
  end if;
  select count(*) into v_versions from public.quotes where booking_id = p_booking.id;
  if v_versions >= public.app_limit('quote_versions_max', 20) then
    perform public.fail('limit_quote_versions', jsonb_build_object('limit', public.app_limit('quote_versions_max', 20)));
  end if;
  perform public.assign_quote_number(p_booking);

  insert into public.quotes (booking_id, version, status, note, inspection_fee, total_sent, sent_at,
                             expires_at, sent_by, vat_rate, est_hours, issuer, recipient, terms)
  select p_booking.id, v_versions + 1, 'sent', v_note, s.inspection_fee,
         (select sum(l.price) from public.clean_quote_lines(p_items) l
          where l.option_group is null or l.variant = 'original'),
         now(), now() + make_interval(days => ps.quote_expiry_days), auth.uid(),
         case when coalesce(b.vat_payer, false) then ps.vat_rate end,
         p_est_hours,
         public.quote_issuer(s.id),
         public.quote_recipient(p_booking.client_id),
         nullif(btrim(s.quote_terms), '')
  from public.shops s
  cross join public.platform_settings ps
  left join public.shop_billing b on b.shop_id = s.id
  where s.id = p_booking.shop_id and ps.id = 1
  returning * into v_quote;

  insert into public.quote_items (quote_id, position, name, price, option_group, variant, brand, kind, quantity, unit_price)
  select v_quote.id, l.pos, l.name, l.price, l.option_group, l.variant, l.brand, l.kind, l.quantity, l.unit_price
  from public.clean_quote_lines(p_items) l;
  return v_quote;
end
$$;
revoke execute on function public.insert_quote(public.bookings, jsonb, text, int) from public, anon, authenticated;

-- send_quote / replace_quote take the estimated duration (hours, optional).
drop function public.send_quote(uuid, jsonb, uuid, text);
create function public.send_quote(p_booking_id uuid, p_items jsonb, p_request_id uuid, p_note text default null,
                                  p_est_hours int default null)
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

  v_quote := public.insert_quote(v, p_items, p_note, p_est_hours);
  update public.bookings set status = 'quote_sent' where id = v.id returning * into v;

  perform public.post_booking_event(v, 'quote_sent', 'shop',
    jsonb_build_object('quote_id', v_quote.id, 'version', v_quote.version, 'total', v_quote.total_sent));
  perform public.notify_user(v.client_id, 'quote_sent', public.booking_event_params(v) ||
    jsonb_build_object('quote_id', v_quote.id, 'total', v_quote.total_sent, 'expires_at', v_quote.expires_at), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;
revoke execute on function public.send_quote(uuid, jsonb, uuid, text, int) from public, anon;
grant execute on function public.send_quote(uuid, jsonb, uuid, text, int) to authenticated;

drop function public.replace_quote(uuid, jsonb, uuid, text);
create function public.replace_quote(p_booking_id uuid, p_items jsonb, p_request_id uuid, p_note text default null,
                                     p_est_hours int default null)
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
  v_quote := public.insert_quote(v, p_items, p_note, p_est_hours);
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
revoke execute on function public.replace_quote(uuid, jsonb, uuid, text, int) from public, anon;
grant execute on function public.replace_quote(uuid, jsonb, uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The vehicle intake sheet
-- ---------------------------------------------------------------------------------------------
create table public.vehicle_intakes (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  odometer int check (odometer between 0 and 2000000),
  -- Quarters of the tank: 0 = reserve, 4 = full.
  fuel smallint check (fuel between 0 and 4),
  -- [{"x": 0–1, "y": 0–1, "kind": "scratch" | "dent" | "crack" | "broken" | "missing" | "other", "note"}]
  damages jsonb not null default '[]'::jsonb check (jsonb_typeof(damages) = 'array'),
  photos text[] not null default '{}',
  personal_items text check (char_length(personal_items) <= 500),
  notes text check (char_length(notes) <= 2000),
  keep_parts boolean,
  road_test boolean,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null
);
alter table public.vehicle_intakes enable row level security;
create policy vehicle_intakes_select on public.vehicle_intakes for select to authenticated
  using (public.can_read_booking(booking_id));
grant select on public.vehicle_intakes to authenticated;

-- Photos of the intake: private; the shop's members add and remove them, the booking's client
-- and the shop read them. Path `<booking id>/<file>`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intake-photos', 'intake-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create function public.is_booking_shop_member(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bookings b where b.id = p_booking_id and public.is_shop_member(b.shop_id))
$$;
revoke execute on function public.is_booking_shop_member(uuid) from public, anon;
grant execute on function public.is_booking_shop_member(uuid) to authenticated;

create policy intake_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'intake-photos' and public.is_booking_shop_member(public.try_uuid((storage.foldername(name))[1])));
create policy intake_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'intake-photos' and public.can_read_booking(public.try_uuid((storage.foldername(name))[1])));
create policy intake_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'intake-photos' and public.is_booking_shop_member(public.try_uuid((storage.foldername(name))[1])));

create function public.clean_intake_damages(p_damages jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_note text;
begin
  if p_damages is null or jsonb_typeof(p_damages) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_damages) <> 'array' or jsonb_array_length(p_damages) > 40 then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'damages'));
  end if;
  for v_item in select * from jsonb_array_elements(p_damages) loop
    v_note := nullif(btrim(v_item->>'note'), '');
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'x') <> 'number' or jsonb_typeof(v_item->'y') <> 'number'
       or (v_item->>'x')::numeric not between 0 and 1 or (v_item->>'y')::numeric not between 0 and 1
       or coalesce(v_item->>'kind', '') not in ('scratch', 'dent', 'crack', 'broken', 'missing', 'other')
       or char_length(v_note) > 120 then
      perform public.fail('intake_invalid', jsonb_build_object('field', 'damages'));
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'x', round((v_item->>'x')::numeric, 4),
      'y', round((v_item->>'y')::numeric, 4),
      'kind', v_item->>'kind',
      'note', v_note)));
  end loop;
  return v_out;
end
$$;
revoke execute on function public.clean_intake_damages(jsonb) from public, anon, authenticated;

-- save_vehicle_intake — the shop writes (or rewrites) the sheet while the car is in the workshop;
-- the client is told. Refused once the client confirmed it.
-- p_data: {"odometer", "fuel", "damages", "photos", "personal_items", "notes", "keep_parts", "road_test"}
create function public.save_vehicle_intake(p_booking_id uuid, p_data jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_old public.vehicle_intakes%rowtype;
  v_row public.vehicle_intakes%rowtype;
  v_odometer int;
  v_fuel smallint;
  v_last int;
  v_photos text[];
  v_photo text;
  v_items text := nullif(btrim(p_data->>'personal_items'), '');
  v_notes text := nullif(btrim(p_data->>'notes'), '');
  v_first boolean;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'save_vehicle_intake');
  if v_seen is not null then
    return v_seen;
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress');
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'data'));
  end if;

  select * into v_old from public.vehicle_intakes where booking_id = v.id for update;
  if v_old.confirmed_at is not null then
    perform public.fail('intake_confirmed');
  end if;
  v_first := v_old.booking_id is null;

  if jsonb_typeof(p_data->'odometer') = 'number' then
    if (p_data->>'odometer') !~ '^\d{1,7}$' or (p_data->>'odometer')::int > 2000000 then
      perform public.fail('odometer_invalid');
    end if;
    v_odometer := (p_data->>'odometer')::int;
    v_last := public.last_odometer_for_plate(v.car_snapshot->>'plate_norm');
    if v_last is not null and v_odometer < v_last then
      perform public.fail('odometer_lower', jsonb_build_object('previous', v_last));
    end if;
  elsif p_data ? 'odometer' and jsonb_typeof(p_data->'odometer') <> 'null' then
    perform public.fail('odometer_invalid');
  end if;

  if jsonb_typeof(p_data->'fuel') = 'number' then
    if (p_data->>'fuel') !~ '^[0-4]$' then
      perform public.fail('intake_invalid', jsonb_build_object('field', 'fuel'));
    end if;
    v_fuel := (p_data->>'fuel')::smallint;
  elsif p_data ? 'fuel' and jsonb_typeof(p_data->'fuel') <> 'null' then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'fuel'));
  end if;

  v_photos := '{}';
  if jsonb_typeof(p_data->'photos') = 'array' then
    if jsonb_array_length(p_data->'photos') > 8 then
      perform public.fail('intake_invalid', jsonb_build_object('field', 'photos'));
    end if;
    for v_photo in select jsonb_array_elements_text(p_data->'photos') loop
      if v_photo !~ ('^' || v.id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$') then
        perform public.fail('intake_invalid', jsonb_build_object('field', 'photos'));
      end if;
      v_photos := v_photos || v_photo;
    end loop;
  elsif p_data ? 'photos' and jsonb_typeof(p_data->'photos') <> 'null' then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'photos'));
  end if;

  if char_length(v_items) > 500 then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'personal_items'));
  end if;
  if char_length(v_notes) > 2000 then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'notes'));
  end if;
  if (p_data ? 'keep_parts' and jsonb_typeof(p_data->'keep_parts') not in ('boolean', 'null'))
     or (p_data ? 'road_test' and jsonb_typeof(p_data->'road_test') not in ('boolean', 'null')) then
    perform public.fail('intake_invalid', jsonb_build_object('field', 'options'));
  end if;

  insert into public.vehicle_intakes (booking_id, shop_id, odometer, fuel, damages, photos, personal_items, notes,
                                      keep_parts, road_test, created_by, updated_by)
  values (v.id, v.shop_id, v_odometer, v_fuel, public.clean_intake_damages(p_data->'damages'), v_photos, v_items, v_notes,
          (p_data->>'keep_parts')::boolean, (p_data->>'road_test')::boolean, auth.uid(), auth.uid())
  on conflict (booking_id) do update set
    odometer = excluded.odometer, fuel = excluded.fuel, damages = excluded.damages, photos = excluded.photos,
    personal_items = excluded.personal_items, notes = excluded.notes, keep_parts = excluded.keep_parts,
    road_test = excluded.road_test, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;

  -- The booking row carries when the sheet went out, so both sides' live lists see it.
  update public.bookings set intake_sent_at = now() where id = v.id returning * into v;
  perform public.post_booking_event(v, case when v_first then 'intake_sent' else 'intake_updated' end, 'shop', '{}'::jsonb);
  perform public.notify_user(v.client_id, case when v_first then 'intake_sent' else 'intake_updated' end,
    public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v_row));
  return to_jsonb(v_row);
end
$$;
revoke execute on function public.save_vehicle_intake(uuid, jsonb, uuid) from public, anon;
grant execute on function public.save_vehicle_intake(uuid, jsonb, uuid) to authenticated;

-- confirm_vehicle_intake — the client agrees with the sheet; from then on it no longer changes.
create function public.confirm_vehicle_intake(p_booking_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_row public.vehicle_intakes%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'confirm_vehicle_intake');
  if v_seen is not null then
    return v_seen;
  end if;
  v := public.lock_booking_as_client(p_booking_id);
  select * into v_row from public.vehicle_intakes where booking_id = v.id for update;
  if not found then
    perform public.fail('intake_not_found');
  end if;
  if v_row.confirmed_at is not null then
    perform public.fail('intake_confirmed');
  end if;
  update public.vehicle_intakes set confirmed_at = now(), confirmed_by = auth.uid()
  where booking_id = v.id returning * into v_row;
  update public.bookings set intake_confirmed_at = v_row.confirmed_at where id = v.id returning * into v;
  perform public.post_booking_event(v, 'intake_confirmed', 'client', '{}'::jsonb);
  perform public.notify_shop(v.shop_id, 'intake_confirmed', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v_row));
  return to_jsonb(v_row);
end
$$;
revoke execute on function public.confirm_vehicle_intake(uuid, uuid) from public, anon;
grant execute on function public.confirm_vehicle_intake(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- complete_job: who did the work and who checked it; never below the odometer at intake.
-- ---------------------------------------------------------------------------------------------
drop function public.complete_job(uuid, int, uuid, text, numeric, boolean, int);
create function public.complete_job(
  p_booking_id uuid,
  p_odometer int,
  p_request_id uuid,
  p_work text default null,
  p_cost numeric default null,
  p_confirm_jump boolean default false,
  p_warranty_months int default null,
  p_work_by text default null,
  p_checked_by text default null
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
  v_intake int;
  v_work text := nullif(btrim(p_work), '');
  v_work_by text := nullif(btrim(p_work_by), '');
  v_checked_by text := nullif(btrim(p_checked_by), '');
  v_cost numeric := p_cost;
  v_quote public.quotes%rowtype;
  v_until date;
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
  -- The reading written when the car came in is the floor for this job.
  select i.odometer into v_intake from public.vehicle_intakes i where i.booking_id = v.id;
  if v_intake is not null and p_odometer < v_intake then
    perform public.fail('odometer_lower', jsonb_build_object('previous', v_intake));
  end if;
  if v_last is not null and p_odometer < v_last then
    perform public.fail('odometer_lower', jsonb_build_object('previous', v_last));
  end if;
  if v_last is not null and p_odometer - v_last > 50000 and not coalesce(p_confirm_jump, false) then
    perform public.fail('odometer_jump', jsonb_build_object('previous', v_last, 'diff', p_odometer - v_last));
  end if;
  -- The same reading as a job on another day: the car was driven in between, so it is probably
  -- the old number typed again. The shop reads the dashboard again and confirms (p_confirm_jump).
  if v_last is not null and p_odometer = v_last and not coalesce(p_confirm_jump, false) and exists (
    select 1 from public.bookings b
    where b.car_snapshot->>'plate_norm' = v.car_snapshot->>'plate_norm'
      and b.status = 'done' and b.odometer = v_last
      and (b.done_at at time zone 'Europe/Bucharest')::date <> (now() at time zone 'Europe/Bucharest')::date
  ) then
    perform public.fail('odometer_same', jsonb_build_object('previous', v_last));
  end if;

  if char_length(v_work) > 4000 then
    perform public.fail('work_too_long');
  end if;
  if char_length(v_work_by) > 120 or char_length(v_checked_by) > 120 then
    perform public.fail('name_too_long');
  end if;
  if v_cost is not null and (v_cost < 0 or v_cost > 1000000 or v_cost <> round(v_cost, 2)) then
    perform public.fail('cost_invalid');
  end if;
  -- The warranty the shop gives on the work: 1–60 months from today (Bucharest), or none.
  if p_warranty_months is not null then
    if p_warranty_months < 1 or p_warranty_months > 60 then
      perform public.fail('warranty_invalid');
    end if;
    v_until := ((now() at time zone 'Europe/Bucharest')::date + make_interval(months => p_warranty_months))::date;
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
    set status = 'done', done_at = now(), odometer = p_odometer, work = left(v_work, 4000), cost = v_cost,
        warranty_months = p_warranty_months, warranty_until = v_until,
        work_by = v_work_by, checked_by = v_checked_by
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'job_done', 'shop', jsonb_build_object('odometer', v.odometer, 'cost', v.cost, 'warranty_months', v.warranty_months));
  perform public.notify_user(v.client_id, 'job_done',
    public.booking_event_params(v) || jsonb_build_object('odometer', v.odometer, 'cost', v.cost), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;
revoke execute on function public.complete_job(uuid, int, uuid, text, numeric, boolean, int, text, text) from public, anon;
grant execute on function public.complete_job(uuid, int, uuid, text, numeric, boolean, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- What a PDF prints (service role only: the Edge Function job-document checks the token first).
-- p_kind: 'quote' (the quote as sent, with the client's answer once given), 'final' (the finished
-- job), 'intake' (the intake sheet).
-- ---------------------------------------------------------------------------------------------
create function public.job_document_data(p_user_id uuid, p_booking_id uuid, p_kind text, p_aal text default 'aal1')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_quote public.quotes%rowtype;
  v_intake public.vehicle_intakes%rowtype;
  v_side text;
begin
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('not_found');
  end if;
  if v.client_id = p_user_id then
    v_side := 'client';
  elsif exists (select 1 from public.shops s where s.id = v.shop_id and s.owner_id = p_user_id)
     or exists (select 1 from public.shop_staff st
                where st.shop_id = v.shop_id and st.user_id = p_user_id and st.accepted_at is not null) then
    v_side := 'shop';
  elsif p_aal = 'aal2' and exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin') then
    v_side := 'admin';
  else
    perform public.fail('not_found');
  end if;
  if p_kind not in ('quote', 'final', 'intake') then
    perform public.fail('not_found');
  end if;

  select * into v_quote from public.quotes q
  where q.booking_id = v.id
    and case
          when v.status = 'quote_sent' then q.status = 'sent'
          when v.status in ('approved', 'in_progress', 'done') then q.status in ('accepted', 'partially_accepted')
          when v.status = 'quote_refused' then q.status = 'refused'
          when v.status = 'expired' then q.status = 'expired'
          else false
        end
  order by q.version desc limit 1;
  select * into v_intake from public.vehicle_intakes where booking_id = v.id;

  if (p_kind = 'quote' and v_quote.id is null)
     or (p_kind = 'final' and v.status <> 'done')
     or (p_kind = 'intake' and v_intake.booking_id is null) then
    perform public.fail('not_ready');
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'side', v_side,
    'booking', jsonb_build_object(
      'id', v.id, 'ref', v.ref, 'status', v.status, 'date', v.date, 'slot', to_char(v.slot, 'HH24:MI'),
      'note', v.note, 'created_at', v.created_at, 'inspection_started_at', v.inspection_started_at,
      'started_at', v.started_at, 'done_at', v.done_at, 'odometer', v.odometer, 'work', v.work, 'cost', v.cost,
      'warranty_months', v.warranty_months, 'warranty_until', v.warranty_until,
      'work_by', v.work_by, 'checked_by', v.checked_by, 'quote_number', v.quote_number,
      'client_name', v.client_name, 'client_phone', v.client_phone, 'car', v.car_snapshot,
      'services_ro', public.services_label(v.service_id, v.extra_service_ids, 'ro'),
      'services_en', public.services_label(v.service_id, v.extra_service_ids, 'en')),
    'shop', coalesce(v_quote.issuer, public.quote_issuer(v.shop_id)),
    'recipient', case when v_quote.id is not null then v_quote.recipient else public.quote_recipient(v.client_id) end,
    'quote', case when v_quote.id is null then null else jsonb_build_object(
      'version', v_quote.version, 'status', v_quote.status, 'note', v_quote.note,
      'inspection_fee', v_quote.inspection_fee, 'total_sent', v_quote.total_sent,
      'total_approved', v_quote.total_approved, 'sent_at', v_quote.sent_at, 'expires_at', v_quote.expires_at,
      'decided_at', v_quote.decided_at, 'decided_by', v_quote.decided_by, 'vat_rate', v_quote.vat_rate,
      'est_hours', v_quote.est_hours, 'terms', v_quote.terms,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
            'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved,
            'option_group', qi.option_group, 'variant', qi.variant, 'brand', qi.brand,
            'kind', qi.kind, 'quantity', qi.quantity, 'unit_price', qi.unit_price)
          order by qi.position)
        from public.quote_items qi where qi.quote_id = v_quote.id), '[]'::jsonb)) end,
    'intake', case when v_intake.booking_id is null then null else jsonb_build_object(
      'odometer', v_intake.odometer, 'fuel', v_intake.fuel, 'damages', v_intake.damages,
      'photos', to_jsonb(v_intake.photos), 'personal_items', v_intake.personal_items, 'notes', v_intake.notes,
      'keep_parts', v_intake.keep_parts, 'road_test', v_intake.road_test,
      'created_at', v_intake.created_at, 'updated_at', v_intake.updated_at,
      'confirmed_at', v_intake.confirmed_at) end);
end
$$;
revoke execute on function public.job_document_data(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The shop's lists carry the new fields: the line kind, quantity and unit price, the quote's VAT
-- and duration, the quote number, the intake's state, who did the work.
-- ---------------------------------------------------------------------------------------------
create or replace function public.quote_item_json(qi public.quote_items)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved,
    'option_group', qi.option_group, 'variant', qi.variant, 'brand', qi.brand,
    'kind', qi.kind, 'quantity', qi.quantity, 'unit_price', qi.unit_price)
$$;
revoke execute on function public.quote_item_json(public.quote_items) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_shop_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'city', v_shop.city,
      'daily_capacity', v_shop.daily_capacity,
      'inspection_fee', v_shop.inspection_fee,
      'labor_rate', v_shop.labor_rate,
      -- The VAT a quote sent now would carry (null: the shop is not a VAT payer).
      'vat_rate', (select case when b.vat_payer then ps.vat_rate end
                   from public.platform_settings ps
                   left join public.shop_billing b on b.shop_id = v_shop.id
                   where ps.id = 1)),
    'quote_expiry_days', (select ps.quote_expiry_days from public.platform_settings ps where ps.id = 1),
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
          'client_account', p.display_id,
          'client_no_shows', case when b.client_id is null then 0 else (
            select count(*)::int from public.bookings x
            where x.client_id = b.client_id and x.status = 'no_show' and x.source = 'app'
              and x.date > public.bucharest_today() - 90) end,
          'offer_percent', b.offer_percent,
          'offer_kind', b.offer_kind,
          'loyalty_percent', b.loyalty_percent,
          'loyalty_level', b.loyalty_level,
          'share_history', b.share_history,
          -- Added by the shop (T29): the client's email, whether the invitation went out and
          -- whether the client has taken the booking into an account since.
          'source', b.source,
          'client_email', b.client_email,
          'invite_sent_at', b.invite_sent_at,
          'claimed', b.client_id is not null,
          'car_snapshot', b.car_snapshot,
          'created_at', b.created_at,
          'confirmed_at', b.confirmed_at,
          'inspection_started_at', b.inspection_started_at,
          'started_at', b.started_at,
          'quote_number', b.quote_number,
          'intake_sent_at', b.intake_sent_at,
          'intake_confirmed_at', b.intake_confirmed_at,
          'quote', q.quote
        ) order by b.date, b.slot, b.created_at)
      from public.bookings b
      left join public.services s on s.id = b.service_id
      left join public.profiles p on p.id = b.client_id
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
            'expires_at', qq.expires_at,
            'decided_by', qq.decided_by,
            'vat_rate', qq.vat_rate,
            'est_hours', qq.est_hours,
            'items', coalesce((
              select jsonb_agg(public.quote_item_json(qi) order by qi.position)
              from public.quote_items qi where qi.quote_id = qq.id), '[]'::jsonb)
          ) as quote
        from public.quotes qq
        where qq.booking_id = b.id
          and b.status in ('quote_sent', 'approved', 'in_progress')
          and qq.status in ('sent', 'accepted', 'partially_accepted')
        order by qq.version desc
        limit 1
      ) q on true
      where b.shop_id = v_shop.id and public.is_active_status(b.status)
    ), '[]'::jsonb)
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.list_shop_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          'warranty_months', b.warranty_months,
          'warranty_until', b.warranty_until,
          'cost', b.cost,
          'done_at', b.done_at,
          'cancelled_by', b.cancelled_by,
          'cancel_reason', b.cancel_reason,
          'closed_reason', b.closed_reason,
          'quote_number', b.quote_number,
          'work_by', b.work_by,
          'checked_by', b.checked_by,
          'intake_sent_at', b.intake_sent_at,
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
            'vat_rate', qq.vat_rate,
            'est_hours', qq.est_hours,
            'items', coalesce((
              select jsonb_agg(public.quote_item_json(qi) order by qi.position)
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
    -- T31a: the newest imported jobs (a long history comes in pages: list_imported_jobs).
    'imported', coalesce((
      select jsonb_agg(public.imported_job_json(j) order by j.day desc, j.id desc)
      from (
        select * from public.imported_jobs ij
        where ij.shop_id = v_shop.id
        order by ij.day desc, ij.id desc
        limit 100
      ) j
    ), '[]'::jsonb),
    'imported_total', (select count(*) from public.imported_jobs ij where ij.shop_id = v_shop.id)
  );
end
$function$;

update public.schema_version set version = 87;
