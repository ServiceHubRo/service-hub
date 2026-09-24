-- T12 — Push notifications and scheduled jobs. ARCHITECTURE §9, §10, §11; FR §7; P15b, P7b, P15c.
--
-- · push_config: the VAPID key pair (made once by the dispatch-notifications Edge Function, no
--   manual step), the function's address and the token the database sends it. Service role only.
-- · Devices are saved through save_push_subscription() (the browser can no longer write the table
--   directly): only real push services, and a device signed in with another account moves over.
-- · The outbox: every insert into notification_events wakes the Edge Function (pg_net); a sweep
--   every minute catches anything missed. claim_notifications / finish_notifications are the
--   dispatcher's side (locking, retries, stale events, dead devices, log).
-- · Scheduled jobs (pg_cron, UTC schedules, Bucharest logic): quote expiry + the 24 h reminder,
--   the appointment reminder 24 h before, document expiry at 30 / 7 / 0 days, the shop's daily
--   summary at opening, request_log purge.
-- pg_net and pg_cron exist on Supabase; on a plain Postgres (CI SQL tests) the migration skips
-- them and every job stays callable by hand.

-- ---------------------------------------------------------------------------------------------
-- Extensions (Supabase). Skipped where they are not available.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and to_regnamespace('extensions') is not null then
    create extension if not exists pg_net with schema extensions;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled: %', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
exception when others then
  raise warning 'pg_cron could not be enabled: %', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- push_config — one row. No policies and no grants: only the service role (Edge Functions) and
-- the database's own functions read it.
-- ---------------------------------------------------------------------------------------------
create table public.push_config (
  id int primary key default 1 check (id = 1),
  -- Base64url of the 65-byte uncompressed P-256 public key (the browser's applicationServerKey).
  vapid_public_key text,
  -- The private key as a JWK; never leaves the dispatcher.
  vapid_private_jwk jsonb,
  -- https://<project>.supabase.co/functions/v1/dispatch-notifications, stored by the function.
  dispatch_url text,
  -- Sent by the database with every wake-up call; the function refuses calls without it.
  dispatch_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Extra push service origins accepted for devices (local tests only, e.g. http://127.0.0.1:9999).
  extra_push_origins text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.push_config (id) values (1);
alter table public.push_config enable row level security;
create trigger push_config_updated_at before update on public.push_config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- New columns.
-- ---------------------------------------------------------------------------------------------
-- The dispatcher holds an event until then (claimed, or waiting before a retry).
alter table public.notification_events add column locked_until timestamptz;
-- The "expires tomorrow" reminder went out for this quote version.
alter table public.quotes add column expiry_reminded_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Devices. The browser saves its subscription only through save_push_subscription(); it can still
-- read and delete its own rows (turning notifications off on a device, signing out).
-- ---------------------------------------------------------------------------------------------
revoke insert, update on public.push_subscriptions from authenticated;
drop policy push_subscriptions_insert_own on public.push_subscriptions;
drop policy push_subscriptions_update_own on public.push_subscriptions;

-- A push service the dispatcher may post to: the browser vendors' services (Chrome / Edge /
-- Firefox / Safari / Windows), plus the test origins in push_config. Anything else is refused, so
-- a device row can never make the server call an arbitrary address.
create function public.is_push_endpoint(p_url text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    char_length(p_url) <= 1000
    and (
      substring(p_url from '^https://([a-z0-9.-]+)/') ~
        '^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$'
      or exists (
        select 1 from public.push_config c, unnest(c.extra_push_origins) o
        where c.id = 1 and left(p_url, char_length(o) + 1) = o || '/')
    ),
    false)
$$;
revoke execute on function public.is_push_endpoint(text) from public, anon, authenticated;

-- Saves this device for the caller (client or shop). Repeating it is harmless (same row), so like
-- mark_thread_read it takes no request id. The same browser signed in with another account
-- belongs to the caller from now on; at most 10 devices per person (the least recently used go).
create function public.save_push_subscription(p_endpoint text, p_subscription jsonb, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_caller();
  if v_me.role not in ('client', 'shop') then
    perform public.fail('not_allowed');
  end if;
  if not public.is_push_endpoint(p_endpoint) then
    perform public.fail('push_endpoint_invalid');
  end if;
  if p_subscription is null
     or jsonb_typeof(p_subscription) <> 'object'
     or p_subscription->>'endpoint' is distinct from p_endpoint
     or coalesce(p_subscription #>> '{keys,p256dh}', '') !~ '^[A-Za-z0-9_-]{80,100}=*$'
     or coalesce(p_subscription #>> '{keys,auth}', '') !~ '^[A-Za-z0-9_-]{16,32}=*$'
     or char_length(p_subscription::text) > 2000 then
    perform public.fail('push_subscription_invalid');
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_me.id;
  insert into public.push_subscriptions (endpoint, user_id, subscription, user_agent)
  values (p_endpoint, v_me.id, p_subscription, left(p_user_agent, 500))
  on conflict (endpoint) do update
    set subscription = excluded.subscription, user_agent = excluded.user_agent;

  delete from public.push_subscriptions
  where user_id = v_me.id
    and endpoint in (
      select ps.endpoint from public.push_subscriptions ps
      where ps.user_id = v_me.id
      order by coalesce(ps.last_success_at, ps.updated_at) desc
      offset 10);
end
$$;
grant execute on function public.save_push_subscription(text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Waking the dispatcher. An insert into the outbox calls the Edge Function once per transaction
-- (after commit, through pg_net); dispatch_sweep() runs every minute for anything left behind.
-- Without pg_net or before the function has stored its address, both do nothing.
-- ---------------------------------------------------------------------------------------------
create function public.kick_dispatcher()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if to_regnamespace('net') is null then
    return false;
  end if;
  select dispatch_url, dispatch_token into v_url, v_token from public.push_config where id = 1;
  if v_url is null then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-token', v_token);
  return true;
end
$$;
revoke execute on function public.kick_dispatcher() from public, anon, authenticated;

create function public.notification_events_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('service_hub.dispatch_kicked', true) is distinct from '1' then
    perform set_config('service_hub.dispatch_kicked', '1', true);
    perform public.kick_dispatcher();
  end if;
  return null;
end
$$;
revoke execute on function public.notification_events_kick() from public, anon, authenticated;
create trigger notification_events_kick after insert on public.notification_events
  for each statement execute function public.notification_events_kick();

create function public.dispatch_sweep()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.notification_events
    where processed_at is null and (locked_until is null or locked_until < now())
  ) then
    return public.kick_dispatcher();
  end if;
  return false;
end
$$;
revoke execute on function public.dispatch_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The dispatcher's side (service role only).
-- ---------------------------------------------------------------------------------------------
-- Takes up to p_limit due events for sending (held 2 minutes) and answers them with what the
-- function needs: the recipient's language and role, the service names, the recipient's devices,
-- and the admin's text overrides. Events older than 12 hours, or tried 5 times, are closed
-- without sending: a push about a quote from yesterday helps nobody.
create function public.claim_notifications(p_limit int default 50)
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
    and (attempts >= 5 or created_at < now() - interval '12 hours');

  with picked as (
    select e.id from public.notification_events e
    where e.processed_at is null and (e.locked_until is null or e.locked_until < now())
    order by e.created_at
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
        'channels', to_jsonb(e.channels),
        'created_at', e.created_at,
        'attempts', e.attempts,
        'lang', p.lang,
        'role', p.role,
        'service', (select jsonb_build_object('ro', s.name_ro, 'en', s.name_en)
                    from public.services s where s.id = e.params->>'service_id'),
        'devices', coalesce((
          select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', ps.subscription->'keys'))
          from public.push_subscriptions ps where ps.user_id = e.user_id), '[]'::jsonb)
      ) order by e.created_at)
      from public.notification_events e
      join public.profiles p on p.id = e.user_id
      where e.id = any (v_ids)), '[]'::jsonb));
end
$$;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;

-- Records what happened to claimed events:
--   [{ "id", "done": true|false, "error", "log": [{channel, status, error}],
--      "gone": [endpoints the push service no longer knows], "delivered": [endpoints that took it] }]
-- done = false leaves the event for a retry, a little later each time (2, 4, 6 … minutes).
create function public.finish_notifications(p_results jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_event public.notification_events%rowtype;
  v_done boolean;
  v_n int := 0;
begin
  for r in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    v_done := coalesce((r->>'done')::boolean, true);
    update public.notification_events
      set processed_at = case when v_done then now() end,
          locked_until = case when v_done then null else now() + make_interval(mins => 2 * attempts) end,
          last_error = left(r->>'error', 500)
    where id = public.try_uuid(r->>'id') and processed_at is null
    returning * into v_event;
    if not found then
      continue;
    end if;
    v_n := v_n + 1;

    insert into public.notifications_log (event_id, user_id, channel, status, error)
    select v_event.id, v_event.user_id, l->>'channel', left(coalesce(l->>'status', 'unknown'), 40), left(l->>'error', 500)
    from jsonb_array_elements(coalesce(r->'log', '[]'::jsonb)) l
    where l->>'channel' in ('push', 'email', 'sms');

    delete from public.push_subscriptions
    where user_id = v_event.user_id
      and endpoint in (select jsonb_array_elements_text(coalesce(r->'gone', '[]'::jsonb)));
    update public.push_subscriptions set last_success_at = now()
    where user_id = v_event.user_id
      and endpoint in (select jsonb_array_elements_text(coalesce(r->'delivered', '[]'::jsonb)));
  end loop;
  return v_n;
end
$$;
revoke execute on function public.finish_notifications(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Scheduled jobs. Each takes the time as a parameter (default now) so the tests can move it.
-- ---------------------------------------------------------------------------------------------
-- quote_expiring: once per quote version, when it has less than 24 h left; client and shop.
create function public.remind_expiring_quotes(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v public.bookings%rowtype;
  v_params jsonb;
  v_n int := 0;
begin
  for v_quote in
    select q.* from public.quotes q
    where q.status = 'sent' and q.expiry_reminded_at is null
      and q.expires_at > p_now and q.expires_at <= p_now + interval '24 hours'
    order by q.expires_at
    for no key update skip locked
  loop
    select * into v from public.bookings where id = v_quote.booking_id and status = 'quote_sent';
    if not found then
      continue;
    end if;
    update public.quotes set expiry_reminded_at = now() where id = v_quote.id;
    v_params := public.booking_event_params(v) || jsonb_build_object(
      'quote_id', v_quote.id, 'total', v_quote.total_sent, 'expires_at', v_quote.expires_at);
    perform public.notify_user(v.client_id, 'quote_expiring', v_params, v.id);
    perform public.notify_shop(v.shop_id, 'quote_expiring', v_params, v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.remind_expiring_quotes(timestamptz) from public, anon, authenticated;

-- appointment_reminder: confirmed bookings starting in 22–24 h (the hourly job sees each one at
-- least once), once per booking; a reschedule clears reminder_sent_at. `day` says whether the
-- slot is today or tomorrow in Bucharest at the time of sending.
create function public.send_appointment_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_n int := 0;
begin
  for v in
    select b.* from public.bookings b
    where b.status = 'confirmed' and b.reminder_sent_at is null
      and b.date between v_today and v_today + 2
      and public.slot_starts_at(b.date, b.slot) > p_now + interval '22 hours'
      and public.slot_starts_at(b.date, b.slot) <= p_now + interval '24 hours'
    for no key update skip locked
  loop
    update public.bookings set reminder_sent_at = now() where id = v.id;
    perform public.notify_user(v.client_id, 'appointment_reminder', public.booking_event_params(v) ||
      jsonb_build_object('day', case when v.date = v_today then 'today' else 'tomorrow' end), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_appointment_reminders(timestamptz) from public, anon, authenticated;

-- doc_expiry: ITP / RCA / vignette at 30, 7 and 0 days (and after), once per threshold and
-- expiry date (cars.reminded, e.g. {"itp":{"2026-11-02":[30,7]}}). A document that is already
-- inside a smaller threshold gets one reminder, not one per threshold it skipped; a new expiry
-- date starts over. Dates more than 30 days past are left alone (the banner in the app remains).
create function public.send_doc_expiry_reminders(p_today date default public.bucharest_today())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_car public.cars%rowtype;
  v_doc text;
  v_expiry date;
  v_days int;
  v_threshold int;
  v_reminded jsonb;
  v_changed boolean;
  v_n int := 0;
begin
  for v_car in
    select c.* from public.cars c
    where c.itp_expiry between p_today - 30 and p_today + 30
       or c.rca_expiry between p_today - 30 and p_today + 30
       or c.vignette_expiry between p_today - 30 and p_today + 30
    for no key update skip locked
  loop
    v_reminded := coalesce(v_car.reminded, '{}'::jsonb);
    v_changed := false;
    foreach v_doc in array array['itp', 'rca', 'vignette']
    loop
      v_expiry := case v_doc when 'itp' then v_car.itp_expiry
                             when 'rca' then v_car.rca_expiry
                             else v_car.vignette_expiry end;
      continue when v_expiry is null;
      v_days := v_expiry - p_today;
      continue when v_days > 30 or v_days < -30;
      v_threshold := case when v_days <= 0 then 0 when v_days <= 7 then 7 else 30 end;
      continue when coalesce(v_reminded -> v_doc -> (v_expiry::text), '[]'::jsonb) @> to_jsonb(v_threshold);

      v_reminded := jsonb_set(v_reminded, array[v_doc], jsonb_build_object(v_expiry::text,
        (select jsonb_agg(t order by t desc) from unnest(array[30, 7, 0]) t where t >= v_threshold)));
      v_changed := true;
      perform public.notify_user(v_car.owner_id, 'doc_expiry', jsonb_build_object(
        'car_id', v_car.id, 'doc', v_doc, 'expiry', v_expiry, 'days', v_days,
        'make', v_car.make, 'model', v_car.model, 'plate', v_car.plate), null);
      v_n := v_n + 1;
    end loop;
    if v_changed then
      update public.cars set reminded = v_reminded where id = v_car.id;
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_doc_expiry_reminders(date) from public, anon, authenticated;

-- daily_digest: for shops that turned it on, once a day in the first two hours after opening
-- (Bucharest), on open days only, and only when there is something to say: today's bookings
-- (confirmed onwards), the first one's time, and the requests waiting for an answer.
create function public.send_daily_digests(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_date date := (p_now at time zone 'Europe/Bucharest')::date;
  v_time time := (p_now at time zone 'Europe/Bucharest')::time;
  r record;
  v_today int;
  v_pending int;
  v_first time;
  v_n int := 0;
begin
  for r in
    select s.id, s.name
    from public.shops s
    join public.shop_hours h on h.shop_id = s.id and h.weekday = extract(dow from v_local)
    where s.daily_digest and s.active and not s.suspended
      and not h.is_closed
      and v_time >= h.open_time and v_time - h.open_time < interval '2 hours'
      and not exists (select 1 from public.shop_closures c
                      where c.shop_id = s.id and v_date between c.start_date and c.end_date)
      and not exists (select 1 from public.notification_events e
                      where e.event = 'daily_digest' and e.params->>'shop_id' = s.id::text
                        and e.params->>'date' = v_date::text)
  loop
    select count(*) filter (where b.date = v_date and b.status <> 'pending'),
           count(*) filter (where b.status = 'pending'),
           min(b.slot) filter (where b.date = v_date and b.status <> 'pending')
      into v_today, v_pending, v_first
    from public.bookings b
    where b.shop_id = r.id and public.is_active_status(b.status);
    continue when v_today = 0 and v_pending = 0;

    perform public.notify_shop(r.id, 'daily_digest', jsonb_build_object(
      'shop_id', r.id, 'shop_name', r.name, 'date', v_date, 'today', v_today, 'pending', v_pending,
      'first_slot', to_char(v_first, 'HH24:MI')), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_daily_digests(timestamptz) from public, anon, authenticated;

-- Idempotency records are needed for a few minutes; they are kept 7 days (§2 request_log).
create function public.purge_request_log(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.request_log where created_at < p_now - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function public.purge_request_log(timestamptz) from public, anon, authenticated;

-- Every 15 minutes: expired quotes, then the "expires tomorrow" reminders.
create function public.run_quote_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'expired', public.expire_quotes(),
    'reminded', public.remind_expiring_quotes(p_now));
end
$$;
revoke execute on function public.run_quote_jobs(timestamptz) from public, anon, authenticated;

-- Every hour: appointment reminders, daily summaries; at 07:xx Bucharest also the document
-- reminders and the request_log purge (pg_cron schedules in UTC, so the hour is checked here).
create function public.run_hourly_jobs(p_now timestamptz default now())
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
    'digests', public.send_daily_digests(p_now));
  if extract(hour from v_local) = 7 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  return v_result;
end
$$;
revoke execute on function public.run_hourly_jobs(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The schedule (pg_cron, UTC). cron.schedule() with a name replaces a job of the same name, so
-- this can be run again by hand (SQL Editor) after pg_cron was turned on in the dashboard.
-- ---------------------------------------------------------------------------------------------
create function public.schedule_notification_jobs()
returns text
language plpgsql
set search_path = ''
as $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not available: scheduled jobs were not created';
    return 'pg_cron missing';
  end if;
  perform cron.schedule('sh_dispatch_sweep', '* * * * *', 'select public.dispatch_sweep()');
  perform cron.schedule('sh_quote_jobs', '*/15 * * * *', 'select public.run_quote_jobs()');
  perform cron.schedule('sh_hourly_jobs', '2 * * * *', 'select public.run_hourly_jobs()');
  return 'scheduled';
end
$$;
revoke execute on function public.schedule_notification_jobs() from public, anon, authenticated;
select public.schedule_notification_jobs();

update public.schema_version set version = 17;
