-- The activity of one account, under that account (Eduard, 16 Nov 2026: „istoricul de activitate trebuie
-- să fie sub fiecare cont în admin”, a list of the last 50 things of the whole platform does not work with
-- thousands of users).
--
-- admin_account_activity(kind, id, before, before_key, limit): the events of ONE client or ONE shop,
-- newest first, a page at a time. Every event comes from the rows that already exist (the moments a
-- booking reached each step, the quotes, the reviews, the payments, the staff, the admin's own actions):
-- nothing is stored twice and nothing private is read (no message text). Admin only.
-- A page has at most 100 events; `more` says whether older ones exist; the next page is asked with the
-- `at` and `key` of the last event (keyset: stable while new events arrive).
--
-- admin_overview() no longer answers `activity`: Prezentare shows the platform in numbers only.
-- No row is changed or deleted.

create function public.admin_account_activity(
  p_kind text,
  p_id uuid,
  p_before timestamptz default null,
  p_before_key text default null,
  p_limit int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_owner uuid;
  v_entities text[];
  v_items jsonb;
  v_more boolean;
begin
  perform public.require_admin();

  if p_kind = 'client' then
    if not exists (select 1 from public.profiles where id = p_id and role = 'client') then
      perform public.fail('not_found');
    end if;
    v_entities := array[p_id::text];
  elsif p_kind = 'shop' then
    select s.owner_id into v_owner from public.shops s where s.id = p_id;
    if not found then
      perform public.fail('shop_not_found');
    end if;
    v_entities := array[p_id::text, v_owner::text];
  else
    perform public.fail('field_invalid');
  end if;

  with bk as (
    -- The bookings of the account, with who is on the other side.
    select b.id, b.ref, b.status, b.created_at, b.confirmed_at, b.inspection_started_at, b.started_at,
           b.done_at, b.cancelled_at, b.cancelled_by, b.status_changed_at,
           case when p_kind = 'client' then s.name else b.client_name end as other_name,
           sv.name_ro as service_ro, sv.name_en as service_en
    from public.bookings b
    join public.shops s on s.id = b.shop_id
    left join public.services sv on sv.id = b.service_id
    where case when p_kind = 'client' then b.client_id = p_id else b.shop_id = p_id end
  ),
  ev as (
    -- The steps a booking went through, each at the moment it was reached.
    select v.at, 'b:' || bk.id || ':' || v.step as key, 'booking_' || v.step as kind, bk.id as booking_id, bk.ref,
           bk.other_name as name, bk.service_ro, bk.service_en,
           case when v.step = 'cancelled' then jsonb_build_object('by', bk.cancelled_by) else '{}'::jsonb end as detail
    from bk
    cross join lateral (values
      ('created', bk.created_at),
      ('confirmed', bk.confirmed_at),
      ('in_inspection', bk.inspection_started_at),
      ('in_progress', bk.started_at),
      ('done', bk.done_at),
      ('cancelled', bk.cancelled_at)
    ) v(step, at)
    where v.at is not null
    union all
    -- The ends no timestamp of its own records: declined, expired, no-show, quote refused.
    select bk.status_changed_at, 'b:' || bk.id || ':' || bk.status, 'booking_' || bk.status, bk.id, bk.ref,
           bk.other_name, bk.service_ro, bk.service_en, '{}'::jsonb
    from bk
    where bk.status in ('declined', 'expired', 'no_show', 'quote_refused')
    union all
    -- The quotes: sent, and what was decided.
    select q.sent_at, 'q:' || q.id || ':sent', 'quote_sent', bk.id, bk.ref, bk.other_name, bk.service_ro, bk.service_en,
           jsonb_build_object('version', q.version)
    from public.quotes q join bk on bk.id = q.booking_id
    union all
    select q.decided_at, 'q:' || q.id || ':' || q.status, 'quote_' || q.status, bk.id, bk.ref, bk.other_name,
           bk.service_ro, bk.service_en, jsonb_build_object('version', q.version, 'by', q.decided_by)
    from public.quotes q join bk on bk.id = q.booking_id
    where q.decided_at is not null and q.status in ('accepted', 'partially_accepted', 'refused')
    union all
    -- The account itself.
    select p.created_at, 'account:created', 'account_created', null::uuid, null::text, p.name, null::text, null::text,
           '{}'::jsonb
    from public.profiles p where p_kind = 'client' and p.id = p_id
    union all
    select s.created_at, 'account:created', 'shop_created', null::uuid, null::text, s.name, null::text, null::text,
           jsonb_build_object('city', s.city)
    from public.shops s where p_kind = 'shop' and s.id = p_id
    union all
    -- Reviews: written by the client, or received, answered and reported at the shop.
    select r.created_at, 'r:' || r.id || ':written', case when p_kind = 'client' then 'review_written' else 'review_received' end,
           r.booking_id, null::text, case when p_kind = 'client' then s.name else r.client_display_name end,
           null::text, null::text, jsonb_build_object('rating', r.rating)
    from public.reviews r join public.shops s on s.id = r.shop_id
    where case when p_kind = 'client' then r.client_id = p_id else r.shop_id = p_id end
    union all
    select r.reply_at, 'r:' || r.id || ':reply', 'review_reply', r.booking_id, null::text, r.client_display_name,
           null::text, null::text, '{}'::jsonb
    from public.reviews r
    where p_kind = 'shop' and r.shop_id = p_id and r.reply_at is not null
    union all
    select r.reported_at, 'r:' || r.id || ':reported', 'review_reported', r.booking_id, null::text,
           case when p_kind = 'client' then s.name else r.client_display_name end, null::text, null::text,
           jsonb_build_object('reason', r.report_reason, 'status', r.report_status)
    from public.reviews r join public.shops s on s.id = r.shop_id
    where r.reported_at is not null
      and case when p_kind = 'client' then r.client_id = p_id else r.shop_id = p_id end
    union all
    -- Money and team of a shop.
    select i.coalesce_at, 'i:' || i.id, 'invoice_issued', null::uuid, i.number, null::text, null::text, null::text,
           jsonb_build_object('amount', i.amount, 'currency', i.currency)
    from (select inv.id, inv.number, inv.amount, inv.currency, coalesce(inv.issued_at, inv.created_at) as coalesce_at
          from public.invoices inv where p_kind = 'shop' and inv.shop_id = p_id) i
    union all
    select sub.payment_failed_at, 'sub:payment_failed', 'payment_failed', null::uuid, null::text, null::text,
           null::text, null::text, '{}'::jsonb
    from public.subscriptions sub where p_kind = 'shop' and sub.shop_id = p_id and sub.payment_failed_at is not null
    union all
    select st.accepted_at, 'staff:' || st.id, 'staff_joined', null::uuid, null::text, p.name, null::text, null::text,
           '{}'::jsonb
    from public.shop_staff st left join public.profiles p on p.id = st.user_id
    where p_kind = 'shop' and st.shop_id = p_id and st.role = 'staff' and st.accepted_at is not null
    union all
    -- What an admin did to the account.
    select a.created_at, 'audit:' || a.id, 'admin_action', null::uuid, null::text, ap.display_id, null::text, null::text,
           jsonb_build_object('action', a.action)
    from public.admin_audit_log a left join public.profiles ap on ap.id = a.admin_id
    where a.entity_id = any (v_entities)
  ),
  page as (
    select * from ev
    where at is not null
      and (p_before is null
           or at < p_before
           or (at = p_before and p_before_key is not null and key < p_before_key))
    order by at desc, key desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', x.key, 'kind', x.kind, 'at', x.at, 'booking_id', x.booking_id, 'ref', x.ref, 'name', x.name,
           'service_ro', x.service_ro, 'service_en', x.service_en, 'detail', x.detail)
           order by x.at desc, x.key desc) filter (where x.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(x.rn > v_limit), false)
    into v_items, v_more
  from (select pg.*, row_number() over (order by pg.at desc, pg.key desc) as rn from page pg) x;

  return jsonb_build_object('items', v_items, 'more', v_more);
end
$$;
revoke execute on function public.admin_account_activity(text, uuid, timestamptz, text, int) from public, anon;
grant execute on function public.admin_account_activity(text, uuid, timestamptz, text, int) to authenticated;

-- Prezentare: the platform in numbers only (the last 50 events of every account are gone from it).
create or replace function public.admin_overview()
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
      'mrr', coalesce(sum(public.subscription_monthly_ron(sub)) filter (where sub.status in ('active', 'past_due')), 0))
    into v_subs
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  join public.profiles o on o.id = s.owner_id
  where o.deleted_at is null;

  return jsonb_build_object(
    'shops', v_shops,
    'clients', (select count(*) from public.profiles where role = 'client' and deleted_at is null),
    'bookings', v_bookings,
    'reports_pending', (select count(*) from public.reviews where report_status = 'pending'),
    'subscriptions', v_subs);
end
$$;

update public.schema_version set version = 124;
