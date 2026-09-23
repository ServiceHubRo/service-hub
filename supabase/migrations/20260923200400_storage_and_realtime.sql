-- T02 · 5/6 — Storage buckets with their rules, and the Realtime publication. ARCHITECTURE §2 (Storage), §1.

-- ---------------------------------------------------------------------------------------------
-- logos: public read (by URL); upload/replace/delete only by members of that shop, path `shop_id/…`,
-- images up to 2 MB.
-- reports: private; no policies at all — Edge Functions (service role) write them and hand out
-- short-lived signed URLs after checking ownership.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('reports', 'reports', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy logos_select_member on storage.objects for select to authenticated
  using (
    bucket_id = 'logos'
    and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
  );
create policy logos_insert_member on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
  );
create policy logos_update_member on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'logos'
    and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
  );
create policy logos_delete_member on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
  );

-- ---------------------------------------------------------------------------------------------
-- Realtime: changes to these tables are streamed to subscribers, filtered by the same RLS.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['bookings', 'messages', 'threads', 'reviews', 'notices'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

update public.schema_version set version = 5;
