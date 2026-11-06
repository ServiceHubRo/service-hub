-- Rollback of M5 (supabase/migrations/20261106170746_fleet_quote_changes_cancel.sql), schema 104 → 103.
-- Run only in reverse order. Lost: the change requests and their reasons. Kept: every cancellation
-- (a cancelled booking stays cancelled, with its reason), every other decision.
drop function public.fleet_request_quote_changes(uuid, uuid, text, uuid);
drop function public.fleet_cancel_booking(uuid, text, uuid);
delete from public.company_quote_decisions where decision = 'changes_requested';
alter table public.company_quote_decisions drop column reason;
alter table public.company_quote_decisions drop constraint company_quote_decisions_decision_check;
-- The check as created in 20261031175248_fleet_bookings.sql (inline, the same name).
alter table public.company_quote_decisions add constraint company_quote_decisions_decision_check
  check (decision in ('approved', 'partially_approved', 'refused'));

update public.schema_version set version = 103;
