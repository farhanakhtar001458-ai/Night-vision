alter table public.devices add column if not exists installation_id text;
create unique index if not exists devices_owner_installation_uidx
  on public.devices (owner_id, installation_id) where installation_id is not null;
