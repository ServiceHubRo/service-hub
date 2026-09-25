-- T14 — The subscription. ARCHITECTURE §2 (Money), §5, §10, §12; FR §4.7, §6; P12, P12b.
--
-- · Good standing (is_shop_public, get_shop_setup): active, past_due (Stripe is still retrying),
--   or the free period — which also covers a shop that already gave its card in the free period
--   (Stripe `trialing`): Stripe charges at the end of it and says so through the webhook.
-- · Stripe is the only source of paid states: the stripe-webhook Edge Function hands the
--   subscription it just read from Stripe to sync_stripe_subscription, which maps it to our
--   status, keeps shops.active in step and tells the owner when the shop leaves search.
--   Every paid invoice is recorded (invoices, with Stripe's receipt) and emailed; a failed
--   payment is recorded and sent by push + email.
-- · Scheduled: at 07:00 the warnings 7 days and 1 day before a free period ends (not when a card
--   is already given); every hour, free periods that ended without a card → inactive.
-- · The browser still has no write access to subscriptions or invoices; it reads them (owner,
--   admin) and follows them through Realtime.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.subscriptions
  -- Stripe's own status of stripe_subscription_id (trialing, active, past_due, unpaid, canceled, …).
  add column stripe_status text,
  add column ended_reason text check (ended_reason in ('trial_ended', 'payment_failed', 'cancelled')),
  add column status_changed_at timestamptz,
  add column payment_failed_at timestamptz,
  add column next_payment_attempt timestamptz,
  -- The last failed attempt already notified ("<invoice>:<attempt>"), so a webhook repeated by
  -- Stripe never sends the same warning twice.
  add column payment_failed_key text,
  -- Free-period warnings already sent, per end date: {"2026-12-24": [7, 1]}.
  add column trial_reminded jsonb not null default '{}'::jsonb;

create unique index subscriptions_stripe_customer_idx on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.invoices
  -- Stripe's receipt page for the payment. The fiscal invoice (SmartBill / Oblio, T14b) goes in
  -- series, number and pdf_url.
  add column receipt_url text,
  add column period_end timestamptz;
alter table public.invoices alter column status set default 'paid';
alter table public.invoices
  add constraint invoices_status_check check (status in ('paid', 'issued', 'failed', 'void'));

-- ---------------------------------------------------------------------------------------------
-- Good standing
-- ---------------------------------------------------------------------------------------------
create function public.subscription_ok(p_status text, p_trial_ends_at timestamptz, p_stripe_status text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_status in ('active', 'past_due')
    or (p_status = 'trial' and (p_trial_ends_at > now() or p_stripe_status = 'trialing')),
    false)
$$;

create or replace function public.is_shop_public(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shops s
    join public.profiles o on o.id = s.owner_id
    join public.subscriptions sub on sub.shop_id = s.id
    where s.id = p_shop_id
      and s.active
      and not s.suspended
      and not o.suspended
      and o.email_verified_at is not null
      and (o.phone_verified_at is not null or o.phone_verified_by_admin)
      and public.subscription_ok(sub.status, sub.trial_ends_at, sub.stripe_status)
      and exists (
        select 1 from public.shop_services ss
        join public.services sv on sv.id = ss.service_id
        where ss.shop_id = s.id and sv.enabled
      )
      and exists (
        select 1 from public.shop_hours h where h.shop_id = s.id and not h.is_closed
      )
  )
$$;

-- An outbox event for the owner of a shop (the subscription is the owner's business alone).
create function public.notify_shop_owner(p_shop_id uuid, p_event text, p_params jsonb,
                                         p_channels text[] default array['push', 'email'])
returns void
language sql
set search_path = ''
as $$
  insert into public.notification_events (user_id, event, params, channels)
  select s.owner_id, p_event,
         coalesce(p_params, '{}'::jsonb) || jsonb_build_object('shop_id', s.id, 'shop_name', s.name),
         p_channels
  from public.shops s
  join public.profiles o on o.id = s.owner_id
  where s.id = p_shop_id and o.deleted_at is null
$$;

-- Puts a subscription in a new status and shops.active in step with it (a shop whose owner
-- deleted the account stays inactive). Leaving good standing tells the owner why.
create function public.set_subscription_status(p_shop_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.subscriptions%rowtype;
  v_ok boolean := p_status in ('trial', 'active', 'past_due');
begin
  select * into v_old from public.subscriptions where shop_id = p_shop_id for update;
  if not found then
    return;
  end if;
  update public.subscriptions
    set status = p_status,
        ended_reason = case when v_ok then null else coalesce(p_reason, ended_reason) end,
        status_changed_at = case when status is distinct from p_status then now() else status_changed_at end
  where shop_id = p_shop_id;

  update public.shops s set active = v_ok and o.deleted_at is null
  from public.profiles o
  where s.id = p_shop_id and o.id = s.owner_id and s.active is distinct from (v_ok and o.deleted_at is null);

  if not v_ok and v_old.status in ('trial', 'active', 'past_due') then
    perform public.notify_shop_owner(p_shop_id, 'shop_inactive', jsonb_build_object('reason', p_reason));
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Stripe (service role only; called by the Edge Functions after they checked the caller or the
-- webhook signature)
-- ---------------------------------------------------------------------------------------------

-- What stripe-checkout and stripe-portal need about the caller's shop. Only the owner of a shop
-- gets an answer; staff, clients, suspended and deleted accounts get not_allowed.
create function public.subscription_checkout_info(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_sub public.subscriptions%rowtype;
  v_billing public.shop_billing%rowtype;
begin
  select * into v_me from public.profiles where id = p_user_id;
  if not found or v_me.role <> 'shop' or v_me.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  if v_me.suspended then
    perform public.fail('account_suspended');
  end if;
  select * into v_shop from public.shops where owner_id = p_user_id;
  if not found then
    perform public.fail('not_allowed');
  end if;
  select * into v_sub from public.subscriptions where shop_id = v_shop.id;
  if not found then
    perform public.fail('not_allowed');
  end if;
  select * into v_billing from public.shop_billing where shop_id = v_shop.id;
  return jsonb_build_object(
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'display_id', v_me.display_id,
    'lang', v_me.lang,
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'price_ron', v_sub.price_ron,
    'status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at,
    'stripe_customer_id', v_sub.stripe_customer_id,
    'stripe_subscription_id', v_sub.stripe_subscription_id,
    'stripe_status', v_sub.stripe_status,
    'billing_complete', coalesce(nullif(btrim(v_billing.legal_name), '') is not null
      and v_billing.vat_id is not null and v_billing.reg_com is not null
      and nullif(btrim(v_billing.legal_address), '') is not null
      and v_billing.billing_email is not null, false),
    'legal_name', v_billing.legal_name,
    'vat_id', v_billing.vat_id,
    'billing_email', v_billing.billing_email
  );
end
$$;

-- Records the Stripe customer made for a shop. The first one wins (two taps at once make one
-- customer each; the second is never used). Answers the customer id to use.
create function public.set_stripe_customer(p_shop_id uuid, p_customer_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text;
begin
  update public.subscriptions set stripe_customer_id = p_customer_id
  where shop_id = p_shop_id and stripe_customer_id is null;
  select stripe_customer_id into v from public.subscriptions where shop_id = p_shop_id;
  return v;
end
$$;

-- The webhook's idempotency: true when the event has not been handled yet. A repeated delivery
-- of a handled event answers false and the function does nothing.
create function public.stripe_event_begin(p_id text, p_type text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_events (id, type, payload) values (p_id, p_type, p_payload)
  on conflict (id) do nothing;
  return (select processed_at is null from public.stripe_events where id = p_id);
end
$$;

create function public.stripe_event_done(p_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_events set processed_at = coalesce(processed_at, now()) where id = p_id
$$;

-- The subscription row a Stripe customer belongs to; p_shop_id (the checkout's own reference)
-- only when that shop has no customer yet or the same one.
create function public.subscription_for_customer(p_customer text, p_shop_id uuid default null)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscriptions%rowtype;
begin
  select * into v from public.subscriptions where stripe_customer_id = p_customer for update;
  if not found and p_shop_id is not null then
    select * into v from public.subscriptions
    where shop_id = p_shop_id and (stripe_customer_id is null or stripe_customer_id = p_customer)
    for update;
  end if;
  return v;
end
$$;

-- Applies the subscription as Stripe has it now (the webhook reads it from Stripe, so events
-- arriving out of order change nothing). p_sub:
--   { id, status, cancel_at_period_end, current_period_end, trial_end, cancellation_reason }
-- Stripe → ours: trialing → trial · active → active · past_due → past_due (still visible while
-- Stripe retries) · canceled / unpaid / incomplete_expired / paused → cancelled when the owner
-- cancelled, else inactive (payment failed); an end inside our free period gives the rest of
-- the free period back. incomplete (a checkout still waiting, e.g. 3-D Secure) changes nothing.
-- The end of an older subscription never touches a newer live one.
-- Answers the subscription row, or null for a customer we do not know.
create function public.sync_stripe_subscription(p_customer text, p_shop_id uuid, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscriptions%rowtype;
  v_id text := p_sub->>'id';
  v_stripe text := p_sub->>'status';
  v_live boolean := (p_sub->>'status') in ('trialing', 'active', 'past_due');
  v_status text;
  v_reason text;
begin
  v := public.subscription_for_customer(p_customer, p_shop_id);
  if v.shop_id is null or v_id is null or v_stripe is null then
    return null;
  end if;
  if v_stripe = 'incomplete' then
    return to_jsonb(v);
  end if;
  if not v_live and v.stripe_subscription_id is not null and v.stripe_subscription_id <> v_id
     and v.stripe_status in ('trialing', 'active', 'past_due') then
    return to_jsonb(v);
  end if;

  if v_stripe = 'trialing' then
    v_status := 'trial';
  elsif v_stripe = 'active' then
    v_status := 'active';
  elsif v_stripe = 'past_due' then
    v_status := 'past_due';
  elsif v.status = 'trial' and v.trial_ends_at > now() then
    v_status := 'trial';
  elsif coalesce(p_sub->>'cancellation_reason', '') = 'cancellation_requested'
        or coalesce((p_sub->>'cancel_at_period_end')::boolean, false) then
    v_status := 'cancelled';
    v_reason := 'cancelled';
  else
    v_status := 'inactive';
    v_reason := 'payment_failed';
  end if;

  update public.subscriptions
    set stripe_customer_id = p_customer,
        stripe_subscription_id = v_id,
        stripe_status = v_stripe,
        cancel_at_period_end = v_live and coalesce((p_sub->>'cancel_at_period_end')::boolean, false),
        current_period_end = coalesce(nullif(p_sub->>'current_period_end', '')::timestamptz, current_period_end),
        payment_failed_at = case when v_stripe in ('active', 'trialing') then null else payment_failed_at end,
        next_payment_attempt = case when v_stripe in ('active', 'trialing') then null else next_payment_attempt end
  where shop_id = v.shop_id;
  perform public.set_subscription_status(v.shop_id, v_status, v_reason);

  select * into v from public.subscriptions where shop_id = v.shop_id;
  return to_jsonb(v);
end
$$;

-- A paid invoice. p_invoice: { id, number, amount_paid, tax, currency, paid_at, receipt_url,
-- period_end }. Invoices of 0 (the start of a free period) are not recorded. The first time an
-- invoice is seen the owner gets the payment email. Answers the invoice row (or null).
create function public.record_stripe_invoice(p_customer text, p_invoice jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscriptions%rowtype;
  v_amount numeric := round(coalesce((p_invoice->>'amount_paid')::numeric, 0), 2);
  v_row public.invoices%rowtype;
begin
  v := public.subscription_for_customer(p_customer);
  if v.shop_id is null or p_invoice->>'id' is null then
    return null;
  end if;
  update public.subscriptions set payment_failed_at = null, next_payment_attempt = null
  where shop_id = v.shop_id;
  if v_amount <= 0 then
    return null;
  end if;

  insert into public.invoices (shop_id, amount, vat_amount, currency, issued_at, provider, provider_ref,
                               stripe_invoice_id, status, receipt_url, period_end)
  values (v.shop_id, v_amount, round(greatest(coalesce((p_invoice->>'tax')::numeric, 0), 0), 2),
          upper(coalesce(nullif(p_invoice->>'currency', ''), 'RON')),
          coalesce(nullif(p_invoice->>'paid_at', '')::timestamptz, now()),
          'stripe', p_invoice->>'number', p_invoice->>'id', 'paid',
          nullif(p_invoice->>'receipt_url', ''), nullif(p_invoice->>'period_end', '')::timestamptz)
  on conflict (stripe_invoice_id) do nothing
  returning * into v_row;

  if found then
    perform public.notify_shop_owner(v.shop_id, 'invoice_paid', jsonb_build_object(
      'total', v_row.amount,
      'number', v_row.provider_ref,
      'receipt_url', v_row.receipt_url,
      'paid_at', v_row.issued_at,
      'period_end', v_row.period_end), array['email']);
  else
    select * into v_row from public.invoices where stripe_invoice_id = p_invoice->>'id';
  end if;
  return to_jsonb(v_row);
end
$$;

-- A failed payment. p_invoice: { id, amount_due, attempt_count, next_payment_attempt }. The owner
-- is told once per attempt (push + email), with the date of the next try when there is one.
create function public.record_payment_failed(p_customer text, p_invoice jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscriptions%rowtype;
  v_key text := (p_invoice->>'id') || ':' || coalesce(p_invoice->>'attempt_count', '0');
  v_next timestamptz := nullif(p_invoice->>'next_payment_attempt', '')::timestamptz;
begin
  v := public.subscription_for_customer(p_customer);
  if v.shop_id is null or p_invoice->>'id' is null then
    return false;
  end if;
  update public.subscriptions
    set payment_failed_at = now(), next_payment_attempt = v_next, payment_failed_key = v_key
  where shop_id = v.shop_id;
  if v.payment_failed_key is not distinct from v_key then
    return false;
  end if;
  perform public.notify_shop_owner(v.shop_id, 'payment_failed', jsonb_build_object(
    'total', round(coalesce((p_invoice->>'amount_due')::numeric, 0), 2),
    'final', v_next is null,
    'expiry', to_char(v_next at time zone 'Europe/Bucharest', 'YYYY-MM-DD')));
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Scheduled: free-period warnings and ends
-- ---------------------------------------------------------------------------------------------

-- 7 days and 1 day before the free period ends (push + email to the owner), once per threshold
-- and end date; the smallest threshold reached is the one sent (a free period extended to 5 days
-- gets one warning, not two). Not sent when a card is already given (Stripe `trialing`).
create function public.send_trial_warnings(p_now timestamptz default now())
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
      'days', v_days, 'expiry', v_key, 'trial_ends_at', r.trial_ends_at, 'price', r.price_ron));
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- Free periods that ended without a card → inactive (the shop already left search at the end
-- time; this records it, sets shops.active and tells the owner).
create function public.end_expired_trials(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select sub.shop_id from public.subscriptions sub
    where sub.status = 'trial'
      and sub.trial_ends_at <= p_now
      and coalesce(sub.stripe_status, '') not in ('trialing', 'active', 'past_due')
  loop
    perform public.set_subscription_status(r.shop_id, 'inactive', 'trial_ended');
    v_n := v_n + 1;
  end loop;
  return v_n;
end
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
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'trial_warnings', public.send_trial_warnings(p_now),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Panou: the reasons mirror is_shop_public; "shop_inactive" only when the subscription is not
-- the cause (it has its own reason). The owner also gets where the subscription stands.
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_shop_setup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_owner public.profiles%rowtype;
  v_sub public.subscriptions%rowtype;
  v_billing public.shop_billing%rowtype;
  v_settings public.platform_settings%rowtype;
  v_is_owner boolean;
  v_services boolean;
  v_open_day boolean;
  v_phone boolean;
  v_sub_ok boolean;
  v_reasons text[] := '{}';
  v_billing_complete boolean;
  v_result jsonb;
begin
  perform public.require_caller();
  select * into v_shop from public.shops where id = public.require_my_shop();
  select * into v_owner from public.profiles where id = v_shop.owner_id;
  select * into v_sub from public.subscriptions where shop_id = v_shop.id;
  select * into v_settings from public.platform_settings where id = 1;
  v_is_owner := v_shop.owner_id = auth.uid();

  v_services := exists (
    select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
    where ss.shop_id = v_shop.id and sv.enabled
  );
  v_open_day := exists (select 1 from public.shop_hours h where h.shop_id = v_shop.id and not h.is_closed);
  v_phone := v_owner.phone_verified_at is not null or v_owner.phone_verified_by_admin;
  v_sub_ok := v_sub.shop_id is not null and public.subscription_ok(v_sub.status, v_sub.trial_ends_at, v_sub.stripe_status);

  if v_owner.suspended then v_reasons := array_append(v_reasons, 'account_suspended'); end if;
  if v_shop.suspended then v_reasons := array_append(v_reasons, 'shop_suspended'); end if;
  if not v_shop.active and v_sub_ok then v_reasons := array_append(v_reasons, 'shop_inactive'); end if;
  if not v_sub_ok then v_reasons := array_append(v_reasons, 'subscription_inactive'); end if;
  if v_owner.email_verified_at is null then v_reasons := array_append(v_reasons, 'email_unverified'); end if;
  if not v_phone then v_reasons := array_append(v_reasons, 'phone_unverified'); end if;
  if not v_services then v_reasons := array_append(v_reasons, 'no_services'); end if;
  if not v_open_day then v_reasons := array_append(v_reasons, 'no_open_days'); end if;

  if v_shop.setup_completed_at is null
     and v_services and v_shop.hours_reviewed_at is not null
     and v_shop.capacity_reviewed_at is not null and v_phone then
    update public.shops set setup_completed_at = now() where id = v_shop.id
      returning * into v_shop;
  end if;

  v_result := jsonb_build_object(
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'is_owner', v_is_owner,
    'daily_capacity', v_shop.daily_capacity,
    'steps', jsonb_build_object(
      'services', v_services,
      'hours', v_shop.hours_reviewed_at is not null,
      'capacity', v_shop.capacity_reviewed_at is not null,
      'phone', v_phone),
    'owner_phone', v_owner.phone,
    'setup_completed', v_shop.setup_completed_at is not null,
    'public', public.is_shop_public(v_shop.id),
    'reasons', to_jsonb(v_reasons),
    'subscription_status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at
  );

  if v_is_owner then
    select * into v_billing from public.shop_billing where shop_id = v_shop.id;
    v_billing_complete := coalesce(nullif(btrim(v_billing.legal_name), '') is not null
      and v_billing.vat_id is not null and v_billing.reg_com is not null
      and nullif(btrim(v_billing.legal_address), '') is not null
      and v_billing.billing_email is not null, false);
    v_result := v_result || jsonb_build_object(
      'billing', jsonb_build_object(
        'complete', v_billing_complete,
        'reminder', not v_billing_complete
          and v_sub.status = 'trial'
          and now() >= v_sub.trial_ends_at - make_interval(days => greatest(v_settings.trial_days - 60, 0))
          and (v_shop.billing_reminder_dismissed_at is null
               or v_shop.billing_reminder_dismissed_at < now() - interval '7 days')),
      'subscription', jsonb_build_object(
        'status', v_sub.status,
        'trial_ends_at', v_sub.trial_ends_at,
        'card_given', coalesce(v_sub.stripe_status in ('trialing', 'active', 'past_due'), false),
        'ended_reason', v_sub.ended_reason));
  end if;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Realtime: the Abonament screen follows its row and its invoices (RLS: owner and admin).
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['subscriptions', 'invoices'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

revoke execute on function
  public.notify_shop_owner(uuid, text, jsonb, text[]),
  public.set_subscription_status(uuid, text, text),
  public.subscription_checkout_info(uuid),
  public.set_stripe_customer(uuid, text),
  public.stripe_event_begin(text, text, jsonb),
  public.stripe_event_done(text),
  public.subscription_for_customer(text, uuid),
  public.sync_stripe_subscription(text, uuid, jsonb),
  public.record_stripe_invoice(text, jsonb),
  public.record_payment_failed(text, jsonb),
  public.send_trial_warnings(timestamptz),
  public.end_expired_trials(timestamptz)
from public, anon, authenticated;
revoke execute on function public.subscription_ok(text, timestamptz, text) from public, anon, authenticated;
grant execute on function
  public.subscription_checkout_info(uuid),
  public.set_stripe_customer(uuid, text),
  public.stripe_event_begin(text, text, jsonb),
  public.stripe_event_done(text),
  public.sync_stripe_subscription(text, uuid, jsonb),
  public.record_stripe_invoice(text, jsonb),
  public.record_payment_failed(text, jsonb)
to service_role;

update public.schema_version set version = 19;
