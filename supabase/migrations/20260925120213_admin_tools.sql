-- T16b — Admin: platform tools. FR §5.6, §5.6b, §5.7, §5.9–5.11; P21; ARCHITECTURE §2 (Platform), §15.
--
-- · Abonamente și facturi: every subscription with its next billing date and Stripe references,
--   every payment; the price of one shop's subscription can be set by hand (before Stripe runs).
-- · Rapoarte de istoric: every report; one issued in error is voided (/verifica then says so and
--   the client can no longer download it).
-- · Catalog: categories and services are added, renamed, switched on or off and reordered. Ids
--   never change (bookings point at them); a switched-off service stays on old bookings but can no
--   longer be chosen. Switching off a category switches off its services.
-- · Setări platformă: prices, free period, quote expiry, ranking, defaults for new shops, limits and
--   the push texts (RO/EN). Every value is read when a record is made (a quote's expiry at sending,
--   a shop's price and free period at sign-up, a report's price at checkout), so a change never
--   touches bookings, quotes or subscriptions that already exist.
-- · Anunțuri: to shops, clients or everyone, optionally only in one city (a shop by its address, a
--   client by the shops they booked with); shown in the app, optionally as push.
-- · Export: the rows of each list for a CSV file, written to the audit log (personal data).
-- Every write: admin only, request id, row lock, audit row with before/after — one transaction.

-- ---------------------------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------------------------

-- Notices: who (shops / clients / everyone) and, separately, an optional city. The old value
-- 'city' (everyone in that city) stays valid.
alter table public.notices
  add column recipients int not null default 0 check (recipients >= 0),
  add column push_recipients int not null default 0 check (push_recipients >= 0),
  add constraint notices_title_length check (char_length(title_ro) between 1 and 80 and char_length(title_en) between 1 and 80),
  add constraint notices_body_length check (char_length(body_ro) between 1 and 500 and char_length(body_en) between 1 and 500);

-- Catalog names are short text; ids are simple words (they appear in addresses and exports).
alter table public.service_categories
  add constraint service_categories_names check (
    char_length(btrim(name_ro)) between 1 and 80 and char_length(btrim(name_en)) between 1 and 80);
alter table public.services
  add constraint services_names check (
    char_length(btrim(name_ro)) between 1 and 80 and char_length(btrim(name_en)) between 1 and 80);

-- The report's void reason is short text.
alter table public.history_reports
  add constraint history_reports_void_reason_length check (char_length(void_reason) <= 500);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- An audit row for a record whose id is text (catalog keys), or none (settings, exports).
create function public.admin_audit_key(p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, clock_timestamp())
$$;

-- Trimmed text, or null when empty.
create function public.clean_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p), '')
$$;

-- Whether a person is in a notice's audience. `p_audience`: shops, clients, all (or the old
-- 'city' = all). With a city: a shop member whose shop is in that city; a client who has booked
-- with a shop in that city (clients have no address). Spelling-proof: "Brasov" = "Brașov".
create function public.in_notice_audience(p_user_id uuid, p_audience text, p_city text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.deleted_at is null
      and ((p.role = 'client' and p_audience in ('clients', 'all', 'city'))
           or (p.role = 'shop' and p_audience in ('shops', 'all', 'city')))
      and (public.clean_text(p_city) is null
           or (p.role = 'shop' and exists (
                 select 1 from public.shop_staff st join public.shops s on s.id = st.shop_id
                 where st.user_id = p.id and st.accepted_at is not null
                   and public.fold_text(btrim(s.city)) = public.fold_text(btrim(p_city))))
           or (p.role = 'client' and exists (
                 select 1 from public.bookings b join public.shops s on s.id = b.shop_id
                 where b.client_id = p.id
                   and public.fold_text(btrim(s.city)) = public.fold_text(btrim(p_city)))))
  )
$$;
revoke execute on function public.in_notice_audience(uuid, text, text) from public, anon, authenticated;

-- Who may read a notice: its audience (as it is now) and the admin.
create or replace function public.can_read_notice(p_audience text, p_city text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.in_notice_audience(auth.uid(), p_audience, p_city)
$$;

-- ---------------------------------------------------------------------------------------------
-- Abonamente și facturi (FR §5.6, P21)
-- ---------------------------------------------------------------------------------------------

-- The next date money is due: the end of the free period, the renewal, or Stripe's next retry.
create function public.subscription_next_billing(p public.subscriptions)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p.status = 'trial' then p.trial_ends_at
    when p.status = 'active' and not coalesce(p.cancel_at_period_end, false) then p.current_period_end
    when p.status = 'past_due' then p.next_payment_attempt
  end
$$;
revoke execute on function public.subscription_next_billing(public.subscriptions) from public, anon, authenticated;

create function public.admin_subscription_rows()
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
revoke execute on function public.admin_subscription_rows() from public, anon, authenticated;

-- Every subscription, and the newest 1000 payments.
create function public.admin_list_subscriptions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'subscriptions', public.admin_subscription_rows(),
    'invoices', coalesce((
      select jsonb_agg(x.item order by x.at desc, x.id) from (
        select coalesce(i.issued_at, i.created_at) as at, i.id, jsonb_build_object(
            'id', i.id, 'shop_id', i.shop_id, 'shop_name', s.name, 'amount', i.amount, 'vat_amount', i.vat_amount,
            'currency', i.currency, 'status', i.status, 'issued_at', coalesce(i.issued_at, i.created_at),
            'provider', i.provider, 'provider_ref', i.provider_ref, 'stripe_invoice_id', i.stripe_invoice_id,
            'receipt_url', i.receipt_url, 'pdf_url', i.pdf_url, 'series', i.series, 'number', i.number,
            'period_end', i.period_end) as item
        from public.invoices i join public.shops s on s.id = i.shop_id
        order by coalesce(i.issued_at, i.created_at) desc, i.id
        limit 1000) x), '[]'::jsonb));
end
$$;

-- The monthly price of one shop's subscription (e.g. the first shops keep a fixed price). Used by
-- the next Stripe checkout; refused while Stripe runs a subscription (Stripe keeps the price the
-- card was given for — change it there).
create function public.admin_set_subscription_price(p_shop_id uuid, p_price numeric, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.subscriptions%rowtype;
  v_old_price numeric(10,2);
  v_price numeric(10,2) := round(p_price, 2);
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_subscription_price');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.subscriptions where shop_id = p_shop_id for update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  if v_price is null or v_price < 1 or v_price > 10000 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'price_ron'));
  end if;
  if v.stripe_status in ('trialing', 'active', 'past_due', 'incomplete') then
    perform public.fail('subscription_in_stripe');
  end if;
  if v.price_ron = v_price then
    v_result := to_jsonb(v) - 'trial_reminded' - 'payment_failed_key';
    perform public.request_finish(p_request_id, v_result);
    return v_result;
  end if;
  v_old_price := v.price_ron;
  update public.subscriptions set price_ron = v_price where shop_id = p_shop_id returning * into v;
  perform public.admin_audit('set_subscription_price', 'shop', p_shop_id,
    jsonb_build_object('price_ron', v_old_price), jsonb_build_object('price_ron', v_price));
  v_result := to_jsonb(v) - 'trial_reminded' - 'payment_failed_key';
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Rapoarte de istoric (FR §5.6b)
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_history_reports()
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
        'id', r.id,
        'code', r.code,
        'status', r.status,
        'client_id', r.client_id,
        'client_display_id', p.display_id,
        'client_name', p.name,
        'car_snapshot', r.car_snapshot,
        'job_count', r.job_count,
        'price', r.price,
        'amount_paid', r.amount_paid,
        'lang', r.lang,
        'created_at', r.created_at,
        'paid_at', r.paid_at,
        'generated_at', r.generated_at,
        'void_reason', r.void_reason,
        'voided_at', r.voided_at
      ) order by coalesce(r.paid_at, r.created_at) desc, r.id)
    from public.history_reports r
    left join public.profiles p on p.id = r.client_id
  ), '[]'::jsonb);
end
$$;

-- Voids a report issued in error: /verifica then answers "Raport anulat" and the client can no
-- longer download it. Only a paid or generated report; the reason is kept on the report.
create function public.admin_void_history_report(p_report_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.history_reports%rowtype;
  v_reason text := public.clean_text(p_reason);
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_void_history_report');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.history_reports where id = p_report_id for update;
  if not found then
    perform public.fail('not_found');
  end if;
  if v.status not in ('paid', 'generated') then
    perform public.fail('wrong_status', jsonb_build_object('status', v.status));
  end if;
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  update public.history_reports
    set status = 'void', void_reason = v_reason, voided_at = now()
  where id = v.id;
  perform public.admin_audit('void_report', 'report', v.id,
    jsonb_build_object('status', v.status),
    jsonb_build_object('status', 'void', 'reason', v_reason));
  v_result := jsonb_build_object('id', v.id, 'code', v.code, 'status', 'void', 'void_reason', v_reason);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Catalog (FR §5.7)
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_catalog()
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
        'key', c.key,
        'name_ro', c.name_ro,
        'name_en', c.name_en,
        'position', c.position,
        'enabled', c.enabled,
        'services', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', sv.id,
              'category_key', sv.category_key,
              'icon', sv.icon,
              'name_ro', sv.name_ro,
              'name_en', sv.name_en,
              'position', sv.position,
              'enabled', sv.enabled,
              'shops', (select count(*) from public.shop_services ss where ss.service_id = sv.id),
              'bookings', (select count(*) from public.bookings b where b.service_id = sv.id)
            ) order by sv.position, sv.id)
          from public.services sv where sv.category_key = c.key), '[]'::jsonb)
      ) order by c.position, c.key)
    from public.service_categories c
  ), '[]'::jsonb);
end
$$;

-- Checks the two names of a catalog entry; answers them trimmed.
create function public.catalog_names(p_name_ro text, p_name_en text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ro text := public.clean_text(p_name_ro);
  v_en text := public.clean_text(p_name_en);
begin
  if v_ro is null or char_length(v_ro) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'name_ro'));
  end if;
  if v_en is null or char_length(v_en) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'name_en'));
  end if;
  return array[v_ro, v_en];
end
$$;
revoke execute on function public.catalog_names(text, text) from public, anon, authenticated;

-- A new category at the end of the list. Its key (cat_…) never changes.
create function public.admin_create_category(p_key text, p_name_ro text, p_name_en text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_names text[];
  v public.service_categories%rowtype;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_create_category');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_key !~ '^cat_[a-z0-9_]{2,30}$' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'category_key'));
  end if;
  v_names := public.catalog_names(p_name_ro, p_name_en);
  lock table public.service_categories in share row exclusive mode;
  if exists (select 1 from public.service_categories where key = v_key) then
    perform public.fail('key_taken');
  end if;
  insert into public.service_categories (key, name_ro, name_en, position, enabled)
  values (v_key, v_names[1], v_names[2],
          coalesce((select max(position) from public.service_categories), 0) + 1, true)
  returning * into v;
  perform public.admin_audit_key('create_category', 'category', v.key, null,
    jsonb_build_object('name_ro', v.name_ro, 'name_en', v.name_en));
  perform public.request_finish(p_request_id, to_jsonb(v));
  return to_jsonb(v);
end
$$;

-- Renames a category, switches it on or off. Off: its services are switched off too (they can no
-- longer be chosen); on again: the category only — its services are switched on one by one.
create function public.admin_update_category(p_key text, p_name_ro text, p_name_en text, p_enabled boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_names text[];
  v_old public.service_categories%rowtype;
  v public.service_categories%rowtype;
  v_off int := 0;
  v_diff jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_category');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_old from public.service_categories where key = p_key for update;
  if not found then
    perform public.fail('category_not_found');
  end if;
  v_names := public.catalog_names(p_name_ro, p_name_en);
  update public.service_categories
    set name_ro = v_names[1], name_en = v_names[2], enabled = coalesce(p_enabled, enabled)
  where key = p_key
  returning * into v;
  if v_old.enabled and not v.enabled then
    update public.services set enabled = false where category_key = v.key and enabled;
    get diagnostics v_off = row_count;
  end if;
  v_diff := public.jsonb_changes(to_jsonb(v_old), to_jsonb(v), array['name_ro', 'name_en', 'enabled']);
  if v_diff->'after' <> '{}'::jsonb then
    perform public.admin_audit_key('update_category', 'category', v.key, v_diff->'before',
      (v_diff->'after') || case when v_off > 0 then jsonb_build_object('services_off', v_off) else '{}'::jsonb end);
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v) || jsonb_build_object('services_off', v_off));
  return to_jsonb(v) || jsonb_build_object('services_off', v_off);
end
$$;

-- Checks a service's icon: a Lucide icon name (the app shows a wrench for one it does not know).
create function public.catalog_icon(p_icon text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := public.clean_text(p_icon);
begin
  if v is not null and v !~ '^[A-Z][A-Za-z0-9]{1,39}$' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'icon'));
  end if;
  return v;
end
$$;
revoke execute on function public.catalog_icon(text) from public, anon, authenticated;

-- A new service at the end of its category. Its id never changes (bookings point at it).
create function public.admin_create_service(p_id text, p_category_key text, p_icon text, p_name_ro text, p_name_en text,
                                            p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_id text := lower(btrim(coalesce(p_id, '')));
  v_names text[];
  v_icon text;
  v_cat public.service_categories%rowtype;
  v public.services%rowtype;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_create_service');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_id !~ '^[a-z][a-z0-9_]{1,39}$' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'service_id'));
  end if;
  v_names := public.catalog_names(p_name_ro, p_name_en);
  v_icon := public.catalog_icon(p_icon);
  select * into v_cat from public.service_categories where key = p_category_key for update;
  if not found then
    perform public.fail('category_not_found');
  end if;
  if exists (select 1 from public.services where id = v_id) then
    perform public.fail('key_taken');
  end if;
  insert into public.services (id, category_key, icon, name_ro, name_en, position, enabled)
  values (v_id, v_cat.key, v_icon, v_names[1], v_names[2],
          coalesce((select max(position) from public.services where category_key = v_cat.key), 0) + 1,
          v_cat.enabled)
  returning * into v;
  perform public.admin_audit_key('create_service', 'service', v.id, null,
    jsonb_build_object('name_ro', v.name_ro, 'name_en', v.name_en, 'category_key', v.category_key,
                       'icon', v.icon, 'enabled', v.enabled));
  perform public.request_finish(p_request_id, to_jsonb(v));
  return to_jsonb(v);
end
$$;

-- Renames a service, changes its icon or category, switches it on or off. A service can be on
-- only in a category that is on. Moved to another category: it goes to that category's end.
create function public.admin_update_service(p_id text, p_category_key text, p_icon text, p_name_ro text, p_name_en text,
                                            p_enabled boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_names text[];
  v_icon text;
  v_old public.services%rowtype;
  v public.services%rowtype;
  v_cat public.service_categories%rowtype;
  v_diff jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_service');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_old from public.services where id = p_id for update;
  if not found then
    perform public.fail('service_not_found');
  end if;
  v_names := public.catalog_names(p_name_ro, p_name_en);
  v_icon := public.catalog_icon(p_icon);
  select * into v_cat from public.service_categories where key = coalesce(p_category_key, v_old.category_key) for update;
  if not found then
    perform public.fail('category_not_found');
  end if;
  if coalesce(p_enabled, v_old.enabled) and not v_cat.enabled then
    perform public.fail('category_disabled');
  end if;
  update public.services
    set name_ro = v_names[1], name_en = v_names[2], icon = v_icon, category_key = v_cat.key,
        enabled = coalesce(p_enabled, enabled),
        position = case when v_cat.key = v_old.category_key then position
                        else coalesce((select max(s2.position) from public.services s2 where s2.category_key = v_cat.key), 0) + 1 end
  where id = p_id
  returning * into v;
  v_diff := public.jsonb_changes(to_jsonb(v_old), to_jsonb(v), array['name_ro', 'name_en', 'icon', 'category_key', 'enabled']);
  if v_diff->'after' <> '{}'::jsonb then
    perform public.admin_audit_key('update_service', 'service', v.id, v_diff->'before', v_diff->'after');
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v));
  return to_jsonb(v);
end
$$;

-- Moves a category (in the catalog) or a service (inside its category) one place up (-1) or down
-- (+1). Positions are first renumbered 1…n, so gaps or ties in old data never block a move.
create function public.admin_move_catalog_item(p_kind text, p_id text, p_direction int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_pos int;
  v_other text;
  v_cat text;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_move_catalog_item');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    perform public.fail('cannot_move');
  end if;

  if p_kind = 'category' then
    lock table public.service_categories in share row exclusive mode;
    if not exists (select 1 from public.service_categories where key = p_id) then
      perform public.fail('category_not_found');
    end if;
    update public.service_categories c set position = o.rn
    from (select key, row_number() over (order by position, key) as rn from public.service_categories) o
    where o.key = c.key and c.position <> o.rn;
    select position into v_pos from public.service_categories where key = p_id;
    select key into v_other from public.service_categories where position = v_pos + p_direction;
    if v_other is null then
      perform public.fail('cannot_move');
    end if;
    update public.service_categories set position = v_pos + p_direction where key = p_id;
    update public.service_categories set position = v_pos where key = v_other;
  elsif p_kind = 'service' then
    select category_key into v_cat from public.services where id = p_id;
    if v_cat is null then
      perform public.fail('service_not_found');
    end if;
    perform 1 from public.service_categories where key = v_cat for update;
    update public.services s set position = o.rn
    from (select id, row_number() over (order by position, id) as rn from public.services where category_key = v_cat) o
    where o.id = s.id and s.position <> o.rn;
    select position into v_pos from public.services where id = p_id;
    select id into v_other from public.services where category_key = v_cat and position = v_pos + p_direction;
    if v_other is null then
      perform public.fail('cannot_move');
    end if;
    update public.services set position = v_pos + p_direction where id = p_id;
    update public.services set position = v_pos where id = v_other;
  else
    perform public.fail('kind_invalid');
  end if;

  perform public.admin_audit_key(case when p_kind = 'category' then 'move_category' else 'move_service' end,
    p_kind, p_id, jsonb_build_object('position', v_pos), jsonb_build_object('position', v_pos + p_direction));
  v_result := jsonb_build_object('kind', p_kind, 'id', p_id, 'position', v_pos + p_direction);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Setări platformă (FR §5.10). Read straight from platform_settings (every signed-in user may).
-- ---------------------------------------------------------------------------------------------

-- The limits and the range each may take (ARCHITECTURE §6).
create function public.limit_range(p_key text)
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
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

-- Changes the listed settings (only those given). A value the table refuses answers field_invalid
-- with its name. The log keeps only what changed.
create function public.admin_update_settings(p_settings jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] := array['subscription_price_ron', 'trial_days', 'quote_expiry_days', 'report_price_ron',
    'vat_rate_percent', 'ranking_prior_avg', 'ranking_prior_weight', 'default_daily_capacity', 'default_cars_per_slot',
    'default_slot_minutes', 'default_min_notice_hours', 'default_max_advance_days', 'default_cancel_deadline_hours'];
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

-- One push text (a key of supabase/functions/_shared/templates.ts, e.g. client.quote_sent), in both
-- languages. An empty title or body keeps the built-in one; all four empty removes the change.
create function public.admin_set_notification_text(p_key text, p_title_ro text, p_body_ro text, p_title_en text,
                                                   p_body_en text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_old jsonb;
  v_new jsonb;
  v_lang jsonb := '{}'::jsonb;
  v_ro jsonb;
  v_en jsonb;
  v_texts jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_notification_text');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_key is null or p_key !~ '^(client|shop)\.[a-z_]{3,60}$' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'text_key'));
  end if;
  if char_length(public.clean_text(p_title_ro)) > 80 or char_length(public.clean_text(p_title_en)) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'text_title'));
  end if;
  if char_length(public.clean_text(p_body_ro)) > 300 or char_length(public.clean_text(p_body_en)) > 300 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'text_body'));
  end if;
  select notification_texts into v_texts from public.platform_settings where id = 1 for update;
  v_old := v_texts->p_key;

  v_ro := jsonb_strip_nulls(jsonb_build_object('title', public.clean_text(p_title_ro), 'body', public.clean_text(p_body_ro)));
  v_en := jsonb_strip_nulls(jsonb_build_object('title', public.clean_text(p_title_en), 'body', public.clean_text(p_body_en)));
  if v_ro <> '{}'::jsonb then v_lang := v_lang || jsonb_build_object('ro', v_ro); end if;
  if v_en <> '{}'::jsonb then v_lang := v_lang || jsonb_build_object('en', v_en); end if;
  v_new := nullif(v_lang, '{}'::jsonb);

  if v_old is not distinct from v_new then
    perform public.request_finish(p_request_id, coalesce(v_texts, '{}'::jsonb));
    return coalesce(v_texts, '{}'::jsonb);
  end if;
  v_texts := case when v_new is null then coalesce(v_texts, '{}'::jsonb) - p_key
                  else coalesce(v_texts, '{}'::jsonb) || jsonb_build_object(p_key, v_new) end;
  update public.platform_settings set notification_texts = v_texts, updated_by = auth.uid() where id = 1;
  perform public.admin_audit_key('set_notification_text', 'settings', p_key,
    jsonb_build_object('text', v_old), jsonb_build_object('text', v_new));
  perform public.request_finish(p_request_id, v_texts);
  return v_texts;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Anunțuri (FR §5.9)
-- ---------------------------------------------------------------------------------------------

-- How many people a notice would reach, and how many of them have push on a device.
create function public.admin_notice_preview(p_audience text, p_city text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_audience is null or p_audience not in ('shops', 'clients', 'all') then
    perform public.fail('audience_invalid');
  end if;
  return (
    select jsonb_build_object(
      'recipients', count(*),
      'with_push', count(*) filter (where exists (select 1 from public.push_subscriptions ps where ps.user_id = p.id)))
    from public.profiles p
    where p.role in ('client', 'shop') and public.in_notice_audience(p.id, p_audience, p_city));
end
$$;

-- Sends a notice: it appears in the app for its audience (a banner until read), and with p_push a
-- push notification goes to everyone in it who has push on a device. English left empty = the
-- Romanian text. Logged with its audience and content.
create function public.admin_send_notice(p_audience text, p_city text, p_title_ro text, p_body_ro text,
                                         p_title_en text, p_body_en text, p_push boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_city text := public.clean_text(p_city);
  v_title_ro text := public.clean_text(p_title_ro);
  v_body_ro text := public.clean_text(p_body_ro);
  v_title_en text := coalesce(public.clean_text(p_title_en), public.clean_text(p_title_ro));
  v_body_en text := coalesce(public.clean_text(p_body_en), public.clean_text(p_body_ro));
  v public.notices%rowtype;
  v_recipients int;
  v_push int := 0;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_send_notice');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_audience is null or p_audience not in ('shops', 'clients', 'all') then
    perform public.fail('audience_invalid');
  end if;
  if char_length(v_city) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'city'));
  end if;
  if v_title_ro is null or char_length(v_title_ro) > 80 or char_length(v_title_en) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'notice_title'));
  end if;
  if v_body_ro is null or char_length(v_body_ro) > 500 or char_length(v_body_en) > 500 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'notice_body'));
  end if;

  select count(*) into v_recipients from public.profiles p
  where p.role in ('client', 'shop') and public.in_notice_audience(p.id, p_audience, v_city);
  if v_recipients = 0 then
    perform public.fail('no_recipients');
  end if;

  insert into public.notices (audience, city, title_ro, body_ro, title_en, body_en, send_push, created_by, recipients)
  values (p_audience, v_city, v_title_ro, v_body_ro, v_title_en, v_body_en, coalesce(p_push, false), auth.uid(),
          v_recipients)
  returning * into v;

  if coalesce(p_push, false) then
    insert into public.notification_events (user_id, event, params, channels)
    select p.id, 'broadcast',
           jsonb_build_object('notice_id', v.id, 'title_ro', v.title_ro, 'body_ro', v.body_ro,
                              'title_en', v.title_en, 'body_en', v.body_en),
           array['push']
    from public.profiles p
    where p.role in ('client', 'shop') and public.in_notice_audience(p.id, p_audience, v_city)
      and exists (select 1 from public.push_subscriptions ps where ps.user_id = p.id);
    get diagnostics v_push = row_count;
    update public.notices set push_recipients = v_push where id = v.id returning * into v;
  end if;

  perform public.admin_audit('send_notice', 'notice', v.id, null, jsonb_build_object(
    'audience', v.audience, 'city', v.city, 'title_ro', v.title_ro, 'body_ro', v.body_ro,
    'title_en', v.title_en, 'body_en', v.body_en, 'send_push', v.send_push,
    'recipients', v.recipients, 'push_recipients', v.push_recipients));
  v_result := to_jsonb(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- The notices sent, newest first, with how many people have read each.
create function public.admin_list_notices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(n) || jsonb_build_object(
        'reads', (select count(*) from public.notice_reads r where r.notice_id = n.id),
        'created_by_name', p.name,
        'created_by_display_id', p.display_id)
      order by n.created_at desc, n.id)
    from public.notices n
    left join public.profiles p on p.id = n.created_by
  ), '[]'::jsonb);
end
$$;

-- Withdraws a notice sent by mistake: it disappears from the app (a push already delivered stays
-- on the devices). Logged with its content.
create function public.admin_withdraw_notice(p_notice_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.notices%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_withdraw_notice');
  if v_seen is not null then
    return v_seen;
  end if;
  delete from public.notices where id = p_notice_id returning * into v;
  if not found then
    perform public.fail('notice_not_found');
  end if;
  -- Pushes not sent yet are not sent any more.
  update public.notification_events
    set processed_at = now(), locked_until = null, last_error = 'withdrawn'
  where event = 'broadcast' and processed_at is null and params->>'notice_id' = v.id::text;
  perform public.admin_audit('withdraw_notice', 'notice', v.id,
    jsonb_build_object('audience', v.audience, 'city', v.city, 'title_ro', v.title_ro, 'body_ro', v.body_ro), null);
  v_result := jsonb_build_object('id', v.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Export (FR §5.11). The rows of one list for a CSV file, written to the audit log (they hold
-- personal data). Shops, clients and subscriptions: every row (the app applies the list's filters,
-- recorded here); bookings: the Rezervări filters, applied here, without the screen's 500 limit;
-- reviews: every review, or those matching the text.
-- ---------------------------------------------------------------------------------------------
create function public.admin_export(p_kind text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_statuses text[];
  v_q text;
  v_fold text;
  v_plate text;
  v_rows jsonb;
begin
  perform public.require_admin();
  if p_kind = 'shops' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'street', s.street, 'county', s.county, 'postal_code', s.postal_code,
          'rating', r.average, 'review_count', coalesce(r.review_count, 0),
          'bookings', (select count(*) from public.bookings b where b.shop_id = s.id),
          'price_ron', sub.price_ron)
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_shops()) with ordinality l
      join public.shops s on s.id = (l.value->>'id')::uuid
      left join public.shop_ratings r on r.shop_id = s.id
      left join public.subscriptions sub on sub.shop_id = s.id), '[]'::jsonb);
  elsif p_kind = 'clients' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'lang', p.lang,
          'cars', (select count(*) from public.cars c where c.owner_id = p.id))
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_clients()) with ordinality l
      join public.profiles p on p.id = (l.value->>'id')::uuid), '[]'::jsonb);
  elsif p_kind = 'subscriptions' then
    v_rows := public.admin_subscription_rows();
  elsif p_kind = 'bookings' then
    v_statuses := case when jsonb_typeof(f->'statuses') = 'array'
                       then array(select jsonb_array_elements_text(f->'statuses')) end;
    v_q := public.clean_text(f->>'q');
    v_fold := public.fold_text(v_q);
    v_plate := nullif(regexp_replace(upper(coalesce(v_q, '')), '[^A-Z0-9]', '', 'g'), '');
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'ref', b.ref, 'status', b.status, 'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'),
          'created_at', b.created_at, 'shop_name', s.name, 'shop_city', s.city,
          'client_display_id', cp.display_id, 'client_name', b.client_name, 'client_phone', b.client_phone,
          'service_ro', sv.name_ro, 'service_en', sv.name_en,
          'make', b.car_snapshot->>'make', 'model', b.car_snapshot->>'model', 'year', b.car_snapshot->>'year',
          'plate', b.car_snapshot->>'plate', 'vin', b.car_snapshot->>'vin',
          'odometer', b.odometer, 'cost', b.cost, 'cancelled_by', b.cancelled_by,
          'reason', coalesce(b.cancel_reason, b.decline_reason))
        order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.profiles cp on cp.id = b.client_id
      left join public.services sv on sv.id = b.service_id
      where (v_statuses is null or cardinality(v_statuses) = 0 or b.status = any (v_statuses))
        and (public.try_uuid(f->>'shop_id') is null or b.shop_id = public.try_uuid(f->>'shop_id'))
        and (public.try_uuid(f->>'client_id') is null or b.client_id = public.try_uuid(f->>'client_id'))
        and (f->>'from' is null or b.date >= (f->>'from')::date)
        and (f->>'to' is null or b.date <= (f->>'to')::date)
        and (v_q is null
             or b.ref ilike '%' || v_q || '%'
             or (v_plate is not null and b.car_snapshot->>'plate_norm' like '%' || v_plate || '%')
             or public.fold_text(coalesce(b.client_name, '')) like '%' || v_fold || '%'
             or public.fold_text(s.name) like '%' || v_fold || '%')), '[]'::jsonb);
  elsif p_kind = 'reviews' then
    v_q := public.fold_text(public.clean_text(f->>'q'));
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'created_at', r.created_at, 'shop_name', s.name, 'shop_city', s.city, 'ref', b.ref,
          'client_display_id', cp.display_id, 'client_display_name', r.client_display_name,
          'rating', r.rating, 'text', r.text, 'reply', r.reply,
          'report_reason', r.report_reason, 'reported_at', r.reported_at, 'report_status', r.report_status,
          'removed_at', r.removed_at)
        order by r.created_at desc, r.id)
      from public.reviews r
      join public.shops s on s.id = r.shop_id
      left join public.bookings b on b.id = r.booking_id
      left join public.profiles cp on cp.id = r.client_id
      where v_q is null
         or public.fold_text(coalesce(r.text, '')) like '%' || v_q || '%'
         or public.fold_text(coalesce(r.reply, '')) like '%' || v_q || '%'
         or public.fold_text(s.name) like '%' || v_q || '%'
         or public.fold_text(r.client_display_name) like '%' || v_q || '%'), '[]'::jsonb);
  else
    perform public.fail('kind_invalid');
  end if;

  perform public.admin_audit_key('export', 'export', p_kind, null,
    jsonb_build_object('kind', p_kind, 'filters', f, 'rows', jsonb_array_length(v_rows)));
  return v_rows;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Jurnal: labels for the new kinds of entries (report code, notice title, catalog names).
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_list_audit(p_before timestamptz default null, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(x.entry order by x.created_at desc, x.id desc) from (
      select a.id, a.created_at, jsonb_build_object(
          'id', a.id, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
          'before', a.before, 'after', a.after, 'created_at', a.created_at,
          'admin_display_id', p.display_id, 'admin_name', p.name,
          'label', case a.entity_type
            when 'shop' then (select s.name from public.shops s where s.id::text = a.entity_id)
            when 'booking' then (select b.ref from public.bookings b where b.id::text = a.entity_id)
            when 'profile' then (select coalesce(pp.display_id, '') from public.profiles pp where pp.id::text = a.entity_id)
            when 'review' then (select s.name from public.reviews r join public.shops s on s.id = r.shop_id
                                where r.id::text = a.entity_id)
            when 'report' then (select hr.code from public.history_reports hr where hr.id::text = a.entity_id)
            when 'notice' then coalesce((select n.title_ro from public.notices n where n.id::text = a.entity_id),
                                        a.after->>'title_ro', a.before->>'title_ro')
            when 'category' then (select c.name_ro from public.service_categories c where c.key = a.entity_id)
            when 'service' then (select sv.name_ro from public.services sv where sv.id = a.entity_id)
            else a.entity_id
          end) as entry
      from public.admin_audit_log a
      left join public.profiles p on p.id = a.admin_id
      where p_before is null or a.created_at < p_before
      order by a.created_at desc, a.id desc
      limit least(greatest(coalesce(p_limit, 100), 1), 200)) x
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke execute on function
  public.admin_audit_key(text, text, text, jsonb, jsonb),
  public.clean_text(text)
from public, anon, authenticated;

grant execute on function
  public.admin_list_subscriptions(),
  public.admin_set_subscription_price(uuid, numeric, uuid),
  public.admin_list_history_reports(),
  public.admin_void_history_report(uuid, text, uuid),
  public.admin_list_catalog(),
  public.admin_create_category(text, text, text, uuid),
  public.admin_update_category(text, text, text, boolean, uuid),
  public.admin_create_service(text, text, text, text, text, uuid),
  public.admin_update_service(text, text, text, text, text, boolean, uuid),
  public.admin_move_catalog_item(text, text, int, uuid),
  public.admin_update_settings(jsonb, uuid),
  public.admin_set_notification_text(text, text, text, text, text, uuid),
  public.admin_notice_preview(text, text),
  public.admin_send_notice(text, text, text, text, text, text, boolean, uuid),
  public.admin_list_notices(),
  public.admin_withdraw_notice(uuid, uuid),
  public.admin_export(text, jsonb)
to authenticated;

update public.schema_version set version = 22;
