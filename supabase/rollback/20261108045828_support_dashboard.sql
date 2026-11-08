-- Rollback of A3c1 (supabase/migrations/20261108045828_support_dashboard.sql), schema 112 → 111.
--
-- Loses nothing: support_signals holds only "this request changed at" marks, made again by the next
-- change. The A3a list (support_list_requests) was never changed and keeps working.

drop function public.support_dashboard();
drop function public.support_inbox(text, text, text, int, boolean, timestamptz, uuid, int);
drop function public.support_waiting_since(public.suggestions);
drop index public.suggestions_inbox_idx;

drop trigger suggestion_files_signal on public.suggestion_files;
drop trigger suggestion_notes_signal on public.suggestion_notes;
drop trigger suggestion_messages_signal on public.suggestion_messages;
drop trigger suggestions_signal on public.suggestions;
drop function public.support_signal_part();
drop function public.support_signal_request();
drop function public.support_signal(uuid, boolean);

-- Dropping the table also takes it out of the supabase_realtime publication.
drop table public.support_signals;
drop function public.support_signal_reader();

update public.schema_version set version = 111;
