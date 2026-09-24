-- T07 — Garage. The browser picks the id of a new car (once per form, like a request id), so a
-- save retried after a lost answer finds the row it already wrote instead of adding the car twice
-- (CLAUDE.md §6.7). The id is still checked like every other column: RLS keeps the row the
-- caller's own, and a taken id is refused by the primary key.
grant insert (id) on public.cars to authenticated;

update public.schema_version set version = 13;
