-- T65 — the fleet plans' prices and vehicles (Eduard, 5 Nov 2026: "Prețurile le vreau 49, 99, 149 și
-- personalizat. 49 – 5 vehicule, 1 coleg inclus; 99 – 10 vehicule, 3 colegi incluși; 149 – 15
-- vehicule, 5 colegi incluși. Apoi personalizat."). Still editable in Admin → Flote.
--
-- · Fleet Start 49 lei · 5 vehicles · 1 colleague; Fleet Business 99 · 10 · 3; Fleet Pro 149 · 15 · 5;
--   Enterprise agreed per company. A colleague past the included ones stays 19 lei.
-- · No company has paid (payments are off), so the subscriptions on trial or not started take the
--   new price of their plan; a subscription that is active (none today) keeps its price.
-- · A company with more active vehicles than its plan now allows keeps them all (nothing is
--   deleted); it only cannot add or bring back another until it is under the limit.

update public.fleet_plans set price_ron = 49, vehicle_limit = 5, included_members = 1, updated_at = now() where key = 'fleet_start';
update public.fleet_plans set price_ron = 99, vehicle_limit = 10, included_members = 3, updated_at = now() where key = 'fleet_business';
update public.fleet_plans set price_ron = 149, vehicle_limit = 15, included_members = 5, updated_at = now() where key = 'fleet_pro';

update public.company_subscriptions s set price_ron = p.price_ron
from public.fleet_plans p
where p.key = s.plan_key and s.status in ('trial', 'inactive') and p.price_ron is not null;

update public.schema_version set version = 98;
