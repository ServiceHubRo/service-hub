-- Zones, a fix to service_areas: a shop owner saving the address (a plain update of shops) runs the
-- shops_set_area trigger as themselves, and the zone list (service_areas) is readable by nobody
-- through the API, so the save failed. The trigger and the zone lookups now run with the definer's
-- rights; they only read the public list of zones and set or answer a code (still not callable
-- from the API).
alter function public.shops_set_area() security definer;
alter function public.area_for_point(double precision, double precision) security definer;
alter function public.area_for_address(text, text, double precision, double precision) security definer;

update public.schema_version set version = 61;
