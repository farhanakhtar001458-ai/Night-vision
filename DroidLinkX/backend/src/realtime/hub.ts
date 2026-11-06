import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { cache } from '../store/cache.js';
import { query } from '../database/pool.js';
import { logger } from '../utils/logger.js';

export type SocketRole = 'user' | 'device';

export type SocketMeta = {
  socket: WebSocket;
  role: SocketRole;
  ownerId: string;
  /** Present for role=device. */
  deviceId?: string;
  sessionId?: string;
  connectionId?: string;
  connectedAt: number;
  lastHeartbeatAt: number;
  alive: boolean;
};

const INSTANCE_ID = randomUUID();
const FANOUT_CHANNEL = 'ws:fanout';
const HEARTBEAT_TTL_SECONDS = 90;

const sockets = new Map<string, SocketMeta>();

type FanoutEnvelope = {
  instanceId: string;
  target: { ownerId?: string; deviceId?: string; excludeSocketId?: string };
  event: Record<string, unknown> & { type: string };
};

let unsubscribe: (() => void) | null = null;

export function socketCount(): number {
  return sockets.size;
}

export function registerSocket(id: string, meta: SocketMeta): void {
  sockets.set(id, meta);
}

export function unregisterSocket(id: string): SocketMeta | undefined {
  const meta = sockets.get(id);
  sockets.delete(id);
  return meta;
}

export function getSocket(id: string): SocketMeta | undefined {
  return sockets.get(id);
}

function deliverLocal(target: FanoutEnvelope['target'], event: Record<string, unknown>): number {
  let delivered = 0;
  for (const [id, meta] of sockets) {
    if (target.excludeSocketId && id === target.excludeSocketId) continue;
    if (target.ownerId && meta.ownerId !== target.ownerId) continue;
    // Owner-scoped events are for the owner's terminals (dashboard/app UI), never for device agents;
    // devices receive their own events through an explicit deviceId target.
    if (target.ownerId && !target.deviceId && meta.role !== 'user') continue;
    if (target.deviceId && meta.deviceId !== target.deviceId) continue;
    if (target.deviceId && meta.role !== 'device' && !target.ownerId) continue;
    if (meta.socket.readyState !== meta.socket.OPEN) continue;
    try {
      meta.socket.send(JSON.stringify(event));
      delivered += 1;
    } catch (err) {
      logger.warn({ err, socketId: id }, 'failed to write to socket');
    }
  }
  return delivered;
}

/**
 * Delivers an event to matching local sockets and (through the cache pub/sub channel)
 * to sockets held by other backend instances. Never throws.
 */
export async function emit(
  target: { ownerId?: string; deviceId?: string; excludeSocketId?: string },
  event: Record<string, unknown> & { type: string },
): Promise<void> {
  try {
    deliverLocal(target, event);
    const envelope: FanoutEnvelope = { instanceId: INSTANCE_ID, target, event };
    await cache().publish(FANOUT_CHANNEL, JSON.stringify(envelope));
  } catch (err) {
    logger.warn({ err, event: event.type }, 'fanout failed');
  }
}

export async function startFanoutListener(): Promise<void> {
  if (unsubscribe) return;
  unsubscribe = await cache().subscribe(FANOUT_CHANNEL, (payload) => {
    try {
      const envelope = JSON.parse(payload) as FanoutEnvelope;
      if (envelope.instanceId === INSTANCE_ID) return;
      deliverLocal(envelope.target, envelope.event);
    } catch {
      /* ignore malformed fanout messages */
    }
  });
}

export async function stopFanoutListener(): Promise<void> {
  unsubscribe?.();
  unsubscribe = null;
}

export function closeOwnerSockets(ownerId: string, code = 4403, reason = 'revoked'): void {
  for (const meta of sockets.values()) {
    if (meta.ownerId === ownerId) {
      try {
        meta.socket.close(code, reason);
      } catch {
        /* already closed */
      }
    }
  }
}

export function closeDeviceSockets(deviceId: string, code = 4403, reason = 'device revoked'): void {
  for (const meta of sockets.values()) {
    if (meta.deviceId === deviceId) {
      try {
        meta.socket.close(code, reason);
      } catch {
        /* already closed */
      }
    }
  }
}

export function isDeviceSocketConnected(deviceId: string): boolean {
  for (const meta of sockets.values()) {
    if (meta.deviceId === deviceId && meta.socket.readyState === meta.socket.OPEN) return true;
  }
  return false;
}

export type PresenceRecord = { connectionId: string; lastHeartbeatAt: number; sessionId: string };

/**
 * Marks a device online only after its authenticated WebSocket has completed the
 * handshake, and keeps a TTL'd presence record that dies if heartbeats stop.
 */
export async function markDeviceOnline(deviceId: string, connectionId: string, sessionId: string): Promise<void> {
  await cache().set(
    `presence:device:${deviceId}`,
    JSON.stringify({ connectionId, lastHeartbeatAt: Date.now(), sessionId } satisfies PresenceRecord),
    HEARTBEAT_TTL_SECONDS,
  );
  await query(
    `UPDATE devices SET online = true, last_seen_at = now(), updated_at = now() WHERE id = $1 AND status = 'active'`,
    [deviceId],
  );
}

export async function touchPresence(deviceId: string): Promise<void> {
  const raw = await cache().get(`presence:device:${deviceId}`);
  if (raw) {
    const record = JSON.parse(raw) as PresenceRecord;
    record.lastHeartbeatAt = Date.now();
    await cache().set(`presence:device:${deviceId}`, JSON.stringify(record), HEARTBEAT_TTL_SECONDS);
  }
  await query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [deviceId]);
}

export async function markDeviceOffline(deviceId: string): Promise<boolean> {
  if (isDeviceSocketConnected(deviceId)) return false; // another live socket still owns presence
  await cache().del(`presence:device:${deviceId}`);
  await query(
    `UPDATE devices SET online = false, last_seen_at = now(), updated_at = now() WHERE id = $1 AND online = true`,
    [deviceId],
  );
  return true;
}

export async function readPresence(deviceId: string): Promise<PresenceRecord | null> {
  const raw = await cache().get(`presence:device:${deviceId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PresenceRecord;
  } catch {
    return null;
  }
}

export async function verifiedOnline(deviceId: string): Promise<boolean> {
  return (await readPresence(deviceId)) !== null && isDeviceSocketConnected(deviceId);
}

export function listDeviceConnectionIds(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const meta of sockets.values()) {
    if (meta.deviceId) counts.set(meta.deviceId, (counts.get(meta.deviceId) ?? 0) + 1);
  }
  return counts;
}
