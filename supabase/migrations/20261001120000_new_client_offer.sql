-- New-client offers (T23, ARCHITECTURE §8b): a shop may promise a discount on labor for a client's
-- first booking at that shop. The shop pays for it; the platform only shows it and remembers it on
-- the booking. It never changes the search order (the weighted rating alone, rule 12).

-- The percentage the owner chose (null = no offer). Owner only: shops_update_owner (staff_rights).
alter table public.shops add column new_client_offer int
  check (new_client_offer in (5, 10, 15, 20, 25, 30));
grant update (new_client_offer) on public.shops to authenticated;

-- What the booking was promised when it was made. Set by the trigger below only; the browser has
-- no write on bookings. Changing or removing the shop's offer later keeps a promise already made.
alter table public.bookings add column offer_percent int check (offer_percent between 1 and 100);

-- A client is new at a shop until they have one booking there that was not declined, canceled
-- or left to expire (a pending one counts, so two requests at once get one discount). The same
-- license plate under another account counts too.
create function public.is_new_client(p_shop_id uuid, p_client_id uuid, p_plate_norm text, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_client_id is not null and not exists (
    select 1 from public.bookings b
    where b.shop_id = p_shop_id
      and b.status not in ('declined', 'cancelled', 'expired')
      and b.id is distinct from p_except
      and (b.client_id = p_client_id
        or (p_plate_norm is not null and b.car_snapshot->>'plate_norm' = p_plate_norm))
  )
$$;
revoke execute on function public.is_new_client(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Whatever path creates a booking, it carries the shop's offer when the client is new there.
create function public.bookings_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.offer_percent := null;
  if new.client_id is not null then
    select s.new_client_offer into new.offer_percent from public.shops s where s.id = new.shop_id;
    if new.offer_percent is not null
       and not public.is_new_client(new.shop_id, new.client_id, nullif(new.car_snapshot->>'plate_norm', ''), new.id) then
      new.offer_percent := null;
    end if;
  end if;
  return new;
end
$$;
create trigger bookings_offer before insert on public.bookings
  for each row execute function public.bookings_offer();

-- The offers the caller would get now, for the shops on screen (search cards, the shop page, the
-- booking form). Public shops only; at most 100 at a time.
create function public.new_client_offers(p_shop_ids uuid[])
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
    and public.is_shop_public(s.id)
    and public.is_new_client(s.id, auth.uid(), null)
$$;
revoke execute on function public.new_client_offers(uuid[]) from public, anon;
grant execute on function public.new_client_offers(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The shop's bookings carry the promise, so the quote can include it.
-- ---------------------------------------------------------------------------------------------
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
            where x.client_id = b.client_id and x.status = 'no_show'
              and x.date > public.bucharest_today() - 90) end,
          'offer_percent', b.offer_percent,
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
$function$;

update public.schema_version set version = 42;
