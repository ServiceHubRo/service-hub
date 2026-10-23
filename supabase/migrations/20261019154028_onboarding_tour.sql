-- T39 — Ghidul de început și turul aplicației (Eduard, 19 Oct 2026).
--
-- · tour_seen_at: the short tour (a highlighted spot per main feature, "Sari peste") was finished
--   or skipped; it is shown once per account, on any device.
-- · guide_hidden_at: the client hid "Primii pași" on Caută (or did all of it).
-- Both are the account's own, written from the browser like push_prompt_dismissed_at.

alter table public.profiles
  add column tour_seen_at timestamptz,
  add column guide_hidden_at timestamptz;

grant update (tour_seen_at, guide_hidden_at) on public.profiles to authenticated;

update public.schema_version set version = 81;
