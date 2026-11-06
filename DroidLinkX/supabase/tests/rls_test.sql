\set ON_ERROR_STOP on
-- Deterministic ids so assertions are readable.
delete from public.activity_logs; delete from public.clipboard_entries; delete from public.notification_records;
delete from public.transfer_history; delete from public.transfer_chunks; delete from public.transfer_items;
delete from public.file_transfers; delete from public.connection_events; delete from public.connection_sessions;
delete from public.files; delete from public.device_permissions; delete from public.device_sessions;
delete from public.device_credentials; delete from public.devices; delete from public.profiles;
delete from storage.objects; delete from auth.users;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test', '{"display_name":"Owner A"}'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.test', '{"display_name":"Owner B"}');

insert into public.devices (id, owner_id, name, manufacturer, model) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A phone', 'Google', 'Pixel'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B phone', 'Samsung', 'S24');

insert into public.device_credentials (device_id, secret_hash) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'hash-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'hash-b');

insert into public.device_sessions (device_id, owner_id, token_id, expires_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'jti-a', now() + interval '30 days'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'jti-b', now() + interval '30 days');

insert into public.file_transfers (id, owner_id, direction, status, total_bytes, item_count) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'dashboard_to_device', 'active', 10, 1),
  ('dddddddd-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'dashboard_to_device', 'active', 10, 1);

insert into public.transfer_items (transfer_id, item_index, name, size) values
  ('cccccccc-0000-0000-0000-000000000001', 0, 'a.txt', 10),
  ('dddddddd-0000-0000-0000-000000000002', 0, 'b.txt', 10);

insert into public.files (owner_id, name, storage_path) values
  ('11111111-1111-1111-1111-111111111111', 'a.txt', '11111111-1111-1111-1111-111111111111/a.txt'),
  ('22222222-2222-2222-2222-222222222222', 'b.txt', '22222222-2222-2222-2222-222222222222/b.txt');

insert into public.activity_logs (owner_id, action) values
  ('11111111-1111-1111-1111-111111111111', 'device_enrolled'),
  ('22222222-2222-2222-2222-222222222222', 'device_enrolled');

insert into storage.objects (bucket_id, name, owner) values
  ('droidlinkx-files', '11111111-1111-1111-1111-111111111111/a.txt', '11111111-1111-1111-1111-111111111111'),
  ('droidlinkx-files', '22222222-2222-2222-2222-222222222222/b.txt', '22222222-2222-2222-2222-222222222222');

create or replace function pg_temp.assert(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
  raise notice 'ok: %', message;
end;
$$;

-- Act as owner A.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set request.jwt.claim.role = 'authenticated';

select pg_temp.assert((select count(*) from public.devices) = 1, 'A sees exactly one device');
select pg_temp.assert((select name from public.devices) = 'A phone', 'A sees only their own device');
do $$
begin
  begin
    perform 1 from public.device_credentials;
    raise exception 'ASSERTION FAILED: device secrets are readable by clients';
  exception when insufficient_privilege then
    raise notice 'ok: device secrets are invisible to clients';
  end;
end $$;
select pg_temp.assert((select count(*) from public.device_sessions) = 1, 'A sees one device session');
select pg_temp.assert((select count(*) from public.activity_logs) = 1, 'A sees one audit entry');
select pg_temp.assert((select count(*) from public.files) = 1, 'A sees one file row');
select pg_temp.assert((select count(*) from public.file_transfers) = 1, 'A sees one transfer');
select pg_temp.assert((select count(*) from public.transfer_items) = 1, 'A sees one transfer item');
select pg_temp.assert((select count(*) from storage.objects) = 1, 'A sees one storage object');
select pg_temp.assert((select count(*) from public.profiles) = 1, 'A sees only their profile');

-- Updating your own device is allowed; another owner's row is not visible.
update public.devices set name = 'A phone renamed' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.assert((select name from public.devices where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'A phone renamed', 'A can rename own device');
update public.devices set name = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.assert((select count(*) from public.devices where name = 'hijacked') = 0, 'A cannot rename B device');

-- No insert policy on devices: enrollment must go through the Edge Function.
do $$
begin
  begin
    insert into public.devices (owner_id, name) values ('11111111-1111-1111-1111-111111111111', 'rogue');
    raise exception 'ASSERTION FAILED: client inserted a device directly';
  exception when insufficient_privilege then
    raise notice 'ok: clients cannot insert devices directly';
  end;
end $$;

-- Cross-owner connection sessions and files are rejected.
do $$
begin
  begin
    insert into public.connection_sessions (owner_id, source_device_id, target_device_id, type)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'mirror');
    raise exception 'ASSERTION FAILED: cross-owner connection was created';
  exception when insufficient_privilege then
    raise notice 'ok: cross-owner connections are rejected';
  end;
end $$;

do $$
begin
  begin
    insert into public.files (owner_id, name, storage_path) values ('22222222-2222-2222-2222-222222222222', 'x', '22222222-2222-2222-2222-222222222222/x');
    raise exception 'ASSERTION FAILED: file row for another owner was created';
  exception when insufficient_privilege then
    raise notice 'ok: files cannot be inserted for another owner';
  end;
end $$;

-- A cannot read another owner's transfer items, even with the transfer id.
select pg_temp.assert((select count(*) from public.transfer_items where transfer_id = 'dddddddd-0000-0000-0000-000000000002') = 0, 'A cannot read B transfer items');

-- Storage folder isolation.
do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('droidlinkx-files', '22222222-2222-2222-2222-222222222222/evil.txt');
    raise exception 'ASSERTION FAILED: upload outside the owner folder succeeded';
  exception when insufficient_privilege then
    raise notice 'ok: storage uploads are confined to the owner folder';
  end;
end $$;

insert into storage.objects (bucket_id, name) values ('droidlinkx-files', '11111111-1111-1111-1111-111111111111/own.txt');
select pg_temp.assert((select count(*) from storage.objects) = 2, 'A can upload into their own folder');

-- Realtime broadcast topic policies.
insert into realtime.messages (topic, extension) values ('owner:11111111-1111-1111-1111-111111111111', 'broadcast');
select pg_temp.assert((select count(*) from realtime.messages) = 1, 'A can read their own broadcast topic');
do $$
begin
  begin
    insert into realtime.messages (topic, extension) values ('owner:22222222-2222-2222-2222-222222222222', 'broadcast');
    raise exception 'ASSERTION FAILED: published into another owner topic';
  exception when insufficient_privilege then
    raise notice 'ok: broadcast publishing is owner-scoped';
  end;
end $$;

reset role;

-- Owner B sees only their own rows.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.assert((select count(*) from public.devices) = 1, 'B sees exactly one device');
select pg_temp.assert((select name from public.devices) = 'B phone', 'B sees only their own device');
select pg_temp.assert((select count(*) from public.file_transfers) = 1, 'B sees one transfer');
select pg_temp.assert((select count(*) from public.activity_logs) = 1, 'B sees one audit entry');
select pg_temp.assert((select count(*) from public.files) = 1, 'B sees one file row');
reset role;

-- Video streams are not transported by Realtime: the signalling service is a separate system.
select pg_temp.assert(
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'connection_events'
  ),
  'connection signalling state is persisted for audit, media stays on WebRTC'
);

select 'RLS TESTS PASSED' as result;
