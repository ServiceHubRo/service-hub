-- Rollback of A7 (supabase/migrations/20261112170000_a7_integration.sql), schema 120 → 119.
--
-- Nothing A7 wrote needs keeping: the notifications it closed as obsolete stay closed (they were
-- never true any more). The wrapped functions go back to their names and grants at schema 119.
-- The app must go back with it (git revert of the A7 pull request): it expects schema 120 and knows
-- the code company_last_admin.

drop function public.prepare_account_deletion(uuid);
alter function public.prepare_account_deletion_a6(uuid) rename to prepare_account_deletion;
revoke execute on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

drop function public.claim_notifications(integer);
alter function public.claim_notifications_a6(integer) rename to claim_notifications;
revoke execute on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

drop function public.notification_still_due(uuid, text, jsonb, uuid);

update public.schema_version set version = 119;
