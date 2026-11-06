import { Router } from 'express';
import { z } from 'zod';
import { body, querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireUser } from '../middleware/auth.js';
import * as connections from './service.js';
import { recordActivity } from '../activity/service.js';

const connectionType = z.enum(['mirror', 'camera', 'file', 'control', 'clipboard']);

const createSchema = z.object({
  sourceDeviceId: z.string().uuid(),
  targetDeviceId: z.string().uuid().nullable().optional(),
  type: connectionType,
});

const terminateSchema = z.object({
  connectionId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

const acceptSchema = z.object({ connectionId: z.string().uuid() });

export const connectionsRouter = Router();

connectionsRouter.post(
  '/create',
  requireUser,
  asyncHandler(async (req, res) => {
    const payload = body(req, createSchema);
    const connection = await connections.createConnection(
      req.user!.sub,
      { sourceDeviceId: payload.sourceDeviceId, targetDeviceId: payload.targetDeviceId ?? null, type: payload.type },
      { actorType: 'user', ip: req.ip },
    );
    res.status(201).json({ connection });
  }),
);

connectionsRouter.get(
  '/status',
  requireUser,
  asyncHandler(async (req, res) => {
    const { deviceId } = querySchema(req, z.object({ deviceId: z.string().uuid().optional() }));
    const list = await connections.listConnections(req.user!.sub, deviceId);
    res.json({ connections: list, config: connections.publicConfig() });
  }),
);

connectionsRouter.post(
  '/accept',
  requireUser,
  asyncHandler(async (req, res) => {
    const { connectionId } = body(req, acceptSchema);
    res.json({ connection: await connections.acceptConnection(req.user!.sub, connectionId) });
  }),
);

connectionsRouter.post(
  '/terminate',
  requireUser,
  asyncHandler(async (req, res) => {
    const payload = body(req, terminateSchema);
    await connections.terminateConnection(req.user!.sub, payload.connectionId, payload.reason);
    res.status(204).send();
  }),
);

connectionsRouter.get(
  '/ice',
  requireUser,
  asyncHandler(async (req, res) => {
    const { connectionId } = querySchema(req, z.object({ connectionId: z.string().uuid() }));
    const result = await connections.iceServersFor(req.user!.sub, connectionId);
    await recordActivity({
      userId: req.user!.sub,
      actorType: 'user',
      action: 'signaling.ice_servers_issued',
      targetType: 'connection',
      targetId: connectionId,
      ip: req.ip,
    });
    res.json(result);
  }),
);
