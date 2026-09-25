-- 20260925152738_staff_seats.sql and T17's 20260925151125_shop_reports.sql were written in
-- parallel and both set schema_version 23. The shop reports reached the database first, so the
-- paid colleagues are version 24.
update public.schema_version set version = 24;
