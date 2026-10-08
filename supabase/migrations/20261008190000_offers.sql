-- Offers (Eduard, 8 Oct).
--  * The new-client offer gets an optional last day (new_client_offer_until: for appointments up to
--    that day, Bucharest) and an optional list of services (new_client_offer_services; null = all):
--    it applies when one of the booked services is in the list.
--  * A new offer for the quieter days (quiet_day_offer 5/10/15 % on quiet_days, weekdays 0–6,
--    0 = Sunday): for bookings the client makes in the app on one of those days. The booking steps
--    show "-10%" on those days while they have places; a full day is not bookable, so it is gone.
--  * Common rules: the database writes the percent on the booking when it is created
--    (offer_percent, and which offer it was: offer_kind), never the browser. Offers do not add up:
--    the larger one applies, at most 15 %. A rescheduled booking keeps its promise. Only the owner
--    changes the offers (column grants + shops_update_owner).

alter table public.shops
  add column new_client_offer_until date,
  add column new_client_offer_services text[]
    check (new_client_offer_services is null or cardinality(new_client_offer_services) between 1 and 200),
  add column quiet_day_offer smallint check (quiet_day_offer in (5, 10, 15)),
  add column quiet_days smallint[] not null default '{}'
    check (quiet_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(quiet_days) <= 7);
grant update (new_client_offer_until, new_client_offer_services, quiet_day_offer, quiet_days) on public.shops to authenticated;

alter table public.bookings
  add column offer_kind text check (offer_kind in ('new_client', 'quiet_day'));
update public.bookings set offer_kind = 'new_client' where offer_percent is not null and offer_kind is null;

-- A last day never in the past when it is set; services the shop offers; days for a quiet-day offer.
create function public.shops_check_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.new_client_offer_until is not null
     and new.new_client_offer_until is distinct from (case when tg_op = 'UPDATE' then old.new_client_offer_until end)
     and new.new_client_offer_until < public.bucharest_today() then
    perform public.fail('field_invalid', jsonb_build_object('field', 'new_client_offer_until'));
  end if;
  if new.new_client_offer_services is not null then
    select array_agg(distinct x order by x) into new.new_client_offer_services
    from unnest(new.new_client_offer_services) x;
    if exists (select 1 from unnest(new.new_client_offer_services) x
               where not exists (select 1 from public.services s where s.id = x)) then
      perform public.fail('field_invalid', jsonb_build_object('field', 'new_client_offer_services'));
    end if;
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into new.quiet_days from unnest(new.quiet_days) d;
  if new.quiet_day_offer is not null and cardinality(new.quiet_days) = 0 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'quiet_days'));
  end if;
  return new;
end
$$;
create trigger shops_check_offers
  before insert or update of new_client_offer_until, new_client_offer_services, quiet_day_offer, quiet_days on public.shops
  for each row execute function public.shops_check_offers();

-- The offer a booking gets: the larger of the new-client offer (still running on that day, for one
-- of the services, a new client) and the quiet-day offer (a booking made in the app on one of
-- those days), at most 15 %. Not callable from the API.
create function public.booking_offer(p_shop_id uuid, p_client_id uuid, p_plate_norm text, p_date date,
                                     p_services text[], p_source text, p_except uuid default null)
returns table (percent int, kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.shops%rowtype;
  v_new int;
  v_quiet int;
begin
  select * into v from public.shops where id = p_shop_id;
  if not found or p_client_id is null then
    return;
  end if;
  if v.new_client_offer is not null
     and (v.new_client_offer_until is null or p_date <= v.new_client_offer_until)
     and (v.new_client_offer_services is null or v.new_client_offer_services && coalesce(p_services, '{}'))
     and public.is_new_client(p_shop_id, p_client_id, p_plate_norm, p_except) then
    v_new := v.new_client_offer;
  end if;
  if v.quiet_day_offer is not null and coalesce(p_source, 'app') = 'app'
     and extract(dow from p_date)::smallint = any (v.quiet_days) then
    v_quiet := v.quiet_day_offer;
  end if;
  if v_new is null and v_quiet is null then
    return;
  end if;
  if coalesce(v_quiet, 0) > coalesce(v_new, 0) then
    return query select least(v_quiet, 15), 'quiet_day'::text;
  else
    return query select least(v_new, 15), 'new_client'::text;
  end if;
end
$$;
revoke execute on function public.booking_offer(uuid, uuid, text, date, text[], text, uuid) from public, anon, authenticated;

-- Whatever path creates a booking, the database writes the promise (the browser cannot).
create or replace function public.bookings_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.offer_percent := null;
  new.offer_kind := null;
  select o.percent, o.kind into new.offer_percent, new.offer_kind
  from public.booking_offer(new.shop_id, new.client_id, nullif(new.car_snapshot->>'plate_norm', ''), new.date,
                            array[new.service_id] || coalesce(new.extra_service_ids, '{}'), new.source, new.id) o;
  return new;
end
$$;

-- An offer that ended is no longer shown.
create or replace function public.new_client_offers(p_shop_ids uuid[])
returns table (shop_id uuid, percent int)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.new_client_offer
  from public.shops s
  where s.id = any (p_shop_ids[1:100])
    and s.new_client_offer is not null
    and (s.new_client_offer_until is null or s.new_client_offer_until >= public.bucharest_today())
    and public.is_shop_public(s.id)
    and public.is_new_client(s.id, auth.uid(), null)
$$;

-- Everything the cards, the shop page and the booking steps need: the new-client offer the caller
-- would get (with its last day and its services) and the quiet-day offer. Public shops only.
create function public.shop_offers(p_shop_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'shop_id', s.id,
    'new_client', case
      when s.new_client_offer is not null
        and (s.new_client_offer_until is null or s.new_client_offer_until >= public.bucharest_today())
        and public.is_new_client(s.id, auth.uid(), null)
      then jsonb_build_object('percent', s.new_client_offer, 'until', s.new_client_offer_until,
        'services', case when s.new_client_offer_services is null then null
                         else public.service_names(s.new_client_offer_services) end) end,
    'quiet_day', case when s.quiet_day_offer is not null and cardinality(s.quiet_days) > 0
      then jsonb_build_object('percent', s.quiet_day_offer, 'days', to_jsonb(s.quiet_days)) end)), '[]'::jsonb)
  from public.shops s
  where auth.uid() is not null
    and s.id = any (p_shop_ids[1:100])
    and public.is_shop_public(s.id)
    and (s.new_client_offer is not null or s.quiet_day_offer is not null)
$$;
revoke execute on function public.shop_offers(uuid[]) from public, anon;
grant execute on function public.shop_offers(uuid[]) to authenticated;

-- The shop's list carries which offer was promised (the card and the quote form say it).
CREATE OR REPLACE FUNCTION public.list_shop_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved)
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
$$;


update public.schema_version set version = 67;
