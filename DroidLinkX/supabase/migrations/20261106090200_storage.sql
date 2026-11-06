-- Private storage buckets. Every object lives under <owner_id>/... so the policies below can be
-- expressed with a single folder check. Nothing is public: clients receive signed URLs only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('droidlinkx-files', 'droidlinkx-files', false, 2147483648, null),
  ('droidlinkx-transfers', 'droidlinkx-transfers', false, 2147483648, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- Supabase enables RLS on storage.objects by default; assert it explicitly so the policies below
-- can never be bypassed by a project setting.
alter table storage.objects enable row level security;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists "owners read own files" on storage.objects;
create policy "owners read own files" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('droidlinkx-files', 'droidlinkx-transfers')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owners upload own files" on storage.objects;
create policy "owners upload own files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('droidlinkx-files', 'droidlinkx-transfers')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owners update own files" on storage.objects;
create policy "owners update own files" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('droidlinkx-files', 'droidlinkx-transfers')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id in ('droidlinkx-files', 'droidlinkx-transfers')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owners delete own files" on storage.objects;
create policy "owners delete own files" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('droidlinkx-files', 'droidlinkx-transfers')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
