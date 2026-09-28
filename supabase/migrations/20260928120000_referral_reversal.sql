-- A referral's free month is taken back when the payment that earned it is (Eduard, 28 Sep 2026):
-- the referred shop's payment refunded in full or disputed at the bank, and no other valid payment
-- left. ARCHITECTURE §2 (Money), §12.
--
-- · invoices.reversed_at / reversed_reason ('refunded', 'disputed'): written by the Stripe webhook
--   (charge.refunded with the whole amount, charge.dispute.created) through
--   record_invoice_reversed(customer, invoice, reason).
-- · Only what was not used yet is taken back, nothing more is charged:
--   free days → the referrer's free period loses them, never ending before now (only while still
--   free, without Stripe); a credit not in Stripe yet → never given; a credit in Stripe → a
--   `referral_reversal` outbox event (stripe channel): dispatch-notifications takes back the part
--   still on the customer's balance.
-- · shop_referrals.status 'revoked' (revoked_at, revoked_reason); it no longer counts toward the 12
--   and frees the company's CUI. The owner is told (push + email, `referral_revoked`).

alter table public.invoices
  add column reversed_at timestamptz,
  add column reversed_reason text check (reversed_reason in ('refunded', 'disputed'));

alter table public.shop_referrals drop constraint shop_referrals_status_check;
alter table public.shop_referrals
  add constraint shop_referrals_status_check check (status in ('signed_up', 'rewarded', 'refused', 'revoked')),
  add column revoked_at timestamptz,
  add column revoked_reason text check (revoked_reason in ('refunded', 'disputed')),
  -- What Stripe took back of a credit (lei), when it was given there.
  add column reversed_amount numeric(10,2) check (reversed_amount >= 0),
  add column reversed_at timestamptz,
  add column stripe_reversal_transaction text;
alter table public.shop_referrals drop constraint shop_referrals_check2;
alter table public.shop_referrals
  add constraint shop_referrals_reward_check check (status not in ('rewarded', 'revoked') or reward_kind is not null),
  add constraint shop_referrals_revoked_check check ((status = 'revoked') = (revoked_at is not null));

-- ---------------------------------------------------------------------------------------------
-- Taking a reward back
-- ---------------------------------------------------------------------------------------------

-- Asks dispatch-notifications to take back the unused part of a credit already in Stripe.
create function public.enqueue_referral_reversal(p_referral_shop_id uuid)
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
  where r.shop_id = p_referral_shop_id and r.status = 'revoked' and r.reward_kind = 'stripe_credit'
    and r.applied_at is not null and r.reversed_at is null;
  if v_referrer is null or exists (
       select 1 from public.notification_events e
       where e.event = 'referral_reversal' and e.processed_at is null
         and e.params->>'referral_shop_id' = p_referral_shop_id::text) then
    return;
  end if;
  select s.owner_id into v_owner from public.shops s where s.id = v_referrer;
  if v_owner is null then
    return;
  end if;
  insert into public.notification_events (user_id, event, params, channels)
  values (v_owner, 'referral_reversal',
          jsonb_build_object('referral_shop_id', p_referral_shop_id, 'shop_id', v_referrer), array['stripe']);
end
$$;

-- The referred shop's payments were taken back: when none is left, the reward goes too.
create function public.revoke_referral_reward(p_shop_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.shop_referrals%rowtype;
  v_sub public.subscriptions%rowtype;
  v_name text;
begin
  select * into r from public.shop_referrals where shop_id = p_shop_id and status = 'rewarded' for update;
  if not found then
    return;
  end if;
  if exists (select 1 from public.invoices i
             where i.shop_id = p_shop_id and i.status = 'paid' and i.amount > 0 and i.reversed_at is null) then
    return;
  end if;
  select * into v_sub from public.subscriptions where shop_id = r.referrer_shop_id for update;

  update public.shop_referrals set status = 'revoked', revoked_at = now(), revoked_reason = p_reason
  where shop_id = p_shop_id;

  if r.reward_kind = 'trial_days' then
    -- The free days still ahead go; the ones already lived stay.
    if v_sub.status = 'trial' and coalesce(v_sub.stripe_status, '') not in ('trialing', 'active', 'past_due') then
      update public.subscriptions
        set trial_ends_at = greatest(now(), public.add_local_days(trial_ends_at, -r.reward_days))
      where shop_id = r.referrer_shop_id;
    end if;
  elsif r.applied_at is not null then
    perform public.enqueue_referral_reversal(p_shop_id);
  end if;

  select s.name into v_name from public.shops s where s.id = p_shop_id;
  perform public.notify_shop_owner(r.referrer_shop_id, 'referral_revoked', jsonb_build_object(
    'kind', r.reward_kind,
    'referral_shop_id', p_shop_id,
    'referred_name', v_name,
    'reason', p_reason));
end
$$;

-- For the webhook (service role): a paid invoice refunded in full or disputed. Answers whether it
-- was known. Recorded once; the referral is looked at every time (idempotent).
create function public.record_invoice_reversed(p_customer text, p_invoice_id text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscriptions%rowtype;
  v_found boolean;
begin
  if p_reason not in ('refunded', 'disputed') then
    raise exception using errcode = 'P0001', message = 'reason_invalid';
  end if;
  v := public.subscription_for_customer(p_customer);
  if v.shop_id is null or p_invoice_id is null then
    return false;
  end if;
  update public.invoices set reversed_at = coalesce(reversed_at, now()), reversed_reason = coalesce(reversed_reason, p_reason)
  where stripe_invoice_id = p_invoice_id and shop_id = v.shop_id;
  v_found := found;
  if v_found then
    perform public.revoke_referral_reward(v.shop_id, p_reason);
  end if;
  return v_found;
end
$$;

-- For dispatch-notifications (service role): what to take back, and recording it.
create function public.referral_reversal_info(p_referral_shop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'customer', sub.stripe_customer_id,
    'amount', r.reward_amount,
    'done', r.reversed_at is not null,
    'referred_name', s.name)
  from public.shop_referrals r
  join public.subscriptions sub on sub.shop_id = r.referrer_shop_id
  join public.shops s on s.id = r.shop_id
  where r.shop_id = p_referral_shop_id and r.status = 'revoked' and r.reward_kind = 'stripe_credit'
    and r.applied_at is not null
$$;

create function public.mark_referral_reversed(p_referral_shop_id uuid, p_amount numeric, p_transaction text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shop_referrals
    set reversed_at = coalesce(reversed_at, now()),
        reversed_amount = coalesce(reversed_amount, greatest(round(p_amount, 2), 0)),
        stripe_reversal_transaction = coalesce(stripe_reversal_transaction, left(p_transaction, 255))
  where shop_id = p_referral_shop_id and status = 'revoked'
$$;

-- ---------------------------------------------------------------------------------------------
-- The owner's list: a revoked referral shows as such and no longer counts
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_referrals()
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
        'reason', coalesce(r.refused_reason, r.revoked_reason),
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

revoke execute on function public.enqueue_referral_reversal(uuid), public.revoke_referral_reward(uuid, text),
  public.record_invoice_reversed(text, text, text), public.referral_reversal_info(uuid),
  public.mark_referral_reversed(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.record_invoice_reversed(text, text, text), public.referral_reversal_info(uuid),
  public.mark_referral_reversed(uuid, numeric, text) to service_role;

update public.schema_version set version = 40;
