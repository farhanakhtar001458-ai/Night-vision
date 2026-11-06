import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { tryVerifyAccessToken, type AccessTokenPayload } from '../security/tokens.js';
import { one, query } from '../database/pool.js';
import { recordActivity, recordConnectionEvent } from '../activity/service.js';
import { clientEventSchema, type ClientEvent } from './protocol.js';
import {
  emit,
  isDeviceSocketConnected,
  markDeviceOffline,
  markDeviceOnline,
  registerSocket,
  touchPresence,
  unregisterSocket,
  verifiedOnline,
} from '../realtime/hub.js';
import { logger } from '../utils/logger.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

type AuthenticatedSocket = {
  ws: WebSocket;
  id: string;
  payload: AccessTokenPayload;
  role: 'user' | 'device';
};

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const heartbeatTimer = setInterval(() => {
  for (const client of wss.clients) {
    /* handled per-socket below */
    if (client.readyState === client.OPEN) {
      try {
        client.ping();
      } catch {
        /* ignore */
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref?.();

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: { code: 'UNAUTHORIZED', message } });
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // native Android / server-to-server clients do not send Origin
  return env.CORS_ORIGINS.includes(origin) || env.CORS_ORIGINS.includes('*');
}

async function authenticate(
  url: URL,
): Promise<{ payload: AccessTokenPayload; role: 'user' | 'device'; sessionId?: string } | { error: string }> {
  const token = url.searchParams.get('token');
  const role = (url.searchParams.get('role') ?? 'user') as 'user' | 'device';
  if (!token) return { error: 'Missing token' };
  if (role !== 'user' && role !== 'device') return { error: 'Invalid role' };
  const payload = tryVerifyAccessToken(token, role);
  if (!payload) return { error: 'Invalid or expired token' };

  if (role === 'device') {
    const session = await one<{ id: string; state: string }>(
      `SELECT s.id, s.state
         FROM device_sessions s
         JOIN devices d ON d.id = s.device_id
        WHERE s.id = $1 AND s.device_id = $2 AND d.status = 'active' AND d.revoked_at IS NULL`,
      [payload.sid ?? '', payload.sub],
    );
    if (!session || session.state !== 'active') return { error: 'Device session is not active' };
    return { payload, role, sessionId: session.id };
  }

  const user = await one<{ status: string }>('SELECT status FROM users WHERE id = $1', [payload.uid]);
  if (!user || user.status !== 'active') return { error: 'Account is not active' };
  return { payload, role };
}

async function handleDeviceOnline(auth: AuthenticatedSocket, connectionId: string): Promise<void> {
  const deviceId = auth.payload.sub;
  await markDeviceOnline(deviceId, connectionId, auth.payload.sid ?? '');
  await recordConnectionEvent({
    userId: auth.payload.uid,
    deviceId,
    connectionId,
    event: 'ws_connected',
    detail: { online: true },
  });
  await emit({ ownerId: auth.payload.uid }, {
    type: 'device:online',
    deviceId,
    connectionId,
    at: new Date().toISOString(),
  });
  if (isDeviceSocketConnected(deviceId)) {
    await query('UPDATE device_sessions SET last_heartbeat_at = now() WHERE id = $1', [auth.payload.sid ?? '']);
  }
}

async function handleDeviceOffline(auth: AuthenticatedSocket, connectionId: string): Promise<void> {
  const wentOffline = await markDeviceOffline(auth.payload.sub);
  await recordConnectionEvent({
    userId: auth.payload.uid,
    deviceId: auth.payload.sub,
    connectionId,
    event: 'ws_disconnected',
    detail: { online: false },
  });
  if (wentOffline) {
    await emit({ ownerId: auth.payload.uid }, {
      type: 'device:offline',
      deviceId: auth.payload.sub,
      at: new Date().toISOString(),
    });
  }
}

async function presenceSnapshot(ownerId: string): Promise<Array<{ deviceId: string; online: boolean }>> {
  const rows = await query<{ id: string; online: boolean }>(
    `SELECT id, online FROM devices WHERE user_id = $1 AND status = 'active'`,
    [ownerId],
  );
  const snapshot: Array<{ deviceId: string; online: boolean }> = [];
  for (const row of rows.rows) {
    const online = await verifiedOnline(row.id);
    if (online !== row.online) {
      await query('UPDATE devices SET online = $2 WHERE id = $1', [row.id, online]);
    }
    snapshot.push({ deviceId: row.id, online });
  }
  return snapshot;
}

async function assertConnectionParticipant(
  connectionId: string,
  auth: AuthenticatedSocket,
): Promise<{ id: string; source: string; target: string | null; ownerId: string; status: string; type: string } | null> {
  const row = await one<{
    id: string;
    source_device_id: string;
    target_device_id: string | null;
    user_id: string;
    status: string;
    type: string;
  }>(
    `SELECT id, source_device_id, target_device_id, user_id, status, type
       FROM connection_sessions WHERE id = $1`,
    [connectionId],
  );
  if (!row) return null;
  if (auth.role === 'device' && auth.payload.sub !== row.source_device_id && auth.payload.sub !== row.target_device_id) {
    return null;
  }
  if (auth.role === 'user' && auth.payload.uid !== row.user_id) return null;
  return { id: row.id, source: row.source_device_id, target: row.target_device_id, ownerId: row.user_id, status: row.status, type: row.type };
}

/** Forward signalling to every participant of a connection except the sender, plus the owner's terminals. */
async function relayToParticipants(
  connection: { source: string; target: string | null; ownerId: string },
  senderSocketId: string,
  event: Record<string, unknown> & { type: string },
): Promise<void> {
  const deviceIds = [connection.source, connection.target].filter((v): v is string => Boolean(v));
  for (const deviceId of deviceIds) {
    await emit({ deviceId, excludeSocketId: senderSocketId }, event);
  }
  await emit({ ownerId: connection.ownerId, excludeSocketId: senderSocketId }, event);
}

async function onClientEvent(auth: AuthenticatedSocket, event: ClientEvent): Promise<void> {
  switch (event.type) {
    case 'ping':
      auth.ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      return;

    case 'device:heartbeat':
    case 'device:status': {
      if (auth.role !== 'device') return;
      await touchPresence(auth.payload.sub);
      const telemetryPatch: Record<string, unknown> = {};
      if (event.battery !== undefined) telemetryPatch.battery = event.battery;
      if (event.charging !== undefined) telemetryPatch.charging = event.charging;
      if (event.network !== undefined) telemetryPatch.network = event.network;
      if ('telemetry' in event && event.telemetry) Object.assign(telemetryPatch, event.telemetry);
      if (Object.keys(telemetryPatch).length > 0) {
        await query(
          `UPDATE devices
              SET telemetry = COALESCE(telemetry, '{}'::jsonb) || $2::jsonb,
                  last_seen_at = now(),
                  updated_at = now()
            WHERE id = $1`,
          [auth.payload.sub, JSON.stringify(telemetryPatch)],
        );
      }
      if (auth.payload.sid) {
        await query('UPDATE device_sessions SET last_heartbeat_at = now() WHERE id = $1', [auth.payload.sid]);
      }
      await emit({ ownerId: auth.payload.uid }, {
        type: 'device:heartbeat',
        deviceId: auth.payload.sub,
        battery: event.battery ?? null,
        charging: 'charging' in event ? (event as { charging?: boolean }).charging ?? null : null,
        network: 'network' in event ? (event as { network?: string }).network ?? null : null,
        at: new Date().toISOString(),
      });
      return;
    }

    case 'connection:request': {
      const ownerId = auth.payload.uid;
      let sourceDeviceId: string;
      let targetDeviceId: string | null = null;

      if (auth.role === 'device') {
        sourceDeviceId = auth.payload.sub;
        targetDeviceId = event.targetDeviceId ?? null;
      } else {
        if (!event.targetDeviceId) throw new Error('targetDeviceId is required for owner-initiated requests');
        sourceDeviceId = event.targetDeviceId;
      }
      if (targetDeviceId === sourceDeviceId) throw new Error('Source and target devices must differ');

      const devices = await query<{ id: string; online: boolean }>(
        `SELECT id, online FROM devices WHERE user_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
        [ownerId, [sourceDeviceId, ...(targetDeviceId ? [targetDeviceId] : [])]],
      );
      if (devices.rows.length !== (targetDeviceId ? 2 : 1)) throw new Error('Device not found for this account');
      const sourceOnline = await verifiedOnline(sourceDeviceId);
      if (!sourceOnline) throw new Error('Source device is offline');
      if (targetDeviceId && !(await verifiedOnline(targetDeviceId))) throw new Error('Target device is offline');

      const inserted = await one<{ id: string; type: string; expires_at: string }>(
        `INSERT INTO connection_sessions (user_id, source_device_id, target_device_id, type, requested_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, type, expires_at`,
        [ownerId, sourceDeviceId, targetDeviceId, event.connectionType, auth.role === 'device' ? 'device' : 'user'],
      );
      if (!inserted) throw new Error('Failed to create the connection session');
      const payload = {
        type: 'connection:request',
        connectionId: inserted.id,
        connectionType: inserted.type,
        sourceDeviceId,
        targetDeviceId,
        requestedBy: auth.role === 'device' ? 'device' : 'user',
        expiresAt: inserted.expires_at,
        turn: null,
      };
      await emit({ deviceId: sourceDeviceId, excludeSocketId: auth.id }, payload);
      if (targetDeviceId) {
        await emit({ deviceId: targetDeviceId, excludeSocketId: auth.id }, payload);
      }
      await emit({ ownerId, excludeSocketId: auth.id }, payload);
      await recordActivity({
        userId: ownerId,
        deviceId: sourceDeviceId,
        actorType: auth.role,
        action: 'connection.request',
        targetType: 'connection',
        targetId: inserted.id,
        metadata: { connectionType: inserted.type, targetDeviceId },
      });
      return;
    }

    case 'connection:accepted':
    case 'connection:rejected': {
      const connection = await assertConnectionParticipant(event.connectionId, auth);
      if (!connection) throw new Error('Connection not found for this client');
      const accepted = event.type === 'connection:accepted';
      const status = accepted ? 'active' : 'rejected';
      await query(
        `UPDATE connection_sessions
            SET status = $2,
                accepted_at = CASE WHEN $2 = 'active' THEN now() ELSE accepted_at END,
                ended_at = CASE WHEN $2 = 'rejected' THEN now() ELSE ended_at END,
                ended_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE ended_reason END
          WHERE id = $1`,
        [event.connectionId, status, event.type === 'connection:rejected' ? event.reason ?? 'rejected by peer' : null],
      );
      const payload = {
        type: event.type,
        connectionId: event.connectionId,
        ...(event.type === 'connection:rejected' ? { reason: event.reason ?? 'rejected' } : {}),
        at: new Date().toISOString(),
      };
      await relayToParticipants(connection, auth.id, payload);
      if (connection.target) {
        await recordConnectionEvent({
          userId: connection.ownerId,
          deviceId: connection.target,
          connectionId: connection.id,
          event: accepted ? 'connection_accepted' : 'connection_rejected',
        });
      }
      return;
    }

    case 'rtc:offer':
    case 'rtc:answer':
    case 'rtc:ice':
    case 'rtc:hangup': {
      const connection = await assertConnectionParticipant(event.connectionId, auth);
      if (!connection) throw new Error('Connection not found for this client');
      if (connection.status === 'rejected' || connection.status === 'ended') {
        throw new Error(`Connection is ${connection.status}`);
      }
      await relayToParticipants(connection, auth.id, { ...event, from: auth.role, fromId: auth.payload.sub });
      if (event.type === 'rtc:hangup') {
        await query(
          `UPDATE connection_sessions SET status = 'ended', ended_at = now(), ended_reason = $2 WHERE id = $1`,
          [event.connectionId, event.reason ?? 'hangup'],
        );
        await emit({ ownerId: connection.ownerId }, {
          type: 'connection:ended',
          connectionId: event.connectionId,
          reason: event.reason ?? 'hangup',
        });
      }
      return;
    }

    case 'transfer:progress':
    case 'transfer:completed':
    case 'transfer:failed': {
      const transfer = await one<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM file_transfers WHERE id = $1',
        [event.transferId],
      );
      if (!transfer || transfer.user_id !== auth.payload.uid) throw new Error('Transfer not found');
      await emit({ ownerId: auth.payload.uid, excludeSocketId: auth.id }, { ...event } as Record<string, unknown> & { type: string });
      return;
    }

    case 'file:list':
    case 'clipboard:sync':
    case 'notification:sync':
    case 'command:result':
    case 'file:response': {
      // Device-originated data pushed to the owner's terminals for real-time UI updates.
      await emit({ ownerId: auth.payload.uid, excludeSocketId: auth.id }, { ...event } as Record<string, unknown> & { type: string });
      return;
    }

    default:
      return;
  }
}

function handleConnection(ws: WebSocket, auth: AuthenticatedSocket): void {
  const connectionId = randomUUID();
  registerSocket(auth.id, {
    socket: ws,
    role: auth.role,
    ownerId: auth.payload.uid,
    deviceId: auth.role === 'device' ? auth.payload.sub : undefined,
    sessionId: auth.payload.sid,
    connectionId,
    connectedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    alive: true,
  });

  ws.on('message', (raw) => {
    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'BAD_REQUEST', message: 'Malformed JSON' }));
        return;
      }
      const result = clientEventSchema.safeParse(parsed);
      if (!result.success) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'VALIDATION_ERROR',
            message: 'Unsupported WebSocket event',
            details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
        );
        return;
      }
      try {
        await onClientEvent(auth, result.data);
      } catch (err) {
        logger.warn({ err, event: result.data.type }, 'websocket handler error');
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'HANDLER_ERROR',
            event: result.data.type,
            message: err instanceof Error ? err.message : 'Request failed',
          }),
        );
      }
    })();
  });

  ws.on('close', () => {
    void (async () => {
      unregisterSocket(auth.id);
      if (auth.role === 'device') await handleDeviceOffline(auth, connectionId);
    })();
  });

  ws.on('error', (err) => {
    logger.warn({ err }, 'websocket error');
  });

  void (async () => {
    ws.send(
      JSON.stringify({
        type: 'hello',
        role: auth.role,
        deviceId: auth.role === 'device' ? auth.payload.sub : undefined,
        ownerId: auth.payload.uid,
        connectionId,
        serverTime: new Date().toISOString(),
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        events: ['device:online', 'device:offline', 'device:heartbeat', 'rtc:*', 'transfer:*', 'connection:*'],
      }),
    );
    if (auth.role === 'device') {
      await handleDeviceOnline(auth, connectionId);
    } else {
      const snapshot = await presenceSnapshot(auth.payload.uid);
      ws.send(JSON.stringify({ type: 'presence:sync', devices: snapshot, at: new Date().toISOString() }));
    }
  })();
}

export function attachWebSocketServer(server: HttpServer): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (url.pathname !== '/ws' && url.pathname !== '/api/ws') {
          socket.destroy();
          return;
        }
        if (!originAllowed(req.headers.origin)) {
          rejectUpgrade(socket, 403, 'Origin not allowed');
          return;
        }
        const auth = await authenticate(url);
        if ('error' in auth) {
          rejectUpgrade(socket, 401, auth.error);
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          const id = randomUUID();
          if (auth.role === 'device') {
            const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
            void query('UPDATE devices SET last_ip = $2 WHERE id = $1', [auth.payload.sub, ip]);
          }
          handleConnection(ws, { ws, id, payload: auth.payload, role: auth.role });
        });
      } catch (err) {
        logger.warn({ err }, 'websocket upgrade failed');
        socket.destroy();
      }
    })();
  });
}

export function shutdownWebSocketServer(): void {
  clearInterval(heartbeatTimer);
  for (const client of wss.clients) {
    try {
      client.close(1001, 'server shutting down');
    } catch {
      /* ignore */
    }
  }
  wss.close();
}

export const socketEventSchema = z.object({ type: z.string() });
