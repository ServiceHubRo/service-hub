-- Shop referrals (Eduard, 28 Sep 2026): a shop that brings another shop gets one free month once
-- the new shop pays its first subscription. ARCHITECTURE §2 (Money), §12.
--
-- · The code is the owner's display id (S-00042). A link from Abonament fills it in on the
--   sign-up form (/cont-nou?rol=service&cod=S-00042); it can also be typed. Only a new shop
--   (not a colleague joining by invitation) can name a referrer, and only at sign-up.
-- · shop_referrals keeps one row per referred shop: signed_up → rewarded or refused.
--   Refused at sign-up when the new owner has the same email or phone as the referrer's owner
--   (account fingerprints) or had a free period before (trial_used); refused at the first payment
--   when both shops have the same CUI, when that CUI already brought a reward, when the referrer's
--   owner deleted the account, or when the referrer already has 12 rewards.
-- · The reward, at the referred shop's first paid invoice (an invoices row above 0):
--   the referrer still in its free period without Stripe → 30 more free days (at once);
--   otherwise → a credit of one month of its subscription on its Stripe customer, used by the next
--   invoice (a `referral_credit` outbox event on the `stripe` channel; dispatch-notifications
--   posts a customer balance transaction and records it). A referrer without a Stripe customer
--   yet gets the credit when Checkout makes one.
-- · The owner is told (push + email, `referral_reward`). Nobody writes the table from the browser;
--   the owner reads it through my_referrals().

-- ---------------------------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------------------------
create table public.shop_referrals (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  referrer_shop_id uuid not null references public.shops (id) on delete cascade,
  code text not null check (char_length(code) <= 32),
  status text not null default 'signed_up' check (status in ('signed_up', 'rewarded', 'refused')),
  refused_reason text check (refused_reason in ('same_person', 'trial_used', 'same_company', 'referrer_gone', 'limit')),
  decided_at timestamptz,
  reward_kind text check (reward_kind in ('trial_days', 'stripe_credit')),
  reward_days int check (reward_days > 0),
  reward_amount numeric(10,2) check (reward_amount >= 0),
  -- When the trial was extended or Stripe took the credit; null = credit still to be given.
  applied_at timestamptz,
  stripe_balance_transaction text,
  -- The referred shop's CUI when the reward was decided: one reward per company, ever.
  referred_vat_id text,
  created_at timestamptz not null default now(),
  check (shop_id <> referrer_shop_id),
  check ((status = 'refused') = (refused_reason is not null)),
  check (status <> 'rewarded' or reward_kind is not null)
);
create index shop_referrals_referrer_idx on public.shop_referrals (referrer_shop_id, created_at desc);
create unique index shop_referrals_vat_idx on public.shop_referrals (referred_vat_id)
  where status = 'rewarded' and referred_vat_id is not null;
alter table public.shop_referrals enable row level security;
revoke all on public.shop_referrals from public, anon, authenticated;

-- The rules, in one place (the admin's Setări can take them over later).
create function public.referral_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('max_rewards', 12, 'trial_days', 30)
$$;

-- ---------------------------------------------------------------------------------------------
-- The code
-- ---------------------------------------------------------------------------------------------

-- The shop behind a code, or null. Accepts "S-00042", "s42", "S 00042"; the owner must still
-- have the account and be allowed to use it (a colleague's S- code is not a shop).
create function public.referral_code_shop(p_code text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_number text;
  v_shop uuid;
begin
  v_number := substring(v_code from '^S-?0*([0-9]{1,9})$');
  if v_number is null then
    return null;
  end if;
  select s.id into v_shop
  from public.profiles p
  join public.shops s on s.owner_id = p.id
  where p.display_id = public.format_sequence_id('S', v_number::bigint)
    and p.role = 'shop'
    and p.deleted_at is null
    and not p.suspended
    and not s.suspended;
  return v_shop;
end
$$;

-- For the sign-up form: does this code belong to a shop? (Answers only yes or no.)
create function public.check_referral_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.referral_code_shop(p_code) is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- Sign-up: after handle_new_user and the fingerprints (triggers run in name order)
-- ---------------------------------------------------------------------------------------------
create function public.signup_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := left(nullif(btrim(coalesce(new.raw_user_meta_data->>'referral_code', '')), ''), 32);
  v_shop uuid;
  v_referrer uuid;
  v_referrer_owner uuid;
  v_reason text;
begin
  if v_code is null then
    return new;
  end if;
  -- Only a new shop's owner (not a client, not a colleague joining by invitation).
  select s.id into v_shop from public.shops s where s.owner_id = new.id;
  v_referrer := public.referral_code_shop(v_code);
  if v_shop is null or v_referrer is null or v_referrer = v_shop then
    return new;
  end if;
  select s.owner_id into v_referrer_owner from public.shops s where s.id = v_referrer;

  if exists (select 1 from public.account_fingerprints_of(new.id) a
             join public.account_fingerprints_of(v_referrer_owner) b on b.kind = a.kind and b.hash = a.hash) then
    v_reason := 'same_person';
  elsif exists (select 1 from public.subscriptions sub where sub.shop_id = v_shop and sub.ended_reason = 'trial_used') then
    v_reason := 'trial_used';
  end if;

  insert into public.shop_referrals (shop_id, referrer_shop_id, code, status, refused_reason, decided_at)
  values (v_shop, v_referrer, v_code,
          case when v_reason is null then 'signed_up' else 'refused' end,
          v_reason,
          case when v_reason is not null then now() end);
  return new;
end
$$;
create trigger on_auth_user_created_zzz_referral after insert on auth.users
  for each row execute function public.signup_referral();

-- ---------------------------------------------------------------------------------------------
-- The reward
-- ---------------------------------------------------------------------------------------------

-- Asks dispatch-notifications to give a referral's credit in Stripe (once while one is waiting).
create function public.enqueue_referral_credit(p_referral_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_referrer uuid;
begin
  select r.referrer_shop_id into v_referrer from public.shop_referrals r
  where r.shop_id = p_referral_shop_id and r.status = 'rewarded' and r.reward_kind = 'stripe_credit' and r.applied_at is null;
  if v_referrer is null then
    return;
  end if;
  if exists (select 1 from public.notification_events e
             where e.event = 'referral_credit' and e.processed_at is null
               and e.params->>'referral_shop_id' = p_referral_shop_id::text) then
    return;
  end if;
  select s.owner_id into v_owner from public.shops s where s.id = v_referrer;
  if v_owner is null then
    return;
  end if;
  insert into public.notification_events (user_id, event, params, channels)
  values (v_owner, 'referral_credit',
          jsonb_build_object('referral_shop_id', p_referral_shop_id, 'shop_id', v_referrer), array['stripe']);
end
$$;

-- The referred shop paid: decide its referral (once).
create function public.grant_referral_reward(p_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.shop_referrals%rowtype;
  v_sub public.subscriptions%rowtype;
  v_rules jsonb := public.referral_rules();
  v_days int := (v_rules->>'trial_days')::int;
  v_vat text;
  v_referrer_vat text;
  v_reason text;
  v_amount numeric;
  v_new_end timestamptz;
  v_name text;
begin
  select * into r from public.shop_referrals where shop_id = p_shop_id and status = 'signed_up' for update;
  if not found then
    return;
  end if;
  -- The referrer's subscription row serializes two rewards arriving at once (the count below).
  select * into v_sub from public.subscriptions where shop_id = r.referrer_shop_id for update;
  select b.vat_id into v_vat from public.shop_billing b where b.shop_id = p_shop_id;
  select b.vat_id into v_referrer_vat from public.shop_billing b where b.shop_id = r.referrer_shop_id;

  if v_sub.shop_id is null
     or not exists (select 1 from public.shops s join public.profiles o on o.id = s.owner_id
                    where s.id = r.referrer_shop_id and o.deleted_at is null) then
    v_reason := 'referrer_gone';
  elsif v_vat is not null and (v_vat = v_referrer_vat or exists (
          select 1 from public.shop_referrals x where x.referred_vat_id = v_vat and x.status = 'rewarded')) then
    v_reason := 'same_company';
  elsif (select count(*) from public.shop_referrals x
         where x.referrer_shop_id = r.referrer_shop_id and x.status = 'rewarded') >= (v_rules->>'max_rewards')::int then
    v_reason := 'limit';
  end if;

  if v_reason is not null then
    update public.shop_referrals
      set status = 'refused', refused_reason = v_reason, decided_at = now(), referred_vat_id = v_vat
    where shop_id = p_shop_id;
    return;
  end if;

  select s.name into v_name from public.shops s where s.id = p_shop_id;

  if v_sub.status = 'trial' and coalesce(v_sub.stripe_status, '') not in ('trialing', 'active', 'past_due') then
    -- Still free and Stripe runs nothing: the free period grows at once.
    v_new_end := public.add_local_days(greatest(v_sub.trial_ends_at, now()), v_days);
    update public.subscriptions set trial_ends_at = v_new_end where shop_id = r.referrer_shop_id;
    update public.shop_referrals
      set status = 'rewarded', decided_at = now(), reward_kind = 'trial_days', reward_days = v_days,
          applied_at = now(), referred_vat_id = v_vat
    where shop_id = p_shop_id;
    perform public.notify_shop_owner(r.referrer_shop_id, 'referral_reward', jsonb_build_object(
      'kind', 'trial_days',
      'referral_shop_id', p_shop_id,
      'referred_name', v_name,
      'days', v_days,
      'expiry', to_char(v_new_end at time zone 'Europe/Bucharest', 'YYYY-MM-DD')));
  else
    -- One month of what the shop pays now, off its next Stripe invoice.
    v_amount := public.subscription_monthly_ron(v_sub);
    update public.shop_referrals
      set status = 'rewarded', decided_at = now(), reward_kind = 'stripe_credit', reward_amount = v_amount,
          referred_vat_id = v_vat
    where shop_id = p_shop_id;
    if v_sub.stripe_customer_id is not null then
      perform public.enqueue_referral_credit(p_shop_id);
    end if;
    perform public.notify_shop_owner(r.referrer_shop_id, 'referral_reward', jsonb_build_object(
      'kind', 'stripe_credit',
      'referral_shop_id', p_shop_id,
      'referred_name', v_name,
      'total', v_amount));
  end if;
end
$$;

-- A paid invoice above 0 is the referred shop's payment (the first one decides; later ones find
-- the referral already decided).
create function public.invoices_referral_reward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and new.amount > 0 then
    perform public.grant_referral_reward(new.shop_id);
  end if;
  return null;
end
$$;
create trigger invoices_referral_reward after insert on public.invoices
  for each row execute function public.invoices_referral_reward();

-- Checkout made the referrer's Stripe customer: the credits waiting for it go now, before the
-- first invoice.
create function public.subscriptions_referral_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  for v in
    select r.shop_id from public.shop_referrals r
    where r.referrer_shop_id = new.shop_id and r.status = 'rewarded'
      and r.reward_kind = 'stripe_credit' and r.applied_at is null
  loop
    perform public.enqueue_referral_credit(v);
  end loop;
  return null;
end
$$;
create trigger subscriptions_referral_credits after update of stripe_customer_id on public.subscriptions
  for each row when (old.stripe_customer_id is null and new.stripe_customer_id is not null)
  execute function public.subscriptions_referral_credits();

-- ---------------------------------------------------------------------------------------------
-- For dispatch-notifications (service role)
-- ---------------------------------------------------------------------------------------------

-- What to credit: the Stripe customer, the amount in lei, and whether it was given already.
create function public.referral_credit_info(p_referral_shop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'customer', sub.stripe_customer_id,
    'amount', r.reward_amount,
    'applied', r.applied_at is not null,
    'referred_name', s.name,
    'referrer_shop_id', r.referrer_shop_id)
  from public.shop_referrals r
  join public.subscriptions sub on sub.shop_id = r.referrer_shop_id
  join public.shops s on s.id = r.shop_id
  where r.shop_id = p_referral_shop_id and r.status = 'rewarded' and r.reward_kind = 'stripe_credit'
$$;

create function public.mark_referral_credit_applied(p_referral_shop_id uuid, p_transaction text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shop_referrals
    set applied_at = coalesce(applied_at, now()),
        stripe_balance_transaction = coalesce(stripe_balance_transaction, left(p_transaction, 255))
  where shop_id = p_referral_shop_id and status = 'rewarded' and reward_kind = 'stripe_credit'
$$;

-- ---------------------------------------------------------------------------------------------
-- For the owner (Abonament)
-- ---------------------------------------------------------------------------------------------

-- The code, the rules and the shops brought, newest first. Null for anyone but a shop owner.
-- A shop not decided yet shows as `trial` while in its free period, else `waiting`.
create function public.my_referrals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', o.display_id,
    'max_rewards', (public.referral_rules()->>'max_rewards')::int,
    'trial_days', (public.referral_rules()->>'trial_days')::int,
    'rewarded', (select count(*) from public.shop_referrals x where x.referrer_shop_id = s.id and x.status = 'rewarded'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rs.name,
        'city', rs.city,
        'joined_at', r.created_at,
        'state', case
          when r.status = 'signed_up' and rsub.status = 'trial' then 'trial'
          when r.status = 'signed_up' then 'waiting'
          else r.status end,
        'reason', r.refused_reason,
        'reward_kind', r.reward_kind,
        'reward_days', r.reward_days,
        'reward_amount', r.reward_amount,
        'applied', r.applied_at is not null,
        'decided_at', r.decided_at) order by r.created_at desc)
      from (select * from public.shop_referrals x where x.referrer_shop_id = s.id order by x.created_at desc limit 100) r
      join public.shops rs on rs.id = r.shop_id
      left join public.subscriptions rsub on rsub.shop_id = r.shop_id), '[]'::jsonb))
  from public.shops s
  join public.profiles o on o.id = s.owner_id
  where s.owner_id = auth.uid()
$$;

revoke execute on function public.referral_rules(), public.referral_code_shop(text), public.check_referral_code(text),
  public.signup_referral(), public.enqueue_referral_credit(uuid), public.grant_referral_reward(uuid),
  public.invoices_referral_reward(), public.subscriptions_referral_credits(), public.referral_credit_info(uuid),
  public.mark_referral_credit_applied(uuid, text), public.my_referrals() from public, anon, authenticated;
grant execute on function public.check_referral_code(text) to anon, authenticated;
grant execute on function public.my_referrals() to authenticated;
grant execute on function public.referral_credit_info(uuid), public.mark_referral_credit_applied(uuid, text) to service_role;

update public.schema_version set version = 39;
