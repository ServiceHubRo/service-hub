-- T35 — Invite a friend (Eduard, 8 Oct 2026). ARCHITECTURE §12, §15.
--
-- · A client's code is their display id (C-00042). The card in Cont shares the link
--   /cont-nou?rol=client&cod=C-00042; the sign-up form fills "Cod de invitare" from it (or it is
--   typed). Only a new client account can name an inviter, and only at sign-up.
-- · client_referrals keeps one row per invited friend: signed_up → rewarded or refused. Nobody
--   reads or writes it from the browser; the inviter sees only counts (my_client_referrals).
-- · The reward: when a shop finishes the friend's first job booked in the app with an amount
--   above 0, the inviter gets one report credit (report_credits): one history report without
--   paying. No money, no points. Told once (push + email, `report_credit`).
-- · Refused: the friend has the same email or phone as the inviter (at sign-up), or the shop that
--   finished the job belongs to the inviter's email or phone; the same person (email or phone)
--   already brought a credit as a friend; the inviter's account is gone or suspended; the inviter
--   already got `referral_credits_per_year` credits (admin setting, 3) in the last 365 days.
-- · A credit is used by report-checkout instead of Stripe (redeem_report_credit, service role):
--   the report is made, numbered and generated exactly like a paid one, at 0 lei.

-- ---------------------------------------------------------------------------------------------
-- The tables
-- ---------------------------------------------------------------------------------------------
create table public.client_referrals (
  client_id uuid primary key references public.profiles (id) on delete cascade,
  referrer_id uuid references public.profiles (id) on delete set null,
  code text not null check (char_length(code) <= 32),
  -- The friend's email and phone fingerprints at sign-up: one credit per person, even after a
  -- deleted account is made again.
  fingerprints text[] not null default '{}',
  status text not null default 'signed_up' check (status in ('signed_up', 'rewarded', 'refused')),
  refused_reason text check (refused_reason in ('same_person', 'same_friend', 'referrer_gone', 'limit')),
  booking_id uuid references public.bookings (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (client_id <> referrer_id),
  check ((status = 'refused') = (refused_reason is not null))
);
create index client_referrals_referrer_idx on public.client_referrals (referrer_id, created_at desc);
create index client_referrals_fingerprints_idx on public.client_referrals using gin (fingerprints);
alter table public.client_referrals enable row level security;
revoke all on public.client_referrals from public, anon, authenticated;

create table public.report_credits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  -- The friend whose first job brought it (one credit per friend).
  referral_client_id uuid unique references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  report_id uuid unique references public.history_reports (id) on delete set null,
  check (report_id is null or used_at is not null)
);
create index report_credits_client_idx on public.report_credits (client_id, created_at desc);
alter table public.report_credits enable row level security;
revoke all on public.report_credits from public, anon, authenticated;
grant select on public.report_credits to authenticated;
create policy report_credits_own on public.report_credits for select to authenticated
  using (client_id = auth.uid());

-- The admin setting: credits a client can get in 365 days (0 turns the reward off).
update public.platform_settings
  set limits = limits || '{"referral_credits_per_year": 3}'::jsonb
where id = 1 and not (limits ? 'referral_credits_per_year');

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
    when 'referral_credits_per_year' then int4range(0, 12, '[]')
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The code
-- ---------------------------------------------------------------------------------------------

-- The client behind a code, or null. Accepts "C-00042", "c42", "C 00042"; the account must still
-- exist and not be suspended.
create function public.referral_code_client(p_code text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_number text;
  v_client uuid;
begin
  v_number := substring(v_code from '^C-?0*([0-9]{1,9})$');
  if v_number is null then
    return null;
  end if;
  select p.id into v_client
  from public.profiles p
  where p.display_id = public.format_sequence_id('C', v_number::bigint)
    and p.role = 'client'
    and p.deleted_at is null
    and not p.suspended;
  return v_client;
end
$$;

-- For the sign-up form: does this code belong to a client? (Answers only yes or no.)
create function public.check_client_invite_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.referral_code_client(p_code) is not null
$$;

-- Do two accounts share an email or a phone?
create function public.same_person(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_fingerprints_of(p_a) a
                 join public.account_fingerprints_of(p_b) b on b.kind = a.kind and b.hash = a.hash
                 where a.hash is not null)
$$;

-- ---------------------------------------------------------------------------------------------
-- Sign-up: after handle_new_user, the fingerprints and the shop referral (name order)
-- ---------------------------------------------------------------------------------------------
create function public.signup_client_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := left(nullif(btrim(coalesce(new.raw_user_meta_data->>'referral_code', '')), ''), 32);
  v_referrer uuid;
  v_reason text;
begin
  if v_code is null
     or not exists (select 1 from public.profiles p where p.id = new.id and p.role = 'client') then
    return new;
  end if;
  v_referrer := public.referral_code_client(v_code);
  if v_referrer is null or v_referrer = new.id then
    return new;
  end if;
  if public.same_person(new.id, v_referrer) then
    v_reason := 'same_person';
  end if;
  insert into public.client_referrals (client_id, referrer_id, code, fingerprints, status, refused_reason, decided_at)
  values (new.id, v_referrer, v_code,
          coalesce((select array_agg(f.hash) from public.account_fingerprints_of(new.id) f where f.hash is not null), '{}'),
          case when v_reason is null then 'signed_up' else 'refused' end,
          v_reason,
          case when v_reason is not null then now() end);
  return new;
end
$$;
create trigger on_auth_user_created_zzzz_client_referral after insert on auth.users
  for each row execute function public.signup_client_referral();

-- ---------------------------------------------------------------------------------------------
-- The reward: the friend's first job finished by a shop
-- ---------------------------------------------------------------------------------------------
create function public.grant_client_referral_credit(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  r public.client_referrals%rowtype;
  v_owner uuid;
  v_reason text;
  v_given int;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.status <> 'done' or b.client_id is null or b.source <> 'app' or coalesce(b.cost, 0) <= 0 then
    return null;
  end if;
  select * into r from public.client_referrals where client_id = b.client_id and status = 'signed_up' for update;
  if not found then
    return null;
  end if;

  -- The inviter's row is the lock: two friends finishing at the same moment are counted in turn.
  perform 1 from public.profiles p
  where p.id = r.referrer_id and p.deleted_at is null and not p.suspended and p.role = 'client'
  for update;
  if not found then
    v_reason := 'referrer_gone';
  else
    select s.owner_id into v_owner from public.shops s where s.id = b.shop_id;
    if v_owner is not null and public.same_person(v_owner, r.referrer_id) then
      v_reason := 'same_person';
    elsif exists (select 1 from public.client_referrals x
                  where x.status = 'rewarded' and x.client_id <> r.client_id and x.fingerprints && r.fingerprints) then
      v_reason := 'same_friend';
    else
      select count(*) into v_given from public.report_credits c
      where c.client_id = r.referrer_id and c.created_at > now() - interval '365 days';
      if v_given >= public.app_limit('referral_credits_per_year', 3) then
        v_reason := 'limit';
      end if;
    end if;
  end if;

  if v_reason is not null then
    update public.client_referrals
      set status = 'refused', refused_reason = v_reason, booking_id = b.id, decided_at = now()
    where client_id = r.client_id;
    return v_reason;
  end if;

  insert into public.report_credits (client_id, referral_client_id) values (r.referrer_id, r.client_id);
  update public.client_referrals
    set status = 'rewarded', booking_id = b.id, decided_at = now()
  where client_id = r.client_id;
  perform public.notify_user(r.referrer_id, 'report_credit', '{}'::jsonb, null, array['push', 'email']);
  return 'rewarded';
end
$$;

create function public.bookings_client_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_client_referral_credit(new.id);
  return null;
end
$$;
create trigger bookings_client_referral after update of status on public.bookings
  for each row when (new.status = 'done' and old.status is distinct from 'done')
  execute function public.bookings_client_referral();

-- Waits out the quiet hours like the shops' referral reward: nobody did anything right now.
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
    'request_expired', 'booking_followup', 'booking_auto_closed', 'booking_request_last_call', 'area_launched',
    'report_credit')
$$;

-- ---------------------------------------------------------------------------------------------
-- Using a credit (report-checkout, service role)
-- ---------------------------------------------------------------------------------------------

-- The caller's own `pending_payment` report becomes paid with one of their credits (0 lei); the
-- same report again answers it as it is and uses nothing. Refuses not_found, no_credit.
create function public.redeem_report_credit(p_user_id uuid, p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.history_reports%rowtype;
  v_credit uuid;
begin
  select * into v from public.history_reports where id = p_report_id and client_id = p_user_id for update;
  if not found then
    perform public.fail('not_found');
  end if;
  if v.status <> 'pending_payment' then
    return to_jsonb(v);
  end if;
  select c.id into v_credit from public.report_credits c
  where c.client_id = p_user_id and c.used_at is null
  order by c.created_at
  limit 1
  for update skip locked;
  if v_credit is null then
    perform public.fail('no_credit');
  end if;
  update public.report_credits set used_at = now(), report_id = p_report_id where id = v_credit;
  return public.mark_history_report_paid(p_report_id, null, 0);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- What the client sees (Cont → Invită un prieten, the report preview)
-- ---------------------------------------------------------------------------------------------
create function public.my_client_referrals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', p.display_id,
    'invited', (select count(*) from public.client_referrals r where r.referrer_id = p.id),
    'rewarded', (select count(*) from public.client_referrals r where r.referrer_id = p.id and r.status = 'rewarded'),
    'credits_available', (select count(*) from public.report_credits c where c.client_id = p.id and c.used_at is null),
    'credits_per_year', public.app_limit('referral_credits_per_year', 3))
  from public.profiles p
  where p.id = auth.uid() and p.role = 'client' and p.deleted_at is null
$$;

revoke execute on function public.referral_code_client(text), public.check_client_invite_code(text),
  public.same_person(uuid, uuid), public.signup_client_referral(), public.grant_client_referral_credit(uuid),
  public.bookings_client_referral(), public.redeem_report_credit(uuid, uuid), public.my_client_referrals()
  from public, anon, authenticated;
grant execute on function public.check_client_invite_code(text) to anon, authenticated;
grant execute on function public.my_client_referrals() to authenticated;
grant execute on function public.redeem_report_credit(uuid, uuid) to service_role;

-- Kept like the other fingerprints: while the friend's account exists, then 3 years after it is
-- deleted (the Privacy Policy says so); the daily purge then drops the invitation.
create or replace function public.purge_account_fingerprints(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = ''
as $$
  with gone_referrals as (
    delete from public.client_referrals r
    using public.profiles p
    where p.id = r.client_id and p.deleted_at is not null and p.deleted_at < p_now - interval '3 years'
    returning 1
  ), gone as (
    delete from public.account_fingerprints
    where released_at is not null and released_at < p_now - interval '3 years'
    returning 1
  )
  select (select count(*)::int from gone) + (select count(*)::int from gone_referrals)
$$;
revoke execute on function public.purge_account_fingerprints(timestamptz) from public, anon, authenticated;

-- "Datele mele": who invited the client, and their report credits.
alter function public.export_my_data() rename to export_my_data_t32;
revoke execute on function public.export_my_data_t32() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_t32() || jsonb_build_object(
    'invited_with_code', (select r.code from public.client_referrals r where r.client_id = auth.uid()),
    'friends_invited', (select count(*) from public.client_referrals r where r.referrer_id = auth.uid()),
    'report_credits', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', c.created_at, 'used_at', c.used_at) order by c.created_at)
      from public.report_credits c where c.client_id = auth.uid()), '[]'::jsonb))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

update public.schema_version set version = 68;
