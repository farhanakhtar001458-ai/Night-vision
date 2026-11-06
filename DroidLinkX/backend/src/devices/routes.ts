import { Router } from 'express';
import { z } from 'zod';
import { body, paramsSchema, querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireDevice, requireUser } from '../middleware/auth.js';
import * as devices from './service.js';
import { AppError } from '../utils/errors.js';

const idSchema = z.object({ id: z.string().uuid() });

const enrollSchema = z.object({
  name: z.string().min(1).max(100),
  manufacturer: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  androidVersion: z.string().max(40).optional(),
  sdkInt: z.number().int().min(21).max(60).optional(),
  appVersion: z.string().max(40).optional(),
  platform: z.enum(['android']).optional(),
});

const tokenSchema = z.object({
  deviceId: z.string().uuid(),
  deviceSecret: z.string().min(20).max(200),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    trusted: z.boolean().optional(),
  })
  .strict();

const statusSchema = z.object({
  telemetry: z.record(z.unknown()).optional(),
  name: z.string().min(1).max(100).optional(),
});

const permissionSchema = z.object({
  granted: z.boolean(),
});

export const devicesRouter = Router();

/** Owner-authorized enrollment. The device secret is only ever returned in this response. */
devicesRouter.post(
  '/enroll',
  requireUser,
  rateLimit({ name: 'devices:enroll', limit: 30, windowSeconds: 3600 }),
  asyncHandler(async (req, res) => {
    const payload = body(req, enrollSchema);
    const result = await devices.enrollDevice(req.user!.sub, payload, { ip: req.ip });
    res.status(201).json(result);
  }),
);

/** Device credential exchange -> device-scoped bearer token bound to a revocable session. */
devicesRouter.post(
  '/token',
  rateLimit({ name: 'devices:token', limit: 60, windowSeconds: 900 }),
  asyncHandler(async (req, res) => {
    const payload = body(req, tokenSchema);
    const result = await devices.issueDeviceSession(payload, {
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    res.json(result);
  }),
);

devicesRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    res.json({ devices: await devices.listDevices(req.user!.sub) });
  }),
);

devicesRouter.get(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    res.json({ device: await devices.getDevice(req.user!.sub, id) });
  }),
);

devicesRouter.patch(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    const payload = body(req, updateSchema);
    if (payload.name === undefined && payload.trusted === undefined) {
      throw new AppError('BAD_REQUEST', 'Nothing to update');
    }
    res.json({ device: await devices.updateDevice(req.user!.sub, id, payload) });
  }),
);

devicesRouter.delete(
  '/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    await devices.revokeDevice(req.user!.sub, id, 'owner revoked');
    res.status(204).send();
  }),
);

devicesRouter.get(
  '/:id/history',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    const { limit } = querySchema(req, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    res.json({ events: await devices.connectionHistory(req.user!.sub, id, limit) });
  }),
);

devicesRouter.get(
  '/:id/permissions',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    res.json({ permissions: await devices.getPermissions(req.user!.sub, id) });
  }),
);

devicesRouter.put(
  '/:id/permissions/:permission',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id, permission } = paramsSchema(
      req,
      idSchema.extend({ permission: z.enum(devices.DEVICE_PERMISSIONS) }),
    );
    const payload = body(req, permissionSchema);
    res.json({ permissions: await devices.setPermission(req.user!.sub, id, permission, payload.granted) });
  }),
);

/** Device self-report: telemetry (battery, storage, RAM, network...) from authenticated device. */
devicesRouter.post(
  '/:id/status',
  requireDevice,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    if (req.device!.sub !== id) throw new AppError('FORBIDDEN', 'Devices may only report their own status');
    const payload = body(req, statusSchema);
    const device = await devices.updateDeviceStatus(id, payload);
    res.json({ device });
  }),
);

/** Owner rotates the credential; the device must re-enroll with the new secret. */
devicesRouter.post(
  '/:id/rotate-secret',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    res.json(await devices.rotateDeviceSecret(req.user!.sub, id));
  }),
);

devicesRouter.post(
  '/:id/revoke-sessions',
  requireUser,
  asyncHandler(async (req, res) => {
    const { id } = paramsSchema(req, idSchema);
    const count = await devices.revokeDeviceSessions(req.user!.sub, id);
    res.json({ revoked: count });
  }),
);
