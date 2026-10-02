-- Raport ANAF (Eduard, 2 oct): every shop's company as ANAF answered it, in one list for the admin,
-- sorted into categories, with the code, the CUI, the declared and the official name, the status, the
-- VAT question and when it was checked; also as an Excel export (admin_export kind company_checks).
--
-- category:
--   no_cui        — no CUI in Date de facturare yet
--   unchecked     — a CUI, but no answer from ANAF yet (never asked, or ANAF did not answer)
--   ok            — active at ANAF, the name matches (or there is no legal name to compare)
--   name_mismatch — active at ANAF under another name
--   inactive      — inactive for tax purposes
--   deregistered  — struck off
--   not_found     — ANAF has no company with this CUI
-- vat_mismatch: the shop's "Plătitor de TVA" says otherwise than ANAF.

create function public.admin_list_company_checks()
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
        'shop_id', s.id,
        'shop_name', s.name,
        'city', s.city,
        'display_id', o.display_id,
        'state', public.shop_state(s.id),
        'vat_id', b.vat_id,
        'legal_name', b.legal_name,
        'vat_payer', b.vat_payer,
        'anaf_status', b.anaf_status,
        'anaf_name', b.anaf_name,
        'anaf_address', b.anaf_address,
        'anaf_vat_payer', b.anaf_vat_payer,
        'anaf_name_match', b.anaf_name_match,
        'anaf_checked_at', b.anaf_checked_at,
        'category', case
          when b.vat_id is null then 'no_cui'
          when b.anaf_status is null then 'unchecked'
          when b.anaf_status = 'active' and b.anaf_name_match is false then 'name_mismatch'
          when b.anaf_status = 'active' then 'ok'
          else b.anaf_status end,
        'vat_mismatch', b.anaf_vat_payer is not null and b.vat_payer is not null
                        and b.vat_payer is distinct from b.anaf_vat_payer
      ) order by
          case
            when b.anaf_status in ('not_found', 'deregistered', 'inactive') then 0
            when b.anaf_status = 'active' and b.anaf_name_match is false then 1
            when b.anaf_vat_payer is not null and b.vat_payer is not null and b.vat_payer is distinct from b.anaf_vat_payer then 2
            when b.vat_id is not null and b.anaf_status is null then 3
            when b.vat_id is null then 4
            else 5 end,
          s.created_at desc, s.id)
    from public.shops s
    join public.profiles o on o.id = s.owner_id
    left join public.shop_billing b on b.shop_id = s.id
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.admin_list_company_checks() from public, anon;
grant execute on function public.admin_list_company_checks() to authenticated;

-- The same list as an Excel export (audited like the others).
create or replace function public.admin_export(p_kind text, p_filters jsonb default '{}'::jsonb)
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
          'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
          'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
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
  elsif p_kind = 'company_checks' then
    v_rows := public.admin_list_company_checks();
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

update public.schema_version set version = 47;
