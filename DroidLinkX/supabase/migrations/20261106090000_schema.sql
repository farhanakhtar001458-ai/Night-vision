-- DroidLink X core schema.
-- Supabase is the single source of truth: Auth owns identities, this schema owns devices,
-- sessions, connections, transfers, activity and file metadata.

-- gen_random_uuid() is built into PostgreSQL 13+, no extension required.

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null default 'Owner',
  avatar_url   text,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- devices + credentials + sessions + permissions
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  manufacturer    text,
  model           text,
  android_version text,
  sdk_int         integer,
  app_version     text,
  platform        text not null default 'android',
  status          text not null default 'active' check (status in ('active', 'revoked')),
  trusted         boolean not null default true,
  online          boolean not null default false,
  connection_quality text not null default 'offline',
  last_seen_at    timestamptz,
  last_ip         inet,
  telemetry       jsonb not null default '{}'::jsonb,
  push_token      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists devices_owner_idx on public.devices (owner_id, status, created_at desc);

-- Device secrets are never readable by clients: RLS is enabled and no policy grants access.
-- Only the service role (Edge Functions) can touch this table.
create table if not exists public.device_credentials (
  device_id    uuid primary key references public.devices(id) on delete cascade,
  secret_hash  text not null,
  rotated_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create table if not exists public.device_sessions (
  id                uuid primary key default gen_random_uuid(),
  device_id         uuid not null references public.devices(id) on delete cascade,
  owner_id          uuid not null references auth.users(id) on delete cascade,
  token_id          text not null unique,
  user_agent        text,
  ip                inet,
  created_at        timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  expires_at        timestamptz not null,
  revoked_at        timestamptz
);
create index if not exists device_sessions_device_idx on public.device_sessions (device_id, created_at desc);
create index if not exists device_sessions_owner_idx on public.device_sessions (owner_id, created_at desc);

create table if not exists public.device_permissions (
  device_id  uuid not null references public.devices(id) on delete cascade,
  permission text not null check (permission in (
    'screen_capture', 'camera', 'microphone', 'remote_control', 'notifications',
    'clipboard', 'files', 'location', 'sms'
  )),
  granted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (device_id, permission)
);

-- ---------------------------------------------------------------------------
-- connection sessions + events
-- ---------------------------------------------------------------------------
create table if not exists public.connection_sessions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  source_device_id uuid references public.devices(id) on delete cascade,
  target_device_id uuid references public.devices(id) on delete cascade,
  type             text not null check (type in ('mirror', 'camera', 'file', 'control', 'clipboard')),
  status           text not null default 'pending'
                   check (status in ('pending', 'accepted', 'active', 'rejected', 'ended', 'expired')),
  requested_by     text not null default 'user' check (requested_by in ('user', 'device')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '5 minutes',
  accepted_at      timestamptz,
  ended_at         timestamptz,
  ended_reason     text
);
create index if not exists connection_sessions_owner_idx on public.connection_sessions (owner_id, created_at desc);

create table if not exists public.connection_events (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connection_sessions(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  device_id     uuid references public.devices(id) on delete set null,
  event         text not null,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists connection_events_conn_idx on public.connection_events (connection_id, created_at desc);

-- ---------------------------------------------------------------------------
-- transfers
-- ---------------------------------------------------------------------------
create table if not exists public.file_transfers (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  source_device_id  uuid references public.devices(id) on delete set null,
  target_device_id  uuid references public.devices(id) on delete set null,
  direction         text not null check (direction in (
    'device_to_device', 'device_to_cloud', 'cloud_to_device', 'dashboard_to_device', 'device_to_dashboard'
  )),
  mode              text not null default 'relay' check (mode in ('direct', 'relay')),
  status            text not null default 'pending'
                    check (status in ('pending', 'active', 'paused', 'completed', 'failed', 'cancelled')),
  total_bytes       bigint not null default 0,
  transferred_bytes bigint not null default 0,
  item_count        integer not null default 0,
  completed_items   integer not null default 0,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  started_at        timestamptz,
  completed_at      timestamptz
);
create index if not exists file_transfers_owner_idx on public.file_transfers (owner_id, created_at desc);

create table if not exists public.transfer_items (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid not null references public.file_transfers(id) on delete cascade,
  item_index        integer not null,
  name              text not null,
  relative_path     text not null default '/',
  mime_type         text not null default 'application/octet-stream',
  size              bigint not null default 0,
  sha256            text,
  status            text not null default 'pending'
                    check (status in ('pending', 'uploading', 'verifying', 'completed', 'failed', 'skipped')),
  bytes_received    bigint not null default 0,
  received_chunks   integer not null default 0,
  checksum_verified boolean not null default false,
  storage_path      text,
  error             text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  unique (transfer_id, item_index)
);

create table if not exists public.transfer_chunks (
  id           bigserial primary key,
  transfer_id  uuid not null references public.file_transfers(id) on delete cascade,
  item_index   integer not null,
  chunk_index  integer not null,
  size         integer not null,
  sha256       text,
  received_at  timestamptz not null default now(),
  unique (transfer_id, item_index, chunk_index)
);

create table if not exists public.transfer_history (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.file_transfers(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  item_index  integer,
  event       text not null,
  bytes       bigint not null default 0,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists transfer_history_owner_idx on public.transfer_history (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- files / notifications / clipboard / activity
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  device_id    uuid references public.devices(id) on delete set null,
  name         text not null,
  path         text not null default '/',
  mime_type    text not null default 'application/octet-stream',
  category     text not null default 'document'
               check (category in ('document', 'image', 'video', 'audio', 'archive', 'other')),
  size         bigint not null default 0,
  sha256       text,
  storage_path text not null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists files_owner_idx on public.files (owner_id, created_at desc);

create table if not exists public.notification_records (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  device_id    uuid not null references public.devices(id) on delete cascade,
  package_name text not null,
  app_name     text not null,
  title        text,
  content      text,
  category     text,
  is_sensitive boolean not null default false,
  posted_at    timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists notification_records_owner_idx on public.notification_records (owner_id, posted_at desc);

create table if not exists public.clipboard_entries (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  device_id    uuid references public.devices(id) on delete set null,
  direction    text not null check (direction in ('device_to_cloud', 'cloud_to_device')),
  content      text not null,
  content_type text not null default 'text/plain',
  is_sensitive boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '24 hours'
);
create index if not exists clipboard_entries_owner_idx on public.clipboard_entries (owner_id, created_at desc);

create table if not exists public.activity_logs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  device_id  uuid references public.devices(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'device', 'system')),
  actor_id   text,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_owner_idx on public.activity_logs (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists devices_touch_updated_at on public.devices;
create trigger devices_touch_updated_at before update on public.devices
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists file_transfers_touch_updated_at on public.file_transfers;
create trigger file_transfers_touch_updated_at before update on public.file_transfers
  for each row execute function public.touch_updated_at();

-- True when the current authenticated user owns the device. SECURITY DEFINER keeps the lookup
-- independent of RLS on devices, so policies on child tables can reuse it safely.
create or replace function public.owns_device(target_device uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.devices d
    where d.id = target_device and d.owner_id = auth.uid()
  );
$$;

create or replace function public.owns_transfer(target_transfer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.file_transfers t
    where t.id = target_transfer and t.owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_device(uuid) from public;
revoke all on function public.owns_transfer(uuid) from public;
grant execute on function public.owns_device(uuid) to authenticated;
grant execute on function public.owns_transfer(uuid) to authenticated;

-- Create the profile row for every new auth user (signup via Supabase Auth).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Audit helper used by Edge Functions (service role).
create or replace function public.log_activity(
  p_owner uuid,
  p_action text,
  p_device uuid default null,
  p_actor_type text default 'user',
  p_actor_id text default null,
  p_detail jsonb default '{}'::jsonb,
  p_ip inet default null,
  p_user_agent text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.activity_logs (owner_id, device_id, actor_type, actor_id, action, detail, ip, user_agent)
  values (p_owner, p_device, p_actor_type, p_actor_id, p_action, coalesce(p_detail, '{}'::jsonb), p_ip, p_user_agent);
$$;

revoke all on function public.log_activity(uuid, text, uuid, text, text, jsonb, inet, text) from public;
