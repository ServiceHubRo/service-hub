-- T24 — Notifications that keep people coming back (ARCHITECTURE §9, §10).
--
-- · Quiet hours: an event nobody caused just now (a reminder, an expiry, a payment notice, a tip)
--   that is written between 21:00 and 09:00 in Bucharest waits until 09:00 (notification_events.
--   not_before). What a person just did (a quote sent, the car ready, a message) still goes at once.
--   The hours are platform limits (quiet_hours_start / quiet_hours_end; equal = no quiet hours).
-- · Tips and offers (push only, at most promo_per_week a week per person, only to someone with a
--   device that can show them, each with its switch in Cont):
--     tire_season  — winter tires from 15 Oct, summer tires from 25 Mar, once a season, to clients
--                    with a car in the garage and no tire job booked or done lately (on by default,
--                    like the other reminders about the car: season_reminders);
--     welcome      — 3 and 14 days after sign-up, to a client who has never booked: how to use the
--                    account (on by default: app_tips);
--     favorite_offer — a favorite shop starts (or raises) its new-client offer. An offer is
--                    marketing, so only for clients who turned it on (promo_notifications, off by
--                    default; Privacy Policy §9).
-- · To the shop: a request still without an answer after request_reminder_hours (once), and on
--   the 1st of the month a report of the month before to the owner (push + email; Setări →
--   Notificări turns it off).
-- · Document reminders move from 07:00 to 10:00, with the other reminders for clients.
-- engagement_log keeps what was sent (server only), so nothing goes out twice.

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
update public.platform_settings
  set limits = limits || '{"quiet_hours_start": 21, "quiet_hours_end": 9, "promo_per_week": 2, "request_reminder_hours": 2}'::jsonb
where id = 1;
alter table public.platform_settings alter column limits set default '{
    "active_bookings_per_shop": 3,
    "active_bookings_total": 10,
    "new_bookings_per_24h": 5,
    "messages_per_thread_per_hour": 30,
    "review_window_days": 60,
    "quote_versions_max": 20,
    "quiet_hours_start": 21,
    "quiet_hours_end": 9,
    "promo_per_week": 2,
    "request_reminder_hours": 2
  }'::jsonb;

create or replace function public.limit_range(p_key text)
returns int4range
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'active_bookings_per_shop' then int4range(1, 20, '[]')
    when 'active_bookings_total' then int4range(1, 100, '[]')
    when 'new_bookings_per_24h' then int4range(1, 100, '[]')
    when 'messages_per_thread_per_hour' then int4range(1, 500, '[]')
    when 'review_window_days' then int4range(1, 365, '[]')
    when 'quote_versions_max' then int4range(1, 100, '[]')
    when 'quiet_hours_start' then int4range(0, 23, '[]')
    when 'quiet_hours_end' then int4range(0, 23, '[]')
    when 'promo_per_week' then int4range(0, 7, '[]')
    when 'request_reminder_hours' then int4range(1, 24, '[]')
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

-- The client's switches in Cont: the reminders and tips on by default (like the T19d reminders),
-- the offers only when the client turns them on.
alter table public.profiles
  add column season_reminders boolean not null default true,
  add column app_tips boolean not null default true,
  add column promo_notifications boolean not null default false;
grant update (season_reminders, app_tips, promo_notifications) on public.profiles to authenticated;

-- The owner's switch in Setări → Notificări (shops_update_owner: owner only).
alter table public.shops add column monthly_report boolean not null default true;
grant update (monthly_report) on public.shops to authenticated;

-- What was sent, once per (kind, key). user_id: who got it (counts toward the weekly limit of tips).
create table public.engagement_log (
  kind text not null check (kind in ('tire_season', 'welcome', 'favorite_offer', 'request_waiting', 'monthly_report')),
  key text not null,
  user_id uuid references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (kind, key)
);
create index engagement_log_user_idx on public.engagement_log (user_id, sent_at desc);
alter table public.engagement_log enable row level security;
-- No policies and no grants: written and read only by the jobs below.

-- ---------------------------------------------------------------------------------------------
-- Quiet hours
-- ---------------------------------------------------------------------------------------------
alter table public.notification_events add column not_before timestamptz;

-- When the quiet hours around p_now end (a moment), or null when p_now is not in them.
create function public.quiet_until(p_now timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_limits jsonb := (select ps.limits from public.platform_settings ps where ps.id = 1);
  v_start int := coalesce((v_limits->>'quiet_hours_start')::int, 21);
  v_end int := coalesce((v_limits->>'quiet_hours_end')::int, 9);
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_hour int := extract(hour from v_local)::int;
  v_day date := v_local::date;
begin
  if v_start = v_end then
    return null;
  end if;
  if v_start > v_end then
    -- Over midnight (21 → 9).
    if v_hour >= v_start then
      return ((v_day + 1) + make_time(v_end, 0, 0)) at time zone 'Europe/Bucharest';
    elsif v_hour < v_end then
      return (v_day + make_time(v_end, 0, 0)) at time zone 'Europe/Bucharest';
    end if;
  elsif v_hour >= v_start and v_hour < v_end then
    return (v_day + make_time(v_end, 0, 0)) at time zone 'Europe/Bucharest';
  end if;
  return null;
end
$$;
revoke execute on function public.quiet_until(timestamptz) from public, anon, authenticated;

-- The events no person caused just now: they wait for the morning.
create function public.is_quiet_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('appointment_reminder', 'quote_expiring', 'quote_expired', 'doc_expiry', 'review_request',
    'service_due', 'trial_ending', 'shop_inactive', 'payment_failed', 'invoice_paid', 'referral_reward',
    'referral_revoked', 'broadcast', 'tire_season', 'welcome', 'favorite_offer', 'booking_request_waiting',
    'monthly_report')
$$;

create function public.notification_events_quiet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.not_before is null and new.user_id is not null and public.is_quiet_event(new.event) then
    new.not_before := public.quiet_until(now());
  end if;
  return new;
end
$$;
revoke execute on function public.notification_events_quiet() from public, anon, authenticated;
create trigger notification_events_quiet before insert on public.notification_events
  for each row execute function public.notification_events_quiet();

-- The sweep wakes the dispatcher only for events that are due.
create or replace function public.dispatch_sweep()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.notification_events
    where processed_at is null and (locked_until is null or locked_until < now())
      and (not_before is null or not_before <= now())
  ) then
    return public.kick_dispatcher();
  end if;
  return false;
end
$$;
revoke execute on function public.dispatch_sweep() from public, anon, authenticated;

-- Claims due events only; an event that waited for the morning is old from the morning on.
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
        'lang', coalesce(p.lang, 'ro'),
        'role', coalesce(p.role, 'admin'),
        'email', case when 'email' = any (e.channels) and p.deleted_at is null
                      then (select u.email from auth.users u where u.id = e.user_id) end,
        'phone', case when 'sms' = any (e.channels) and p.deleted_at is null
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
-- Tips and offers to clients
-- ---------------------------------------------------------------------------------------------
-- Sends one tip (push) to a client, once per (kind, key), when the client can see it and has not
-- had promo_per_week of them in the last 7 days. True when it was sent.
create function public.send_tip(p_user uuid, p_kind text, p_key text, p_event text, p_params jsonb,
                                p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := coalesce((select (ps.limits->>'promo_per_week')::int from public.platform_settings ps where ps.id = 1), 2);
begin
  if not exists (select 1 from public.profiles p
                 where p.id = p_user and p.role = 'client' and p.deleted_at is null and not p.suspended) then
    return false;
  end if;
  -- Push only: someone without a device would get nothing (and the outbox would retry).
  if not exists (select 1 from public.push_subscriptions ps where ps.user_id = p_user) then
    return false;
  end if;
  if (select count(*) from public.engagement_log l
      where l.user_id = p_user and l.kind in ('tire_season', 'welcome', 'favorite_offer')
        and l.sent_at > p_now - interval '7 days') >= v_limit then
    return false;
  end if;
  insert into public.engagement_log (kind, key, user_id, sent_at) values (p_kind, p_key, p_user, p_now)
  on conflict do nothing;
  if not found then
    return false;
  end if;
  perform public.notify_user(p_user, p_event, p_params, null);
  return true;
end
$$;
revoke execute on function public.send_tip(uuid, text, text, text, jsonb, timestamptz) from public, anon, authenticated;

-- The tire season p_today is in: winter from 15 Oct to 15 Nov, summer from 25 Mar to 25 Apr.
create function public.tire_season(p_today date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when to_char(p_today, 'MM-DD') between '10-15' and '11-15' then 'winter-' || extract(year from p_today)::int
    when to_char(p_today, 'MM-DD') between '03-25' and '04-25' then 'summer-' || extract(year from p_today)::int
  end
$$;

create function public.send_tire_season_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_season text := public.tire_season(v_today);
  r record;
  v_n int := 0;
begin
  if v_season is null then
    return 0;
  end if;
  for r in
    select p.id,
           (select count(*) from public.cars c where c.owner_id = p.id) as cars,
           (select c.id from public.cars c where c.owner_id = p.id order by c.created_at limit 1) as car_id,
           -- The shop that did the tires last time, while it is still in search.
           (select b.shop_id from public.bookings b
            join public.services sv on sv.id = b.service_id
            where b.client_id = p.id and b.status = 'done' and sv.category_key = 'cat_anv'
              and public.is_shop_public(b.shop_id)
            order by b.done_at desc nulls last limit 1) as shop_id
    from public.profiles p
    where p.role = 'client' and p.deleted_at is null and not p.suspended and p.season_reminders
      and exists (select 1 from public.cars c where c.owner_id = p.id)
      -- Already booked, or done in the last 60 days (any tire service).
      and not exists (
        select 1 from public.bookings b
        where b.client_id = p.id
          and exists (select 1 from public.services sv
                      where sv.category_key = 'cat_anv' and (sv.id = b.service_id or sv.id = any (b.extra_service_ids)))
          and (b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
               or (b.status = 'done' and b.done_at > p_now - interval '60 days')))
      -- The service reminder for tires came lately: one is enough.
      and not exists (
        select 1 from public.client_reminders cr
        join public.bookings b on b.id = cr.booking_id
        join public.services sv on sv.id = b.service_id
        where b.client_id = p.id and cr.kind = 'service' and sv.category_key = 'cat_anv'
          and cr.sent_at > p_now - interval '60 days')
      and not exists (select 1 from public.engagement_log l where l.kind = 'tire_season' and l.key = p.id || ':' || v_season)
  loop
    if public.send_tip(r.id, 'tire_season', r.id || ':' || v_season, 'tire_season', jsonb_build_object(
        'season', split_part(v_season, '-', 1),
        'shop_id', r.shop_id,
        'shop_name', (select s.name from public.shops s where s.id = r.shop_id),
        'car_id', case when r.cars = 1 then r.car_id end,
        'make', case when r.cars = 1 then (select c.make from public.cars c where c.id = r.car_id) end,
        'model', case when r.cars = 1 then (select c.model from public.cars c where c.id = r.car_id) end), p_now) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_tire_season_reminders(timestamptz) from public, anon, authenticated;

-- 3 and 14 days after sign-up (Bucharest days, two days to catch a missed run), to a client who
-- has never made a booking. The second one asks for the car when the garage is still empty.
create function public.send_welcome_tips(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  r record;
  v_n int := 0;
begin
  for r in
    select p.id,
           case when v_today - (p.created_at at time zone 'Europe/Bucharest')::date between 14 and 16 then 14 else 3 end as day,
           exists (select 1 from public.cars c where c.owner_id = p.id) as has_car
    from public.profiles p
    where p.role = 'client' and p.deleted_at is null and not p.suspended and p.app_tips
      and (v_today - (p.created_at at time zone 'Europe/Bucharest')::date between 3 and 5
           or v_today - (p.created_at at time zone 'Europe/Bucharest')::date between 14 and 16)
      and not exists (select 1 from public.bookings b where b.client_id = p.id)
  loop
    if public.send_tip(r.id, 'welcome', r.id || ':' || r.day, 'welcome',
                       jsonb_build_object('day', r.day, 'has_car', r.has_car), p_now) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_welcome_tips(timestamptz) from public, anon, authenticated;

-- A shop starts (or raises) its new-client offer: the clients who keep it in favorites, turned the
-- offers on and would get it are told, at most once a month per shop.
create function public.shops_after_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
begin
  if not public.is_shop_public(new.id) then
    return new;
  end if;
  for v_client in
    select f.client_id from public.favorites f
    join public.profiles p on p.id = f.client_id
    where f.shop_id = new.id and p.promo_notifications
      and public.is_new_client(new.id, f.client_id, null)
  loop
    perform public.send_tip(v_client, 'favorite_offer',
      v_client || ':' || new.id || ':' || to_char(public.bucharest_today(), 'YYYY-MM'), 'favorite_offer',
      jsonb_build_object('shop_id', new.id, 'shop_name', new.name, 'percent', new.new_client_offer));
  end loop;
  return new;
end
$$;
revoke execute on function public.shops_after_offer() from public, anon, authenticated;
create trigger shops_after_offer after update of new_client_offer on public.shops
  for each row
  when (new.new_client_offer is not null
        and (old.new_client_offer is null or new.new_client_offer > old.new_client_offer))
  execute function public.shops_after_offer();

-- ---------------------------------------------------------------------------------------------
-- To the shop
-- ---------------------------------------------------------------------------------------------
-- A request still pending request_reminder_hours after it came (and less than 3 days), its slot
-- still ahead: every member is reminded once.
create function public.send_request_waiting_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours int := coalesce((select (ps.limits->>'request_reminder_hours')::int from public.platform_settings ps where ps.id = 1), 2);
  b public.bookings%rowtype;
  v_n int := 0;
begin
  for b in
    select bk.* from public.bookings bk
    where bk.status = 'pending'
      and bk.created_at <= p_now - make_interval(hours => v_hours)
      and bk.created_at > p_now - interval '3 days'
      and (bk.date + bk.slot) at time zone 'Europe/Bucharest' > p_now
      and not exists (select 1 from public.engagement_log l where l.kind = 'request_waiting' and l.key = bk.id::text)
    order by bk.created_at
  loop
    insert into public.engagement_log (kind, key, sent_at) values ('request_waiting', b.id::text, p_now)
    on conflict do nothing;
    continue when not found;
    perform public.notify_shop(b.shop_id, 'booking_request_waiting', public.booking_event_params(b), b.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_request_waiting_reminders(timestamptz) from public, anon, authenticated;

-- The month before p_today's month, for one shop: what came through Service-Hub.
create function public.shop_month_numbers(p_shop_id uuid, p_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select date_trunc('month', p_month)::date as first, (date_trunc('month', p_month) + interval '1 month')::date as next
  ), done as (
    select b.* from public.bookings b, m
    where b.shop_id = p_shop_id and b.status = 'done' and b.done_at is not null
      and (b.done_at at time zone 'Europe/Bucharest')::date >= m.first
      and (b.done_at at time zone 'Europe/Bucharest')::date < m.next
  ), rev as (
    select r.rating from public.reviews r, m
    where r.shop_id = p_shop_id and r.removed_at is null
      and (r.created_at at time zone 'Europe/Bucharest')::date >= m.first
      and (r.created_at at time zone 'Europe/Bucharest')::date < m.next
  )
  select jsonb_build_object(
    'month', to_char((select first from m), 'YYYY-MM'),
    'requests', (select count(*) from public.bookings b, m
                 where b.shop_id = p_shop_id
                   and (b.created_at at time zone 'Europe/Bucharest')::date >= m.first
                   and (b.created_at at time zone 'Europe/Bucharest')::date < m.next),
    'done', (select count(*) from done),
    'revenue', coalesce((select sum(cost) from done), 0),
    -- Clients whose first finished job at this shop was this month.
    'new_clients', (select count(distinct d.client_id) from done d
                    where d.client_id is not null
                      and not exists (select 1 from public.bookings x
                                      where x.shop_id = p_shop_id and x.client_id = d.client_id and x.status = 'done'
                                        and x.done_at < (select first from m)::timestamp at time zone 'Europe/Bucharest')),
    'reviews', (select count(*) from rev),
    'rating', (select round(avg(rating), 1) from rev))
$$;
revoke execute on function public.shop_month_numbers(uuid, date) from public, anon, authenticated;

-- On the 1st to the 3rd of the month (a missed run catches up): last month's numbers to the owner
-- of every shop that had a request or a job in it and did not turn the report off.
create function public.send_monthly_reports(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  s public.shops%rowtype;
  v_numbers jsonb;
  v_n int := 0;
begin
  if extract(day from v_today) > 3 then
    return 0;
  end if;
  for s in
    select sh.* from public.shops sh
    join public.profiles p on p.id = sh.owner_id
    where sh.monthly_report and not sh.suspended and p.deleted_at is null and not p.suspended
      and not exists (select 1 from public.engagement_log l
                      where l.kind = 'monthly_report' and l.key = sh.id || ':' || to_char(v_month, 'YYYY-MM'))
  loop
    v_numbers := public.shop_month_numbers(s.id, v_month);
    continue when (v_numbers->>'requests')::int = 0 and (v_numbers->>'done')::int = 0;
    insert into public.engagement_log (kind, key, user_id, sent_at)
    values ('monthly_report', s.id || ':' || to_char(v_month, 'YYYY-MM'), s.owner_id, p_now)
    on conflict do nothing;
    continue when not found;
    perform public.notify_shop_owner(s.id, 'monthly_report', v_numbers);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_monthly_reports(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The jobs
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_quote_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'expired', public.expire_quotes(),
    'reminded', public.remind_expiring_quotes(p_now),
    'requests_waiting', public.send_request_waiting_reminders(p_now));
end
$$;
revoke execute on function public.run_quote_jobs(timestamptz) from public, anon, authenticated;

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
    'trials_ended', public.end_expired_trials(p_now));
  if extract(hour from v_local) = 7 then
    v_result := v_result || jsonb_build_object(
      'trial_warnings', public.send_trial_warnings(p_now),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  if extract(hour from v_local) = 10 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'review_requests', public.send_review_requests(p_now),
      'service_reminders', public.send_service_reminders(v_local::date),
      'tire_season', public.send_tire_season_reminders(p_now),
      'welcome_tips', public.send_welcome_tips(p_now),
      'monthly_reports', public.send_monthly_reports(p_now));
  end if;
  return v_result;
end
$$;
revoke execute on function public.run_hourly_jobs(timestamptz) from public, anon, authenticated;

update public.schema_version set version = 43;
