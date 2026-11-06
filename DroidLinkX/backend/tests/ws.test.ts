import WebSocket from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  deviceTokens,
  enrollDevice,
  registerOwner,
  resetDatabase,
  startTestServer,
  wait,
  type Enrolled,
  type Owner,
  type TestServer,
} from './helpers.js';

type Message = Record<string, unknown> & { type: string };

/** Connects and buffers every inbound frame from the moment the socket object exists. */
async function connect(
  baseUrl: string,
  token: string,
  role: 'user' | 'device',
): Promise<{ ws: WebSocket; messages: Message[] }> {
  const ws = new WebSocket(`ws://${baseUrl}/ws?token=${encodeURIComponent(token)}&role=${role}`);
  const messages: Message[] = [];
  ws.on('message', (raw) => {
    try {
      messages.push(JSON.parse(raw.toString()) as Message);
    } catch {
      /* ignore */
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, messages };
}

async function waitFor(messages: Message[], type: string, timeoutMs = 4000): Promise<Message | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find((m) => m.type === type);
    if (found) return found;
    await wait(50);
  }
  return null;
}

describe('WebSocket presence and WebRTC signalling', () => {
  let server: TestServer;
  let owner: Owner;
  let phone: Enrolled;
  let laptop: Enrolled;
  let phoneToken: string;
  let laptopToken: string;

  beforeAll(async () => {
    await resetDatabase();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    owner = await registerOwner();
    phone = await enrollDevice(owner, 'Pixel 9 Pro');
    laptop = await enrollDevice(owner, 'Galaxy Tab');
    phoneToken = (await deviceTokens(phone)).accessToken;
    laptopToken = (await deviceTokens(laptop)).accessToken;
  });

  it('rejects sockets without a valid token', async () => {
    await expect(connect(server.baseUrl, 'garbage', 'device')).rejects.toThrow();
    await expect(connect(server.baseUrl, '', 'user')).rejects.toThrow();
  });

  it('marks devices online only after an authenticated socket connects', async () => {
    const before = await api().get('/api/devices').set('authorization', `Bearer ${owner.accessToken}`);
    expect(before.body.devices.every((d: { online: boolean }) => d.online === false)).toBe(true);

    const user = await connect(server.baseUrl, owner.accessToken, 'user');
    const userWs = user.ws;
    const userMessages = user.messages;
    const hello = await waitFor(userMessages, 'hello');
    expect(hello?.role).toBe('user');
    expect(await waitFor(userMessages, 'presence:sync')).toBeTruthy();

    const device = await connect(server.baseUrl, phoneToken, 'device');
    const deviceWs = device.ws;
    const deviceMessages = device.messages;
    const online = await waitFor(userMessages, 'device:online');
    expect(online?.deviceId).toBe(phone.deviceId);

    deviceWs.send(JSON.stringify({ type: 'device:heartbeat', battery: 88, charging: true, network: 'wifi' }));
    const heartbeat = await waitFor(userMessages, 'device:heartbeat');
    expect(heartbeat?.battery).toBe(88);

    const devices = await api().get('/api/devices').set('authorization', `Bearer ${owner.accessToken}`);
    const listed = devices.body.devices.find((d: { id: string }) => d.id === phone.deviceId);
    expect(listed.online).toBe(true);
    expect(listed.telemetry.battery).toBe(88);
    expect(listed.connectionQuality).toBe('good');
    // Device agents must not receive owner-terminal broadcasts.
    expect(deviceMessages.some((m) => m.type === 'device:online')).toBe(false);

    deviceWs.close();
    const offline = await waitFor(userMessages, 'device:offline');
    expect(offline?.deviceId).toBe(phone.deviceId);
    userWs.close();
  });

  it('relays connection requests and RTC signalling between devices and the dashboard', async () => {
    const user = await connect(server.baseUrl, owner.accessToken, 'user');
    const userWs = user.ws;
    const userMessages = user.messages;
    const phoneConn = await connect(server.baseUrl, phoneToken, 'device');
    const phoneWs = phoneConn.ws;
    const phoneMessages = phoneConn.messages;
    const laptopConn = await connect(server.baseUrl, laptopToken, 'device');
    const laptopWs = laptopConn.ws;
    const laptopMessages = laptopConn.messages;
    await wait(250);

    const created = await api()
      .post('/api/connections/create')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ sourceDeviceId: phone.deviceId, targetDeviceId: laptop.deviceId, type: 'mirror' });
    expect(created.status).toBe(201);
    const connectionId = created.body.connection.id;
    expect(created.body.connection.turn).toBeTruthy();

    const request = await waitFor(phoneMessages, 'connection:request');
    expect(request?.connectionId).toBe(connectionId);

    laptopWs.send(JSON.stringify({ type: 'connection:accepted', connectionId }));
    // The accepting socket is excluded from its own relay, the other participants are notified.
    expect(await waitFor(phoneMessages, 'connection:accepted')).toBeTruthy();
    expect(await waitFor(userMessages, 'connection:accepted')).toBeTruthy();

    phoneWs.send(JSON.stringify({ type: 'rtc:offer', connectionId, sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n', kind: 'mirror' }));
    const offer = await waitFor(laptopMessages, 'rtc:offer');
    expect(offer?.sdp).toContain('v=0');
    expect(offer?.from).toBe('device');
    expect(await waitFor(userMessages, 'rtc:offer')).toBeTruthy();

    laptopWs.send(JSON.stringify({ type: 'rtc:ice', connectionId, candidate: 'candidate:1 1 UDP 1 10.0.0.1 5000 typ host' }));
    expect(await waitFor(phoneMessages, 'rtc:ice')).toBeTruthy();

    phoneWs.send(JSON.stringify({ type: 'rtc:hangup', connectionId, reason: 'user stopped' }));
    const ended = await waitFor(userMessages, 'connection:ended');
    expect(ended?.connectionId).toBe(connectionId);

    const status = await api()
      .get(`/api/connections/status?deviceId=${phone.deviceId}`)
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(status.body.connections[0].status).toBe('ended');

    userWs.close();
    phoneWs.close();
    laptopWs.close();
  });

  it('refuses to create a connection for an offline device', async () => {
    const res = await api()
      .post('/api/connections/create')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ sourceDeviceId: phone.deviceId, type: 'mirror' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('offline');
  });

  it('ignores unsupported events and reports validation errors', async () => {
    const { ws, messages } = await connect(server.baseUrl, owner.accessToken, 'user');
    ws.send(JSON.stringify({ type: 'evil:inject', payload: 'x' }));
    const error = await waitFor(messages, 'error');
    expect(error?.code).toBe('VALIDATION_ERROR');
    ws.send('not json');
    const malformed = await waitFor(messages.filter((m) => m.type === 'error'), 'error');
    expect(malformed).toBeTruthy();
    ws.close();
  });

  it('stops streaming signalling when the device is revoked', async () => {
    const user = await connect(server.baseUrl, owner.accessToken, 'user');
    const userWs = user.ws;
    const userMessages = user.messages;
    const phoneConn = await connect(server.baseUrl, phoneToken, 'device');
    const phoneWs = phoneConn.ws;
    const closed = new Promise<number>((resolve) => phoneWs.on('close', (code) => resolve(code)));
    await wait(250);

    await api().delete(`/api/devices/${phone.deviceId}`).set('authorization', `Bearer ${owner.accessToken}`);
    const code = await Promise.race([closed, wait(3000).then(() => 0)]);
    expect(code).toBe(4403);
    expect(await waitFor(userMessages, 'device:offline')).toBeTruthy();
    userWs.close();
  });
});
