-- T63c — Fleets on for every client account (Eduard, 31 Oct 2026: the app is not public yet, so
-- nobody outside the team sees anything; the buttons must show without a manual step). Only the
-- one setting changes; the switch and the fleet test accounts stay for later.
update public.platform_settings set fleet_enabled = true where id = 1;

update public.schema_version set version = 93;
