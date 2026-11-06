import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  deviceTokens,
  enrollDevice,
  registerOwner,
  resetDatabase,
  type Owner,
} from './helpers.js';

describe('device enrollment and management', () => {
  let owner: Owner;
  beforeEach(async () => {
    await resetDatabase();
    owner = await registerOwner();
  });

  it('requires owner authentication to enroll', async () => {
    const res = await api().post('/api/devices/enroll').send({ name: 'Sneaky Phone' });
    expect(res.status).toBe(401);
  });

  it('enrolls a device and returns the secret exactly once', async () => {
    const enrolled = await enrollDevice(owner);
    const devices = await api().get('/api/devices').set('authorization', `Bearer ${owner.accessToken}`);
    expect(devices.status).toBe(200);
    expect(devices.body.devices).toHaveLength(1);

    const device = devices.body.devices[0];
    expect(device.name).toBe('Pixel 9 Pro');
    expect(device.online).toBe(false);
    expect(device.model).toBe('Pixel 9 Pro');
    expect(device.sdkInt).toBe(36);
    expect(JSON.stringify(devices.body)).not.toContain(enrolled.deviceSecret);
  });

  it('exchanges device credentials for a revocable device session', async () => {
    const enrolled = await enrollDevice(owner);
    const tokens = await deviceTokens(enrolled);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.sessionId).toBeTruthy();

    const wrongSecret = await api()
      .post('/api/devices/token')
      .send({ deviceId: enrolled.deviceId, deviceSecret: 'x'.repeat(40) });
    expect(wrongSecret.status).toBe(401);

    const selfStatus = await api()
      .post(`/api/devices/${enrolled.deviceId}/status`)
      .set('authorization', `Bearer ${tokens.accessToken}`)
      .send({ telemetry: { battery: 91, storageFreeBytes: 1234, network: 'wifi' } });
    expect(selfStatus.status).toBe(200);
    expect(selfStatus.body.device.telemetry.battery).toBe(91);
  });

  it('prevents a device token from acting as the owner', async () => {
    const enrolled = await enrollDevice(owner);
    const tokens = await deviceTokens(enrolled);
    const res = await api().get('/api/devices').set('authorization', `Bearer ${tokens.accessToken}`);
    expect(res.status).toBe(401);
    const other = await api()
      .post('/api/devices/enroll')
      .set('authorization', `Bearer ${tokens.accessToken}`)
      .send({ name: 'Rogue' });
    expect(other.status).toBe(401);
  });

  it('isolates devices between accounts', async () => {
    const enrolled = await enrollDevice(owner);
    const intruder = await registerOwner('-intruder');
    const list = await api().get('/api/devices').set('authorization', `Bearer ${intruder.accessToken}`);
    expect(list.body.devices).toHaveLength(0);
    const detail = await api()
      .get(`/api/devices/${enrolled.deviceId}`)
      .set('authorization', `Bearer ${intruder.accessToken}`);
    expect(detail.status).toBe(404);
    const remove = await api()
      .delete(`/api/devices/${enrolled.deviceId}`)
      .set('authorization', `Bearer ${intruder.accessToken}`);
    expect(remove.status).toBe(404);
  });

  it('renames, trusts and manages per-device permissions', async () => {
    const enrolled = await enrollDevice(owner);
    const renamed = await api()
      .patch(`/api/devices/${enrolled.deviceId}`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Living Room Tablet', trusted: true });
    expect(renamed.status).toBe(200);
    expect(renamed.body.device.name).toBe('Living Room Tablet');
    expect(renamed.body.device.trusted).toBe(true);

    const granted = await api()
      .put(`/api/devices/${enrolled.deviceId}/permissions/notifications`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ granted: true });
    expect(granted.status).toBe(200);
    expect(granted.body.permissions.notifications).toBe(true);

    const invalid = await api()
      .put(`/api/devices/${enrolled.deviceId}/permissions/teleport`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ granted: true });
    expect(invalid.status).toBe(422);
  });

  it('revokes a device and kills its live tokens', async () => {
    const enrolled = await enrollDevice(owner);
    const tokens = await deviceTokens(enrolled);

    const revoked = await api()
      .delete(`/api/devices/${enrolled.deviceId}`)
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(revoked.status).toBe(204);

    const afterRevoke = await api()
      .post(`/api/devices/${enrolled.deviceId}/status`)
      .set('authorization', `Bearer ${tokens.accessToken}`)
      .send({ telemetry: { battery: 10 } });
    expect(afterRevoke.status).toBe(401);

    const list = await api().get('/api/devices').set('authorization', `Bearer ${owner.accessToken}`);
    expect(list.body.devices).toHaveLength(0);

    const reToken = await api()
      .post('/api/devices/token')
      .send({ deviceId: enrolled.deviceId, deviceSecret: enrolled.deviceSecret });
    expect(reToken.status).toBe(403);
  });

  it('rotates the device secret so the old one stops working', async () => {
    const enrolled = await enrollDevice(owner);
    const rotated = await api()
      .post(`/api/devices/${enrolled.deviceId}/rotate-secret`)
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.deviceSecret).toBeTruthy();
    expect(rotated.body.deviceSecret).not.toBe(enrolled.deviceSecret);

    const oldSecret = await api()
      .post('/api/devices/token')
      .send({ deviceId: enrolled.deviceId, deviceSecret: enrolled.deviceSecret });
    expect(oldSecret.status).toBe(401);

    const newSecret = await api()
      .post('/api/devices/token')
      .send({ deviceId: enrolled.deviceId, deviceSecret: rotated.body.deviceSecret });
    expect(newSecret.status).toBe(200);
  });

  it('records a connection history for each device', async () => {
    const enrolled = await enrollDevice(owner);
    const history = await api()
      .get(`/api/devices/${enrolled.deviceId}/history`)
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(history.status).toBe(200);
    expect(history.body.events[0].event).toBe('enrolled');
  });
});
