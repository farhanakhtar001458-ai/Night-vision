import { Router, type Request } from 'express';
import express from 'express';
import { z } from 'zod';
import { body, paramsSchema, querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireUser, requireUserOrDevice } from '../middleware/auth.js';
import * as transfers from './service.js';
import { CHUNK_SIZE_BYTES } from '../files/storage.js';
import { AppError } from '../utils/errors.js';

const direction = z.enum([
  'device_to_device',
  'device_to_cloud',
  'cloud_to_device',
  'dashboard_to_device',
  'device_to_dashboard',
]);

const createSchema = z.object({
  direction,
  mode: z.enum(['direct', 'relay']).optional(),
  sourceDeviceId: z.string().uuid().nullable().optional(),
  targetDeviceId: z.string().uuid().nullable().optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        size: z.number().int().min(1).max(100 * 1024 * 1024 * 1024),
        sha256: z.string().length(64).optional().nullable(),
        relativePath: z.string().max(512).optional(),
      }),
    )
    .min(1)
    .max(500),
});

const idParams = z.object({ id: z.string().uuid() });
const itemParams = z.object({
  id: z.string().uuid(),
  index: z.coerce.number().int().min(0),
  chunkIndex: z.coerce.number().int().min(0),
});

function actorOf(req: Request): { type: 'user' | 'device'; deviceId?: string } {
  return req.device ? { type: 'device', deviceId: req.device.sub } : { type: 'user' };
}

export const transfersRouter = Router();

transfersRouter.post(
  '/',
  requireUserOrDevice,
  asyncHandler(async (req, res) => {
    const payload = body(req, createSchema);
    const actor = actorOf(req);
    if (actor.type === 'device') {
      const participates =
        payload.sourceDeviceId === actor.deviceId || payload.targetDeviceId === actor.deviceId;
      if (!participates) throw new AppError('FORBIDDEN', 'A device may only start transfers it participates in');
    }
    const result = await transfers.createTransfer(
      req.user?.sub ?? req.device!.uid,
      {
        direction: payload.direction,
        mode: payload.mode,
        sourceDeviceId: payload.sourceDeviceId ?? null,
        targetDeviceId: payload.targetDeviceId ?? null,
        items: payload.items,
      },
      actor,
    );
    res.status(201).json(result);
  }),
);

transfersRouter.get(
  '/history',
  requireUser,
  asyncHandler(async (req, res) => {
    const { limit } = querySchema(req, z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }));
    res.json({ history: await transfers.transferHistory(req.user!.sub, limit) });
  }),
);

transfersRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const { limit } = querySchema(req, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    res.json({ transfers: await transfers.listTransfers(req.user!.sub, limit) });
  }),
);

transfersRouter.get(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idParams);
    res.json({ transfer: await transfers.getTransfer(req.user!.sub, id) });
  }),
);

/** Chunk upload: raw octet-stream body, exactly chunkSize bytes except for the final chunk. */
transfersRouter.put(
  '/:id/items/:index/chunks/:chunkIndex',
  requireUserOrDevice,
  express.raw({ type: () => true, limit: CHUNK_SIZE_BYTES + 1024 }),
  asyncHandler(async (req, res) => {
    const { id, index, chunkIndex } = paramsSchema(req, itemParams);
    const raw = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(raw) || raw.byteLength === 0) throw new AppError('BAD_REQUEST', 'Empty chunk body');
    const result = await transfers.appendChunk(
      req.user?.sub ?? req.device!.uid,
      id,
      index,
      chunkIndex,
      raw,
      req.device?.sub,
    );
    res.status(result.duplicate ? 200 : 201).json(result);
  }),
);

transfersRouter.post(
  '/:id/items/:index/complete',
  requireUserOrDevice,
  asyncHandler(async (req, res) => {
    const { id, index, chunkIndex: _ignored } = paramsSchema(
      req,
      z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0), chunkIndex: z.coerce.number().int().optional() }),
    );
    const provided = req.header('x-content-sha256')?.toLowerCase();
    const result = await transfers.completeItem(
      req.user?.sub ?? req.device!.uid,
      id,
      index,
      provided,
      req.device?.sub,
    );
    res.json(result);
  }),
);

for (const action of ['pause', 'resume', 'cancel', 'retry'] as const) {
  transfersRouter.post(
    `/:id/${action}`,
    requireUser,
    asyncHandler(async (req, res) => {
      const { id } = paramsSchema(req, idParams);
      res.json({ transfer: await transfers.setStatus(req.user!.sub, id, action) });
    }),
  );
}
