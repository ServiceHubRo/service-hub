-- The free period counted on the Romanian calendar. `now() + 90 days` in UTC moved the end an hour
-- earlier in local time when summer time ended in between, so a shop signing up between 00:00 and
-- 01:00 (summer) lost a day ("89 de zile din 90"). Days are now added to the local wall-clock time
-- in Europe/Bucharest: a sign-up at 00:25 on 26 September ends at 00:25 on 25 December, local.
-- Same for the admin's "Prelungește perioada gratuită". Existing subscriptions are left as they are.

-- `p_days` calendar days later, at the same local time in Europe/Bucharest.
create function public.add_local_days(p_at timestamptz, p_days int)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_at at time zone 'Europe/Bucharest') + make_interval(days => p_days)) at time zone 'Europe/Bucharest'
$$;
revoke execute on function public.add_local_days(timestamptz, int) from public, anon, authenticated;

-- Sign-up (as in 20260924080507_shop_settings.sql) and the admin's extension (as in
-- 20260925102655_admin.sql), with the local-calendar end.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := case when meta->>'role' in ('client', 'shop') then meta->>'role' else 'client' end;
  v_lang text := case when meta->>'lang' in ('ro', 'en') then meta->>'lang' else 'ro' end;
  v_name text := left(nullif(btrim(meta->>'name'), ''), 120);
  v_phone text := left(nullif(btrim(meta->>'phone'), ''), 32);
  v_terms text := left(nullif(btrim(meta->>'terms_version'), ''), 32);
  v_invite text := nullif(btrim(meta->>'invite_token'), '');
  v_invite_id uuid;
  v_settings public.platform_settings%rowtype;
  v_shop_id uuid;
begin
  if v_invite is not null then
    select st.id into v_invite_id
    from public.shop_staff st
    join public.shops s on s.id = st.shop_id
    where v_invite ~ '^[0-9a-f]{64}$'
      and st.invite_token_hash = public.invite_token_hash(v_invite)
      and st.accepted_at is null
      and st.invited_at > now() - interval '14 days'
      and lower(st.invited_email) = lower(new.email)
      and s.active
    for update of st;
    if v_invite_id is null then
      raise exception using errcode = 'P0001', message = 'invite_invalid';
    end if;
    v_role := 'shop';
  end if;

  insert into public.profiles (
    id, role, display_id, name, phone, lang, email_verified_at, terms_version, terms_accepted_at
  ) values (
    new.id,
    v_role,
    case v_role
      when 'shop' then public.format_sequence_id('S', nextval('public.display_id_shop_seq'))
      else public.format_sequence_id('C', nextval('public.display_id_client_seq'))
    end,
    v_name,
    v_phone,
    v_lang,
    new.email_confirmed_at,
    v_terms,
    case when v_terms is not null then now() end
  );

  if v_invite_id is not null then
    update public.shop_staff
      set user_id = new.id, accepted_at = now(), invite_token_hash = null
      where id = v_invite_id;
  elsif v_role = 'shop' then
    select * into v_settings from public.platform_settings where id = 1;

    insert into public.shops (
      owner_id, name, city, phone, lang, daily_capacity, cars_per_slot, slot_minutes,
      min_notice_hours, max_advance_days, cancel_deadline_hours
    ) values (
      new.id,
      coalesce(left(nullif(btrim(meta->>'shop_name'), ''), 120), v_name, 'Service'),
      coalesce(left(nullif(btrim(meta->>'city'), ''), 80), ''),
      v_phone,
      v_lang,
      v_settings.default_daily_capacity,
      v_settings.default_cars_per_slot,
      v_settings.default_slot_minutes,
      v_settings.default_min_notice_hours,
      v_settings.default_max_advance_days,
      v_settings.default_cancel_deadline_hours
    )
    returning id into v_shop_id;

    -- Mon–Fri 08:00–18:00, Sat–Sun closed.
    insert into public.shop_hours (shop_id, weekday, is_closed, open_time, close_time)
    select v_shop_id, d, d in (0, 6),
           case when d in (0, 6) then null else time '08:00' end,
           case when d in (0, 6) then null else time '18:00' end
    from generate_series(0, 6) as d;

    insert into public.shop_billing (shop_id, billing_email) values (v_shop_id, new.email);

    insert into public.subscriptions (shop_id, status, trial_ends_at, price_ron)
    values (v_shop_id, 'trial', public.add_local_days(now(), v_settings.trial_days),
            v_settings.subscription_price_ron);

    insert into public.shop_staff (shop_id, user_id, invited_email, role, accepted_at)
    values (v_shop_id, new.id, new.email, 'owner', now());
  end if;

  return new;
end
$$;

create or replace function public.admin_extend_trial(p_shop_id uuid, p_days int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.subscriptions%rowtype;
  v_after public.subscriptions%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_extend_trial');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.subscriptions where shop_id = p_shop_id for update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  if p_days is null or p_days not between 1 and 365 then
    perform public.fail('days_invalid');
  end if;
  if v.stripe_status in ('trialing', 'active', 'past_due', 'incomplete') then
    perform public.fail('subscription_in_stripe');
  end if;
  if exists (select 1 from public.shops s join public.profiles o on o.id = s.owner_id
             where s.id = p_shop_id and o.deleted_at is not null) then
    perform public.fail('not_allowed');
  end if;

  update public.subscriptions
    set trial_ends_at = public.add_local_days(greatest(coalesce(trial_ends_at, now()), now()), p_days)
  where shop_id = p_shop_id;
  perform public.set_subscription_status(p_shop_id, 'trial');
  select * into v_after from public.subscriptions where shop_id = p_shop_id;

  perform public.admin_audit('extend_trial', 'shop', p_shop_id,
    jsonb_build_object('status', v.status, 'trial_ends_at', v.trial_ends_at),
    jsonb_build_object('status', v_after.status, 'trial_ends_at', v_after.trial_ends_at, 'days', p_days));
  v_result := to_jsonb(v_after) - 'trial_reminded' - 'payment_failed_key';
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

update public.schema_version set version = 28;
