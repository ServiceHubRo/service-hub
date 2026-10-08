-- T31a, at scale (Eduard, 5 oct: "10 shops with 5–10 years of data?"): measured with 50 000
-- imported jobs a shop, Istoric's single read grew to ~17 MB. Now it carries the newest 100
-- imported jobs and how many there are; older ones come in pages, and the search over them runs
-- here (`list_imported_jobs`). One import may also hold up to 100 000 rows (was 20 000).

-- What the search looks through: lower case, without Romanian diacritics.
create function public.search_fold(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$ select translate(lower(coalesce(p_text, '')), 'ăâîșțşţ', 'aaisstst') $$;
revoke execute on function public.search_fold(text) from public, anon, authenticated;

alter table public.imported_jobs add column search_text text generated always as (
  public.search_fold(
    coalesce(client_name, '') || ' ' || coalesce(client_phone, '') || ' ' || coalesce(car_snapshot->>'make', '') || ' '
    || coalesce(car_snapshot->>'model', '') || ' ' || coalesce(car_snapshot->>'plate', '') || ' '
    || coalesce(car_snapshot->>'plate_norm', '') || ' ' || coalesce(work, '') || ' ' || coalesce(odometer::text, ''))
) stored;
create index imported_jobs_page_idx on public.imported_jobs (shop_id, day desc, id desc);

-- One imported job as the app reads it.
create function public.imported_job_json(j public.imported_jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', j.id,
    'day', j.day,
    'client_name', j.client_name,
    'client_phone', j.client_phone,
    'car_snapshot', j.car_snapshot,
    'odometer', j.odometer,
    'work', j.work,
    'cost', j.cost)
$$;
revoke execute on function public.imported_job_json(public.imported_jobs) from public, anon, authenticated;

create or replace function public.list_shop_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'ref', b.ref,
          'status', b.status,
          'date', b.date,
          'slot', to_char(b.slot, 'HH24:MI'),
          'note', b.note,
          'service_id', b.service_id,
          'service_ro', s.name_ro,
          'service_en', s.name_en,
          'service_icon', s.icon,
          'extra_services', public.service_names(b.extra_service_ids),
          'client_name', b.client_name,
          'client_phone', b.client_phone,
          'has_client', b.client_id is not null,
          'car_snapshot', b.car_snapshot,
          'odometer', b.odometer,
          'work', b.work,
          'cost', b.cost,
          'done_at', b.done_at,
          'cancelled_by', b.cancelled_by,
          'cancel_reason', b.cancel_reason,
          'closed_reason', b.closed_reason,
          'ended_at', e.ended_at,
          'quote', q.quote
        ) order by e.ended_at desc, b.id)
      from public.bookings b
      cross join lateral (select coalesce(b.done_at, b.cancelled_at, b.status_changed_at) as ended_at) e
      left join public.services s on s.id = b.service_id
      left join lateral (
        select jsonb_build_object(
            'id', qq.id,
            'version', qq.version,
            'status', qq.status,
            'note', qq.note,
            'inspection_fee', qq.inspection_fee,
            'total_sent', qq.total_sent,
            'total_approved', qq.total_approved,
            'sent_at', qq.sent_at,
            'decided_at', qq.decided_at,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved)
                order by qi.position)
              from public.quote_items qi where qi.quote_id = qq.id), '[]'::jsonb)
          ) as quote
        from public.quotes qq
        where qq.booking_id = b.id
          and case b.status
                when 'done' then qq.status in ('accepted', 'partially_accepted')
                when 'quote_refused' then qq.status = 'refused'
                when 'expired' then qq.status = 'expired'
                else false
              end
        order by qq.version desc
        limit 1
      ) q on true
      where b.shop_id = v_shop.id
        and b.status in ('done', 'quote_refused', 'expired', 'cancelled', 'no_show')
        and b.closed_reason is distinct from 'unanswered'
    ), '[]'::jsonb),
    -- T31a: the newest imported jobs (a long history comes in pages: list_imported_jobs).
    'imported', coalesce((
      select jsonb_agg(public.imported_job_json(j) order by j.day desc, j.id desc)
      from (
        select * from public.imported_jobs ij
        where ij.shop_id = v_shop.id
        order by ij.day desc, ij.id desc
        limit 100
      ) j
    ), '[]'::jsonb),
    'imported_total', (select count(*) from public.imported_jobs ij where ij.shop_id = v_shop.id)
  );
end
$$;
grant execute on function public.list_shop_history() to authenticated;

-- A page of the caller's shop's imported jobs, newest first, after (p_before_day, p_before_id);
-- with p_query, only those holding every word (plate with or without spaces, client, phone, car,
-- work, odometer), without diacritics or case.
create function public.list_imported_jobs(
  p_query text default null,
  p_before_day date default null,
  p_before_id uuid default null,
  p_limit int default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_words text[];
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  perform public.require_reader();
  v_shop := public.require_my_shop();
  v_words := array(select w from regexp_split_to_table(public.search_fold(btrim(coalesce(p_query, ''))), '\s+') w where w <> '');
  return jsonb_build_object('jobs', coalesce((
    select jsonb_agg(public.imported_job_json(j) order by j.day desc, j.id desc)
    from (
      select * from public.imported_jobs ij
      where ij.shop_id = v_shop
        and (p_before_day is null or (ij.day, ij.id) < (p_before_day, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        and not exists (
          select 1 from unnest(v_words) w
          where position(w in ij.search_text) = 0
            and position(w in replace(ij.search_text, ' ', '')) = 0)
      order by ij.day desc, ij.id desc
      limit v_limit + 1
    ) j), '[]'::jsonb));
end
$$;
revoke execute on function public.list_imported_jobs(text, date, uuid, int) from public, anon;
grant execute on function public.list_imported_jobs(text, date, uuid, int) to authenticated;

-- A large shop brings its whole history in one file.
update public.platform_settings
  set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object('import_rows', 100000)
where id = 1 and not (coalesce(limits, '{}'::jsonb) ? 'import_rows');

update public.schema_version set version = 62;
