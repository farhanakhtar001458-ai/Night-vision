import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, app, enrollDevice, registerOwner, resetDatabase, type Owner } from './helpers.js';

const binaryParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('file relay and management', () => {
  let owner: Owner;
  beforeEach(async () => {
    await resetDatabase();
    owner = await registerOwner();
  });

  it('uploads a file with checksum verification and lists it', async () => {
    const payload = Buffer.from('DroidLink X relay payload');
    const uploaded = await api()
      .post('/api/files/upload')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', encodeURIComponent('notes.txt'))
      .set('x-file-mime', 'text/plain')
      .set('x-content-sha256', sha(payload))
      .send(payload);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.file.name).toBe('notes.txt');
    expect(uploaded.body.file.size).toBe(payload.byteLength);
    expect(uploaded.body.file.category).toBe('documents');

    const list = await api().get('/api/files').set('authorization', `Bearer ${owner.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.files).toHaveLength(1);
    expect(list.body.storage.totalBytes).toBe(payload.byteLength);
    expect(list.body.storage.byCategory.documents).toBe(1);
  });

  it('rejects an upload whose checksum does not match', async () => {
    const res = await api()
      .post('/api/files/upload')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'bad.txt')
      .set('x-content-sha256', 'a'.repeat(64))
      .send(Buffer.from('tampered bytes'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Checksum mismatch');
  });

  it('downloads the exact bytes via a signed one-time URL', async () => {
    const payload = Buffer.from('binary-ish content \u0000\u0001\u0002');
    const uploaded = await api()
      .post('/api/files/upload')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'sample.bin')
      .send(payload);
    const url: string = uploaded.body.file.downloadUrl;

    const download = await request(app)
      .get(url)
      .buffer(true)
      .parse(binaryParser as never);
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, payload)).toBe(0);

    const forged = await request(app)
      .get(`/api/files/download/${uploaded.body.file.id}?token=forged.token.value`)
      .buffer(true)
      .parse(binaryParser as never);
    expect(forged.status).toBe(401);

    const unauthenticated = await request(app)
      .get(`/api/files/download/${uploaded.body.file.id}`)
      .buffer(true)
      .parse(binaryParser as never);
    expect(unauthenticated.status).toBe(401);
  });

  it('renames, filters and deletes files', async () => {
    const uploaded = await api()
      .post('/api/files/upload')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'draft.txt')
      .send(Buffer.from('draft'));
    const id = uploaded.body.file.id;

    const renamed = await api()
      .patch(`/api/files/${id}`)
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'final.txt' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.file.name).toBe('final.txt');

    const search = await api()
      .get('/api/files?search=final')
      .set('authorization', `Bearer ${owner.accessToken}`);
    expect(search.body.files).toHaveLength(1);

    const removed = await api().delete(`/api/files/${id}`).set('authorization', `Bearer ${owner.accessToken}`);
    expect(removed.status).toBe(204);

    const after = await api().get('/api/files').set('authorization', `Bearer ${owner.accessToken}`);
    expect(after.body.files).toHaveLength(0);
    const downloadAfter = await api()
      .get(`/api/files/download/${id}?token=${uploaded.body.file.downloadUrl.split('token=')[1]}`)
      .buffer(true)
      .parse(binaryParser as never);
    expect(downloadAfter.status).toBe(404);
  });

  it('never exposes another account\'s files', async () => {
    await enrollDevice(owner);
    const uploaded = await api()
      .post('/api/files/upload')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'private.txt')
      .send(Buffer.from('private'));
    const intruder = await registerOwner('-files');
    const list = await api().get('/api/files').set('authorization', `Bearer ${intruder.accessToken}`);
    expect(list.body.files).toHaveLength(0);
    const download = await api()
      .get(uploaded.body.file.downloadUrl)
      .set('authorization', `Bearer ${intruder.accessToken}`);
    expect(download.status).toBe(403);
    const del = await api()
      .delete(`/api/files/${uploaded.body.file.id}`)
      .set('authorization', `Bearer ${intruder.accessToken}`);
    expect(del.status).toBe(404);
  });
});
