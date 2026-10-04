-- Smaller loyalty discounts (Eduard, 4 Oct): level 1 gives 3% or 5% off labor, level 2 gives 5% or
-- 7% (never less than level 1, as before). A shop that had picked more is moved to the nearest
-- allowed value below it; discounts already promised on bookings are kept as they are.

alter table public.shops
  drop constraint shops_loyalty_l1_check,
  drop constraint shops_loyalty_l2_check;

update public.shops set loyalty_l1 = 5 where loyalty_l1 > 5;
update public.shops set loyalty_l2 = 7 where loyalty_l2 > 7;

alter table public.shops
  add constraint shops_loyalty_l1_check check (loyalty_l1 in (3, 5)),
  add constraint shops_loyalty_l2_check check (loyalty_l2 in (5, 7));

update public.schema_version set version = 54;
