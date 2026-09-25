-- T16a — Admin: administration. FR §5.1–5.5, §5.8; P19, P20; ARCHITECTURE §2 (Platform), §15.
--
-- · Reads: one admin-only function per screen (overview, lists, details, moderation queue, audit
--   log). Each answers one jsonb, so nothing is cut at PostgREST's row limit and the admin never
--   needs a table grant beyond what RLS already allows (is_admin() reads everything).
-- · Writes: every admin action is a function that checks the caller is an admin, takes a
--   request id (the same tap twice acts once), locks the row, applies the change, tells the people
--   concerned and writes admin_audit_log with the values before and after — in one transaction.
-- · Deleting an account needs the Auth API, so the Edge Function admin-delete-account calls
--   admin_account_deletion (service role) after checking the caller is an admin.
-- · profiles.last_active_at is stamped by the app (touch_last_active, at most once an hour), so
--   the admin lists can show when someone last used the app.
-- · shops and profiles join the Realtime publication: the admin lists follow them live (RLS still
--   decides who receives what; only admin reads other people's rows).

-- ---------------------------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------------------------

-- A subscription stopped by an admin (inactive or cancelled by hand) says so.
alter table public.subscriptions drop constraint subscriptions_ended_reason_check;
alter table public.subscriptions
  add constraint subscriptions_ended_reason_check
  check (ended_reason in ('trial_ended', 'payment_failed', 'cancelled', 'admin'));

-- The moderation note is short text.
alter table public.reviews
  add constraint reviews_report_note_length check (char_length(report_note) <= 1000);

create index admin_audit_log_entity_idx on public.admin_audit_log (entity_id, created_at desc);
create index reviews_report_pending_idx on public.reviews (reported_at) where report_status = 'pending';
create index bookings_created_idx on public.bookings (created_at desc);
create index bookings_date_idx on public.bookings (date desc, slot desc);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The signed-in admin; anyone else is refused with not_allowed.
create function public.require_admin()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_caller();
  if v.role <> 'admin' then
    perform public.fail('not_allowed');
  end if;
  return v;
end
$$;

-- One audit row, written by the calling admin inside the same transaction as the change (stamped
-- with the clock, so several actions in one transaction keep their order).
create function public.admin_audit(p_action text, p_entity_type text, p_entity_id uuid, p_before jsonb, p_after jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (auth.uid(), p_action, p_entity_type, p_entity_id::text, p_before, p_after, clock_timestamp())
$$;

-- The keys of `p_after` whose value differs in `p_before`: {before: {...}, after: {...}}.
create function public.jsonb_changes(p_before jsonb, p_after jsonb, p_keys text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'before', coalesce(jsonb_object_agg(k, p_before->k) filter (where p_before->k is distinct from p_after->k), '{}'::jsonb),
    'after', coalesce(jsonb_object_agg(k, p_after->k) filter (where p_before->k is distinct from p_after->k), '{}'::jsonb))
  from unnest(p_keys) k
$$;

-- Where a shop stands, in one word (lists, overview):
--   deleted   — the owner deleted the account (records kept by law)
--   suspended — the shop or its owner's account is suspended by an admin
--   inactive  — the subscription is not in good standing (or the shop was switched off)
--   trial     — in the free period
--   active    — paying (active, or past due while Stripe retries)
create function public.shop_state(p_shop_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.deleted_at is not null then 'deleted'
    when s.suspended or o.suspended then 'suspended'
    when not s.active or sub.shop_id is null
      or not public.subscription_ok(sub.status, sub.trial_ends_at, sub.stripe_status) then 'inactive'
    when sub.status = 'trial' then 'trial'
    else 'active'
  end
  from public.shops s
  join public.profiles o on o.id = s.owner_id
  left join public.subscriptions sub on sub.shop_id = s.id
  where s.id = p_shop_id
$$;
revoke execute on function public.shop_state(uuid) from public, anon, authenticated;

-- Why a shop is not in search, in the order to fix it (same conditions as is_shop_public and the
-- shop's own Panou banner).
create function public.shop_hidden_reasons(p_shop_id uuid)
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
  return v;
end
$$;
revoke execute on function public.shop_hidden_reasons(uuid) from public, anon, authenticated;

-- The email of an account (from Auth); null once the account is deleted or anonymized.
create function public.account_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when u.email like 'deleted-%@deleted.invalid' then null else u.email end
  from auth.users u where u.id = p_user_id
$$;
revoke execute on function public.account_email(uuid) from public, anon, authenticated;

-- When the person last used the app: the app's own stamp, or the last sign-in.
create function public.last_seen(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(greatest(coalesce(p.last_active_at, '-infinity'), coalesce(u.last_sign_in_at, '-infinity')), '-infinity')
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user_id
$$;
revoke execute on function public.last_seen(uuid) from public, anon, authenticated;

-- Audit entries about some entities, newest first, with the admin's account id.
create function public.audit_entries(p_entity_ids text[], p_limit int default 100)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.entry order by e.created_at desc, e.id desc), '[]'::jsonb)
  from (
    select a.id, a.created_at, jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'entity_type', a.entity_type,
        'entity_id', a.entity_id,
        'before', a.before,
        'after', a.after,
        'created_at', a.created_at,
        'admin_display_id', p.display_id,
        'admin_name', p.name) as entry
    from public.admin_audit_log a
    left join public.profiles p on p.id = a.admin_id
    where a.entity_id = any (p_entity_ids)
    order by a.created_at desc, a.id desc
    limit p_limit
  ) e
$$;
revoke execute on function public.audit_entries(text[], int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- touch_last_active — the app stamps the signed-in person once per start (at most once an hour,
-- so it costs nothing). Like mark_thread_read: harmless to repeat, no request id.
-- ---------------------------------------------------------------------------------------------
create function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_active_at = now()
  where id = auth.uid()
    and (last_active_at is null or last_active_at < now() - interval '1 hour')
$$;

-- ---------------------------------------------------------------------------------------------
-- Prezentare (FR §5.1, P19)
-- ---------------------------------------------------------------------------------------------
create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := public.bucharest_today()::timestamp at time zone 'Europe/Bucharest';
  v_shops jsonb;
  v_bookings jsonb;
  v_subs jsonb;
  v_activity jsonb;
begin
  perform public.require_admin();

  select jsonb_build_object(
      'active', count(*) filter (where st = 'active'),
      'trial', count(*) filter (where st = 'trial'),
      'inactive', count(*) filter (where st = 'inactive'),
      'suspended', count(*) filter (where st = 'suspended'),
      'total', count(*) filter (where st <> 'deleted'))
    into v_shops
  from (select public.shop_state(s.id) as st from public.shops s) x;

  -- New bookings (by the day they were made, in Bucharest), with their status now.
  select jsonb_object_agg(w.name, jsonb_build_object(
           'total', (select count(*) from public.bookings b where b.created_at >= w.since),
           'by_status', coalesce((select jsonb_object_agg(c.status, c.n) from (
               select b.status, count(*) as n from public.bookings b where b.created_at >= w.since group by b.status) c),
             '{}'::jsonb)))
    into v_bookings
  from (values ('today', v_today),
               ('week', v_today - interval '6 days'),
               ('month', v_today - interval '29 days')) w(name, since);

  select jsonb_build_object(
      'active', count(*) filter (where sub.status = 'active'),
      'past_due', count(*) filter (where sub.status = 'past_due'),
      'trial', count(*) filter (where sub.status = 'trial' and sub.trial_ends_at > now()),
      'trial_ending', count(*) filter (where sub.status = 'trial' and sub.trial_ends_at > now()
                                         and sub.trial_ends_at <= now() + interval '7 days'),
      'mrr', coalesce(sum(sub.price_ron) filter (where sub.status in ('active', 'past_due')), 0))
    into v_subs
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  join public.profiles o on o.id = s.owner_id
  where o.deleted_at is null;

  -- The last 50 things worth knowing: new shops and clients, new bookings, reported reviews,
  -- failed payments.
  select coalesce(jsonb_agg(a.item order by a.at desc), '[]'::jsonb) into v_activity
  from (
    select * from (
      (select s.created_at as at, jsonb_build_object('kind', 'shop_created', 'at', s.created_at, 'id', s.id,
                'name', s.name, 'city', s.city) as item
       from public.shops s order by s.created_at desc limit 50)
      union all
      (select p.created_at, jsonb_build_object('kind', 'client_created', 'at', p.created_at, 'id', p.id,
                'name', p.name, 'display_id', p.display_id)
       from public.profiles p where p.role = 'client' and p.deleted_at is null order by p.created_at desc limit 50)
      union all
      (select b.created_at, jsonb_build_object('kind', 'booking_created', 'at', b.created_at, 'id', b.id,
                'ref', b.ref, 'name', s.name, 'status', b.status, 'service_ro', sv.name_ro, 'service_en', sv.name_en)
       from public.bookings b join public.shops s on s.id = b.shop_id left join public.services sv on sv.id = b.service_id
       order by b.created_at desc limit 50)
      union all
      (select r.reported_at, jsonb_build_object('kind', 'review_reported', 'at', r.reported_at, 'id', r.id,
                'name', s.name, 'reason', r.report_reason, 'rating', r.rating, 'status', r.report_status)
       from public.reviews r join public.shops s on s.id = r.shop_id
       where r.reported_at is not null order by r.reported_at desc limit 50)
      union all
      (select sub.payment_failed_at, jsonb_build_object('kind', 'payment_failed', 'at', sub.payment_failed_at,
                'id', s.id, 'name', s.name)
       from public.subscriptions sub join public.shops s on s.id = sub.shop_id
       where sub.payment_failed_at is not null order by sub.payment_failed_at desc limit 50)
    ) u
    order by at desc
    limit 50
  ) a;

  return jsonb_build_object(
    'shops', v_shops,
    'clients', (select count(*) from public.profiles where role = 'client' and deleted_at is null),
    'bookings', v_bookings,
    'reports_pending', (select count(*) from public.reviews where report_status = 'pending'),
    'subscriptions', v_subs,
    'activity', v_activity);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Service-uri (FR §5.2, P20)
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_shops()
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
        'id', s.id,
        'name', s.name,
        'city', s.city,
        'phone', coalesce(s.phone, o.phone),
        'owner_id', o.id,
        'display_id', o.display_id,
        'owner_name', o.name,
        'email', public.account_email(o.id),
        'email_verified', o.email_verified_at is not null,
        'phone_verified', o.phone_verified_at is not null or o.phone_verified_by_admin,
        'state', public.shop_state(s.id),
        'public', public.is_shop_public(s.id),
        'subscription_status', sub.status,
        'trial_ends_at', sub.trial_ends_at,
        'created_at', s.created_at,
        'last_active_at', public.last_seen(o.id)
      ) order by s.created_at desc, s.id)
    from public.shops s
    join public.profiles o on o.id = s.owner_id
    left join public.subscriptions sub on sub.shop_id = s.id
  ), '[]'::jsonb);
end
$$;

create function public.admin_get_shop(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_owner public.profiles%rowtype;
begin
  perform public.require_admin();
  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  select * into v_owner from public.profiles where id = v_shop.owner_id;

  return jsonb_build_object(
    'shop', to_jsonb(v_shop),
    'owner', jsonb_build_object(
      'id', v_owner.id,
      'display_id', v_owner.display_id,
      'name', v_owner.name,
      'phone', v_owner.phone,
      'email', public.account_email(v_owner.id),
      'lang', v_owner.lang,
      'email_verified_at', v_owner.email_verified_at,
      'phone_verified_at', v_owner.phone_verified_at,
      'phone_verified_by_admin', v_owner.phone_verified_by_admin,
      'suspended', v_owner.suspended,
      'deleted_at', v_owner.deleted_at,
      'created_at', v_owner.created_at,
      'last_active_at', public.last_seen(v_owner.id)),
    'state', public.shop_state(v_shop.id),
    'public', public.is_shop_public(v_shop.id),
    'reasons', to_jsonb(public.shop_hidden_reasons(v_shop.id)),
    'billing', (select to_jsonb(b) from public.shop_billing b where b.shop_id = v_shop.id),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'is_closed', h.is_closed,
               'open_time', to_char(h.open_time, 'HH24:MI'), 'close_time', to_char(h.close_time, 'HH24:MI'))
             order by h.weekday)
      from public.shop_hours h where h.shop_id = v_shop.id), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('start_date', c.start_date, 'end_date', c.end_date, 'label', c.label)
             order by c.start_date)
      from public.shop_closures c where c.shop_id = v_shop.id and c.end_date >= public.bucharest_today()), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', sv.id, 'name_ro', sv.name_ro, 'name_en', sv.name_en, 'enabled', sv.enabled)
             order by sv.position, sv.id)
      from public.shop_services ss join public.services sv on sv.id = ss.service_id
      where ss.shop_id = v_shop.id), '[]'::jsonb),
    'subscription', (select to_jsonb(sub) - 'trial_reminded' - 'payment_failed_key'
                     from public.subscriptions sub where sub.shop_id = v_shop.id),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'currency', i.currency, 'status', i.status,
               'issued_at', coalesce(i.issued_at, i.created_at), 'provider_ref', i.provider_ref,
               'receipt_url', i.receipt_url, 'series', i.series, 'number', i.number)
             order by coalesce(i.issued_at, i.created_at) desc)
      from public.invoices i where i.shop_id = v_shop.id), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'role', st.role, 'user_id', st.user_id,
               'display_id', p.display_id, 'name', p.name,
               'email', coalesce(public.account_email(st.user_id), st.invited_email),
               'invited_at', st.invited_at, 'accepted_at', st.accepted_at)
             order by st.role desc, st.invited_at)
      from public.shop_staff st left join public.profiles p on p.id = st.user_id
      where st.shop_id = v_shop.id), '[]'::jsonb),
    'rating', (select jsonb_build_object('average', r.average, 'review_count', r.review_count)
               from public.shop_ratings r where r.shop_id = v_shop.id),
    'booking_counts', coalesce((
      select jsonb_object_agg(status, n) from (
        select b.status, count(*) as n from public.bookings b where b.shop_id = v_shop.id group by b.status) c), '{}'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(x.item order by x.created_at desc) from (
        select b.created_at, jsonb_build_object('id', b.id, 'ref', b.ref, 'status', b.status, 'date', b.date,
                 'slot', to_char(b.slot, 'HH24:MI'), 'client_name', b.client_name,
                 'service_ro', sv.name_ro, 'service_en', sv.name_en, 'car_snapshot', b.car_snapshot) as item
        from public.bookings b left join public.services sv on sv.id = b.service_id
        where b.shop_id = v_shop.id
        order by b.created_at desc limit 20) x), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'reply', r.reply,
               'client_display_name', r.client_display_name, 'report_status', r.report_status,
               'report_reason', r.report_reason, 'removed_at', r.removed_at, 'created_at', r.created_at)
             order by r.created_at desc)
      from public.reviews r where r.shop_id = v_shop.id), '[]'::jsonb),
    'audit', public.audit_entries(array[v_shop.id::text, v_owner.id::text]));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Clienți (FR §5.3, P20)
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_clients()
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
        'id', p.id,
        'display_id', p.display_id,
        'name', p.name,
        'email', public.account_email(p.id),
        'phone', p.phone,
        'email_verified', p.email_verified_at is not null,
        'suspended', p.suspended,
        'created_at', p.created_at,
        'last_active_at', public.last_seen(p.id),
        'bookings', coalesce(c.total, 0),
        'active_bookings', coalesce(c.active, 0),
        'no_shows', coalesce(c.no_shows, 0)
      ) order by p.created_at desc, p.id)
    from public.profiles p
    left join lateral (
      select count(*) as total,
             count(*) filter (where public.is_active_status(b.status)) as active,
             count(*) filter (where b.status = 'no_show' and b.status_changed_at >= now() - interval '90 days') as no_shows
      from public.bookings b where b.client_id = p.id
    ) c on true
    where p.role = 'client' and p.deleted_at is null
  ), '[]'::jsonb);
end
$$;

create function public.admin_get_client(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  perform public.require_admin();
  select * into v from public.profiles where id = p_user_id and role = 'client';
  if not found then
    perform public.fail('not_found');
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v.id,
      'display_id', v.display_id,
      'name', v.name,
      'phone', v.phone,
      'email', public.account_email(v.id),
      'lang', v.lang,
      'email_verified_at', v.email_verified_at,
      'suspended', v.suspended,
      'deleted_at', v.deleted_at,
      'created_at', v.created_at,
      'terms_version', v.terms_version,
      'last_active_at', public.last_seen(v.id)),
    'no_shows', public.client_no_show_count(v.id, 90),
    'cars', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'make', c.make, 'model', c.model, 'year', c.year,
               'plate', c.plate, 'vin', c.vin, 'itp_expiry', c.itp_expiry, 'rca_expiry', c.rca_expiry,
               'vignette_expiry', c.vignette_expiry)
             order by c.created_at)
      from public.cars c where c.owner_id = v.id), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'ref', b.ref, 'status', b.status, 'date', b.date,
               'slot', to_char(b.slot, 'HH24:MI'), 'shop_id', b.shop_id, 'shop_name', s.name,
               'service_ro', sv.name_ro, 'service_en', sv.name_en, 'car_snapshot', b.car_snapshot, 'cost', b.cost)
             order by b.created_at desc)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.services sv on sv.id = b.service_id
      where b.client_id = v.id), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'shop_name', s.name,
               'report_status', r.report_status, 'removed_at', r.removed_at, 'created_at', r.created_at)
             order by r.created_at desc)
      from public.reviews r join public.shops s on s.id = r.shop_id
      where r.client_id = v.id), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'shop_id', t.shop_id, 'shop_name', s.name,
               'last_message_at', t.last_message_at,
               'messages', (select count(*) from public.messages m where m.thread_id = t.id))
             order by t.last_message_at desc nulls last)
      from public.threads t join public.shops s on s.id = t.shop_id
      where t.client_id = v.id), '[]'::jsonb),
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Rezervări (FR §5.4, P20). Filtered in the database: the platform's bookings grow without end.
-- Statuses (any of), shop, client, the appointment day from/to (Bucharest) and a text that
-- matches the code, the plate, the client or the shop. Newest appointment first, at most p_limit
-- (≤ 500), with the total that matched.
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_bookings(
  p_statuses text[] default null,
  p_shop_id uuid default null,
  p_client_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_q text default null,
  p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(public.fold_text(btrim(coalesce(p_q, ''))), '');
  v_plate text := nullif(regexp_replace(upper(coalesce(p_q, '')), '[^A-Z0-9]', '', 'g'), '');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform public.require_admin();
  return (
    with matched as (
      select b.*, s.name as shop_name, s.city as shop_city
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      where (p_statuses is null or cardinality(p_statuses) = 0 or b.status = any (p_statuses))
        and (p_shop_id is null or b.shop_id = p_shop_id)
        and (p_client_id is null or b.client_id = p_client_id)
        and (p_from is null or b.date >= p_from)
        and (p_to is null or b.date <= p_to)
        and (v_q is null
             or b.ref ilike '%' || btrim(p_q) || '%'
             or (v_plate is not null and b.car_snapshot->>'plate_norm' like '%' || v_plate || '%')
             or public.fold_text(coalesce(b.client_name, '')) like '%' || v_q || '%'
             or public.fold_text(s.name) like '%' || v_q || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'bookings', coalesce((
        select jsonb_agg(x.item order by x.date desc, x.slot desc, x.id) from (
          select m.date, m.slot, m.id, jsonb_build_object(
              'id', m.id, 'ref', m.ref, 'status', m.status, 'date', m.date, 'slot', to_char(m.slot, 'HH24:MI'),
              'shop_id', m.shop_id, 'shop_name', m.shop_name, 'shop_city', m.shop_city,
              'client_id', m.client_id, 'client_name', m.client_name,
              'client_display_id', (select p.display_id from public.profiles p where p.id = m.client_id),
              'service_id', m.service_id, 'service_ro', sv.name_ro, 'service_en', sv.name_en, 'service_icon', sv.icon,
              'car_snapshot', m.car_snapshot, 'cost', m.cost, 'created_at', m.created_at) as item
          from matched m left join public.services sv on sv.id = m.service_id
          order by m.date desc, m.slot desc, m.id
          limit v_limit) x), '[]'::jsonb))
  );
end
$$;

-- The messages of a thread for the admin (read-only), oldest first: at most the last 300.
create function public.admin_thread_messages(p_thread_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb)
  from (
    select m.id, m.created_at, jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'body', m.body, 'event', m.event, 'params', m.params,
        'booking_id', m.booking_id, 'created_at', m.created_at,
        'side', case when m.kind = 'system' then 'system'
                     when m.sender_id is not null and m.sender_id = t.client_id then 'client'
                     when m.sender_id is null then 'unknown'
                     else 'shop' end,
        'sender_name', p.name) as item
    from public.messages m
    join public.threads t on t.id = m.thread_id
    left join public.profiles p on p.id = m.sender_id
    where m.thread_id = p_thread_id
    order by m.created_at desc, m.id desc
    limit 300
  ) x
$$;
revoke execute on function public.admin_thread_messages(uuid) from public, anon, authenticated;

create function public.admin_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_thread uuid;
begin
  perform public.require_admin();
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  select t.id into v_thread from public.threads t where t.shop_id = v.shop_id and t.client_id = v.client_id;

  return jsonb_build_object(
    'booking', to_jsonb(v) || jsonb_build_object('slot', to_char(v.slot, 'HH24:MI')),
    'service', (select jsonb_build_object('id', sv.id, 'name_ro', sv.name_ro, 'name_en', sv.name_en, 'icon', sv.icon)
                from public.services sv where sv.id = v.service_id),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'phone', s.phone,
                      'display_id', o.display_id)
             from public.shops s join public.profiles o on o.id = s.owner_id where s.id = v.shop_id),
    'client', (select jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'phone', p.phone,
                        'email', public.account_email(p.id), 'no_shows', public.client_no_show_count(p.id, 90))
               from public.profiles p where p.id = v.client_id),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'version', q.version, 'status', q.status, 'note', q.note,
               'inspection_fee', q.inspection_fee, 'total_sent', q.total_sent, 'total_approved', q.total_approved,
               'sent_at', q.sent_at, 'expires_at', q.expires_at, 'decided_at', q.decided_at,
               'items', coalesce((select jsonb_agg(jsonb_build_object('id', qi.id, 'name', qi.name, 'price', qi.price,
                                     'approved', qi.approved) order by qi.position)
                                  from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb))
             order by q.version desc)
      from public.quotes q where q.booking_id = v.id), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'reply', r.reply,
                        'report_status', r.report_status, 'removed_at', r.removed_at, 'created_at', r.created_at)
               from public.reviews r where r.booking_id = v.id),
    'thread_id', v_thread,
    'messages', case when v_thread is null then '[]'::jsonb else public.admin_thread_messages(v_thread) end,
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

-- Mesaje (FR §5.8): any client–shop conversation, read-only. The admin never writes into one.
create function public.admin_get_thread(p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.threads%rowtype;
begin
  perform public.require_admin();
  select * into v from public.threads where id = p_thread_id;
  if not found then
    perform public.fail('thread_not_found');
  end if;
  return jsonb_build_object(
    'thread', jsonb_build_object('id', v.id, 'shop_id', v.shop_id, 'client_id', v.client_id,
                'client_name', v.client_name, 'last_message_at', v.last_message_at,
                'client_display_id', (select p.display_id from public.profiles p where p.id = v.client_id),
                'shop_name', (select s.name from public.shops s where s.id = v.shop_id)),
    'messages', public.admin_thread_messages(v.id));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Moderare (FR §5.5, P20): the reported reviews waiting for a decision, oldest first (all of
-- them), then the newest reviews of the platform (at most 200), filtered by a text.
-- ---------------------------------------------------------------------------------------------
create function public.admin_review_json(p_review public.reviews)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_review.id, 'booking_id', p_review.booking_id, 'shop_id', p_review.shop_id,
    'client_id', p_review.client_id, 'client_display_name', p_review.client_display_name,
    'client_display_id', (select p.display_id from public.profiles p where p.id = p_review.client_id),
    'rating', p_review.rating, 'text', p_review.text, 'reply', p_review.reply,
    'report_reason', p_review.report_reason, 'reported_at', p_review.reported_at,
    'report_status', p_review.report_status, 'report_decided_at', p_review.report_decided_at,
    'report_note', p_review.report_note, 'removed_at', p_review.removed_at, 'created_at', p_review.created_at,
    'ref', (select b.ref from public.bookings b where b.id = p_review.booking_id),
    'shop_name', (select s.name from public.shops s where s.id = p_review.shop_id),
    'shop_city', (select s.city from public.shops s where s.id = p_review.shop_id))
$$;
revoke execute on function public.admin_review_json(public.reviews) from public, anon, authenticated;

create function public.admin_list_reviews(p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(public.fold_text(btrim(coalesce(p_q, ''))), '');
begin
  perform public.require_admin();
  return jsonb_build_object(
    'queue', coalesce((
      select jsonb_agg(public.admin_review_json(r) order by r.reported_at, r.id)
      from public.reviews r where r.report_status = 'pending'), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(x.item order by x.created_at desc, x.id) from (
        select r.id, r.created_at, public.admin_review_json(r) as item
        from public.reviews r
        join public.shops s on s.id = r.shop_id
        where v_q is null
           or public.fold_text(coalesce(r.text, '')) like '%' || v_q || '%'
           or public.fold_text(coalesce(r.reply, '')) like '%' || v_q || '%'
           or public.fold_text(s.name) like '%' || v_q || '%'
           or public.fold_text(r.client_display_name) like '%' || v_q || '%'
        order by r.created_at desc, r.id
        limit 200) x), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Jurnal: the audit log, newest first, 100 at a time (p_before = the oldest time already shown).
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_audit(p_before timestamptz default null, p_limit int default 100)
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
-- Actions. Each: admin only, request id, row lock, change, notifications, audit — one transaction.
-- ---------------------------------------------------------------------------------------------

-- Marks an account's phone as verified by hand (a shop then may appear in search).
create function public.admin_verify_phone(p_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.profiles%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_verify_phone');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or v.role = 'admin' or v.deleted_at is not null then
    perform public.fail('not_found');
  end if;
  if v.phone is null or btrim(v.phone) = '' then
    perform public.fail('phone_missing');
  end if;
  if v.phone_verified_at is not null or v.phone_verified_by_admin then
    perform public.fail('phone_already_verified');
  end if;
  update public.profiles set phone_verified_by_admin = true where id = v.id;
  perform public.admin_audit('verify_phone', 'profile', v.id,
    jsonb_build_object('phone', v.phone, 'phone_verified_by_admin', false),
    jsonb_build_object('phone', v.phone, 'phone_verified_by_admin', true));
  v_result := jsonb_build_object('id', v.id, 'phone_verified_by_admin', true);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Suspends or reactivates a shop. Suspended: out of search and no new bookings at once; the
-- bookings already made go on. The owner gets an email (trigger shops_after_suspend). The reason
-- is internal: it goes into the audit log.
create function public.admin_set_shop_suspended(p_shop_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.shops%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_shop_suspended');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.shops where id = p_shop_id for update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  if p_suspended is null or v.suspended = p_suspended then
    perform public.fail('wrong_status', jsonb_build_object('suspended', v.suspended));
  end if;
  if p_suspended and v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  update public.shops set suspended = p_suspended where id = v.id;
  perform public.admin_audit(case when p_suspended then 'suspend_shop' else 'unsuspend_shop' end, 'shop', v.id,
    jsonb_build_object('suspended', v.suspended),
    jsonb_build_object('suspended', p_suspended) || case when v_reason is null then '{}'::jsonb
                                                        else jsonb_build_object('reason', v_reason) end);
  v_result := jsonb_build_object('id', v.id, 'suspended', p_suspended);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Suspends or reactivates an account (client or shop). A suspended account can still sign in and
-- read, but every action is refused (require_caller → account_suspended); a suspended shop owner's
-- shop leaves search. The person gets an email (trigger profiles_after_suspend).
create function public.admin_set_account_suspended(p_user_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.profiles%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_account_suspended');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or v.role = 'admin' or v.deleted_at is not null then
    perform public.fail('not_found');
  end if;
  if p_suspended is null or v.suspended = p_suspended then
    perform public.fail('wrong_status', jsonb_build_object('suspended', v.suspended));
  end if;
  if p_suspended and v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  update public.profiles set suspended = p_suspended where id = v.id;
  perform public.admin_audit(case when p_suspended then 'suspend_account' else 'unsuspend_account' end, 'profile', v.id,
    jsonb_build_object('suspended', v.suspended),
    jsonb_build_object('suspended', p_suspended) || case when v_reason is null then '{}'::jsonb
                                                        else jsonb_build_object('reason', v_reason) end);
  v_result := jsonb_build_object('id', v.id, 'suspended', p_suspended);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Edits a shop's public data, booking rules and fiscal data. Only the listed fields; a value the
-- table refuses answers field_invalid with the field's name. The log keeps only what changed.
-- Answers {shop, billing, address_changed}: after an address change the app asks the geocode
-- function for the new coordinates.
create function public.admin_update_shop(p_shop_id uuid, p_shop jsonb, p_billing jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop_keys constant text[] := array['name', 'description', 'street', 'city', 'county', 'postal_code', 'phone',
    'phone2', 'website', 'facebook', 'year_established', 'daily_capacity', 'cars_per_slot', 'slot_minutes',
    'min_notice_hours', 'max_advance_days', 'cancel_deadline_hours', 'inspection_fee'];
  v_billing_keys constant text[] := array['legal_name', 'vat_id', 'reg_com', 'legal_address', 'vat_payer',
    'bank_name', 'iban', 'billing_email', 'legal_rep'];
  v_seen jsonb;
  v_old public.shops%rowtype;
  v_new public.shops%rowtype;
  v_old_billing public.shop_billing%rowtype;
  v_new_billing public.shop_billing%rowtype;
  v_in jsonb;
  v_key text;
  v_shop_diff jsonb;
  v_billing_diff jsonb;
  v_constraint text;
  v_column text;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_shop');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_old from public.shops where id = p_shop_id for update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  select * into v_old_billing from public.shop_billing where shop_id = p_shop_id for update;

  -- Only known fields; empty text becomes "not set".
  for v_key in select jsonb_object_keys(coalesce(p_shop, '{}'::jsonb)) loop
    if not v_key = any (v_shop_keys) then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
  end loop;
  for v_key in select jsonb_object_keys(coalesce(p_billing, '{}'::jsonb)) loop
    if not v_key = any (v_billing_keys) then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
  end loop;

  begin
    v_in := (select coalesce(jsonb_object_agg(key, case when jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = ''
                                                        then 'null'::jsonb
                                                        when jsonb_typeof(value) = 'string' then to_jsonb(btrim(value #>> '{}'))
                                                        else value end), '{}'::jsonb)
             from jsonb_each(coalesce(p_shop, '{}'::jsonb)));
    v_new := jsonb_populate_record(v_old, v_in);
    update public.shops set
      name = v_new.name, description = v_new.description, street = v_new.street, city = v_new.city,
      county = v_new.county, postal_code = v_new.postal_code, phone = v_new.phone, phone2 = v_new.phone2,
      website = v_new.website, facebook = v_new.facebook, year_established = v_new.year_established,
      daily_capacity = v_new.daily_capacity, cars_per_slot = v_new.cars_per_slot, slot_minutes = v_new.slot_minutes,
      min_notice_hours = v_new.min_notice_hours, max_advance_days = v_new.max_advance_days,
      cancel_deadline_hours = v_new.cancel_deadline_hours, inspection_fee = v_new.inspection_fee
    where id = p_shop_id
    returning * into v_new;

    if v_old_billing.shop_id is not null then
      v_in := (select coalesce(jsonb_object_agg(key, case when jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = ''
                                                          then 'null'::jsonb
                                                          when jsonb_typeof(value) = 'string' then to_jsonb(btrim(value #>> '{}'))
                                                          else value end), '{}'::jsonb)
               from jsonb_each(coalesce(p_billing, '{}'::jsonb)));
      v_new_billing := jsonb_populate_record(v_old_billing, v_in);
      update public.shop_billing set
        legal_name = v_new_billing.legal_name, vat_id = v_new_billing.vat_id, reg_com = v_new_billing.reg_com,
        legal_address = v_new_billing.legal_address, vat_payer = coalesce(v_new_billing.vat_payer, false),
        bank_name = v_new_billing.bank_name, iban = v_new_billing.iban, billing_email = v_new_billing.billing_email,
        legal_rep = v_new_billing.legal_rep
      where shop_id = p_shop_id
      returning * into v_new_billing;
    end if;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
      perform public.fail('field_invalid', jsonb_build_object('field', coalesce(nullif(v_column, ''),
        nullif(regexp_replace(coalesce(v_constraint, ''), '^(shops|shop_billing)_(.*)_(check|not_null)$', '\2'), ''),
        'unknown')));
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow
         or invalid_datetime_format or string_data_right_truncation then
      perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end;

  v_shop_diff := public.jsonb_changes(to_jsonb(v_old), to_jsonb(v_new), v_shop_keys);
  v_billing_diff := public.jsonb_changes(to_jsonb(v_old_billing), to_jsonb(v_new_billing), v_billing_keys);
  if v_shop_diff->'after' <> '{}'::jsonb or v_billing_diff->'after' <> '{}'::jsonb then
    perform public.admin_audit('update_shop', 'shop', p_shop_id,
      (v_shop_diff->'before') || case when v_billing_diff->'before' = '{}'::jsonb then '{}'::jsonb
                                      else jsonb_build_object('billing', v_billing_diff->'before') end,
      (v_shop_diff->'after') || case when v_billing_diff->'after' = '{}'::jsonb then '{}'::jsonb
                                     else jsonb_build_object('billing', v_billing_diff->'after') end);
  end if;

  v_result := jsonb_build_object(
    'shop', to_jsonb(v_new),
    'billing', case when v_new_billing.shop_id is null then null else to_jsonb(v_new_billing) end,
    'address_changed', (v_old.street, v_old.city, v_old.county, v_old.postal_code)
                       is distinct from (v_new.street, v_new.city, v_new.county, v_new.postal_code));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Moves the end of the free period p_days later (from today when it already ended) and puts the
-- subscription back in the free period. Refused while Stripe runs a subscription for the shop:
-- Stripe would still charge on its own date, so that change belongs in Stripe.
create function public.admin_extend_trial(p_shop_id uuid, p_days int, p_request_id uuid)
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
    set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days)
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

-- Sets the plan status by hand (FR §5.2): active, past_due, cancelled or inactive. The free period
-- is set with admin_extend_trial. shops.active follows; stopping a subscription tells the owner.
-- Stripe stays the source of paid states: its next event about a live subscription applies again.
create function public.admin_set_subscription_status(p_shop_id uuid, p_status text, p_request_id uuid)
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
  v_seen := public.request_begin(p_request_id, 'admin_set_subscription_status');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.subscriptions where shop_id = p_shop_id for update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  if p_status is null or p_status not in ('active', 'past_due', 'cancelled', 'inactive') then
    perform public.fail('status_invalid');
  end if;
  if v.status = p_status then
    perform public.fail('wrong_status', jsonb_build_object('status', v.status));
  end if;
  if exists (select 1 from public.shops s join public.profiles o on o.id = s.owner_id
             where s.id = p_shop_id and o.deleted_at is not null) then
    perform public.fail('not_allowed');
  end if;

  perform public.set_subscription_status(p_shop_id, p_status,
    case when p_status in ('cancelled', 'inactive') then 'admin' end);
  if p_status in ('active', 'past_due') then
    update public.subscriptions set ended_reason = null where shop_id = p_shop_id;
  end if;
  select * into v_after from public.subscriptions where shop_id = p_shop_id;

  perform public.admin_audit('set_subscription_status', 'shop', p_shop_id,
    jsonb_build_object('status', v.status), jsonb_build_object('status', v_after.status));
  v_result := to_jsonb(v_after) - 'trial_reminded' - 'payment_failed_key';
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Decides a reported review: keep (the report is dismissed) or remove (the review disappears from
-- the shop page and from the average — shop_ratings excludes removed reviews). The note is
-- internal. The shop is told the outcome; the client only when their review was removed.
create function public.admin_decide_review(p_review_id uuid, p_decision text, p_note text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.reviews%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_booking public.bookings%rowtype;
  v_params jsonb;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_decide_review');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.reviews where id = p_review_id for update;
  if not found then
    perform public.fail('review_not_found');
  end if;
  if p_decision is null or p_decision not in ('keep', 'remove') then
    perform public.fail('decision_invalid');
  end if;
  if v.report_status is distinct from 'pending' then
    perform public.fail('wrong_status', jsonb_build_object('status', coalesce(v.report_status, 'none')));
  end if;
  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;

  update public.reviews
    set report_status = case when p_decision = 'keep' then 'kept' else 'removed' end,
        report_decided_at = now(),
        report_note = v_note,
        removed_at = case when p_decision = 'remove' then now() else removed_at end
  where id = v.id
  returning * into v;

  select * into v_booking from public.bookings where id = v.booking_id;
  v_params := jsonb_build_object(
    'review_id', v.id, 'booking_id', v.booking_id, 'ref', v_booking.ref, 'rating', v.rating,
    'decision', v.report_status, 'shop_id', v.shop_id,
    'shop_name', (select s.name from public.shops s where s.id = v.shop_id));
  perform public.notify_shop(v.shop_id, 'review_report_decided', v_params, v.booking_id);
  if p_decision = 'remove' then
    perform public.notify_user(v.client_id, 'review_report_decided', v_params, v.booking_id);
  end if;

  perform public.admin_audit(case when p_decision = 'keep' then 'keep_review' else 'remove_review' end, 'review', v.id,
    jsonb_build_object('report_status', 'pending', 'removed_at', null),
    jsonb_build_object('report_status', v.report_status, 'removed_at', v.removed_at)
      || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
  v_result := public.admin_review_json(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Deleting an account for the admin (the Edge Function admin-delete-account, service role, after
-- checking the caller's token). The same rules as "Șterge contul" (prepare_account_deletion): an
-- account with active bookings is refused; a shop with records is anonymized, not erased. Written
-- to the audit log in the same transaction. Admin accounts cannot be deleted here.
create function public.admin_account_deletion(p_admin_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_mode text;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin' and not suspended) then
    perform public.fail('not_allowed');
  end if;
  select * into v from public.profiles where id = p_user_id;
  if not found then
    perform public.fail('not_found');
  end if;
  if v.role = 'admin' then
    perform public.fail('not_allowed');
  end if;
  select * into v_shop from public.shops where owner_id = v.id;

  v_mode := public.prepare_account_deletion(p_user_id);

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
  values (p_admin_id, 'delete_account', case when v_shop.id is null then 'profile' else 'shop' end,
          coalesce(v_shop.id, v.id)::text,
          jsonb_build_object('display_id', v.display_id, 'role', v.role, 'name', v.name,
                             'email', public.account_email(v.id))
            || case when v_shop.id is null then '{}'::jsonb
                    else jsonb_build_object('shop_name', v_shop.name, 'city', v_shop.city) end,
          jsonb_build_object('mode', v_mode));
  return v_mode;
end
$$;
revoke execute on function public.admin_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_account_deletion(uuid, uuid) to service_role;

-- The helpers above are for these functions only.
revoke execute on function
  public.require_admin(),
  public.admin_audit(text, text, uuid, jsonb, jsonb),
  public.jsonb_changes(jsonb, jsonb, text[])
from public, anon, authenticated;

grant execute on function
  public.touch_last_active(),
  public.admin_overview(),
  public.admin_list_shops(),
  public.admin_get_shop(uuid),
  public.admin_list_clients(),
  public.admin_get_client(uuid),
  public.admin_list_bookings(text[], uuid, uuid, date, date, text, int),
  public.admin_get_booking(uuid),
  public.admin_get_thread(uuid),
  public.admin_list_reviews(text),
  public.admin_list_audit(timestamptz, int),
  public.admin_verify_phone(uuid, uuid),
  public.admin_set_shop_suspended(uuid, boolean, text, uuid),
  public.admin_set_account_suspended(uuid, boolean, text, uuid),
  public.admin_update_shop(uuid, jsonb, jsonb, uuid),
  public.admin_extend_trial(uuid, int, uuid),
  public.admin_set_subscription_status(uuid, text, uuid),
  public.admin_decide_review(uuid, text, text, uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Realtime: the admin lists follow new shops and accounts (RLS: a person receives only rows they
-- may read — their own profile, the shops they may see; the admin everything).
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['shops', 'profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

update public.schema_version set version = 21;
