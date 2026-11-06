import { Router } from 'express';
import { z } from 'zod';
import { body, querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireUser } from '../middleware/auth.js';
import * as devices from '../devices/service.js';
import { query } from '../database/pool.js';

const listQuery = z.object({ deviceId: z.string().uuid().optional() });
const revokeSchema = z.object({ sessionId: z.string().uuid() });

export const sessionsRouter = Router();

sessionsRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const { deviceId } = querySchema(req, listQuery);
    const [sessions, logins] = await Promise.all([
      devices.listSessions(req.user!.sub, deviceId),
      query(
        `SELECT id, created_at, revoked_at, replaced_by, ip, user_agent
           FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.user!.sub],
      ),
    ]);
    res.json({
      sessions,
      browserSessions: logins.rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        revokedAt: r.revoked_at,
        rotated: Boolean(r.replaced_by),
        ip: r.ip,
        userAgent: r.user_agent,
      })),
    });
  }),
);

sessionsRouter.post(
  '/revoke',
  requireUser,
  asyncHandler(async (req, res) => {
    const { sessionId } = body(req, revokeSchema);
    await devices.revokeSession(req.user!.sub, sessionId);
    res.status(204).send();
  }),
);

sessionsRouter.post(
  '/revoke-all',
  requireUser,
  asyncHandler(async (req, res) => {
    const devicesList = await devices.listDevices(req.user!.sub);
    let revoked = 0;
    for (const device of devicesList) {
      revoked += await devices.revokeDeviceSessions(req.user!.sub, device.id, 'all sessions revoked');
    }
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user!.sub]);
    res.json({ revoked, browserSessionsRevoked: true });
  }),
);
