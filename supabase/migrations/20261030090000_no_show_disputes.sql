-- T53 — No-shows: a fair record, a warning that grows, a way to contest (Eduard, 30 Oct 2026).
-- ARCHITECTURE §6. No payments, no fines, no blocking, no public score.
--
-- · A no-show can be marked only once the slot is over plus a grace period: start of the slot
--   + the shop's slot length + `no_show_grace_minutes` (15; 0–120). Earlier, `too_early {from}`.
-- · What counts: no-shows of bookings made in the app (never the ones the shop added), in the last
--   90 days, except a no-show whose dispute is waiting for the admin or was accepted. One helper,
--   active_no_show_count, feeds every counter: client_no_show_count, the shop's card, the admin's
--   lists, instant confirmation, the phone rule.
-- · The client's notification says how serious it is: level 1 (first), 2 (repeated), 3 (from
--   `no_shows_before_ack`, 3; 1–20). Neutral texts, no blame.
-- · From `no_shows_before_ack` active no-shows, every new booking needs the client's
--   acknowledgement ("I will come and tell the shop in time if I cannot"):
--   acknowledge_no_show_notice() stores it, the booking trigger uses it once, within 30 minutes,
--   else `no_show_ack_required {no_shows}`. Such a client is never confirmed at once (already true
--   from the first no-show: instant_for_client). The phone rule (`no_shows_before_phone`) stays.
-- · no_show_disputes: the client contests a no-show (a reason, 10–1000 characters), once per
--   booking, while it counts. The admin decides in Moderare (upheld: it no longer counts;
--   rejected: it stays), with an internal note the client never reads; audited; the client is told.
--   The shop sees the dispute's status in its history. The booking keeps its status `no_show`.

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
update public.platform_settings
  set limits = limits || '{"no_show_grace_minutes": 15}'::jsonb
where id = 1 and not (limits ? 'no_show_grace_minutes');
update public.platform_settings
  set limits = limits || '{"no_shows_before_ack": 3}'::jsonb
where id = 1 and not (limits ? 'no_shows_before_ack');

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
    when 'no_shows_before_phone' then int4range(1, 20, '[]')
    when 'no_shows_before_ack' then int4range(1, 20, '[]')
    when 'no_show_grace_minutes' then int4range(0, 120, '[]')
    when 'quiet_hours_start' then int4range(0, 23, '[]')
    when 'quiet_hours_end' then int4range(0, 23, '[]')
    when 'promo_per_week' then int4range(0, 7, '[]')
    when 'request_reminder_hours' then int4range(1, 24, '[]')
    when 'company_fix_days' then int4range(1, 90, '[]')
    when 'company_recheck_days' then int4range(7, 365, '[]')
    when 'referral_credits_per_year' then int4range(0, 12, '[]')
    when 'referral_friends_per_report' then int4range(1, 10, '[]')
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Disputes and acknowledgements
-- ---------------------------------------------------------------------------------------------
create table public.no_show_disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'upheld', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  -- Internal: the admin's reasons. Never readable by the client (no column grant, no RPC).
  decision_note text check (char_length(decision_note) <= 1000),
  check ((status = 'pending') = (decided_at is null))
);
create index no_show_disputes_client_idx on public.no_show_disputes (client_id);
create index no_show_disputes_pending_idx on public.no_show_disputes (created_at) where status = 'pending';
alter table public.no_show_disputes enable row level security;
create policy no_show_disputes_select on public.no_show_disputes for select to authenticated
  using (client_id = auth.uid() or public.is_admin());
grant select (id, booking_id, client_id, reason, status, created_at, decided_at) on public.no_show_disputes to authenticated;
-- Live: the client's card when the admin decides, Moderare when a dispute comes in.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'no_show_disputes') then
    alter publication supabase_realtime add table public.no_show_disputes;
  end if;
end
$$;

-- The client's "I will come" before a booking, once a booking needs it. Used by one booking.
create table public.no_show_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The booking it was given for (no foreign key: it is written while that booking is inserted).
  booking_id uuid,
  used_at timestamptz
);
create index no_show_acknowledgements_client_idx on public.no_show_acknowledgements (client_id, created_at desc);
alter table public.no_show_acknowledgements enable row level security;

-- ---------------------------------------------------------------------------------------------
-- What counts
-- ---------------------------------------------------------------------------------------------
-- The no-shows of a client that count: booked in the app, in the last p_days days (90), not under
-- review and not annulled after a dispute.
create function public.active_no_show_count(p_client_id uuid, p_days int default 90)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.bookings b
  where b.client_id = p_client_id and b.status = 'no_show' and b.source = 'app'
    and b.date > public.bucharest_today() - least(greatest(coalesce(p_days, 90), 1), 3650)
    and not exists (select 1 from public.no_show_disputes d
                    where d.booking_id = b.id and d.status in ('pending', 'upheld'))
$$;
revoke execute on function public.active_no_show_count(uuid, int) from public, anon, authenticated;

-- From when a confirmed booking may be marked as a no-show: the end of its slot plus the grace.
create function public.no_show_from(p_booking public.bookings)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select public.slot_starts_at(p_booking.date, p_booking.slot)
         + make_interval(mins => coalesce((select s.slot_minutes from public.shops s where s.id = p_booking.shop_id), 60)
                                 + public.app_limit('no_show_grace_minutes', 15))
$$;
revoke execute on function public.no_show_from(public.bookings) from public, anon, authenticated;

-- How serious a client's notification is: 1 the first, 2 repeated, 3 from the acknowledgement on.
create function public.no_show_level(p_count int)
returns int
language sql
stable
set search_path = ''
as $$
  select case
    when p_count >= 2 and p_count >= public.app_limit('no_shows_before_ack', 3) then 3
    when p_count >= 2 then 2
    else 1
  end
$$;
revoke execute on function public.no_show_level(int) from public, anon, authenticated;

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
  return public.active_no_show_count(p_client_id, p_days);
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
  v_count := public.active_no_show_count(new.client_id);
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
  select public.active_no_show_count(p_client_id) = 0
$$;
revoke execute on function public.instant_for_client(uuid) from public, anon, authenticated;

-- From `no_shows_before_ack` active no-shows: a booking the client makes needs a fresh
-- acknowledgement (acknowledge_no_show_notice, at most 30 minutes old), used by this booking only.
-- Runs after the phone rule (triggers fire in name order). create_booking holds the client's row
-- lock, so two bookings cannot use the same acknowledgement.
create function public.bookings_no_show_ack_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_ack uuid;
begin
  if new.client_id is null or auth.uid() is distinct from new.client_id then
    return new;
  end if;
  v_count := public.active_no_show_count(new.client_id);
  if v_count < public.app_limit('no_shows_before_ack', 3) then
    return new;
  end if;
  select a.id into v_ack from public.no_show_acknowledgements a
  where a.client_id = new.client_id and a.used_at is null and a.created_at > now() - interval '30 minutes'
  order by a.created_at desc
  limit 1
  for update;
  if v_ack is null then
    perform public.fail('no_show_ack_required', jsonb_build_object('no_shows', v_count));
  end if;
  update public.no_show_acknowledgements set booking_id = new.id, used_at = now() where id = v_ack;
  return new;
end
$$;
revoke execute on function public.bookings_no_show_ack_rule() from public, anon, authenticated;
create trigger bookings_rule_no_show_ack before insert on public.bookings
  for each row execute function public.bookings_no_show_ack_rule();

-- ---------------------------------------------------------------------------------------------
-- Marking a no-show
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_no_show(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_from timestamptz;
  v_count int := 0;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'mark_no_show');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'confirmed');
  v_from := public.no_show_from(v);
  if v_from > now() then
    perform public.fail('too_early', jsonb_build_object('from', v_from));
  end if;

  update public.bookings set status = 'no_show' where id = v.id returning * into v;

  if v.source = 'app' and v.client_id is not null then
    v_count := public.active_no_show_count(v.client_id);
  end if;
  perform public.post_booking_event(v, 'no_show', 'shop');
  perform public.notify_user(v.client_id, 'no_show',
    public.booking_event_params(v) || jsonb_build_object(
      'counts', v.source = 'app', 'count', v_count, 'level', public.no_show_level(v_count)),
    v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The client's side
-- ---------------------------------------------------------------------------------------------
create function public.no_show_dispute_json(p public.no_show_disputes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'booking_id', p.booking_id, 'reason', p.reason, 'status', p.status,
                            'created_at', p.created_at, 'decided_at', p.decided_at)
$$;
revoke execute on function public.no_show_dispute_json(public.no_show_disputes) from public, anon, authenticated;

-- What Programări shows a client about their no-shows: how many count, the thresholds, the
-- disputes (without the admin's note) and the no-shows that may still be contested.
create function public.my_no_show_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_caller();
  return jsonb_build_object(
    'count', public.active_no_show_count(v_me.id),
    'window_days', 90,
    'ack_from', public.app_limit('no_shows_before_ack', 3),
    'phone_from', public.app_limit('no_shows_before_phone', 2),
    'phone_verified', v_me.phone_verified_at is not null or coalesce(v_me.phone_verified_by_admin, false),
    'disputes', coalesce((
      select jsonb_agg(public.no_show_dispute_json(d) order by d.created_at desc)
      from public.no_show_disputes d where d.client_id = v_me.id), '[]'::jsonb),
    -- The no-shows the client may still contest (the same rules as dispute_no_show).
    'disputable', coalesce((
      select jsonb_agg(b.id order by b.date desc)
      from public.bookings b
      where b.client_id = v_me.id and b.status = 'no_show' and b.source = 'app'
        and b.date > public.bucharest_today() - 90
        and not exists (select 1 from public.no_show_disputes d where d.booking_id = b.id)), '[]'::jsonb));
end
$$;
revoke execute on function public.my_no_show_summary() from public, anon;
grant execute on function public.my_no_show_summary() to authenticated;

-- "I will come and tell the shop in time if I cannot": stored for the client's next booking.
create function public.acknowledge_no_show_notice(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v public.no_show_acknowledgements%rowtype;
  v_result jsonb;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'acknowledge_no_show_notice');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  -- One waiting at a time: a new one replaces any unused one.
  delete from public.no_show_acknowledgements where client_id = v_me.id and used_at is null;
  insert into public.no_show_acknowledgements (client_id) values (v_me.id) returning * into v;
  v_result := jsonb_build_object('id', v.id, 'created_at', v.created_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.acknowledge_no_show_notice(uuid) from public, anon;
grant execute on function public.acknowledge_no_show_notice(uuid) to authenticated;

-- The client contests a no-show of their own booking made in the app, while it counts (90 days),
-- once. While the admin decides, it does not count.
create function public.dispute_no_show(p_booking_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  d public.no_show_disputes%rowtype;
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'dispute_no_show');
  if v_seen is not null then
    return v_seen;
  end if;
  v := public.lock_booking_as_client(p_booking_id);
  perform public.require_status(v, 'no_show');
  if v.source <> 'app' or v.date <= public.bucharest_today() - 90 then
    perform public.fail('dispute_window_closed');
  end if;
  if exists (select 1 from public.no_show_disputes x where x.booking_id = v.id) then
    perform public.fail('already_disputed');
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    perform public.fail('reason_required', jsonb_build_object('min', 10));
  end if;
  if char_length(v_reason) > 1000 then
    perform public.fail('reason_too_long', jsonb_build_object('limit', 1000));
  end if;

  insert into public.no_show_disputes (booking_id, client_id, reason)
  values (v.id, v.client_id, v_reason)
  returning * into d;

  v_result := public.no_show_dispute_json(d);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.dispute_no_show(uuid, text, uuid) from public, anon;
grant execute on function public.dispute_no_show(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The admin's side (Moderare)
-- ---------------------------------------------------------------------------------------------
create function public.admin_no_show_dispute_json(p public.no_show_disputes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.no_show_dispute_json(p) || jsonb_build_object(
    'decision_note', p.decision_note,
    'decided_by', (select a.name from public.profiles a where a.id = p.decided_by),
    'booking', (select jsonb_build_object(
        'id', b.id, 'ref', b.ref, 'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'),
        'status_changed_at', b.status_changed_at, 'note', b.note, 'car_snapshot', b.car_snapshot,
        'service_ro', sv.name_ro, 'service_en', sv.name_en,
        'shop_id', s.id, 'shop_name', s.name, 'shop_city', s.city, 'shop_phone', s.phone)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.services sv on sv.id = b.service_id
      where b.id = p.booking_id),
    'client', (select jsonb_build_object(
        'id', c.id, 'display_id', c.display_id, 'name', c.name, 'phone', c.phone,
        'email', public.account_email(c.id),
        'no_shows', public.active_no_show_count(c.id),
        'disputes', (select count(*) from public.no_show_disputes x where x.client_id = c.id))
      from public.profiles c where c.id = p.client_id))
$$;
revoke execute on function public.admin_no_show_dispute_json(public.no_show_disputes) from public, anon, authenticated;

create function public.admin_list_no_show_disputes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'pending', coalesce((
      select jsonb_agg(public.admin_no_show_dispute_json(d) order by d.created_at, d.id)
      from public.no_show_disputes d where d.status = 'pending'), '[]'::jsonb),
    'decided', coalesce((
      select jsonb_agg(x.item order by x.decided_at desc, x.id)
      from (select d.id, d.decided_at, public.admin_no_show_dispute_json(d) as item
            from public.no_show_disputes d where d.status <> 'pending'
            order by d.decided_at desc, d.id limit 30) x), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_list_no_show_disputes() from public, anon;
grant execute on function public.admin_list_no_show_disputes() to authenticated;

-- upheld: the no-show is annulled (it no longer counts anywhere); rejected: it stays. The note is
-- internal. Audited; the client is told the outcome.
create function public.admin_decide_no_show_dispute(p_dispute_id uuid, p_decision text, p_note text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  d public.no_show_disputes%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_booking public.bookings%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_decide_no_show_dispute');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into d from public.no_show_disputes where id = p_dispute_id for update;
  if not found then
    perform public.fail('dispute_not_found');
  end if;
  if p_decision is null or p_decision not in ('upheld', 'rejected') then
    perform public.fail('decision_invalid');
  end if;
  if d.status <> 'pending' then
    perform public.fail('wrong_status', jsonb_build_object('status', d.status));
  end if;
  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;

  update public.no_show_disputes
    set status = p_decision, decided_at = now(), decided_by = auth.uid(), decision_note = v_note
  where id = d.id
  returning * into d;

  select * into v_booking from public.bookings where id = d.booking_id;
  perform public.notify_user(d.client_id, 'no_show_dispute_decided',
    public.booking_event_params(v_booking) || jsonb_build_object('decision', d.status), d.booking_id);
  perform public.admin_audit(case when d.status = 'upheld' then 'uphold_no_show_dispute' else 'reject_no_show_dispute' end,
    'no_show_dispute', d.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', d.status, 'booking_id', d.booking_id)
      || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
  v_result := public.admin_no_show_dispute_json(d);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_decide_no_show_dispute(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_decide_no_show_dispute(uuid, text, text, uuid) to authenticated;

create or replace function public.admin_list_clients()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'display_id', p.display_id,
        'name', p.name,
        'email', public.account_email(p.id),
        'phone', p.phone,
        'email_verified', p.email_verified_at is not null,
        'suspended', p.suspended,
        'created_at', p.created_at,
        'last_active_at', public.last_seen(p.id),
        'bookings', coalesce(c.total, 0),
        'active_bookings', coalesce(c.active, 0),
        'no_shows', public.active_no_show_count(p.id)
      ) order by p.created_at desc, p.id)
    from public.profiles p
    left join lateral (
      select count(*) as total,
             count(*) filter (where public.is_active_status(b.status)) as active
      from public.bookings b where b.client_id = p.id
    ) c on true
    where p.role = 'client' and p.deleted_at is null
  ), '[]'::jsonb);
end
$$;

-- The admin's morning email also counts the disputes waiting for a decision.
create or replace function public.admin_digest_counts(p_now timestamptz default now())
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
    'no_show_disputes', (select count(*) from public.no_show_disputes d where d.status = 'pending'),
    'new_shops', (select count(*) from public.shops s where s.created_at > p_now - interval '24 hours'),
    'new_clients', (select count(*) from public.profiles p
                    where p.role = 'client' and p.created_at > p_now - interval '24 hours'),
    'new_bookings', (select count(*) from public.bookings b where b.created_at > p_now - interval '24 hours'),
    'done', (select count(*) from public.bookings b where b.status = 'done' and b.done_at > p_now - interval '24 hours'))
$$;
revoke execute on function public.admin_digest_counts(timestamptz) from public, anon, authenticated;

create or replace function public.send_admin_digest(p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := public.admin_digest_counts(p_now);
begin
  if (v->>'reports')::int + (v->>'suspect')::int + (v->>'past_due')::int + (v->>'company_waiting')::int
     + (v->>'company_hidden')::int + (v->>'unanswered')::int + (v->>'no_show_disputes')::int = 0 then
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
-- The shop's lists: the same count on the card, from when a no-show may be marked, and the
-- dispute's status in the history.
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
          'client_no_shows', case when b.client_id is null then 0 else public.active_no_show_count(b.client_id) end,
          'no_show_from', case when b.status = 'confirmed' then public.no_show_from(b) end,
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
          'no_show_dispute', (select d.status from public.no_show_disputes d where d.booking_id = b.id),
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

update public.schema_version set version = 88;
