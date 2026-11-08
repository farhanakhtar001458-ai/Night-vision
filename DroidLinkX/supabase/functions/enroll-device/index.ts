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
  installationId?: string;
};

const PERMISSIONS = ['screen_capture', 'camera', 'microphone', 'remote_control', 'notifications', 'clipboard', 'files', 'location'];

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);
  const supabase = serviceClient();

  const installationId = optionalString(body.installationId, 64);
  const attributes = {
    name: optionalString(body.name, 80) ?? optionalString(body.model, 80) ?? 'Android device',
    manufacturer: optionalString(body.manufacturer, 80),
    model: optionalString(body.model, 120),
    android_version: optionalString(body.androidVersion, 40),
    sdk_int: typeof body.sdkInt === 'number' ? body.sdkInt : null,
    app_version: optionalString(body.appVersion, 40),
    platform: optionalString(body.platform, 20) ?? 'android',
    last_ip: clientIp(req),
  };

  // Re-enrolment of the *same* installation (app reinstalled, Keystore wiped, retry after a
  // dropped response) must reuse its row. Without this every call created another duplicate
  // "Infinix X6873" entry that never went online.
  let device: Record<string, unknown> | null = null;
  let reused = false;
  if (installationId) {
    const { data: existing, error: lookupError } = await supabase
      .from('devices')
      .select('*')
      .eq('owner_id', user.id)
      .eq('installation_id', installationId)
      .maybeSingle();
    if (lookupError) console.warn('[enroll-device] lookup failed', lookupError.message);
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('devices')
        .update({
          ...attributes,
          status: 'active',
          online: true,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (updateError) console.warn('[enroll-device] refresh failed', updateError.message);
      device = (updated ?? existing) as Record<string, unknown>;
      reused = true;
    }
  }

  if (!device) {
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
    const { data: inserted, error: insertError } = await supabase
      .from('devices')
      .insert({
        owner_id: user.id,
        ...attributes,
        ...(installationId ? { installation_id: installationId } : {}),
        online: true,
        last_seen_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insertError || !inserted) {
      console.error('[enroll-device] insert failed', insertError);
      throw new HttpError(500, 'DATABASE', 'Device could not be enrolled');
    }
    device = inserted as Record<string, unknown>;
  }

  const deviceId = String(device.id);
  const secret = randomToken(32);
  const secretHash = await sha256Hex(secret);

  const { error: credentialError } = await supabase
    .from('device_credentials')
    .upsert({ device_id: deviceId, secret_hash: secretHash }, { onConflict: 'device_id' });
  if (credentialError) {
    if (!reused) await supabase.from('devices').delete().eq('id', deviceId);
    throw new HttpError(500, 'DATABASE', 'Device credential could not be stored');
  }

  const { error: permissionError } = await supabase
    .from('device_permissions')
    .upsert(
      PERMISSIONS.map((permission) => ({ device_id: deviceId, permission, granted: false })),
      { onConflict: 'device_id,permission', ignoreDuplicates: true },
    );
  if (permissionError) console.warn('[enroll-device] default permissions failed', permissionError.message);

  await audit({
    ownerId: user.id,
    action: 'device_enrolled',
    deviceId,
    actorType: 'user',
    actorId: user.id,
    detail: { name: attributes.name, model: attributes.model, platform: attributes.platform, reused },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  if (!reused) await broadcast(`owner:${user.id}`, 'device:enrolled', { deviceId, name: attributes.name });

  // The secret is returned exactly once; only its SHA-256 hash is stored.
  return json({
    device,
    deviceId,
    deviceSecret: secret,
    permissions: Object.fromEntries(PERMISSIONS.map((permission) => [permission, false])),
    signaling: signalingConfig(),
    notice: 'Store deviceSecret in the Android Keystore. It will never be shown again.',
  }, 201, origin);
}));
