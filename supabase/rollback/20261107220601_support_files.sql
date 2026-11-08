-- Rollback of A3b (supabase/migrations/20261107220601_support_files.sql), schema 111 → 110.
--
-- Stops without changing anything while any file exists: a row of suggestion_files, an object in the
-- bucket support-files or a path still waiting to leave Storage (Eduard, 7 Nov 2026: a rollback never
-- deletes real data). The error says how many of each.
--
-- Otherwise the request functions return to their A3a form (no files), and the files' tables,
-- functions, cleanup and bucket go.

do $$
declare
  v_rows int;
  v_objects int;
  v_queued int;
begin
  select count(*) into v_rows from public.suggestion_files;
  select count(*) into v_objects from storage.objects where bucket_id = 'support-files';
  select count(*) into v_queued from public.support_file_deletions;
  if v_rows + v_objects + v_queued > 0 then
    raise exception 'rollback refused: % file row(s), % stored object(s) and % path(s) waiting for deletion would be lost',
      v_rows, v_objects, v_queued
      using hint = 'Export or delete them first (the daily cleanup empties the queue); nothing was changed.';
  end if;
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    execute $sql$select cron.unschedule(jobid) from cron.job where jobname = 'sh_support_files_cleanup'$sql$;
  end if;
end
$$;

-- The A3a request functions and export, as they were.
drop function public.export_my_data();
alter function public.export_my_data_a3b() rename to export_my_data;
grant execute on function public.export_my_data() to authenticated;

drop function public.support_get_request(uuid);
alter function public.support_get_request_a3a(uuid) rename to support_get_request;
grant execute on function public.support_get_request(uuid) to authenticated;

drop function public.get_my_support_request(uuid);
alter function public.get_my_support_request_a3a(uuid) rename to get_my_support_request;
grant execute on function public.get_my_support_request(uuid) to authenticated;

drop function public.support_reply_request(uuid, text, text, uuid, uuid[]);
alter function public.support_reply_request_a3a(uuid, text, text, uuid) rename to support_reply_request;
grant execute on function public.support_reply_request(uuid, text, text, uuid) to authenticated;

drop function public.reply_my_support_request(uuid, text, uuid, uuid[]);
alter function public.reply_my_support_request_a3a(uuid, text, uuid) rename to reply_my_support_request;
grant execute on function public.reply_my_support_request(uuid, text, uuid) to authenticated;

drop function public.create_support_request(text, text, text, text, uuid, uuid[]);
alter function public.create_support_request_a3a(text, text, text, text, uuid) rename to create_support_request;
grant execute on function public.create_support_request(text, text, text, text, uuid) to authenticated;

drop function public.kick_support_files_cleanup();
drop function public.support_files_stray(int, timestamptz);
drop function public.support_file_deletions_done(text[]);
drop function public.support_file_deletions_next(int);
drop function public.support_files_collect(timestamptz);
drop function public.support_request_files(uuid, boolean);
drop function public.support_attach_files(uuid, uuid, uuid, uuid[]);
drop function public.support_file_open(uuid, text, uuid, uuid);
drop function public.support_file_register(uuid, text, uuid, text, text, int, text, text);
drop function public.support_file_begin(uuid, text, uuid);
drop function public.support_file_caller(uuid, text, uuid);

drop trigger suggestion_files_queue_deletion on public.suggestion_files;
drop function public.queue_support_file_deletion();
drop table public.support_file_deletions;
drop table public.suggestion_files;

delete from storage.buckets where id = 'support-files';

update public.schema_version set version = 110;
