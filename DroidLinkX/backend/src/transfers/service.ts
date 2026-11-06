import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { many, one, query, withTransaction } from '../database/pool.js';
import { AppError } from '../utils/errors.js';
import { recordActivity } from '../activity/service.js';
import { emit, verifiedOnline } from '../realtime/hub.js';
import { sanitiseName, sha256OfFile, storageRoot, absoluteFor, CHUNK_SIZE_BYTES, fileKeyFor } from '../files/storage.js';
import { registerFileFromPath } from '../files/service.js';

export type TransferDirection =
  | 'device_to_device'
  | 'device_to_cloud'
  | 'cloud_to_device'
  | 'dashboard_to_device'
  | 'device_to_dashboard';

export type TransferRow = {
  id: string;
  user_id: string;
  source_device_id: string | null;
  target_device_id: string | null;
  direction: TransferDirection;
  mode: 'direct' | 'relay';
  status: string;
  total_bytes: number;
  transferred_bytes: number;
  item_count: number;
  completed_items: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

export type TransferItemRow = {
  id: string;
  transfer_id: string;
  item_index: number;
  name: string;
  relative_path: string;
  size: number;
  sha256: string | null;
  status: string;
  bytes_received: number;
  received_chunks: number;
  checksum_verified: boolean;
  storage_key: string | null;
  file_id: string | null;
  error: string | null;
};

function partsDir(transferId: string): string {
  return path.join(storageRoot(), 'transfers', transferId);
}

function partPath(transferId: string, itemIndex: number): string {
  return path.join(partsDir(transferId), `${itemIndex}.part`);
}

export function publicTransfer(row: TransferRow, items: TransferItemRow[] = []): Record<string, unknown> {
  const percent = row.total_bytes > 0 ? Math.min(100, Math.round((row.transferred_bytes / row.total_bytes) * 1000) / 10) : 0;
  return {
    id: row.id,
    direction: row.direction,
    mode: row.mode,
    status: row.status,
    sourceDeviceId: row.source_device_id,
    targetDeviceId: row.target_device_id,
    totalBytes: row.total_bytes,
    transferredBytes: row.transferred_bytes,
    percent,
    itemCount: row.item_count,
    completedItems: row.completed_items,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    chunkSize: CHUNK_SIZE_BYTES,
    items: items.map((item) => ({
      id: item.id,
      index: item.item_index,
      name: item.name,
      path: item.relative_path,
      size: item.size,
      sha256: item.sha256,
      status: item.status,
      bytesReceived: item.bytes_received,
      receivedChunks: item.received_chunks,
      checksumVerified: item.checksum_verified,
      fileId: item.file_id,
      error: item.error,
    })),
  };
}

async function assertTransferAccess(
  userId: string,
  transferId: string,
  deviceId?: string,
): Promise<{ transfer: TransferRow; items: TransferItemRow[] }> {
  const transfer = await one<TransferRow>('SELECT * FROM file_transfers WHERE id = $1 AND user_id = $2', [
    transferId,
    userId,
  ]);
  if (!transfer) throw new AppError('NOT_FOUND', 'Transfer not found');
  if (deviceId && transfer.source_device_id !== deviceId && transfer.target_device_id !== deviceId) {
    throw new AppError('FORBIDDEN', 'This device is not part of the transfer');
  }
  const items = await many<TransferItemRow>(
    'SELECT * FROM transfer_items WHERE transfer_id = $1 ORDER BY item_index ASC',
    [transferId],
  );
  return { transfer, items };
}

export async function createTransfer(
  userId: string,
  input: {
    direction: TransferDirection;
    mode?: 'direct' | 'relay';
    sourceDeviceId?: string | null;
    targetDeviceId?: string | null;
    items: Array<{ name: string; size: number; sha256?: string | null; relativePath?: string }>;
  },
  actor: { type: 'user' | 'device'; deviceId?: string },
): Promise<{ transfer: Record<string, unknown>; uploadUrls: Array<{ index: number; chunks: number; url: string }> }> {
  if (input.items.length === 0) throw new AppError('BAD_REQUEST', 'At least one item is required');
  if (input.items.length > 500) throw new AppError('BAD_REQUEST', 'Too many items in one transfer (max 500)');

  const deviceIds = [input.sourceDeviceId, input.targetDeviceId].filter((v): v is string => Boolean(v));
  if (deviceIds.length) {
    const owned = await many<{ id: string; online: boolean }>(
      `SELECT id, online FROM devices WHERE user_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
      [userId, deviceIds],
    );
    if (owned.length !== deviceIds.length) throw new AppError('NOT_FOUND', 'One or more devices are not enrolled');
    for (const device of owned) {
      // The device driving the request over HTTPS is online by definition.
      if (actor.type === 'device' && actor.deviceId === device.id) continue;
      const online = await verifiedOnline(device.id);
      if (!online) throw new AppError('CONFLICT', `Device ${device.id} is offline`, { deviceId: device.id });
    }
  }

  const totalBytes = input.items.reduce((sum, item) => sum + item.size, 0);
  if (totalBytes === 0) throw new AppError('BAD_REQUEST', 'Total transfer size must be greater than zero');

  const created = await withTransaction(async (client) => {
    const transferResult = await client.query<TransferRow>(
      `INSERT INTO file_transfers (user_id, source_device_id, target_device_id, direction, mode, status, total_bytes, item_count, started_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, now())
       RETURNING *`,
      [
        userId,
        input.sourceDeviceId ?? null,
        input.targetDeviceId ?? null,
        input.direction,
        input.mode ?? 'relay',
        totalBytes,
        input.items.length,
      ],
    );
    const transfer = transferResult.rows[0]!;
    for (const [index, item] of input.items.entries()) {
      await client.query(
        `INSERT INTO transfer_items (transfer_id, item_index, name, relative_path, size, sha256)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transfer.id, index, sanitiseName(item.name), item.relativePath ?? '/', item.size, item.sha256 ?? null],
      );
    }
    await client.query(
      `INSERT INTO transfer_history (transfer_id, user_id, event, bytes, detail)
       VALUES ($1, $2, 'created', 0, $3)`,
      [transfer.id, userId, JSON.stringify({ direction: input.direction, itemCount: input.items.length })],
    );
    return transfer;
  });

  await mkdir(partsDir(created.id), { recursive: true });

  const items = await many<TransferItemRow>('SELECT * FROM transfer_items WHERE transfer_id = $1 ORDER BY item_index', [
    created.id,
  ]);
  await recordActivity({
    userId,
    deviceId: input.sourceDeviceId ?? input.targetDeviceId ?? null,
    actorType: actor.type,
    action: 'transfer.created',
    targetType: 'transfer',
    targetId: created.id,
    metadata: { direction: input.direction, items: input.items.length, totalBytes },
  });
  await emit({ ownerId: userId }, {
    type: 'transfer:progress',
    transferId: created.id,
    bytes: 0,
    total: totalBytes,
    status: 'pending',
  });

  return {
    transfer: publicTransfer(created, items),
    uploadUrls: items.map((item) => ({
      index: item.item_index,
      chunks: Math.max(1, Math.ceil(item.size / CHUNK_SIZE_BYTES)),
      url: `/api/transfers/${created.id}/items/${item.item_index}/chunks/{chunkIndex}`,
    })),
  };
}

export async function appendChunk(
  userId: string,
  transferId: string,
  itemIndex: number,
  chunkIndex: number,
  data: Buffer,
  deviceId?: string,
): Promise<Record<string, unknown>> {
  const { transfer, items } = await assertTransferAccess(userId, transferId, deviceId);
  if (transfer.status === 'cancelled') throw new AppError('CONFLICT', 'Transfer was cancelled');
  if (transfer.status === 'paused') throw new AppError('CONFLICT', 'Transfer is paused. Resume it before uploading.');
  if (transfer.status === 'completed') throw new AppError('CONFLICT', 'Transfer already completed');
  const item = items.find((i) => i.item_index === itemIndex);
  if (!item) throw new AppError('NOT_FOUND', 'Transfer item not found');

  const offset = chunkIndex * CHUNK_SIZE_BYTES;
  if (offset >= item.size) throw new AppError('BAD_REQUEST', 'Chunk index is beyond the end of the file');
  const expectedSize = Math.min(CHUNK_SIZE_BYTES, item.size - offset);
  if (data.byteLength !== expectedSize) {
    throw new AppError('BAD_REQUEST', `Chunk ${chunkIndex} must be exactly ${expectedSize} bytes`, {
      expected: expectedSize,
      received: data.byteLength,
    });
  }

  const existing = await one<{ size: number }>(
    'SELECT size FROM transfer_chunks WHERE transfer_id = $1 AND item_index = $2 AND chunk_index = $3',
    [transferId, itemIndex, chunkIndex],
  );
  if (existing) {
    return { duplicate: true, transfer: publicTransfer(transfer, items) };
  }

  await mkdir(partsDir(transferId), { recursive: true });
  const handle = await open(partPath(transferId, itemIndex), 'r+').catch(async () => {
    const created = await open(partPath(transferId, itemIndex), 'w+');
    await created.truncate(item.size);
    return created;
  });
  try {
    await handle.write(data, 0, data.byteLength, offset);
  } finally {
    await handle.close();
  }

  const { createHash } = await import('node:crypto');
  const chunkSha = createHash('sha256').update(data).digest('hex');

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO transfer_chunks (transfer_id, item_index, chunk_index, size, sha256)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [transferId, itemIndex, chunkIndex, data.byteLength, chunkSha],
    );
    await client.query(
      `UPDATE transfer_items
          SET bytes_received = (SELECT COALESCE(sum(size), 0) FROM transfer_chunks WHERE transfer_id = $1 AND item_index = $2),
              received_chunks = (SELECT count(*) FROM transfer_chunks WHERE transfer_id = $1 AND item_index = $2),
              status = 'uploading'
        WHERE transfer_id = $1 AND item_index = $2`,
      [transferId, itemIndex],
    );
    await client.query(
      `UPDATE file_transfers
          SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
              transferred_bytes = (SELECT COALESCE(sum(size), 0) FROM transfer_chunks WHERE transfer_id = $1),
              updated_at = now()
        WHERE id = $1`,
      [transferId],
    );
  });

  const fresh = await assertTransferAccess(userId, transferId, deviceId);
  await emit({ ownerId: userId }, {
    type: 'transfer:progress',
    transferId,
    bytes: fresh.transfer.transferred_bytes,
    total: fresh.transfer.total_bytes,
    itemIndex,
    status: fresh.transfer.status,
  });
  return { duplicate: false, transfer: publicTransfer(fresh.transfer, fresh.items) };
}

export async function completeItem(
  userId: string,
  transferId: string,
  itemIndex: number,
  providedSha256?: string,
  deviceId?: string,
): Promise<{ transfer: Record<string, unknown>; file?: Record<string, unknown> }> {
  const { transfer, items } = await assertTransferAccess(userId, transferId, deviceId);
  if (transfer.status === 'cancelled') throw new AppError('CONFLICT', 'Transfer was cancelled');
  const item = items.find((i) => i.item_index === itemIndex);
  if (!item) throw new AppError('NOT_FOUND', 'Transfer item not found');
  if (item.status === 'completed') {
    return { transfer: publicTransfer(transfer, items) };
  }
  if (item.bytes_received < item.size) {
    throw new AppError('CONFLICT', `Transfer item is incomplete (${item.bytes_received}/${item.size} bytes)`);
  }

  const partFile = partPath(transferId, itemIndex);
  const actualSha = await sha256OfFile(partFile);
  const expected = (providedSha256 ?? item.sha256 ?? '').toLowerCase();
  if (expected && actualSha !== expected) {
    await query(`UPDATE transfer_items SET status = 'failed', error = $3 WHERE transfer_id = $1 AND item_index = $2`, [
      transferId,
      itemIndex,
      'checksum mismatch',
    ]);
    await query(`UPDATE file_transfers SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [
      transferId,
      `checksum mismatch for ${item.name}`,
    ]);
    await emit({ ownerId: userId }, { type: 'transfer:failed', transferId, error: 'checksum mismatch' });
    throw new AppError('CONFLICT', 'Checksum verification failed for this item', { expected, actual: actualSha });
  }

  const fileRow = await one<{ id: string }>('SELECT gen_random_uuid() AS id');
  const fileId = fileRow!.id;
  const storageKey = fileKeyFor(userId, fileId);
  const destination = absoluteFor(storageKey);
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(partFile, destination).catch(async () => {
    // cross-device fallback
    const { copyFile } = await import('node:fs/promises');
    await copyFile(partFile, destination);
    await rm(partFile, { force: true });
  });

  const file = await registerFileFromPath({
    userId,
    deviceId: transfer.source_device_id ?? transfer.target_device_id,
    name: item.name,
    path: item.relative_path,
    absolutePath: destination,
    size: item.size,
    sha256: actualSha,
    storageKey,
  });

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE transfer_items
          SET status = 'completed', checksum_verified = true, storage_key = $3, file_id = $4, completed_at = now(), error = NULL
        WHERE transfer_id = $1 AND item_index = $2`,
      [transferId, itemIndex, storageKey, file.id],
    );
    await client.query(
      `UPDATE file_transfers
          SET completed_items = (SELECT count(*) FROM transfer_items WHERE transfer_id = $1 AND status = 'completed'),
              updated_at = now()
        WHERE id = $1`,
      [transferId],
    );
    await client.query(
      `INSERT INTO transfer_history (transfer_id, user_id, item_index, event, bytes, detail)
       VALUES ($1, $2, $3, 'item_completed', $4, $5)`,
      [transferId, userId, itemIndex, item.size, JSON.stringify({ fileId: file.id, sha256: actualSha })],
    );
  });

  const after = await assertTransferAccess(userId, transferId, deviceId);
  if (after.transfer.completed_items >= after.transfer.item_count) {
    await query(
      `UPDATE file_transfers SET status = 'completed', completed_at = now(), updated_at = now(),
              transferred_bytes = total_bytes WHERE id = $1`,
      [transferId],
    );
    await query(
      `INSERT INTO transfer_history (transfer_id, user_id, event, bytes) VALUES ($1, $2, 'completed', $3)`,
      [transferId, userId, after.transfer.total_bytes],
    );
    await emit({ ownerId: userId }, {
      type: 'transfer:completed',
      transferId,
      totalBytes: after.transfer.total_bytes,
      itemCount: after.transfer.item_count,
    });
    await recordActivity({
      userId,
      actorType: 'device',
      action: 'transfer.completed',
      targetType: 'transfer',
      targetId: transferId,
      metadata: { itemCount: after.transfer.item_count, totalBytes: after.transfer.total_bytes },
    });
  }

  const final = await assertTransferAccess(userId, transferId, deviceId);
  return { transfer: publicTransfer(final.transfer, final.items), file };
}

export async function setStatus(
  userId: string,
  transferId: string,
  action: 'pause' | 'resume' | 'cancel' | 'retry',
): Promise<Record<string, unknown>> {
  const { transfer, items } = await assertTransferAccess(userId, transferId);
  const transitions: Record<typeof action, { from: string[]; to: string }> = {
    pause: { from: ['pending', 'active'], to: 'paused' },
    resume: { from: ['paused'], to: 'active' },
    cancel: { from: ['pending', 'active', 'paused', 'failed'], to: 'cancelled' },
    retry: { from: ['failed', 'cancelled'], to: 'pending' },
  };
  const rule = transitions[action];
  if (!rule.from.includes(transfer.status)) {
    throw new AppError('CONFLICT', `Cannot ${action} a transfer in state "${transfer.status}"`);
  }
  await query('UPDATE file_transfers SET status = $2, updated_at = now(), error = NULL WHERE id = $1', [
    transferId,
    rule.to,
  ]);
  await query(
    `INSERT INTO transfer_history (transfer_id, user_id, event, bytes) VALUES ($1, $2, $3, 0)`,
    [transferId, userId, action],
  );
  if (action === 'retry') {
    // Keep successfully received chunks so the client resumes instead of restarting.
    await query(
      `UPDATE transfer_items SET status = 'pending', error = NULL WHERE transfer_id = $1 AND status = 'failed'`,
      [transferId],
    );
  }
  await emit({ ownerId: userId }, { type: 'transfer:progress', transferId, status: rule.to, bytes: transfer.transferred_bytes, total: transfer.total_bytes });
  const fresh = await assertTransferAccess(userId, transferId);
  return publicTransfer(fresh.transfer, fresh.items);
}

export async function getTransfer(userId: string, transferId: string): Promise<Record<string, unknown>> {
  const { transfer, items } = await assertTransferAccess(userId, transferId);
  const chunks = await many<{ item_index: number; chunk_index: number }>(
    'SELECT item_index, chunk_index FROM transfer_chunks WHERE transfer_id = $1 ORDER BY item_index, chunk_index',
    [transferId],
  );
  return { ...publicTransfer(transfer, items), receivedChunkIndexes: chunks };
}

export async function listTransfers(userId: string, limit = 50): Promise<Record<string, unknown>[]> {
  const rows = await many<TransferRow>(
    'SELECT * FROM file_transfers WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, Math.min(limit, 200)],
  );
  if (rows.length === 0) return [];
  const items = await many<TransferItemRow>(
    'SELECT * FROM transfer_items WHERE transfer_id = ANY($1::uuid[]) ORDER BY item_index',
    [rows.map((r) => r.id)],
  );
  return rows.map((row) => publicTransfer(row, items.filter((i) => i.transfer_id === row.id)));
}

export async function transferHistory(userId: string, limit = 100): Promise<unknown[]> {
  const rows = await many(
    `SELECT h.id, h.transfer_id, h.item_index, h.event, h.bytes, h.detail, h.created_at, t.direction, t.mode
       FROM transfer_history h JOIN file_transfers t ON t.id = h.transfer_id
      WHERE h.user_id = $1 ORDER BY h.created_at DESC LIMIT $2`,
    [userId, Math.min(limit, 500)],
  );
  return rows.map((r) => ({
    id: r.id,
    transferId: r.transfer_id,
    itemIndex: r.item_index,
    event: r.event,
    bytes: r.bytes,
    detail: r.detail,
    direction: r.direction,
    mode: r.mode,
    createdAt: r.created_at,
  }));
}
