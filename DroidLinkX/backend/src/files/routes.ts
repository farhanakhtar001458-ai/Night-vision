import { Router, type Request } from 'express';
import express from 'express';
import { z } from 'zod';
import { body, paramsSchema, querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireUser } from '../middleware/auth.js';
import * as files from './service.js';
import { AppError } from '../utils/errors.js';
import { verifyDownloadToken } from '../security/crypto.js';
import { env } from '../config/env.js';
import { blobStream, CHUNK_SIZE_BYTES } from './storage.js';
import { cache } from '../store/cache.js';

const listQuery = z.object({
  category: z.string().max(32).optional(),
  deviceId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['name', 'size', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const uploadMeta = z.object({
  name: z.string().min(1).max(200),
  path: z.string().max(512).optional(),
  category: z.string().max(32).optional(),
  deviceId: z.string().uuid().optional(),
  ephemeral: z.boolean().optional(),
  mime: z.string().max(128).optional(),
});

const renameSchema = z.object({ name: z.string().min(1).max(200) });

function header(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return value && value.length > 0 ? decodeURIComponent(value) : undefined;
}

export const filesRouter = Router();

filesRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const filters = querySchema(req, listQuery);
    res.json(await files.listFiles(req.user!.sub, filters));
  }),
);

/**
 * Single-shot upload (client-favoured for small files) with checksum verification.
 * Large files use the chunked /api/transfers pipeline instead.
 */
filesRouter.post(
  '/upload',
  requireUser,
  express.raw({ type: () => true, limit: Math.min(env.MAX_UPLOAD_BYTES, 256 * 1024 * 1024) }),
  asyncHandler(async (req, res) => {
    const raw = req.body as Buffer | undefined;
    if (!raw || !Buffer.isBuffer(raw) || raw.byteLength === 0) throw new AppError('BAD_REQUEST', 'Empty upload body');

    const meta = uploadMeta.parse({
      name: header(req, 'x-file-name') ?? 'upload.bin',
      path: header(req, 'x-file-path'),
      category: header(req, 'x-file-category'),
      deviceId: header(req, 'x-device-id'),
      mime: header(req, 'x-file-mime'),
      ephemeral: header(req, 'x-ephemeral') === 'true',
    });

    const expected = header(req, 'x-content-sha256');
    if (expected) {
      const { createHash } = await import('node:crypto');
      const actual = createHash('sha256').update(raw).digest('hex');
      if (actual !== expected.toLowerCase()) {
        throw new AppError('BAD_REQUEST', 'Checksum mismatch: uploaded bytes do not match X-Content-Sha256', {
          expected,
          actual,
        });
      }
    }

    const file = await files.createFileFromBuffer({
      userId: req.user!.sub,
      deviceId: meta.deviceId ?? null,
      name: meta.name,
      path: meta.path,
      data: raw,
      mime: meta.mime,
      category: meta.category,
      expiresInSeconds: meta.ephemeral ? 3600 : null,
    });
    res.status(201).json({ file });
  }),
);

/** Streamed download. Accepts either a bearer token or a short-lived signed token. */
filesRouter.get(
  '/download/:id',
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, z.object({ id: z.string().uuid() }));
    const signed = req.query.token ? verifyDownloadToken(String(req.query.token)) : null;
    if (signed && signed.fileId !== id) throw new AppError('FORBIDDEN', 'Download token does not match this file');

    let userId: string | null = null;
    let presentedBearer: string | null = null;
    if (signed) {
      const row = await files.downloadTarget(id);
      userId = row.row.user_id;
      const authHeader = req.header('authorization') ?? '';
      presentedBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    } else {
      const authHeader = req.header('authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) throw new AppError('UNAUTHORIZED', 'A signed download token or bearer token is required');
      const { tryVerifyAccessToken } = await import('../security/tokens.js');
      const payload = tryVerifyAccessToken(token, 'user');
      if (!payload) throw new AppError('UNAUTHORIZED', 'Invalid or expired token');
      userId = payload.sub;
    }

    const { row, absolutePath, size } = await files.downloadTarget(id);
    if (presentedBearer) {
      // A signed link is a capability, but an explicitly different account must never ride it.
      const { tryVerifyAccessToken } = await import('../security/tokens.js');
      const presented = tryVerifyAccessToken(presentedBearer, 'user');
      if (presented && presented.sub !== row.user_id) {
        throw new AppError('FORBIDDEN', 'This file belongs to another account');
      }
    }
    if (row.user_id !== userId) throw new AppError('FORBIDDEN', 'This file belongs to another account');

    await cache().set(`download:${id}:${req.ip ?? 'unknown'}`, '1', 5);
    res.setHeader('Content-Type', row.mime ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.name)}"`);
    res.setHeader('X-Content-Sha256', row.sha256 ?? '');
    res.setHeader('Cache-Control', 'private, no-store');
    blobStream(row.storage_key!).pipe(res);
  }),
);

filesRouter.get(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, z.object({ id: z.string().uuid() }));
    const row = await files.getFile(req.user!.sub, id);
    res.json({ file: row });
  }),
);

filesRouter.patch(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, z.object({ id: z.string().uuid() }));
    const { name } = body(req, renameSchema);
    res.json({ file: await files.renameFile(req.user!.sub, id, name) });
  }),
);

filesRouter.delete(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, z.object({ id: z.string().uuid() }));
    await files.deleteFile(req.user!.sub, id);
    res.status(204).send();
  }),
);

export const fileChunkSize = CHUNK_SIZE_BYTES;
