import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { rm } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { runMigrations } from '../src/database/migrate.js';
import { attachWebSocketServer, shutdownWebSocketServer } from '../src/websocket/server.js';
import { ensureStorageDirs } from '../src/files/storage.js';

export const app = createApp();

export const api = () => supertest(app);

export async function resetDatabase(): Promise<void> {
  await runMigrations();
  await ensureStorageDirs();
  await pool.query(`
    TRUNCATE TABLE transfer_chunks, transfer_history, transfer_items, file_transfers,
                   notification_records, clipboard_records, connection_events, connection_sessions,
                   activity_logs, files, device_permissions, device_sessions, device_credentials,
                   devices, refresh_tokens, users
    RESTART IDENTITY CASCADE
  `);
  await rm('./storage-test', { recursive: true, force: true });
  await ensureStorageDirs();
}

export type Owner = { id: string; email: string; password: string; accessToken: string; refreshToken: string };

export async function registerOwner(emailSuffix = ''): Promise<Owner> {
  const email = `owner${emailSuffix}-${randomUUID().slice(0, 8)}@droidlinkx.test`;
  const password = 'Str0ngPassword123';
  const res = await api().post('/api/auth/register').send({ email, password, displayName: 'Test Owner' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.user.id,
    email,
    password,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
  };
}

export type Enrolled = { deviceId: string; deviceSecret: string; deviceName: string };

export async function enrollDevice(owner: Owner, name = 'Pixel 9 Pro'): Promise<Enrolled> {
  const res = await api()
    .post('/api/devices/enroll')
    .set('authorization', `Bearer ${owner.accessToken}`)
    .send({
      name,
      manufacturer: 'Google',
      model: 'Pixel 9 Pro',
      androidVersion: '16',
      sdkInt: 36,
      appVersion: '1.0.0',
    });
  if (res.status !== 201) throw new Error(`enroll failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { deviceId: res.body.deviceId, deviceSecret: res.body.deviceSecret, deviceName: name };
}

export async function deviceTokens(device: Enrolled): Promise<{ accessToken: string; sessionId: string }> {
  const res = await api().post('/api/devices/token').send({ deviceId: device.deviceId, deviceSecret: device.deviceSecret });
  if (res.status !== 200) throw new Error(`device token failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.accessToken, sessionId: res.body.sessionId };
}

export type TestServer = { server: Server; baseUrl: string; close: () => Promise<void> };

export async function startTestServer(): Promise<TestServer> {
  const server = createServer(app);
  attachWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    server,
    baseUrl: `127.0.0.1:${port}`,
    close: async () => {
      shutdownWebSocketServer();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
