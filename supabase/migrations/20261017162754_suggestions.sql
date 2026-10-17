-- T26 — Sugestii (Eduard, 17 Oct 2026). Clients and shops write ideas from Cont; the admin reads
-- them in Admin → Cont → Sugestii and gives each a state the author sees.
--
-- · submit_suggestion: up to 1,000 characters, at most 5 a day per account (rate_take).
-- · admin_set_suggestion_status: new → planned / done / declined (and back), in the audit log.
-- · The author reads their own rows; nobody writes the table directly.

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_role text not null check (author_role in ('client', 'shop')),
  -- The shop the author worked for when writing (a shop account), for the admin's list.
  shop_id uuid references public.shops (id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suggestions_author_idx on public.suggestions (author_id, created_at desc);
create index suggestions_status_idx on public.suggestions (status, created_at desc);
alter table public.suggestions enable row level security;
revoke all on public.suggestions from public, anon, authenticated;
grant select on public.suggestions to authenticated;
create policy suggestions_own on public.suggestions for select to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Writing one
-- ---------------------------------------------------------------------------------------------
create function public.submit_suggestion(p_body text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v public.suggestions%rowtype;
  v_result jsonb;
begin
  v_me := public.require_caller();
  if v_me.role not in ('client', 'shop') or v_me.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  v_seen := public.request_begin(p_request_id, 'submit_suggestion');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_body = '' then
    perform public.fail('suggestion_empty');
  end if;
  if char_length(v_body) > 1000 then
    perform public.fail('suggestion_too_long', jsonb_build_object('max', 1000));
  end if;
  if not public.rate_take('suggestion', v_me.id, 5, interval '24 hours') then
    perform public.fail('limit_suggestions', jsonb_build_object('limit', 5));
  end if;

  insert into public.suggestions (author_id, author_role, shop_id, body)
  values (v_me.id, v_me.role, case when v_me.role = 'shop' then public.my_shop_id() end, v_body)
  returning * into v;

  v_result := jsonb_build_object('id', v.id, 'status', v.status, 'created_at', v.created_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.submit_suggestion(text, uuid) from public, anon;
grant execute on function public.submit_suggestion(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Admin → Cont → Sugestii
-- ---------------------------------------------------------------------------------------------

-- Every suggestion, newest first, with who wrote it (account ID, name, client or shop and the
-- shop's name) and how many are new.
create function public.admin_list_suggestions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'new', (select count(*) from public.suggestions where status = 'new'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'body', g.body, 'status', g.status, 'role', g.author_role,
        'created_at', g.created_at, 'updated_at', g.updated_at,
        'author_id', g.author_id, 'display_id', p.display_id, 'author_name', p.name,
        'shop_id', g.shop_id, 'shop_name', s.name
      ) order by g.created_at desc)
      from public.suggestions g
      join public.profiles p on p.id = g.author_id
      left join public.shops s on s.id = g.shop_id), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_list_suggestions() from public, anon;
grant execute on function public.admin_list_suggestions() to authenticated;

create function public.admin_set_suggestion_status(p_id uuid, p_status text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_old public.suggestions%rowtype;
  v public.suggestions%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_suggestion_status');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_status is null or p_status not in ('new', 'planned', 'done', 'declined') then
    perform public.fail('status_invalid');
  end if;
  select * into v_old from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('suggestion_not_found');
  end if;
  update public.suggestions set status = p_status, updated_at = now() where id = p_id returning * into v;
  if v.status is distinct from v_old.status then
    perform public.admin_audit('update_suggestion', 'suggestion', v.id,
      jsonb_build_object('suggestion_status', v_old.status), jsonb_build_object('suggestion_status', v.status));
  end if;
  v_result := jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_set_suggestion_status(uuid, text, uuid) from public, anon;
grant execute on function public.admin_set_suggestion_status(uuid, text, uuid) to authenticated;

-- In "Datele mele" (export_my_data): the suggestions written.
alter function public.export_my_data() rename to export_my_data_t37b;
revoke execute on function public.export_my_data_t37b() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_t37b() || jsonb_build_object(
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('text', g.body, 'status', g.status, 'created_at', g.created_at)
        order by g.created_at)
      from public.suggestions g
      where g.author_id = auth.uid()), '[]'::jsonb))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

update public.schema_version set version = 80;
