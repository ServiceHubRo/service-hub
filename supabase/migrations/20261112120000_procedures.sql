-- A5 — Internal procedures (Eduard, 12 Nov 2026). The Service-Hub team's operating manual: usual and
-- exceptional procedures, who is responsible for each category, versions approved by an admin that never
-- change afterwards, „Am citit” on the critical exceptional procedures (per version), and the procedures
-- that fit a support request shown next to it.
--
-- Decisions (Eduard, 12 Nov 2026):
--   · any admin approves and publishes, its own draft included (one admin is enough);
--   · an agent reads the published procedures meant for agents, creates drafts, edits its own drafts and
--     the drafts of the categories it is responsible for, sends them for approval; never approves,
--     publishes, archives or changes an approved version;
--   · escalation stays A3's (agent → admin, support_escalate_request / admin_return_request): nothing of
--     A3 changes, the procedures only describe it;
--   · „Am citit” is required on exceptional procedures marked critical, tied to one version: a new
--     version asks again; an admin names one responsible per category among the team.
--
-- Security (CLAUDE.md §6.1): the four tables have RLS on and no grant to anon or authenticated; every
-- read and write goes through the functions below, which check the caller in the database:
--   staff_*            an agent or an admin after the second step (require_staff: an agent's session
--                      must still exist)
--   admin_procedure_*  an admin after the second step (require_admin)
-- None of them is reachable by anon, a client or a shop, and nothing here is part of help_center or of
-- any public function. Texts are Markdown read by the app's own reader (never HTML) and pass the A4 rules
-- (help_text_ok: no HTML, scripts, placeholders, links other than https:// and mailto:) and the A3c2a
-- secret check (text_has_secret: no password, key, token or card number).
--
-- Nothing existing changes: four new tables, new functions, the audit classes gain the new actions.
-- The first content is written as drafts („Necesită aprobare”): nothing is published until an admin
-- approves it. Rollback: supabase/rollback/20261112120000_procedures.sql.

-- ---------------------------------------------------------------------------------------------
-- Rules for the content
-- ---------------------------------------------------------------------------------------------

-- The categories of procedures (names in the app's texts, procedures.category.<key>).
create function public.procedure_category_ok(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and p = any (array['access', 'accounts', 'bookings', 'complaints', 'billing', 'technical',
    'notifications', 'personal_data', 'security', 'fraud', 'escalation']::text[])
$$;
revoke execute on function public.procedure_category_ok(text) from public, anon, authenticated;

-- The first problem of one language's content, or null: {field} (or {field, secret: true}).
-- Content is a JSON object with exactly these keys:
--   title (3–140), applies_when (10–2000), purpose (10–2000), steps (1–30 steps of 3–1000),
--   escalation (10–2000)                                      — required
--   responsibilities, deadlines, forbidden, warnings (3–2000) — optional
create function public.procedure_content_issue(c jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v text;
  spec record;
  n int;
begin
  if c is null or jsonb_typeof(c) <> 'object' then
    return jsonb_build_object('field', 'content');
  end if;
  for k in select jsonb_object_keys(c) loop
    if k not in ('title', 'applies_when', 'purpose', 'responsibilities', 'steps', 'deadlines', 'escalation', 'forbidden', 'warnings') then
      return jsonb_build_object('field', 'content');
    end if;
  end loop;
  for spec in
    select * from (values ('title', 3, 140, true), ('applies_when', 10, 2000, true), ('purpose', 10, 2000, true),
                          ('responsibilities', 3, 2000, false), ('deadlines', 3, 2000, false), ('escalation', 10, 2000, true),
                          ('forbidden', 3, 2000, false), ('warnings', 3, 2000, false)) s(name, min_len, max_len, required)
  loop
    if c ? spec.name and jsonb_typeof(c->spec.name) not in ('string', 'null') then
      return jsonb_build_object('field', spec.name);
    end if;
    v := nullif(btrim(c->>spec.name), '');
    if v is null then
      if spec.required then
        return jsonb_build_object('field', spec.name);
      end if;
      continue;
    end if;
    if not public.help_text_ok(v, spec.min_len, spec.max_len) then
      return jsonb_build_object('field', spec.name);
    end if;
    if public.text_has_secret(v) then
      return jsonb_build_object('field', spec.name, 'secret', true);
    end if;
  end loop;
  if jsonb_typeof(c->'steps') is distinct from 'array' then
    return jsonb_build_object('field', 'steps');
  end if;
  n := jsonb_array_length(c->'steps');
  if n < 1 or n > 30 then
    return jsonb_build_object('field', 'steps');
  end if;
  for k in select x from jsonb_array_elements(c->'steps') x loop
    -- k is the JSON text of the step: it must be a string.
    if left(k, 1) <> '"' then
      return jsonb_build_object('field', 'steps');
    end if;
    v := (k::jsonb)#>>'{}';
    if not public.help_text_ok(v, 3, 1000) then
      return jsonb_build_object('field', 'steps');
    end if;
    if public.text_has_secret(v) then
      return jsonb_build_object('field', 'steps', 'secret', true);
    end if;
  end loop;
  return null;
end
$$;
revoke execute on function public.procedure_content_issue(jsonb) from public, anon, authenticated;

-- One language's content as stored: trimmed, without empty optional fields or empty steps.
create function public.procedure_content_clean(c jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when c is null or jsonb_typeof(c) <> 'object' then c
    else jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(btrim(c->>'title'), ''),
      'applies_when', nullif(btrim(c->>'applies_when'), ''),
      'purpose', nullif(btrim(c->>'purpose'), ''),
      'responsibilities', nullif(btrim(c->>'responsibilities'), ''),
      'steps', case when jsonb_typeof(c->'steps') = 'array'
                    then coalesce((select jsonb_agg(to_jsonb(btrim(s)) order by o)
                                   from jsonb_array_elements_text(c->'steps') with ordinality t(s, o)
                                   where btrim(s) <> ''), '[]'::jsonb)
                    else c->'steps' end,
      'deadlines', nullif(btrim(c->>'deadlines'), ''),
      'escalation', nullif(btrim(c->>'escalation'), ''),
      'forbidden', nullif(btrim(c->>'forbidden'), ''),
      'warnings', nullif(btrim(c->>'warnings'), '')))
    -- Keys the app does not know are kept, so procedure_content_issue refuses them.
    || coalesce((select jsonb_object_agg(k, c->k) from jsonb_object_keys(c) k
                 where k not in ('title', 'applies_when', 'purpose', 'responsibilities', 'steps', 'deadlines', 'escalation', 'forbidden', 'warnings')), '{}'::jsonb)
  end
$$;
revoke execute on function public.procedure_content_clean(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  category text not null check (public.procedure_category_ok(category)),
  -- usual: the day-to-day work; exceptional: incidents and situations that need care.
  kind text not null check (kind in ('usual', 'exceptional')),
  -- Who reads it once published: support (agents and admins) or admin (admins only).
  visibility text not null default 'support' check (visibility in ('support', 'admin')),
  -- „Am citit” required, per version. Only an exceptional procedure can be critical.
  critical boolean not null default false,
  -- The A3 request categories it is shown next to (support_categories.key; checked by the functions).
  support_categories text[] not null default '{}',
  -- draft: never published; published: the version in published_version_id is the one readers see;
  -- archived: withdrawn (its versions stay).
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_version_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not critical or kind = 'exceptional'),
  check (status <> 'published' or published_version_id is not null),
  check (cardinality(support_categories) <= 9)
);
create index procedures_category_idx on public.procedures (category);

create table public.procedure_versions (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures (id) on delete restrict,
  version int not null check (version >= 1),
  -- draft: being written; pending: sent for approval; approved: fixed for ever (published or not).
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved')),
  content_ro jsonb not null check (public.procedure_content_issue(content_ro) is null),
  -- English is optional: the whole content or nothing.
  content_en jsonb check (content_en is null or public.procedure_content_issue(content_en) is null),
  author_id uuid references public.profiles (id) on delete set null,
  author_display_id text,
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_by_display_id text,
  approved_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  published_by_display_id text,
  published_at timestamptz,
  -- Written by the migration (the first content), not by a person.
  seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procedure_id, version),
  check ((status = 'approved') = (approved_at is not null)),
  check (published_at is null or status = 'approved'),
  check (status <> 'pending' or submitted_at is not null)
);
-- At most one version in work (draft or sent for approval) per procedure.
create unique index procedure_versions_open_idx on public.procedure_versions (procedure_id) where status in ('draft', 'pending');
create index procedure_versions_author_idx on public.procedure_versions (author_id) where author_id is not null;

alter table public.procedures
  add constraint procedures_published_version_fk foreign key (published_version_id) references public.procedure_versions (id);

create table public.procedure_acknowledgements (
  version_id uuid not null references public.procedure_versions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (version_id, user_id)
);
create index procedure_acknowledgements_user_idx on public.procedure_acknowledgements (user_id);

create table public.procedure_responsibilities (
  category text primary key check (public.procedure_category_ok(category)),
  -- Null once the account is deleted: the category then needs a new responsible.
  user_id uuid references public.profiles (id) on delete set null,
  user_display_id text not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_by_display_id text,
  assigned_at timestamptz not null default now()
);
create index procedure_responsibilities_user_idx on public.procedure_responsibilities (user_id);

alter table public.procedures enable row level security;
alter table public.procedure_versions enable row level security;
alter table public.procedure_acknowledgements enable row level security;
alter table public.procedure_responsibilities enable row level security;
revoke all on public.procedures, public.procedure_versions, public.procedure_acknowledgements, public.procedure_responsibilities
  from public, anon, authenticated;

-- An approved version never changes and is never deleted, by any path (direct SQL included). Only its
-- first publication is written once, and an account deleted later leaves its references empty.
create function public.procedure_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      perform public.fail('version_locked');
    end if;
    return old;
  end if;
  if old.status = 'approved' and (
       new.status is distinct from old.status
       or new.procedure_id is distinct from old.procedure_id
       or new.version is distinct from old.version
       or new.content_ro is distinct from old.content_ro
       or new.content_en is distinct from old.content_en
       or new.author_display_id is distinct from old.author_display_id
       or (new.author_id is distinct from old.author_id and new.author_id is not null)
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at is distinct from old.approved_at
       or new.approved_by_display_id is distinct from old.approved_by_display_id
       or (new.approved_by is distinct from old.approved_by and new.approved_by is not null)
       or new.seeded is distinct from old.seeded
       or new.created_at is distinct from old.created_at
       or (old.published_at is not null and (
             new.published_at is distinct from old.published_at
             or new.published_by_display_id is distinct from old.published_by_display_id
             or (new.published_by is distinct from old.published_by and new.published_by is not null)))) then
    perform public.fail('version_locked');
  end if;
  return new;
end
$$;
revoke execute on function public.procedure_versions_guard() from public, anon, authenticated;

create trigger procedure_versions_guard
  before update or delete on public.procedure_versions
  for each row execute function public.procedure_versions_guard();

-- ---------------------------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------------------------

-- Whether a team member reads a procedure's published version: an admin always, an agent only the
-- published (not archived) procedures meant for agents.
create function public.procedure_can_read(p public.procedures, p_me public.profiles)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_me.role = 'admin'
      or (p_me.role = 'support' and p.visibility = 'support' and p.status = 'published')
$$;
revoke execute on function public.procedure_can_read(public.procedures, public.profiles) from public, anon, authenticated;

-- Whether a team member may write a version in work: an admin always; an agent its own version, or any
-- version of a category it is responsible for, of a procedure meant for agents.
create function public.procedure_can_edit(p public.procedures, p_author uuid, p_me public.profiles)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_me.role = 'admin'
      or (p_me.role = 'support' and p.visibility = 'support' and p.status <> 'archived'
          and (p_author = p_me.id
               or exists (select 1 from public.procedure_responsibilities r where r.category = p.category and r.user_id = p_me.id)))
$$;
revoke execute on function public.procedure_can_edit(public.procedures, uuid, public.profiles) from public, anon, authenticated;

-- A category's responsible: who, since when, and whether it must be named again (the account is gone,
-- suspended, or no longer in the team).
create function public.procedure_responsible_json(p_category text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
      'user', case when p.id is not null then jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'role', p.role) end,
      'display_id', r.user_display_id,
      'assigned_at', r.assigned_at,
      'assigned_by', r.assigned_by_display_id,
      'needs_reassignment', p.id is null or p.role not in ('support', 'admin') or p.suspended or p.deleted_at is not null)
  from public.procedure_responsibilities r
  left join public.profiles p on p.id = r.user_id
  where r.category = p_category
$$;
revoke execute on function public.procedure_responsible_json(text) from public, anon, authenticated;

-- The team members who must confirm a version of a critical procedure: active admins, and active agents
-- when it is meant for agents.
create function public.procedure_readers(p public.procedures)
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select x.* from public.profiles x
  where x.deleted_at is null and not x.suspended
    and (x.role = 'admin' or (x.role = 'support' and p.visibility = 'support'))
$$;
revoke execute on function public.procedure_readers(public.procedures) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- JSON shapes
-- ---------------------------------------------------------------------------------------------

create function public.procedure_version_json(v public.procedure_versions, p_content boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
      'id', v.id, 'version', v.version, 'status', v.status,
      'author', v.author_display_id, 'author_id', v.author_id, 'seeded', v.seeded,
      'submitted_at', v.submitted_at,
      'approved_by', v.approved_by_display_id, 'approved_at', v.approved_at,
      'published_by', v.published_by_display_id, 'published_at', v.published_at,
      'created_at', v.created_at, 'updated_at', v.updated_at,
      'title_ro', v.content_ro->>'title', 'title_en', v.content_en->>'title')
    || case when p_content then jsonb_build_object('content_ro', v.content_ro, 'content_en', v.content_en) else '{}'::jsonb end
$$;
revoke execute on function public.procedure_version_json(public.procedure_versions, boolean) from public, anon, authenticated;

-- A procedure as one team member sees it: settings, the published version (with its text, so the app
-- searches without asking again), the version in work when the member may edit it, and „Am citit”.
create function public.procedure_json(p public.procedures, p_me public.profiles, p_content boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pub public.procedure_versions%rowtype;
  v_open public.procedure_versions%rowtype;
  v_readers int;
  v_done int;
  v_result jsonb;
begin
  select * into v_pub from public.procedure_versions v where v.id = p.published_version_id;
  select * into v_open from public.procedure_versions v where v.procedure_id = p.id and v.status in ('draft', 'pending');
  v_result := jsonb_build_object(
    'id', p.id, 'category', p.category, 'kind', p.kind, 'visibility', p.visibility, 'critical', p.critical,
    'support_categories', to_jsonb(p.support_categories), 'status', p.status,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'responsible', public.procedure_responsible_json(p.category),
    'published', case when v_pub.id is not null and public.procedure_can_read(p, p_me)
                      then public.procedure_version_json(v_pub, p_content) end,
    'open', case when v_open.id is not null and public.procedure_can_edit(p, v_open.author_id, p_me)
                 then public.procedure_version_json(v_open, p_content) end,
    -- May write the version in work, or start a new one when there is none.
    'can_edit', public.procedure_can_edit(p, coalesce(v_open.author_id, p_me.id), p_me),
    'ack_required', p.critical and p.status = 'published' and v_pub.id is not null,
    'acknowledged_at', (select a.acknowledged_at from public.procedure_acknowledgements a
                        where a.version_id = v_pub.id and a.user_id = p_me.id));
  if p_me.role = 'admin' and p.critical and v_pub.id is not null then
    select count(*), count(a.user_id) into v_readers, v_done
    from public.procedure_readers(p) r
    left join public.procedure_acknowledgements a on a.version_id = v_pub.id and a.user_id = r.id;
    v_result := v_result || jsonb_build_object('acks', jsonb_build_object('done', v_done, 'total', v_readers));
  end if;
  return v_result;
end
$$;
revoke execute on function public.procedure_json(public.procedures, public.profiles, boolean) from public, anon, authenticated;

-- Whether a member sees a procedure in its lists at all: what it may read, or a version in work it may edit.
create function public.procedure_listed(p public.procedures, p_me public.profiles)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.procedure_can_read(p, p_me)
      or exists (select 1 from public.procedure_versions v
                 where v.procedure_id = p.id and v.status in ('draft', 'pending')
                   and public.procedure_can_edit(p, v.author_id, p_me))
$$;
revoke execute on function public.procedure_listed(public.procedures, public.profiles) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reading (agent or admin, second step)
-- ---------------------------------------------------------------------------------------------

-- The library: every procedure the caller may see, the categories with their responsible, and (admin)
-- the team members a category can be given to.
create function public.staff_procedures()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  return jsonb_build_object(
    'me', jsonb_build_object('id', v_me.id, 'role', v_me.role, 'display_id', v_me.display_id),
    'categories', (
      select jsonb_agg(jsonb_build_object('key', k, 'responsible', public.procedure_responsible_json(k)) order by o)
      from unnest(array['access', 'accounts', 'bookings', 'complaints', 'billing', 'technical', 'notifications',
                        'personal_data', 'security', 'fraud', 'escalation']) with ordinality c(k, o)),
    'procedures', coalesce((
      select jsonb_agg(public.procedure_json(p, v_me, true) order by p.category, p.created_at)
      from public.procedures p where public.procedure_listed(p, v_me)), '[]'::jsonb),
    'support_categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.key, 'name_ro', c.name_ro, 'name_en', c.name_en) order by c.position)
      from public.support_categories c), '[]'::jsonb),
    'team', case when v_me.role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'role', p.role)
                       order by p.role desc, p.display_id)
      from public.profiles p where p.role in ('support', 'admin') and not p.suspended and p.deleted_at is null), '[]'::jsonb) end);
end
$$;
revoke execute on function public.staff_procedures() from public, anon;
grant execute on function public.staff_procedures() to authenticated;

-- One procedure with its history: an admin sees every version; an agent the approved ones of a
-- procedure it may read, and the version in work when it may edit it.
create function public.staff_procedure_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  p public.procedures%rowtype;
begin
  v_me := public.require_staff();
  select * into p from public.procedures x where x.id = p_id;
  if p.id is null or not public.procedure_listed(p, v_me) then
    perform public.fail('procedure_not_found');
  end if;
  return public.procedure_json(p, v_me, true) || jsonb_build_object(
    'versions', coalesce((
      select jsonb_agg(public.procedure_version_json(v, true) order by v.version desc)
      from public.procedure_versions v
      where v.procedure_id = p.id
        and (v_me.role = 'admin'
             or (v.status = 'approved' and v.published_at is not null and public.procedure_can_read(p, v_me))
             or (v.status in ('draft', 'pending') and public.procedure_can_edit(p, v.author_id, v_me)))), '[]'::jsonb));
end
$$;
revoke execute on function public.staff_procedure_get(uuid) from public, anon;
grant execute on function public.staff_procedure_get(uuid) to authenticated;

-- The procedures that fit a support request (its category), as the caller may read them. A request
-- under legal hold does not exist for an agent (as in support_get_request).
create function public.support_procedures_for_request(p_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
begin
  v_me := public.require_staff();
  select * into s from public.suggestions x where x.id = p_request;
  if s.id is null or (v_me.role <> 'admin' and public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id))) then
    perform public.fail('request_not_found');
  end if;
  return coalesce((
    select jsonb_agg(public.procedure_json(p, v_me, true) order by p.critical desc, p.kind desc, p.created_at)
    from public.procedures p
    where p.status = 'published' and s.category = any (p.support_categories) and public.procedure_can_read(p, v_me)), '[]'::jsonb);
end
$$;
revoke execute on function public.support_procedures_for_request(uuid) from public, anon;
grant execute on function public.support_procedures_for_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Writing a procedure (agent or admin)
-- ---------------------------------------------------------------------------------------------

-- Checks one language's content; a refusal names the field: field_invalid {field: proc_title_ro, …} or
-- secret_in_text {field: …}. Returns the content as stored.
create function public.procedure_content_checked(p_content jsonb, p_lang text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := public.procedure_content_clean(p_content);
  v_issue jsonb := public.procedure_content_issue(v);
begin
  if v_issue is not null then
    if (v_issue->>'secret')::boolean then
      perform public.fail('secret_in_text', jsonb_build_object('field', 'proc_' || (v_issue->>'field') || '_' || p_lang));
    end if;
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_' || (v_issue->>'field') || '_' || p_lang));
  end if;
  return v;
end
$$;
revoke execute on function public.procedure_content_checked(jsonb, text) from public, anon, authenticated;

-- English: null or absent means none.
create function public.procedure_en(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p is null or jsonb_typeof(p) = 'null' then null
              when jsonb_typeof(p) = 'object' and not exists (
                select 1 from jsonb_each(p) e where jsonb_typeof(e.value) not in ('null')
                  and not (jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') = '')
                  and not (jsonb_typeof(e.value) = 'array' and not exists (
                    select 1 from jsonb_array_elements(e.value) s where jsonb_typeof(s) <> 'string' or btrim(s #>> '{}') <> ''))) then null
              else p end
$$;
revoke execute on function public.procedure_en(jsonb) from public, anon, authenticated;

-- The settings in a request: category, kind, request categories; and (admin) visibility and critical.
-- Absent keys keep `p_old`'s values (a new procedure: usual, for agents, not critical).
create function public.procedure_meta_checked(p_meta jsonb, p_old public.procedures, p_admin boolean)
returns public.procedures
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.procedures := p_old;
  v_in jsonb := coalesce(p_meta, '{}'::jsonb);
  v_cats text[];
begin
  if jsonb_typeof(v_in) <> 'object' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_settings'));
  end if;
  if v_in ? 'category' then
    v.category := v_in->>'category';
  end if;
  if not public.procedure_category_ok(v.category) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_category'));
  end if;
  if v_in ? 'kind' then
    v.kind := v_in->>'kind';
  end if;
  if v.kind is null or v.kind not in ('usual', 'exceptional') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_kind'));
  end if;
  if v_in ? 'support_categories' then
    v_cats := public.help_json_texts(v_in->'support_categories');
    if v_cats is null or cardinality(v_cats) > 9
       or cardinality(v_cats) <> cardinality(array(select distinct unnest(v_cats)))
       or exists (select 1 from unnest(v_cats) k where not exists (select 1 from public.support_categories c where c.key = k)) then
      perform public.fail('field_invalid', jsonb_build_object('field', 'proc_support_categories'));
    end if;
    v.support_categories := v_cats;
  end if;
  if v_in ? 'visibility' or v_in ? 'critical' then
    if not p_admin then
      -- Who reads a procedure and whether it is critical is the admin's to decide.
      if (v_in ? 'visibility' and v_in->>'visibility' is distinct from p_old.visibility)
         or (v_in ? 'critical' and (v_in->>'critical')::boolean is distinct from p_old.critical) then
        perform public.fail('not_allowed');
      end if;
    end if;
    if v_in ? 'visibility' then
      v.visibility := v_in->>'visibility';
    end if;
    if v.visibility is null or v.visibility not in ('support', 'admin') then
      perform public.fail('field_invalid', jsonb_build_object('field', 'proc_visibility'));
    end if;
    if v_in ? 'critical' then
      if jsonb_typeof(v_in->'critical') <> 'boolean' then
        perform public.fail('field_invalid', jsonb_build_object('field', 'proc_critical'));
      end if;
      v.critical := (v_in->>'critical')::boolean;
    end if;
  end if;
  if v.critical and v.kind <> 'exceptional' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_critical'));
  end if;
  return v;
end
$$;
revoke execute on function public.procedure_meta_checked(jsonb, public.procedures, boolean) from public, anon, authenticated;

-- Creates a procedure and its first version, a draft. An agent's procedure is for agents and not
-- critical (the admin decides those when approving).
create function public.staff_procedure_create(p_procedure jsonb, p_content_ro jsonb, p_content_en jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_meta public.procedures;
  v_ro jsonb;
  v_en jsonb;
  p public.procedures%rowtype;
  v public.procedure_versions%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'staff_procedure_create');
  if v_seen is not null then
    return v_seen;
  end if;
  v_meta := public.procedure_meta_checked(p_procedure,
    row(null, null, 'usual', 'support', false, '{}', 'draft', null, null, null, null)::public.procedures, v_me.role = 'admin');
  v_ro := public.procedure_content_checked(p_content_ro, 'ro');
  v_en := public.procedure_en(p_content_en);
  if v_en is not null then
    v_en := public.procedure_content_checked(v_en, 'en');
  end if;

  insert into public.procedures (category, kind, visibility, critical, support_categories, created_by)
  values (v_meta.category, v_meta.kind, v_meta.visibility, v_meta.critical, v_meta.support_categories, v_me.id)
  returning * into p;
  insert into public.procedure_versions (procedure_id, version, content_ro, content_en, author_id, author_display_id)
  values (p.id, 1, v_ro, v_en, v_me.id, v_me.display_id)
  returning * into v;
  perform public.staff_audit('create_procedure', 'procedure', p.id::text, null,
    jsonb_build_object('title', v_ro->>'title', 'category', p.category, 'kind', p.kind, 'visibility', p.visibility,
                       'critical', p.critical, 'version', v.version));
  v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.staff_procedure_create(jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.staff_procedure_create(jsonb, jsonb, jsonb, uuid) to authenticated;

-- Saves a draft version (never one sent for approval or approved). The settings change here only while
-- the procedure was never published (afterwards: admin_procedure_set_settings).
create function public.staff_procedure_save(p_version_id uuid, p_content_ro jsonb, p_content_en jsonb, p_procedure jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_old public.procedure_versions%rowtype;
  v public.procedure_versions%rowtype;
  p public.procedures%rowtype;
  v_meta public.procedures;
  v_ro jsonb;
  v_en jsonb;
  v_changed text[] := '{}';
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'staff_procedure_save');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_old from public.procedure_versions x where x.id = p_version_id for update;
  if v_old.id is not null then
    select * into p from public.procedures x where x.id = v_old.procedure_id for update;
  end if;
  if v_old.id is null or not public.procedure_can_edit(p, v_old.author_id, v_me) then
    perform public.fail('procedure_not_found');
  end if;
  if v_old.status = 'approved' then
    perform public.fail('version_locked');
  end if;
  if v_old.status <> 'draft' then
    perform public.fail('wrong_status');
  end if;
  v_ro := public.procedure_content_checked(p_content_ro, 'ro');
  v_en := public.procedure_en(p_content_en);
  if v_en is not null then
    v_en := public.procedure_content_checked(v_en, 'en');
  end if;
  if p_procedure is not null and jsonb_typeof(p_procedure) <> 'null' then
    v_meta := public.procedure_meta_checked(p_procedure, p, v_me.role = 'admin');
    if (v_meta.category, v_meta.kind, v_meta.visibility, v_meta.critical, v_meta.support_categories)
       is distinct from (p.category, p.kind, p.visibility, p.critical, p.support_categories) then
      if p.status <> 'draft' then
        perform public.fail('wrong_status');
      end if;
      update public.procedures x set category = v_meta.category, kind = v_meta.kind, visibility = v_meta.visibility,
        critical = v_meta.critical, support_categories = v_meta.support_categories, updated_at = now()
      where x.id = p.id;
      v_changed := array_append(v_changed, 'settings');
    end if;
  end if;
  if v_ro is distinct from v_old.content_ro then
    v_changed := array_append(v_changed, 'content_ro');
  end if;
  if v_en is distinct from v_old.content_en then
    v_changed := array_append(v_changed, 'content_en');
  end if;
  if cardinality(v_changed) > 0 then
    update public.procedure_versions x set content_ro = v_ro, content_en = v_en, updated_at = now()
    where x.id = v_old.id
    returning * into v;
    perform public.staff_audit('save_procedure_draft', 'procedure', p.id::text, null,
      jsonb_build_object('title', v_ro->>'title', 'version', v.version, 'changed', to_jsonb(v_changed)));
  else
    v := v_old;
  end if;
  v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version, 'changed', to_jsonb(v_changed));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.staff_procedure_save(uuid, jsonb, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.staff_procedure_save(uuid, jsonb, jsonb, jsonb, uuid) to authenticated;

-- A new version, a draft, starting from the published one (or the last approved): a change to an
-- approved procedure never edits it in place. An agent may propose one for a procedure it reads.
create function public.staff_procedure_new_version(p_procedure_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  p public.procedures%rowtype;
  v_from public.procedure_versions%rowtype;
  v public.procedure_versions%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'staff_procedure_new_version');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into p from public.procedures x where x.id = p_procedure_id for update;
  if p.id is null or not public.procedure_can_read(p, v_me) or not public.procedure_can_edit(p, v_me.id, v_me) then
    perform public.fail('procedure_not_found');
  end if;
  if exists (select 1 from public.procedure_versions x where x.procedure_id = p.id and x.status in ('draft', 'pending')) then
    perform public.fail('version_open');
  end if;
  select * into v_from from public.procedure_versions x
  where x.id = p.published_version_id or (p.published_version_id is null and x.procedure_id = p.id and x.status = 'approved')
  order by x.version desc limit 1;
  if v_from.id is null then
    perform public.fail('wrong_status');
  end if;
  insert into public.procedure_versions (procedure_id, version, content_ro, content_en, author_id, author_display_id)
  values (p.id, (select max(x.version) from public.procedure_versions x where x.procedure_id = p.id) + 1,
          v_from.content_ro, v_from.content_en, v_me.id, v_me.display_id)
  returning * into v;
  perform public.staff_audit('new_procedure_version', 'procedure', p.id::text, jsonb_build_object('from_version', v_from.version),
    jsonb_build_object('title', v.content_ro->>'title', 'version', v.version));
  v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.staff_procedure_new_version(uuid, uuid) from public, anon;
grant execute on function public.staff_procedure_new_version(uuid, uuid) to authenticated;

-- Moves a version in work: submit (draft → sent for approval), to_draft (back to draft, by its editor
-- or an admin), discard (deleted; a procedure that never had an approved version goes with it).
create function public.staff_procedure_step(p_version_id uuid, p_step text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v public.procedure_versions%rowtype;
  p public.procedures%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'staff_procedure_step');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_step is null or p_step not in ('submit', 'to_draft', 'discard') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_step'));
  end if;
  select * into v from public.procedure_versions x where x.id = p_version_id for update;
  if v.id is not null then
    select * into p from public.procedures x where x.id = v.procedure_id for update;
  end if;
  if v.id is null or not public.procedure_can_edit(p, v.author_id, v_me) then
    perform public.fail('procedure_not_found');
  end if;
  if v.status = 'approved' then
    perform public.fail('version_locked');
  end if;
  if (p_step = 'submit' and v.status <> 'draft') or (p_step = 'to_draft' and v.status <> 'pending') then
    perform public.fail('wrong_status');
  end if;

  if p_step = 'discard' then
    delete from public.procedure_versions x where x.id = v.id;
    if not exists (select 1 from public.procedure_versions x where x.procedure_id = p.id) then
      delete from public.procedures x where x.id = p.id;
    end if;
    perform public.staff_audit('discard_procedure_draft', 'procedure', p.id::text,
      jsonb_build_object('title', v.content_ro->>'title', 'version', v.version, 'status', v.status), null);
    v_result := jsonb_build_object('id', p.id, 'version', v.version, 'discarded', true,
      'procedure_deleted', not exists (select 1 from public.procedures x where x.id = p.id));
  else
    update public.procedure_versions x set
      status = case p_step when 'submit' then 'pending' else 'draft' end,
      submitted_at = case p_step when 'submit' then now() else x.submitted_at end,
      updated_at = now()
    where x.id = v.id
    returning * into v;
    perform public.staff_audit(case when p_step = 'submit' then 'submit_procedure' else 'return_procedure_draft' end,
      'procedure', p.id::text, null, jsonb_build_object('title', v.content_ro->>'title', 'version', v.version));
    v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version, 'status', v.status);
  end if;
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.staff_procedure_step(uuid, text, uuid) from public, anon;
grant execute on function public.staff_procedure_step(uuid, text, uuid) to authenticated;

-- „Am citit”: the caller confirms the published version of a critical procedure it reads. Only an
-- explicit call writes it (opening the page writes nothing); once per version and member.
create function public.staff_procedure_acknowledge(p_version_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v public.procedure_versions%rowtype;
  p public.procedures%rowtype;
  v_at timestamptz;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'staff_procedure_acknowledge');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.procedure_versions x where x.id = p_version_id;
  if v.id is not null then
    select * into p from public.procedures x where x.id = v.procedure_id;
  end if;
  if v.id is null or not public.procedure_can_read(p, v_me) or p.status <> 'published' then
    perform public.fail('procedure_not_found');
  end if;
  -- Only the version readers see now: an older one is not this procedure's text any more.
  if p.published_version_id is distinct from v.id then
    perform public.fail('wrong_status');
  end if;
  if not p.critical then
    perform public.fail('ack_not_required');
  end if;
  insert into public.procedure_acknowledgements (version_id, user_id) values (v.id, v_me.id)
  on conflict (version_id, user_id) do nothing
  returning acknowledged_at into v_at;
  if v_at is not null then
    perform public.staff_audit('acknowledge_procedure', 'procedure', p.id::text, null,
      jsonb_build_object('title', v.content_ro->>'title', 'version', v.version));
  else
    select a.acknowledged_at into v_at from public.procedure_acknowledgements a where a.version_id = v.id and a.user_id = v_me.id;
  end if;
  v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version, 'acknowledged_at', v_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.staff_procedure_acknowledge(uuid, uuid) from public, anon;
grant execute on function public.staff_procedure_acknowledge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Administration (admin only, second step)
-- ---------------------------------------------------------------------------------------------

-- Approves a draft or a version sent for approval (any admin, its own draft included): the version is
-- fixed for ever. With p_publish it becomes at once the version readers see.
create function public.admin_procedure_approve(p_version_id uuid, p_publish boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v public.procedure_versions%rowtype;
  p public.procedures%rowtype;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_procedure_approve');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.procedure_versions x where x.id = p_version_id for update;
  if v.id is null then
    perform public.fail('procedure_not_found');
  end if;
  select * into p from public.procedures x where x.id = v.procedure_id for update;
  if v.status = 'approved' then
    perform public.fail('version_locked');
  end if;
  update public.procedure_versions x set
    status = 'approved', submitted_at = coalesce(x.submitted_at, now()),
    approved_by = v_me.id, approved_by_display_id = v_me.display_id, approved_at = now(), updated_at = now()
  where x.id = v.id
  returning * into v;
  perform public.staff_audit('approve_procedure', 'procedure', p.id::text, null,
    jsonb_build_object('title', v.content_ro->>'title', 'version', v.version, 'author', v.author_display_id));
  if coalesce(p_publish, false) then
    perform public.procedure_publish(p, v, v_me);
  end if;
  v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version, 'published', coalesce(p_publish, false));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_procedure_approve(uuid, boolean, uuid) from public, anon;
grant execute on function public.admin_procedure_approve(uuid, boolean, uuid) to authenticated;

-- Makes an approved version the one readers see (a newer one, or an older one again).
create function public.procedure_publish(p public.procedures, v public.procedure_versions, p_me public.profiles)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.procedure_versions x set
    published_at = coalesce(x.published_at, now()),
    published_by = case when x.published_at is null then p_me.id else x.published_by end,
    published_by_display_id = coalesce(x.published_by_display_id, p_me.display_id)
  where x.id = v.id;
  update public.procedures x set published_version_id = v.id, status = 'published', updated_at = now() where x.id = p.id;
  perform public.staff_audit('publish_procedure', 'procedure', p.id::text,
    jsonb_build_object('status', p.status, 'version', (select y.version from public.procedure_versions y where y.id = p.published_version_id)),
    jsonb_build_object('status', 'published', 'version', v.version, 'title', v.content_ro->>'title'));
end
$$;
revoke execute on function public.procedure_publish(public.procedures, public.procedure_versions, public.profiles) from public, anon, authenticated;

create function public.admin_procedure_publish(p_version_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v public.procedure_versions%rowtype;
  p public.procedures%rowtype;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_procedure_publish');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.procedure_versions x where x.id = p_version_id;
  if v.id is null then
    perform public.fail('procedure_not_found');
  end if;
  select * into p from public.procedures x where x.id = v.procedure_id for update;
  -- Only an approved version is published; the one already shown is not published again.
  if v.status <> 'approved' or (p.status = 'published' and p.published_version_id = v.id) then
    perform public.fail('wrong_status');
  end if;
  perform public.procedure_publish(p, v, v_me);
  v_result := jsonb_build_object('id', p.id, 'version_id', v.id, 'version', v.version, 'status', 'published');
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_procedure_publish(uuid, uuid) from public, anon;
grant execute on function public.admin_procedure_publish(uuid, uuid) to authenticated;

-- The settings of a procedure at any time: category, kind, who reads it, critical, request categories.
-- They are not part of a version (a change is in the audit log); making it critical asks every reader
-- for „Am citit” on the version shown.
create function public.admin_procedure_set_settings(p_id uuid, p_procedure jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  p public.procedures%rowtype;
  v public.procedures;
  v_result jsonb;
  v_keys text[] := array['category', 'kind', 'visibility', 'critical', 'support_categories'];
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_procedure_set_settings');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into p from public.procedures x where x.id = p_id for update;
  if p.id is null then
    perform public.fail('procedure_not_found');
  end if;
  v := public.procedure_meta_checked(p_procedure, p, true);
  if (v.category, v.kind, v.visibility, v.critical, v.support_categories)
     is distinct from (p.category, p.kind, p.visibility, p.critical, p.support_categories) then
    update public.procedures x set category = v.category, kind = v.kind, visibility = v.visibility, critical = v.critical,
      support_categories = v.support_categories, updated_at = now()
    where x.id = p.id;
    perform public.staff_audit('update_procedure_settings', 'procedure', p.id::text,
      public.jsonb_changes(to_jsonb(p), to_jsonb(v), v_keys)->'before',
      public.jsonb_changes(to_jsonb(p), to_jsonb(v), v_keys)->'after');
  end if;
  v_result := jsonb_build_object('id', p.id, 'category', v.category, 'kind', v.kind, 'visibility', v.visibility,
    'critical', v.critical, 'support_categories', to_jsonb(v.support_categories));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_procedure_set_settings(uuid, jsonb, uuid) from public, anon;
grant execute on function public.admin_procedure_set_settings(uuid, jsonb, uuid) to authenticated;

-- Archives a procedure (agents stop seeing it; every version stays) or brings it back.
create function public.admin_procedure_archive(p_id uuid, p_archived boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  p public.procedures%rowtype;
  v_status text;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_procedure_archive');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_archived is null then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_archived'));
  end if;
  select * into p from public.procedures x where x.id = p_id for update;
  if p.id is null then
    perform public.fail('procedure_not_found');
  end if;
  if p_archived = (p.status = 'archived') then
    perform public.fail('wrong_status');
  end if;
  v_status := case when p_archived then 'archived' when p.published_version_id is not null then 'published' else 'draft' end;
  update public.procedures x set status = v_status, updated_at = now() where x.id = p.id;
  perform public.staff_audit(case when p_archived then 'archive_procedure' else 'restore_procedure' end, 'procedure', p.id::text,
    jsonb_build_object('status', p.status), jsonb_build_object('status', v_status));
  v_result := jsonb_build_object('id', p.id, 'status', v_status);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_procedure_archive(uuid, boolean, uuid) from public, anon;
grant execute on function public.admin_procedure_archive(uuid, boolean, uuid) to authenticated;

-- Who confirmed the version shown of a critical procedure, and who did not yet.
create function public.admin_procedure_acknowledgements(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.procedures%rowtype;
  v public.procedure_versions%rowtype;
begin
  perform public.require_admin();
  select * into p from public.procedures x where x.id = p_id;
  if p.id is null then
    perform public.fail('procedure_not_found');
  end if;
  select * into v from public.procedure_versions x where x.id = p.published_version_id;
  return jsonb_build_object(
    'id', p.id, 'critical', p.critical, 'version', v.version, 'version_id', v.id, 'published_at', v.published_at,
    'people', case when p.critical and v.id is not null then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'display_id', r.display_id, 'name', r.name, 'role', r.role,
                                          'acknowledged_at', a.acknowledged_at)
                       order by a.acknowledged_at is not null, r.role desc, r.display_id)
      from public.procedure_readers(p) r
      left join public.procedure_acknowledgements a on a.version_id = v.id and a.user_id = r.id), '[]'::jsonb)
    else '[]'::jsonb end);
end
$$;
revoke execute on function public.admin_procedure_acknowledgements(uuid) from public, anon;
grant execute on function public.admin_procedure_acknowledgements(uuid) to authenticated;

-- Names the responsible of a category (an active agent or admin), or removes it (p_user null). Never
-- given to someone else on its own.
create function public.admin_procedure_set_responsible(p_category text, p_user uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_user public.profiles%rowtype;
  v_old public.procedure_responsibilities%rowtype;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_procedure_set_responsible');
  if v_seen is not null then
    return v_seen;
  end if;
  if not public.procedure_category_ok(p_category) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'proc_category'));
  end if;
  select * into v_old from public.procedure_responsibilities r where r.category = p_category for update;
  if p_user is null then
    if v_old.category is null then
      perform public.fail('wrong_status');
    end if;
    delete from public.procedure_responsibilities r where r.category = p_category;
  else
    select * into v_user from public.profiles x where x.id = p_user;
    if v_user.id is null or v_user.role not in ('support', 'admin') or v_user.suspended or v_user.deleted_at is not null then
      perform public.fail('assignee_invalid');
    end if;
    insert into public.procedure_responsibilities (category, user_id, user_display_id, assigned_by, assigned_by_display_id, assigned_at)
    values (p_category, v_user.id, v_user.display_id, v_me.id, v_me.display_id, now())
    on conflict (category) do update set user_id = excluded.user_id, user_display_id = excluded.user_display_id,
      assigned_by = excluded.assigned_by, assigned_by_display_id = excluded.assigned_by_display_id, assigned_at = excluded.assigned_at;
  end if;
  perform public.staff_audit('set_procedure_responsible', 'procedure_category', p_category,
    case when v_old.category is not null then jsonb_build_object('responsible', v_old.user_display_id) end,
    case when p_user is not null then jsonb_build_object('responsible', v_user.display_id) end);
  v_result := jsonb_build_object('category', p_category, 'responsible', public.procedure_responsible_json(p_category));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_procedure_set_responsible(text, uuid, uuid) from public, anon;
grant execute on function public.admin_procedure_set_responsible(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Audit classes (A3c2b2): the procedures are administrative documents (3 years, to validate).
-- ---------------------------------------------------------------------------------------------
insert into public.audit_action_classes (action, class, strip_keys) values
  ('create_procedure', 'admin', '{}'),
  ('save_procedure_draft', 'admin', '{}'),
  ('new_procedure_version', 'admin', '{}'),
  ('submit_procedure', 'admin', '{}'),
  ('return_procedure_draft', 'admin', '{}'),
  ('discard_procedure_draft', 'admin', '{}'),
  ('approve_procedure', 'admin', '{}'),
  ('publish_procedure', 'admin', '{}'),
  ('update_procedure_settings', 'admin', '{}'),
  ('archive_procedure', 'admin', '{}'),
  ('restore_procedure', 'admin', '{}'),
  ('acknowledge_procedure', 'admin', '{}'),
  ('set_procedure_responsible', 'admin', '{}');

-- ---------------------------------------------------------------------------------------------
-- The first content: drafts („Necesită aprobare”), checked against the app on 12 Nov 2026. Nothing is
-- published by the migration: an admin reads, completes and approves each one.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.proc(p_category text, p_kind text, p_critical boolean, p_support text[], p_ro jsonb, p_en jsonb)
returns void language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.procedures (category, kind, visibility, critical, support_categories)
  values (p_category, p_kind, 'support', p_critical, p_support)
  returning id into v_id;
  insert into public.procedure_versions (procedure_id, version, content_ro, content_en, seeded)
  values (v_id, 1, public.procedure_content_clean(p_ro), public.procedure_content_clean(p_en), true);
end
$$;

-- 1. Autentificare și acces ---------------------------------------------------------------------
select pg_temp.proc('access', 'usual', false, '{account,technical}',
$ro${
  "title": "Probleme de autentificare",
  "applies_when": "Un client sau un service nu poate intra în cont: parola uitată, emailul de confirmare nu a ajuns, contul apare suspendat sau verificarea în doi pași (doar pentru echipă) nu funcționează.",
  "purpose": "Persoana își recapătă accesul singură, prin pașii aplicației, fără ca echipa să afle sau să schimbe parola ori codurile ei.",
  "steps": [
    "Deschide contul din **Căutare** după ID, emailul exact sau ultimele cifre ale telefonului și verifică starea: activ, suspendat sau șters.",
    "Dacă emailul nu este confirmat, cere persoanei să verifice dosarul Spam și să folosească linkul cel mai recent primit.",
    "Pentru parola uitată, trimite-o la **Autentificare → Ai uitat parola?** și cere-i să folosească linkul din email pe același dispozitiv.",
    "Dacă intră cu Google sau Apple, cere-i să folosească același buton ca la crearea contului.",
    "Notează în nota internă ce s-a verificat și ce i s-a recomandat, fără date de acces."
  ],
  "escalation": "Escaladează când contul este suspendat, când persoana cere schimbarea emailului contului sau când pașii de mai sus nu rezolvă problema.",
  "forbidden": "Nu cere și nu primi parole, coduri din email sau SMS ori coduri din aplicația de autentificare. Nu confirma existența unui cont altcuiva decât titularului.",
  "warnings": "Un mesaj care cere urgent acces la contul altei persoane este tratat după procedura **Cont compromis**."
}$ro$,
$en${
  "title": "Sign-in problems",
  "applies_when": "A client or a shop cannot get into the account: forgotten password, the confirmation email did not arrive, the account shows as suspended, or two-step verification (team only) does not work.",
  "purpose": "The person regains access on their own, through the app's steps, without the team learning or changing their password or codes.",
  "steps": [
    "Open the account from **Search** by ID, exact email or the last digits of the phone and check its state: active, suspended or deleted.",
    "If the email is not confirmed, ask the person to check the Spam folder and to use the most recent link received.",
    "For a forgotten password, send them to **Sign in → Forgot password?** and ask them to use the email link on the same device.",
    "If they sign in with Google or Apple, ask them to use the same button as when the account was created.",
    "Record in the internal note what was checked and what was recommended, without any access data."
  ],
  "escalation": "Escalate when the account is suspended, when the person asks to change the account's email, or when the steps above do not solve the problem.",
  "forbidden": "Never ask for or accept passwords, codes from email or SMS, or authenticator app codes. Never confirm that an account exists to anyone but its holder.",
  "warnings": "A message urgently asking for access to another person's account follows the **Compromised account** procedure."
}$en$);

-- 2. Probleme de cont ----------------------------------------------------------------------------
select pg_temp.proc('accounts', 'usual', false, '{account}',
$ro${
  "title": "Modificarea datelor contului",
  "applies_when": "O persoană cere schimbarea numelui, a telefonului, a limbii, a tipului de cont sau a altor date din cont.",
  "purpose": "Datele contului sunt schimbate de titular, din aplicație; echipa explică unde și cum, fără să modifice datele în locul lui.",
  "responsibilities": "Agentul îndrumă persoana. Administratorul confirmă manual un număr de telefon, doar la cererea titularului, când codul prin SMS nu poate fi primit.",
  "steps": [
    "Verifică în **Căutare** că solicitarea vine din contul despre care este vorba.",
    "Numele, limba și telefonul se schimbă din **Cont**; un telefon nou se confirmă cu codul primit prin SMS.",
    "Tipul contului (client sau service) se alege o singură dată, la creare, și nu se schimbă; o persoană care vrea și cont de service își face un cont nou cu alt email.",
    "Pentru datele service-ului (adresă, program, servicii), proprietarul folosește **Cont → Setări**.",
    "Răspunde cu calea exactă din aplicație și închide solicitarea după confirmarea persoanei."
  ],
  "escalation": "Escaladează cererile de confirmare manuală a telefonului și orice cerere care privește datele fiscale ale unui service.",
  "forbidden": "Nu schimba date pentru o persoană care scrie din alt cont sau de pe alt email decât cel al contului."
}$ro$,
$en${
  "title": "Changing account details",
  "applies_when": "A person asks to change the name, phone, language, account type or other account details.",
  "purpose": "Account details are changed by the holder, in the app; the team explains where and how, without changing the details on their behalf.",
  "responsibilities": "The agent guides the person. The admin confirms a phone number manually, only at the holder's request, when the SMS code cannot be received.",
  "steps": [
    "Check in **Search** that the request comes from the account it is about.",
    "Name, language and phone are changed in **Account**; a new phone is confirmed with the code received by SMS.",
    "The account type (client or shop) is chosen once, at sign-up, and does not change; a person who also wants a shop account creates a new account with another email.",
    "For the shop's details (address, hours, services), the owner uses **Account → Settings**.",
    "Answer with the exact path in the app and close the request once the person confirms."
  ],
  "escalation": "Escalate requests to confirm a phone manually and any request about a shop's fiscal data.",
  "forbidden": "Never change details for a person writing from another account or from an email other than the account's."
}$en$);

-- 3. Programări ----------------------------------------------------------------------------------
select pg_temp.proc('bookings', 'usual', false, '{bookings}',
$ro${
  "title": "Probleme cu o programare",
  "applies_when": "Un client sau un service scrie despre o programare: nu o găsește, vrea să o mute sau să o anuleze, nu primește răspuns de la cealaltă parte ori starea nu corespunde realității.",
  "purpose": "Persoana află ce poate face ea în aplicație, iar programarea rămâne schimbată doar de client, de service sau, în cazurile prevăzute, de administrator.",
  "steps": [
    "Citește referința programării din solicitare: codul, ziua, service-ul și starea.",
    "Clientul anulează sau mută programarea din **Programări**, în limitele afișate acolo; service-ul confirmă, refuză sau mută din **Programări** al service-ului.",
    "Pentru întrebări despre lucrare sau deviz, îndrumă persoana spre **Mesaje**, conversația cu cealaltă parte.",
    "Dacă cealaltă parte nu răspunde, explică opțiunile din aplicație și notează data și ora în nota internă.",
    "Închide solicitarea după ce persoana confirmă că situația s-a rezolvat."
  ],
  "deadlines": "Limitele de anulare și de programare sunt cele afișate în aplicație pentru fiecare programare; nu se promit excepții.",
  "escalation": "Escaladează când programarea trebuie anulată de platformă (de exemplu un service care nu mai funcționează) sau când starea afișată pare greșită.",
  "forbidden": "Nu promite despăgubiri, reduceri sau o anumită decizie a service-ului. Nu cere detalii despre mesajele private dintre client și service."
}$ro$,
$en${
  "title": "Problems with a booking",
  "applies_when": "A client or a shop writes about a booking: they cannot find it, want to move or cancel it, get no answer from the other side, or its state does not match reality.",
  "purpose": "The person learns what they can do in the app, and the booking is changed only by the client, by the shop or, in the cases provided, by the admin.",
  "steps": [
    "Read the booking reference in the request: code, day, shop and state.",
    "The client cancels or moves the booking from **Bookings**, within the limits shown there; the shop confirms, declines or moves it from the shop's **Bookings**.",
    "For questions about the work or the quote, point the person to **Messages**, the conversation with the other side.",
    "If the other side does not answer, explain the options in the app and record the date and time in the internal note.",
    "Close the request once the person confirms the situation is solved."
  ],
  "deadlines": "The cancellation and booking limits are those shown in the app for each booking; no exceptions are promised.",
  "escalation": "Escalate when the booking must be canceled by the platform (for example a shop that no longer operates) or when the state shown seems wrong.",
  "forbidden": "Never promise compensation, discounts or a given decision by the shop. Never ask for details of the private messages between client and shop."
}$en$);

-- 4. Reclamații ----------------------------------------------------------------------------------
select pg_temp.proc('complaints', 'usual', false, '{shops,bookings}',
$ro${
  "title": "Reclamații despre un service",
  "applies_when": "Un client se plânge de calitatea lucrării, de preț, de comportamentul personalului sau de o recenzie.",
  "purpose": "Reclamația este înregistrată complet și neutru, iar deciziile care țin de platformă (recenzii, suspendări) rămân ale administratorului.",
  "steps": [
    "Mulțumește pentru mesaj și cere, dacă lipsesc, codul programării, data și o descriere a problemei.",
    "Cere documentele relevante (deviz, factură, fotografii) ca fișiere atașate la solicitare.",
    "Explică faptul că lucrarea și prețul sunt stabilite între client și service și că devizul aprobat apare în istoricul programării.",
    "Pentru o recenzie, clientul o scrie din programarea încheiată; service-ul poate răspunde sau o poate raporta.",
    "Rezumă faptele în nota internă, fără aprecieri despre persoane."
  ],
  "escalation": "Escaladează reclamațiile care pot duce la suspendarea unui service, recenziile raportate ca false și orice reclamație repetată despre același service.",
  "forbidden": "Nu lua partea niciuneia dintre părți, nu promite rambursări și nu comenta calitatea unui service față de alt client."
}$ro$,
$en${
  "title": "Complaints about a shop",
  "applies_when": "A client complains about the quality of the work, the price, the staff's behavior or a review.",
  "purpose": "The complaint is recorded completely and neutrally, and the platform's decisions (reviews, suspensions) stay with the admin.",
  "steps": [
    "Thank the person for the message and ask, if missing, for the booking code, the date and a description of the problem.",
    "Ask for the relevant documents (quote, invoice, photos) as files attached to the request.",
    "Explain that the work and the price are agreed between client and shop and that the approved quote appears in the booking's history.",
    "For a review, the client writes it from the completed booking; the shop can reply to it or report it.",
    "Summarize the facts in the internal note, without opinions about people."
  ],
  "escalation": "Escalate complaints that may lead to a shop's suspension, reviews reported as false, and any repeated complaint about the same shop.",
  "forbidden": "Never take either side, never promise refunds, and never comment on a shop's quality to another client."
}$en$);

-- 5. Dispute între șoferi și service-uri ---------------------------------------------------------
select pg_temp.proc('complaints', 'usual', false, '{bookings,shops}',
$ro${
  "title": "Dispute între șofer și service",
  "applies_when": "Clientul și service-ul nu sunt de acord: neprezentare contestată, deviz neaprobat dar lucrare făcută, mașina ținută în service sau diferențe de preț.",
  "purpose": "Ambele părți sunt ascultate, faptele din aplicație sunt adunate, iar decizia rămâne la administrator sau, după caz, la părți.",
  "steps": [
    "Identifică programarea și citește starea ei, devizul trimis și dacă a fost aprobat.",
    "Cere fiecărei părți, în solicitarea ei, o descriere scurtă și documentele pe care le are.",
    "O neprezentare marcată de service se contestă de client din programare; contestațiile sunt decise de administrator.",
    "Notează în nota internă cronologia: datele, stările programării și ce susține fiecare parte.",
    "Răspunde fiecărei părți doar despre propria solicitare și propriile date."
  ],
  "escalation": "Escaladează orice dispută care cere o decizie: contestații de neprezentare, devize contestate, solicitări de anulare forțată sau amenințări cu acțiuni în instanță.",
  "forbidden": "Nu transmite unei părți datele personale sau mesajele celeilalte. Nu oferi interpretări juridice.",
  "warnings": "Amenințările sau limbajul agresiv urmează procedura **Abuz și limbaj ofensator**."
}$ro$,
$en${
  "title": "Disputes between a driver and a shop",
  "applies_when": "The client and the shop disagree: a contested no-show, work done on a quote that was not approved, the car held at the shop, or price differences.",
  "purpose": "Both sides are heard, the facts in the app are gathered, and the decision stays with the admin or, where relevant, with the parties.",
  "steps": [
    "Identify the booking and read its state, the quote sent and whether it was approved.",
    "Ask each side, in its own request, for a short description and the documents it has.",
    "A no-show marked by the shop is contested by the client from the booking; disputes are decided by the admin.",
    "Record the timeline in the internal note: dates, booking states and what each side claims.",
    "Answer each side only about its own request and its own data."
  ],
  "escalation": "Escalate any dispute that needs a decision: contested no-shows, disputed quotes, requests for a forced cancellation, or threats of court action.",
  "forbidden": "Never pass one side's personal data or messages to the other. Never give legal interpretations.",
  "warnings": "Threats or aggressive language follow the **Abuse and offensive language** procedure."
}$en$);

-- 6. Abonamente și facturare ---------------------------------------------------------------------
select pg_temp.proc('billing', 'usual', false, '{subscriptions,companies}',
$ro${
  "title": "Abonamente și facturare",
  "applies_when": "Un service sau o firmă întreabă despre abonament, perioada gratuită, plăți, facturi sau datele de facturare.",
  "purpose": "Persoana află unde găsește informațiile în aplicație; orice schimbare de abonament, plată sau factură este făcută de administrator.",
  "responsibilities": "Agentul nu are acces la plăți, facturi sau date fiscale. Administratorul verifică și decide.",
  "steps": [
    "Proprietarul service-ului vede abonamentul, perioada gratuită și plățile în **Cont → Abonament**.",
    "Prețul și condițiile se citesc din aplicație și din Termeni; nu se comunică alte valori.",
    "Pentru o plată eșuată, cere-i proprietarului să verifice cardul în pagina de plată deschisă din **Abonament**.",
    "Pentru o factură greșită sau lipsă, cere codul service-ului și perioada, apoi escaladează.",
    "Notează în nota internă ce a cerut persoana, fără date de card."
  ],
  "escalation": "Escaladează orice cerere de rambursare, prelungire a perioadei gratuite, schimbare de preț, corectare de factură sau date fiscale.",
  "forbidden": "Nu cere și nu primi date de card. Nu promite prelungiri, reduceri sau rambursări.",
  "warnings": "Prețurile și condițiile comerciale se confirmă cu administratorul înainte de a fi citate într-un răspuns."
}$ro$,
$en${
  "title": "Subscriptions and billing",
  "applies_when": "A shop or a company asks about the subscription, the free period, payments, invoices or billing details.",
  "purpose": "The person learns where to find the information in the app; any change to a subscription, payment or invoice is made by the admin.",
  "responsibilities": "The agent has no access to payments, invoices or fiscal data. The admin checks and decides.",
  "steps": [
    "The shop owner sees the subscription, the free period and the payments in **Account → Subscription**.",
    "The price and terms are read from the app and the Terms; no other figures are given.",
    "For a failed payment, ask the owner to check the card on the payment page opened from **Subscription**.",
    "For a wrong or missing invoice, ask for the shop's code and the period, then escalate.",
    "Record in the internal note what the person asked, without card data."
  ],
  "escalation": "Escalate any request for a refund, an extended free period, a price change, an invoice correction or fiscal data.",
  "forbidden": "Never ask for or accept card data. Never promise extensions, discounts or refunds.",
  "warnings": "Prices and commercial terms are confirmed with the admin before being quoted in an answer."
}$en$);

-- 7. Erori tehnice -------------------------------------------------------------------------------
select pg_temp.proc('technical', 'usual', false, '{technical}',
$ro${
  "title": "Raportarea unei erori tehnice",
  "applies_when": "O persoană semnalează că un ecran nu se încarcă, un buton nu funcționează, apare un mesaj de eroare sau aplicația se închide.",
  "purpose": "Eroarea este descrisă suficient de clar încât să poată fi reprodusă și reparată, iar persoana primește o soluție provizorie când există.",
  "steps": [
    "Cere ce dispozitiv folosește (telefon sau calculator), browserul sau aplicația Android și ora aproximativă a erorii.",
    "Cere pașii exacți făcuți înainte de eroare și textul mesajului afișat; o captură de ecran se atașează la solicitare.",
    "Recomandă reîncărcarea paginii sau actualizarea aplicației și verificarea conexiunii la internet.",
    "Încearcă aceiași pași în contul tău, fără să folosești contul persoanei.",
    "Scrie în nota internă: dispozitiv, pași, mesaj, ora și dacă eroarea se reproduce."
  ],
  "escalation": "Escaladează dacă eroarea se reproduce, dacă blochează o programare, un deviz sau o plată, ori dacă mai multe persoane raportează același lucru.",
  "forbidden": "Nu cere persoanei parola sau accesul la cont pentru a reproduce eroarea.",
  "warnings": "Dacă aceeași funcție nu merge pentru mai multe persoane, urmează procedura **Indisponibilitatea unei funcții importante**."
}$ro$,
$en${
  "title": "Reporting a technical error",
  "applies_when": "A person reports that a screen does not load, a button does not work, an error message appears or the app closes.",
  "purpose": "The error is described clearly enough to be reproduced and fixed, and the person gets a workaround when one exists.",
  "steps": [
    "Ask which device they use (phone or computer), the browser or the Android app, and the approximate time of the error.",
    "Ask for the exact steps taken before the error and the text of the message shown; a screenshot is attached to the request.",
    "Recommend reloading the page or updating the app, and checking the internet connection.",
    "Try the same steps in your own account, without using the person's account.",
    "Write in the internal note: device, steps, message, time and whether the error can be reproduced."
  ],
  "escalation": "Escalate if the error can be reproduced, if it blocks a booking, a quote or a payment, or if several people report the same thing.",
  "forbidden": "Never ask the person for their password or account access to reproduce the error.",
  "warnings": "If the same feature fails for several people, follow the **Important feature unavailable** procedure."
}$en$);

-- 8. Notificări ----------------------------------------------------------------------------------
select pg_temp.proc('notifications', 'usual', false, '{notifications}',
$ro${
  "title": "Notificări care nu ajung",
  "applies_when": "O persoană nu primește notificări în aplicație, pe email sau prin SMS ori primește prea multe.",
  "purpose": "Persoana își verifică singură setările de notificări și permisiunile dispozitivului; problemele reale ale trimiterii ajung la administrator.",
  "steps": [
    "Întreabă ce notificare lipsește (de exemplu confirmarea unei programări sau un deviz) și pe ce canal o aștepta.",
    "Pentru notificările pe telefon, cere-i să verifice permisiunea de notificări a aplicației sau a browserului și setările din **Cont**.",
    "Pentru email, cere-i să verifice dosarele Spam și Promoții și să confirme adresa din **Cont**.",
    "Pentru prea multe notificări, arată-i opțiunile din **Cont**, unde fiecare tip se poate opri.",
    "Notează canalul, tipul notificării și ora la care era așteptată."
  ],
  "escalation": "Escaladează când setările sunt corecte și notificarea tot nu ajunge sau când mai multe persoane raportează același canal.",
  "forbidden": "Nu promite retrimiterea unei notificări și nu trimite mesaje în numele platformei din afara aplicației."
}$ro$,
$en${
  "title": "Notifications that do not arrive",
  "applies_when": "A person does not receive notifications in the app, by email or by SMS, or receives too many.",
  "purpose": "The person checks their own notification settings and device permissions; real sending problems reach the admin.",
  "steps": [
    "Ask which notification is missing (for example a booking confirmation or a quote) and on which channel it was expected.",
    "For phone notifications, ask them to check the app's or browser's notification permission and the settings in **Account**.",
    "For email, ask them to check the Spam and Promotions folders and to confirm the address in **Account**.",
    "For too many notifications, show them the options in **Account**, where each type can be turned off.",
    "Record the channel, the type of notification and the time it was expected."
  ],
  "escalation": "Escalate when the settings are correct and the notification still does not arrive, or when several people report the same channel.",
  "forbidden": "Never promise to resend a notification and never send messages on the platform's behalf from outside the app."
}$en$);

-- 9. Date personale ------------------------------------------------------------------------------
select pg_temp.proc('personal_data', 'usual', false, '{account}',
$ro${
  "title": "Cereri de export, modificare sau ștergere a datelor",
  "applies_when": "O persoană cere o copie a datelor sale, corectarea lor sau ștergerea contului ori a unor date.",
  "purpose": "Cererea este îndeplinită prin funcțiile aplicației, de titularul contului, iar cererile care nu se pot face din aplicație ajung la administrator.",
  "steps": [
    "Verifică că cererea vine din contul despre care este vorba; o cerere pentru contul altei persoane nu se îndeplinește.",
    "Copia datelor se descarcă din **Cont → Datele mele**.",
    "Datele greșite se corectează din **Cont**; pentru ce nu se poate corecta acolo, notează exact ce trebuie schimbat.",
    "Contul se șterge din **Cont → Șterge contul**; pentru un service, doar proprietarul poate șterge contul.",
    "Răspunde cu pașii exacți și păstrează solicitarea deschisă până la confirmarea persoanei."
  ],
  "deadlines": "Termenul de răspuns pentru cererile privind datele personale se confirmă cu administratorul.",
  "escalation": "Escaladează imediat cererile primite în afara aplicației, cererile despre datele altei persoane, cererile din partea unei autorități și orice cerere pe care titularul nu o poate face singur din aplicație.",
  "forbidden": "Nu trimite date personale pe email sau în mesaj. Nu șterge și nu modifica date în locul titularului.",
  "warnings": "Unele date se păstrează după ștergerea contului când există o obligație legală sau o păstrare legală; explicațiile se dau doar după confirmarea administratorului."
}$ro$,
$en${
  "title": "Requests to export, correct or delete data",
  "applies_when": "A person asks for a copy of their data, for it to be corrected, or for the account or some data to be deleted.",
  "purpose": "The request is fulfilled through the app's features, by the account holder, and requests that cannot be made in the app reach the admin.",
  "steps": [
    "Check that the request comes from the account it is about; a request about another person's account is not fulfilled.",
    "The copy of the data is downloaded from **Account → My data**.",
    "Wrong details are corrected in **Account**; for anything that cannot be corrected there, record exactly what must change.",
    "The account is deleted from **Account → Delete account**; for a shop, only the owner can delete the account.",
    "Answer with the exact steps and keep the request open until the person confirms."
  ],
  "deadlines": "The response time for personal data requests is confirmed with the admin.",
  "escalation": "Escalate at once requests received outside the app, requests about another person's data, requests from an authority, and any request the holder cannot make in the app.",
  "forbidden": "Never send personal data by email or in a message. Never delete or change data on the holder's behalf.",
  "warnings": "Some data is kept after the account is deleted when there is a legal obligation or a legal hold; explanations are given only after the admin confirms."
}$en$);

-- 10. Escaladare ---------------------------------------------------------------------------------
select pg_temp.proc('escalation', 'usual', false, '{technical,account,bookings,vehicles,shops,companies,subscriptions,notifications}',
$ro${
  "title": "Escaladarea unei solicitări",
  "applies_when": "O solicitare cere o decizie sau o acțiune pe care agentul nu o poate face: suspendări, anulări forțate, plăți, date fiscale, dispute, incidente.",
  "purpose": "Solicitarea ajunge la administrator cu tot contextul, o singură dată, iar persoana nu primește răspunsuri contradictorii.",
  "responsibilities": "Agentul escaladează, cu motiv. Administratorul preia solicitarea, decide și o poate returna agentului, tot cu motiv.",
  "steps": [
    "Completează nota internă cu faptele verificate și cu ce s-a răspuns deja persoanei.",
    "Apasă **Escaladează** în solicitare și scrie motivul: ce decizie se cere și de ce.",
    "După escaladare, solicitarea este a administratorului; agentul o poate citi, dar nu o mai modifică.",
    "Dacă persoana scrie din nou, răspunsul îl dă administratorul; agentul nu trimite răspunsuri paralele.",
    "Când administratorul returnează solicitarea, continuă de la motivul scris la returnare."
  ],
  "escalation": "Escaladarea are un singur nivel: de la agent la administrator. Nu există termene automate.",
  "forbidden": "Nu escalada fără motiv scris și nu promite persoanei o anumită decizie sau un anumit termen."
}$ro$,
$en${
  "title": "Escalating a request",
  "applies_when": "A request needs a decision or an action the agent cannot take: suspensions, forced cancellations, payments, fiscal data, disputes, incidents.",
  "purpose": "The request reaches the admin with all its context, once, and the person does not get contradicting answers.",
  "responsibilities": "The agent escalates, with a reason. The admin takes the request, decides, and can give it back to the agent, also with a reason.",
  "steps": [
    "Complete the internal note with the facts checked and what was already answered to the person.",
    "Press **Escalate** in the request and write the reason: which decision is needed and why.",
    "After escalation, the request is the admin's; the agent can read it but no longer changes it.",
    "If the person writes again, the admin answers; the agent sends no parallel answers.",
    "When the admin gives the request back, continue from the reason written when it was returned."
  ],
  "escalation": "Escalation has a single level: from the agent to the admin. There are no automatic deadlines.",
  "forbidden": "Never escalate without a written reason and never promise the person a given decision or deadline."
}$en$);

-- 11. Conturi compromise (excepțională, critică) -------------------------------------------------
select pg_temp.proc('security', 'exceptional', true, '{account}',
$ro${
  "title": "Cont compromis",
  "applies_when": "Titularul spune că altcineva a intrat în contul lui, vede programări, mesaje sau modificări pe care nu le-a făcut, ori a primit emailuri de schimbare a parolei pe care nu le-a cerut.",
  "purpose": "Accesul străin este oprit cât mai repede, de titular și de administrator, fără ca echipa să devină o cale prin care se obține acces la cont.",
  "responsibilities": "Agentul îndrumă titularul și escaladează imediat. Administratorul decide suspendarea contului, care închide toate sesiunile.",
  "steps": [
    "Verifică în **Căutare** că solicitarea vine din contul afectat; dacă vine din alt cont sau de pe alt email, nu confirma nimic despre cont.",
    "Cere titularului să schimbe imediat parola din **Autentificare → Ai uitat parola?** și să schimbe și parola emailului.",
    "Cere o descriere a ce a observat: ce s-a schimbat, când și de pe ce dispozitive, fără parole sau coduri.",
    "Escaladează imediat, cu motivul „Cont compromis” și rezumatul faptelor.",
    "Nu închide solicitarea până când administratorul nu confirmă că situația este rezolvată."
  ],
  "deadlines": "Escaladarea se face în aceeași zi în care este primită solicitarea, cât mai repede.",
  "escalation": "Întotdeauna, imediat după pașii de mai sus.",
  "forbidden": "Nu cere și nu primi parole sau coduri. Nu schimba emailul sau telefonul contului la cererea cuiva. Nu confirma existența contului altcuiva decât titularului.",
  "warnings": "Cineva care cere acces urgent la contul altei persoane, chiar pretinzând că este titularul, poate încerca exact preluarea contului."
}$ro$,
$en${
  "title": "Compromised account",
  "applies_when": "The holder says someone else got into their account, sees bookings, messages or changes they did not make, or received password change emails they did not request.",
  "purpose": "The outside access is stopped as soon as possible, by the holder and the admin, without the team becoming a way to gain access to the account.",
  "responsibilities": "The agent guides the holder and escalates at once. The admin decides the account's suspension, which ends all its sessions.",
  "steps": [
    "Check in **Search** that the request comes from the affected account; if it comes from another account or another email, confirm nothing about the account.",
    "Ask the holder to change the password at once from **Sign in → Forgot password?** and to change their email password as well.",
    "Ask for a description of what they noticed: what changed, when and from which devices, without passwords or codes.",
    "Escalate at once, with the reason “Compromised account” and the summary of the facts.",
    "Do not close the request until the admin confirms the situation is solved."
  ],
  "deadlines": "Escalation happens on the same day the request is received, as soon as possible.",
  "escalation": "Always, right after the steps above.",
  "forbidden": "Never ask for or accept passwords or codes. Never change the account's email or phone at anyone's request. Never confirm that an account exists to anyone but its holder.",
  "warnings": "Someone urgently asking for access to another person's account, even claiming to be the holder, may be attempting exactly that takeover."
}$en$);

-- 12. Suspiciuni de fraudă (excepțională, critică) -----------------------------------------------
select pg_temp.proc('fraud', 'exceptional', true, '{bookings,shops,account}',
$ro${
  "title": "Suspiciune de fraudă",
  "applies_when": "Apar semne de fraudă: recenzii false, programări fictive repetate, un service care se dă drept altul, cereri de plată în afara aplicației sau conturi multiple folosite de aceeași persoană.",
  "purpose": "Suspiciunea ajunge la administrator documentată, fără ca persoana suspectată să fie avertizată și fără acuzații nefondate.",
  "steps": [
    "Adună faptele din aplicație: codurile programărilor, ID-urile conturilor implicate, datele și ce a observat persoana care a semnalat.",
    "Cere fișierele relevante (capturi de ecran, mesaje primite în afara aplicației) ca atașamente la solicitare.",
    "Scrie în nota internă doar fapte, fără concluzii despre intenția cuiva.",
    "Escaladează imediat, cu motivul „Suspiciune de fraudă”.",
    "Răspunde persoanei care a semnalat că informația a fost primită și este verificată, fără detalii despre celălalt cont."
  ],
  "escalation": "Întotdeauna. Decizia (verificări, suspendare, eliminarea recenziilor) aparține administratorului.",
  "forbidden": "Nu contacta persoana suspectată, nu o avertiza și nu discuta suspiciunea cu alți clienți sau service-uri. Nu cere plăți și nu confirma plăți făcute în afara aplicației.",
  "warnings": "O cerere de plată în afara aplicației, trimisă în numele Service-Hub, se tratează și ca posibil incident de securitate."
}$ro$,
$en${
  "title": "Suspected fraud",
  "applies_when": "Signs of fraud appear: fake reviews, repeated fictitious bookings, a shop pretending to be another, payment requests outside the app, or several accounts used by the same person.",
  "purpose": "The suspicion reaches the admin documented, without the suspected person being warned and without unfounded accusations.",
  "steps": [
    "Gather the facts from the app: booking codes, IDs of the accounts involved, dates, and what the reporting person noticed.",
    "Ask for the relevant files (screenshots, messages received outside the app) as attachments to the request.",
    "Write only facts in the internal note, without conclusions about anyone's intent.",
    "Escalate at once, with the reason “Suspected fraud”.",
    "Tell the reporting person that the information was received and is being checked, without details about the other account."
  ],
  "escalation": "Always. The decision (checks, suspension, removing reviews) belongs to the admin.",
  "forbidden": "Never contact or warn the suspected person, and never discuss the suspicion with other clients or shops. Never ask for payments or confirm payments made outside the app.",
  "warnings": "A payment request outside the app, sent in Service-Hub's name, is also handled as a possible security incident."
}$en$);

-- 13. Abuzuri ------------------------------------------------------------------------------------
select pg_temp.proc('fraud', 'exceptional', false, '{technical,account,bookings,shops,companies,subscriptions,notifications,vehicles}',
$ro${
  "title": "Abuz și limbaj ofensator",
  "applies_when": "O persoană folosește insulte, amenințări sau limbaj discriminatoriu față de echipă, de un service sau de un client, ori trimite mesaje repetate fără legătură cu solicitarea.",
  "purpose": "Echipa rămâne profesionistă, faptele sunt păstrate, iar măsurile asupra contului sunt decise de administrator.",
  "steps": [
    "Răspunde o singură dată, neutru, la partea concretă a solicitării, fără a comenta tonul.",
    "Nu răspunde la mesajele care conțin doar insulte sau amenințări.",
    "Scrie în nota internă data și ora mesajelor, fără a copia insultele.",
    "Escaladează, cu motivul „Abuz”, când comportamentul continuă după răspunsul neutru."
  ],
  "escalation": "Escaladează imediat orice amenințare cu violență sau orice mesaj care pune pe cineva în pericol; în celelalte cazuri, după răspunsul neutru.",
  "forbidden": "Nu răspunde în același ton, nu amenința cu suspendarea și nu închide solicitarea doar din cauza tonului.",
  "warnings": "O amenințare cu un pericol iminent pentru o persoană se semnalează imediat administratorului, pe lângă escaladarea din aplicație."
}$ro$,
$en${
  "title": "Abuse and offensive language",
  "applies_when": "A person uses insults, threats or discriminatory language toward the team, a shop or a client, or sends repeated messages unrelated to the request.",
  "purpose": "The team stays professional, the facts are kept, and measures on the account are decided by the admin.",
  "steps": [
    "Answer once, neutrally, to the concrete part of the request, without commenting on the tone.",
    "Do not answer messages that contain only insults or threats.",
    "Record the date and time of the messages in the internal note, without copying the insults.",
    "Escalate, with the reason “Abuse”, when the behavior continues after the neutral answer."
  ],
  "escalation": "Escalate at once any threat of violence or any message that puts someone in danger; in other cases, after the neutral answer.",
  "forbidden": "Never answer in the same tone, never threaten suspension, and never close the request only because of its tone.",
  "warnings": "A threat of imminent danger to a person is reported to the admin at once, in addition to the escalation in the app."
}$en$);

-- 14. Incidente de securitate (excepțională, critică) -------------------------------------------
select pg_temp.proc('security', 'exceptional', true, '{technical,account}',
$ro${
  "title": "Incident de securitate",
  "applies_when": "Cineva semnalează o vulnerabilitate, un acces neautorizat la date, mesaje de tip phishing în numele Service-Hub sau un comportament al aplicației care expune informații.",
  "purpose": "Incidentul ajunge imediat la administrator, cu informațiile necesare, fără ca echipa să agraveze situația sau să răspândească detaliile.",
  "responsibilities": "Agentul înregistrează și escaladează. Administratorul evaluează incidentul și decide măsurile, inclusiv eventualele notificări către persoane sau autorități.",
  "steps": [
    "Mulțumește persoanei și cere o descriere: ce a observat, unde în aplicație, când și cum se poate verifica.",
    "Cere ca detaliile tehnice să fie trimise doar în solicitare, nu pe alte canale.",
    "Escaladează imediat, cu motivul „Incident de securitate”.",
    "Scrie în nota internă ce s-a raportat, fără a copia date personale, parole sau chei.",
    "Răspunde persoanei că raportul a fost primit și este analizat."
  ],
  "deadlines": "Escaladarea se face imediat după primire. Termenele pentru eventualele notificări sunt stabilite de administrator.",
  "escalation": "Întotdeauna, imediat.",
  "forbidden": "Nu testa vulnerabilitatea pe conturi reale și nu încerca să o reproduci. Nu discuta incidentul cu alte persoane din afara echipei și nu confirma public detalii.",
  "warnings": "Dacă raportul conține o parolă, o cheie sau date personale, nu le copia în notă; menționează doar că au fost primite."
}$ro$,
$en${
  "title": "Security incident",
  "applies_when": "Someone reports a vulnerability, unauthorized access to data, phishing messages in Service-Hub's name, or app behavior that exposes information.",
  "purpose": "The incident reaches the admin at once, with the information needed, without the team making it worse or spreading the details.",
  "responsibilities": "The agent records and escalates. The admin assesses the incident and decides the measures, including any notifications to people or authorities.",
  "steps": [
    "Thank the person and ask for a description: what they noticed, where in the app, when, and how it can be checked.",
    "Ask that technical details be sent only in the request, not on other channels.",
    "Escalate at once, with the reason “Security incident”.",
    "Record in the internal note what was reported, without copying personal data, passwords or keys.",
    "Tell the person the report was received and is being analyzed."
  ],
  "deadlines": "Escalation happens right after receipt. Deadlines for any notifications are set by the admin.",
  "escalation": "Always, at once.",
  "forbidden": "Never test the vulnerability on real accounts or try to reproduce it. Never discuss the incident with people outside the team and never confirm details publicly.",
  "warnings": "If the report contains a password, a key or personal data, do not copy them into the note; only mention that they were received."
}$en$);

-- 15. Expunerea accidentală a datelor (excepțională, critică) -----------------------------------
select pg_temp.proc('security', 'exceptional', true, '{account,technical}',
$ro${
  "title": "Expunerea accidentală a datelor",
  "applies_when": "Date personale au ajuns la cine nu trebuia: un răspuns trimis în solicitarea greșită, un fișier atașat greșit, date vizibile în contul altei persoane.",
  "purpose": "Expunerea este oprită și raportată imediat, iar administratorul are tot ce îi trebuie pentru a evalua consecințele.",
  "responsibilities": "Oricine din echipă observă expunerea o raportează. Administratorul evaluează, păstrează dovezile și decide pașii următori.",
  "steps": [
    "Oprește orice acțiune care ar putea extinde expunerea: nu retrimite, nu redirecționa, nu copia datele.",
    "Notează exact ce date au fost expuse, cui, când și pe ce cale, fără a copia datele în notă.",
    "Escaladează imediat solicitarea în care a avut loc expunerea, cu motivul „Expunere de date”.",
    "Nu contacta persoana care a primit datele și nici persoana ale cărei date au fost expuse până la decizia administratorului.",
    "Păstrează solicitarea neschimbată; administratorul poate plasa o păstrare legală."
  ],
  "deadlines": "Raportarea se face imediat. Termenele legale de notificare se stabilesc de administrator.",
  "escalation": "Întotdeauna, imediat.",
  "forbidden": "Nu șterge mesajele sau fișierele implicate și nu încerca să ascunzi greșeala.",
  "warnings": "Raportarea rapidă a unei greșeli proprii este pasul corect; întârzierea agravează consecințele."
}$ro$,
$en${
  "title": "Accidental data exposure",
  "applies_when": "Personal data reached someone it should not: an answer sent in the wrong request, a wrongly attached file, data visible in another person's account.",
  "purpose": "The exposure is stopped and reported at once, and the admin has everything needed to assess the consequences.",
  "responsibilities": "Anyone on the team who notices the exposure reports it. The admin assesses, keeps the evidence and decides the next steps.",
  "steps": [
    "Stop any action that could widen the exposure: do not resend, forward or copy the data.",
    "Record exactly which data was exposed, to whom, when and by which path, without copying the data into the note.",
    "Escalate at once the request where the exposure happened, with the reason “Data exposure”.",
    "Do not contact the person who received the data or the person whose data was exposed until the admin decides.",
    "Keep the request unchanged; the admin may place a legal hold."
  ],
  "deadlines": "Reporting happens at once. Legal notification deadlines are set by the admin.",
  "escalation": "Always, at once.",
  "forbidden": "Never delete the messages or files involved and never try to hide the mistake.",
  "warnings": "Reporting your own mistake quickly is the right step; delay makes the consequences worse."
}$en$);

-- 16. Indisponibilitatea funcțiilor importante (excepțională, critică) --------------------------
select pg_temp.proc('technical', 'exceptional', true, '{technical,bookings,notifications}',
$ro${
  "title": "Indisponibilitatea unei funcții importante",
  "applies_when": "Mai multe persoane raportează în scurt timp că aceeași funcție importantă nu merge: autentificarea, căutarea, programările, devizele, plățile sau notificările.",
  "purpose": "Problema este semnalată o singură dată, complet, administratorului, iar persoanele afectate primesc același răspuns clar.",
  "steps": [
    "Verifică în contul tău dacă funcția raportată nu merge și notează ora și mesajul afișat.",
    "Alege o singură solicitare reprezentativă și escaladeaz-o, cu motivul „Funcție indisponibilă” și lista celorlalte solicitări.",
    "În celelalte solicitări, notează legătura cu solicitarea escaladată.",
    "Răspunde persoanelor afectate că problema este cunoscută și este în lucru, fără un termen de rezolvare.",
    "După confirmarea administratorului că funcția merge din nou, anunță persoanele și închide solicitările."
  ],
  "escalation": "Întotdeauna, imediat ce cel puțin două persoane raportează aceeași funcție sau ea nu merge nici în contul tău.",
  "forbidden": "Nu promite termene de rezolvare și nu sugera persoanelor soluții care ocolesc aplicația (de exemplu plăți sau programări în afara ei).",
  "warnings": "Dacă indisponibilitatea pare legată de un acces neautorizat, urmează și procedura **Incident de securitate**."
}$ro$,
$en${
  "title": "Important feature unavailable",
  "applies_when": "Several people report within a short time that the same important feature does not work: sign-in, search, bookings, quotes, payments or notifications.",
  "purpose": "The problem is reported once, completely, to the admin, and the affected people get the same clear answer.",
  "steps": [
    "Check in your own account whether the reported feature fails, and record the time and the message shown.",
    "Choose one representative request and escalate it, with the reason “Feature unavailable” and the list of the other requests.",
    "In the other requests, record the link to the escalated request.",
    "Tell the affected people the problem is known and is being worked on, without a resolution time.",
    "Once the admin confirms the feature works again, tell the people and close the requests."
  ],
  "escalation": "Always, as soon as at least two people report the same feature or it also fails in your own account.",
  "forbidden": "Never promise resolution times and never suggest ways around the app (for example payments or bookings outside it).",
  "warnings": "If the outage seems related to unauthorized access, also follow the **Security incident** procedure."
}$en$);

update public.schema_version set version = 118;
