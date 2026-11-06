import { createHash } from 'node:crypto';
import { many, one } from '../database/pool.js';
import { AppError } from '../utils/errors.js';
import { recordActivity } from '../activity/service.js';
import { signDownloadToken } from '../security/crypto.js';
import { env } from '../config/env.js';
import {
  absoluteFor,
  blobSize,
  categoryFor,
  fileKeyFor,
  mimeFor,
  removeBlob,
  sanitiseName,
  writeBlob,
} from './storage.js';

type FileRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  name: string;
  path: string;
  size: number;
  mime: string | null;
  sha256: string | null;
  storage_key: string | null;
  category: string;
  direction: string;
  expires_at: Date | null;
  created_at: Date;
};

export type PublicFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  mime: string;
  category: string;
  sha256: string | null;
  deviceId: string | null;
  direction: string;
  createdAt: string;
  expiresAt: string | null;
  downloadUrl: string;
};

function toPublic(row: FileRow): PublicFile {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    size: row.size,
    mime: row.mime ?? mimeFor(row.name),
    category: row.category,
    sha256: row.sha256,
    deviceId: row.device_id,
    direction: row.direction,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    downloadUrl: `/api/files/download/${row.id}?token=${signDownloadToken(row.id)}`,
  };
}

export async function listFiles(
  userId: string,
  filters: { category?: string; deviceId?: string; search?: string; sort?: 'name' | 'size' | 'created_at'; order?: 'asc' | 'desc'; limit?: number },
): Promise<{ files: PublicFile[]; storage: { totalBytes: number; fileCount: number; byCategory: Record<string, number> } }> {
  const conditions = ['user_id = $1', 'deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (filters.category && filters.category !== 'recent') {
    params.push(filters.category);
    conditions.push(`category = $${params.length}`);
  }
  if (filters.deviceId) {
    params.push(filters.deviceId);
    conditions.push(`device_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search.replace(/[%_]/g, '')}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  const sortColumn = filters.sort === 'name' ? 'name' : filters.sort === 'size' ? 'size' : 'created_at';
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  params.push(Math.min(filters.limit ?? 200, 500));

  const rows = await many<FileRow>(
    `SELECT * FROM files WHERE ${conditions.join(' AND ')}
      ORDER BY ${sortColumn} ${direction} LIMIT $${params.length}`,
    params,
  );
  const stats = await many<{ category: string; total: number; count: number }>(
    `SELECT category, COALESCE(sum(size), 0)::bigint AS total, count(*)::int AS count
       FROM files WHERE user_id = $1 AND deleted_at IS NULL GROUP BY category`,
    [userId],
  );
  const byCategory: Record<string, number> = {};
  let totalBytes = 0;
  let fileCount = 0;
  for (const stat of stats) {
    byCategory[stat.category] = stat.count;
    totalBytes += Number(stat.total);
    fileCount += stat.count;
  }
  return { files: rows.map(toPublic), storage: { totalBytes, fileCount, byCategory } };
}

export async function createFileFromBuffer(params: {
  userId: string;
  deviceId?: string | null;
  name: string;
  path?: string;
  data: Buffer;
  mime?: string | null;
  direction?: 'upload' | 'download';
  expiresInSeconds?: number | null;
  category?: string;
}): Promise<PublicFile> {
  const name = sanitiseName(params.name);
  const sha256 = createHash('sha256').update(params.data).digest('hex');
  const mime = params.mime || mimeFor(name);
  const category = params.category ?? categoryFor(name, mime);
  const row = await one<FileRow>(
    `INSERT INTO files (user_id, device_id, name, path, size, mime, sha256, category, direction, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.userId,
      params.deviceId ?? null,
      name,
      params.path ?? '/',
      params.data.byteLength,
      mime,
      sha256,
      category,
      params.direction ?? 'upload',
      params.expiresInSeconds ? new Date(Date.now() + params.expiresInSeconds * 1000) : null,
    ],
  );
  if (!row) throw new AppError('INTERNAL', 'Failed to create the file record');
  const key = fileKeyFor(params.userId, row.id);
  await writeBlob(key, params.data);
  const updated = await one<FileRow>('UPDATE files SET storage_key = $2 WHERE id = $1 RETURNING *', [row.id, key]);
  await recordActivity({
    userId: params.userId,
    deviceId: params.deviceId ?? null,
    actorType: params.deviceId ? 'device' : 'user',
    action: 'file.uploaded',
    targetType: 'file',
    targetId: row.id,
    metadata: { name, size: params.data.byteLength, sha256 },
  });
  return toPublic(updated ?? row);
}

export async function registerFileFromPath(params: {
  userId: string;
  deviceId?: string | null;
  name: string;
  path?: string;
  absolutePath: string;
  size: number;
  sha256: string;
  storageKey: string;
  category?: string;
  direction?: 'upload' | 'download';
}): Promise<PublicFile> {
  const name = sanitiseName(params.name);
  const mime = mimeFor(name);
  const row = await one<FileRow>(
    `INSERT INTO files (user_id, device_id, name, path, size, mime, sha256, storage_key, category, direction)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      params.userId,
      params.deviceId ?? null,
      name,
      params.path ?? '/',
      params.size,
      mime,
      params.sha256,
      params.storageKey,
      params.category ?? categoryFor(name, mime),
      params.direction ?? 'upload',
    ],
  );
  if (!row) throw new AppError('INTERNAL', 'Failed to register the file record');
  return toPublic(row);
}

export async function getFile(userId: string, fileId: string): Promise<FileRow> {
  const row = await one<FileRow>('SELECT * FROM files WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [
    fileId,
    userId,
  ]);
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  return row;
}

export async function downloadTarget(fileId: string): Promise<{ row: FileRow; absolutePath: string; size: number }> {
  const row = await one<FileRow>('SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL', [fileId]);
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  if (row.expires_at && row.expires_at.getTime() < Date.now()) {
    throw new AppError('NOT_FOUND', 'This temporary download has expired');
  }
  if (!row.storage_key) throw new AppError('NOT_FOUND', 'File content is not available on this server');
  const absolutePath = absoluteFor(row.storage_key);
  const size = await blobSize(row.storage_key);
  if (size === 0) throw new AppError('NOT_FOUND', 'Stored file is empty or missing');
  return { row, absolutePath, size };
}

export async function deleteFile(userId: string, fileId: string): Promise<void> {
  const row = await one<FileRow>(
    `UPDATE files SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`,
    [fileId, userId],
  );
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  if (row.storage_key) await removeBlob(row.storage_key).catch(() => undefined);
  await recordActivity({
    userId,
    deviceId: row.device_id,
    actorType: 'user',
    action: 'file.deleted',
    targetType: 'file',
    targetId: fileId,
    metadata: { name: row.name },
  });
}

export async function renameFile(userId: string, fileId: string, name: string): Promise<PublicFile> {
  const clean = sanitiseName(name);
  const row = await one<FileRow>(
    `UPDATE files SET name = $3, category = $4, mime = $5 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`,
    [fileId, userId, clean, categoryFor(clean), mimeFor(clean)],
  );
  if (!row) throw new AppError('NOT_FOUND', 'File not found');
  await recordActivity({
    userId,
    actorType: 'user',
    action: 'file.renamed',
    targetType: 'file',
    targetId: fileId,
    metadata: { name: clean },
  });
  return toPublic(row);
}

export async function purgeExpired(): Promise<number> {
  const rows = await many<FileRow>(
    `DELETE FROM files WHERE expires_at IS NOT NULL AND expires_at < now() RETURNING *`,
  );
  for (const row of rows) {
    if (row.storage_key) await removeBlob(row.storage_key).catch(() => undefined);
  }
  return rows.length;
}

export const downloadTokenTtl = env.DOWNLOAD_URL_TTL;
