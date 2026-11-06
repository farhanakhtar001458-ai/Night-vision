import { Router } from 'express';
import { z } from 'zod';
import { querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireUser } from '../middleware/auth.js';
import { many } from '../database/pool.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  deviceId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
});

export const activityRouter = Router();

activityRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const { limit, deviceId, action } = querySchema(req, listQuery);
    const params: unknown[] = [req.user!.sub];
    const clauses = ['a.user_id = $1'];
    if (deviceId) {
      params.push(deviceId);
      clauses.push(`a.device_id = $${params.length}`);
    }
    if (action) {
      params.push(`${action}%`);
      clauses.push(`a.action LIKE $${params.length}`);
    }
    params.push(limit);
    const rows = await many(
      `SELECT a.id, a.action, a.actor_type, a.target_type, a.target_id, a.metadata, a.created_at,
              a.device_id, d.name AS device_name, a.ip
         FROM activity_logs a LEFT JOIN devices d ON d.id = a.device_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params,
    );
    res.json({
      activity: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorType: r.actor_type,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: r.metadata,
        deviceId: r.device_id,
        deviceName: r.device_name,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    });
  }),
);
