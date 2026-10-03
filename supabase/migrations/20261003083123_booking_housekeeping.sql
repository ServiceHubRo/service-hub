-- Bookings that look after themselves (Eduard, 3 oct):
--   1. A request the shop never answers closes on its own when its time comes (status expired,
--      closed_reason 'unanswered'): the client is told kindly (push + email) with a way to book
--      elsewhere, the shop is told too, and the place in the client's limits is free again.
--   2. A confirmed booking whose day has passed with nothing recorded: the next morning the shop is
--      asked what happened (booking_followup, once); 7 days after its day it closes on its own
--      (expired, closed_reason 'not_updated') — never as a no-show, so the client is not penalized.
--   3. A morning email to the platform's admin address (ADMIN_EMAIL) only when something waits:
--      reported or suspect reviews, failed payments, companies ANAF did not confirm, unanswered
--      requests — with yesterday's activity for context.
-- Every change goes through these functions (service role / pg_cron only), with the automatic
-- thread message and the notifications in the same transaction.

alter table public.bookings
  add column closed_reason text check (closed_reason in ('unanswered', 'not_updated')),
  add column followup_sent_at timestamptz;

comment on column public.bookings.closed_reason is
  'Set only by the system when it closes a booking: unanswered (request never answered), not_updated (confirmed, nothing recorded for 7 days).';

-- The admin's morning email is a platform event (no user: it goes to ADMIN_EMAIL).
alter table public.notification_events drop constraint notification_events_recipient;
alter table public.notification_events add constraint notification_events_recipient
  check (user_id is not null or event in ('review_reported', 'admin_digest'));

-- ---------------------------------------------------------------------------------------------
-- 1. Requests nobody answered
-- ---------------------------------------------------------------------------------------------
create function public.expire_unanswered_requests(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v public.bookings%rowtype;
  v_params jsonb;
  v_n int := 0;
begin
  for v_id in
    select b.id from public.bookings b
    where b.status = 'pending' and public.slot_starts_at(b.date, b.slot) <= p_now
    order by b.date, b.slot
  loop
    -- Skip a booking someone is changing right now (the shop confirming it at the last minute).
    select * into v from public.bookings where id = v_id and status = 'pending' for no key update skip locked;
    if not found then
      continue;
    end if;
    update public.bookings set status = 'expired', closed_reason = 'unanswered' where id = v.id returning * into v;
    v_params := public.booking_event_params(v)
      || jsonb_build_object('category', (select s.category_key from public.services s where s.id = v.service_id),
                            'city', (select s.city from public.shops s where s.id = v.shop_id));
    perform public.post_booking_event(v, 'request_expired', 'system',
      jsonb_build_object('date', v.date, 'slot', to_char(v.slot, 'HH24:MI')));
    perform public.notify_user(v.client_id, 'request_expired', v_params, v.id, array['push', 'email']);
    perform public.notify_shop(v.shop_id, 'request_expired', v_params, v.id, array['push', 'email']);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.expire_unanswered_requests(timestamptz) from public, anon, authenticated;

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
    'requests_waiting', public.send_request_waiting_reminders(p_now),
    'requests_expired', public.expire_unanswered_requests(p_now));
end
$$;
revoke execute on function public.run_quote_jobs(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Confirmed bookings left open after their day
-- ---------------------------------------------------------------------------------------------
-- The morning after the day (10:xx Bucharest): "Did the client come?", to every member, once.
create function public.send_booking_followups(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_id uuid;
  v public.bookings%rowtype;
  v_n int := 0;
begin
  for v_id in
    select b.id from public.bookings b
    where b.status = 'confirmed' and b.followup_sent_at is null
      and b.date < v_today and b.date >= v_today - 6
    order by b.date, b.slot
  loop
    select * into v from public.bookings
    where id = v_id and status = 'confirmed' and followup_sent_at is null
    for no key update skip locked;
    if not found then
      continue;
    end if;
    update public.bookings set followup_sent_at = p_now where id = v.id returning * into v;
    perform public.notify_shop(v.shop_id, 'booking_followup', public.booking_event_params(v), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_booking_followups(timestamptz) from public, anon, authenticated;

-- 7 days after its day, still only confirmed: closed quietly. Not a no-show (the client may well
-- have come); the shop is told, the client reads a kind line in the conversation.
create function public.close_stale_bookings(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_id uuid;
  v public.bookings%rowtype;
  v_n int := 0;
begin
  for v_id in
    select b.id from public.bookings b
    where b.status = 'confirmed' and b.date <= v_today - 7
    order by b.date, b.slot
  loop
    select * into v from public.bookings where id = v_id and status = 'confirmed' for no key update skip locked;
    if not found then
      continue;
    end if;
    update public.bookings set status = 'expired', closed_reason = 'not_updated' where id = v.id returning * into v;
    perform public.post_booking_event(v, 'booking_auto_closed', 'system',
      jsonb_build_object('date', v.date, 'slot', to_char(v.slot, 'HH24:MI')));
    perform public.notify_shop(v.shop_id, 'booking_auto_closed', public.booking_event_params(v), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.close_stale_bookings(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. The admin's morning email
-- ---------------------------------------------------------------------------------------------
-- What waits for the admin and what happened in the last 24 hours. Sent (08:xx Bucharest, once a
-- day) only when something waits.
create function public.admin_digest_counts(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.reviews r where r.report_status = 'pending'),
    'suspect', (select count(*) from public.reviews r
                where r.removed_at is null and r.signals_cleared_at is null
                  and r.created_at > p_now - interval '180 days'
                  and public.is_suspect_review(public.review_signals(r))),
    'past_due', (select count(*) from public.subscriptions s where s.status = 'past_due'),
    'company_waiting', (select count(*) from public.shop_billing b
                        where b.anaf_problem_since is not null and b.anaf_hidden_at is null),
    'company_hidden', (select count(*) from public.shop_billing b where b.anaf_hidden_at is not null),
    'unanswered', (select count(*) from public.bookings b
                   where b.closed_reason = 'unanswered' and b.status_changed_at > p_now - interval '24 hours'),
    'new_shops', (select count(*) from public.shops s where s.created_at > p_now - interval '24 hours'),
    'new_clients', (select count(*) from public.profiles p
                    where p.role = 'client' and p.created_at > p_now - interval '24 hours'),
    'new_bookings', (select count(*) from public.bookings b where b.created_at > p_now - interval '24 hours'),
    'done', (select count(*) from public.bookings b where b.status = 'done' and b.done_at > p_now - interval '24 hours'))
$$;
revoke execute on function public.admin_digest_counts(timestamptz) from public, anon, authenticated;

create function public.send_admin_digest(p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := public.admin_digest_counts(p_now);
begin
  if (v->>'reports')::int + (v->>'suspect')::int + (v->>'past_due')::int + (v->>'company_waiting')::int
     + (v->>'company_hidden')::int + (v->>'unanswered')::int = 0 then
    return false;
  end if;
  if exists (select 1 from public.notification_events e
             where e.event = 'admin_digest' and e.created_at > p_now - interval '20 hours') then
    return false;
  end if;
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  values (null, 'admin_digest', v || jsonb_build_object('date', (p_now at time zone 'Europe/Bucharest')::date), null, array['email']);
  return true;
end
$$;
revoke execute on function public.send_admin_digest(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The shop's history: an unanswered request never became a job (like a declined one).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_shop_history()
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
    ), '[]'::jsonb)
  );
end
$$;
grant execute on function public.list_shop_history() to authenticated;

-- Followups and the automatic notices respect the quiet hours like the other reminders.
create or replace function public.is_quiet_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('appointment_reminder', 'quote_expiring', 'quote_expired', 'doc_expiry', 'review_request',
    'service_due', 'trial_ending', 'shop_inactive', 'payment_failed', 'referral_reward',
    'referral_revoked', 'broadcast', 'tire_season', 'welcome', 'favorite_offer', 'booking_request_waiting',
    'monthly_report', 'company_problem', 'company_name_mismatch', 'company_hidden', 'company_ok',
    'request_expired', 'booking_followup', 'booking_auto_closed')
$$;

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
  -- The month's ANAF checks and the companies due again (verify-company, in the background), then
  -- an hour later the shops whose company stayed unconfirmed past the deadline leave the search.
  if extract(hour from v_local) = 6 then
    v_result := v_result || jsonb_build_object('company_checks', public.kick_company_checks());
  end if;
  if extract(hour from v_local) = 8 then
    v_result := v_result || jsonb_build_object(
      'company_hidden', public.enforce_company_deadlines(p_now),
      'admin_digest', public.send_admin_digest(p_now));
  end if;
  if extract(hour from v_local) = 10 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'review_requests', public.send_review_requests(p_now),
      'service_reminders', public.send_service_reminders(v_local::date),
      'tire_season', public.send_tire_season_reminders(p_now),
      'welcome_tips', public.send_welcome_tips(p_now),
      'monthly_reports', public.send_monthly_reports(p_now),
      'booking_followups', public.send_booking_followups(p_now),
      'bookings_closed', public.close_stale_bookings(p_now));
  end if;
  return v_result;
end
$$;

update public.schema_version set version = 49;
