import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB

export function storageRoot(): string {
  return path.resolve(env.STORAGE_DIR);
}

export async function ensureStorageDirs(): Promise<void> {
  await mkdir(path.join(storageRoot(), 'files'), { recursive: true });
  await mkdir(path.join(storageRoot(), 'transfers'), { recursive: true });
  await mkdir(path.join(storageRoot(), 'tmp'), { recursive: true });
}

/** Strips path traversal and control characters from client-supplied names. */
export function sanitiseName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned.length > 0 ? cleaned : 'file').slice(0, 200);
}

export function fileKeyFor(userId: string, fileId: string): string {
  return path.join('files', userId, fileId);
}

export function absoluteFor(key: string): string {
  const resolved = path.resolve(storageRoot(), key);
  const root = storageRoot();
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new AppError('FORBIDDEN', 'Resolved storage path escaped the storage root');
  }
  return resolved;
}

export async function writeBlob(key: string, data: Buffer): Promise<void> {
  const abs = absoluteFor(key);
  await mkdir(path.dirname(abs), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(abs, data, { mode: 0o600 });
}

export async function blobSize(key: string): Promise<number> {
  try {
    const info = await stat(absoluteFor(key));
    return info.size;
  } catch {
    return 0;
  }
}

export function blobStream(key: string): NodeJS.ReadableStream {
  return createReadStream(absoluteFor(key));
}

export async function removeBlob(key: string): Promise<void> {
  await rm(absoluteFor(key), { force: true });
}

export async function unlinkQuiet(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const IMAGE = /\.(jpe?g|png|gif|webp|heic|bmp|svg)$/i;
const VIDEO = /\.(mp4|mkv|mov|webm|avi|3gp)$/i;
const AUDIO = /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i;
const DOC = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|xml|zip|rar|7z|tar|gz)$/i;
const APK = /\.(apk|xapk|apks)$/i;

export function categoryFor(name: string, mime?: string | null): string {
  if (APK.test(name) || mime === 'application/vnd.android.package-archive') return 'apk';
  if (IMAGE.test(name) || mime?.startsWith('image/')) return 'images';
  if (VIDEO.test(name) || mime?.startsWith('video/')) return 'videos';
  if (AUDIO.test(name) || mime?.startsWith('audio/')) return 'music';
  if (/\.(apk)$/i.test(name)) return 'apk';
  if (DOC.test(name)) return 'documents';
  return 'documents';
}

export function mimeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.apk': 'application/vnd.android.package-archive',
    '.sdp': 'application/sdp',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
