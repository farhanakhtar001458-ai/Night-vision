-- Realtime: postgres_changes for durable state (devices, connections, transfers, activity) and
-- private broadcast for ephemeral UI signals. Continuous video is **not** carried here; it uses
-- WebRTC over the dedicated signalling service and TURN relay.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.devices;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.connection_sessions;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.connection_events;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.file_transfers;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.transfer_items;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.activity_logs;
    exception when duplicate_object then null;
    end;
  else
    create publication supabase_realtime for table
      public.devices,
      public.connection_sessions,
      public.connection_events,
      public.file_transfers,
      public.transfer_items,
      public.activity_logs;
  end if;
end
$$;

-- Full row images so subscribers receive every column on UPDATE.
alter table public.devices replica identity full;
alter table public.connection_sessions replica identity full;
alter table public.file_transfers replica identity full;
alter table public.transfer_items replica identity full;

-- Private broadcast authorization. Topic convention:
--   owner:<user uuid>   -> dashboard terminals of one owner
--   device:<device uuid> -> a specific enrolled device (for ephemeral status pings)
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'realtime' and c.relname = 'messages') then
    execute 'grant usage on schema realtime to authenticated';
    execute 'grant select, insert on realtime.messages to authenticated';
    execute 'grant usage, select on all sequences in schema realtime to authenticated';
    execute 'alter table realtime.messages enable row level security';

    execute 'drop policy if exists "owners read own realtime topics" on realtime.messages';
    execute $p$create policy "owners read own realtime topics" on realtime.messages
      for select to authenticated
      using (
        extension = 'broadcast'
        and (
          split_part(topic, ':', 1) = 'owner'
          and split_part(topic, ':', 2) = (select auth.uid())::text
          or (
            split_part(topic, ':', 1) = 'device'
            and public.owns_device(nullif(split_part(topic, ':', 2), '')::uuid)
          )
        )
      )$p$;

    execute 'drop policy if exists "owners publish own realtime topics" on realtime.messages';
    execute $p$create policy "owners publish own realtime topics" on realtime.messages
      for insert to authenticated
      with check (
        extension = 'broadcast'
        and (
          split_part(topic, ':', 1) = 'owner'
          and split_part(topic, ':', 2) = (select auth.uid())::text
          or (
            split_part(topic, ':', 1) = 'device'
            and public.owns_device(nullif(split_part(topic, ':', 2), '')::uuid)
          )
        )
      )$p$;
  end if;
end
$$;
