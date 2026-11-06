import { many, one, query } from '../database/pool.js';
import { AppError } from '../utils/errors.js';
import { emit, verifiedOnline } from '../realtime/hub.js';
import { turnCredentials } from '../security/crypto.js';
import { recordActivity, recordConnectionEvent } from '../activity/service.js';
import { env } from '../config/env.js';

export type ConnectionType = 'mirror' | 'camera' | 'file' | 'control' | 'clipboard';

type ConnectionRow = {
  id: string;
  user_id: string;
  source_device_id: string;
  target_device_id: string | null;
  type: ConnectionType;
  status: string;
  requested_by: string;
  created_at: Date;
  accepted_at: Date | null;
  ended_at: Date | null;
  ended_reason: string | null;
  expires_at: Date;
};

function toPublic(row: ConnectionRow, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: row.id,
    sourceDeviceId: row.source_device_id,
    targetDeviceId: row.target_device_id,
    type: row.type,
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    endedReason: row.ended_reason,
    expiresAt: row.expires_at.toISOString(),
    ...extra,
  };
}

/** Creates a signalling session and pushes the request to the involved device(s) and owner terminals. */
export async function createConnection(
  userId: string,
  input: { sourceDeviceId: string; targetDeviceId?: string | null; type: ConnectionType },
  meta: { actorType: 'user' | 'device'; ip?: string },
): Promise<Record<string, unknown>> {
  if (input.targetDeviceId && input.targetDeviceId === input.sourceDeviceId) {
    throw new AppError('BAD_REQUEST', 'Source and target devices must differ');
  }
  const ids = [input.sourceDeviceId, ...(input.targetDeviceId ? [input.targetDeviceId] : [])];
  const owned = await many<{ id: string }>(
    `SELECT id FROM devices WHERE user_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
    [userId, ids],
  );
  if (owned.length !== ids.length) throw new AppError('NOT_FOUND', 'One or more devices are not enrolled on this account');

  const sourceOnline = await verifiedOnline(input.sourceDeviceId);
  if (!sourceOnline) throw new AppError('CONFLICT', 'Source device is offline. Wake it and try again.', { deviceId: input.sourceDeviceId });
  if (input.targetDeviceId && !(await verifiedOnline(input.targetDeviceId))) {
    throw new AppError('CONFLICT', 'Target device is offline', { deviceId: input.targetDeviceId });
  }

  const row = await one<ConnectionRow>(
    `INSERT INTO connection_sessions (user_id, source_device_id, target_device_id, type, requested_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, input.sourceDeviceId, input.targetDeviceId ?? null, input.type, meta.actorType],
  );
  if (!row) throw new AppError('INTERNAL', 'Failed to create the connection session');

  const turn = turnCredentials(`${userId}:${row.id}`);
  const event = {
    type: 'connection:request',
    connectionId: row.id,
    connectionType: row.type,
    sourceDeviceId: row.source_device_id,
    targetDeviceId: row.target_device_id,
    requestedBy: meta.actorType,
    expiresAt: row.expires_at.toISOString(),
    turn,
  };
  await emit({ deviceId: row.source_device_id }, event);
  if (row.target_device_id) await emit({ deviceId: row.target_device_id }, event);
  await emit({ ownerId: userId }, event);

  await recordActivity({
    userId,
    deviceId: row.source_device_id,
    actorType: meta.actorType,
    action: 'connection.created',
    targetType: 'connection',
    targetId: row.id,
    ip: meta.ip ?? null,
    metadata: { type: row.type, targetDeviceId: row.target_device_id },
  });
  await recordConnectionEvent({
    userId,
    deviceId: row.source_device_id,
    connectionId: row.id,
    event: 'connection_requested',
    detail: { type: row.type },
  });

  return toPublic(row, { turn });
}

export async function listConnections(userId: string, deviceId?: string): Promise<Record<string, unknown>[]> {
  const rows = await many<ConnectionRow>(
    `SELECT * FROM connection_sessions
      WHERE user_id = $1
        ${deviceId ? 'AND (source_device_id = $2 OR target_device_id = $2)' : ''}
      ORDER BY created_at DESC LIMIT 100`,
    deviceId ? [userId, deviceId] : [userId],
  );
  return rows.map((row) => toPublic(row));
}

export async function acceptConnection(userId: string, connectionId: string): Promise<Record<string, unknown>> {
  const row = await one<ConnectionRow>(
    `UPDATE connection_sessions
        SET status = 'active', accepted_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('pending')
      RETURNING *`,
    [connectionId, userId],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Pending connection not found');
  const event = { type: 'connection:accepted', connectionId: row.id, at: new Date().toISOString() };
  await emit({ ownerId: userId }, event);
  await emit({ deviceId: row.source_device_id }, event);
  if (row.target_device_id) await emit({ deviceId: row.target_device_id }, event);
  await recordConnectionEvent({
    userId,
    deviceId: row.source_device_id,
    connectionId: row.id,
    event: 'connection_accepted',
  });
  return toPublic(row, { turn: turnCredentials(`${userId}:${row.id}`) });
}

export async function terminateConnection(
  userId: string,
  connectionId: string,
  reason = 'terminated by owner',
): Promise<void> {
  const row = await one<ConnectionRow>(
    `UPDATE connection_sessions
        SET status = 'ended', ended_at = now(), ended_reason = $3
      WHERE id = $1 AND user_id = $2 AND status <> 'ended'
      RETURNING *`,
    [connectionId, userId, reason],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Active connection not found');
  const event = { type: 'connection:ended', connectionId: row.id, reason };
  await emit({ ownerId: userId }, event);
  await emit({ deviceId: row.source_device_id }, event);
  if (row.target_device_id) await emit({ deviceId: row.target_device_id }, event);
  await recordConnectionEvent({
    userId,
    deviceId: row.source_device_id,
    connectionId: row.id,
    event: 'connection_ended',
    detail: { reason },
  });
  await recordActivity({
    userId,
    actorType: 'user',
    action: 'connection.terminated',
    targetType: 'connection',
    targetId: connectionId,
    metadata: { reason },
  });
}

export async function iceServersFor(userId: string, connectionId: string): Promise<{ iceServers: unknown[]; ttl: number | null }> {
  const row = await one<{ id: string }>('SELECT id FROM connection_sessions WHERE id = $1 AND user_id = $2', [
    connectionId,
    userId,
  ]);
  if (!row) throw new AppError('NOT_FOUND', 'Connection not found');
  const turn = turnCredentials(`${userId}:${connectionId}`);
  if (!turn) {
    return {
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      ttl: null,
    };
  }
  return {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: turn.urls, username: turn.username, credential: turn.credential },
    ],
    ttl: turn.ttl,
  };
}

/** Expires stale pending sessions; called on an interval so the UI never shows ghost requests. */
export async function expireStaleConnections(): Promise<number> {
  const result = await query(
    `UPDATE connection_sessions
        SET status = 'expired', ended_at = now(), ended_reason = 'request expired'
      WHERE status = 'pending' AND expires_at < now()`,
  );
  return result.rowCount ?? 0;
}

export function publicConfig(): { turnConfigured: boolean; stunUrls: string[]; turnUrls: string[] } {
  return {
    turnConfigured: Boolean(env.TURN_SECRET && env.TURN_URLS.length > 0),
    stunUrls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    turnUrls: [...env.TURN_URLS],
  };
}
