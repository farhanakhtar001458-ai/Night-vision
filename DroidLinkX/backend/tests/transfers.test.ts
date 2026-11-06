import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, deviceTokens, enrollDevice, registerOwner, resetDatabase, type Owner } from './helpers.js';

const CHUNK = 8 * 1024 * 1024;

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function uploadChunks(
  transferId: string,
  index: number,
  buffer: Buffer,
  token: string,
  upTo?: number,
): Promise<number> {
  const totalChunks = Math.ceil(buffer.byteLength / CHUNK);
  const limit = upTo ?? totalChunks;
  let sent = 0;
  for (let chunkIndex = 0; chunkIndex < limit; chunkIndex += 1) {
    const slice = buffer.subarray(chunkIndex * CHUNK, Math.min((chunkIndex + 1) * CHUNK, buffer.byteLength));
    const res = await api()
      .put(`/api/transfers/${transferId}/items/${index}/chunks/${chunkIndex}`)
      .set('authorization', `Bearer ${token}`)
      .set('content-type', 'application/octet-stream')
      .send(slice);
    expect([200, 201]).toContain(res.status);
    sent += 1;
  }
  return sent;
}

describe('chunked, resumable transfers', () => {
  let owner: Owner;
  beforeEach(async () => {
    await resetDatabase();
    owner = await registerOwner();
  });

  it('uploads a multi-chunk file, verifies the checksum and registers it', async () => {
    const data = randomBytes(CHUNK * 2 + 1024);
    const digest = sha(data);
    const created = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({
        direction: 'device_to_cloud',
        mode: 'relay',
        items: [{ name: 'video.mp4', size: data.byteLength, sha256: digest }],
      });
    expect(created.status).toBe(201);
    const transferId = created.body.transfer.id;
    expect(created.body.uploadUrls[0].chunks).toBe(3);
    expect(created.body.transfer.chunkSize).toBe(CHUNK);

    await uploadChunks(transferId, 0, data, owner.accessToken);

    const paused = await api().get(`/api/transfers/${transferId}`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(paused.body.transfer.items[0].bytesReceived).toBe(data.byteLength);

    const completed = await api()
      .post(`/api/transfers/${transferId}/items/0/complete`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('x-content-sha256', digest);
    expect(completed.status).toBe(200);
    expect(completed.body.transfer.status).toBe('completed');
    expect(completed.body.transfer.items[0].checksumVerified).toBe(true);

    const files = await api().get('/api/files').set('authorization', `Bearer ${owner.accessToken}`);
    expect(files.body.files[0].name).toBe('video.mp4');
    expect(files.body.files[0].sha256).toBe(digest);

    const history = await api().get('/api/transfers/history').set('authorization', `Bearer ${owner.accessToken}`);
    expect(history.body.history.map((h: { event: string }) => h.event)).toContain('completed');
  });

  it('is idempotent for duplicate chunks and exposes resume state', async () => {
    const data = randomBytes(CHUNK + 512);
    const created = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ direction: 'device_to_cloud', items: [{ name: 'part.bin', size: data.byteLength }] });
    const transferId = created.body.transfer.id;

    await uploadChunks(transferId, 0, data, owner.accessToken, 1);
    const duplicate = await api()
      .put(`/api/transfers/${transferId}/items/0/chunks/0`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .send(data.subarray(0, CHUNK));
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    const status = await api().get(`/api/transfers/${transferId}`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(status.body.transfer.receivedChunkIndexes).toEqual([{ item_index: 0, chunk_index: 0 }]);
    expect(status.body.transfer.transferredBytes).toBe(CHUNK);
    expect(status.body.transfer.percent).toBeGreaterThan(0);
  });

  it('rejects wrong chunk sizes and checksum mismatches', async () => {
    const data = randomBytes(1024);
    const created = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({
        direction: 'device_to_cloud',
        items: [{ name: 'photo.jpg', size: data.byteLength, sha256: 'b'.repeat(64) }],
      });
    const transferId = created.body.transfer.id;

    const wrongSize = await api()
      .put(`/api/transfers/${transferId}/items/0/chunks/0`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('too small'));
    expect(wrongSize.status).toBe(400);

    await uploadChunks(transferId, 0, data, owner.accessToken);
    const badChecksum = await api()
      .post(`/api/transfers/${transferId}/items/0/complete`)
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(badChecksum.status).toBe(409);

    const after = await api().get(`/api/transfers/${transferId}`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(after.body.transfer.status).toBe('failed');
  });

  it('supports pause, resume, retry and cancel lifecycle', async () => {
    const data = randomBytes(CHUNK + 10);
    const created = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ direction: 'device_to_cloud', items: [{ name: 'dataset.zip', size: data.byteLength }] });
    const transferId = created.body.transfer.id;
    await uploadChunks(transferId, 0, data, owner.accessToken, 1);

    const paused = await api().post(`/api/transfers/${transferId}/pause`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(paused.body.transfer.status).toBe('paused');

    const blocked = await api()
      .put(`/api/transfers/${transferId}/items/0/chunks/1`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .send(data.subarray(CHUNK));
    expect(blocked.status).toBe(409);

    const resumed = await api().post(`/api/transfers/${transferId}/resume`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(resumed.body.transfer.status).toBe('active');

    const cancelled = await api().post(`/api/transfers/${transferId}/cancel`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(cancelled.body.transfer.status).toBe('cancelled');

    const retry = await api().post(`/api/transfers/${transferId}/retry`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(retry.body.transfer.status).toBe('pending');
  });

  it('lets an authenticated device push chunks for its own transfer only', async () => {
    const enrolled = await enrollDevice(owner);
    const device = await deviceTokens(enrolled);
    const other = await enrollDevice(owner, 'Second Phone');
    const otherTokens = await deviceTokens(other);
    const data = randomBytes(2048);

    const created = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${device.accessToken}`)
      .send({
        direction: 'device_to_cloud',
        sourceDeviceId: enrolled.deviceId,
        items: [{ name: 'log.txt', size: data.byteLength }],
      });
    expect(created.status).toBe(201);

    const intruderAttempt = await api()
      .put(`/api/transfers/${created.body.transfer.id}/items/0/chunks/0`)
      .set('authorization', `Bearer ${otherTokens.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .send(data);
    expect(intruderAttempt.status).toBe(403);

    const legit = await api()
      .put(`/api/transfers/${created.body.transfer.id}/items/0/chunks/0`)
      .set('authorization', `Bearer ${device.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .send(data);
    expect(legit.status).toBe(201);

    const completes = await api()
      .post(`/api/transfers/${created.body.transfer.id}/items/0/complete`)
      .set('authorization', `Bearer ${device.accessToken}`);
    expect(completes.status).toBe(200);
    expect(completes.body.transfer.status).toBe('completed');
  });

  it('refuses transfers for offline devices and foreign accounts', async () => {
    const enrolled = await enrollDevice(owner);
    const offline = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({
        direction: 'cloud_to_device',
        targetDeviceId: enrolled.deviceId,
        items: [{ name: 'a.txt', size: 10 }],
      });
    expect(offline.status).toBe(409);

    const intruder = await registerOwner('-transfer');
    const created = await api()
      .post('/api/transfers')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ direction: 'device_to_cloud', items: [{ name: 'b.txt', size: 10 }] });
    const peek = await api()
      .get(`/api/transfers/${created.body.transfer.id}`)
      .set('authorization', `Bearer ${intruder.accessToken}`);
    expect(peek.status).toBe(404);
  });
});
