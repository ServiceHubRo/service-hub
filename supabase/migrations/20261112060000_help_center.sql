-- A4 — Help Center (Eduard, 12 Nov 2026). Articles and frequent questions in Romanian and English,
-- grouped in categories, shown first to the people they are for (drivers, shops, company members, the
-- Service-Hub team), searched in the app, rated „Da / Nu” by readers, and managed by the admin
-- (drafts, publishing, withdrawing, order, featured, keywords, who sees what, history of every change).
--
-- Security (CLAUDE.md §6.1): the four tables have RLS on and no grant at all to anon or authenticated;
-- every read and write goes through the functions below, which check the caller in the database:
--   help_center(lang)               any signed-in account: only published articles it may see
--   help_send_feedback(...)         the same readers, only on an article they may see
--   admin_help_*                    the admin, after the second step (require_admin)
-- Article text is Markdown read by the app's own reader (src/lib/markdown.ts), which builds React
-- elements, never HTML; the database also refuses raw HTML, scripts, placeholders and links that are
-- not https:// or mailto: (help_text_ok), so no stored text can turn into markup.
--
-- Feedback keeps only the vote, the article and the account (one vote per account and article, which
-- the reader may change); no text, device or address. It goes with the account (on delete cascade),
-- is in the reader's data export and only its totals reach the admin.
--
-- Nothing existing changes: four new tables, new functions, the data export gains one key, the audit
-- classes gain the new actions. Rollback: supabase/rollback/20261112060000_help_center.sql.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- Who an article or a category is for: client (drivers), shop, fleet (members of a company),
-- staff (the Service-Hub team only). Empty = everyone.
create function public.help_audience_ok(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and p <@ array['client', 'shop', 'fleet', 'staff']::text[]
     and cardinality(p) = cardinality(array(select distinct unnest(p)))
$$;
revoke execute on function public.help_audience_ok(text[]) from public, anon, authenticated;

-- Text the admin writes: length, no control characters, no raw HTML or comments, no script or data
-- addresses, no {{placeholders}}, and every Markdown link to https:// or mailto: only.
create function public.help_text_ok(p text, p_min int, p_max int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and char_length(btrim(p)) between p_min and p_max
     and p !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
     and p !~* '<\s*(!|[/?]?\s*[a-z])'
     and p !~* '(javascript|vbscript)\s*:'
     and p !~* '\mdata:[a-z-]+/'
     and p !~ '\{\{'
     and p !~* '\]\(\s*(?!https://|mailto:)'
$$;
revoke execute on function public.help_text_ok(text, int, int) from public, anon, authenticated;

-- Keywords: at most 20, each 2–40 characters, plain words.
create function public.help_keywords_ok(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and cardinality(p) <= 20
     and not exists (select 1 from unnest(p) k where not public.help_text_ok(k, 2, 40) or k ~ '[\n\r\t]')
$$;
revoke execute on function public.help_keywords_ok(text[]) from public, anon, authenticated;

create table public.help_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  icon text not null default 'book' check (icon in ('book', 'car', 'wrench', 'truck', 'shield', 'card', 'calendar', 'bell', 'users', 'file')),
  audience text[] not null default '{}' check (public.help_audience_ok(audience)),
  position int not null,
  active boolean not null default true,
  name_ro text not null check (public.help_text_ok(name_ro, 2, 80)),
  name_en text not null check (public.help_text_ok(name_en, 2, 80)),
  description_ro text check (description_ro is null or public.help_text_ok(description_ro, 2, 200)),
  description_en text check (description_en is null or public.help_text_ok(description_en, 2, 200)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.help_articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.help_categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  -- article: a page of its own; faq: a short question and answer, opened in place.
  kind text not null default 'article' check (kind in ('article', 'faq')),
  -- draft: only the admin sees it; published: readers see it; archived: withdrawn, kept for later.
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  audience text[] not null default '{}' check (public.help_audience_ok(audience)),
  -- For fleet articles: the company roles that see it (empty = every member).
  company_roles text[] not null default '{}'
    check (company_roles <@ array['admin', 'manager', 'driver', 'accountant']::text[]),
  featured boolean not null default false,
  position int not null,
  title_ro text not null check (public.help_text_ok(title_ro, 3, 140)),
  summary_ro text check (summary_ro is null or public.help_text_ok(summary_ro, 3, 300)),
  body_ro text not null check (public.help_text_ok(body_ro, 10, 20000)),
  keywords_ro text[] not null default '{}' check (public.help_keywords_ok(keywords_ro)),
  -- English is optional: an article without it is not shown in English (help_center lists it as
  -- untranslated, so the app says so instead of "not found").
  title_en text check (title_en is null or public.help_text_ok(title_en, 3, 140)),
  summary_en text check (summary_en is null or public.help_text_ok(summary_en, 3, 300)),
  body_en text check (body_en is null or public.help_text_ok(body_en, 10, 20000)),
  keywords_en text[] not null default '{}' check (public.help_keywords_ok(keywords_en)),
  version int not null default 1,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((title_en is null) = (body_en is null)),
  check (summary_en is null or title_en is not null),
  check (cardinality(company_roles) = 0 or 'fleet' = any (audience))
);
create index help_articles_category_idx on public.help_articles (category_id, position);

-- Every saved version of an article (the history the admin reads); written only by the functions.
create table public.help_article_revisions (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.help_articles(id) on delete cascade,
  version int not null,
  action text not null check (action in ('seed', 'create', 'update', 'publish', 'unpublish', 'archive')),
  -- The fields that changed (names only) and the article as it was saved.
  changed text[] not null default '{}',
  snapshot jsonb not null,
  author_id uuid,
  author_display_id text,
  created_at timestamptz not null default now()
);
create index help_article_revisions_article_idx on public.help_article_revisions (article_id, id desc);

create table public.help_feedback (
  article_id uuid not null references public.help_articles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (article_id, user_id)
);
create index help_feedback_user_idx on public.help_feedback (user_id);

alter table public.help_categories enable row level security;
alter table public.help_articles enable row level security;
alter table public.help_article_revisions enable row level security;
alter table public.help_feedback enable row level security;
revoke all on public.help_categories, public.help_articles, public.help_article_revisions, public.help_feedback
  from public, anon, authenticated;
revoke all on sequence public.help_article_revisions_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Who is reading
-- ---------------------------------------------------------------------------------------------

-- The caller as a reader: the audiences it belongs to, its company roles and whether it is the team.
-- A client is also „fleet” when fleets are on for it and it is a member of a company in use.
create function public.help_reader()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_roles text[];
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  select * into v from public.profiles p where p.id = auth.uid();
  if v.id is null or v.deleted_at is not null then
    perform public.fail('not_signed_in');
  end if;
  if v.role in ('support', 'admin') then
    perform public.require_staff();
    return jsonb_build_object('staff', true, 'types', jsonb_build_array('client', 'shop', 'fleet', 'staff'), 'company_roles', '[]'::jsonb);
  end if;
  if v.role = 'client'
     and (v.fleet_beta or coalesce((select ps.fleet_enabled from public.platform_settings ps where ps.id = 1), false)) then
    v_roles := array(
      select distinct m.role from public.company_members m
      join public.companies c on c.id = m.company_id
      where m.user_id = v.id and m.accepted_at is not null and c.archived_at is null
      order by m.role);
  end if;
  return jsonb_build_object(
    'staff', false,
    'types', to_jsonb(case when v.role = 'shop' then array['shop']
                           when coalesce(cardinality(v_roles), 0) > 0 then array['client', 'fleet']
                           else array['client'] end),
    'company_roles', to_jsonb(coalesce(v_roles, '{}')),
    -- Fleets on for this client (a company can be created), even without a company yet.
    'fleet_on', v.role = 'client'
      and (v.fleet_beta or coalesce((select ps.fleet_enabled from public.platform_settings ps where ps.id = 1), false)));
end
$$;
revoke execute on function public.help_reader() from public, anon, authenticated;

-- Whether a reader sees an article (published or not is checked by the caller):
--   the team sees everything;
--   „staff” articles only the team;
--   an empty audience everyone;
--   otherwise one of the reader's audiences; a fleet article only to members with one of its
--   company roles (empty = all) — and an article for clients that is also for fleets (creating a
--   company) to clients for whom fleets are on.
create function public.help_can_read(p_audience text[], p_company_roles text[], p_reader jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_types text[] := array(select jsonb_array_elements_text(p_reader->'types'));
  v_roles text[] := array(select jsonb_array_elements_text(p_reader->'company_roles'));
begin
  if (p_reader->>'staff')::boolean then
    return true;
  end if;
  if 'staff' = any (p_audience) then
    return false;
  end if;
  if cardinality(p_audience) = 0 then
    return true;
  end if;
  if 'client' = any (p_audience) and 'client' = any (v_types) then
    -- A client article that is also about fleets needs fleets to be on for this client.
    return not ('fleet' = any (p_audience)) or coalesce((p_reader->>'fleet_on')::boolean, false);
  end if;
  if 'shop' = any (p_audience) and 'shop' = any (v_types) then
    return true;
  end if;
  if 'fleet' = any (p_audience) and 'fleet' = any (v_types) then
    return cardinality(p_company_roles) = 0 or p_company_roles && v_roles;
  end if;
  return false;
end
$$;
revoke execute on function public.help_can_read(text[], text[], jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------------------------

-- The Help Center in one language: the categories that have something for the caller, the published
-- articles it may read (with their text, so the app searches without asking again), the articles that
-- exist but not in this language, and the caller's own votes.
create function public.help_center(p_lang text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reader jsonb := public.help_reader();
  v_en boolean;
begin
  if p_lang is null or p_lang not in ('ro', 'en') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'lang'));
  end if;
  v_en := p_lang = 'en';

  return (
    with readable as (
      select a.* from public.help_articles a
      join public.help_categories c on c.id = a.category_id and c.active
      where a.status = 'published' and public.help_can_read(a.audience, a.company_roles, v_reader)
    ), shown as (
      select * from readable r where not v_en or r.title_en is not null
    )
    select jsonb_build_object(
      'lang', p_lang,
      'me', v_reader - 'fleet_on',
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', c.id, 'slug', c.slug, 'icon', c.icon, 'audience', to_jsonb(c.audience), 'position', c.position,
            'name', case when v_en then c.name_en else c.name_ro end,
            'description', case when v_en then c.description_en else c.description_ro end)
          order by c.position, c.slug)
        from public.help_categories c
        where c.active and exists (select 1 from shown s where s.category_id = c.id)), '[]'::jsonb),
      'articles', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', s.id, 'slug', s.slug, 'category_id', s.category_id, 'kind', s.kind,
            'audience', to_jsonb(s.audience), 'featured', s.featured, 'position', s.position,
            'title', case when v_en then s.title_en else s.title_ro end,
            'summary', case when v_en then s.summary_en else s.summary_ro end,
            'body', case when v_en then s.body_en else s.body_ro end,
            'keywords', to_jsonb(case when v_en then s.keywords_en else s.keywords_ro end),
            'updated_at', s.updated_at)
          order by s.position, s.slug)
        from shown s), '[]'::jsonb),
      'untranslated', coalesce((
        select jsonb_agg(r.slug order by r.slug) from readable r where v_en and r.title_en is null), '[]'::jsonb),
      'votes', coalesce((
        select jsonb_object_agg(f.article_id, f.helpful)
        from public.help_feedback f join shown s on s.id = f.article_id
        where f.user_id = auth.uid()), '{}'::jsonb))
  );
end
$$;
revoke execute on function public.help_center(text) from public, anon;
grant execute on function public.help_center(text) to authenticated;

-- „Ți-a fost util acest articol?” — Da / Nu. One vote per account and article; voting again changes it.
create function public.help_send_feedback(p_article uuid, p_helpful boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reader jsonb := public.help_reader();
  v_seen jsonb;
  v_result jsonb;
begin
  v_seen := public.request_begin(p_request_id, 'help_send_feedback');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_helpful is null then
    perform public.fail('field_invalid', jsonb_build_object('field', 'helpful'));
  end if;
  if not exists (
    select 1 from public.help_articles a join public.help_categories c on c.id = a.category_id and c.active
    where a.id = p_article and a.status = 'published' and public.help_can_read(a.audience, a.company_roles, v_reader)
  ) then
    perform public.fail('article_not_found');
  end if;
  insert into public.help_feedback (article_id, user_id, helpful)
  values (p_article, auth.uid(), p_helpful)
  on conflict (article_id, user_id) do update set helpful = excluded.helpful, updated_at = now();
  v_result := jsonb_build_object('article_id', p_article, 'helpful', p_helpful);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.help_send_feedback(uuid, boolean, uuid) from public, anon;
grant execute on function public.help_send_feedback(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Administration (admin only, second step)
-- ---------------------------------------------------------------------------------------------

create function public.help_article_json(a public.help_articles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'category_id', a.category_id, 'slug', a.slug, 'kind', a.kind, 'status', a.status,
    'audience', to_jsonb(a.audience), 'company_roles', to_jsonb(a.company_roles), 'featured', a.featured,
    'position', a.position,
    'title_ro', a.title_ro, 'summary_ro', a.summary_ro, 'body_ro', a.body_ro, 'keywords_ro', to_jsonb(a.keywords_ro),
    'title_en', a.title_en, 'summary_en', a.summary_en, 'body_en', a.body_en, 'keywords_en', to_jsonb(a.keywords_en),
    'version', a.version, 'published_at', a.published_at, 'created_at', a.created_at, 'updated_at', a.updated_at,
    'updated_by', (select p.display_id from public.profiles p where p.id = a.updated_by))
$$;
revoke execute on function public.help_article_json(public.help_articles) from public, anon, authenticated;

create function public.help_category_json(c public.help_categories)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'icon', c.icon, 'audience', to_jsonb(c.audience), 'position', c.position,
    'active', c.active, 'name_ro', c.name_ro, 'name_en', c.name_en,
    'description_ro', c.description_ro, 'description_en', c.description_en,
    'articles', (select count(*) from public.help_articles a where a.category_id = c.id))
$$;
revoke execute on function public.help_category_json(public.help_categories) from public, anon, authenticated;

-- Writes one version to the history.
create function public.help_revision(p_article public.help_articles, p_action text, p_changed text[])
returns void
language sql
set search_path = ''
as $$
  insert into public.help_article_revisions (article_id, version, action, changed, snapshot, author_id, author_display_id)
  values (p_article.id, p_article.version, p_action, coalesce(p_changed, '{}'),
          public.help_article_json(p_article) - 'updated_by', auth.uid(),
          (select p.display_id from public.profiles p where p.id = auth.uid()))
$$;
revoke execute on function public.help_revision(public.help_articles, text, text[]) from public, anon, authenticated;

-- Everything the admin's Help Center screen lists: categories, articles (every status, without their
-- long texts) with whether English exists, and the vote totals per article.
create function public.admin_help_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(public.help_category_json(c) order by c.position, c.slug) from public.help_categories c), '[]'::jsonb),
    'articles', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id, 'category_id', a.category_id, 'slug', a.slug, 'kind', a.kind, 'status', a.status,
          'audience', to_jsonb(a.audience), 'company_roles', to_jsonb(a.company_roles), 'featured', a.featured,
          'position', a.position, 'title_ro', a.title_ro, 'title_en', a.title_en,
          'has_en', a.title_en is not null, 'version', a.version, 'updated_at', a.updated_at,
          'helpful', (select count(*) from public.help_feedback f where f.article_id = a.id and f.helpful),
          'not_helpful', (select count(*) from public.help_feedback f where f.article_id = a.id and not f.helpful))
        order by a.position, a.slug)
      from public.help_articles a), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_help_list() from public, anon;
grant execute on function public.admin_help_list() to authenticated;

-- One article with its whole text and its history (the last 50 versions, newest first).
create function public.admin_help_get_article(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.help_articles%rowtype;
begin
  perform public.require_admin();
  select * into v from public.help_articles a where a.id = p_id;
  if v.id is null then
    perform public.fail('article_not_found');
  end if;
  return public.help_article_json(v) || jsonb_build_object(
    'helpful', (select count(*) from public.help_feedback f where f.article_id = v.id and f.helpful),
    'not_helpful', (select count(*) from public.help_feedback f where f.article_id = v.id and not f.helpful),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object('version', r.version, 'action', r.action, 'changed', to_jsonb(r.changed),
                                          'by', r.author_display_id, 'at', r.created_at, 'snapshot', r.snapshot)
                       order by r.id desc)
      from (select * from public.help_article_revisions r where r.article_id = v.id order by r.id desc limit 50) r), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_help_get_article(uuid) from public, anon;
grant execute on function public.admin_help_get_article(uuid) to authenticated;

-- A list of text from JSON (null when the key is absent or null).
create function public.help_json_texts(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then null
              when jsonb_typeof(p) <> 'array' then array['<invalid>']
              else array(select btrim(x) from jsonb_array_elements_text(p) x) end
$$;
revoke execute on function public.help_json_texts(jsonb) from public, anon, authenticated;

-- Creates (p_id null, as a draft at the end of its category) or changes an article. The status does
-- not change here (admin_help_set_article_status). Each field is checked and a refusal names it:
-- field_invalid {field: help_title_ro, help_body_en, help_slug, …}; slug_taken; category_not_found.
create function public.admin_help_save_article(p_id uuid, p_article jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_in jsonb := coalesce(p_article, '{}'::jsonb);
  v_old public.help_articles%rowtype;
  v public.help_articles%rowtype;
  v_category uuid;
  v_slug text := lower(btrim(v_in->>'slug'));
  v_kind text := coalesce(v_in->>'kind', 'article');
  v_audience text[] := coalesce(public.help_json_texts(v_in->'audience'), '{}');
  v_roles text[] := coalesce(public.help_json_texts(v_in->'company_roles'), '{}');
  v_kw_ro text[] := coalesce(public.help_json_texts(v_in->'keywords_ro'), '{}');
  v_kw_en text[] := coalesce(public.help_json_texts(v_in->'keywords_en'), '{}');
  v_title_ro text := nullif(btrim(v_in->>'title_ro'), '');
  v_summary_ro text := nullif(btrim(v_in->>'summary_ro'), '');
  v_body_ro text := nullif(btrim(v_in->>'body_ro'), '');
  v_title_en text := nullif(btrim(v_in->>'title_en'), '');
  v_summary_en text := nullif(btrim(v_in->>'summary_en'), '');
  v_body_en text := nullif(btrim(v_in->>'body_en'), '');
  v_featured boolean := coalesce((v_in->>'featured')::boolean, false);
  v_changed text[];
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_help_save_article');
  if v_seen is not null then
    return v_seen;
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end if;

  v_category := public.try_uuid(v_in->>'category_id');
  if v_category is null or not exists (select 1 from public.help_categories c where c.id = v_category) then
    perform public.fail('category_not_found');
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_slug'));
  end if;
  if v_kind not in ('article', 'faq') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_kind'));
  end if;
  if not public.help_audience_ok(v_audience) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_audience'));
  end if;
  if not (v_roles <@ array['admin', 'manager', 'driver', 'accountant']::text[])
     or (cardinality(v_roles) > 0 and not ('fleet' = any (v_audience))) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_company_roles'));
  end if;
  if not public.help_text_ok(v_title_ro, 3, 140) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_title_ro'));
  end if;
  if v_summary_ro is not null and not public.help_text_ok(v_summary_ro, 3, 300) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_summary_ro'));
  end if;
  if not public.help_text_ok(v_body_ro, 10, 20000) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_body_ro'));
  end if;
  if not public.help_keywords_ok(v_kw_ro) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_keywords_ro'));
  end if;
  -- English: the title and the text together, or neither.
  if (v_title_en is null) <> (v_body_en is null) or (v_summary_en is not null and v_title_en is null) then
    perform public.fail('field_invalid', jsonb_build_object('field', case when v_title_en is null then 'help_title_en' else 'help_body_en' end));
  end if;
  if v_title_en is not null and not public.help_text_ok(v_title_en, 3, 140) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_title_en'));
  end if;
  if v_summary_en is not null and not public.help_text_ok(v_summary_en, 3, 300) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_summary_en'));
  end if;
  if v_body_en is not null and not public.help_text_ok(v_body_en, 10, 20000) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_body_en'));
  end if;
  if not public.help_keywords_ok(v_kw_en) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_keywords_en'));
  end if;
  if exists (select 1 from public.help_articles a where a.slug = v_slug and a.id is distinct from p_id) then
    perform public.fail('slug_taken');
  end if;

  if p_id is null then
    insert into public.help_articles (category_id, slug, kind, audience, company_roles, featured, position,
      title_ro, summary_ro, body_ro, keywords_ro, title_en, summary_en, body_en, keywords_en, created_by, updated_by)
    values (v_category, v_slug, v_kind, v_audience, v_roles, v_featured,
      coalesce((select max(a.position) from public.help_articles a where a.category_id = v_category), 0) + 1,
      v_title_ro, v_summary_ro, v_body_ro, v_kw_ro, v_title_en, v_summary_en, v_body_en, v_kw_en, auth.uid(), auth.uid())
    returning * into v;
    perform public.help_revision(v, 'create', '{}');
    perform public.admin_audit_key('create_help_article', 'help_article', v.id::text, null,
      jsonb_build_object('slug', v.slug, 'title', v.title_ro));
  else
    select * into v_old from public.help_articles a where a.id = p_id for update;
    if v_old.id is null then
      perform public.fail('article_not_found');
    end if;
    update public.help_articles a set
      category_id = v_category, slug = v_slug, kind = v_kind, audience = v_audience, company_roles = v_roles,
      featured = v_featured,
      position = case when v_category = v_old.category_id then a.position
                      else coalesce((select max(a2.position) from public.help_articles a2 where a2.category_id = v_category), 0) + 1 end,
      title_ro = v_title_ro, summary_ro = v_summary_ro, body_ro = v_body_ro, keywords_ro = v_kw_ro,
      title_en = v_title_en, summary_en = v_summary_en, body_en = v_body_en, keywords_en = v_kw_en,
      updated_by = auth.uid(), updated_at = now()
    where a.id = p_id
    returning * into v;
    v_changed := array(
      select k from unnest(array['category_id', 'slug', 'kind', 'audience', 'company_roles', 'featured', 'title_ro', 'summary_ro',
                                 'body_ro', 'keywords_ro', 'title_en', 'summary_en', 'body_en', 'keywords_en']) k
      where to_jsonb(v_old)->k is distinct from to_jsonb(v)->k);
    if cardinality(v_changed) > 0 then
      update public.help_articles a set version = a.version + 1 where a.id = v.id returning * into v;
      perform public.help_revision(v, 'update', v_changed);
      -- The log keeps which fields changed and the short ones' values, never the long texts.
      perform public.admin_audit_key('update_help_article', 'help_article', v.id::text,
        jsonb_build_object('changed', to_jsonb(v_changed)) ||
          (public.jsonb_changes(to_jsonb(v_old), to_jsonb(v), array['slug', 'kind', 'audience', 'company_roles', 'featured', 'category_id', 'title_ro', 'title_en'])->'before'),
        public.jsonb_changes(to_jsonb(v_old), to_jsonb(v), array['slug', 'kind', 'audience', 'company_roles', 'featured', 'category_id', 'title_ro', 'title_en'])->'after');
    end if;
  end if;

  v_result := public.help_article_json(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_help_save_article(uuid, jsonb, uuid) from public, anon;
grant execute on function public.admin_help_save_article(uuid, jsonb, uuid) to authenticated;

-- Publishes (Romanian title and text required; the table guarantees them), puts back to draft, or
-- withdraws (archived). A withdrawn article stays for later and can be published again.
create function public.admin_help_set_article_status(p_id uuid, p_status text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_old public.help_articles%rowtype;
  v public.help_articles%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_help_set_article_status');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_status'));
  end if;
  select * into v_old from public.help_articles a where a.id = p_id for update;
  if v_old.id is null then
    perform public.fail('article_not_found');
  end if;
  if v_old.status = p_status then
    perform public.fail('wrong_status');
  end if;
  update public.help_articles a set
    status = p_status, version = a.version + 1, updated_by = auth.uid(), updated_at = now(),
    published_at = case when p_status = 'published' then now() else a.published_at end
  where a.id = p_id
  returning * into v;
  perform public.help_revision(v, case p_status when 'published' then 'publish' when 'archived' then 'archive' else 'unpublish' end, array['status']);
  perform public.admin_audit_key(case when p_status = 'published' then 'publish_help_article' else 'unpublish_help_article' end,
    'help_article', v.id::text, jsonb_build_object('status', v_old.status), jsonb_build_object('status', v.status, 'title', v.title_ro));
  v_result := public.help_article_json(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_help_set_article_status(uuid, text, uuid) from public, anon;
grant execute on function public.admin_help_set_article_status(uuid, text, uuid) to authenticated;

-- Deletes an article for good, with its history and votes. A published article is withdrawn first
-- (article_published), so nothing a reader has open disappears by one click.
create function public.admin_help_delete_article(p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.help_articles%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_help_delete_article');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.help_articles a where a.id = p_id for update;
  if v.id is null then
    perform public.fail('article_not_found');
  end if;
  if v.status = 'published' then
    perform public.fail('article_published');
  end if;
  delete from public.help_articles a where a.id = p_id;
  perform public.admin_audit_key('delete_help_article', 'help_article', v.id::text,
    jsonb_build_object('slug', v.slug, 'title', v.title_ro, 'status', v.status, 'version', v.version), null);
  v_result := jsonb_build_object('id', v.id, 'deleted', true);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_help_delete_article(uuid, uuid) from public, anon;
grant execute on function public.admin_help_delete_article(uuid, uuid) to authenticated;

-- Creates (p_id null, at the end) or changes a category: names (both languages), descriptions,
-- icon, audience (the order readers see it in), shown or hidden.
create function public.admin_help_save_category(p_id uuid, p_category jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_in jsonb := coalesce(p_category, '{}'::jsonb);
  v_old public.help_categories%rowtype;
  v public.help_categories%rowtype;
  v_slug text := lower(btrim(v_in->>'slug'));
  v_icon text := coalesce(v_in->>'icon', 'book');
  v_audience text[] := coalesce(public.help_json_texts(v_in->'audience'), '{}');
  v_name_ro text := nullif(btrim(v_in->>'name_ro'), '');
  v_name_en text := nullif(btrim(v_in->>'name_en'), '');
  v_desc_ro text := nullif(btrim(v_in->>'description_ro'), '');
  v_desc_en text := nullif(btrim(v_in->>'description_en'), '');
  v_active boolean := coalesce((v_in->>'active')::boolean, true);
  v_diff jsonb;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_help_save_category');
  if v_seen is not null then
    return v_seen;
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 60 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_slug'));
  end if;
  if v_icon not in ('book', 'car', 'wrench', 'truck', 'shield', 'card', 'calendar', 'bell', 'users', 'file') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_icon'));
  end if;
  if not public.help_audience_ok(v_audience) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_audience'));
  end if;
  if not public.help_text_ok(v_name_ro, 2, 80) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_name_ro'));
  end if;
  if not public.help_text_ok(v_name_en, 2, 80) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_name_en'));
  end if;
  if v_desc_ro is not null and not public.help_text_ok(v_desc_ro, 2, 200) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_description_ro'));
  end if;
  if v_desc_en is not null and not public.help_text_ok(v_desc_en, 2, 200) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'help_description_en'));
  end if;
  if exists (select 1 from public.help_categories c where c.slug = v_slug and c.id is distinct from p_id) then
    perform public.fail('slug_taken');
  end if;

  if p_id is null then
    insert into public.help_categories (slug, icon, audience, position, active, name_ro, name_en, description_ro, description_en)
    values (v_slug, v_icon, v_audience, coalesce((select max(c.position) from public.help_categories c), 0) + 1, v_active,
            v_name_ro, v_name_en, v_desc_ro, v_desc_en)
    returning * into v;
    perform public.admin_audit_key('create_help_category', 'help_category', v.id::text, null,
      jsonb_build_object('slug', v.slug, 'name', v.name_ro));
  else
    select * into v_old from public.help_categories c where c.id = p_id for update;
    if v_old.id is null then
      perform public.fail('category_not_found');
    end if;
    update public.help_categories c set slug = v_slug, icon = v_icon, audience = v_audience, active = v_active,
      name_ro = v_name_ro, name_en = v_name_en, description_ro = v_desc_ro, description_en = v_desc_en, updated_at = now()
    where c.id = p_id
    returning * into v;
    v_diff := public.jsonb_changes(to_jsonb(v_old), to_jsonb(v),
      array['slug', 'icon', 'audience', 'active', 'name_ro', 'name_en', 'description_ro', 'description_en']);
    if v_diff->'after' <> '{}'::jsonb then
      perform public.admin_audit_key('update_help_category', 'help_category', v.id::text, v_diff->'before', v_diff->'after');
    end if;
  end if;
  v_result := public.help_category_json(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_help_save_category(uuid, jsonb, uuid) from public, anon;
grant execute on function public.admin_help_save_category(uuid, jsonb, uuid) to authenticated;

-- Deletes an empty category (category_not_empty while it has articles, of any status).
create function public.admin_help_delete_category(p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.help_categories%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_help_delete_category');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.help_categories c where c.id = p_id for update;
  if v.id is null then
    perform public.fail('category_not_found');
  end if;
  if exists (select 1 from public.help_articles a where a.category_id = p_id) then
    perform public.fail('category_not_empty');
  end if;
  delete from public.help_categories c where c.id = p_id;
  perform public.admin_audit_key('delete_help_category', 'help_category', v.id::text,
    jsonb_build_object('slug', v.slug, 'name', v.name_ro), null);
  v_result := jsonb_build_object('id', v.id, 'deleted', true);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_help_delete_category(uuid, uuid) from public, anon;
grant execute on function public.admin_help_delete_category(uuid, uuid) to authenticated;

-- Moves a category, or an article inside its category, one place up (-1) or down (+1). Positions
-- are first renumbered 1…n (as admin_move_catalog_item), so old gaps never block a move.
create function public.admin_help_move(p_kind text, p_id uuid, p_direction int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_pos int;
  v_other uuid;
  v_cat uuid;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_help_move');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    perform public.fail('cannot_move');
  end if;
  if p_kind = 'category' then
    lock table public.help_categories in share row exclusive mode;
    if not exists (select 1 from public.help_categories c where c.id = p_id) then
      perform public.fail('category_not_found');
    end if;
    update public.help_categories c set position = o.rn
    from (select c2.id, row_number() over (order by c2.position, c2.slug) as rn from public.help_categories c2) o
    where o.id = c.id and c.position <> o.rn;
    select c.position into v_pos from public.help_categories c where c.id = p_id;
    select c.id into v_other from public.help_categories c where c.position = v_pos + p_direction;
    if v_other is null then
      perform public.fail('cannot_move');
    end if;
    update public.help_categories c set position = v_pos + p_direction, updated_at = now() where c.id = p_id;
    update public.help_categories c set position = v_pos, updated_at = now() where c.id = v_other;
  elsif p_kind = 'article' then
    select a.category_id into v_cat from public.help_articles a where a.id = p_id;
    if v_cat is null then
      perform public.fail('article_not_found');
    end if;
    perform 1 from public.help_categories c where c.id = v_cat for update;
    update public.help_articles a set position = o.rn
    from (select a2.id, row_number() over (order by a2.position, a2.slug) as rn from public.help_articles a2 where a2.category_id = v_cat) o
    where o.id = a.id and a.position <> o.rn;
    select a.position into v_pos from public.help_articles a where a.id = p_id;
    select a.id into v_other from public.help_articles a where a.category_id = v_cat and a.position = v_pos + p_direction;
    if v_other is null then
      perform public.fail('cannot_move');
    end if;
    update public.help_articles a set position = v_pos + p_direction, updated_at = now() where a.id = p_id;
    update public.help_articles a set position = v_pos, updated_at = now() where a.id = v_other;
  else
    perform public.fail('field_invalid', jsonb_build_object('field', 'kind'));
  end if;
  perform public.admin_audit_key('move_help_item', 'help_' || p_kind, p_id::text,
    jsonb_build_object('position', v_pos), jsonb_build_object('position', v_pos + p_direction));
  v_result := jsonb_build_object('kind', p_kind, 'id', p_id, 'position', v_pos + p_direction);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_help_move(text, uuid, int, uuid) from public, anon;
grant execute on function public.admin_help_move(text, uuid, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Audit classes (A3c2b2): the new actions are administrative (3 years, to validate).
-- ---------------------------------------------------------------------------------------------
insert into public.audit_action_classes (action, class, strip_keys) values
  ('create_help_article', 'admin', '{}'),
  ('update_help_article', 'admin', '{}'),
  ('publish_help_article', 'admin', '{}'),
  ('unpublish_help_article', 'admin', '{}'),
  ('delete_help_article', 'admin', '{}'),
  ('create_help_category', 'admin', '{}'),
  ('update_help_category', 'admin', '{}'),
  ('delete_help_category', 'admin', '{}'),
  ('move_help_item', 'admin', '{}');

-- ---------------------------------------------------------------------------------------------
-- Data export: the reader's own votes.
-- ---------------------------------------------------------------------------------------------
alter function public.export_my_data() rename to export_my_data_a4;
revoke execute on function public.export_my_data_a4() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_a4() || jsonb_build_object(
    'help_feedback', coalesce((
      select jsonb_agg(jsonb_build_object('article', coalesce(a.title_ro, a.slug), 'helpful', f.helpful, 'updated_at', f.updated_at)
                       order by f.updated_at)
      from public.help_feedback f join public.help_articles a on a.id = f.article_id
      where f.user_id = auth.uid()), '[]'::jsonb))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The first content (checked against the app on 12 Nov 2026). The admin edits it afterwards.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.help_cat(p_slug text, p_icon text, p_audience text[], p_position int,
  p_name_ro text, p_name_en text, p_desc_ro text, p_desc_en text)
returns void language sql as $$
  insert into public.help_categories (slug, icon, audience, position, name_ro, name_en, description_ro, description_en)
  values (p_slug, p_icon, p_audience, p_position, p_name_ro, p_name_en, p_desc_ro, p_desc_en)
$$;

create function pg_temp.help_art(p_cat text, p_slug text, p_kind text, p_audience text[], p_roles text[],
  p_featured boolean, p_position int,
  p_title_ro text, p_summary_ro text, p_body_ro text, p_kw_ro text[],
  p_title_en text, p_summary_en text, p_body_en text, p_kw_en text[])
returns void language plpgsql as $$
declare
  v public.help_articles%rowtype;
begin
  insert into public.help_articles (category_id, slug, kind, status, audience, company_roles, featured, position,
    title_ro, summary_ro, body_ro, keywords_ro, title_en, summary_en, body_en, keywords_en, published_at)
  values ((select c.id from public.help_categories c where c.slug = p_cat), p_slug, p_kind, 'published', p_audience, p_roles,
    p_featured, p_position, p_title_ro, p_summary_ro, p_body_ro, p_kw_ro, p_title_en, p_summary_en, p_body_en, p_kw_en, now())
  returning * into v;
  insert into public.help_article_revisions (article_id, version, action, changed, snapshot)
  values (v.id, v.version, 'seed', '{}', public.help_article_json(v) - 'updated_by');
end
$$;

select pg_temp.help_cat('soferi', 'car', '{client}', 1, 'Pentru șoferi', 'For drivers',
  'Garajul, programările, devizele și istoricul mașinii.', 'Your garage, bookings, quotes and car history.');
select pg_temp.help_cat('service-uri', 'wrench', '{shop}', 2, 'Pentru service-uri', 'For shops',
  'Configurarea service-ului, programările, devizele și rapoartele.', 'Shop setup, bookings, quotes and reports.');
select pg_temp.help_cat('firme', 'truck', '{fleet}', 3, 'Pentru firme și flote', 'For companies and fleets',
  'Spațiul firmei, vehiculele, membrii și costurile.', 'The company space, vehicles, members and costs.');
select pg_temp.help_cat('cont', 'shield', '{}', 4, 'Cont și securitate', 'Account and security',
  'Autentificarea, parola, datele personale și confidențialitatea.', 'Sign-in, password, personal data and privacy.');
select pg_temp.help_cat('abonamente', 'card', '{shop,fleet}', 5, 'Abonamente și facturare', 'Subscriptions and billing',
  'Planurile, perioada gratuită, plățile și facturile.', 'Plans, the free period, payments and invoices.');

-- A. Pentru șoferi ---------------------------------------------------------------------------
select pg_temp.help_art('soferi', 'cont-sofer', 'article', '{client}', '{}', false, 1,
  'Crearea contului de client',
  'Contul de client este gratuit și se creează cu emailul sau cu Google ori Apple.',
$b$Contul de client este gratuit.

1. Deschide **Cont nou** și alege **Sunt client**.
2. Completează numele, emailul, telefonul și parola (cel puțin 8 caractere, cu litere și cifre).
3. Bifează acceptarea Termenilor și condițiilor și a Politicii de confidențialitate, apoi apasă **Creează cont**.
4. Deschide linkul primit pe email. Linkul este valabil 24 de ore.

Poți intra și cu **Continuă cu Google** sau **Continuă cu Apple**, când butoanele apar pe ecran. La prima intrare, ecranul **Finalizează contul** cere datele care lipsesc.

Tipul contului (client sau service) se alege o singură dată, la creare.$b$,
  '{cont nou,inregistrare,creare cont,client}',
  'Creating a client account',
  'A client account is free and can be created with your email or with Google or Apple.',
$b$A client account is free.

1. Open **Sign up** and choose **I'm a client**.
2. Enter your name, email, phone and password (at least 8 characters, with letters and digits).
3. Accept the Terms and Conditions and the Privacy Policy, then tap **Create account**.
4. Open the link sent to your email. The link is valid for 24 hours.

You can also use **Continue with Google** or **Continue with Apple** when the buttons are shown. On the first sign-in, the **Finish your account** screen asks for anything missing.

The account type (client or shop) is chosen once, when the account is created.$b$,
  '{sign up,register,new account,client}');

select pg_temp.help_art('soferi', 'masini-garaj', 'article', '{client}', '{}', true, 2,
  'Adăugarea și gestionarea mașinilor',
  'Mașinile din Garaj se aleg direct la programare și primesc memento-uri pentru documente.',
$b$Mașinile se păstrează în **Garaj**.

## Adaugă o mașină
1. Deschide **Garaj** și apasă **Adaugă mașină**.
2. Completează marca și modelul (obligatorii), anul, numărul de înmatriculare și, opțional, seria de șasiu (VIN, 17 caractere, fără I, O și Q).
3. Opțional, completează datele de expirare pentru ITP, RCA și rovinietă și intervalul schimbului de ulei.
4. Apasă **Salvează**.

## Editează sau șterge
Apasă pe mașină pentru a o edita. **Șterge mașina** o elimină din Garaj; programările făcute cu ea rămân neschimbate.

Dacă aceeași mașină apare de două ori (același VIN sau același număr), Garajul propune **Unește**: programările și rapoartele se mută în mașina păstrată.$b$,
  '{garaj,masina,adauga masina,vin,numar inmatriculare}',
  'Adding and managing cars',
  'Cars in your Garage are ready to pick when you book and get document reminders.',
$b$Your cars are kept in **Garage**.

## Add a car
1. Open **Garage** and tap **Add car**.
2. Enter the make and model (required), the year, the license plate and, optionally, the VIN (17 characters, no I, O or Q).
3. Optionally, enter the expiry dates for the ITP inspection, the RCA insurance and the road vignette, and your oil change interval.
4. Tap **Save**.

## Edit or delete
Tap a car to edit it. **Delete car** removes it from your Garage; bookings made with it stay unchanged.

If the same car appears twice (same VIN or same license plate), the Garage offers **Merge**: bookings and reports move to the car you keep.$b$,
  '{garage,car,add car,vin,license plate}');

select pg_temp.help_art('soferi', 'cautare-service', 'article', '{client}', '{}', false, 3,
  'Căutarea service-urilor',
  'Caută după nume, oraș sau serviciu și restrânge lista cu filtre.',
$b$Ecranul **Caută** arată service-urile disponibile pentru programare.

- Scrie numele service-ului, orașul sau serviciul (de exemplu frâne, ulei, ITP).
- Restrânge lista după categorie, oraș și zi (**Azi**, **Mâine** sau **Altă zi**).
- **Favorite** arată service-urile marcate cu inimă.
- **Ordine**: **Recomandate** sau **Cele mai apropiate**.

Lista recomandată este ordonată după notă și numărul de recenzii. Un service nou pornește de la o notă medie. Poziția nu se poate cumpăra, iar distanța nu schimbă ordinea recomandată.$b$,
  '{cauta,service,filtre,favorite,ordine,recenzii}',
  'Finding a shop',
  'Search by name, city or service and narrow the list with filters.',
$b$The **Search** screen shows the shops open for booking.

- Type the shop's name, a city or a service (for example brakes, oil, ITP inspection).
- Narrow the list by category, city and day (**Today**, **Tomorrow** or **Another day**).
- **Favorites** shows the shops you marked with a heart.
- **Order**: **Recommended** or **Nearest**.

The recommended list is ordered by rating and number of reviews. A new shop starts from an average rating. A position cannot be bought, and distance does not change the recommended order.$b$,
  '{search,shop,filters,favorites,order,reviews}');

select pg_temp.help_art('soferi', 'servicii-tarife', 'article', '{client}', '{}', false, 4,
  'Servicii și tarife',
  'Fiecare service arată serviciile oferite; prețul lucrării apare în deviz.',
$b$Pe pagina unui service vezi serviciile pe care le oferă, programul, adresa, fotografiile și recenziile.

Prețul unei reparații se stabilește după constatare, în **deviz**. Devizul arată fiecare poziție (manoperă și piese) și totalul. Lucrarea începe doar după ce accepți devizul.

Unele service-uri afișează:
- o **taxă de constatare**, care se plătește doar dacă refuzi tot devizul;
- o **ofertă pentru clienți noi** sau o reducere în anumite zile, afișată la programare.$b$,
  '{pret,tarif,cost,deviz,taxa de constatare,oferta}',
  'Services and prices',
  'Each shop lists the services it offers; the price of the job is in the quote.',
$b$A shop's page shows the services it offers, its hours, address, photos and reviews.

The price of a repair is set after the inspection, in the **quote**. The quote lists every line (labor and parts) and the total. Work starts only after you accept the quote.

Some shops show:
- an **inspection fee**, charged only if you refuse the whole quote;
- an **offer for new clients** or a discount on certain days, shown when you book.$b$,
  '{price,cost,quote,inspection fee,offer}');

select pg_temp.help_art('soferi', 'programari-sofer', 'article', '{client}', '{}', true, 5,
  'Programări',
  'O programare se face în patru pași și se urmărește în Programări.',
$b$## Fă o programare
1. Deschide service-ul și apasă **Programează**.
2. Alege serviciile (cel mult 5), ziua, ora și mașina.
3. Adaugă o observație, dacă e cazul, și apasă **Trimite cererea**.

Service-ul confirmă cererea. Unele service-uri confirmă imediat (**Rezervă acum**). Pentru a trimite o cerere, emailul contului trebuie să fie confirmat.

## Urmărește programarea
În **Programări** vezi starea fiecărei programări și codul ei (de exemplu P-000123). Când o zi este plină, poți alege **Anunță-mă dacă se eliberează un loc**.

## Anulează
Apasă **Anulează** pe programare, până la termenul de anulare stabilit de service. După termen, sună service-ul.$b$,
  '{programare,rezervare,anulare,cod programare,loc liber}',
  'Bookings',
  'A booking takes four steps and is followed in Bookings.',
$b$## Make a booking
1. Open the shop and tap **Book**.
2. Choose the services (up to 5), the day, the time and the car.
3. Add a note if needed and tap **Send request**.

The shop confirms the request. Some shops confirm at once (**Book now**). To send a request, your account's email must be confirmed.

## Follow the booking
**Bookings** shows the status of each booking and its code (for example P-000123). When a day is full, you can choose **Notify me if a spot opens up**.

## Cancel
Tap **Cancel** on the booking, before the cancellation deadline set by the shop. After the deadline, call the shop.$b$,
  '{booking,appointment,cancel,booking code,free spot}');

select pg_temp.help_art('soferi', 'devize-aprobare', 'article', '{client}', '{}', true, 6,
  'Devize și aprobarea lucrărilor',
  'Devizul se acceptă integral, parțial sau se refuză, direct din programare.',
$b$După constatare, service-ul trimite un **deviz**. Îl vezi pe cardul programării, în **Programări**, și primești o notificare.

- **Accept**: lucrarea începe cu toate pozițiile.
- Debifează pozițiile pe care nu le vrei și apasă **Accept selectate**: se face doar ce ai bifat.
- **Refuz**: lucrarea nu se face. Dacă service-ul are o taxă de constatare, ea se aplică doar în acest caz.

Devizul are un termen de răspuns, afișat pe card. Fără răspuns până atunci, devizul expiră.

Documentele lucrării (devizul, fișa de preluare și devizul final, în PDF) apar pe cardul programării, în **Documente**, când service-ul le emite.$b$,
  '{deviz,accept,refuz,aprobare,taxa de constatare,pdf}',
  'Quotes and approving the work',
  'A quote is accepted in full, in part, or refused, right from the booking.',
$b$After the inspection, the shop sends a **quote**. It appears on the booking card in **Bookings**, and you get a notification.

- **Accept**: the work starts with every line.
- Untick the lines you do not want and tap **Accept selected**: only the ticked lines are done.
- **Refuse**: the work is not done. If the shop has an inspection fee, it applies only in this case.

The quote has a reply deadline, shown on the card. Without a reply by then, the quote expires.

The job documents (the quote, the intake sheet and the final quote, as PDFs) appear on the booking card under **Documents** once the shop issues them.$b$,
  '{quote,accept,refuse,approval,inspection fee,pdf}');

select pg_temp.help_art('soferi', 'istoric-reparatii', 'article', '{client}', '{}', false, 7,
  'Istoricul reparațiilor',
  'Lucrările finalizate prin Service-Hub rămân în istoricul fiecărei mașini.',
$b$Deschide **Garaj**, alege mașina și apasă **Istoric**. Apar lucrările finalizate prin Service-Hub, cu data, kilometrajul și pozițiile din deviz.

Lucrările importate de un service din programul lui vechi apar marcate **Importat**; ele nu intră în raportul oficial.

## Raportul oficial pentru cumpărător
Când vinzi mașina, poți genera un **raport oficial** (PDF) cu lucrările făcute prin Service-Hub, kilometrajul și un cod de verificare. Prețul apare înainte de plată. Cumpărătorul verifică codul fără cont, pe service-hub.ro/verifica.$b$,
  '{istoric,reparatii,lucrari,raport oficial,vanzare,kilometraj}',
  'Repair history',
  'Jobs finished through Service-Hub stay in each car''s history.',
$b$Open **Garage**, pick the car and tap **History**. It lists the jobs finished through Service-Hub, with the date, the odometer and the quote lines.

Jobs a shop imported from its previous software are marked **Imported**; they are not part of the official report.

## The official report for a buyer
When you sell the car, you can generate an **official report** (PDF) with the jobs done through Service-Hub, the odometer and a verification code. The price is shown before you pay. The buyer checks the code without an account, at service-hub.ro/verifica.$b$,
  '{history,repairs,jobs,official report,selling,odometer}');

select pg_temp.help_art('soferi', 'documentele-masinii', 'article', '{client}', '{}', false, 8,
  'Documentele mașinii',
  'Documentele fiecărei lucrări se descarcă în PDF din programare.',
$b$Pentru fiecare programare, service-ul poate emite trei documente, în PDF:

- **Devizul**, cu manopera și piesele;
- **Fișa de preluare**, cu kilometrajul, nivelul de combustibil și defectele marcate pe desenul mașinii; o confirmi în aplicație;
- **Devizul final**, la finalizarea lucrării.

Le găsești pe cardul programării, în **Programări**, la **Documente**. Datele de expirare pentru ITP, RCA și rovinietă se păstrează separat, pe mașina din **Garaj**.$b$,
  '{documente,pdf,fisa de preluare,deviz final}',
  'Your car''s documents',
  'The documents of each job are downloaded as PDFs from the booking.',
$b$For each booking, the shop can issue three PDF documents:

- the **quote**, with labor and parts;
- the **intake sheet**, with the odometer, the fuel level and the damage marked on a drawing of the car; you confirm it in the app;
- the **final quote**, when the job is finished.

You find them on the booking card in **Bookings**, under **Documents**. The expiry dates of the ITP inspection, the RCA insurance and the road vignette are kept separately, on the car in **Garage**.$b$,
  '{documents,pdf,intake sheet,final quote}');

select pg_temp.help_art('soferi', 'itp-rca-rovinieta', 'article', '{client}', '{}', true, 9,
  'ITP, RCA, rovinietă și revizii',
  'Datele de expirare din Garaj aduc un aviz cu 30 de zile înainte.',
$b$1. Deschide **Garaj** și editează mașina.
2. La **Expirări documente**, completează data de expirare pentru ITP, RCA și rovinietă.
3. La **Schimbul de ulei**, alege la câte luni îl faci și data ultimului schimb.
4. Apasă **Salvează**.

Cu 30 de zile înainte de expirarea unui document apare un aviz pe ecranul **Caută**. Pentru schimbul de ulei primești un memento cu 2 săptămâni înainte. În Garaj, fiecare mașină arată câte zile au rămas.

Câmpurile sunt opționale. Un câmp gol nu aduce niciun aviz.$b$,
  '{itp,rca,rovinieta,revizie,ulei,expirare,memento}',
  'ITP inspection, RCA insurance, road vignette and servicing',
  'Expiry dates in your Garage bring a notice 30 days ahead.',
$b$1. Open **Garage** and edit the car.
2. Under **Document expiry dates**, enter the expiry date of the ITP inspection, the RCA insurance and the road vignette.
3. Under **Oil change**, choose how many months apart you change it and the date of the last change.
4. Tap **Save**.

30 days before a document expires, a notice appears on the **Search** screen. For the oil change, a reminder comes 2 weeks ahead. In your Garage, each car shows the days left.

The fields are optional. An empty field brings no notice.$b$,
  '{itp,rca,vignette,servicing,oil,expiry,reminder}');

select pg_temp.help_art('soferi', 'notificari-sofer', 'article', '{client}', '{}', false, 10,
  'Notificări și alerte',
  'Notificările push se activează pe fiecare dispozitiv, din Cont → Notificări.',
$b$Deschide **Cont → Notificări**.

- **Notificări push**: se activează separat pe fiecare telefon sau calculator. Dacă browserul le-a blocat, activează-le din setările browserului pentru service-hub.ro; în aplicația de Android, din **Setări → Aplicații → Service-Hub → Notificări**.
- Alege ce memento-uri primești: recenzii, revizii, anvelope și oferte.

Programările, devizele și mesajele aduc notificări pe dispozitivele unde le-ai activat. Avizele pentru ITP, RCA și rovinietă apar pe ecranul **Caută**.$b$,
  '{notificari,push,alerte,memento,setari}',
  'Notifications and alerts',
  'Push notifications are turned on for each device, in Account → Notifications.',
$b$Open **Account → Notifications**.

- **Push notifications**: turned on separately on each phone or computer. If the browser blocked them, allow them in the browser's settings for service-hub.ro; in the Android app, in **Settings → Apps → Service-Hub → Notifications**.
- Choose which reminders you get: reviews, servicing, tires and offers.

Bookings, quotes and messages bring notifications on the devices where you turned them on. Notices for the ITP inspection, the RCA insurance and the road vignette appear on the **Search** screen.$b$,
  '{notifications,push,alerts,reminder,settings}');

-- B. Pentru service-uri ----------------------------------------------------------------------
select pg_temp.help_art('service-uri', 'cont-service', 'article', '{shop}', '{}', false, 1,
  'Crearea și configurarea contului',
  'Contul de service are patru pași de pregătire înainte de a apărea în căutări.',
$b$1. Deschide **Cont nou**, alege **Sunt service** și completează numele service-ului, orașul, emailul, telefonul și parola.
2. Confirmă emailul din linkul primit (valabil 24 de ore).
3. Pe **Panou**, urmează lista **Pregătește service-ul pentru programări**:
   - alege serviciile pe care le faci;
   - verifică programul de lucru;
   - stabilește câte mașini primești pe zi;
   - confirmă numărul de telefon cu codul primit prin SMS.

Service-ul apare în căutări după acești pași, cât abonamentul este activ sau în perioada gratuită. Pașii îi face proprietarul contului.

## Colegii
În **Cont → Setări service → Echipă**, proprietarul invită colegii prin email. Colegii lucrează cu programările, devizele, mesajele și istoricul; setările și abonamentul rămân la proprietar.$b$,
  '{cont service,configurare,panou,pasi,colegi,echipa}',
  'Creating and setting up the account',
  'A shop account has four setup steps before it appears in search.',
$b$1. Open **Sign up**, choose **I'm a shop** and enter the shop's name, city, email, phone and password.
2. Confirm your email from the link you receive (valid for 24 hours).
3. On **Dashboard**, follow the list **Get the shop ready for bookings**:
   - choose the services you offer;
   - check your opening hours;
   - set how many cars you take per day;
   - confirm the phone number with the code sent by text message.

The shop appears in search after these steps, while the subscription is active or in the free period. The account owner completes the steps.

## Colleagues
In **Account → Shop settings → Team**, the owner invites colleagues by email. Colleagues work with bookings, quotes, messages and history; settings and the subscription stay with the owner.$b$,
  '{shop account,setup,dashboard,steps,colleagues,team}');

select pg_temp.help_art('service-uri', 'profil-service', 'article', '{shop}', '{}', false, 2,
  'Profilul service-ului',
  'Logoul, descrierea, adresa, telefoanele și fotografiile văzute de clienți.',
$b$Deschide **Cont → Setări service**.

- **Profil**: logoul (PNG, JPG sau WebP, cel mult 2 MB), numele, descrierea, adresa și locul pe hartă, telefoanele, site-ul și pagina de Facebook.
- **Prezentare**: fotografiile service-ului și facilitățile oferite.
- **Program**: orele pe fiecare zi și concediile.

Un telefon schimbat se confirmă cu un cod prin SMS. Până la confirmare, service-ul nu apare în căutare.

Datele de facturare (CUI, Registrul Comerțului, IBAN) nu sunt publice; le văd doar proprietarul și echipa Service-Hub.$b$,
  '{profil,logo,descriere,adresa,fotografii,program,concediu}',
  'The shop profile',
  'The logo, description, address, phones and photos clients see.',
$b$Open **Account → Shop settings**.

- **Profile**: the logo (PNG, JPG or WebP, up to 2 MB), name, description, address and map location, phones, website and Facebook page.
- **Showcase**: the shop's photos and amenities.
- **Hours**: opening hours for each day and closures.

A changed phone number is confirmed with a code sent by text message. Until it is confirmed, the shop does not appear in search.

Billing data (tax ID, trade register number, IBAN) is never public; only the owner and the Service-Hub team see it.$b$,
  '{profile,logo,description,address,photos,hours,closure}');

select pg_temp.help_art('service-uri', 'servicii-preturi', 'article', '{shop}', '{}', false, 3,
  'Gestionarea serviciilor și prețurilor',
  'Serviciile se bifează în setări; prețurile se stabilesc în deviz.',
$b$## Serviciile
În **Cont → Setări service → Servicii**, bifează reparațiile pe care le faci. Clienții le aleg la programare, iar căutarea după serviciu găsește service-ul tău.

## Prețurile
Service-Hub nu afișează o listă de prețuri. Prețul fiecărei lucrări se stabilește în **deviz**, după constatare.

În **Cont → Setări service → Devize** stabilești tariful orar de pornire, numerotarea devizelor și mențiunile tipărite pe deviz. În **Reguli** stabilești taxa de constatare (0 = fără taxă), oferta pentru clienți noi și reducerile pentru zilele mai liniștite.$b$,
  '{servicii,preturi,tarif orar,deviz,taxa de constatare,oferta,reducere}',
  'Managing services and prices',
  'Services are ticked in settings; prices are set in the quote.',
$b$## Services
In **Account → Shop settings → Services**, tick the repairs you do. Clients choose them when booking, and a search by service finds your shop.

## Prices
Service-Hub does not show a price list. The price of each job is set in the **quote**, after the inspection.

In **Account → Shop settings → Quotes** you set the starting hourly rate, the quote numbering and the notes printed on the quote. In **Rules** you set the inspection fee (0 = no fee), the offer for new clients and the discounts for quieter days.$b$,
  '{services,prices,hourly rate,quote,inspection fee,offer,discount}');

select pg_temp.help_art('service-uri', 'programari-capacitate', 'article', '{shop}', '{}', true, 4,
  'Programări și capacitate zilnică',
  'Capacitatea și regulile de programare se stabilesc o dată, în Reguli.',
$b$## Regulile
În **Cont → Setări service → Reguli** stabilești:
- câte mașini primești pe zi și câte în același interval (de regulă, numărul posturilor de lucru);
- cu cât timp înainte se face o programare și cu cât timp în avans;
- până când poate anula clientul din aplicație;
- dacă cererile pentru locurile libere se confirmă singure.

O zi plină nu mai primește cereri.

## Cererile
În **Programări**, fiecare cerere nouă are **Confirmă** sau **Respinge** (cu motiv, trimis clientului). O programare confirmată se poate reprograma sau anula, cu motiv. Dacă clientul nu vine, marchezi neprezentarea; clientul o poate contesta.

Pe **Panou** vezi cererile noi și programul zilei; programul se poate tipări.$b$,
  '{programari,capacitate,masini pe zi,reguli,confirmare,reprogramare,neprezentare}',
  'Bookings and daily capacity',
  'Capacity and booking rules are set once, in Rules.',
$b$## The rules
In **Account → Shop settings → Rules** you set:
- how many cars you take per day and in the same time slot (usually the number of work bays);
- how far ahead a booking must be made, and how far in advance;
- until when a client can cancel in the app;
- whether requests for free slots confirm themselves.

A full day takes no more requests.

## Requests
In **Bookings**, each new request has **Confirm** or **Decline** (with a reason sent to the client). A confirmed booking can be rescheduled or canceled, with a reason. If the client does not come, you mark a no-show; the client can dispute it.

The **Dashboard** shows new requests and the day's schedule; the schedule can be printed.$b$,
  '{bookings,capacity,cars per day,rules,confirm,reschedule,no-show}');

select pg_temp.help_art('service-uri', 'gestionare-clienti', 'article', '{shop}', '{}', false, 5,
  'Gestionarea clienților',
  'Clienții se găsesc după număr, mașină sau nume, în Istoric și în Mesaje.',
$b$Service-Hub nu are o listă separată de clienți. Clienții tăi se găsesc astfel:

- **Programări**: cererile și programările active, cu numele, telefonul și mașina clientului.
- **Istoric**: caută după număr de înmatriculare, mașină, client sau serviciu.
- **Mesaje**: conversația cu fiecare client.
- **Fișa mașinii**: lucrările făcute la tine și, cât clientul are o programare deschisă la tine și a ales să le arate, lucrările de la alte service-uri, fără prețuri și fără numele lor.

Pentru clienții noi, **Cont → Linkul service-ului** oferă un link și un cod QR pentru programări online.$b$,
  '{clienti,istoric,mesaje,fisa masinii,link,cod qr}',
  'Managing clients',
  'Clients are found by plate, car or name, in History and Messages.',
$b$Service-Hub has no separate client list. You find your clients here:

- **Bookings**: requests and active bookings, with the client's name, phone and car.
- **History**: search by license plate, car, client or service.
- **Messages**: the conversation with each client.
- **Vehicle file**: the jobs done at your shop and, while the client has an open booking with you and chose to share them, jobs at other shops, without prices or shop names.

For new clients, **Account → Shop link** gives you a link and a QR code for online booking.$b$,
  '{clients,history,messages,vehicle file,link,qr code}');

select pg_temp.help_art('service-uri', 'devize-service', 'article', '{shop}', '{}', true, 6,
  'Devize și aprobări',
  'Devizul are manoperă și piese, cu TVA, și se trimite clientului din programare.',
$b$1. Pe programare, apasă **Începe constatarea**. Opțional, completează **fișa de preluare** (kilometraj, combustibil, defecte pe desen, fotografii); clientul o confirmă în aplicație.
2. Compune devizul: **manoperă** (ore × tarif) și **piese** (cantitate × preț, producător, piesă originală sau alternativă).
3. Apasă **Trimite devizul**.

Clientul acceptă tot, acceptă doar unele poziții sau refuză. Până la răspuns, poți **edita devizul** (cel nou îl înlocuiește) sau îl poți **retrage**. Dacă clientul îți răspunde la telefon, înregistrezi decizia lui în programare.

Un deviz fără răspuns expiră după termenul din **Reguli**. Taxa de constatare se aplică doar dacă tot devizul este refuzat.$b$,
  '{deviz,manopera,piese,tva,fisa de preluare,aprobare,retragere}',
  'Quotes and approvals',
  'A quote has labor and parts, with VAT, and is sent to the client from the booking.',
$b$1. On the booking, tap **Start inspection**. Optionally, fill in the **intake sheet** (odometer, fuel, damage on the drawing, photos); the client confirms it in the app.
2. Build the quote: **labor** (hours × rate) and **parts** (quantity × price, brand, original or alternative part).
3. Tap **Send quote**.

The client accepts everything, accepts only some lines, or refuses. Until the client answers, you can **edit the quote** (the new one replaces it) or **withdraw** it. If the client answers you by phone, you record the decision on the booking.

A quote without an answer expires after the deadline set in **Rules**. The inspection fee applies only if the whole quote is refused.$b$,
  '{quote,labor,parts,vat,intake sheet,approval,withdraw}');

select pg_temp.help_art('service-uri', 'dosarele-masinilor', 'article', '{shop}', '{}', false, 7,
  'Dosarele mașinilor',
  'Fișa mașinii adună lucrările, kilometrajul și documentele fiecărei mașini.',
$b$Deschide o programare sau o lucrare din **Istoric** și apasă pe mașină pentru **Fișa mașinii**. Ea arată:

- seria de șasiu și ultimul kilometraj cunoscut;
- lucrările finalizate la tine, cu pozițiile din deviz;
- lucrările de la alte service-uri prin Service-Hub, fără prețuri și fără numele lor, doar cât clientul are o programare deschisă la tine și nu a ales să le ascundă.

Documentele fiecărei lucrări (devizul, fișa de preluare, devizul final) se descarcă în PDF din programare, la **Documente**.$b$,
  '{fisa masinii,dosar,kilometraj,vin,documente,pdf}',
  'Vehicle files',
  'The vehicle file gathers each car''s jobs, odometer and documents.',
$b$Open a booking, or a job in **History**, and tap the car to see its **Vehicle file**. It shows:

- the VIN and the last known odometer;
- the jobs finished at your shop, with the quote lines;
- jobs at other shops through Service-Hub, without prices or shop names, only while the client has an open booking with you and has not chosen to hide them.

Each job's documents (the quote, the intake sheet, the final quote) are downloaded as PDFs from the booking, under **Documents**.$b$,
  '{vehicle file,file,odometer,vin,documents,pdf}');

select pg_temp.help_art('service-uri', 'gestionare-lucrari', 'article', '{shop}', '{}', false, 8,
  'Gestionarea lucrărilor',
  'O lucrare trece prin constatare, deviz, lucru și finalizare.',
$b$Pașii unei programări:

1. **Confirmată**: clientul vine la ora aleasă.
2. **În constatare**: verifici mașina și trimiți devizul.
3. **În lucru**: după acceptare, apasă **Începe lucrul**.
4. **Finalizare**: completezi kilometrajul (obligatoriu), lucrarea făcută (vizibilă pentru client) și suma, dacă diferă de totalul acceptat. Poți adăuga garanția lucrării.

Clientul primește o notificare la fiecare pas și **Gata de ridicare** la final. Lucrarea intră în **Istoric** și în istoricul mașinii.$b$,
  '{lucrare,constatare,in lucru,finalizare,kilometraj,garantie}',
  'Managing jobs',
  'A job goes through inspection, quote, work and completion.',
$b$The steps of a booking:

1. **Confirmed**: the client comes at the chosen time.
2. **Inspection**: you check the car and send the quote.
3. **In progress**: after approval, tap **Start work**.
4. **Completion**: enter the odometer (required), the work done (visible to the client) and the amount, if it differs from the approved total. You can add a warranty for the job.

The client gets a notification at each step and **Ready for pickup** at the end. The job goes into **History** and into the car's history.$b$,
  '{job,inspection,in progress,completion,odometer,warranty}');

select pg_temp.help_art('service-uri', 'rapoarte-service', 'article', '{shop}', '{}', false, 9,
  'Rapoarte și statistici',
  'Încasările, clienții și devizele, pe luni; doar pentru proprietar.',
$b$Deschide **Cont → Rapoarte**. Rapoartele conțin date financiare, așa că le vede doar proprietarul service-ului.

- încasările pe ultimele 12 luni;
- clienții care revin (cu mai mult de o lucrare finalizată la tine);
- devizele acceptate și cele refuzate sau lăsate să expire;
- gradul de ocupare.

Rapoartele se pot exporta în CSV. Raportul lunii vine și pe email, pe 1 ale lunii, dacă îl activezi în **Cont → Notificări** și ai avut activitate.$b$,
  '{rapoarte,statistici,incasari,clienti,devize,csv,raportul lunii}',
  'Reports and statistics',
  'Revenue, clients and quotes, by month; for the owner only.',
$b$Open **Account → Reports**. Reports contain the shop's financial data, so only the owner sees them.

- revenue over the last 12 months;
- returning clients (more than one finished job at your shop);
- quotes accepted and quotes refused or left to expire;
- utilization.

Reports can be exported as CSV. The monthly report also comes by email on the 1st of the month, if you turn it on in **Account → Notifications** and had activity.$b$,
  '{reports,statistics,revenue,clients,quotes,csv,monthly report}');

select pg_temp.help_art('service-uri', 'istoricul-clientilor', 'article', '{shop}', '{}', false, 10,
  'Istoricul clienților',
  'Istoricul păstrează lucrările finalizate, devizele refuzate și programările anulate.',
$b$**Istoric** arată lucrările finalizate, devizele refuzate și programările anulate.

- Caută după număr, mașină, client sau serviciu.
- Filtrează după status și perioadă.
- Deschide o lucrare pentru detalii și documente; apasă pe mașină pentru **Fișa mașinii**.

Istoricul se poate tipări. Lucrările importate din programul vechi apar marcate **Importat** și nu intră în total.$b$,
  '{istoric,clienti,cautare,filtre,tiparire,importat}',
  'Client history',
  'History keeps finished jobs, refused quotes and canceled bookings.',
$b$**History** shows finished jobs, refused quotes and canceled bookings.

- Search by plate, car, client or service.
- Filter by status and period.
- Open a job for its details and documents; tap the car for its **Vehicle file**.

History can be printed. Jobs imported from your previous software are marked **Imported** and are not counted in the total.$b$,
  '{history,clients,search,filters,print,imported}');

select pg_temp.help_art('service-uri', 'import-date', 'article', '{shop}', '{}', false, 11,
  'Importul datelor',
  'Clienții și lucrările din programul vechi se importă dintr-un fișier Excel sau CSV.',
$b$Deschide **Cont → Importă clienți** (doar proprietarul).

1. Alege fișierul Excel sau CSV din programul vechi.
2. Potrivește coloanele (nume, telefon, mașină, număr, lucrări).
3. Verifică rândurile semnalate și pornește importul.

Lucrările importate apar în **Istoric** marcate **Importat** și nu intră în totaluri. Un client care are cont cu același număr de telefon, confirmat prin cod, primește mașinile și lucrările importate în Garajul lui.

Importul se poate anula: toate datele importate se șterg.$b$,
  '{import,excel,csv,clienti,program vechi,migrare}',
  'Importing data',
  'Clients and jobs from your previous software are imported from an Excel or CSV file.',
$b$Open **Account → Import clients** (owner only).

1. Choose the Excel or CSV file from your previous software.
2. Match the columns (name, phone, car, plate, jobs).
3. Check the flagged rows and start the import.

Imported jobs appear in **History** marked **Imported** and are not counted in totals. A client whose account has the same phone number, confirmed by code, gets the imported cars and jobs in their Garage.

An import can be canceled: all imported data is deleted.$b$,
  '{import,excel,csv,clients,previous software,migration}');

-- C. Pentru firme și flote -------------------------------------------------------------------
select pg_temp.help_art('firme', 'cont-firma', 'article', '{client,fleet}', '{}', false, 1,
  'Crearea contului de firmă',
  'O firmă se creează din contul personal de client și are un spațiu separat.',
$b$O firmă nu are un cont separat: se creează din contul tău de client.

1. Deschide **Cont → Firmele mele** și apasă **Creează o firmă**.
2. Completează numele firmei și, opțional, CUI-ul, numărul de la Registrul Comerțului și adresa.
3. Apasă **Creează firma**. Devii administratorul firmei.

Firma are un spațiu separat de contul personal. Treci între **Personal** și firmă din selectorul de spațiu, din dreapta sus. Mașinile tale personale nu se amestecă cu vehiculele firmei.$b$,
  '{firma,flota,creare firma,spatiu,cui}',
  'Creating a company account',
  'A company is created from your personal client account and has a separate space.',
$b$A company has no separate account: you create it from your client account.

1. Open **Account → My companies** and tap **Create a company**.
2. Enter the company name and, optionally, its tax ID, trade register number and address.
3. Tap **Create company**. You become the company's administrator.

The company has a space separate from your personal account. Switch between **Personal** and the company with the space selector at the top right. Your personal cars never mix with the company's vehicles.$b$,
  '{company,fleet,create company,space,tax id}');

select pg_temp.help_art('firme', 'vehicule-firma', 'article', '{fleet}', '{}', false, 2,
  'Adăugarea vehiculelor',
  'Vehiculele firmei se adaugă în spațiul firmei, separat de mașinile personale.',
$b$În spațiul firmei, deschide **Vehicule** și apasă **Adaugă vehicul**. Completează marca, modelul, anul, numărul de înmatriculare, VIN-ul, departamentul, tipul și datele de expirare ale documentelor.

Lista se caută după număr, marcă, model sau VIN și se filtrează după status, șofer, departament și tip.

Numărul de vehicule depinde de planul firmei. Vehiculele le adaugă administratorul, managerul de flotă sau un membru cu dreptul **Adaugă și editează vehicule**.$b$,
  '{vehicule,adauga vehicul,flota,documente,departament}',
  'Adding vehicles',
  'Company vehicles are added in the company space, separate from personal cars.',
$b$In the company space, open **Vehicles** and tap **Add vehicle**. Enter the make, model, year, license plate, VIN, department, type and document expiry dates.

The list is searched by plate, make, model or VIN and filtered by status, driver, department and type.

The number of vehicles depends on the company's plan. Vehicles are added by the administrator, the fleet manager or a member with the **Add and edit vehicles** right.$b$,
  '{vehicles,add vehicle,fleet,documents,department}');

select pg_temp.help_art('firme', 'invitare-membri', 'article', '{fleet}', '{admin,manager}', false, 3,
  'Invitarea membrilor',
  'Un membru se invită prin email, cu un link valabil 14 zile.',
$b$1. În spațiul firmei, deschide **Membri și roluri** și apasă **Invită un membru**.
2. Scrie adresa de email și alege rolul.
3. Apasă **Creează invitația** și trimite linkul afișat persoanei invitate.

Linkul este valabil 14 zile și se acceptă doar cu adresa invitată. Persoana are nevoie de un cont de client.

Fiecare coleg peste cei incluși în plan se plătește lunar. Un membru eliminat nu mai vede datele firmei; vehiculele și istoricul rămân ale firmei.$b$,
  '{invitatie,membri,echipa,link,email}',
  'Inviting members',
  'A member is invited by email, with a link valid for 14 days.',
$b$1. In the company space, open **Members and roles** and tap **Invite a member**.
2. Enter the email address and choose the role.
3. Tap **Create invitation** and send the link shown to the person invited.

The link is valid for 14 days and can be accepted only with the invited address. The person needs a client account.

Each colleague beyond those included in the plan is billed monthly. A removed member no longer sees the company's data; vehicles and history stay with the company.$b$,
  '{invitation,members,team,link,email}');

select pg_temp.help_art('firme', 'roluri-permisiuni', 'article', '{fleet}', '{admin,manager}', false, 4,
  'Roluri și permisiuni',
  'Patru roluri: administrator, manager de flotă, șofer și contabil.',
$b$- **Administrator**: toată firma, inclusiv membrii, regulile și abonamentul.
- **Manager de flotă**: vehiculele, programările și aprobarea devizelor până la limita firmei.
- **Șofer**: vehiculele alocate lui și programările lor.
- **Contabil**: costurile și rapoartele.

Administratorul poate da drepturi în plus unui membru, din **Membri și roluri → Drepturi**: aprobă devize, bugete, programează la service, adaugă și editează vehicule, vede costurile și rapoartele, invită și elimină membri. Unele drepturi sunt incluse doar în anumite planuri.

**Predă administrarea** face din alt membru administrator; tu devii manager de flotă.$b$,
  '{roluri,permisiuni,drepturi,administrator,manager,sofer,contabil}',
  'Roles and permissions',
  'Four roles: administrator, fleet manager, driver and accountant.',
$b$- **Administrator**: the whole company, including members, rules and the subscription.
- **Fleet manager**: vehicles, bookings and approving quotes up to the company's limit.
- **Driver**: the vehicles assigned to them and their bookings.
- **Accountant**: costs and reports.

The administrator can give a member extra rights, in **Members and roles → Rights**: approve quotes, budgets, book at a shop, add and edit vehicles, see costs and reports, invite and remove members. Some rights are included only in certain plans.

**Hand over administration** makes another member the administrator; you become a fleet manager.$b$,
  '{roles,permissions,rights,administrator,manager,driver,accountant}');

select pg_temp.help_art('firme', 'administrare-flota', 'article', '{fleet}', '{}', true, 5,
  'Administrarea flotei',
  'Panoul flotei arată vehiculele, documentele care expiră și devizele de aprobat.',
$b$Spațiul firmei are: **Panou**, **Vehicule**, **Programări**, **Costuri**, **Rapoarte**, **Membri și roluri** și **Cont**. Fiecare membru vede doar ce îi permite rolul.

- **Panou**: vehiculele, documentele care expiră și devizele care așteaptă aprobarea.
- **Programări**: programările la service pentru vehiculele firmei. Devizul îl aprobă firma, în spațiul flotei, nu șoferul.
- **Reguli și bugete**: limita de aprobare a managerilor (peste ea aprobă un administrator) și bugetele lunare sau anuale. Un câmp gol înseamnă fără limită sau fără buget.$b$,
  '{flota,panou,programari,aprobare deviz,bugete,limita}',
  'Running the fleet',
  'The fleet dashboard shows the vehicles, documents about to expire and quotes to approve.',
$b$The company space has: **Dashboard**, **Vehicles**, **Bookings**, **Costs**, **Reports**, **Members and roles** and **Account**. Each member sees only what their role allows.

- **Dashboard**: the vehicles, documents about to expire and quotes waiting for approval.
- **Bookings**: shop bookings for the company's vehicles. The company approves the quote, in the fleet space, not the driver.
- **Rules and budgets**: the managers' approval limit (above it, an administrator approves) and the monthly or yearly budgets. An empty field means no limit or no budget.$b$,
  '{fleet,dashboard,bookings,quote approval,budgets,limit}');

select pg_temp.help_art('firme', 'gestionare-soferi', 'article', '{fleet}', '{admin,manager}', false, 6,
  'Gestionarea șoferilor',
  'Fiecare vehicul se alocă unui șofer, care îl vede în spațiul firmei.',
$b$1. Invită șoferul cu rolul **Șofer** (vezi **Invitarea membrilor**).
2. Deschide vehiculul și apasă **Schimbă șoferul**.
3. Alege membrul și salvează.

Șoferul vede vehiculele alocate lui, le poate programa la service când are acest drept, raportează probleme și adaugă cheltuieli cu bon. Lista de vehicule se filtrează după șofer.$b$,
  '{soferi,alocare,vehicul,schimba soferul}',
  'Managing drivers',
  'Each vehicle is assigned to a driver, who sees it in the company space.',
$b$1. Invite the driver with the **Driver** role (see **Inviting members**).
2. Open the vehicle and tap **Change driver**.
3. Choose the member and save.

The driver sees the vehicles assigned to them, can book them at a shop when they have that right, reports issues and adds expenses with a receipt. The vehicle list can be filtered by driver.$b$,
  '{drivers,assignment,vehicle,change driver}');

select pg_temp.help_art('firme', 'costuri-reparatii', 'article', '{fleet}', '{admin,manager,accountant}', false, 7,
  'Costuri și reparații',
  'Costurile firmei adună reparațiile prin Service-Hub și cheltuielile adăugate cu bon.',
$b$**Costuri** arată, pentru perioada selectată:

- reparațiile făcute prin Service-Hub, din devizele acceptate;
- cheltuielile adăugate manual (combustibil, piese, alte costuri), cu fotografia bonului;
- **Total cheltuieli**, **Cost mediu per vehicul** și **Evoluție lunară**.

Istoricul reparațiilor fiecărui vehicul este pe pagina vehiculului. Costurile le văd administratorul, managerul, contabilul și membrii cu dreptul **Vede costurile și rapoartele**.$b$,
  '{costuri,cheltuieli,bon,reparatii,total}',
  'Costs and repairs',
  'Company costs gather repairs through Service-Hub and expenses added with a receipt.',
$b$**Costs** shows, for the selected period:

- repairs done through Service-Hub, from accepted quotes;
- expenses added by hand (fuel, parts, other costs), with a photo of the receipt;
- **Total expenses**, **Average cost per vehicle** and **Monthly trend**.

Each vehicle's repair history is on its page. Costs are seen by the administrator, the manager, the accountant and members with the **See costs and reports** right.$b$,
  '{costs,expenses,receipt,repairs,total}');

select pg_temp.help_art('firme', 'rapoarte-exporturi', 'article', '{fleet}', '{admin,manager,accountant}', false, 8,
  'Rapoarte și exporturi',
  'Rapoartele de costuri și exportul CSV depind de planul firmei.',
$b$**Rapoarte** compară costurile pe vehicul, pe service și pe kilometru și bugetul față de cheltuieli, pentru perioada selectată, față de perioada precedentă.

Exportul CSV descarcă rapoartele pentru contabilitate. Rapoartele și exporturile sunt **incluse în planul** Fleet Business sau într-un plan superior; în planul firmei tale, ecranul arată ce este inclus.$b$,
  '{rapoarte,export,csv,cost pe kilometru,buget}',
  'Reports and exports',
  'Cost reports and CSV export depend on the company''s plan.',
$b$**Reports** compares costs per vehicle, per shop and per kilometer, and the budget against expenses, for the selected period against the previous period.

The CSV export downloads the reports for accounting. Reports and exports are **included in the** Fleet Business plan or a higher plan; on your company's plan, the screen shows what is included.$b$,
  '{reports,export,csv,cost per kilometer,budget}');

-- D. Cont și securitate ----------------------------------------------------------------------
select pg_temp.help_art('cont', 'autentificare', 'article', '{}', '{}', false, 1,
  'Autentificare',
  'Intră cu emailul și parola sau cu Google ori Apple.',
$b$Deschide **Autentificare**, scrie emailul și parola și apasă **Intră în cont**. **Ține-mă minte** păstrează sesiunea pe acest dispozitiv.

Dacă emailul nu este confirmat, ecranul îți oferă **Retrimite emailul**. Dacă nu găsești emailul, verifică dosarele Spam și Promoții.

Pentru a ieși, apasă **Deconectare** din meniu.$b$,
  '{autentificare,intra in cont,login,parola,tine-ma minte}',
  'Signing in',
  'Sign in with your email and password, or with Google or Apple.',
$b$Open **Sign in**, enter your email and password and tap **Sign in**. **Remember me** keeps you signed in on this device.

If your email is not confirmed, the screen offers **Resend email**. If you cannot find the email, check your Spam and Promotions folders.

To leave, tap **Sign out** in the menu.$b$,
  '{sign in,login,password,remember me}');

select pg_temp.help_art('cont', 'google-apple', 'article', '{}', '{}', false, 2,
  'Google și Apple',
  'Contul se poate deschide cu Google sau Apple, când butoanele apar pe ecran.',
$b$Pe **Autentificare** și **Cont nou**, apasă **Continuă cu Google** sau **Continuă cu Apple**. După conectare revii în Service-Hub.

La prima intrare, ecranul **Finalizează contul** cere tipul contului și datele care lipsesc (de exemplu telefonul și acceptarea Termenilor).

Dacă butoanele nu apar, intră cu emailul și parola.$b$,
  '{google,apple,conectare,finalizeaza contul}',
  'Google and Apple',
  'You can sign in with Google or Apple when the buttons are shown.',
$b$On **Sign in** and **Sign up**, tap **Continue with Google** or **Continue with Apple**. After connecting, you return to Service-Hub.

On the first sign-in, the **Finish your account** screen asks for the account type and anything missing (for example your phone and accepting the Terms).

If the buttons are not shown, sign in with your email and password.$b$,
  '{google,apple,connect,finish account}');

select pg_temp.help_art('cont', 'recuperare-parola', 'article', '{}', '{}', true, 3,
  'Recuperarea parolei',
  'O parolă uitată se înlocuiește din linkul primit pe email.',
$b$1. Pe **Autentificare**, apasă **Ai uitat parola?**.
2. Scrie adresa contului și apasă **Trimite linkul**.
3. Deschide linkul din email, scrie parola nouă de două ori și apasă **Salvează parola**.

Dacă linkul a expirat sau a fost folosit, cere altul. După prea multe încercări, încearcă din nou peste o oră.

Parola se schimbă și din **Cont → Securitate**, când ești în cont.$b$,
  '{parola uitata,resetare parola,link,parola noua}',
  'Recovering your password',
  'A forgotten password is replaced from the link sent to your email.',
$b$1. On **Sign in**, tap **Forgot your password?**.
2. Enter your account's email and tap **Send link**.
3. Open the link in the email, enter the new password twice and tap **Save password**.

If the link expired or was already used, ask for another one. After too many attempts, try again in an hour.

You can also change your password in **Account → Security** while signed in.$b$,
  '{forgot password,reset password,link,new password}');

select pg_temp.help_art('cont', 'confirmare-email', 'article', '{}', '{}', false, 4,
  'Confirmarea emailului',
  'Linkul de confirmare este valabil 24 de ore și se poate retrimite.',
$b$După crearea contului primești un link de confirmare, valabil 24 de ore. Până la confirmare nu poți trimite o cerere de programare.

- Nu găsești emailul: verifică dosarele Spam și Promoții.
- Linkul a expirat: intră cu emailul și parola și apasă **Retrimite emailul**.

## Schimbarea emailului
În **Cont → Securitate** poți schimba adresa. Emailul actual rămâne activ până confirmi adresa nouă din linkul primit.$b$,
  '{confirmare email,link,spam,retrimite,schimbare email}',
  'Confirming your email',
  'The confirmation link is valid for 24 hours and can be sent again.',
$b$After creating your account you get a confirmation link, valid for 24 hours. Until you confirm, you cannot send a booking request.

- You cannot find the email: check your Spam and Promotions folders.
- The link expired: sign in with your email and password and tap **Resend email**.

## Changing your email
In **Account → Security** you can change the address. Your current email stays active until you confirm the new address from the link you receive.$b$,
  '{confirm email,link,spam,resend,change email}');

select pg_temp.help_art('cont', 'date-personale', 'article', '{}', '{}', false, 5,
  'Date personale',
  'Datele contului se schimbă din Cont; o copie a lor se descarcă în Excel.',
$b$- **Cont → Profil**: numele și telefonul. Un telefon nou se confirmă cu un cod prin SMS.
- **Cont → Securitate**: emailul și parola.
- **Cont → Limbă**: româna sau engleza, pentru aplicație și mesaje.

## Copia datelor
**Cont → Datele mele** descarcă un fișier Excel cu datele contului tău: profilul, mașinile, programările, recenziile și solicitările.$b$,
  '{date personale,profil,telefon,limba,datele mele,export,excel}',
  'Personal data',
  'Account details are changed in Account; a copy is downloaded as an Excel file.',
$b$- **Account → Profile**: your name and phone. A new phone number is confirmed with a code sent by text message.
- **Account → Security**: your email and password.
- **Account → Language**: Romanian or English, for the app and messages.

## A copy of your data
**Account → My data** downloads an Excel file with your account's data: profile, cars, bookings, reviews and requests.$b$,
  '{personal data,profile,phone,language,my data,export,excel}');

select pg_temp.help_art('cont', 'stergere-cont', 'article', '{client,shop,fleet}', '{}', false, 6,
  'Ștergerea contului',
  'Ștergerea contului este definitivă și nu se poate anula.',
$b$Deschide **Cont → Datele mele** și alege ștergerea contului. Confirmarea cere bifa **Am înțeles**.

- **Client**: se șterg contul, Garajul și favoritele. Service-urile păstrează lucrările, fără numele tău.
- **Service** (doar proprietarul): service-ul dispare din căutări. Lucrările și facturile rămân cât cere legea.

Un cont cu programări active se șterge după încheierea lor. Descarcă înainte o copie a datelor, din același loc.$b$,
  '{stergere cont,sterge contul,inchidere cont,date}',
  'Deleting your account',
  'Deleting your account is final and cannot be undone.',
$b$Open **Account → My data** and choose to delete your account. The confirmation asks you to tick **I understand**.

- **Client**: your account, Garage and favorites are deleted. Shops keep the jobs, without your name.
- **Shop** (owner only): the shop disappears from search. Jobs and invoices are kept as long as the law requires.

An account with active bookings is deleted after they end. Download a copy of your data first, from the same place.$b$,
  '{delete account,close account,data}');

select pg_temp.help_art('cont', 'confidentialitate', 'article', '{}', '{}', false, 7,
  'Confidențialitate',
  'Cine vede datele tale și unde găsești Politica de confidențialitate.',
$b$- Service-ul vede numele, telefonul și mașina ta doar pentru programările făcute la el.
- Lucrările de la alte service-uri apar în fișa mașinii fără prețuri și fără numele service-urilor, doar cât ai o programare deschisă la acel service. Poți alege să nu le arăți.
- Conversațiile cu service-ul sunt private; echipa Service-Hub nu are acces la conținutul lor.
- Datele de facturare ale unui service nu sunt publice.

Textul complet: **Cont → Documente legale → Politica de confidențialitate**.$b$,
  '{confidentialitate,date personale,gdpr,politica,vizibilitate}',
  'Privacy',
  'Who sees your data and where to find the Privacy Policy.',
$b$- A shop sees your name, phone and car only for bookings made with it.
- Jobs at other shops appear in the vehicle file without prices or shop names, only while you have an open booking with that shop. You can choose not to share them.
- Conversations with a shop are private; the Service-Hub team has no access to their content.
- A shop's billing data is never public.

The full text: **Account → Legal documents → Privacy Policy**.$b$,
  '{privacy,personal data,gdpr,policy,visibility}');

-- E. Abonamente și facturare -----------------------------------------------------------------
select pg_temp.help_art('abonamente', 'planuri', 'article', '{shop,fleet}', '{}', false, 1,
  'Planuri disponibile',
  'Service-urile au un abonament lunar; firmele aleg unul din planurile de flotă.',
$b$## Service-uri
Un singur abonament lunar, cu o perioadă gratuită la început. Primul coleg cu cont este inclus; fiecare coleg în plus se adaugă la prețul lunar. Prețul actual apare în **Cont → Abonament**.

## Firme
Planurile **Fleet Start**, **Fleet Business** și **Fleet Pro** diferă prin numărul de vehicule, colegii incluși și funcții (rapoarte, exporturi, bugete, drepturi suplimentare). Pentru flote mari există **Enterprise**. Comparația și prețurile sunt în spațiul firmei, la **Abonament și facturare → Compară planurile**.

Contul de client este gratuit.$b$,
  '{planuri,abonament,pret,fleet start,fleet business,fleet pro,enterprise}',
  'Available plans',
  'Shops have a monthly subscription; companies choose one of the fleet plans.',
$b$## Shops
One monthly subscription, with a free period at the start. The first colleague with an account is included; each additional colleague is added to the monthly price. The current price is shown in **Account → Subscription**.

## Companies
The **Fleet Start**, **Fleet Business** and **Fleet Pro** plans differ in the number of vehicles, included colleagues and features (reports, exports, budgets, extra rights). Large fleets can use **Enterprise**. The comparison and prices are in the company space, under **Subscription and billing → Compare plans**.

A client account is free.$b$,
  '{plans,subscription,price,fleet start,fleet business,fleet pro,enterprise}');

select pg_temp.help_art('abonamente', 'functionalitati-incluse', 'article', '{shop,fleet}', '{}', false, 2,
  'Funcționalități incluse',
  'Ce include abonamentul service-ului și ce diferă între planurile de flotă.',
$b$## Service-uri
Abonamentul include toate funcțiile service-ului: programările, devizele și documentele, mesajele, istoricul și fișa mașinii, recenziile, rapoartele, importul clienților și linkul cu cod QR.

## Firme
Toate planurile includ panoul de flotă, evidența vehiculelor, alertele pentru documente, istoricul reparațiilor și evidența costurilor. Planurile superioare adaugă membri și roluri, rapoarte de costuri, exporturi CSV, bugete și cost pe kilometru. Un ecran care nu este inclus în planul firmei arată **Inclus în planul** și numele planului.$b$,
  '{functionalitati,inclus,plan,flota,rapoarte,export}',
  'Included features',
  'What the shop subscription includes and how the fleet plans differ.',
$b$## Shops
The subscription includes every shop feature: bookings, quotes and documents, messages, history and vehicle files, reviews, reports, client import and the shop link with a QR code.

## Companies
Every plan includes the fleet dashboard, vehicle records, document alerts, repair history and cost records. Higher plans add members and roles, cost reports, CSV exports, budgets and cost per kilometer. A screen not included in the company's plan shows **Included in the** plan and the plan's name.$b$,
  '{features,included,plan,fleet,reports,export}');

select pg_temp.help_art('abonamente', 'administrare-abonament', 'article', '{shop,fleet}', '{}', true, 3,
  'Administrarea abonamentului',
  'Activarea, schimbarea cardului și anularea, din Cont → Abonament.',
$b$## Service-uri (proprietarul)
În **Cont → Abonament**:
- **Activează abonamentul**: în perioada gratuită salvezi cardul, iar prima plată se face la sfârșitul ei; după, prima plată se face imediat, apoi o dată pe lună.
- **Gestionează abonamentul**: schimbi cardul, vezi plățile sau anulezi. Anularea are efect la sfârșitul perioadei plătite.

Colegii nu văd abonamentul; plățile și facturile sunt în contul proprietarului.

## Firme
În spațiul firmei, **Abonament și facturare** arată planul, perioada de test și limitele. Plata online pentru firme nu este încă activă; până atunci, flota rămâne activă după perioada de test.$b$,
  '{abonament,activare,card,anulare,perioada gratuita,perioada de test}',
  'Managing the subscription',
  'Activating, changing the card and canceling, in Account → Subscription.',
$b$## Shops (owner)
In **Account → Subscription**:
- **Activate subscription**: during the free period you save your card and the first payment is made when it ends; after it, the first payment is made at once, then monthly.
- **Manage subscription**: change the card, see payments or cancel. Canceling takes effect at the end of the paid period.

Colleagues do not see the subscription; payments and invoices are in the owner's account.

## Companies
In the company space, **Subscription and billing** shows the plan, the trial period and the limits. Online payment for companies is not active yet; until then, the fleet stays active after the trial period.$b$,
  '{subscription,activate,card,cancel,free period,trial}');

select pg_temp.help_art('abonamente', 'facturi-plati', 'article', '{shop}', '{}', false, 4,
  'Facturi și plăți',
  'Fiecare plată apare în Cont → Abonament, cu chitanța și factura ei.',
$b$În **Cont → Abonament → Plăți** apare fiecare plată, cu:
- **Chitanța**, care se deschide într-o filă nouă;
- **Factura**, când este emisă; altfel, mențiunea că factura vine separat.

Datele de facturare (denumirea firmei, CUI, Registrul Comerțului, adresa, IBAN) se completează în **Cont → Setări service → Facturare**. CUI-ul se poate verifica la ANAF din același loc.

Când o plată nu reușește, abonamentul trece în **Plată restantă**, iar ecranul arată următoarea încercare.$b$,
  '{facturi,plati,chitanta,date de facturare,cui,anaf,plata restanta}',
  'Invoices and payments',
  'Each payment appears in Account → Subscription, with its receipt and invoice.',
$b$**Account → Subscription → Payments** lists each payment, with:
- the **Receipt**, which opens in a new tab;
- the **Invoice**, once issued; otherwise, a note that the invoice comes separately.

Billing details (company name, tax ID, trade register number, address, IBAN) are entered in **Account → Shop settings → Billing**. The tax ID can be checked with ANAF from the same place.

When a payment fails, the subscription shows **Payment overdue**, and the screen shows the next attempt.$b$,
  '{invoices,payments,receipt,billing details,tax id,anaf,overdue}');

-- Întrebări frecvente ------------------------------------------------------------------------
select pg_temp.help_art('soferi', 'faq-cost-client', 'faq', '{client}', '{}', true, 20,
  'Cât costă Service-Hub pentru șoferi?', null,
$b$Contul de client este gratuit. Plătești doar lucrarea, direct service-ului, după devizul acceptat. Raportul oficial pentru cumpărător se plătește separat, iar prețul apare înainte de plată.$b$,
  '{cost,gratuit,pret,plata}',
  'How much does Service-Hub cost for drivers?', null,
$b$A client account is free. You pay only for the job, directly to the shop, after you accept the quote. The official report for a buyer is paid separately, and its price is shown before you pay.$b$,
  '{cost,free,price,payment}');

select pg_temp.help_art('soferi', 'faq-anulare', 'faq', '{client}', '{}', true, 21,
  'Pot anula o programare?', null,
$b$Da. Apasă **Anulează** pe programare, în **Programări**, până la termenul de anulare stabilit de service. După termen, sună service-ul; numărul apare pe card.$b$,
  '{anulare,anuleaza,programare,termen}',
  'Can I cancel a booking?', null,
$b$Yes. Tap **Cancel** on the booking in **Bookings**, before the cancellation deadline set by the shop. After the deadline, call the shop; the number is on the card.$b$,
  '{cancel,booking,deadline}');

select pg_temp.help_art('soferi', 'faq-refuz-deviz', 'faq', '{client}', '{}', false, 22,
  'Ce se întâmplă dacă refuz devizul?', null,
$b$Lucrarea nu se face, iar programarea se încheie. Dacă service-ul are o taxă de constatare, ea se aplică doar când refuzi tot devizul; valoarea ei apare pe deviz înainte să răspunzi.$b$,
  '{refuz,deviz,taxa de constatare}',
  'What happens if I refuse the quote?', null,
$b$The work is not done and the booking ends. If the shop has an inspection fee, it applies only when you refuse the whole quote; the amount is shown on the quote before you answer.$b$,
  '{refuse,quote,inspection fee}');

select pg_temp.help_art('soferi', 'faq-ordine-cautare', 'faq', '{client}', '{}', false, 23,
  'Cum este ordonată lista de service-uri?', null,
$b$După notă și numărul de recenzii. Un service nou pornește de la o notă medie. Poziția nu se poate cumpăra. Filtrele doar restrâng lista, iar distanța nu schimbă ordinea recomandată.$b$,
  '{ordine,clasament,recenzii,nota}',
  'How is the list of shops ordered?', null,
$b$By rating and number of reviews. A new shop starts from an average rating. A position cannot be bought. Filters only narrow the list, and distance does not change the recommended order.$b$,
  '{order,ranking,reviews,rating}');

select pg_temp.help_art('service-uri', 'faq-nu-apare', 'faq', '{shop}', '{}', true, 20,
  'De ce nu apare service-ul meu în căutări?', null,
$b$Pe **Panou**, lista **Pregătește service-ul pentru programări** arată pașii rămași: serviciile, programul, capacitatea și confirmarea telefonului. Service-ul apare și doar cât abonamentul este activ sau în perioada gratuită.$b$,
  '{nu apare,cautare,vizibil,abonament,pasi}',
  'Why does my shop not appear in search?', null,
$b$On **Dashboard**, the list **Get the shop ready for bookings** shows the steps left: services, hours, capacity and phone confirmation. The shop also appears only while the subscription is active or in the free period.$b$,
  '{not shown,search,visible,subscription,steps}');

select pg_temp.help_art('service-uri', 'faq-date-facturare', 'faq', '{shop}', '{}', false, 21,
  'Cine vede datele de facturare ale service-ului?', null,
$b$Doar proprietarul service-ului și echipa Service-Hub. Pagina publică a service-ului nu arată CUI-ul, IBAN-ul sau alte date fiscale. Pe deviz apar datele firmei, fără IBAN.$b$,
  '{facturare,cui,iban,date fiscale,confidentialitate}',
  'Who sees the shop''s billing details?', null,
$b$Only the shop owner and the Service-Hub team. The shop's public page never shows the tax ID, the IBAN or other tax details. The quote shows the company's details, without the IBAN.$b$,
  '{billing,tax id,iban,tax details,privacy}');

select pg_temp.help_art('cont', 'faq-tip-cont', 'faq', '{client,shop}', '{}', false, 20,
  'Pot schimba tipul contului din client în service?', null,
$b$Nu. Tipul contului se alege o singură dată, la creare. Pentru un service, creează un cont nou, cu altă adresă de email.$b$,
  '{tip cont,client,service,schimbare}',
  'Can I change my account from client to shop?', null,
$b$No. The account type is chosen once, when the account is created. For a shop, create a new account with another email address.$b$,
  '{account type,client,shop,change}');

select pg_temp.help_art('cont', 'faq-contact-suport', 'faq', '{}', '{}', true, 21,
  'Cum contactez echipa Service-Hub?', null,
$b$Din **Cont → Ajutor și contact**: **Solicitările mele** pentru o solicitare scrisă în aplicație, sau email și WhatsApp. ID-ul contului este inclus automat în mesaj. Pentru o programare, include codul ei (de exemplu P-000123).$b$,
  '{contact,suport,solicitare,email,whatsapp}',
  'How do I contact the Service-Hub team?', null,
$b$From **Account → Help and contact**: **My requests** for a request written in the app, or email and WhatsApp. Your account ID is included in the message automatically. For a booking, include its code (for example P-000123).$b$,
  '{contact,support,request,email,whatsapp}');

update public.schema_version set version = 117;
