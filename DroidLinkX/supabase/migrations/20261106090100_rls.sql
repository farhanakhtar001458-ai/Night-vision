-- Row Level Security: every user-owned table is locked down; the service role (Edge Functions)
-- bypasses RLS only for operations that must not be client-driven (secrets, audit, chunk accounting).

alter table public.profiles            enable row level security;
alter table public.devices             enable row level security;
alter table public.device_credentials  enable row level security;
alter table public.device_sessions     enable row level security;
alter table public.device_permissions  enable row level security;
alter table public.connection_sessions enable row level security;
alter table public.connection_events   enable row level security;
alter table public.file_transfers      enable row level security;
alter table public.transfer_items      enable row level security;
alter table public.transfer_chunks     enable row level security;
alter table public.transfer_history    enable row level security;
alter table public.files               enable row level security;
alter table public.notification_records enable row level security;
alter table public.clipboard_entries   enable row level security;
alter table public.activity_logs       enable row level security;

-- Anonymous clients get nothing at all.
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.devices, public.device_sessions,
  public.device_permissions, public.connection_sessions, public.connection_events, public.file_transfers,
  public.transfer_items, public.transfer_chunks, public.transfer_history, public.files,
  public.notification_records, public.clipboard_entries, public.activity_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- devices: read/rename/trust/revoke own devices. Creation and secret handling happen in
-- Edge Functions only, so there is intentionally no insert policy.
-- ---------------------------------------------------------------------------
drop policy if exists devices_select_own on public.devices;
create policy devices_select_own on public.devices
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists devices_update_own on public.devices;
create policy devices_update_own on public.devices
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists devices_delete_own on public.devices;
create policy devices_delete_own on public.devices
  for delete to authenticated using (owner_id = (select auth.uid()));

-- device_credentials: RLS enabled with **no policies** = no client access, by design.

-- ---------------------------------------------------------------------------
-- device_sessions: owners can audit their own device sessions, revocation is done by
-- revoke-device / create-session (service role).
-- ---------------------------------------------------------------------------
drop policy if exists device_sessions_select_own on public.device_sessions;
create policy device_sessions_select_own on public.device_sessions
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- device_permissions
-- ---------------------------------------------------------------------------
drop policy if exists device_permissions_select_own on public.device_permissions;
create policy device_permissions_select_own on public.device_permissions
  for select to authenticated using (public.owns_device(device_id));

drop policy if exists device_permissions_insert_own on public.device_permissions;
create policy device_permissions_insert_own on public.device_permissions
  for insert to authenticated with check (public.owns_device(device_id));

drop policy if exists device_permissions_update_own on public.device_permissions;
create policy device_permissions_update_own on public.device_permissions
  for update to authenticated
  using (public.owns_device(device_id))
  with check (public.owns_device(device_id));

drop policy if exists device_permissions_delete_own on public.device_permissions;
create policy device_permissions_delete_own on public.device_permissions
  for delete to authenticated using (public.owns_device(device_id));

-- ---------------------------------------------------------------------------
-- connection_sessions / connection_events
-- ---------------------------------------------------------------------------
drop policy if exists connection_sessions_select_own on public.connection_sessions;
create policy connection_sessions_select_own on public.connection_sessions
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists connection_sessions_insert_own on public.connection_sessions;
create policy connection_sessions_insert_own on public.connection_sessions
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (source_device_id is null or public.owns_device(source_device_id))
    and (target_device_id is null or public.owns_device(target_device_id))
  );

drop policy if exists connection_sessions_update_own on public.connection_sessions;
create policy connection_sessions_update_own on public.connection_sessions
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists connection_events_select_own on public.connection_events;
create policy connection_events_select_own on public.connection_events
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- transfers: read everything, drive pause/resume/cancel state; rows are created by
-- initiate-transfer and item accounting is service-role only.
-- ---------------------------------------------------------------------------
drop policy if exists file_transfers_select_own on public.file_transfers;
create policy file_transfers_select_own on public.file_transfers
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists file_transfers_update_own on public.file_transfers;
create policy file_transfers_update_own on public.file_transfers
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists transfer_items_select_own on public.transfer_items;
create policy transfer_items_select_own on public.transfer_items
  for select to authenticated using (public.owns_transfer(transfer_id));

drop policy if exists transfer_items_update_own on public.transfer_items;
create policy transfer_items_update_own on public.transfer_items
  for update to authenticated
  using (public.owns_transfer(transfer_id))
  with check (public.owns_transfer(transfer_id));

drop policy if exists transfer_chunks_select_own on public.transfer_chunks;
create policy transfer_chunks_select_own on public.transfer_chunks
  for select to authenticated using (public.owns_transfer(transfer_id));

drop policy if exists transfer_history_select_own on public.transfer_history;
create policy transfer_history_select_own on public.transfer_history
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- files: owners manage metadata for blobs in their own storage folder.
-- ---------------------------------------------------------------------------
drop policy if exists files_select_own on public.files;
create policy files_select_own on public.files
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists files_insert_own on public.files;
create policy files_insert_own on public.files
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (device_id is null or public.owns_device(device_id)));

drop policy if exists files_update_own on public.files;
create policy files_update_own on public.files
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists files_delete_own on public.files;
create policy files_delete_own on public.files
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- notifications / clipboard / activity
-- ---------------------------------------------------------------------------
drop policy if exists notification_records_select_own on public.notification_records;
create policy notification_records_select_own on public.notification_records
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists notification_records_delete_own on public.notification_records;
create policy notification_records_delete_own on public.notification_records
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists clipboard_entries_select_own on public.clipboard_entries;
create policy clipboard_entries_select_own on public.clipboard_entries
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists clipboard_entries_insert_own on public.clipboard_entries;
create policy clipboard_entries_insert_own on public.clipboard_entries
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (device_id is null or public.owns_device(device_id)));

drop policy if exists clipboard_entries_delete_own on public.clipboard_entries;
create policy clipboard_entries_delete_own on public.clipboard_entries
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists activity_logs_select_own on public.activity_logs;
create policy activity_logs_select_own on public.activity_logs
  for select to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Guard rails: clients may not move a transfer to another owner, nor attach a file to someone
-- else's storage folder. These triggers run in addition to RLS.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_file_storage_prefix()
returns trigger
language plpgsql
as $$
begin
  if new.storage_path not like new.owner_id::text || '/%' then
    raise exception 'storage_path must live under the owner folder' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists files_storage_prefix on public.files;
create trigger files_storage_prefix before insert or update on public.files
  for each row execute function public.enforce_file_storage_prefix();
