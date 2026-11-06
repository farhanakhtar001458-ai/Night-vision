import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { createSignalingServer, type SignalingServer } from '../src/server.js';
import type { ConnectionRow, DeviceRow, DeviceSessionRow, DeviceSummary, Directory } from '../src/supabase.js';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER_OWNER = '22222222-2222-2222-2222-222222222222';
const DEVICE = 'aaaaaaaa-0000-0000-0000-000000000001';
const CONNECTION = 'cccccccc-0000-0000-0000-000000000001';
const FOREIGN_CONNECTION = 'dddddddd-0000-0000-0000-000000000002';

const config: Config = {
  port: 0,
  supabaseUrl: 'https://project.supabase.co',
  serviceRoleKey: 'service-role-key',
  deviceJwtSecret: 'device-secret',
  userJwtSecret: 'user-secret',
  jwksUrl: '',
  heartbeatMs: 60_000,
  maxConnections: 50,
  corsOrigins: ['*'],
  allowedClockSkewSeconds: 30,
};

class FakeDirectory implements Directory {
  presence = new Map<string, boolean>();
  connectionUpdates: Array<{ id: string; status: string }> = [];
  events: string[] = [];
  broadcasts: Array<{ topic: string; event: string }> = [];

  async getDeviceSession(): Promise<DeviceSessionRow | null> {
    return { id: 'sid', device_id: DEVICE, owner_id: OWNER, revoked_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() };
  }
  async getDevice(): Promise<DeviceRow | null> {
    return { id: DEVICE, owner_id: OWNER, status: 'active', online: true };
  }
  async listDevices(): Promise<DeviceSummary[]> {
    return [{ id: DEVICE, name: 'Test phone', online: true, status: 'active' }];
  }
  async getConnection(connectionId: string): Promise<ConnectionRow | null> {
    if (connectionId === FOREIGN_CONNECTION) {
      return {
        id: FOREIGN_CONNECTION,
        owner_id: OTHER_OWNER,
        source_device_id: 'bbbbbbbb-0000-0000-0000-000000000002',
        target_device_id: null,
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      };
    }
    if (connectionId !== CONNECTION) return null;
    return {
      id: CONNECTION,
      owner_id: OWNER,
      source_device_id: DEVICE,
      target_device_id: null,
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  async updateConnectionStatus(id: string, status: string): Promise<void> {
    this.connectionUpdates.push({ id, status });
  }
  async setDevicePresence(deviceId: string, online: boolean): Promise<void> {
    this.presence.set(deviceId, online);
  }
  async recordConnectionEvent(_connection: ConnectionRow, event: string): Promise<void> {
    this.events.push(event);
  }
  async broadcast(topic: string, event: string): Promise<void> {
    this.broadcasts.push({ topic, event });
  }
}

const verifier = {
  async verify(token: string): Promise<Principal> {
    if (token === 'device-token') {
      return { role: 'device', ownerId: OWNER, deviceId: DEVICE, sessionId: 'sid', expiresAt: Date.now() + 60_000 };
    }
    if (token === 'user-token') {
      return { role: 'user', userId: OWNER, tokenId: null, expiresAt: Date.now() + 60_000 };
    }
    if (token === 'other-user-token') {
      return { role: 'user', userId: OTHER_OWNER, tokenId: null, expiresAt: Date.now() + 60_000 };
    }
    throw new Error('bad token');
  },
};

let signaling: SignalingServer;
let baseUrl = '';
let directory: FakeDirectory;

const connect = (token: string, role: 'user' | 'device'): WebSocket =>
  new WebSocket(`${baseUrl}/ws?token=${token}&role=${role}`);

const nextFrame = (socket: WebSocket, predicate: (frame: Record<string, unknown>) => boolean, timeoutMs = 3000): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for frame'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(frame)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(frame);
    };
    socket.on('message', onMessage);
  });

beforeAll(async () => {
  directory = new FakeDirectory();
  signaling = createSignalingServer({ config, verifier, directory });
  await new Promise<void>((resolve) => signaling.server.listen(0, '127.0.0.1', resolve));
  const address = signaling.server.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await signaling.close();
});

describe('signalling relay', () => {
  it('authenticates both roles and sends hello frames', async () => {
    const device = connect('device-token', 'device');
    const user = connect('user-token', 'user');
    const [deviceHello, userHello] = await Promise.all([
      nextFrame(device, (frame) => frame.type === 'hello'),
      nextFrame(user, (frame) => frame.type === 'hello'),
    ]);
    expect(deviceHello.role).toBe('device');
    expect(deviceHello.deviceId).toBe(DEVICE);
    expect(userHello.role).toBe('user');
    device.close();
    user.close();
  });

  it('rejects unauthenticated upgrades with 401', async () => {
    const socket = connect('nope', 'user');
    const status = await new Promise<number>((resolve) => {
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.on('error', () => resolve(401));
    });
    expect(status).toBe(401);
  });

  it('marks a device online and relays presence to the owner', async () => {
    const user = connect('user-token', 'user');
    await nextFrame(user, (frame) => frame.type === 'hello');
    const device = connect('device-token', 'device');
    const online = await nextFrame(user, (frame) => frame.type === 'device:online' && frame.deviceId === DEVICE);
    expect(online.type).toBe('device:online');
    expect(directory.presence.get(DEVICE)).toBe(true);
    device.close();
    user.close();
  });

  it('relays an RTC offer from the owner to the device', async () => {
    const user = connect('user-token', 'user');
    const device = connect('device-token', 'device');
    await Promise.all([nextFrame(user, (f) => f.type === 'hello'), nextFrame(device, (f) => f.type === 'hello')]);

    user.send(JSON.stringify({ type: 'rtc:offer', connectionId: CONNECTION, sdp: 'v=0 fake sdp' }));
    const offer = await nextFrame(device, (frame) => frame.type === 'rtc:offer');
    expect(offer.sdp).toBe('v=0 fake sdp');
    expect(offer.from).toBe('user');
    user.close();
    device.close();
  });

  it('refuses signalling for a connection owned by somebody else', async () => {
    const user = connect('other-user-token', 'user');
    await nextFrame(user, (f) => f.type === 'hello');
    user.send(JSON.stringify({ type: 'rtc:offer', connectionId: CONNECTION, sdp: 'v=0' }));
    const error = await nextFrame(user, (frame) => frame.type === 'error');
    expect(error.code).toBe('FORBIDDEN');
    user.close();
  });

  it('records acceptance and notifies participants', async () => {
    const user = connect('user-token', 'user');
    const device = connect('device-token', 'device');
    await Promise.all([nextFrame(user, (f) => f.type === 'hello'), nextFrame(device, (f) => f.type === 'hello')]);

    device.send(JSON.stringify({ type: 'connection:accept', connectionId: CONNECTION }));
    const accepted = await nextFrame(user, (frame) => frame.type === 'connection:accepted');
    expect(accepted.connectionId).toBe(CONNECTION);
    expect(directory.connectionUpdates.at(-1)).toEqual({ id: CONNECTION, status: 'accepted' });
    expect(directory.events).toContain('connection_accepted');
    user.close();
    device.close();
  });

  it('marks the device offline when the socket closes', async () => {
    const device = connect('device-token', 'device');
    await nextFrame(device, (f) => f.type === 'hello');
    await new Promise((resolve) => setTimeout(resolve, 50));
    device.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(directory.presence.get(DEVICE)).toBe(false);
  });

  it('answers ping frames with pong', async () => {
    const user = connect('user-token', 'user');
    await nextFrame(user, (f) => f.type === 'hello');
    user.send(JSON.stringify({ type: 'ping' }));
    const pong = await nextFrame(user, (f) => f.type === 'pong');
    expect(typeof pong.t).toBe('number');
    user.close();
  });

  it('exposes a health endpoint', async () => {
    const response = await fetch(`${baseUrl.replace('ws', 'http')}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('droidlinkx-signaling');
  });
});
