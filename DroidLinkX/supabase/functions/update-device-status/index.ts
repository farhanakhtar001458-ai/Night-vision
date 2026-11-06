import { audit, broadcast } from '../_shared/realtime.ts';
import { clientIp, HttpError, json, readJson, serve } from '../_shared/http.ts';
import { readDeviceToken, verifyDeviceToken } from '../_shared/deviceToken.ts';
import { serviceClient } from '../_shared/supabase.ts';

type Body = {
  telemetry?: Record<string, unknown>;
  battery?: number;
  charging?: boolean;
  network?: string;
  name?: string;
  connectionQuality?: string;
};

const ALLOWED_TELEMETRY_KEYS = new Set([
  'battery', 'charging', 'network', 'ip', 'storageFreeBytes', 'storageTotalBytes', 'ramUsedBytes',
  'ramTotalBytes', 'cpu', 'screenResolution', 'uptimeSeconds', 'batteryTemperatureC', 'latencyMs',
]);

function sanitizeTelemetry(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_TELEMETRY_KEYS.has(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) output[key] = value;
  }
  return output;
}

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const claims = await verifyDeviceToken(readDeviceToken(req));
  const body = await readJson<Body>(req);
  const supabase = serviceClient();

  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('id, owner_id, status, online, name, telemetry')
    .eq('id', claims.did)
    .maybeSingle();
  if (deviceError) throw new HttpError(500, 'DATABASE', 'Device lookup failed');
  if (!device) throw new HttpError(404, 'NOT_FOUND', 'Device no longer exists');
  if (device.owner_id !== claims.sub) throw new HttpError(403, 'FORBIDDEN', 'Device ownership mismatch');
  if (device.status !== 'active') throw new HttpError(403, 'DEVICE_REVOKED', 'This device has been revoked');

  const { data: session, error: sessionError } = await supabase
    .from('device_sessions')
    .select('id, revoked_at, expires_at')
    .eq('id', claims.sid)
    .eq('device_id', claims.did)
    .maybeSingle();
  if (sessionError) throw new HttpError(500, 'DATABASE', 'Session lookup failed');
  if (!session) throw new HttpError(401, 'DEVICE_SESSION', 'Device session not found');
  if (session.revoked_at) throw new HttpError(401, 'DEVICE_SESSION', 'Device session was revoked');
  if (new Date(session.expires_at).getTime() < Date.now()) throw new HttpError(401, 'DEVICE_SESSION', 'Device session expired');

  const telemetry = { ...(device.telemetry as Record<string, unknown> ?? {}), ...sanitizeTelemetry(body.telemetry) };
  if (typeof body.battery === 'number') telemetry.battery = Math.max(0, Math.min(100, Math.round(body.battery)));
  if (typeof body.charging === 'boolean') telemetry.charging = body.charging;
  if (typeof body.network === 'string') telemetry.network = body.network.slice(0, 32);

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('devices')
    .update({
      telemetry,
      online: true,
      last_seen_at: now,
      connection_quality: body.connectionQuality?.slice(0, 20) ?? 'good',
    })
    .eq('id', claims.did);
  if (updateError) throw new HttpError(500, 'DATABASE', 'Device status could not be updated');

  await supabase.from('device_sessions').update({ last_heartbeat_at: now }).eq('id', claims.sid);

  if (!device.online) {
    await audit({
      ownerId: device.owner_id,
      action: 'device_online',
      deviceId: device.id,
      actorType: 'device',
      actorId: device.id,
      detail: { sessionId: claims.sid },
      ip: clientIp(req),
    });
  }

  await broadcast(`owner:${device.owner_id}`, 'device:status', {
    deviceId: device.id,
    online: true,
    telemetry,
    lastSeenAt: now,
    at: now,
  });
  await broadcast(`device:${device.id}`, 'device:status:ack', { at: now });

  return json({ ok: true, serverTime: now, deviceId: device.id, telemetry }, 200, origin);
}));
