-- Bookings added by the shop (T29, Eduard 4 Oct): a client who calls or walks in has no account.
-- The shop types the booking in (name, phone, optional email, car, day and time); it takes its place
-- in the day like any other, starts confirmed and goes through the same steps. The shop records the
-- client's answer to the quote. The client gets an SMS (and an email when given) with a link; signing
-- in with the same verified phone or email takes the booking (and every other one the shops added
-- for that phone) into the account, with the car in the garage.
--   * bookings.source ('app' | 'shop'), client_email, invite_token, invite_sent_at, claimed_at
--   * quotes.decided_by ('client' | 'shop')
--   * shop_create_booking, shop_decide_quote, invite_preview (no account needed), claim_booking
--   * the outbox carries a `walk_in_invite` without a user: its own phone, email and language
--   * a review of a booking the shop added is flagged for the admin (`shop_added`)

alter table public.bookings
  add column source text not null default 'app' check (source in ('app', 'shop')),
  add column client_email text check (client_email is null or char_length(client_email) <= 254),
  add column invite_token text unique,
  add column invite_sent_at timestamptz,
  add column claimed_at timestamptz;

alter table public.quotes add column decided_by text check (decided_by in ('client', 'shop'));

alter table public.notification_events drop constraint notification_events_recipient;
alter table public.notification_events add constraint notification_events_recipient
  check (user_id is not null or event in ('review_reported', 'admin_digest', 'walk_in_invite'));

create or replace function public.claim_notifications(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  update public.notification_events
    set processed_at = now(), locked_until = null,
        last_error = case when attempts >= 5 then coalesce(last_error, 'gave_up') else 'stale' end
  where processed_at is null
    and (locked_until is null or locked_until < now())
    and (attempts >= 5 or coalesce(not_before, created_at) < now() - interval '12 hours');

  with picked as (
    select e.id from public.notification_events e
    where e.processed_at is null and (e.locked_until is null or e.locked_until < now())
      and (e.not_before is null or e.not_before <= now())
    order by coalesce(e.not_before, e.created_at), e.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), claimed as (
    update public.notification_events e
      set attempts = e.attempts + 1, locked_until = now() + interval '2 minutes'
    from picked where e.id = picked.id
    returning e.id
  )
  select array_agg(id) into v_ids from claimed;

  return jsonb_build_object(
    'texts', coalesce((select ps.notification_texts from public.platform_settings ps where ps.id = 1), '{}'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'user_id', e.user_id,
        'event', e.event,
        'params', e.params,
        'booking_id', e.booking_id,
        'channels', to_jsonb(array(select c from unnest(e.channels) c where not (c = any (e.channels_done)))),
        'created_at', e.created_at,
        'attempts', e.attempts,
        -- An invitation to a client without an account (T29) carries its own address and language.
        'lang', coalesce(p.lang, case when e.event = 'walk_in_invite' then e.params->>'lang' end, 'ro'),
        'role', coalesce(p.role, case when e.event = 'walk_in_invite' then 'client' else 'admin' end),
        'email', case when e.event = 'walk_in_invite' then
                        case when 'email' = any (e.channels) then nullif(e.params->>'email', '') end
                      when 'email' = any (e.channels) and p.deleted_at is null
                      then (select u.email from auth.users u where u.id = e.user_id) end,
        'phone', case when e.event = 'walk_in_invite' then
                        case when 'sms' = any (e.channels) then nullif(e.params->>'phone', '') end
                      when 'sms' = any (e.channels) and p.deleted_at is null
                           and (p.phone_verified_at is not null or p.phone_verified_by_admin)
                      then p.phone end,
        'service', (select jsonb_build_object('ro', s.name_ro, 'en', s.name_en)
                    from public.services s where s.id = e.params->>'service_id'),
        'devices', coalesce((
          select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', ps.subscription->'keys',
                                              'fcm_token', ps.subscription->>'fcm_token'))
          from public.push_subscriptions ps where ps.user_id = e.user_id), '[]'::jsonb)
      ) order by e.created_at)
      from public.notification_events e
      left join public.profiles p on p.id = e.user_id
      where e.id = any (v_ids)), '[]'::jsonb));
end
$$;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Adding a booking
-- ---------------------------------------------------------------------------------------------
create function public.shop_create_booking(
  p_service_id text,
  p_date date,
  p_slot time,
  p_client_name text,
  p_client_phone text,
  p_car jsonb,
  p_request_id uuid,
  p_client_email text default null,
  p_extra_service_ids text[] default '{}',
  p_note text default null,
  p_send_invite boolean default true,
  p_client_lang text default 'ro'
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop_id uuid;
  v_shop public.shops%rowtype;
  v_booking public.bookings%rowtype;
  v_extra text[] := coalesce(p_extra_service_ids, '{}');
  v_note text := nullif(btrim(p_note), '');
  v_name text := nullif(btrim(p_client_name), '');
  -- 0745 111 222, +40 745 111 222, 0040745111222 → 40745111222.
  v_digits text := regexp_replace(regexp_replace(regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g'),
                                                 '^00', ''), '^0([237])', '40\1');
  v_email text := nullif(lower(btrim(coalesce(p_client_email, ''))), '');
  v_lang text := case when p_client_lang = 'en' then 'en' else 'ro' end;
  v_year int;
  v_plate text;
  v_vin text;
  v_snapshot jsonb;
  v_channels text[];
  v_invite boolean;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'shop_create_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v_shop_id := public.require_my_shop();
  -- One writer at a time per shop, so capacity cannot be raced (§4).
  select * into v_shop from public.shops where id = v_shop_id for no key update;
  if not public.is_shop_public(v_shop_id) then
    perform public.fail('shop_unavailable');
  end if;

  if not exists (
    select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
    where ss.shop_id = v_shop_id and ss.service_id = p_service_id and sv.enabled
  ) then
    perform public.fail('service_unavailable');
  end if;
  if cardinality(v_extra) > 4 then
    perform public.fail('too_many_services', jsonb_build_object('limit', 5));
  end if;
  if p_service_id = any (v_extra)
     or cardinality(v_extra) <> (select count(distinct x) from unnest(v_extra) x)
     or exists (
       select 1 from unnest(v_extra) x
       where x is null or not exists (
         select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
         where ss.shop_id = v_shop_id and ss.service_id = x and sv.enabled)) then
    perform public.fail('service_unavailable');
  end if;

  if v_name is null or char_length(v_name) > 100 then
    perform public.fail('client_name_required');
  end if;
  if v_digits is null or v_digits !~ '^40[237][0-9]{8}$' then
    perform public.fail('phone_invalid');
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    perform public.fail('email_invalid');
  end if;
  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;

  -- The car: make, model and plate (the plate ties the job to the car's history).
  if p_car is null or jsonb_typeof(p_car) <> 'object'
     or coalesce(btrim(p_car->>'make'), '') = '' or coalesce(btrim(p_car->>'model'), '') = '' then
    perform public.fail('car_required');
  end if;
  v_plate := nullif(btrim(p_car->>'plate'), '');
  if v_plate is null then
    perform public.fail('car_plate_required');
  end if;
  if char_length(v_plate) > 20 then
    perform public.fail('car_plate_invalid');
  end if;
  v_year := case when coalesce(p_car->>'year', '') ~ '^\d{4}$' then (p_car->>'year')::int end;
  if coalesce(p_car->>'year', '') <> '' and (v_year is null or v_year not between 1900 and 2100) then
    perform public.fail('car_year_invalid');
  end if;
  v_vin := public.normalize_code(p_car->>'vin');
  if v_vin is not null and not public.is_valid_vin(v_vin) then
    perform public.fail('car_vin_invalid');
  end if;
  if char_length(btrim(p_car->>'make')) > 60 or char_length(btrim(p_car->>'model')) > 60 then
    perform public.fail('car_invalid');
  end if;
  v_snapshot := jsonb_build_object(
    'make', btrim(p_car->>'make'), 'model', btrim(p_car->>'model'), 'year', v_year, 'plate', v_plate,
    'plate_norm', nullif(upper(regexp_replace(v_plate, '[\s-]', '', 'g')), ''), 'vin', v_vin);

  -- The shop's own rules: no minimum notice, no maximum advance; the place must be free.
  perform public.check_slot(v_shop, p_date, p_slot, null, false);

  insert into public.bookings (
    shop_id, client_id, service_id, extra_service_ids, client_name, client_phone, client_lang, car_snapshot,
    date, slot, note, status, confirmed_at, source, client_email, invite_token
  ) values (
    v_shop_id, null, p_service_id, v_extra, v_name, '+' || v_digits, v_lang, v_snapshot,
    p_date, p_slot, v_note, 'confirmed', now(), 'shop', v_email,
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
  )
  returning * into v_booking;

  -- The invitation: an SMS (the phone is required) and an email when there is one. At most
  -- `walk_in_invites_per_day` per shop in 24 hours, so a mistake cannot send hundreds.
  v_invite := coalesce(p_send_invite, true)
    and (select count(*) from public.bookings b
         where b.shop_id = v_shop_id and b.invite_sent_at > now() - interval '24 hours')
        < public.app_limit('walk_in_invites_per_day', 30);
  if v_invite then
    v_channels := array['sms'] || case when v_email is not null then array['email'] else '{}'::text[] end;
    insert into public.notification_events (user_id, event, params, booking_id, channels)
    values (null, 'walk_in_invite',
            public.booking_event_params(v_booking) || jsonb_build_object(
              'phone', v_booking.client_phone, 'email', v_email, 'lang', v_lang,
              'token', v_booking.invite_token, 'shop_name', v_shop.name, 'shop_id', v_shop_id),
            v_booking.id, v_channels);
    update public.bookings set invite_sent_at = now() where id = v_booking.id returning * into v_booking;
  end if;

  perform public.request_finish(p_request_id, to_jsonb(v_booking));
  return v_booking;
end
$$;
revoke execute on function public.shop_create_booking(text, date, time, text, text, jsonb, uuid, text, text[], text, boolean, text)
  from public, anon;
grant execute on function public.shop_create_booking(text, date, time, text, text, jsonb, uuid, text, text[], text, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The client's answer to the quote, recorded by the shop (only while no account has the booking)
-- ---------------------------------------------------------------------------------------------
create function public.shop_decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
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
  if exists (select 1 from unnest(v_ids) i
             where not exists (select 1 from public.quote_items qi where qi.id = i and qi.quote_id = v_quote.id)) then
    perform public.fail('quote_item_invalid');
  end if;

  update public.quote_items set approved = (id = any (v_ids)) where quote_id = v_quote.id;
  select count(*), count(*) filter (where approved), coalesce(sum(price) filter (where approved), 0)
    into v_lines, v_approved, v_total
  from public.quote_items where quote_id = v_quote.id;

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
revoke execute on function public.shop_decide_quote(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.shop_decide_quote(uuid, uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The invitation link (/p/<token>): what it is about, without an account and without personal data
-- ---------------------------------------------------------------------------------------------
create function public.invite_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shop_name', s.name,
    'shop_city', s.city,
    'date', b.date,
    'slot', to_char(b.slot, 'HH24:MI'),
    'status', b.status,
    'services', public.service_names(array[b.service_id] || b.extra_service_ids),
    'car', jsonb_build_object('make', b.car_snapshot->>'make', 'model', b.car_snapshot->>'model'),
    'claimed', b.client_id is not null,
    'mine', b.client_id is not null and b.client_id = auth.uid())
  from public.bookings b join public.shops s on s.id = b.shop_id
  where b.source = 'shop' and b.invite_token = p_token and char_length(coalesce(p_token, '')) = 16
$$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Taking it into the account: the same phone (verified) or the same email (verified)
-- ---------------------------------------------------------------------------------------------
create function public.claim_booking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v public.bookings%rowtype;
  v_my_email text;
  v_phone_ok boolean;
  v_email_ok boolean;
  v_count int := 0;
  r public.bookings%rowtype;
  v_car uuid;
begin
  v_me := public.require_caller();
  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  select * into v from public.bookings
  where source = 'shop' and invite_token = p_token and char_length(coalesce(p_token, '')) = 16
  for no key update;
  if not found then
    perform public.fail('invite_not_found');
  end if;
  if v.client_id = v_me.id then
    return jsonb_build_object('booking_id', v.id, 'claimed', 0);
  end if;
  if v.client_id is not null then
    perform public.fail('invite_used');
  end if;

  select u.email into v_my_email from auth.users u where u.id = v_me.id;
  v_phone_ok := (v_me.phone_verified_at is not null or v_me.phone_verified_by_admin)
    and public.account_fingerprint('phone', v_me.phone) = public.account_fingerprint('phone', v.client_phone);
  v_email_ok := v.client_email is not null and v_me.email_verified_at is not null
    and lower(v_my_email) = v.client_email;
  if not v_phone_ok and not v_email_ok then
    if public.account_fingerprint('phone', v_me.phone) = public.account_fingerprint('phone', v.client_phone) then
      perform public.fail('phone_not_verified');
    end if;
    perform public.fail('invite_mismatch');
  end if;

  -- This booking, and, with the phone verified, every other one shops added for it.
  for r in
    select * from public.bookings b
    where b.source = 'shop' and b.client_id is null
      and (b.id = v.id
           or (v_phone_ok and public.account_fingerprint('phone', b.client_phone)
                              = public.account_fingerprint('phone', v_me.phone)))
    order by b.created_at
    for no key update
  loop
    -- The car into the garage, once per plate.
    select c.id into v_car from public.cars c
    where c.owner_id = v_me.id and c.plate_norm = r.car_snapshot->>'plate_norm' limit 1;
    if v_car is null then
      insert into public.cars (owner_id, make, model, year, plate, vin)
      values (v_me.id, r.car_snapshot->>'make', r.car_snapshot->>'model', (r.car_snapshot->>'year')::int,
              r.car_snapshot->>'plate', r.car_snapshot->>'vin')
      returning id into v_car;
    end if;
    update public.bookings
      set client_id = v_me.id, car_id = v_car, claimed_at = now(), client_lang = v_me.lang
    where id = r.id;
    perform public.ensure_thread(r.shop_id, v_me.id);
    v_count := v_count + 1;
    v_car := null;
  end loop;

  return jsonb_build_object('booking_id', v.id, 'claimed', v_count);
end
$$;
revoke execute on function public.claim_booking(text) from public, anon;
grant execute on function public.claim_booking(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The shop's list says which bookings it added; reviews of those are flagged for the admin
-- ---------------------------------------------------------------------------------------------
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

create or replace function public.review_signals(p_review public.reviews)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select * from public.bookings where id = p_review.booking_id),
  phones as (
    select public.account_fingerprint('phone', x) as fp
    from public.shops s,
         lateral (values (s.phone), (s.phone2)) v(x)
    where s.id = p_review.shop_id and x is not null
    union
    select public.account_fingerprint('phone', p.phone)
    from public.shop_staff st join public.profiles p on p.id = st.user_id
    where st.shop_id = p_review.shop_id and p.phone is not null
  )
  select array_remove(array[
    case when exists (select 1 from b, phones
                      where phones.fp is not null
                        and phones.fp = public.account_fingerprint('phone', coalesce(b.client_phone,
                          (select p.phone from public.profiles p where p.id = p_review.client_id))))
         then 'same_phone' end,
    case when exists (select 1 from b where b.done_at is not null and b.done_at - b.created_at < interval '3 hours')
         then 'quick_job' end,
    case when (select count(*) from public.reviews r
               where r.shop_id = p_review.shop_id
                 and r.created_at > p_review.created_at - interval '24 hours'
                 and r.created_at <= p_review.created_at) >= 5
         then 'burst' end,
    case when exists (select 1 from public.profiles p
                      where p.id = p_review.client_id and p.created_at > p_review.created_at - interval '7 days')
         then 'new_account' end,
    -- The shop typed this booking in itself (T29): its review is always worth a look.
    case when exists (select 1 from b where b.source = 'shop') then 'shop_added' end
  ], null)
$$;
revoke execute on function public.review_signals(public.reviews) from public, anon, authenticated;

create or replace function public.is_suspect_review(p_signals text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select 'same_phone' = any (p_signals) or 'quick_job' = any (p_signals) or 'shop_added' = any (p_signals)
         or cardinality(p_signals) >= 2
$$;

-- ---------------------------------------------------------------------------------------------
-- No-shows of bookings the shop added never count against the client (Eduard): the client did
-- not book them. The same three counters as before, each limited to bookings made in the app.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_no_show_count(p_client_id uuid, p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_reader();
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
    where b.client_id = p_client_id and b.status = 'no_show' and b.source = 'app'
      and b.date > public.bucharest_today() - least(greatest(coalesce(p_days, 90), 1), 3650)
  );
end
$function$;

create or replace function public.bookings_phone_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := coalesce((select (ps.limits->>'no_shows_before_phone')::int from public.platform_settings ps where ps.id = 1), 2);
  v_count int;
begin
  if new.client_id is null or auth.uid() is distinct from new.client_id then
    return new;
  end if;
  if exists (select 1 from public.profiles p
             where p.id = new.client_id and (p.phone_verified_at is not null or p.phone_verified_by_admin)) then
    return new;
  end if;
  select count(*) into v_count from public.bookings b
  where b.client_id = new.client_id and b.status = 'no_show' and b.source = 'app'
    and b.date > public.bucharest_today() - 90;
  if v_count >= v_limit then
    perform public.fail('phone_verification_required', jsonb_build_object('no_shows', v_count));
  end if;
  return new;
end
$$;
revoke execute on function public.bookings_phone_rule() from public, anon, authenticated;

create or replace function public.instant_for_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.bookings b
    where b.client_id = p_client_id and b.status = 'no_show' and b.source = 'app'
      and b.date > public.bucharest_today() - 90)
$$;
revoke execute on function public.instant_for_client(uuid) from public, anon, authenticated;

update public.schema_version set version = 58;
