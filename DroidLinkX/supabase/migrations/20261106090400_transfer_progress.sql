-- Transfer accounting: clients (RLS-scoped to their own transfer) report bytes/chunk completion on
-- `transfer_items`; this trigger keeps the parent aggregates, the immutable history and the file
-- catalogue in sync. Direct writes to `file_transfers` counters are not trusted.

create unique index if not exists files_storage_path_key on public.files (storage_path);

create or replace function public.sync_transfer_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_count integer;
  v_completed integer;
  v_bytes bigint;
  v_all_done boolean;
  v_owner uuid;
begin
  select count(*), coalesce(sum(size), 0)
    into v_total_count, v_bytes
    from public.transfer_items where transfer_id = new.transfer_id;

  select count(*) filter (where status = 'completed')
    into v_completed
    from public.transfer_items where transfer_id = new.transfer_id;

  v_all_done := v_completed = v_total_count and v_total_count > 0;

  update public.file_transfers
     set transferred_bytes = coalesce((
           select sum(bytes_received) from public.transfer_items where transfer_id = new.transfer_id
         ), 0),
         completed_items = v_completed,
         status = case
                    when status = 'cancelled' then status
                    when v_all_done then 'completed'
                    when v_completed > 0 then 'active'
                    else status
                  end,
         completed_at = case when v_all_done then coalesce(completed_at, now()) else completed_at end
   where id = new.transfer_id
   returning owner_id into v_owner;

  if new.status = 'completed' and (old.status is distinct from 'completed') then
    insert into public.transfer_history (transfer_id, owner_id, item_index, event, bytes, detail)
    values (new.transfer_id, v_owner, new.item_index, 'item_completed', new.size,
            jsonb_build_object('name', new.name, 'sha256', new.sha256, 'checksumVerified', new.checksum_verified));

    if new.storage_path is not null then
      insert into public.files (owner_id, name, path, mime_type, category, size, sha256, storage_path)
      values (
        v_owner,
        new.name,
        new.relative_path,
        new.mime_type,
        case
          when new.mime_type like 'image/%' then 'image'
          when new.mime_type like 'video/%' then 'video'
          when new.mime_type like 'audio/%' then 'audio'
          when new.mime_type in ('application/zip', 'application/x-tar', 'application/gzip') then 'archive'
          else 'document'
        end,
        new.size,
        new.sha256,
        new.storage_path
      )
      on conflict (storage_path) do update
        set name = excluded.name,
            size = excluded.size,
            sha256 = excluded.sha256,
            deleted_at = null;
    end if;
  elsif new.status = 'failed' and (old.status is distinct from 'failed') then
    insert into public.transfer_history (transfer_id, owner_id, item_index, event, bytes, detail)
    values (new.transfer_id, v_owner, new.item_index, 'item_failed', new.bytes_received,
            jsonb_build_object('error', new.error));
  end if;

  if v_all_done then
    insert into public.transfer_history (transfer_id, owner_id, event, bytes, detail)
    values (new.transfer_id, v_owner, 'transfer_completed', v_bytes,
            jsonb_build_object('items', v_total_count));
  end if;

  return new;
end;
$$;

drop trigger if exists transfer_items_progress on public.transfer_items;
create trigger transfer_items_progress after update on public.transfer_items
  for each row execute function public.sync_transfer_progress();
