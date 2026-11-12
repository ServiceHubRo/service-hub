-- Rollback of A5 (supabase/migrations/20261112120000_procedures.sql), schema 118 → 117.
--
-- Refuses to run (and says how many) once anything written by a person exists: a procedure or a version
-- created, changed, sent, approved or published, a „Am citit” confirmation, a responsible named, or a
-- procedure entry in the audit log. Those would be lost. With only the first content (the drafts the
-- migration wrote, unchanged), nothing real is lost: the tables, the functions and the audit classes go.

do $$
declare
  v_people bigint := (select count(*) from public.procedure_versions where not seeded or author_id is not null);
  v_changed bigint := (select count(*) from public.procedure_versions where status <> 'draft' or updated_at <> created_at)
                    + (select count(*) from public.procedures where status <> 'draft' or updated_at <> created_at or created_by is not null);
  v_acks bigint := (select count(*) from public.procedure_acknowledgements);
  v_owners bigint := (select count(*) from public.procedure_responsibilities);
  v_logged bigint := (select count(*) from public.admin_audit_log where entity_type in ('procedure', 'procedure_category'));
begin
  if v_people + v_changed + v_acks + v_owners + v_logged > 0 then
    raise exception 'Refused: % versions written by a person, % changed procedures or versions, % confirmations, % responsibles and % procedure entries in the audit log exist. They would be lost.',
      v_people, v_changed, v_acks, v_owners, v_logged;
  end if;
end
$$;

drop function public.admin_procedure_set_responsible(text, uuid, uuid);
drop function public.admin_procedure_acknowledgements(uuid);
drop function public.admin_procedure_archive(uuid, boolean, uuid);
drop function public.admin_procedure_set_settings(uuid, jsonb, uuid);
drop function public.admin_procedure_publish(uuid, uuid);
drop function public.procedure_publish(public.procedures, public.procedure_versions, public.profiles);
drop function public.admin_procedure_approve(uuid, boolean, uuid);
drop function public.staff_procedure_acknowledge(uuid, uuid);
drop function public.staff_procedure_step(uuid, text, uuid);
drop function public.staff_procedure_new_version(uuid, uuid);
drop function public.staff_procedure_save(uuid, jsonb, jsonb, jsonb, uuid);
drop function public.staff_procedure_create(jsonb, jsonb, jsonb, uuid);
drop function public.procedure_meta_checked(jsonb, public.procedures, boolean);
drop function public.procedure_en(jsonb);
drop function public.procedure_content_checked(jsonb, text);
drop function public.support_procedures_for_request(uuid);
drop function public.staff_procedure_get(uuid);
drop function public.staff_procedures();
drop function public.procedure_listed(public.procedures, public.profiles);
drop function public.procedure_json(public.procedures, public.profiles, boolean);
drop function public.procedure_version_json(public.procedure_versions, boolean);
drop function public.procedure_readers(public.procedures);
drop function public.procedure_responsible_json(text);
drop function public.procedure_can_edit(public.procedures, uuid, public.profiles);
drop function public.procedure_can_read(public.procedures, public.profiles);

alter table public.procedures drop constraint procedures_published_version_fk;
drop table public.procedure_responsibilities;
drop table public.procedure_acknowledgements;
-- The seeded drafts go with their table (the guard lets drafts be deleted).
drop table public.procedure_versions;
drop function public.procedure_versions_guard();
drop table public.procedures;

drop function public.procedure_content_clean(jsonb);
drop function public.procedure_content_issue(jsonb);
drop function public.procedure_category_ok(text);

delete from public.audit_action_classes where action in ('create_procedure', 'save_procedure_draft', 'new_procedure_version',
  'submit_procedure', 'return_procedure_draft', 'discard_procedure_draft', 'approve_procedure', 'publish_procedure',
  'update_procedure_settings', 'archive_procedure', 'restore_procedure', 'acknowledge_procedure', 'set_procedure_responsible');

update public.schema_version set version = 117;
