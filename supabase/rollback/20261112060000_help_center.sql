-- Rollback of A4 (supabase/migrations/20261112060000_help_center.sql), schema 117 → 116.
--
-- Refuses to run (and says how many) once anything written by a person exists: a reader's vote, an
-- article or category the admin created, changed, moved, published or withdrawn. Those would be lost.
-- With only the first content (as the migration wrote it), nothing real is lost: the tables, the
-- functions and the audit classes go, and the data export is the one before A4.

do $$
declare
  v_votes bigint := (select count(*) from public.help_feedback);
  v_versions bigint := (select count(*) from public.help_article_revisions where action <> 'seed');
  v_changed bigint := (select count(*) from public.help_articles where version <> 1 or created_by is not null or updated_by is not null)
                    + (select count(*) from public.help_categories where updated_at <> created_at);
  v_seeded bigint := (select count(*) from public.help_article_revisions where action = 'seed');
  v_articles bigint := (select count(*) from public.help_articles);
  v_logged bigint := (select count(*) from public.admin_audit_log where action like '%help_%');
begin
  if v_votes + v_versions + v_changed + v_logged > 0 or v_articles <> v_seeded then
    raise exception 'Refused: % votes, % saved versions, % changed articles or categories, % articles not from the first content and % Help Center entries in the audit log exist. They would be lost.',
      v_votes, v_versions, v_changed, v_articles - v_seeded, v_logged;
  end if;
end
$$;

-- ------------------------------------------------------------------ the data export as before
drop function public.export_my_data();
alter function public.export_my_data_a4() rename to export_my_data;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ------------------------------------------------------------------ functions, tables, classes
drop function public.admin_help_move(text, uuid, int, uuid);
drop function public.admin_help_delete_category(uuid, uuid);
drop function public.admin_help_save_category(uuid, jsonb, uuid);
drop function public.admin_help_delete_article(uuid, uuid);
drop function public.admin_help_set_article_status(uuid, text, uuid);
drop function public.admin_help_save_article(uuid, jsonb, uuid);
drop function public.help_json_texts(jsonb);
drop function public.admin_help_get_article(uuid);
drop function public.admin_help_list();
drop function public.help_revision(public.help_articles, text, text[]);
drop function public.help_category_json(public.help_categories);
drop function public.help_article_json(public.help_articles);
drop function public.help_send_feedback(uuid, boolean, uuid);
drop function public.help_center(text);
drop function public.help_can_read(text[], text[], jsonb);
drop function public.help_reader();

drop table public.help_feedback;
drop table public.help_article_revisions;
drop table public.help_articles;
drop table public.help_categories;

drop function public.help_keywords_ok(text[]);
drop function public.help_text_ok(text, int, int);
drop function public.help_audience_ok(text[]);

delete from public.audit_action_classes where action in ('create_help_article', 'update_help_article', 'publish_help_article',
  'unpublish_help_article', 'delete_help_article', 'create_help_category', 'update_help_category', 'delete_help_category', 'move_help_item');

update public.schema_version set version = 116;
