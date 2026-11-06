import { query } from '../database/pool.js';
import { logger } from '../utils/logger.js';

export type ActivityInput = {
  userId?: string | null;
  deviceId?: string | null;
  actorType: 'user' | 'device' | 'system';
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
};

/** Append-only audit trail. Never throws into request handlers. */
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await query(
      `INSERT INTO activity_logs (user_id, device_id, actor_type, action, target_type, target_id, ip, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.userId ?? null,
        input.deviceId ?? null,
        input.actorType,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.ip ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (err) {
    logger.error({ err, action: input.action }, 'failed to record activity log');
  }
}

export async function recordConnectionEvent(input: {
  userId: string;
  deviceId: string;
  event: string;
  connectionId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO connection_events (user_id, device_id, connection_id, event, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.deviceId, input.connectionId ?? null, input.event, JSON.stringify(input.detail ?? {})],
    );
  } catch (err) {
    logger.error({ err, event: input.event }, 'failed to record connection event');
  }
}
