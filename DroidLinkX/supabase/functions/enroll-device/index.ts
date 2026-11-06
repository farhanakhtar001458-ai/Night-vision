import { env } from '../_shared/env.ts';
import { audit, broadcast } from '../_shared/realtime.ts';
import { json, optionalString, requireString, readJson, serve, HttpError, clientIp } from '../_shared/http.ts';
import { randomToken, sha256Hex } from '../_shared/crypto.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { signalingConfig } from '../_shared/turn.ts';

type Body = {
  name?: string;
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  sdkInt?: number;
  appVersion?: string;
  platform?: string;
};

const PERMISSIONS = ['screen_capture', 'camera', 'microphone', 'remote_control', 'notifications', 'clipboard', 'files', 'location'];

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);
  const supabase = serviceClient();

  // Ownership is implicit (the device is created for the caller), but enrolment count is bounded
  // so a compromised account cannot create unbounded rows.
  const { count, error: countError } = await supabase
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
    .eq('status', 'active');
  if (countError) throw new HttpError(500, 'DATABASE', 'Could not verify the current device count');
  if ((count ?? 0) >= env.maxDevicesPerOwner) {
    throw new HttpError(429, 'DEVICE_LIMIT', `This account already has the maximum of ${env.maxDevicesPerOwner} active devices`);
  }

  const name = optionalString(body.name, 80) ?? optionalString(body.model, 80) ?? 'Android device';
  const { data: device, error: insertError } = await supabase
    .from('devices')
    .insert({
      owner_id: user.id,
      name,
      manufacturer: optionalString(body.manufacturer, 80),
      model: optionalString(body.model, 120),
      android_version: optionalString(body.androidVersion, 40),
      sdk_int: typeof body.sdkInt === 'number' ? body.sdkInt : null,
      app_version: optionalString(body.appVersion, 40),
      platform: optionalString(body.platform, 20) ?? 'android',
      last_ip: clientIp(req),
    })
    .select('*')
    .single();
  if (insertError || !device) {
    console.error('[enroll-device] insert failed', insertError);
    throw new HttpError(500, 'DATABASE', 'Device could not be enrolled');
  }

  const secret = randomToken(32);
  const secretHash = await sha256Hex(secret);

  const { error: credentialError } = await supabase
    .from('device_credentials')
    .insert({ device_id: device.id, secret_hash: secretHash });
  if (credentialError) {
    await supabase.from('devices').delete().eq('id', device.id);
    throw new HttpError(500, 'DATABASE', 'Device credential could not be stored');
  }

  const { error: permissionError } = await supabase
    .from('device_permissions')
    .insert(PERMISSIONS.map((permission) => ({ device_id: device.id, permission, granted: false })));
  if (permissionError) console.warn('[enroll-device] default permissions failed', permissionError.message);

  await audit({
    ownerId: user.id,
    action: 'device_enrolled',
    deviceId: device.id,
    actorType: 'user',
    actorId: user.id,
    detail: { name: device.name, model: device.model, platform: device.platform },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  await broadcast(`owner:${user.id}`, 'device:enrolled', { deviceId: device.id, name: device.name });

  // The secret is returned exactly once; only its SHA-256 hash is stored.
  return json({
    device,
    deviceId: device.id,
    deviceSecret: secret,
    permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])),
    signaling: signalingConfig(),
    notice: 'Store deviceSecret in the Android Keystore. It will never be shown again.',
  }, 201, origin);
}));
