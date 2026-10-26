-- T48 — "Continuă cu Google".
--
-- A Google sign-up reaches auth.users without our sign-up data: no role, no phone, no terms. Its
-- account is not made then: handle_new_user and the fingerprints skip it, and the app asks for
-- the missing data ("Finalizează contul"). complete_signup() then makes the account exactly like
-- an email sign-up: it writes the same sign-up data into public.signup_completions, whose insert
-- fires the same four functions as an insert into auth.users (profile and shop, fingerprints,
-- the shop referral, the client referral), in the same order.
--
-- An email sign-up (provider 'email', the role in its data) works as before. A Google sign-in
-- with the address of an existing account is linked to it by Supabase Auth: no new user.

-- ---------------------------------------------------------------------------------------------
-- Which new users wait for complete_signup
-- ---------------------------------------------------------------------------------------------

-- Signed up through another provider (Google) and not through our sign-up form.
create function public.signup_pending(p_app_meta jsonb, p_user_meta jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_app_meta->>'provider', 'email') <> 'email'
     and not (coalesce(p_user_meta, '{}'::jsonb) ? 'role')
     and not (coalesce(p_user_meta, '{}'::jsonb) ? 'invite_token')
$$;
revoke execute on function public.signup_pending(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- handle_new_user: as in 20260925212800_trial_local_days, plus the first check
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
  -- A Google sign-up: the account is made by complete_signup().
  if public.signup_pending(new.raw_app_meta_data, new.raw_user_meta_data) then
    return new;
  end if;

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

-- ---------------------------------------------------------------------------------------------
-- signup_fingerprints: as in 20260926090346_account_fingerprints, plus the first check
-- ---------------------------------------------------------------------------------------------
create or replace function public.signup_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matched text[];
  v_shop_id uuid;
  v_sub public.subscriptions%rowtype;
  v_price numeric;
begin
  -- No account yet (a Google sign-up waiting for complete_signup): checked when it is made.
  if not exists (select 1 from public.profiles p where p.id = new.id) then
    return new;
  end if;

  -- The same email or phone as a suspended account or shop: created suspended.
  select array_agg(distinct f.kind order by f.kind) into v_matched
  from public.account_fingerprints_of(new.id) f
  join public.account_fingerprints fp on fp.hash = f.hash
  where fp.reason in ('suspended_account', 'suspended_shop')
    and fp.user_id is distinct from new.id;
  if v_matched is not null then
    update public.profiles set suspended = true where id = new.id;
    insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
    values (null, 'auto_suspend_account', 'profile', new.id::text, null, jsonb_build_object('matched', to_jsonb(v_matched)));
  end if;

  -- A shop owner whose email or phone already had a free period: none this time, and no launch price.
  select s.id into v_shop_id from public.shops s where s.owner_id = new.id;
  if v_shop_id is not null then
    select array_agg(distinct f.kind order by f.kind) into v_matched
    from public.account_fingerprints_of(new.id) f
    join public.account_fingerprints fp on fp.hash = f.hash
    where fp.reason = 'trial_used' and fp.user_id is distinct from new.id;
    if v_matched is not null then
      select * into v_sub from public.subscriptions where shop_id = v_shop_id for update;
      select ps.subscription_price_ron into v_price from public.platform_settings ps where ps.id = 1;
      update public.subscriptions
        set status = 'inactive',
            ended_reason = 'trial_used',
            trial_ends_at = now(),
            status_changed_at = now(),
            price_ron = case when v_sub.launch_offer then v_price else v_sub.price_ron end,
            launch_offer = false
      where shop_id = v_shop_id;
      update public.shops set active = false where id = v_shop_id;
      insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
      values (null, 'auto_no_trial', 'shop', v_shop_id::text, null, jsonb_build_object('matched', to_jsonb(v_matched)));
    end if;
  end if;

  perform public.refresh_account_fingerprints(new.id);
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The completed sign-ups: the same columns the sign-up functions read from auth.users
-- ---------------------------------------------------------------------------------------------
create table public.signup_completions (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null,
  raw_user_meta_data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.signup_completions enable row level security;
revoke all on public.signup_completions from public, anon, authenticated;

-- The same names as on auth.users, so they run in the same (name) order.
create trigger on_auth_user_created after insert on public.signup_completions
  for each row execute function public.handle_new_user();
create trigger on_auth_user_created_zz_fingerprints after insert on public.signup_completions
  for each row execute function public.signup_fingerprints();
create trigger on_auth_user_created_zzz_referral after insert on public.signup_completions
  for each row execute function public.signup_referral();
create trigger on_auth_user_created_zzzz_client_referral after insert on public.signup_completions
  for each row execute function public.signup_client_referral();

-- ---------------------------------------------------------------------------------------------
-- complete_signup: the data the email form asks for, after a Google sign-up
-- ---------------------------------------------------------------------------------------------
create function public.complete_signup(
  p_request_id uuid,
  p_role text,
  p_name text,
  p_phone text,
  p_lang text,
  p_terms_version text,
  p_shop_name text default null,
  p_city text default null,
  p_referral_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user auth.users%rowtype;
  v_prior jsonb;
  v_name text := left(nullif(btrim(coalesce(p_name, '')), ''), 120);
  v_phone text := left(nullif(btrim(coalesce(p_phone, '')), ''), 32);
  v_terms text := left(nullif(btrim(coalesce(p_terms_version, '')), ''), 32);
  v_shop_name text := left(nullif(btrim(coalesce(p_shop_name, '')), ''), 120);
  v_city text := left(nullif(btrim(coalesce(p_city, '')), ''), 80);
  v_code text := left(nullif(btrim(coalesce(p_referral_code, '')), ''), 32);
  v_meta jsonb;
  v_result jsonb;
begin
  if v_uid is null then
    perform public.fail('not_signed_in');
  end if;
  v_prior := public.request_begin(p_request_id, 'complete_signup');
  if v_prior is not null then
    return v_prior;
  end if;

  -- One at a time per person; an account is made once.
  select * into v_user from auth.users u where u.id = v_uid for update;
  if not found then
    perform public.fail('not_signed_in');
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid) then
    perform public.fail('account_exists');
  end if;

  if p_role is null or p_role not in ('client', 'shop') then
    perform public.fail('invalid_role');
  end if;
  if v_name is null then
    perform public.fail('name_required');
  end if;
  if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 8 then
    perform public.fail('phone_invalid');
  end if;
  if v_terms is null then
    perform public.fail('terms_required');
  end if;
  if p_role = 'shop' and (v_shop_name is null or v_city is null) then
    perform public.fail('shop_details_required');
  end if;

  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'role', p_role,
         'name', v_name,
         'phone', v_phone,
         'lang', case when p_lang in ('ro', 'en') then p_lang else 'ro' end,
         'terms_version', v_terms)
    || case when p_role = 'shop' then jsonb_build_object('shop_name', v_shop_name, 'city', v_city) else '{}'::jsonb end
    || case when v_code is not null then jsonb_build_object('referral_code', v_code) else '{}'::jsonb end;
  -- Our sign-up data on the user too, as after an email sign-up (emails read the language there).
  update auth.users set raw_user_meta_data = v_meta where id = v_uid;

  insert into public.signup_completions (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_uid, v_user.email, v_user.email_confirmed_at, coalesce(v_user.raw_app_meta_data, '{}'::jsonb), v_meta);

  v_result := jsonb_build_object('ok', true, 'role', p_role);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.complete_signup(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_signup(uuid, text, text, text, text, text, text, text, text) to authenticated;

update public.schema_version set version = 86;
