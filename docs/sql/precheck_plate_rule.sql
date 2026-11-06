-- Read-only check before applying M7 (20261106062557_plate_rule). It changes nothing. It lists the
-- rows that would become equal under the new plate rule where a unique index requires one row:
-- two active vehicles of one company, or two imported cars of one shop. An empty answer means the
-- migration applies; otherwise the migration stops by itself and these rows need a decision first.
with norm as (
  select 'company_vehicles' as tbl, company_id as owner, id, plate,
         nullif(upper(regexp_replace(coalesce(plate, ''), '[[:space:]!-/:-@\[-`{-~·]', '', 'g')), '') as canon
  from public.company_vehicles where archived_at is null
  union all
  select 'shop_client_cars', shop_id, id, plate,
         nullif(upper(regexp_replace(coalesce(plate, ''), '[[:space:]!-/:-@\[-`{-~·]', '', 'g')), '')
  from public.shop_client_cars
)
select tbl, owner, canon, array_agg(plate order by plate) as plates, count(*)
from norm where canon is not null
group by tbl, owner, canon having count(*) > 1;
