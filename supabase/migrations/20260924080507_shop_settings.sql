-- T05 — Shop settings: the first-run checklist, opening hours saved in one go, the offered
-- services saved as one set, staff invitations, and manual phone verification until SMS (T13).
-- ARCHITECTURE §2 (shops, shop_staff), §5; FR §4.1, §4.5b, §4.6; P5, P5b, P5c, P5d.

-- ---------------------------------------------------------------------------------------------
-- Checklist steps 2 and 3 ("Verifică programul", "Stabilește câte mașini iei pe zi") are done once
-- the shop has saved them. The billing reminder on Panou can be put away for a week.
-- ---------------------------------------------------------------------------------------------
alter table public.shops
  add column hours_reviewed_at timestamptz,
  add column capacity_reviewed_at timestamptz,
  add column billing_reminder_dismissed_at timestamptz;

-- The browser may only say "now": whatever it sends becomes the server time, and a stamp is never
-- cleared (the checklist never comes back once a step is done).
create function public.shops_stamp_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.capacity_reviewed_at is distinct from old.capacity_reviewed_at then
    new.capacity_reviewed_at := case when new.capacity_reviewed_at is null then old.capacity_reviewed_at else now() end;
  end if;
  if new.billing_reminder_dismissed_at is distinct from old.billing_reminder_dismissed_at then
    new.billing_reminder_dismissed_at :=
      case when new.billing_reminder_dismissed_at is null then old.billing_reminder_dismissed_at else now() end;
  end if;
  return new;
end
$$;
create trigger shops_stamp_times before update on public.shops
  for each row execute function public.shops_stamp_times();

grant update (capacity_reviewed_at, billing_reminder_dismissed_at) on public.shops to authenticated;

-- A closed period is at most a year long.
alter table public.shop_closures
  add constraint shop_closures_max_length check (end_date - start_date <= 366);

-- ---------------------------------------------------------------------------------------------
-- The shop the caller operates; fails with not_allowed when there is none.
-- ---------------------------------------------------------------------------------------------
create function public.require_my_shop()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_shop uuid := public.my_shop_id();
begin
  if v_shop is null then
    perform public.fail('not_allowed');
  end if;
  return v_shop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- save_shop_hours — the seven weekdays in one transaction (a half-saved week is never visible to
-- the booking calendar). p_hours: [{weekday 0–6, is_closed, open_time 'HH:MM', close_time 'HH:MM'}]
-- with every weekday exactly once. Times are on the half hour; close after open.
-- Returns the saved rows. Marks checklist step 2 as done.
-- ---------------------------------------------------------------------------------------------
create function public.save_shop_hours(p_hours jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_day jsonb;
  v_weekday int;
  v_closed boolean;
  v_open time;
  v_close time;
  v_seen_days int[] := '{}';
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'save_shop_hours');
  if v_seen is not null then
    return v_seen;
  end if;
  v_shop := public.require_my_shop();

  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7 then
    perform public.fail('hours_invalid');
  end if;

  for v_day in select value from jsonb_array_elements(p_hours) loop
    begin
      v_weekday := (v_day->>'weekday')::int;
      v_closed := coalesce((v_day->>'is_closed')::boolean, false);
      v_open := case when v_closed then null else (v_day->>'open_time')::time end;
      v_close := case when v_closed then null else (v_day->>'close_time')::time end;
    exception when others then
      perform public.fail('hours_invalid');
    end;
    if v_weekday is null or v_weekday not between 0 and 6 or v_weekday = any (v_seen_days) then
      perform public.fail('hours_invalid');
    end if;
    v_seen_days := v_seen_days || v_weekday;
    if not v_closed then
      if v_open is null or v_close is null
         or extract(minute from v_open) not in (0, 30) or extract(minute from v_close) not in (0, 30)
         or extract(second from v_open) <> 0 or extract(second from v_close) <> 0 then
        perform public.fail('hours_invalid', jsonb_build_object('weekday', v_weekday));
      end if;
      if v_close <= v_open then
        perform public.fail('hours_close_before_open', jsonb_build_object('weekday', v_weekday));
      end if;
    end if;
    update public.shop_hours
      set is_closed = v_closed, open_time = v_open, close_time = v_close
      where shop_id = v_shop and weekday = v_weekday;
  end loop;

  update public.shops set hours_reviewed_at = now() where id = v_shop;

  select jsonb_agg(jsonb_build_object(
           'weekday', h.weekday, 'is_closed', h.is_closed,
           'open_time', to_char(h.open_time, 'HH24:MI'), 'close_time', to_char(h.close_time, 'HH24:MI'))
         order by h.weekday)
    into v_result
    from public.shop_hours h where h.shop_id = v_shop;
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- set_shop_services — replaces the shop's offered services with exactly this set (enabled catalog
-- services only). One call for "Alege tot" as for a single tick. Returns the saved ids.
-- ---------------------------------------------------------------------------------------------
create function public.set_shop_services(p_service_ids text[], p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_ids text[] := coalesce(p_service_ids, '{}');
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'set_shop_services');
  if v_seen is not null then
    return v_seen;
  end if;
  v_shop := public.require_my_shop();

  if cardinality(v_ids) > 1000 then
    perform public.fail('service_unavailable');
  end if;
  if exists (
    select 1 from unnest(v_ids) as i(id)
    where not exists (select 1 from public.services sv where sv.id = i.id and sv.enabled)
  ) then
    perform public.fail('service_unavailable');
  end if;

  delete from public.shop_services where shop_id = v_shop and service_id <> all (v_ids);
  insert into public.shop_services (shop_id, service_id)
  select distinct v_shop, i.id from unnest(v_ids) as i(id)
  on conflict do nothing;

  select coalesce(jsonb_agg(ss.service_id order by ss.service_id), '[]'::jsonb) into v_result
  from public.shop_services ss where ss.shop_id = v_shop;
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Staff invitations (FR §4.6). The owner's browser makes a random token, the database keeps only
-- its SHA-256; the link /invitatie/<token> is copied and sent by the owner until invitation
-- emails exist (T13). The invited address signs up through that link and becomes staff of this
-- shop (handle_new_user below). An invitation is valid 14 days; inviting the same address again
-- replaces its token.
-- ---------------------------------------------------------------------------------------------
create function public.invite_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

create function public.invite_staff(p_email text, p_token text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.shop_staff%rowtype;
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'invite_staff');
  if v_seen is not null then
    return v_seen;
  end if;
  v_shop := public.require_my_shop();
  if not public.is_shop_owner(v_shop) then
    perform public.fail('not_allowed');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    perform public.fail('email_invalid');
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    perform public.fail('invite_invalid');
  end if;

  -- One team edits at a time: lock the shop so two invitations cannot pass the limit together.
  perform 1 from public.shops where id = v_shop for update;

  if exists (
    select 1 from public.shop_staff st
    where st.shop_id = v_shop and st.accepted_at is not null and lower(st.invited_email) = v_email
  ) then
    perform public.fail('staff_exists');
  end if;

  select * into v_row from public.shop_staff st
  where st.shop_id = v_shop and st.accepted_at is null and lower(st.invited_email) = v_email;

  if found then
    update public.shop_staff
      set invite_token_hash = public.invite_token_hash(p_token), invited_at = now()
      where id = v_row.id
      returning * into v_row;
  else
    if (select count(*) from public.shop_staff st where st.shop_id = v_shop and st.role = 'staff') >= 10 then
      perform public.fail('limit_staff', jsonb_build_object('limit', 10));
    end if;
    insert into public.shop_staff (shop_id, invited_email, role, invite_token_hash)
    values (v_shop, v_email, 'staff', public.invite_token_hash(p_token))
    returning * into v_row;
  end if;

  v_result := jsonb_build_object('id', v_row.id, 'email', v_row.invited_email, 'invited_at', v_row.invited_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- The pending invitation behind a link: shop name and city and the invited address, or null when
-- the link is unknown, used or older than 14 days. Callable before signing in.
create function public.get_staff_invite(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('shop_name', s.name, 'city', s.city, 'email', st.invited_email)
  from public.shop_staff st
  join public.shops s on s.id = st.shop_id
  where p_token ~ '^[0-9a-f]{64}$'
    and st.invite_token_hash = public.invite_token_hash(p_token)
    and st.accepted_at is null
    and st.invited_at > now() - interval '14 days'
    and s.active
$$;

-- The team of the caller's shop: owner first, then staff, then pending invitations. Names come
-- from the profiles (which members cannot read directly).
create function public.list_shop_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  perform public.require_caller();
  v_shop := public.require_my_shop();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', st.id,
             'role', st.role,
             'name', p.name,
             'email', lower(coalesce(u.email, st.invited_email)),
             'invited_at', st.invited_at,
             'accepted_at', st.accepted_at,
             'expired', st.accepted_at is null and st.invited_at <= now() - interval '14 days',
             'is_me', st.user_id = auth.uid())
           order by st.role = 'staff', st.accepted_at is null, st.invited_at), '[]'::jsonb)
    from public.shop_staff st
    left join public.profiles p on p.id = st.user_id
    left join auth.users u on u.id = st.user_id
    where st.shop_id = v_shop
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Sign-up (replaces T02's version): the same, plus sign-up through a staff invitation. With
-- `invite_token` in the metadata the account becomes staff of the inviting shop instead of getting
-- a shop of its own, only when the token is valid and the address is the invited one; otherwise
-- the sign-up is refused ("invite_invalid"). The role still can never be admin.
-- ---------------------------------------------------------------------------------------------
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
    values (v_shop_id, 'trial', now() + make_interval(days => v_settings.trial_days),
            v_settings.subscription_price_ron);

    insert into public.shop_staff (shop_id, user_id, invited_email, role, accepted_at)
    values (v_shop_id, new.id, new.email, 'owner', now());
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- get_shop_setup — what Panou needs for the first-run checklist (P5d), the "not in search" banner
-- (§5) and the billing reminder (FR §4.5b). Reasons mirror is_shop_public() exactly, in the order
-- a shop should fix them. Once the four steps are done, setup_completed_at is stamped and the
-- checklist never shows again. Like mark_thread_read it takes no request id: repeating it is
-- harmless.
--   steps       services · hours · capacity · phone
--   reasons     account_suspended · shop_suspended · shop_inactive · subscription_inactive ·
--               email_unverified · phone_unverified · no_services · no_open_days
--   billing     owner only: complete (legal name, CUI, Trade Register, registered office, billing
--               email) and whether to show the reminder (trial from day 60, not dismissed in the
--               last 7 days)
-- ---------------------------------------------------------------------------------------------
create function public.get_shop_setup()
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

  if v_owner.suspended then v_reasons := array_append(v_reasons, 'account_suspended'); end if;
  if v_shop.suspended then v_reasons := array_append(v_reasons, 'shop_suspended'); end if;
  if not v_shop.active then v_reasons := array_append(v_reasons, 'shop_inactive'); end if;
  if v_sub.shop_id is null
     or v_sub.status not in ('trial', 'active', 'past_due')
     or (v_sub.status = 'trial' and not coalesce(v_sub.trial_ends_at > now(), false)) then
    v_reasons := array_append(v_reasons, 'subscription_inactive');
  end if;
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
    v_result := v_result || jsonb_build_object('billing', jsonb_build_object(
      'complete', v_billing_complete,
      'reminder', not v_billing_complete
        and v_sub.status = 'trial'
        and now() >= v_sub.trial_ends_at - make_interval(days => greatest(v_settings.trial_days - 60, 0))
        and (v_shop.billing_reminder_dismissed_at is null
             or v_shop.billing_reminder_dismissed_at < now() - interval '7 days')));
  end if;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- verify_phone_manually(email) — until SMS verification exists (T13), Eduard confirms a shop
-- owner's phone by hand in the SQL Editor. Like promote_to_admin: not callable through the API.
-- ---------------------------------------------------------------------------------------------
create function public.verify_phone_manually(p_email text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select p.* into v_profile
  from public.profiles p join auth.users u on u.id = p.id
  where lower(u.email) = lower(btrim(p_email))
  for update of p;
  if not found then
    raise exception 'verify_phone_manually: no account with email %', p_email;
  end if;
  if v_profile.phone is null then
    raise exception 'verify_phone_manually: % has no phone number on the account', p_email;
  end if;

  update public.profiles set phone_verified_by_admin = true where id = v_profile.id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
  values (null, 'verify_phone_manually', 'profile', v_profile.id::text,
          jsonb_build_object('phone', v_profile.phone, 'phone_verified_by_admin', v_profile.phone_verified_by_admin),
          jsonb_build_object('phone', v_profile.phone, 'phone_verified_by_admin', true));

  return v_profile.display_id || ' ' || v_profile.phone;
end
$$;
revoke execute on function public.verify_phone_manually(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke execute on function
  public.require_my_shop(),
  public.invite_token_hash(text)
from public, anon, authenticated;

grant execute on function
  public.save_shop_hours(jsonb, uuid),
  public.set_shop_services(text[], uuid),
  public.invite_staff(text, text, uuid),
  public.list_shop_staff(),
  public.get_shop_setup()
to authenticated;

grant execute on function public.get_staff_invite(text) to anon, authenticated;

update public.schema_version set version = 11;
