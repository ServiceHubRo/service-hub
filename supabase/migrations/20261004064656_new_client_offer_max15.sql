-- New-client offers up to 15% (Eduard, 4 Oct): 5%, 10% or 15% off labor on the first booking. A
-- bigger offer next to the 3–7% loyalty discounts would treat regular clients unfairly and read
-- as a price war. A shop that picked 20–30% is moved to 15% (a lower value notifies nobody:
-- shops_after_offer fires only when an offer is set or raised); offers already promised on
-- bookings are kept as they are.

alter table public.shops drop constraint shops_new_client_offer_check;
update public.shops set new_client_offer = 15 where new_client_offer > 15;
alter table public.shops add constraint shops_new_client_offer_check check (new_client_offer in (5, 10, 15));

update public.schema_version set version = 55;
