import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthError, type Principal } from './auth.js';
import type { Config } from './config.js';
import { allowFrame, Hub, send, type Client } from './hub.js';
import { clientFrameSchema } from './protocol.js';
import type { ConnectionRow, Directory } from './supabase.js';

export interface PrincipalVerifier {
  verify(token: string, role: 'user' | 'device'): Promise<Principal>;
}

export type ServerDeps = {
  config: Config;
  verifier: PrincipalVerifier;
  directory: Directory;
};

export type SignalingServer = {
  server: Server;
  wss: WebSocketServer;
  hub: Hub;
  close: () => Promise<void>;
};

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: { code: status, message } });
  socket.write(
    `HTTP/1.1 ${status} ${REASONS[status] ?? 'Error'}\r\n` +
      'connection: close\r\n' +
      'content-type: application/json\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export function createSignalingServer({ config, verifier, directory }: ServerDeps): SignalingServer {
  const hub = new Hub();

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', ...cors(config, req) });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'droidlinkx-signaling',
        devicesOnline: hub.onlineDeviceIds().length,
        connections: hub.connectionCount(),
        time: new Date().toISOString(),
      }));
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors(config, req));
      res.end();
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json', ...cors(config, req) });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Use /ws for signalling or /health' } }));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, clientTracking: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void handleUpgrade(req, socket, head);
  });

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Use /ws for signalling');
    if (hub.connectionCount() >= config.maxConnections) return rejectUpgrade(socket, 503, 'Relay is at capacity');

    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role');
    if (!token) return rejectUpgrade(socket, 401, 'A token query parameter is required');
    if (role !== 'user' && role !== 'device') return rejectUpgrade(socket, 401, 'role must be user or device');

    let principal: Principal;
    try {
      principal = await verifier.verify(token, role);
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      const message = error instanceof AuthError ? error.message : 'Authentication failed';
      return rejectUpgrade(socket, status, message);
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, principal, req);
    });
  }

  function onConnection(ws: WebSocket, principal: Principal, req: IncomingMessage): void {
    const client: Client = {
      id: randomUUID(),
      socket: ws,
      principal,
      userId: principal.role === 'user' ? principal.userId : principal.ownerId,
      deviceId: principal.role === 'device' ? principal.deviceId : null,
      alive: true,
      framesInWindow: 0,
      windowStartedAt: Date.now(),
    };
    hub.add(client);

    send(client, {
      type: 'hello',
      role: principal.role,
      userId: client.userId,
      deviceId: client.deviceId,
      sessionId: principal.role === 'device' ? principal.sessionId : null,
      heartbeatIntervalMs: config.heartbeatMs,
      serverTime: new Date().toISOString(),
    });

    if (principal.role === 'device') {
      void markDeviceOnline(client, req).catch((error) => console.warn('[signaling] presence failed', error));
    } else {
      void sendPresenceSnapshot(client).catch((error) => console.warn('[signaling] presence snapshot failed', error));
    }

    ws.on('pong', () => {
      client.alive = true;
    });

    ws.on('message', (raw) => {
      void handleMessage(client, raw.toString()).catch((error) => {
        console.warn('[signaling] frame failed', error);
        send(client, { type: 'error', code: 'FRAME_FAILED', message: 'The frame could not be processed' });
      });
    });

    ws.on('close', () => {
      hub.remove(client);
      if (client.deviceId && !hub.hasDevice(client.deviceId)) {
        void markDeviceOffline(client).catch((error) => console.warn('[signaling] offline failed', error));
      }
    });

    ws.on('error', (error) => {
      console.warn('[signaling] socket error', error.message);
    });
  }

  async function sendPresenceSnapshot(client: Client): Promise<void> {
    if (!client.userId) return;
    const devices = await directory.listDevices(client.userId);
    send(client, {
      type: 'presence:sync',
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        online: device.online && hub.hasDevice(device.id),
      })),
      at: new Date().toISOString(),
    });
  }

  async function markDeviceOnline(client: Client, req: IncomingMessage): Promise<void> {
    if (!client.deviceId) return;
    const at = new Date().toISOString();
    await directory.setDevicePresence(client.deviceId, true, at);
    if (client.userId) {
      hub.sendToUser(client.userId, {
        type: 'device:online',
        deviceId: client.deviceId,
        at,
      });
      await directory.broadcast(`owner:${client.userId}`, 'device:online', { deviceId: client.deviceId, at });
    }
    console.info('[signaling] device online', { deviceId: client.deviceId, ip: clientIp(req) });
  }

  async function markDeviceOffline(client: Client): Promise<void> {
    if (!client.deviceId) return;
    const at = new Date().toISOString();
    await directory.setDevicePresence(client.deviceId, false, at);
    if (client.userId) {
      hub.sendToUser(client.userId, {
        type: 'device:offline',
        deviceId: client.deviceId,
        at,
      });
      await directory.broadcast(`owner:${client.userId}`, 'device:offline', { deviceId: client.deviceId, at });
    }
    console.info('[signaling] device offline', { deviceId: client.deviceId });
  }

  async function handleMessage(client: Client, raw: string): Promise<void> {
    if (!allowFrame(client)) {
      send(client, { type: 'error', code: 'RATE_LIMITED', message: 'Too many frames, slow down' });
      client.socket.close(4429, 'rate limited');
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      send(client, { type: 'error', code: 'BAD_JSON', message: 'Frames must be valid JSON' });
      return;
    }
    const parsed = clientFrameSchema.safeParse(parsedJson);
    if (!parsed.success) {
      send(client, { type: 'error', code: 'BAD_FRAME', message: parsed.error.issues[0]?.message ?? 'Invalid frame' });
      return;
    }
    const frame = parsed.data;

    switch (frame.type) {
      case 'ping':
        send(client, { type: 'pong', t: Date.now() });
        return;

      case 'heartbeat':
        send(client, { type: 'pong', t: Date.now() });
        return;

      case 'device:status': {
        if (client.principal.role !== 'device' || !client.userId) {
          send(client, { type: 'error', code: 'FORBIDDEN', message: 'Only devices may publish status here' });
          return;
        }
        hub.sendToUser(client.userId, {
          type: 'device:heartbeat',
          deviceId: client.deviceId,
          battery: frame.battery,
          charging: frame.charging,
          network: frame.network,
          at: new Date().toISOString(),
        }, client.id);
        return;
      }

      case 'connection:accept':
      case 'connection:reject': {
        const connection = await requireParticipant(client, frame.connectionId);
        if (!connection) return;
        const status = frame.type === 'connection:accept' ? 'accepted' : 'rejected';
        await directory.updateConnectionStatus(connection.id, status, frame.type === 'connection:reject' ? frame.reason : undefined);
        await directory.recordConnectionEvent(connection, frame.type === 'connection:accept' ? 'connection_accepted' : 'connection_rejected', {
          by: client.principal.role,
          reason: frame.type === 'connection:reject' ? frame.reason ?? null : null,
        });
        relayToParticipants(client, connection, {
          type: frame.type === 'connection:accept' ? 'connection:accepted' : 'connection:rejected',
          connectionId: connection.id,
          reason: frame.type === 'connection:reject' ? frame.reason : undefined,
        });
        return;
      }

      case 'rtc:offer':
      case 'rtc:answer':
      case 'rtc:ice':
      case 'rtc:hangup': {
        const connection = await requireParticipant(client, frame.connectionId);
        if (!connection) return;
        if (connection.status === 'rejected' || connection.status === 'ended') {
          send(client, { type: 'error', code: 'CONNECTION_CLOSED', message: `Connection is ${connection.status}` });
          return;
        }
        relayToParticipants(client, connection, {
          ...frame,
          from: client.principal.role,
          fromId: client.principal.role === 'device' ? client.deviceId : client.userId,
        });
        if (frame.type === 'rtc:hangup') {
          await directory.updateConnectionStatus(connection.id, 'ended', frame.reason ?? 'hangup');
          await directory.recordConnectionEvent(connection, 'connection_ended', { reason: frame.reason ?? 'hangup' });
        }
        return;
      }

      default:
        send(client, { type: 'error', code: 'UNSUPPORTED', message: 'Unsupported frame type' });
    }
  }

  async function requireParticipant(client: Client, connectionId: string): Promise<ConnectionRow | null> {
    const connection = await directory.getConnection(connectionId);
    if (!connection) {
      send(client, { type: 'error', code: 'NOT_FOUND', message: 'Connection not found' });
      return null;
    }
    const isOwner = client.principal.role === 'user' && connection.owner_id === client.principal.userId;
    const isDevice =
      client.principal.role === 'device' &&
      (connection.source_device_id === client.principal.deviceId || connection.target_device_id === client.principal.deviceId);
    if (!isOwner && !isDevice) {
      send(client, { type: 'error', code: 'FORBIDDEN', message: 'You are not a participant of this connection' });
      return null;
    }
    if (new Date(connection.expires_at).getTime() < Date.now() && connection.status === 'pending') {
      send(client, { type: 'error', code: 'CONNECTION_EXPIRED', message: 'This connection request expired' });
      return null;
    }
    return connection;
  }

  function relayToParticipants(sender: Client, connection: ConnectionRow, frame: Record<string, unknown>): void {
    const ownerId = connection.owner_id;
    hub.sendToUser(ownerId, frame, sender.userId && sender.principal.role === 'user' ? sender.id : undefined);
    for (const deviceId of [connection.source_device_id, connection.target_device_id]) {
      if (!deviceId || deviceId === sender.deviceId) continue;
      hub.sendToDevice(deviceId, frame);
    }
  }

  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws as WebSocket & { isAlive?: boolean };
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, config.heartbeatMs);
  sweep.unref?.();

  const close = async (): Promise<void> => {
    clearInterval(sweep);
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { server, wss, hub, close };
}

function cors(config: Config, req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  const allow = config.corsOrigins.includes('*') ? '*' : origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0] ?? '*';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, OPTIONS',
    vary: 'origin',
  };
}

function clientIp(req: IncomingMessage): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? null;
}

export function startSignalingServer(deps: ServerDeps): SignalingServer {
  const instance = createSignalingServer(deps);
  instance.server.listen(deps.config.port, '0.0.0.0', () => {
    console.info(`[signaling] listening on 0.0.0.0:${deps.config.port}`);
  });
  return instance;
}
