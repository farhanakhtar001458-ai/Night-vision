import { audit, broadcast } from '../_shared/realtime.ts';
import { clientIp, HttpError, json, optionalUuid, readJson, requireUuid, serve } from '../_shared/http.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';

type Body = { deviceId?: string; delete?: boolean; sessionsOnly?: boolean; sessionId?: string };

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);
  const supabase = serviceClient();

  // Session-only revocation (used by the dashboard Security page): revoke one session or all
  // sessions of a device without revoking the device itself.
  if (body.sessionsOnly === true) {
    const sessionId = optionalUuid(body.sessionId, 'sessionId');
    const deviceId = optionalUuid(body.deviceId, 'deviceId');
    if (!sessionId && !deviceId) throw new HttpError(422, 'VALIDATION', 'sessionId or deviceId is required');

    let query = supabase.from('device_sessions').update({ revoked_at: new Date().toISOString() }, { count: 'exact' });
    query = sessionId ? query.eq('id', sessionId) : query.eq('device_id', deviceId!);
    const { error, count } = await query.eq('owner_id', user.id).is('revoked_at', null);
    if (error) throw new HttpError(500, 'DATABASE', 'Device sessions could not be revoked');

    await audit({
      ownerId: user.id,
      action: 'device_sessions_revoked',
      deviceId: deviceId,
      actorType: 'user',
      actorId: user.id,
      detail: { sessionsRevoked: count ?? 0, scope: sessionId ? 'session' : 'device' },
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return json({ revoked: true, sessionsRevoked: count ?? 0 }, 200, origin);
  }

  const deviceId = requireUuid(body.deviceId, 'deviceId');

  // Ownership check happens server-side with the service role; a foreign device id looks like 404.
  const { data: device, error } = await supabase
    .from('devices')
    .select('id, owner_id, name, status')
    .eq('id', deviceId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error) throw new HttpError(500, 'DATABASE', 'Device lookup failed');
  if (!device) throw new HttpError(404, 'NOT_FOUND', 'No such device in this account');

  const now = new Date().toISOString();
  const { error: sessionError, count } = await supabase
    .from('device_sessions')
    .update({ revoked_at: now }, { count: 'exact' })
    .eq('device_id', deviceId)
    .is('revoked_at', null);
  if (sessionError) console.warn('[revoke-device] sessions', sessionError.message);

  await supabase.from('device_credentials').update({ revoked_at: now }).eq('device_id', deviceId);

  if (body.delete === true) {
    const { error: deleteError } = await supabase.from('devices').delete().eq('id', deviceId).eq('owner_id', user.id);
    if (deleteError) throw new HttpError(500, 'DATABASE', 'Device could not be deleted');
  } else {
    const { error: updateError } = await supabase
      .from('devices')
      .update({ status: 'revoked', online: false, connection_quality: 'offline' })
      .eq('id', deviceId)
      .eq('owner_id', user.id);
    if (updateError) throw new HttpError(500, 'DATABASE', 'Device could not be revoked');
  }

  await audit({
    ownerId: user.id,
    action: body.delete === true ? 'device_deleted' : 'device_revoked',
    deviceId: body.delete === true ? null : deviceId,
    actorType: 'user',
    actorId: user.id,
    detail: { sessionsRevoked: count ?? 0, deleted: body.delete === true },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  await broadcast(`owner:${user.id}`, 'device:revoked', { deviceId, deleted: body.delete === true });
  await broadcast(`device:${deviceId}`, 'device:revoked', { deviceId, reason: 'revoked_by_owner' });

  return json({
    revoked: true,
    deleted: body.delete === true,
    sessionsRevoked: count ?? 0,
    deviceId,
  }, 200, origin);
}));
