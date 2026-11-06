import { env } from '../_shared/env.ts';
import { randomToken, sha256Hex, timingSafeEqual } from '../_shared/crypto.ts';
import { clientIp, HttpError, json, optionalString, readJson, requireString, requireUuid, serve } from '../_shared/http.ts';
import { signDeviceToken } from '../_shared/deviceToken.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { audit } from '../_shared/realtime.ts';
import { signalingConfig } from '../_shared/turn.ts';

type Body = { deviceId?: string; deviceSecret?: string; userAgent?: string };

/**
 * Device authentication: a device secret (issued once by enroll-device) is exchanged for a
 * device-scoped token bound to a revocable `device_sessions` row.
 * `verify_jwt = false` in config.toml because the caller only has the device secret at this point.
 */
Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const body = await readJson<Body>(req);
  const deviceId = requireUuid(body.deviceId, 'deviceId');
  const deviceSecret = requireString(body.deviceSecret, 'deviceSecret', 256);
  const supabase = serviceClient();

  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('id, owner_id, name, manufacturer, model, android_version, sdk_int, app_version, platform, status, trusted, online, telemetry, created_at')
    .eq('id', deviceId)
    .maybeSingle();
  if (deviceError) throw new HttpError(500, 'DATABASE', 'Device lookup failed');
  if (!device) throw new HttpError(401, 'DEVICE_AUTH', 'Device credential rejected');
  if (device.status !== 'active') throw new HttpError(403, 'DEVICE_REVOKED', 'This device has been revoked by the owner');

  const { data: credential, error: credentialError } = await supabase
    .from('device_credentials')
    .select('secret_hash, revoked_at')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (credentialError) throw new HttpError(500, 'DATABASE', 'Credential lookup failed');
  if (!credential || credential.revoked_at) throw new HttpError(403, 'DEVICE_REVOKED', 'This device credential is no longer valid');

  const providedHash = await sha256Hex(deviceSecret);
  if (!timingSafeEqual(providedHash, credential.secret_hash)) {
    await audit({
      ownerId: device.owner_id,
      action: 'device_auth_failed',
      deviceId,
      actorType: 'device',
      detail: { reason: 'bad_secret' },
      ip: clientIp(req),
    });
    throw new HttpError(401, 'DEVICE_AUTH', 'Device credential rejected');
  }

  // Bound the number of concurrent device sessions per device (10 / minute is generous for a retry loop).
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from('device_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('device_id', deviceId)
    .gte('created_at', since);
  if ((count ?? 0) > 10) throw new HttpError(429, 'RATE_LIMITED', 'Too many device sessions, retry shortly');

  const expiresAt = new Date(Date.now() + env.deviceTokenTtlSeconds * 1000).toISOString();
  const tokenId = randomToken(16);
  const { data: session, error: sessionError } = await supabase
    .from('device_sessions')
    .insert({
      device_id: deviceId,
      owner_id: device.owner_id,
      token_id: tokenId,
      ip: clientIp(req),
      user_agent: optionalString(body.userAgent ?? req.headers.get('user-agent'), 300),
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();
  if (sessionError || !session) {
    console.error('[create-session] insert failed', sessionError);
    throw new HttpError(500, 'DATABASE', 'Device session could not be created');
  }

  const { token, expiresIn } = await signDeviceToken({
    sub: device.owner_id,
    did: deviceId,
    sid: session.id,
    jti: tokenId,
  });

  await audit({
    ownerId: device.owner_id,
    action: 'device_session_created',
    deviceId,
    actorType: 'device',
    actorId: deviceId,
    detail: { sessionId: session.id },
    ip: clientIp(req),
  });

  return json({
    accessToken: token,
    tokenType: 'Bearer',
    expiresIn,
    expiresAt: session.expires_at,
    sessionId: session.id,
    device,
    signaling: signalingConfig(),
  }, 200, origin);
}));
