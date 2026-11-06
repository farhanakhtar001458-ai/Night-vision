import { env } from './env.ts';
import { serviceClient } from './supabase.ts';

/**
 * Server-side broadcast through Supabase Realtime's HTTP endpoint.
 * Channels are private (`owner:<uuid>`, `device:<uuid>`) and authorized by RLS on realtime.messages.
 */
export async function broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(`${env.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.serviceRoleKey,
        authorization: `Bearer ${env.serviceRoleKey}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
    });
    if (!response.ok) {
      console.warn('[droidlinkx] realtime broadcast failed', response.status, await response.text());
    }
  } catch (error) {
    // Realtime delivery is best-effort: durable state already lives in PostgreSQL.
    console.warn('[droidlinkx] realtime broadcast error', error);
  }
}

export async function audit(entry: {
  ownerId: string;
  action: string;
  deviceId?: string | null;
  actorType?: 'user' | 'device' | 'system';
  actorId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const supabase = serviceClient();
  const { error } = await supabase.from('activity_logs').insert({
    owner_id: entry.ownerId,
    device_id: entry.deviceId ?? null,
    actor_type: entry.actorType ?? 'user',
    actor_id: entry.actorId ?? null,
    action: entry.action,
    detail: entry.detail ?? {},
    ip: entry.ip ?? null,
    user_agent: entry.userAgent ?? null,
  });
  if (error) console.warn('[droidlinkx] audit insert failed', error.message);
}
