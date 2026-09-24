-- T03 · 3/3 — Messages, read markers, reviews (write, reply, report), favorites, search.
-- ARCHITECTURE §2 (Messages, reviews), §5, §6, §8.

-- ---------------------------------------------------------------------------------------------
-- Text folding for search: lower case, Romanian and common Latin diacritics removed, so "frane"
-- finds "Frâne" and "brasov" finds "Brașov" (both comma and cedilla forms of ș ț).
-- ---------------------------------------------------------------------------------------------
create function public.fold_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(p),
                   'ăâîșşțţáàäãåéèëêíìïóòöôõőúùüûűçñ',
                   'aaisstt' || 'aaaaa' || 'eeee' || 'iii' || 'oooooo' || 'uuuuu' || 'cn')
$$;

-- ---------------------------------------------------------------------------------------------
-- send_message — a user message in a thread the caller belongs to. Only between a client and a
-- shop that have at least one booking together; at most N messages per sender per thread per
-- hour (platform_settings.limits.messages_per_thread_per_hour, default 30).
-- ---------------------------------------------------------------------------------------------
create function public.send_message(p_thread_id uuid, p_body text, p_request_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_thread public.threads%rowtype;
  v_body text := btrim(p_body);
  v_is_client boolean;
  v_msg public.messages%rowtype;
  v_limit int := public.app_limit('messages_per_thread_per_hour', 30);
  v_params jsonb;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'send_message');
  if v_seen is not null then
    return jsonb_populate_record(null::public.messages, v_seen);
  end if;

  select * into v_thread from public.threads where id = p_thread_id for no key update;
  if not found then
    perform public.fail('thread_not_found');
  end if;
  v_is_client := v_thread.client_id = v_me.id;
  if not v_is_client and not public.is_shop_member(v_thread.shop_id) then
    perform public.fail('not_allowed');
  end if;
  if coalesce(v_body, '') = '' then
    perform public.fail('message_empty');
  end if;
  if char_length(v_body) > 4000 then
    perform public.fail('message_too_long');
  end if;
  if not exists (select 1 from public.bookings b
                 where b.shop_id = v_thread.shop_id and b.client_id = v_thread.client_id) then
    perform public.fail('no_booking_together');
  end if;
  if (select count(*) from public.messages m
      where m.thread_id = v_thread.id and m.kind = 'user' and m.sender_id = v_me.id
        and m.created_at > now() - interval '1 hour') >= v_limit then
    perform public.fail('limit_messages', jsonb_build_object('limit', v_limit));
  end if;

  insert into public.messages (thread_id, kind, sender_id, body)
  values (v_thread.id, 'user', v_me.id, v_body)
  returning * into v_msg;

  if v_is_client then
    update public.threads set last_message_at = v_msg.created_at, client_last_read_at = v_msg.created_at
    where id = v_thread.id;
  else
    update public.threads set last_message_at = v_msg.created_at, shop_last_read_at = v_msg.created_at
    where id = v_thread.id;
  end if;

  v_params := jsonb_build_object(
    'thread_id', v_thread.id,
    'shop_id', v_thread.shop_id,
    'sender_name', case when v_is_client then v_thread.client_name
                        else (select s.name from public.shops s where s.id = v_thread.shop_id) end,
    'preview', left(v_body, 120));
  if v_is_client then
    perform public.notify_shop(v_thread.shop_id, 'new_message', v_params, null);
  else
    perform public.notify_user(v_thread.client_id, 'new_message', v_params, null);
  end if;

  perform public.request_finish(p_request_id, to_jsonb(v_msg));
  return v_msg;
end
$$;

-- mark_thread_read — sets the caller's side read marker (drives the unread badges). Naturally
-- idempotent, so it takes no request id.
create function public.mark_thread_read(p_thread_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.threads%rowtype;
  v_now timestamptz := now();
begin
  perform public.require_caller();
  select * into v_thread from public.threads where id = p_thread_id;
  if not found then
    perform public.fail('thread_not_found');
  end if;
  if v_thread.client_id = auth.uid() then
    update public.threads set client_last_read_at = v_now where id = p_thread_id;
  elsif public.is_shop_member(v_thread.shop_id) then
    update public.threads set shop_last_read_at = v_now where id = p_thread_id;
  else
    perform public.fail('not_allowed');
  end if;
  return v_now;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Reviews. One per done booking, by its client, within the review window; rating and text are
-- immutable. Shops reply (editable) and report; a reported review stays visible until admin
-- decides (T16a).
-- ---------------------------------------------------------------------------------------------

-- "Andrei Marin" → "Andrei M."; one word stays as is; no name → "Client".
create function public.review_display_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(btrim(p_name), '') = '' then 'Client'
    when array_length(w, 1) = 1 then w[1]
    else w[1] || ' ' || upper(left(w[array_length(w, 1)], 1)) || '.'
  end
  from (select regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+') as w) x
$$;

create function public.submit_review(p_booking_id uuid, p_rating int, p_request_id uuid, p_text text default null)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v public.bookings%rowtype;
  v_text text := nullif(btrim(p_text), '');
  v_window int := public.app_limit('review_window_days', 60);
  v_review public.reviews%rowtype;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'submit_review');
  if v_seen is not null then
    return jsonb_populate_record(null::public.reviews, v_seen);
  end if;
  v := public.lock_booking_as_client(p_booking_id);
  perform public.require_status(v, 'done');
  if v.done_at is null or v.done_at < now() - make_interval(days => v_window) then
    perform public.fail('review_window_closed', jsonb_build_object('days', v_window));
  end if;
  if exists (select 1 from public.reviews where booking_id = v.id) then
    perform public.fail('review_exists');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    perform public.fail('rating_invalid');
  end if;
  if char_length(v_text) > 2000 then
    perform public.fail('review_too_long');
  end if;

  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text)
  values (v.id, v.shop_id, v_me.id, public.review_display_name(v_me.name), p_rating, v_text)
  returning * into v_review;

  perform public.notify_shop(v.shop_id, 'new_review', public.booking_event_params(v) ||
    jsonb_build_object('review_id', v_review.id, 'rating', p_rating), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v_review));
  return v_review;
end
$$;

-- Public reply; editable; an empty reply removes it. The client is notified of the first reply.
create function public.reply_review(p_review_id uuid, p_reply text, p_request_id uuid)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_review public.reviews%rowtype;
  v_reply text := nullif(btrim(p_reply), '');
  v_first boolean;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'reply_review');
  if v_seen is not null then
    return jsonb_populate_record(null::public.reviews, v_seen);
  end if;
  select * into v_review from public.reviews where id = p_review_id for no key update;
  if not found or v_review.removed_at is not null then
    perform public.fail('review_not_found');
  end if;
  if not public.is_shop_member(v_review.shop_id) then
    perform public.fail('not_allowed');
  end if;
  if char_length(v_reply) > 2000 then
    perform public.fail('reply_too_long');
  end if;

  v_first := v_review.reply is null and v_reply is not null;
  update public.reviews set reply = v_reply, reply_at = case when v_reply is null then null else now() end
  where id = v_review.id returning * into v_review;

  if v_first then
    perform public.notify_user(v_review.client_id, 'review_reply', jsonb_build_object(
      'review_id', v_review.id, 'booking_id', v_review.booking_id, 'shop_id', v_review.shop_id,
      'shop_name', (select s.name from public.shops s where s.id = v_review.shop_id)), v_review.booking_id);
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v_review));
  return v_review;
end
$$;

-- Report to the admin queue. One report per review; it stays visible until admin decides.
create function public.report_review(p_review_id uuid, p_reason text, p_request_id uuid)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_review public.reviews%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'report_review');
  if v_seen is not null then
    return jsonb_populate_record(null::public.reviews, v_seen);
  end if;
  select * into v_review from public.reviews where id = p_review_id for no key update;
  if not found or v_review.removed_at is not null then
    perform public.fail('review_not_found');
  end if;
  if not public.is_shop_member(v_review.shop_id) then
    perform public.fail('not_allowed');
  end if;
  if p_reason is null or p_reason not in ('fake', 'abusive', 'wrong_shop', 'personal_data') then
    perform public.fail('report_reason_invalid');
  end if;
  if v_review.report_status is not null then
    perform public.fail('already_reported');
  end if;

  update public.reviews
    set report_reason = p_reason, reported_at = now(), report_status = 'pending'
  where id = v_review.id returning * into v_review;
  perform public.request_finish(p_request_id, to_jsonb(v_review));
  return v_review;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- toggle_favorite — adds or removes a shop from the client's favorites; returns the new state.
-- ---------------------------------------------------------------------------------------------
create function public.toggle_favorite(p_shop_id uuid, p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_on boolean;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'toggle_favorite');
  if v_seen is not null then
    return v_seen::boolean;
  end if;
  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;

  delete from public.favorites where client_id = v_me.id and shop_id = p_shop_id;
  if found then
    v_on := false;
  else
    if not exists (select 1 from public.shops where id = p_shop_id) or not public.can_read_shop(p_shop_id) then
      perform public.fail('shop_not_found');
    end if;
    insert into public.favorites (client_id, shop_id) values (v_me.id, p_shop_id);
    v_on := true;
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v_on));
  return v_on;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- search_shops — public shops only (§5), ordered by the weighted rating only (§8): score desc,
-- review count desc, name asc. Filters narrow, never reorder. "distance" sorts by straight-line
-- distance from (p_lat, p_lng), which is used for this query only and never stored.
--   p_q         matches shop name, city, or any offered service or its category (RO or EN),
--               diacritic-insensitive; for services the query's last vowel is optional, so "frane"
--               (plural) finds "Plăcuțe de frână" and "anvelopa" finds "Anvelope & Jante"
--   p_category  shops offering at least one service in that category
--   p_city      exact city (diacritic-insensitive)
-- matched_service_* names the service that matched when the shop was found by service or by the
-- category filter rather than by its name or city ("Oferă: Vulcanizare").
-- ---------------------------------------------------------------------------------------------
create function public.search_shops(
  p_q text default null,
  p_category text default null,
  p_city text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_sort text default 'rating'
)
returns table (
  shop_id uuid,
  name text,
  city text,
  street text,
  logo_url text,
  latitude double precision,
  longitude double precision,
  review_count int,
  average numeric,
  weighted_score numeric,
  service_count int,
  matched_service_id text,
  matched_service_ro text,
  matched_service_en text,
  distance_km double precision,
  is_favorite boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q text := public.fold_text(nullif(btrim(p_q), ''));
  v_cat text := nullif(btrim(p_category), '');
  v_city text := public.fold_text(nullif(btrim(p_city), ''));
  v_lat double precision := case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end;
  v_lng double precision := case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end;
  v_stem text;
  v_by_distance boolean;
begin
  perform public.require_caller();
  v_by_distance := p_sort = 'distance' and v_lat is not null;
  v_stem := case when char_length(v_q) >= 4 and right(v_q, 1) in ('a', 'e', 'i', 'o', 'u')
                 then left(v_q, -1) else v_q end;

  return query
  with offered as (
    select ss.shop_id, sv.id, sv.name_ro, sv.name_en, sv.category_key,
           public.fold_text(sv.name_ro || ' ' || sv.name_en || ' ' || c.name_ro || ' ' || c.name_en) as haystack,
           row_number() over (partition by ss.shop_id order by c.position, sv.position) as ord
    from public.shop_services ss
    join public.services sv on sv.id = ss.service_id and sv.enabled
    join public.service_categories c on c.key = sv.category_key
  ),
  shops as (
    select s.*,
           v_q is not null and (position(v_q in public.fold_text(s.name)) > 0
                                or position(v_q in public.fold_text(s.city)) > 0) as text_hit
    from public.shops s
    where public.is_shop_public(s.id)
      and (v_city is null or public.fold_text(btrim(s.city)) = v_city)
      and (v_cat is null or exists (select 1 from offered o where o.shop_id = s.id and o.category_key = v_cat))
  ),
  hits as (
    select sh.*, m.id as m_id, m.name_ro as m_name_ro, m.name_en as m_name_en
    from shops sh
    left join lateral (
      select o.id, o.name_ro, o.name_en from offered o
      where o.shop_id = sh.id
        and case
              when v_q is not null and not sh.text_hit then position(v_stem in o.haystack) > 0
              else o.category_key = v_cat
            end
      order by (v_cat is not null and o.category_key = v_cat) desc,
               position(v_stem in public.fold_text(o.name_ro || ' ' || o.name_en)) > 0 desc, o.ord
      limit 1
    ) m on true
  )
  select
    h.id, h.name, h.city, h.street, h.logo_url, h.latitude, h.longitude,
    r.review_count, r.average, r.weighted_score,
    (select count(*)::int from offered o where o.shop_id = h.id),
    h.m_id, h.m_name_ro, h.m_name_en,
    case when v_lat is not null and h.latitude is not null and h.longitude is not null then
      2 * 6371 * asin(sqrt(
        power(sin(radians(h.latitude - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(h.latitude)) * power(sin(radians(h.longitude - v_lng) / 2), 2)))
    end,
    exists (select 1 from public.favorites f where f.client_id = auth.uid() and f.shop_id = h.id)
  from hits h
  join public.shop_ratings r on r.shop_id = h.id
  where v_q is null or h.text_hit or h.m_id is not null
  order by
    case when v_by_distance then
      2 * 6371 * asin(sqrt(
        power(sin(radians(h.latitude - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(h.latitude)) * power(sin(radians(h.longitude - v_lng) / 2), 2)))
    end asc nulls last,
    r.weighted_score desc, r.review_count desc, lower(h.name) asc, h.id
  limit 500;
end
$$;

grant execute on function
  public.send_message(uuid, text, uuid),
  public.mark_thread_read(uuid),
  public.submit_review(uuid, int, uuid, text),
  public.reply_review(uuid, text, uuid),
  public.report_review(uuid, text, uuid),
  public.toggle_favorite(uuid, uuid),
  public.search_shops(text, text, text, double precision, double precision, text)
to authenticated;

update public.schema_version set version = 9;
