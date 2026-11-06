-- ---------------------------------------------------------------------------
-- Shared notifications between the owner's devices + phone-to-phone WebRTC
-- signalling rows (SDP/ICE only -- media never touches the database).
-- ---------------------------------------------------------------------------

-- Idempotency: the same posted notification must not be inserted twice per device.
alter table public.notification_records add column if not exists external_key text;
create unique index if not exists notification_records_device_key_uidx
  on public.notification_records (device_id, external_key)
  where external_key is not null;
create index if not exists notification_records_device_posted_idx
  on public.notification_records (device_id, posted_at desc);

drop policy if exists notification_records_insert_own on public.notification_records;
create policy notification_records_insert_own on public.notification_records
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.owns_device(device_id));

grant select, insert, delete on public.notification_records to authenticated;

-- Deliver shared notifications live to the owner's other devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_records'
  ) then
    alter publication supabase_realtime add table public.notification_records;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- rtc_signals: short-lived signalling envelopes for in-app screen sharing
-- ---------------------------------------------------------------------------
create table if not exists public.rtc_signals (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  device_id     uuid not null references public.devices(id) on delete cascade,
  sender        text not null check (sender in ('viewer', 'device')),
  kind          text not null check (kind in ('request', 'offer', 'answer', 'ice', 'hangup')),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '3 minutes'
);
create index if not exists rtc_signals_conn_idx on public.rtc_signals (connection_id, created_at);
create index if not exists rtc_signals_device_idx on public.rtc_signals (device_id, created_at desc);
create index if not exists rtc_signals_expiry_idx on public.rtc_signals (expires_at);

alter table public.rtc_signals enable row level security;

drop policy if exists rtc_signals_select_own on public.rtc_signals;
create policy rtc_signals_select_own on public.rtc_signals
  for select to authenticated
  using (owner_id = (select auth.uid()) and public.owns_device(device_id));

drop policy if exists rtc_signals_insert_own on public.rtc_signals;
create policy rtc_signals_insert_own on public.rtc_signals
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.owns_device(device_id));

drop policy if exists rtc_signals_delete_own on public.rtc_signals;
create policy rtc_signals_delete_own on public.rtc_signals
  for delete to authenticated using (owner_id = (select auth.uid()));

grant select, insert, delete on public.rtc_signals to authenticated;

-- Expired envelopes are pruned opportunistically; callers never see stale candidates.
create or replace function public.prune_rtc_signals()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rtc_signals where expires_at < now();
end;
$$;

revoke all on function public.prune_rtc_signals() from public;
grant execute on function public.prune_rtc_signals() to service_role;
