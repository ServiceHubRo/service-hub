-- Paid staff accounts (requested by Eduard after T16b). FR §4.7; ARCHITECTURE §2 (Money), §12.
--
-- The subscription is the shop's monthly price plus a price per colleague who has an account in
-- the shop: 100 lei with no colleague, 120 lei with one, 140 lei with two… An invitation costs
-- nothing; a colleague counts from the moment their account joins the shop (accepted_at) until
-- they are removed or delete their account. In the free period nothing is paid, colleagues neither.
--
-- · platform_settings.staff_seat_price_ron (20 lei, changed from Setări platformă) is copied onto
--   each subscription when the shop signs up (subscriptions.seat_price_ron), like price_ron: a
--   later change never touches a shop that already exists.
-- · subscriptions.seats is kept equal to the shop's colleagues with an account by a trigger on
--   shop_staff; subscriptions.billed_seats is what Stripe charges now (set when it is synced).
-- · When seats change and Stripe runs the subscription, a `seats_changed` outbox event with the
--   `stripe` channel asks dispatch-notifications to set the quantity of the "Cont angajat" item
--   in Stripe (prorated by day both ways). Stripe Checkout starts with the current seats; the
--   webhook re-checks them when a subscription starts (a colleague joining while Checkout was open).

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.platform_settings
  add column staff_seat_price_ron numeric(10,2) not null default 20 check (staff_seat_price_ron >= 0);

alter table public.subscriptions
  add column seat_price_ron numeric(10,2) not null default 20 check (seat_price_ron >= 0),
  add column seats int not null default 0 check (seats >= 0),
  add column billed_seats int check (billed_seats >= 0);

-- The outbox learns a channel for Stripe (the seat quantity).
alter table public.notifications_log drop constraint notifications_log_channel_check;
alter table public.notifications_log
  add constraint notifications_log_channel_check check (channel in ('push', 'email', 'sms', 'stripe'));

-- ---------------------------------------------------------------------------------------------
-- Counting
-- ---------------------------------------------------------------------------------------------

-- Colleagues who pay: staff (not the owner) whose account has joined the shop.
create function public.shop_seat_count(p_shop_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.shop_staff st
  where st.shop_id = p_shop_id and st.role = 'staff' and st.user_id is not null and st.accepted_at is not null
$$;
revoke execute on function public.shop_seat_count(uuid) from public, anon, authenticated;

-- What the shop pays a month: its price plus its colleagues.
create function public.subscription_monthly_ron(p public.subscriptions)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select p.price_ron + p.seats * p.seat_price_ron
$$;
revoke execute on function public.subscription_monthly_ron(public.subscriptions) from public, anon, authenticated;

-- A new subscription (a shop signing up) takes today's price per colleague.
create function public.subscriptions_seat_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.seat_price_ron := coalesce((select ps.staff_seat_price_ron from public.platform_settings ps where ps.id = 1), 20);
  new.seats := coalesce(public.shop_seat_count(new.shop_id), 0);
  return new;
end
$$;
create trigger subscriptions_seat_price before insert on public.subscriptions
  for each row execute function public.subscriptions_seat_price();

-- The team changed: recount the shop's paying colleagues.
create function public.shop_staff_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.subscriptions set seats = public.shop_seat_count(old.shop_id)
    where shop_id = old.shop_id and seats is distinct from public.shop_seat_count(old.shop_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.subscriptions set seats = public.shop_seat_count(new.shop_id)
    where shop_id = new.shop_id and seats is distinct from public.shop_seat_count(new.shop_id);
  end if;
  return null;
end
$$;
create trigger shop_staff_seats after insert or update or delete on public.shop_staff
  for each row execute function public.shop_staff_seats();

-- The seats changed while Stripe runs the subscription: ask for the quantity to be set (once;
-- one waiting request is enough, it reads the count when it runs).
create function public.subscriptions_seats_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if new.seats is not distinct from old.seats
     or new.stripe_subscription_id is null
     or coalesce(new.stripe_status, '') not in ('trialing', 'active', 'past_due') then
    return null;
  end if;
  if exists (select 1 from public.notification_events e
             where e.event = 'seats_changed' and e.processed_at is null and e.params->>'shop_id' = new.shop_id::text) then
    return null;
  end if;
  select s.owner_id into v_owner from public.shops s where s.id = new.shop_id;
  insert into public.notification_events (user_id, event, params, channels)
  values (v_owner, 'seats_changed', jsonb_build_object('shop_id', new.shop_id), array['stripe']);
  return null;
end
$$;
create trigger subscriptions_seats_changed after update of seats on public.subscriptions
  for each row execute function public.subscriptions_seats_changed();

-- Shops that already have colleagues.
update public.subscriptions sub set seats = public.shop_seat_count(sub.shop_id)
where sub.seats is distinct from public.shop_seat_count(sub.shop_id);

-- ---------------------------------------------------------------------------------------------
-- For the Edge Functions (service role): what Stripe should charge for colleagues, and what it does
-- ---------------------------------------------------------------------------------------------

-- By shop, or by Stripe customer (the webhook knows only the customer).
create function public.stripe_seat_info(p_shop_id uuid default null, p_customer text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shop_id', sub.shop_id,
    'seats', sub.seats,
    'seat_price_ron', sub.seat_price_ron,
    'billed_seats', sub.billed_seats,
    'stripe_subscription_id', sub.stripe_subscription_id,
    'stripe_status', sub.stripe_status)
  from public.subscriptions sub
  where (p_shop_id is not null and sub.shop_id = p_shop_id)
     or (p_shop_id is null and p_customer is not null and sub.stripe_customer_id = p_customer)
  limit 1
$$;

create function public.set_billed_seats(p_shop_id uuid, p_seats int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscriptions set billed_seats = p_seats
  where shop_id = p_shop_id and billed_seats is distinct from p_seats
$$;

revoke execute on function public.stripe_seat_info(uuid, text), public.set_billed_seats(uuid, int)
  from public, anon, authenticated;
grant execute on function public.stripe_seat_info(uuid, text), public.set_billed_seats(uuid, int) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The monthly total where money is shown: the trial warning's price, the admin's lists and MRR,
-- the price per colleague among the platform settings.
-- ---------------------------------------------------------------------------------------------

create or replace function public.send_trial_warnings(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  r record;
  v_end date;
  v_days int;
  v_threshold int;
  v_key text;
  v_sent jsonb;
  v_n int := 0;
begin
  for r in
    select sub.* from public.subscriptions sub
    join public.shops s on s.id = sub.shop_id
    join public.profiles o on o.id = s.owner_id
    where sub.status = 'trial'
      and sub.trial_ends_at > p_now
      and sub.trial_ends_at <= p_now + interval '8 days'
      and coalesce(sub.stripe_status, '') <> 'trialing'
      and o.deleted_at is null
    for update of sub
  loop
    v_end := (r.trial_ends_at at time zone 'Europe/Bucharest')::date;
    v_days := v_end - v_today;
    if v_days > 7 then
      continue;
    end if;
    v_threshold := case when v_days <= 1 then 1 else 7 end;
    v_key := v_end::text;
    v_sent := coalesce(r.trial_reminded->v_key, '[]'::jsonb);
    if v_sent @> to_jsonb(v_threshold) then
      continue;
    end if;
    update public.subscriptions
      set trial_reminded = jsonb_build_object(v_key,
            (select jsonb_agg(distinct t order by t desc)
             from (select jsonb_array_elements(v_sent) as t
                   union select to_jsonb(x) from unnest(array[7, 1]) x where x >= v_threshold) q))
    where shop_id = r.shop_id;
    perform public.notify_shop_owner(r.shop_id, 'trial_ending', jsonb_build_object(
      'days', v_days, 'expiry', v_key, 'trial_ends_at', r.trial_ends_at, 'price', r.price_ron + r.seats * r.seat_price_ron));
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := public.bucharest_today()::timestamp at time zone 'Europe/Bucharest';
  v_shops jsonb;
  v_bookings jsonb;
  v_subs jsonb;
  v_activity jsonb;
begin
  perform public.require_admin();

  select jsonb_build_object(
      'active', count(*) filter (where st = 'active'),
      'trial', count(*) filter (where st = 'trial'),
      'inactive', count(*) filter (where st = 'inactive'),
      'suspended', count(*) filter (where st = 'suspended'),
      'total', count(*) filter (where st <> 'deleted'))
    into v_shops
  from (select public.shop_state(s.id) as st from public.shops s) x;

  -- New bookings (by the day they were made, in Bucharest), with their status now.
  select jsonb_object_agg(w.name, jsonb_build_object(
           'total', (select count(*) from public.bookings b where b.created_at >= w.since),
           'by_status', coalesce((select jsonb_object_agg(c.status, c.n) from (
               select b.status, count(*) as n from public.bookings b where b.created_at >= w.since group by b.status) c),
             '{}'::jsonb)))
    into v_bookings
  from (values ('today', v_today),
               ('week', v_today - interval '6 days'),
               ('month', v_today - interval '29 days')) w(name, since);

  select jsonb_build_object(
      'active', count(*) filter (where sub.status = 'active'),
      'past_due', count(*) filter (where sub.status = 'past_due'),
      'trial', count(*) filter (where sub.status = 'trial' and sub.trial_ends_at > now()),
      'trial_ending', count(*) filter (where sub.status = 'trial' and sub.trial_ends_at > now()
                                         and sub.trial_ends_at <= now() + interval '7 days'),
      'mrr', coalesce(sum(public.subscription_monthly_ron(sub)) filter (where sub.status in ('active', 'past_due')), 0))
    into v_subs
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  join public.profiles o on o.id = s.owner_id
  where o.deleted_at is null;

  -- The last 50 things worth knowing: new shops and clients, new bookings, reported reviews,
  -- failed payments.
  select coalesce(jsonb_agg(a.item order by a.at desc), '[]'::jsonb) into v_activity
  from (
    select * from (
      (select s.created_at as at, jsonb_build_object('kind', 'shop_created', 'at', s.created_at, 'id', s.id,
                'name', s.name, 'city', s.city) as item
       from public.shops s order by s.created_at desc limit 50)
      union all
      (select p.created_at, jsonb_build_object('kind', 'client_created', 'at', p.created_at, 'id', p.id,
                'name', p.name, 'display_id', p.display_id)
       from public.profiles p where p.role = 'client' and p.deleted_at is null order by p.created_at desc limit 50)
      union all
      (select b.created_at, jsonb_build_object('kind', 'booking_created', 'at', b.created_at, 'id', b.id,
                'ref', b.ref, 'name', s.name, 'status', b.status, 'service_ro', sv.name_ro, 'service_en', sv.name_en)
       from public.bookings b join public.shops s on s.id = b.shop_id left join public.services sv on sv.id = b.service_id
       order by b.created_at desc limit 50)
      union all
      (select r.reported_at, jsonb_build_object('kind', 'review_reported', 'at', r.reported_at, 'id', r.id,
                'name', s.name, 'reason', r.report_reason, 'rating', r.rating, 'status', r.report_status)
       from public.reviews r join public.shops s on s.id = r.shop_id
       where r.reported_at is not null order by r.reported_at desc limit 50)
      union all
      (select sub.payment_failed_at, jsonb_build_object('kind', 'payment_failed', 'at', sub.payment_failed_at,
                'id', s.id, 'name', s.name)
       from public.subscriptions sub join public.shops s on s.id = sub.shop_id
       where sub.payment_failed_at is not null order by sub.payment_failed_at desc limit 50)
    ) u
    order by at desc
    limit 50
  ) a;

  return jsonb_build_object(
    'shops', v_shops,
    'clients', (select count(*) from public.profiles where role = 'client' and deleted_at is null),
    'bookings', v_bookings,
    'reports_pending', (select count(*) from public.reviews where report_status = 'pending'),
    'subscriptions', v_subs,
    'activity', v_activity);
end
$$;

create or replace function public.admin_subscription_rows()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'shop_id', s.id,
      'shop_name', s.name,
      'city', s.city,
      'display_id', o.display_id,
      'owner_name', o.name,
      'email', public.account_email(o.id),
      'state', public.shop_state(s.id),
      'status', sub.status,
      'stripe_status', sub.stripe_status,
      'price_ron', sub.price_ron,
      'seat_price_ron', sub.seat_price_ron,
      'seats', sub.seats,
      'billed_seats', sub.billed_seats,
      'monthly_ron', public.subscription_monthly_ron(sub),
      'trial_ends_at', sub.trial_ends_at,
      'current_period_end', sub.current_period_end,
      'cancel_at_period_end', sub.cancel_at_period_end,
      'next_payment_attempt', sub.next_payment_attempt,
      'next_billing', public.subscription_next_billing(sub),
      'payment_failed_at', sub.payment_failed_at,
      'ended_reason', sub.ended_reason,
      'status_changed_at', sub.status_changed_at,
      'stripe_customer_id', sub.stripe_customer_id,
      'stripe_subscription_id', sub.stripe_subscription_id,
      'paid_count', coalesce(i.n, 0),
      'paid_total', coalesce(i.total, 0),
      'created_at', s.created_at
    ) order by s.name, s.id), '[]'::jsonb)
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  join public.profiles o on o.id = s.owner_id
  left join lateral (
    select count(*) as n, sum(inv.amount) as total from public.invoices inv
    where inv.shop_id = s.id and inv.status in ('paid', 'issued')
  ) i on true
$$;

create or replace function public.admin_update_settings(p_settings jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] := array['subscription_price_ron', 'trial_days', 'quote_expiry_days', 'report_price_ron',
    'vat_rate_percent', 'ranking_prior_avg', 'ranking_prior_weight', 'default_daily_capacity', 'default_cars_per_slot',
    'default_slot_minutes', 'default_min_notice_hours', 'default_max_advance_days', 'default_cancel_deadline_hours',
    'staff_seat_price_ron'];
  v_seen jsonb;
  v_old public.platform_settings%rowtype;
  v_new public.platform_settings%rowtype;
  v_in jsonb := coalesce(p_settings, '{}'::jsonb);
  v_key text;
  v_value jsonb;
  v_limits jsonb;
  v_n numeric;
  v_diff jsonb;
  v_limits_before jsonb := '{}'::jsonb;
  v_limits_after jsonb := '{}'::jsonb;
  v_constraint text;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_settings');
  if v_seen is not null then
    return v_seen;
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end if;
  select * into v_old from public.platform_settings where id = 1 for update;

  for v_key, v_value in select key, value from jsonb_each(v_in) loop
    if v_key = 'limits' then
      if jsonb_typeof(v_value) <> 'object' then
        perform public.fail('field_invalid', jsonb_build_object('field', 'limits'));
      end if;
    elsif not v_key = any (v_keys) then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    elsif jsonb_typeof(v_value) <> 'number' then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
  end loop;

  -- Limits: known keys only, whole numbers in their range; the others stay.
  v_limits := v_old.limits;
  for v_key, v_value in select key, value from jsonb_each(coalesce(v_in->'limits', '{}'::jsonb)) loop
    if public.limit_range(v_key) is null or jsonb_typeof(v_value) <> 'number' then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
    v_n := (v_value #>> '{}')::numeric;
    if v_n <> trunc(v_n) or not public.limit_range(v_key) @> v_n::int then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
    if v_limits->v_key is distinct from to_jsonb(v_n::int) then
      v_limits_before := v_limits_before || jsonb_build_object(v_key, v_limits->v_key);
      v_limits_after := v_limits_after || jsonb_build_object(v_key, v_n::int);
      v_limits := v_limits || jsonb_build_object(v_key, v_n::int);
    end if;
  end loop;

  -- Whole days, hours and places.
  foreach v_key in array array['trial_days', 'quote_expiry_days', 'default_daily_capacity', 'default_cars_per_slot',
    'default_slot_minutes', 'default_min_notice_hours', 'default_max_advance_days', 'default_cancel_deadline_hours'] loop
    if v_in ? v_key and (v_in->>v_key)::numeric <> trunc((v_in->>v_key)::numeric) then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
  end loop;

  begin
    v_new := jsonb_populate_record(v_old, v_in - 'limits');
    update public.platform_settings set
      subscription_price_ron = v_new.subscription_price_ron,
      staff_seat_price_ron = v_new.staff_seat_price_ron,
      trial_days = v_new.trial_days,
      quote_expiry_days = v_new.quote_expiry_days,
      report_price_ron = v_new.report_price_ron,
      vat_rate_percent = v_new.vat_rate_percent,
      ranking_prior_avg = v_new.ranking_prior_avg,
      ranking_prior_weight = v_new.ranking_prior_weight,
      default_daily_capacity = v_new.default_daily_capacity,
      default_cars_per_slot = v_new.default_cars_per_slot,
      default_slot_minutes = v_new.default_slot_minutes,
      default_min_notice_hours = v_new.default_min_notice_hours,
      default_max_advance_days = v_new.default_max_advance_days,
      default_cancel_deadline_hours = v_new.default_cancel_deadline_hours,
      limits = v_limits,
      updated_by = auth.uid()
    where id = 1
    returning * into v_new;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics v_constraint = constraint_name;
      perform public.fail('field_invalid', jsonb_build_object('field', coalesce(
        nullif(regexp_replace(coalesce(v_constraint, ''), '^platform_settings_(.*)_check$', '\1'), ''), 'unknown')));
    when invalid_text_representation or numeric_value_out_of_range then
      perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end;
  -- A price must be at least 1 leu (Stripe cannot charge less).
  if v_new.subscription_price_ron < 1 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'subscription_price_ron'));
  end if;
  if v_new.report_price_ron < 1 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'report_price_ron'));
  end if;

  v_diff := public.jsonb_changes(to_jsonb(v_old), to_jsonb(v_new), v_keys);
  if v_limits_after <> '{}'::jsonb then
    v_diff := jsonb_build_object(
      'before', (v_diff->'before') || jsonb_build_object('limits', v_limits_before),
      'after', (v_diff->'after') || jsonb_build_object('limits', v_limits_after));
  end if;
  if v_diff->'after' <> '{}'::jsonb then
    perform public.admin_audit_key('update_settings', 'settings', null, v_diff->'before', v_diff->'after');
  end if;
  v_result := to_jsonb(v_new);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

update public.schema_version set version = 23;
