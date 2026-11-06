import { Router } from 'express';
import { z } from 'zod';
import { body, querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireDevice, requireUser } from '../middleware/auth.js';
import { many, one } from '../database/pool.js';
import { AppError } from '../utils/errors.js';
import { looksSensitive } from '../security/crypto.js';
import { emit } from '../realtime/hub.js';
import { recordActivity } from '../activity/service.js';
import { cache } from '../store/cache.js';

const syncSchema = z.object({
  notifications: z
    .array(
      z.object({
        packageName: z.string().min(1).max(200),
        appName: z.string().min(1).max(200),
        title: z.string().max(500).optional(),
        content: z.string().max(4000).optional(),
        category: z.string().max(64).optional(),
        postedAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(100),
});

const listQuery = z.object({
  deviceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const notificationsRouter = Router();

/** Devices push notifications here only when the owner enabled notification sync for that device. */
notificationsRouter.post(
  '/sync',
  requireDevice,
  asyncHandler(async (req, res) => {
    const payload = body(req, syncSchema);
    const deviceId = req.device!.sub;
    const permission = await one<{ granted: boolean }>(
      `SELECT granted FROM device_permissions WHERE device_id = $1 AND permission = 'notifications'`,
      [deviceId],
    );
    if (!permission?.granted) {
      throw new AppError('FORBIDDEN', 'Notification sync is not enabled by the owner for this device');
    }

    let stored = 0;
    let filtered = 0;
    for (const item of payload.notifications) {
      const combined = `${item.title ?? ''} ${item.content ?? ''}`.trim();
      if (looksSensitive(combined)) {
        filtered += 1;
        continue;
      }
      const inserted = await one<{ id: string }>(
        `INSERT INTO notification_records
           (user_id, device_id, package_name, app_name, title, content, category, is_sensitive, posted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8) RETURNING id`,
        [
          req.device!.uid,
          deviceId,
          item.packageName,
          item.appName,
          item.title ?? null,
          item.content ?? null,
          item.category ?? null,
          item.postedAt,
        ],
      );
      if (inserted) stored += 1;
    }

    await emit({ ownerId: req.device!.uid }, {
      type: 'notification:sync',
      deviceId,
      stored,
      filtered,
      at: new Date().toISOString(),
    });
    res.json({ stored, filtered });
  }),
);

notificationsRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const { deviceId, limit } = querySchema(req, listQuery);
    const rows = await many(
      `SELECT n.id, n.device_id, n.package_name, n.app_name, n.title, n.content, n.category, n.posted_at, d.name AS device_name
         FROM notification_records n JOIN devices d ON d.id = n.device_id
        WHERE n.user_id = $1 ${deviceId ? 'AND n.device_id = $3' : ''}
        ORDER BY n.posted_at DESC LIMIT $2`,
      deviceId ? [req.user!.sub, limit, deviceId] : [req.user!.sub, limit],
    );
    res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name,
        packageName: r.package_name,
        appName: r.app_name,
        title: r.title,
        content: r.content,
        category: r.category,
        postedAt: r.posted_at,
      })),
    });
  }),
);

notificationsRouter.delete(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const result = await one<{ count: number }>(
      `WITH deleted AS (DELETE FROM notification_records WHERE user_id = $1 RETURNING id)
       SELECT count(*)::int AS count FROM deleted`,
      [req.user!.sub],
    );
    await recordActivity({
      userId: req.user!.sub,
      actorType: 'user',
      action: 'notifications.cleared',
      metadata: { deleted: result?.count ?? 0 },
    });
    res.json({ deleted: result?.count ?? 0 });
  }),
);

export const clipboardRouter = Router();

const clipboardSyncSchema = z.object({
  content: z.string().min(1).max(64 * 1024),
  contentType: z.string().max(64).optional(),
  force: z.boolean().optional(),
});

const clipboardQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

clipboardRouter.post(
  '/sync',
  requireUser,
  asyncHandler(async (req, res) => {
    const payload = body(req, clipboardSyncSchema);
    const sensitive = looksSensitive(payload.content);
    if (sensitive && !payload.force) {
      throw new AppError(
        'FORBIDDEN',
        'This clipboard content looks sensitive (password, OTP or card number) and was not synced. Confirm explicitly to override.',
        { requiresConfirmation: true },
      );
    }
    await cache().set(`clipboard:latest:${req.user!.sub}`, payload.content, 86_400);
    const row = await one<{ id: string; created_at: Date }>(
      `INSERT INTO clipboard_records (user_id, direction, content_type, content, is_sensitive)
       VALUES ($1, 'device_to_cloud', $2, $3, $4) RETURNING id, created_at`,
      [req.user!.sub, payload.contentType ?? 'text/plain', payload.content, sensitive],
    );
    await emit({ ownerId: req.user!.sub }, {
      type: 'clipboard:sync',
      clipboardId: row?.id,
      preview: payload.content.slice(0, 120),
      sensitive,
      at: new Date().toISOString(),
    });
    await recordActivity({
      userId: req.user!.sub,
      actorType: 'user',
      action: 'clipboard.synced',
      targetType: 'clipboard',
      targetId: row?.id ?? null,
      metadata: { sensitive, length: payload.content.length },
    });
    res.status(201).json({ clipboard: { id: row?.id, createdAt: row?.created_at, sensitive } });
  }),
);

clipboardRouter.get(
  '/',
  requireUser,
  asyncHandler(async (req, res) => {
    const { limit } = querySchema(req, clipboardQuery);
    const rows = await many(
      `SELECT id, direction, content_type, content, is_sensitive, created_at, expires_at
         FROM clipboard_records WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC LIMIT $2`,
      [req.user!.sub, limit],
    );
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        contentType: r.content_type,
        content: r.content,
        sensitive: r.is_sensitive,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
    });
  }),
);

clipboardRouter.get(
  '/latest',
  requireUser,
  asyncHandler(async (req, res) => {
    const value = await cache().get(`clipboard:latest:${req.user!.sub}`);
    res.json({ content: value ?? null, at: new Date().toISOString() });
  }),
);

clipboardRouter.post(
  '/push',
  requireDevice,
  asyncHandler(async (req, res) => {
    const payload = body(req, clipboardSyncSchema);
    if (looksSensitive(payload.content) && !payload.force) {
      throw new AppError('FORBIDDEN', 'Refusing to push sensitive clipboard content without explicit confirmation', {
        requiresConfirmation: true,
      });
    }
    await emit({ deviceId: req.device!.sub }, {
      type: 'clipboard:sync',
      content: payload.content,
      contentType: payload.contentType ?? 'text/plain',
      at: new Date().toISOString(),
    });
    await recordActivity({
      userId: req.device!.uid,
      deviceId: req.device!.sub,
      actorType: 'device',
      action: 'clipboard.pushed_to_device',
    });
    res.status(202).json({ delivered: true });
  }),
);
