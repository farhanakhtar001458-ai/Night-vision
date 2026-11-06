import { env } from '../_shared/env.ts';
import { audit, broadcast } from '../_shared/realtime.ts';
import { clientIp, HttpError, json, optionalString, readJson, requireUuid, serve } from '../_shared/http.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';

type Body = { transferId?: string; itemIndex?: number; sha256?: string };

const BUCKET = 'droidlinkx-transfers';
/**
 * Chunk assembly ceiling. Buffering keeps the function portable across the Edge runtime; larger files
 * are uploaded in a single request by the client and only hashed here.
 */
const MAX_BUFFERED_BYTES = 256 * 1024 * 1024;

function serviceHeaders(): Record<string, string> {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
  };
}

async function downloadObject(path: string): Promise<Uint8Array | null> {
  const response = await fetch(
    `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
    { headers: serviceHeaders() },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(502, 'STORAGE', `Storage download failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

async function uploadObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const response = await fetch(
    `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'POST',
      headers: {
        ...serviceHeaders(),
        'content-type': contentType,
        'x-upsert': 'true',
        'cache-control': 'max-age=3600',
      },
      body: bytes.slice().buffer as ArrayBuffer,
    },
  );
  if (!response.ok) throw new HttpError(502, 'STORAGE', `Storage upload failed (${response.status})`);
}

async function deleteObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await fetch(`${env.supabaseUrl}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...serviceHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
}

Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);
  const transferId = requireUuid(body.transferId, 'transferId');
  const itemIndex = typeof body.itemIndex === 'number' ? Math.trunc(body.itemIndex) : Number.NaN;
  if (!Number.isInteger(itemIndex) || itemIndex < 0) throw new HttpError(422, 'VALIDATION', 'itemIndex must be a non-negative integer');

  const supabase = serviceClient();
  const { data: transfer, error: transferError } = await supabase
    .from('file_transfers')
    .select('id, owner_id, status')
    .eq('id', transferId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (transferError) throw new HttpError(500, 'DATABASE', 'Transfer lookup failed');
  if (!transfer) throw new HttpError(404, 'NOT_FOUND', 'Transfer not found');
  if (transfer.status === 'cancelled') throw new HttpError(409, 'CANCELLED', 'This transfer was cancelled');

  const { data: item, error: itemError } = await supabase
    .from('transfer_items')
    .select('*')
    .eq('transfer_id', transferId)
    .eq('item_index', itemIndex)
    .maybeSingle();
  if (itemError) throw new HttpError(500, 'DATABASE', 'Transfer item lookup failed');
  if (!item) throw new HttpError(404, 'NOT_FOUND', 'Transfer item not found');
  if (!item.storage_path) throw new HttpError(409, 'NOT_READY', 'This item has no storage target yet');

  const declaredSha = (optionalString(body.sha256, 64) ?? item.sha256 ?? '').toLowerCase() || null;
  const partsPrefix = `${transferId}/parts/${itemIndex}`;
  const folder = `${user.id}/${partsPrefix}`;

  // Enumerate uploaded parts (1..N) until the first missing index.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let part = 0; part < 100_000; part += 1) {
    const bytes = await downloadObject(`${folder}/${part}.part`);
    if (!bytes) break;
    total += bytes.byteLength;
    if (total > MAX_BUFFERED_BYTES) {
      throw new HttpError(413, 'TOO_LARGE', 'This upload exceeds the server-side assembly limit; upload the file in one request instead');
    }
    chunks.push(bytes);
  }

  let payload: Uint8Array;
  if (chunks.length > 0) {
    payload = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const single = await downloadObject(item.storage_path);
    if (!single) throw new HttpError(409, 'NOT_READY', 'No uploaded chunks or object were found for this item');
    payload = single;
  }

  if (item.size > 0 && payload.byteLength !== item.size) {
    await supabase.from('transfer_items').update({
      status: 'failed',
      error: `size mismatch: expected ${item.size} bytes, received ${payload.byteLength}`,
    }).eq('id', item.id);
    throw new HttpError(409, 'SIZE_MISMATCH', `Expected ${item.size} bytes but assembled ${payload.byteLength}`);
  }

  // Web Crypto keeps the function portable between the Supabase Edge Runtime and a plain tsc check.
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', payload.slice().buffer as ArrayBuffer));
  const digest = Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const checksumVerified = declaredSha ? digest === declaredSha : false;
  if (declaredSha && !checksumVerified) {
    await supabase.from('transfer_items').update({ status: 'failed', error: 'checksum mismatch' }).eq('id', item.id);
    await supabase.from('transfer_history').insert({
      transfer_id: transferId,
      owner_id: user.id,
      item_index: itemIndex,
      event: 'checksum_mismatch',
      bytes: payload.byteLength,
      detail: { declared: declaredSha, computed: digest },
    });
    throw new HttpError(409, 'CHECKSUM_MISMATCH', 'The SHA-256 checksum did not match the uploaded content');
  }

  if (chunks.length > 0) {
    await uploadObject(item.storage_path, payload, item.mime_type ?? 'application/octet-stream');
    const partPaths = chunks.map((_, index) => `${folder}/${index}.part`);
    await deleteObjects(partPaths);
  }

  const { error: updateError } = await supabase
    .from('transfer_items')
    .update({
      status: 'completed',
      bytes_received: payload.byteLength,
      received_chunks: chunks.length,
      sha256: digest,
      checksum_verified: checksumVerified,
      error: null,
    })
    .eq('id', item.id);
  if (updateError) throw new HttpError(500, 'DATABASE', 'Item could not be completed');

  const { data: updatedTransfer } = await supabase
    .from('file_transfers')
    .select('*, transfer_items(*)')
    .eq('id', transferId)
    .maybeSingle();

  await audit({
    ownerId: user.id,
    action: 'transfer_item_completed',
    actorType: 'user',
    actorId: user.id,
    detail: { transferId, itemIndex, bytes: payload.byteLength, checksumVerified },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  await broadcast(`owner:${user.id}`, 'transfer:completed', {
    transferId,
    itemIndex,
    bytes: payload.byteLength,
    checksumVerified,
  });

  return json({
    transfer: updatedTransfer,
    itemId: item.id,
    bytes: payload.byteLength,
    sha256: digest,
    checksumVerified,
  }, 200, origin);
}));
