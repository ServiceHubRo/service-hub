-- Raport ANAF, automated (Eduard, 2 oct): the admin should not have to chase every company by hand.
--
-- · The VAT tick follows ANAF: a check that knows whether the company pays VAT sets shop_billing.vat_payer.
-- · A company ANAF does not know, struck off or inactive for tax: the owner is told once (email and
--   push) and has company_fix_days (14) to fix the CUI in Date de facturare. If ANAF still says so on a
--   check from the last two days when the time is up, the shop leaves the search (anaf_hidden_at;
--   is_shop_public, "company_unconfirmed" in the reasons) and the owner is told. Bookings already made,
--   the account and the data stay. As soon as ANAF confirms the company again, the shop is back and the
--   owner is told. ANAF slow or down never counts: nothing is recorded, nothing happens.
-- · Another name at ANAF: the owner is told once to fix the legal name; nothing else happens.
-- · Every day at 06:xx Bucharest, run_hourly_jobs asks verify-company (with the dispatcher's token) to
--   check, in one ANAF request, the companies due: past their deadline, hidden, never answered, or
--   last checked more than company_recheck_days (30) ago. At 08:xx the deadlines are enforced.

alter table public.shop_billing
  -- The company could not be confirmed (not found, struck off, inactive) since then; kept across CUI edits.
  add column anaf_problem_since timestamptz,
  -- Out of the search because the company stayed unconfirmed past the deadline.
  add column anaf_hidden_at timestamptz,
  -- The owner was told about another name at ANAF (once per legal name / CUI).
  add column anaf_name_notified_at timestamptz;

update public.platform_settings
  set limits = limits || '{"company_fix_days": 14, "company_recheck_days": 30}'::jsonb
  where id = 1;

-- The day the company must be fixed by (Bucharest): the problem's start + company_fix_days.
create function public.company_fix_deadline(p_since timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select ((p_since + make_interval(days => public.app_limit('company_fix_days', 14))) at time zone 'Europe/Bucharest')::date
$$;
revoke execute on function public.company_fix_deadline(timestamptz) from public, anon, authenticated;

-- What a recorded ANAF answer leads to (called by record_company_check, same transaction).
create function public.company_check_consequences(p_billing public.shop_billing)
returns public.shop_billing
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.shop_billing := p_billing;
  v_params jsonb;
begin
  -- The VAT tick follows ANAF.
  if b.anaf_vat_payer is not null and b.vat_payer is distinct from b.anaf_vat_payer then
    update public.shop_billing set vat_payer = b.anaf_vat_payer where shop_id = b.shop_id returning * into b;
  end if;

  if b.anaf_status in ('not_found', 'deregistered', 'inactive') then
    if b.anaf_problem_since is null then
      update public.shop_billing set anaf_problem_since = now() where shop_id = b.shop_id returning * into b;
      v_params := jsonb_build_object('status', b.anaf_status, 'cui', b.vat_id,
        'days', public.app_limit('company_fix_days', 14), 'expiry', public.company_fix_deadline(b.anaf_problem_since));
      perform public.notify_shop_owner(b.shop_id, 'company_problem', v_params);
    end if;
  elsif b.anaf_status = 'active' then
    if b.anaf_hidden_at is not null then
      perform public.notify_shop_owner(b.shop_id, 'company_ok', jsonb_build_object('cui', b.vat_id));
    end if;
    if b.anaf_problem_since is not null or b.anaf_hidden_at is not null then
      update public.shop_billing set anaf_problem_since = null, anaf_hidden_at = null
      where shop_id = b.shop_id returning * into b;
    end if;
    if b.anaf_name_match is false and b.anaf_name_notified_at is null then
      update public.shop_billing set anaf_name_notified_at = now() where shop_id = b.shop_id returning * into b;
      perform public.notify_shop_owner(b.shop_id, 'company_name_mismatch',
        jsonb_build_object('cui', b.vat_id, 'anaf_name', b.anaf_name, 'legal_name', b.legal_name));
    end if;
  end if;
  return b;
end
$$;
revoke execute on function public.company_check_consequences(public.shop_billing) from public, anon, authenticated;

-- The companies to ask ANAF about today, most urgent first: past the deadline and not hidden yet (the
-- check before hiding), hidden (they come back on their own once ANAF knows them), never answered,
-- then the oldest answers beyond company_recheck_days. For verify-company's daily batch (service role).
create function public.company_checks_due(p_limit int default 100, p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('shop_id', d.shop_id, 'vat_id', d.vat_id, 'legal_name', d.legal_name)
                            order by d.rank, d.checked nulls first), '[]'::jsonb)
  from (
    select b.shop_id, b.vat_id, b.legal_name, b.anaf_checked_at as checked,
           case
             when b.anaf_problem_since is not null and b.anaf_hidden_at is null
                  and public.company_fix_deadline(b.anaf_problem_since) <= (p_now at time zone 'Europe/Bucharest')::date + 1 then 0
             when b.anaf_hidden_at is not null then 1
             when b.anaf_checked_at is null then 2
             else 3 end as rank
    from public.shop_billing b
    join public.shops s on s.id = b.shop_id
    join public.profiles o on o.id = s.owner_id
    where b.vat_id is not null
      and o.deleted_at is null
      and (b.anaf_checked_at is null
           or b.anaf_checked_at < p_now - interval '20 hours' and (
                b.anaf_hidden_at is not null
                or b.anaf_problem_since is not null
                or b.anaf_checked_at < p_now - make_interval(days => public.app_limit('company_recheck_days', 30))))
    order by rank, checked nulls first
    limit greatest(coalesce(p_limit, 100), 0)
  ) d
$$;
revoke execute on function public.company_checks_due(int, timestamptz) from public, anon, authenticated;

-- The shops whose company stayed unconfirmed past the deadline leave the search: only on a fresh
-- answer from ANAF (the last two days), or with no CUI at all. Answers how many.
create function public.enforce_company_deadlines(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    update public.shop_billing b
    set anaf_hidden_at = p_now
    where b.anaf_problem_since is not null
      and b.anaf_hidden_at is null
      and public.company_fix_deadline(b.anaf_problem_since) <= (p_now at time zone 'Europe/Bucharest')::date
      and (b.vat_id is null
           or (b.anaf_status in ('not_found', 'deregistered', 'inactive') and b.anaf_checked_at >= p_now - interval '2 days'))
    returning b.shop_id, b.anaf_status, b.vat_id
  loop
    perform public.notify_shop_owner(r.shop_id, 'company_hidden', jsonb_build_object('status', r.anaf_status, 'cui', r.vat_id));
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke execute on function public.enforce_company_deadlines(timestamptz) from public, anon, authenticated;

-- Asks verify-company to run the day's checks (pg_net, the dispatcher's address and token). Without
-- pg_net or before the dispatcher has stored its address, it does nothing.
create function public.kick_company_checks()
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
  if v_url is null or v_url not like '%/dispatch-notifications%' then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    using replace(v_url, '/dispatch-notifications', '/verify-company'), '{"batch": true}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-token', v_token);
  return true;
end
$$;
revoke execute on function public.kick_company_checks() from public, anon, authenticated;

-- For verify-company's batch: the dispatcher's token, compared on the server.
create function public.is_dispatch_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_token, '') <> '' and exists (select 1 from public.push_config c where c.id = 1 and c.dispatch_token = p_token)
$$;
revoke execute on function public.is_dispatch_token(text) from public, anon, authenticated;

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
    when 'quiet_hours_start' then int4range(0, 23, '[]')
    when 'quiet_hours_end' then int4range(0, 23, '[]')
    when 'promo_per_week' then int4range(0, 7, '[]')
    when 'request_reminder_hours' then int4range(1, 24, '[]')
    when 'company_fix_days' then int4range(1, 90, '[]')
    when 'company_recheck_days' then int4range(7, 365, '[]')
  end
$$;
create or replace function public.shop_billing_anaf_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vat_id is distinct from old.vat_id or new.legal_name is distinct from old.legal_name then
    new.anaf_cui := null;
    new.anaf_status := null;
    new.anaf_name := null;
    new.anaf_address := null;
    new.anaf_vat_payer := null;
    new.anaf_name_match := null;
    new.anaf_checked_at := null;
    new.anaf_name_notified_at := null;
  end if;
  return new;
end
$$;
create or replace function public.record_company_check(p_shop_id uuid, p_cui text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.shop_billing%rowtype;
begin
  if p_result->>'status' not in ('active', 'inactive', 'deregistered', 'not_found') then
    raise exception 'record_company_check: unknown status %', p_result->>'status';
  end if;
  update public.shop_billing
    set anaf_cui = p_cui,
        anaf_status = p_result->>'status',
        anaf_name = left(nullif(btrim(p_result->>'name'), ''), 300),
        anaf_address = left(nullif(btrim(p_result->>'address'), ''), 500),
        anaf_vat_payer = (p_result->>'vat_payer')::boolean,
        anaf_name_match = (p_result->>'name_match')::boolean,
        anaf_checked_at = now()
  where shop_id = p_shop_id and vat_id = p_cui
  returning * into b;
  if not found then
    return null;
  end if;
  return to_jsonb(public.company_check_consequences(b));
end
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
      and not exists (
        select 1 from public.shop_billing b where b.shop_id = s.id and b.anaf_hidden_at is not null
      )
  )
$$;
create or replace function public.shop_hidden_reasons(p_shop_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_owner public.profiles%rowtype;
  v_sub public.subscriptions%rowtype;
  v_sub_ok boolean;
  v text[] := '{}';
begin
  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    return v;
  end if;
  select * into v_owner from public.profiles where id = v_shop.owner_id;
  select * into v_sub from public.subscriptions where shop_id = v_shop.id;
  v_sub_ok := v_sub.shop_id is not null and public.subscription_ok(v_sub.status, v_sub.trial_ends_at, v_sub.stripe_status);
  if v_owner.deleted_at is not null then v := array_append(v, 'owner_deleted'); end if;
  if v_owner.suspended then v := array_append(v, 'account_suspended'); end if;
  if v_shop.suspended then v := array_append(v, 'shop_suspended'); end if;
  if not v_shop.active and v_sub_ok then v := array_append(v, 'shop_inactive'); end if;
  if not v_sub_ok then v := array_append(v, 'subscription_inactive'); end if;
  if v_owner.email_verified_at is null then v := array_append(v, 'email_unverified'); end if;
  if not (v_owner.phone_verified_at is not null or v_owner.phone_verified_by_admin) then
    v := array_append(v, 'phone_unverified');
  end if;
  if not exists (
    select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
    where ss.shop_id = v_shop.id and sv.enabled
  ) then
    v := array_append(v, 'no_services');
  end if;
  if not exists (select 1 from public.shop_hours h where h.shop_id = v_shop.id and not h.is_closed) then
    v := array_append(v, 'no_open_days');
  end if;
  if exists (select 1 from public.shop_billing b where b.shop_id = v_shop.id and b.anaf_hidden_at is not null) then
    v := array_append(v, 'company_unconfirmed');
  end if;
  return v;
end
$$;
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
  perform public.require_reader();
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
  select * into v_billing from public.shop_billing where shop_id = v_shop.id;
  if v_billing.anaf_hidden_at is not null then v_reasons := array_append(v_reasons, 'company_unconfirmed'); end if;

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
        'ended_reason', v_sub.ended_reason),
      -- The company could not be confirmed at ANAF: until when it can be fixed (Panou's banner).
      'company', case when v_billing.anaf_problem_since is null then null else jsonb_build_object(
        'status', v_billing.anaf_status,
        'since', v_billing.anaf_problem_since,
        'deadline', public.company_fix_deadline(v_billing.anaf_problem_since),
        'hidden', v_billing.anaf_hidden_at is not null) end);
  end if;

  return v_result;
end
$$;
create or replace function public.admin_list_company_checks()
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
        'shop_id', s.id,
        'shop_name', s.name,
        'city', s.city,
        'display_id', o.display_id,
        'state', public.shop_state(s.id),
        'vat_id', b.vat_id,
        'legal_name', b.legal_name,
        'vat_payer', b.vat_payer,
        'anaf_status', b.anaf_status,
        'anaf_name', b.anaf_name,
        'anaf_address', b.anaf_address,
        'anaf_vat_payer', b.anaf_vat_payer,
        'anaf_name_match', b.anaf_name_match,
        'anaf_checked_at', b.anaf_checked_at,
        'problem_since', b.anaf_problem_since,
        'deadline', case when b.anaf_problem_since is not null then public.company_fix_deadline(b.anaf_problem_since) end,
        'hidden_at', b.anaf_hidden_at,
        'category', case
          when b.vat_id is null then 'no_cui'
          when b.anaf_status is null then 'unchecked'
          when b.anaf_status = 'active' and b.anaf_name_match is false then 'name_mismatch'
          when b.anaf_status = 'active' then 'ok'
          else b.anaf_status end,
        'vat_mismatch', b.anaf_vat_payer is not null and b.vat_payer is not null
                        and b.vat_payer is distinct from b.anaf_vat_payer
      ) order by
          case
            when b.anaf_status in ('not_found', 'deregistered', 'inactive') then 0
            when b.anaf_status = 'active' and b.anaf_name_match is false then 1
            when b.anaf_vat_payer is not null and b.vat_payer is not null and b.vat_payer is distinct from b.anaf_vat_payer then 2
            when b.vat_id is not null and b.anaf_status is null then 3
            when b.vat_id is null then 4
            else 5 end,
          s.created_at desc, s.id)
    from public.shops s
    join public.profiles o on o.id = s.owner_id
    left join public.shop_billing b on b.shop_id = s.id
  ), '[]'::jsonb);
end
$$;
create or replace function public.is_quiet_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('appointment_reminder', 'quote_expiring', 'quote_expired', 'doc_expiry', 'review_request',
    'service_due', 'trial_ending', 'shop_inactive', 'payment_failed', 'referral_reward',
    'referral_revoked', 'broadcast', 'tire_season', 'welcome', 'favorite_offer', 'booking_request_waiting',
    'monthly_report', 'company_problem', 'company_name_mismatch', 'company_hidden', 'company_ok')
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
    v_result := v_result || jsonb_build_object('company_hidden', public.enforce_company_deadlines(p_now));
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

update public.schema_version set version = 48;
