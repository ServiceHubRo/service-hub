-- Billing data for anybody who repairs cars, whatever the legal form (Eduard, 19 Nov 2026: „service care nu e
-- firmă ci PFA? sau pur și simplu nu e nimic? … factura se face indiferent dacă e firmă sau nu”).
--
-- Until now the billing data counted as complete only with a legal name, a CUI, a Trade Register number, an
-- address and an email, so a sole proprietor or a person without a registration could never pay the
-- subscription. Now a name (or company name), an address and the email for invoices are enough; the CUI and the
-- Trade Register number stay optional (checked when given: the checksum, and ANAF for a CUI). Two functions
-- change, nothing else: get_shop_setup (the reminder on the dashboard) and subscription_checkout_info (what
-- the Stripe checkout reads). No row is changed or deleted.

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

create or replace function public.subscription_checkout_info(p_user_id uuid)
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
    'offers', public.subscription_offers(v_sub),
    'status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at,
    'stripe_customer_id', v_sub.stripe_customer_id,
    'stripe_subscription_id', v_sub.stripe_subscription_id,
    'stripe_status', v_sub.stripe_status,
    'billing_complete', coalesce(nullif(btrim(v_billing.legal_name), '') is not null
      and nullif(btrim(v_billing.legal_address), '') is not null
      and v_billing.billing_email is not null, false),
    'legal_name', v_billing.legal_name,
    'vat_id', v_billing.vat_id,
    'billing_email', v_billing.billing_email
  );
end
$$;

update public.schema_version set version = 126;
