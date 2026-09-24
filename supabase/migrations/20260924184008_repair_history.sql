-- T10 — The shop's repair history (FR §4.3, P16b).
--   list_shop_history(): every finished booking of the caller's shop — done, quote refused,
--   expired, cancelled, no-show — newest first, with what the history cards, the search and the
--   CSV export need, in one read. Declined requests never became jobs and stay out.
-- The client's vehicle history (FR §3.6, P16c) needs nothing new: the client reads their own
-- bookings, quotes and lines straight from the tables (RLS), as Programări does since T09.

-- ---------------------------------------------------------------------------------------------
-- list_shop_history — returns {shop: {id, name}, bookings: [...]}.
-- Booking: its own columns (slot as 'HH:MM'), service_ro/en/icon, `has_client` (false once the
-- client deleted the account: no conversation to open), `ended_at` (when the job ended: done_at,
-- cancelled_at, or the last status change) and the quote that belongs to how it ended — the
-- accepted version of a finished job, the refused one, the expired one — with its lines.
-- A jsonb answer, so a shop with thousands of jobs is never cut at PostgREST's row limit.
-- ---------------------------------------------------------------------------------------------
create function public.list_shop_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_caller();
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
    ), '[]'::jsonb)
  );
end
$$;

grant execute on function public.list_shop_history() to authenticated;

update public.schema_version set version = 16;
