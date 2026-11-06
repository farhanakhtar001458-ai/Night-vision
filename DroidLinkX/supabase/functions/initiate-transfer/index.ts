import { env } from '../_shared/env.ts';
import { audit, broadcast } from '../_shared/realtime.ts';
import { clientIp, HttpError, json, optionalString, optionalUuid, readJson, requireString, serve } from '../_shared/http.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';

type Item = { name?: string; size?: number; mimeType?: string; relativePath?: string; sha256?: string };
type Body = {
  direction?: string;
  mode?: string;
  sourceDeviceId?: string | null;
  targetDeviceId?: string | null;
  items?: Item[];
};

const DIRECTIONS = new Set(['device_to_device', 'device_to_cloud', 'cloud_to_device', 'dashboard_to_device', 'device_to_dashboard']);
const BUCKET = 'droidlinkx-transfers';
const MAX_ITEMS = 100;

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);
  const direction = requireString(body.direction, 'direction', 40);
  if (!DIRECTIONS.has(direction)) throw new HttpError(422, 'VALIDATION', 'Unsupported transfer direction');
  const mode = body.mode === 'direct' ? 'direct' : 'relay';
  const sourceDeviceId = optionalUuid(body.sourceDeviceId, 'sourceDeviceId');
  const targetDeviceId = optionalUuid(body.targetDeviceId, 'targetDeviceId');
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new HttpError(422, 'VALIDATION', 'At least one item is required');
  if (items.length > MAX_ITEMS) throw new HttpError(422, 'VALIDATION', `At most ${MAX_ITEMS} items per transfer`);

  const supabase = serviceClient();
  const deviceIds = [sourceDeviceId, targetDeviceId].filter((id): id is string => Boolean(id));
  if (deviceIds.length > 0) {
    const { data: devices, error } = await supabase.from('devices').select('id, owner_id, status').in('id', deviceIds);
    if (error) throw new HttpError(500, 'DATABASE', 'Device lookup failed');
    if (!devices || devices.length !== new Set(deviceIds).size) throw new HttpError(404, 'NOT_FOUND', 'Device not found in this account');
    if (devices.some((device) => device.owner_id !== user.id)) throw new HttpError(403, 'FORBIDDEN', 'Device belongs to another account');
    if (devices.some((device) => device.status !== 'active')) throw new HttpError(409, 'DEVICE_REVOKED', 'A revoked device cannot transfer files');
  }

  let total = 0;
  const normalized = items.map((item, index) => {
    const name = requireString(item.name, `items[${index}].name`, 200);
    const size = typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? Math.floor(item.size) : NaN;
    if (!Number.isFinite(size)) throw new HttpError(422, 'VALIDATION', `items[${index}].size must be a non-negative number`);
    total += size;
    return {
      name,
      size,
      mimeType: optionalString(item.mimeType, 120) ?? 'application/octet-stream',
      relativePath: optionalString(item.relativePath, 400) ?? '/',
      sha256: optionalString(item.sha256, 64),
    };
  });
  if (total > env.maxTransferBytes) {
    throw new HttpError(413, 'TOO_LARGE', `Transfers are limited to ${env.maxTransferBytes} bytes`);
  }

  const { data: transfer, error: transferError } = await supabase
    .from('file_transfers')
    .insert({
      owner_id: user.id,
      source_device_id: sourceDeviceId,
      target_device_id: targetDeviceId,
      direction,
      mode,
      status: 'active',
      total_bytes: total,
      item_count: normalized.length,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (transferError || !transfer) {
    console.error('[initiate-transfer] insert failed', transferError);
    throw new HttpError(500, 'DATABASE', 'Transfer could not be created');
  }

  const rows = normalized.map((item, index) => ({
    transfer_id: transfer.id,
    item_index: index,
    name: item.name,
    relative_path: item.relativePath,
    mime_type: item.mimeType,
    size: item.size,
    sha256: item.sha256,
    storage_path: `${user.id}/${transfer.id}/${String(index).padStart(3, '0')}-${sanitize(item.name)}`,
    status: 'pending',
  }));

  const { data: insertedItems, error: itemError } = await supabase.from('transfer_items').insert(rows).select('*');
  if (itemError || !insertedItems) {
    await supabase.from('file_transfers').update({ status: 'failed', error: 'item creation failed' }).eq('id', transfer.id);
    console.error('[initiate-transfer] items failed', itemError);
    throw new HttpError(500, 'DATABASE', 'Transfer items could not be created');
  }

  // Signed upload URLs let the client write directly to Storage without ever seeing a service key.
  const uploadTargets = [];
  for (const item of insertedItems) {
    const { data: signed, error: signedError } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUploadUrl(item.storage_path, { upsert: true });
    if (signedError || !signed) {
      console.warn('[initiate-transfer] signed upload failed', signedError?.message);
      continue;
    }
    uploadTargets.push({
      index: item.item_index,
      storagePath: item.storage_path,
      path: signed.path,
      token: signed.token,
      signedUrl: signed.signedUrl,
    });
  }

  await supabase.from('transfer_history').insert({
    transfer_id: transfer.id,
    owner_id: user.id,
    event: 'transfer_created',
    bytes: total,
    detail: { itemCount: normalized.length, mode, direction },
  });

  await audit({
    ownerId: user.id,
    action: 'transfer_created',
    deviceId: targetDeviceId ?? sourceDeviceId,
    actorType: 'user',
    actorId: user.id,
    detail: { transferId: transfer.id, itemCount: normalized.length, totalBytes: total },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  await broadcast(`owner:${user.id}`, 'transfer:created', { transferId: transfer.id, itemCount: normalized.length, totalBytes: total });

  return json({
    transfer,
    items: insertedItems,
    uploadTargets,
    bucket: BUCKET,
    chunkSize: 8 * 1024 * 1024,
  }, 201, origin);
}));
