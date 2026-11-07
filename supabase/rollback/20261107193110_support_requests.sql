-- Rollback of A3a (supabase/migrations/20261107193110_support_requests.sql), schema 110 → 109.
--
-- Stops without changing anything while data written after A3a exists: a request in another category
-- than the suggestions, a title, a linked booking, someone responsible, an escalation, a state other
-- than the four of the suggestions, a message or an internal note. Those would be lost (Eduard,
-- 7 Nov 2026: a rollback never deletes real messages or notes). In that case the error lists how many
-- of each exist; they must be exported or kept with a new migration instead.
--
-- Otherwise every A3a object goes and the suggestions are exactly as before (the dates A3a added are
-- dropped with their columns).

do $$
declare
  v_requests int;
  v_messages int;
  v_notes int;
begin
  select count(*) into v_requests from public.suggestions
  where category <> 'suggestions' or title is not null or booking_id is not null or assigned_to is not null
     or escalated_at is not null or status not in ('new', 'planned', 'done', 'declined');
  select count(*) into v_messages from public.suggestion_messages;
  select count(*) into v_notes from public.suggestion_notes;
  if v_requests + v_messages + v_notes > 0 then
    raise exception 'rollback refused: % request(s), % message(s) and % internal note(s) written after A3a would be lost',
      v_requests, v_messages, v_notes
      using hint = 'Export them first or keep them with a new migration; nothing was changed.';
  end if;
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    execute $sql$select cron.unschedule(jobid) from cron.job where jobname = 'sh_close_support_requests'$sql$;
  end if;
end
$$;

-- "Datele mele" as before.
drop function public.export_my_data();
alter function public.export_my_data_a3a() rename to export_my_data;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

drop function public.admin_return_request(uuid, text, uuid);
drop function public.support_escalate_request(uuid, text, uuid);
drop function public.support_add_note(uuid, text, uuid);
drop function public.support_reply_request(uuid, text, text, uuid);
drop function public.support_set_request_status(uuid, text, uuid);
drop function public.support_apply_status(public.profiles, public.suggestions, text);
drop function public.support_assign_request(uuid, uuid, uuid);
drop function public.support_take_request(uuid, uuid);
drop function public.support_get_request(uuid);
drop function public.support_list_staff();
drop function public.support_list_requests();
drop function public.support_staff_ref(uuid);
drop function public.close_resolved_support_requests(timestamptz);
drop function public.reply_my_support_request(uuid, text, uuid);
drop function public.create_support_request(text, text, text, text, uuid);
drop function public.get_my_support_request(uuid);
drop function public.my_support_requests();
drop function public.support_categories_for_me();
drop function public.require_support_author();
drop function public.support_guard(public.profiles, public.suggestions);
drop function public.support_booking_ref(uuid);
drop function public.support_reopen_until(public.suggestions);
drop function public.support_request_open(text);
drop function public.support_status_allowed(text, text);
drop function public.support_request_label(public.suggestions);

alter table public.notification_events drop constraint notification_events_recipient;
alter table public.notification_events add constraint notification_events_recipient
  check (user_id is not null or event in ('review_reported', 'admin_digest', 'walk_in_invite'));

drop table public.suggestion_notes;
drop table public.suggestion_messages;
drop function public.is_support_request_author(uuid);

revoke select (id, body, status, created_at, updated_at, title, category) on public.suggestions from authenticated;
grant select on public.suggestions to authenticated;

drop index public.suggestions_open_idx;
alter table public.suggestions drop constraint suggestions_legacy_status;
alter table public.suggestions drop constraint suggestions_status_check;
alter table public.suggestions add constraint suggestions_status_check
  check (status in ('new', 'planned', 'done', 'declined'));
alter table public.suggestions drop constraint suggestions_body_check;
alter table public.suggestions add constraint suggestions_body_check check (char_length(body) between 1 and 1000);
alter table public.suggestions
  drop column author_read_at,
  drop column last_staff_message_at,
  drop column last_user_message_at,
  drop column closed_at,
  drop column resolved_at,
  drop column first_response_at,
  drop column escalation_reason,
  drop column escalated_by,
  drop column escalated_at,
  drop column assigned_at,
  drop column assigned_to,
  drop column booking_id,
  drop column category,
  drop column title;

drop table public.support_categories;

update public.schema_version set version = 109;
