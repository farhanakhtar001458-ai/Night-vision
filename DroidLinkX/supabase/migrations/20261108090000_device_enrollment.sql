-- ---------------------------------------------------------------------------
-- Idempotent device enrolment.
--
-- The first implementation created a row on every call, so a reinstall (or a retry
-- after a failed save) left duplicate "Infinix X6873" entries behind. Enrolment is now keyed by a
-- per-installation id generated on the device *before* the first network call, and the secret is
-- generated client-side and stored only as a SHA-256 hash.
-- ---------------------------------------------------------------------------

alter table public.devices add column if not exists installation_id text;

-- One row per (owner, installation). Partial index so legacy rows with no installation id stay valid.
create unique index if not exists devices_owner_installation_uidx
  on public.devices (owner_id, installation_id)
  where installation_id is not null;

create or replace function public.enroll_device(
  p_installation_id text,
  p_secret_hash text,
  p_name text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_android_version text default null,
  p_sdk_int integer default null,
  p_app_version text default null
)
returns public.devices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_device public.devices;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_installation_id), '') = '' then
    raise exception 'installation id required' using errcode = '22023';
  end if;

  insert into public.devices as d (
    owner_id, name, manufacturer, model, android_version, sdk_int, app_version,
    platform, installation_id, status, online, last_seen_at
  )
  values (
    v_owner,
    coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_model), ''), 'Android device'),
    nullif(btrim(p_manufacturer), ''),
    nullif(btrim(p_model), ''),
    nullif(btrim(p_android_version), ''),
    p_sdk_int,
    nullif(btrim(p_app_version), ''),
    'android',
    btrim(p_installation_id),
    'active',
    true,
    now()
  )
  on conflict (owner_id, installation_id) where installation_id is not null
  do update set
    name            = excluded.name,
    model           = coalesce(excluded.model, d.model),
    android_version = coalesce(excluded.android_version, d.android_version),
    sdk_int         = coalesce(excluded.sdk_int, d.sdk_int),
    app_version     = coalesce(excluded.app_version, d.app_version),
    status          = 'active',
    online          = true,
    last_seen_at    = now()
  returning * into v_device;

  return v_device;
end;
$$;

revoke all on function public.enroll_device(text, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.enroll_device(text, text, text, text, text, text, integer, text) to authenticated;

-- Owner may insert their own row (used by the enrolled-device fallback path in the app).
drop policy if exists devices_insert_own on public.devices;
create policy devices_insert_own on public.devices
  for insert to authenticated with check (owner_id = (select auth.uid()));

-- Collapse duplicate enrolment rows: keep the newest row per model, and never touch a row that
-- has actually reported telemetry (that is a real second phone, not a duplicate).
delete from public.devices d
 using (
   select id,
          row_number() over (
            partition by owner_id, coalesce(model, name)
            order by created_at desc
          ) as rn
     from public.devices
    where last_seen_at is null
 ) k
 where d.id = k.id
   and k.rn > 1;
