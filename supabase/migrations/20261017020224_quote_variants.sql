-- T37c — Variants on a quote line: original part or alternative part, the client chooses
-- (Eduard, 16 Oct 2026). ARCHITECTURE §5.
--
-- · A line of the composer may carry an alternative: {"name", "price", "alt": {"price", "brand"}}.
--   It is kept as two quote_items of the same option_group, `original` then `alternative`
--   (brand, ≤ 80, optional), in consecutive positions. Plain lines keep option_group/variant null.
-- · total_sent counts the plain lines and the originals (what the client gets without changing
--   anything). The answer takes at most one variant of a group (`quote_variant_both`); the quote is
--   `accepted` when every plain line and one variant of every group are taken.
-- · The shop's lists (list_shop_bookings, list_shop_history) carry option_group, variant, brand.

alter table public.quote_items
  add column option_group smallint check (option_group between 1 and 50),
  add column variant text check (variant in ('original', 'alternative')),
  add column brand text check (char_length(brand) between 1 and 80),
  add constraint quote_items_variant_both check ((option_group is null) = (variant is null)),
  add constraint quote_items_brand_variant check (brand is null or variant is not null),
  add constraint quote_items_group_variant unique (quote_id, option_group, variant);

-- ---------------------------------------------------------------------------------------------
-- The composer's lines: [{"name": "Plăcuțe frână", "price": 420, "alt": {"price": 260, "brand": "Bosch"}}, …].
-- 1–50 lines, name 1–200 characters, prices 0–1 000 000 with at most 2 decimals, the total of the
-- plain lines and originals > 0. Returns the quote_items to insert, in order.
-- ---------------------------------------------------------------------------------------------
create function public.clean_quote_lines(p_items jsonb)
returns table (pos int, name text, price numeric, option_group smallint, variant text, brand text)
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
  v_alt jsonb;
  v_brand text;
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
    v_name := btrim(v_item->>'name');
    if coalesce(v_name, '') = '' or char_length(v_name) > 200
       or not public.is_quote_price(v_item->>'price') then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
    end if;
    v_alt := v_item->'alt';
    if v_alt is null or jsonb_typeof(v_alt) = 'null' then
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := (v_item->>'price')::numeric(10,2);
      option_group := null; variant := null; brand := null;
      v_total := v_total + price;
      return next;
    else
      v_brand := nullif(btrim(v_alt->>'brand'), '');
      if jsonb_typeof(v_alt) <> 'object' or not public.is_quote_price(v_alt->>'price')
         or char_length(v_brand) > 80 then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_group := v_group + 1;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := (v_item->>'price')::numeric(10,2);
      option_group := v_group; variant := 'original'; brand := null;
      v_total := v_total + price;
      return next;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := (v_alt->>'price')::numeric(10,2);
      option_group := v_group; variant := 'alternative'; brand := v_brand;
      return next;
    end if;
  end loop;
  if v_total <= 0 then
    perform public.fail('quote_total_zero');
  end if;
end
$$;
revoke execute on function public.clean_quote_lines(jsonb) from public, anon, authenticated;

create function public.is_quote_price(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null and p_text ~ '^\d{1,7}(\.\d{1,2})?$' and p_text::numeric <= 1000000
$$;
revoke execute on function public.is_quote_price(text) from public, anon, authenticated;

create or replace function public.insert_quote(p_booking public.bookings, p_items jsonb, p_note text)
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
         (select sum(l.price) from public.clean_quote_lines(p_items) l where l.variant is distinct from 'alternative'),
         now(), now() + make_interval(days => ps.quote_expiry_days), auth.uid()
  from public.shops s cross join public.platform_settings ps
  where s.id = p_booking.shop_id and ps.id = 1
  returning * into v_quote;

  insert into public.quote_items (quote_id, position, name, price, option_group, variant, brand)
  select v_quote.id, l.pos, l.name, l.price, l.option_group, l.variant, l.brand
  from public.clean_quote_lines(p_items) l;
  return v_quote;
end
$$;

-- The client's (or, for a walk-in, the shop's) answer on a quote: the lines taken, at most one
-- variant of a group. Returns how many choices the quote has (plain lines + groups), how many were
-- taken and their total.
create function public.apply_quote_answer(p_quote_id uuid, p_ids uuid[])
returns table (choices int, approved int, total numeric)
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(p_ids) i
             where not exists (select 1 from public.quote_items qi where qi.id = i and qi.quote_id = p_quote_id)) then
    perform public.fail('quote_item_invalid');
  end if;
  if exists (select 1 from public.quote_items qi
             where qi.quote_id = p_quote_id and qi.option_group is not null and qi.id = any (p_ids)
             group by qi.option_group having count(*) > 1) then
    perform public.fail('quote_variant_both');
  end if;
  update public.quote_items qi set approved = (qi.id = any (p_ids)) where qi.quote_id = p_quote_id;
  select (count(*) filter (where qi.option_group is null) + count(distinct qi.option_group))::int,
         (count(*) filter (where qi.approved))::int,
         coalesce(sum(qi.price) filter (where qi.approved), 0)
    into choices, approved, total
  from public.quote_items qi where qi.quote_id = p_quote_id;
  return next;
end
$$;
revoke execute on function public.apply_quote_answer(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
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
  select a.choices, a.approved, a.total into v_lines, v_approved, v_total
  from public.apply_quote_answer(v_quote.id, v_ids) a;

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

create or replace function public.shop_decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
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
  v_seen := public.request_begin(p_request_id, 'shop_decide_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  -- A client with an account answers in the app.
  if v.source <> 'shop' or v.client_id is not null then
    perform public.fail('not_allowed');
  end if;
  perform public.require_status(v, 'quote_sent');

  v_quote := public.current_sent_quote(v.id);
  if v_quote.id is distinct from p_quote_id then
    perform public.fail('quote_changed');
  end if;
  select a.choices, a.approved, a.total into v_lines, v_approved, v_total
  from public.apply_quote_answer(v_quote.id, v_ids) a;

  if v_approved = 0 then
    update public.quotes set status = 'refused', total_approved = 0, decided_at = now(), decided_by = 'shop'
    where id = v_quote.id;
    update public.bookings set status = 'quote_refused', cost = v_quote.inspection_fee
    where id = v.id returning * into v;
    v_event := 'quote_refused';
    v_params := jsonb_build_object('quote_id', v_quote.id, 'inspection_fee', v_quote.inspection_fee);
  else
    update public.quotes
      set status = case when v_approved = v_lines then 'accepted' else 'partially_accepted' end,
          total_approved = v_total, decided_at = now(), decided_by = 'shop'
    where id = v_quote.id;
    update public.bookings set status = 'approved' where id = v.id returning * into v;
    v_event := case when v_approved = v_lines then 'quote_accepted' else 'quote_partially_accepted' end;
    v_params := jsonb_build_object('quote_id', v_quote.id, 'total', v_total, 'total_sent', v_quote.total_sent);
  end if;

  perform public.post_booking_event(v, v_event, 'shop', v_params);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- The shop's lists show which variant each line is.
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
      'inspection_fee', v_shop.inspection_fee),
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
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved,
                  'option_group', qi.option_group, 'variant', qi.variant, 'brand', qi.brand)
                order by qi.position)
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
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved,
                  'option_group', qi.option_group, 'variant', qi.variant, 'brand', qi.brand)
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

-- The old line check is replaced by clean_quote_lines.
drop function public.clean_quote_items(jsonb);

update public.schema_version set version = 78;
