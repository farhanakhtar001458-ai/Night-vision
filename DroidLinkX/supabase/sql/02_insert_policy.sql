drop policy if exists devices_insert_own on public.devices;
create policy devices_insert_own on public.devices
  for insert to authenticated with check (owner_id = (select auth.uid()));
