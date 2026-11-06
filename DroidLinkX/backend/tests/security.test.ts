import { beforeEach, describe, expect, it } from 'vitest';

import request from 'supertest';
import { api, app, deviceTokens, enrollDevice, registerOwner, resetDatabase } from './helpers.js';
import { pool } from '../src/database/pool.js';

describe('security controls', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('writes an audit trail for sign-ins, enrollment and connections', async () => {
    const owner = await registerOwner();
    await api().post('/api/auth/login').send({ email: owner.email, password: owner.password });
    const enrolled = await enrollDevice(owner);
    await api()
      .put(`/api/devices/${enrolled.deviceId}/permissions/camera`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ granted: true });

    const activity = await api().get('/api/activity').set('authorization', `Bearer ${owner.accessToken}`);
    expect(activity.status).toBe(200);
    const actions = activity.body.activity.map((a: { action: string }) => a.action);
    expect(actions).toContain('auth.register');
    expect(actions).toContain('auth.login');
    expect(actions).toContain('device.enrolled');
    expect(actions).toContain('device.permission_changed');
    expect(activity.body.activity[0].createdAt).toBeTruthy();
  });

  it('revokes a device session so its token stops working immediately', async () => {
    const owner = await registerOwner();
    const enrolled = await enrollDevice(owner);
    const device = await deviceTokens(enrolled);

    const sessions = await api().get('/api/sessions').set('authorization', `Bearer ${owner.accessToken}`);
    expect(sessions.body.sessions[0].id).toBe(device.sessionId);
    expect(sessions.body.sessions[0].state).toBe('active');

    const revoke = await api()
      .post('/api/sessions/revoke')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ sessionId: device.sessionId });
    expect(revoke.status).toBe(204);

    const blocked = await api()
      .post(`/api/devices/${enrolled.deviceId}/status`)
      .set('authorization', `Bearer ${device.accessToken}`)
      .send({ telemetry: { battery: 1 } });
    expect(blocked.status).toBe(401);
  });

  it('issues time-limited TURN credentials derived from the shared secret', async () => {
    const owner = await registerOwner();
    const turn = await api().get('/api/signaling/turn').set('authorization', `Bearer ${owner.accessToken}`);
    expect(turn.status).toBe(200);
    expect(turn.body.username).toMatch(/^\d+:/);
    expect(turn.body.credential).toBeTruthy();
    expect(turn.body.ttl).toBe(3600);
    expect(turn.body.urls[0]).toContain('turn:');

    const config = await api().get('/api/signaling/config');
    expect(config.body.turnConfigured).toBe(true);
    expect(config.body.stunUrls.length).toBeGreaterThan(0);
    expect(config.body.turnUrls.length).toBeGreaterThan(0);

    const anonymous = await api().get('/api/signaling/turn');
    expect(anonymous.status).toBe(401);
  });

  it('never persists raw device secrets or plaintext passwords', async () => {
    const owner = await registerOwner();
    const enrolled = await enrollDevice(owner);
    const rows = await pool.query(
      `SELECT (SELECT string_agg(secret_hash, ',') FROM device_credentials) AS device_hashes,
              (SELECT string_agg(password_hash, ',') FROM users) AS password_hashes,
              (SELECT string_agg(token_hash, ',') FROM refresh_tokens) AS refresh_hashes`,
    );
    const snapshot = JSON.stringify(rows.rows[0]);
    expect(snapshot).not.toContain(enrolled.deviceSecret);
    expect(snapshot).not.toContain(owner.password);
    expect(snapshot).not.toContain(owner.refreshToken);
    expect(rows.rows[0].device_hashes).toContain('scrypt$');
  });

  it('blocks sensitive clipboard content unless the owner explicitly confirms', async () => {
    const owner = await registerOwner();
    const blocked = await api()
      .post('/api/clipboard/sync')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ content: 'Your OTP is 482913' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details.requiresConfirmation).toBe(true);

    const safe = await api()
      .post('/api/clipboard/sync')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ content: 'meeting notes for thursday' });
    expect(safe.status).toBe(201);

    const forced = await api()
      .post('/api/clipboard/sync')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ content: 'Your OTP is 482913', force: true });
    expect(forced.status).toBe(201);
    expect(forced.body.clipboard.sensitive).toBe(true);

    const latest = await api().get('/api/clipboard/latest').set('authorization', `Bearer ${owner.accessToken}`);
    expect(latest.body.content).toBe('Your OTP is 482913');
  });

  it('requires explicit per-device permission for notification sync and filters sensitive text', async () => {
    const owner = await registerOwner();
    const enrolled = await enrollDevice(owner);
    const device = await deviceTokens(enrolled);

    const denied = await api()
      .post('/api/notifications/sync')
      .set('authorization', `Bearer ${device.accessToken}`)
      .send({
        notifications: [
          { packageName: 'com.example', appName: 'Example', title: 'Hi', postedAt: new Date().toISOString() },
        ],
      });
    expect(denied.status).toBe(403);

    await api()
      .put(`/api/devices/${enrolled.deviceId}/permissions/notifications`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ granted: true });

    const accepted = await api()
      .post('/api/notifications/sync')
      .set('authorization', `Bearer ${device.accessToken}`)
      .send({
        notifications: [
          { packageName: 'com.example', appName: 'Example', title: 'Build finished', postedAt: new Date().toISOString() },
          { packageName: 'com.bank', appName: 'Bank', title: 'Your OTP is 918273', postedAt: new Date().toISOString() },
        ],
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.stored).toBe(1);
    expect(accepted.body.filtered).toBe(1);

    const list = await api().get('/api/notifications').set('authorization', `Bearer ${owner.accessToken}`);
    expect(list.body.notifications).toHaveLength(1);
    expect(list.body.notifications[0].title).toBe('Build finished');
  });

  it('rejects cross-origin browser requests from unknown origins', async () => {
    const res = await request(app)
      .get('/health')
      .set('origin', 'https://evil.example');
    expect(res.status).toBe(500);
    const allowed = await request(app).get('/health').set('origin', 'http://localhost:5173');
    expect(allowed.status).toBe(200);
  });

  it('reports health with database and WebRTC configuration', async () => {
    const health = await api().get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.database).toBe('up');
    expect(health.body.webrtc.turnConfigured).toBe(true);
  });

  it('rejects unknown routes with a structured error', async () => {
    const res = await api().get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
