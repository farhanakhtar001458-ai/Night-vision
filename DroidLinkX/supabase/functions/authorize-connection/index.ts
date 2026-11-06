import { audit, broadcast } from '../_shared/realtime.ts';
import { clientIp, HttpError, json, optionalUuid, readJson, requireString, requireUuid, serve } from '../_shared/http.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { iceServers, signalingConfig } from '../_shared/turn.ts';

type Body = {
  sourceDeviceId?: string;
  targetDeviceId?: string | null;
  type?: string;
  /** When present, the function only mints ICE credentials for an existing session. */
  connectionId?: string;
};

const TYPES = new Set(['mirror', 'camera', 'file', 'control', 'clipboard']);

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);

  if (body.connectionId) {
    const connectionId = requireUuid(body.connectionId, 'connectionId');
    const supabase = serviceClient();
    const { data: existing } = await supabase
      .from('connection_sessions')
      .select('*')
      .eq('id', connectionId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
    if (existing.status === 'ended' || existing.status === 'rejected') {
      throw new HttpError(409, 'CONNECTION_CLOSED', `Connection is ${existing.status}`);
    }
    const ice = await iceServers(existing.id);
    return json({ connection: existing, ...ice, signaling: signalingConfig() }, 200, origin);
  }

  const sourceDeviceId = requireUuid(body.sourceDeviceId, 'sourceDeviceId');
  const targetDeviceId = optionalUuid(body.targetDeviceId, 'targetDeviceId');
  const type = requireString(body.type, 'type', 20);
  if (!TYPES.has(type)) throw new HttpError(422, 'VALIDATION', `type must be one of ${[...TYPES].join(', ')}`);
  if (targetDeviceId === sourceDeviceId) throw new HttpError(422, 'VALIDATION', 'Source and target devices must differ');

  const supabase = serviceClient();
  const ids = targetDeviceId ? [sourceDeviceId, targetDeviceId] : [sourceDeviceId];

  // Ownership + liveness validation happens on the server, never in the client.
  const { data: devices, error } = await supabase
    .from('devices')
    .select('id, owner_id, name, status')
    .in('id', ids);
  if (error) throw new HttpError(500, 'DATABASE', 'Device lookup failed');
  if (!devices || devices.length !== ids.length) throw new HttpError(404, 'NOT_FOUND', 'One of the devices is not in this account');
  if (devices.some((device) => device.owner_id !== user.id)) throw new HttpError(403, 'FORBIDDEN', 'Devices belong to another account');
  if (devices.some((device) => device.status !== 'active')) throw new HttpError(409, 'DEVICE_REVOKED', 'A revoked device cannot start a session');

  const { data: permissions, error: permissionError } = await supabase
    .from('device_permissions')
    .select('device_id, permission, granted')
    .eq('device_id', targetDeviceId ?? sourceDeviceId);
  if (permissionError) throw new HttpError(500, 'DATABASE', 'Permission lookup failed');
  const requiredPermission = type === 'mirror' ? 'screen_capture' : type === 'camera' ? 'camera' : type === 'control' ? 'remote_control' : null;
  if (requiredPermission) {
    const granted = permissions?.find((row) => row.permission === requiredPermission)?.granted === true;
    if (!granted) {
      throw new HttpError(403, 'PERMISSION_DENIED', `The ${requiredPermission.replace('_', ' ')} capability is disabled for this device`);
    }
  }

  // Idempotency: reuse a live session of the same type instead of spamming the device.
  const { data: existing } = await supabase
    .from('connection_sessions')
    .select('*')
    .eq('owner_id', user.id)
    .eq('source_device_id', sourceDeviceId)
    .eq('type', type)
    .in('status', ['pending', 'accepted', 'active'])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const ice = await iceServers(existing.id);
    return json({ connection: existing, ...ice, signaling: signalingConfig(), reused: true }, 200, origin);
  }

  const { data: connection, error: insertError } = await supabase
    .from('connection_sessions')
    .insert({
      owner_id: user.id,
      source_device_id: sourceDeviceId,
      target_device_id: targetDeviceId,
      type,
      status: 'pending',
      requested_by: 'user',
    })
    .select('*')
    .single();
  if (insertError || !connection) {
    console.error('[authorize-connection] insert failed', insertError);
    throw new HttpError(500, 'DATABASE', 'Connection session could not be created');
  }

  await supabase.from('connection_events').insert({
    connection_id: connection.id,
    owner_id: user.id,
    device_id: targetDeviceId ?? sourceDeviceId,
    event: 'connection_requested',
    detail: { type, requestedBy: 'user' },
  });

  await audit({
    ownerId: user.id,
    action: 'connection_requested',
    deviceId: targetDeviceId ?? sourceDeviceId,
    actorType: 'user',
    actorId: user.id,
    detail: { connectionId: connection.id, type },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  await broadcast(`owner:${user.id}`, 'connection:request', {
    connectionId: connection.id,
    type,
    sourceDeviceId,
    targetDeviceId,
    requestedBy: 'user',
  });
  if (targetDeviceId) {
    await broadcast(`device:${targetDeviceId}`, 'connection:request', {
      connectionId: connection.id,
      type,
      sourceDeviceId,
      requestedBy: 'user',
    });
  }

  const ice = await iceServers(connection.id);
  return json({
    connection,
    ...ice,
    signaling: signalingConfig(),
  }, 201, origin);
}));
