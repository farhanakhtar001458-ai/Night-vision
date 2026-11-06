import { randomUUID } from 'node:crypto';
import { many, one, query } from '../database/pool.js';
import { hashSecret, randomToken, verifySecret } from '../security/crypto.js';
import { signAccessToken } from '../security/tokens.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { recordActivity, recordConnectionEvent } from '../activity/service.js';
import { cache } from '../store/cache.js';
import { closeDeviceSockets, readPresence, verifiedOnline } from '../realtime/hub.js';

export const DEVICE_PERMISSIONS = [
  'screen_capture',
  'camera',
  'notifications',
  'clipboard',
  'files',
  'remote_control',
] as const;

export type DevicePermission = (typeof DEVICE_PERMISSIONS)[number];

type DeviceRow = {
  id: string;
  user_id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  android_version: string | null;
  sdk_int: number | null;
  app_version: string | null;
  platform: string;
  status: string;
  trusted: boolean;
  online: boolean;
  last_seen_at: Date | null;
  telemetry: Record<string, unknown>;
  created_at: Date;
  revoked_at: Date | null;
};

export type PublicDevice = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  sdkInt: number | null;
  appVersion: string | null;
  platform: string;
  status: string;
  trusted: boolean;
  online: boolean;
  connectionQuality: string;
  lastSeenAt: string | null;
  createdAt: string;
  telemetry: Record<string, unknown>;
  permissions: Record<string, boolean>;
};

function qualityFor(online: boolean, telemetry: Record<string, unknown>): string {
  if (!online) return 'offline';
  const latency = typeof telemetry.latencyMs === 'number' ? telemetry.latencyMs : null;
  const network = typeof telemetry.network === 'string' ? telemetry.network : '';
  if (latency !== null) {
    if (latency < 80) return 'excellent';
    if (latency < 160) return 'good';
    if (latency < 320) return 'fair';
    return 'poor';
  }
  if (network.toLowerCase().includes('wifi')) return 'good';
  if (network) return 'fair';
  return 'unknown';
}

async function permissionsFor(deviceIds: string[]): Promise<Map<string, Record<string, boolean>>> {
  const map = new Map<string, Record<string, boolean>>();
  if (deviceIds.length === 0) return map;
  const rows = await many<{ device_id: string; permission: string; granted: boolean }>(
    'SELECT device_id, permission, granted FROM device_permissions WHERE device_id = ANY($1::uuid[])',
    [deviceIds],
  );
  for (const row of rows) {
    const current = map.get(row.device_id) ?? {};
    current[row.permission] = row.granted;
    map.set(row.device_id, current);
  }
  return map;
}

function toPublic(row: DeviceRow, online: boolean, permissions: Record<string, boolean>): PublicDevice {
  const telemetry = row.telemetry ?? {};
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    androidVersion: row.android_version,
    sdkInt: row.sdk_int,
    appVersion: row.app_version,
    platform: row.platform,
    status: row.status,
    trusted: row.trusted,
    online,
    connectionQuality: qualityFor(online, telemetry),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    telemetry,
    permissions,
  };
}

export async function enrollDevice(
  userId: string,
  input: {
    name: string;
    manufacturer?: string;
    model?: string;
    androidVersion?: string;
    sdkInt?: number;
    appVersion?: string;
    platform?: string;
  },
  meta: { ip?: string },
): Promise<{ device: PublicDevice; deviceId: string; deviceSecret: string; wsUrl: string }> {
  const deviceSecret = randomToken(32);
  const secretHash = await hashSecret(deviceSecret);

  const row = await one<DeviceRow>(
    `INSERT INTO devices (user_id, name, manufacturer, model, android_version, sdk_int, app_version, platform, last_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId,
      input.name.trim().slice(0, 100),
      input.manufacturer?.slice(0, 100) ?? null,
      input.model?.slice(0, 100) ?? null,
      input.androidVersion?.slice(0, 40) ?? null,
      input.sdkInt ?? null,
      input.appVersion?.slice(0, 40) ?? null,
      input.platform ?? 'android',
      meta.ip ?? null,
    ],
  );
  if (!row) throw new AppError('INTERNAL', 'Failed to enroll the device');

  await query('INSERT INTO device_credentials (device_id, secret_hash, label) VALUES ($1, $2, $3)', [
    row.id,
    secretHash,
    'primary',
  ]);
  await recordActivity({
    userId,
    deviceId: row.id,
    actorType: 'user',
    action: 'device.enrolled',
    targetType: 'device',
    targetId: row.id,
    ip: meta.ip ?? null,
    metadata: { name: row.name, model: row.model },
  });
  await recordConnectionEvent({ userId, deviceId: row.id, event: 'enrolled' });

  return {
    device: toPublic(row, false, {}),
    deviceId: row.id,
    // Returned exactly once. The Android client stores it in the Keystore-backed vault.
    deviceSecret,
    wsUrl: `${env.PUBLIC_BASE_URL.replace(/^http/, 'ws')}/ws`,
  };
}

export async function issueDeviceSession(
  input: { deviceId: string; deviceSecret: string },
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; expiresIn: number; tokenType: 'Bearer'; device: PublicDevice; wsUrl: string; sessionId: string }> {
  const device = await one<DeviceRow>('SELECT * FROM devices WHERE id = $1', [input.deviceId]);
  if (!device) throw new AppError('UNAUTHORIZED', 'Unknown device or secret');
  if (device.status !== 'active' || device.revoked_at) throw new AppError('FORBIDDEN', 'This device has been revoked');

  const credential = await one<{ id: string; secret_hash: string }>(
    `SELECT id, secret_hash FROM device_credentials
      WHERE device_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [device.id],
  );
  if (!credential) throw new AppError('UNAUTHORIZED', 'No active credential for this device');

  const valid = await verifySecret(input.deviceSecret, credential.secret_hash);
  if (!valid) {
    await recordActivity({
      userId: device.user_id,
      deviceId: device.id,
      actorType: 'device',
      action: 'device.auth_failed',
      targetType: 'device',
      targetId: device.id,
      ip: meta.ip ?? null,
    });
    throw new AppError('UNAUTHORIZED', 'Unknown device or secret');
  }

  await query('UPDATE device_credentials SET last_used_at = now() WHERE id = $1', [credential.id]);

  const sessionId = randomUUID();
  const jti = randomUUID();
  await query(
    `INSERT INTO device_sessions (id, device_id, user_id, token_jti, ip, user_agent, state, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', now())`,
    [sessionId, device.id, device.user_id, jti, meta.ip ?? null, meta.userAgent ?? null],
  );

  const { token, expiresIn } = signAccessToken({
    sub: device.id,
    uid: device.user_id,
    typ: 'device',
    jti,
    sid: sessionId,
  });

  await query('UPDATE devices SET last_seen_at = now(), last_ip = $2 WHERE id = $1', [device.id, meta.ip ?? null]);
  await recordActivity({
    userId: device.user_id,
    deviceId: device.id,
    actorType: 'device',
    action: 'device.session_started',
    targetType: 'device_session',
    targetId: sessionId,
    ip: meta.ip ?? null,
  });

  const perms = await permissionsFor([device.id]);
  const online = await verifiedOnline(device.id);
  return {
    accessToken: token,
    expiresIn,
    tokenType: 'Bearer',
    device: toPublic(device, online, perms.get(device.id) ?? {}),
    wsUrl: `${env.PUBLIC_BASE_URL.replace(/^http/, 'ws')}/ws`,
    sessionId,
  };
}

export async function listDevices(userId: string): Promise<PublicDevice[]> {
  const rows = await many<DeviceRow>(
    `SELECT * FROM devices WHERE user_id = $1 AND status = 'active' ORDER BY created_at ASC`,
    [userId],
  );
  const perms = await permissionsFor(rows.map((r) => r.id));
  const devices: PublicDevice[] = [];
  for (const row of rows) {
    const presence = await readPresence(row.id);
    const online = presence !== null && (await verifiedOnline(row.id));
    if (online !== row.online) {
      await query('UPDATE devices SET online = $2 WHERE id = $1', [row.id, online]);
    }
    devices.push(toPublic(row, online, perms.get(row.id) ?? {}));
  }
  return devices;
}

export async function getDevice(userId: string, deviceId: string): Promise<PublicDevice> {
  const row = await one<DeviceRow>('SELECT * FROM devices WHERE id = $1 AND user_id = $2', [deviceId, userId]);
  if (!row) throw new AppError('NOT_FOUND', 'Device not found');
  const perms = await permissionsFor([row.id]);
  return toPublic(row, await verifiedOnline(row.id), perms.get(row.id) ?? {});
}

export async function updateDevice(
  userId: string,
  deviceId: string,
  input: { name?: string; trusted?: boolean },
): Promise<PublicDevice> {
  const row = await one<DeviceRow>(
    `UPDATE devices
        SET name = COALESCE($3, name), trusted = COALESCE($4, trusted), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'active'
      RETURNING *`,
    [deviceId, userId, input.name?.trim().slice(0, 100) ?? null, input.trusted ?? null],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Device not found');
  await recordActivity({
    userId,
    deviceId,
    actorType: 'user',
    action: 'device.updated',
    targetType: 'device',
    targetId: deviceId,
    metadata: input,
  });
  const perms = await permissionsFor([deviceId]);
  return toPublic(row, await verifiedOnline(deviceId), perms.get(deviceId) ?? {});
}

export async function updateDeviceStatus(
  deviceId: string,
  input: { telemetry?: Record<string, unknown>; name?: string },
): Promise<PublicDevice> {
  const row = await one<DeviceRow>(
    `UPDATE devices
        SET telemetry = CASE WHEN $2::jsonb IS NULL THEN telemetry ELSE COALESCE(telemetry, '{}'::jsonb) || $2::jsonb END,
            name = COALESCE($3, name),
            last_seen_at = now(),
            updated_at = now()
      WHERE id = $1 AND status = 'active'
      RETURNING *`,
    [deviceId, input.telemetry ? JSON.stringify(input.telemetry) : null, input.name ?? null],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Device not found');
  const perms = await permissionsFor([deviceId]);
  return toPublic(row, await verifiedOnline(deviceId), perms.get(deviceId) ?? {});
}

export async function revokeDevice(userId: string, deviceId: string, reason = 'owner revoked'): Promise<void> {
  const row = await one<{ id: string }>(
    `UPDATE devices
        SET status = 'revoked', revoked_at = now(), revoked_reason = $3, online = false, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'active'
      RETURNING id`,
    [deviceId, userId, reason],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Device not found');
  await query('UPDATE device_credentials SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
  await query(
    `UPDATE device_sessions SET state = 'revoked', ended_at = now(), ended_reason = $2
      WHERE device_id = $1 AND state = 'active'`,
    [deviceId, reason],
  );
  await cache().set(`revoked:device:${deviceId}`, '1', 60 * 60 * 24 * 30);
  closeDeviceSockets(deviceId, 4403, 'device revoked');
  await recordActivity({
    userId,
    deviceId,
    actorType: 'user',
    action: 'device.revoked',
    targetType: 'device',
    targetId: deviceId,
    metadata: { reason },
  });
  await recordConnectionEvent({ userId, deviceId, event: 'revoked', detail: { reason } });
}

export async function rotateDeviceSecret(userId: string, deviceId: string): Promise<{ deviceSecret: string }> {
  const row = await one<{ id: string }>('SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND status = $3', [
    deviceId,
    userId,
    'active',
  ]);
  if (!row) throw new AppError('NOT_FOUND', 'Device not found');
  const secret = randomToken(32);
  await query('UPDATE device_credentials SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
  await query('INSERT INTO device_credentials (device_id, secret_hash, label) VALUES ($1, $2, $3)', [
    deviceId,
    await hashSecret(secret),
    'primary',
  ]);
  closeDeviceSockets(deviceId, 4401, 'credential rotated');
  await recordActivity({
    userId,
    deviceId,
    actorType: 'user',
    action: 'device.credential_rotated',
    targetType: 'device',
    targetId: deviceId,
  });
  return { deviceSecret: secret };
}

export async function revokeDeviceSessions(userId: string, deviceId: string, reason = 'sessions revoked'): Promise<number> {
  const owned = await one<{ id: string }>('SELECT id FROM devices WHERE id = $1 AND user_id = $2', [deviceId, userId]);
  if (!owned) throw new AppError('NOT_FOUND', 'Device not found');
  const result = await query(
    `UPDATE device_sessions SET state = 'revoked', ended_at = now(), ended_reason = $2
      WHERE device_id = $1 AND state = 'active'`,
    [deviceId, reason],
  );
  closeDeviceSockets(deviceId, 4401, reason);
  await recordActivity({
    userId,
    deviceId,
    actorType: 'user',
    action: 'device.sessions_revoked',
    targetType: 'device',
    targetId: deviceId,
    metadata: { count: result.rowCount },
  });
  return result.rowCount ?? 0;
}

export async function listSessions(userId: string, deviceId?: string): Promise<unknown[]> {
  const rows = await many(
    `SELECT s.id, s.device_id, s.state, s.ip, s.user_agent, s.started_at, s.last_heartbeat_at, s.ended_at, s.ended_reason,
            d.name AS device_name, d.online
       FROM device_sessions s
       JOIN devices d ON d.id = s.device_id
      WHERE s.user_id = $1 ${deviceId ? 'AND s.device_id = $2' : ''}
      ORDER BY s.started_at DESC
      LIMIT 200`,
    deviceId ? [userId, deviceId] : [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.device_id,
    deviceName: r.device_name,
    state: r.state,
    online: r.online,
    ip: r.ip,
    userAgent: r.user_agent,
    startedAt: r.started_at,
    lastHeartbeatAt: r.last_heartbeat_at,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const row = await one<{ device_id: string }>(
    `UPDATE device_sessions SET state = 'revoked', ended_at = now(), ended_reason = 'owner revoked'
      WHERE id = $1 AND user_id = $2 AND state = 'active'
      RETURNING device_id`,
    [sessionId, userId],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Session not found or already closed');
  await cache().set(`revoked:device:${sessionId}`, '1', 60 * 60 * 24 * 7);
  const remaining = await one<{ count: number }>(
    `SELECT count(*)::int AS count FROM device_sessions WHERE device_id = $1 AND state = 'active'`,
    [row.device_id],
  );
  if ((remaining?.count ?? 0) === 0) closeDeviceSockets(row.device_id, 4401, 'session revoked');
  await recordActivity({
    userId,
    deviceId: row.device_id,
    actorType: 'user',
    action: 'session.revoked',
    targetType: 'device_session',
    targetId: sessionId,
  });
}

export async function connectionHistory(userId: string, deviceId: string, limit = 50): Promise<unknown[]> {
  const rows = await many(
    `SELECT id, connection_id, event, detail, created_at
       FROM connection_events
      WHERE user_id = $1 AND device_id = $2
      ORDER BY created_at DESC LIMIT $3`,
    [userId, deviceId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    event: r.event,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

export async function getPermissions(userId: string, deviceId: string): Promise<Record<string, boolean>> {
  await getDevice(userId, deviceId);
  const perms = await permissionsFor([deviceId]);
  return perms.get(deviceId) ?? {};
}

export async function setPermission(
  userId: string,
  deviceId: string,
  permission: DevicePermission,
  granted: boolean,
): Promise<Record<string, boolean>> {
  await getDevice(userId, deviceId);
  await query(
    `INSERT INTO device_permissions (device_id, permission, granted, granted_at, updated_at)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END, now())
     ON CONFLICT (device_id, permission)
     DO UPDATE SET granted = EXCLUDED.granted,
                   granted_at = CASE WHEN EXCLUDED.granted THEN now() ELSE device_permissions.granted_at END,
                   updated_at = now()`,
    [deviceId, permission, granted],
  );
  await recordActivity({
    userId,
    deviceId,
    actorType: 'user',
    action: 'device.permission_changed',
    targetType: 'device',
    targetId: deviceId,
    metadata: { permission, granted },
  });
  return getPermissionsAfterUpdate(deviceId);
}

async function getPermissionsAfterUpdate(deviceId: string): Promise<Record<string, boolean>> {
  const perms = await permissionsFor([deviceId]);
  return perms.get(deviceId) ?? {};
}
