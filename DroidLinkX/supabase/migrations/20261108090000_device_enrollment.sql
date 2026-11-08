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
  if coalesce(length(p_secret_hash), 0) < 32 then
    raise exception 'secret hash required' using errcode = '22023';
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
    manufacturer    = coalesce(excluded.manufacturer, d.manufacturer),
    model           = coalesce(excluded.model, d.model),
    android_version = coalesce(excluded.android_version, d.android_version),
    sdk_int         = coalesce(excluded.sdk_int, d.sdk_int),
    app_version     = coalesce(excluded.app_version, d.app_version),
    status          = 'active',
    online          = true,
    last_seen_at    = now(),
    updated_at      = now()
  returning * into v_device;

  update public.device_credentials
     set secret_hash = p_secret_hash,
         rotated_at = now(),
         revoked_at = null
   where device_id = v_device.id;

  if not found then
    insert into public.device_credentials (device_id, secret_hash)
    values (v_device.id, p_secret_hash);
  end if;

  insert into public.device_permissions (device_id, permission, granted)
  select v_device.id, p.permission, false
    from unnest(array['screen_capture','camera','microphone','remote_control','notifications','clipboard','files','location']) as p(permission)
  on conflict (device_id, permission) do nothing;

  insert into public.activity_logs (owner_id, device_id, actor_type, actor_id, action, detail)
  values (v_owner, v_device.id, 'user', v_owner, 'device_enrolled',
          jsonb_build_object('name', v_device.name, 'model', v_device.model, 'installation', v_device.installation_id));

  return v_device;
end;
$$;

revoke all on function public.enroll_device(text, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.enroll_device(text, text, text, text, text, text, integer, text) to authenticated;
