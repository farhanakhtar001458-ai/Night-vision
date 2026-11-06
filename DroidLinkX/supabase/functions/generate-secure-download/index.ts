import { env } from '../_shared/env.ts';
import { audit } from '../_shared/realtime.ts';
import { clientIp, HttpError, json, readJson, requireUuid, serve } from '../_shared/http.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';

type Body = { fileId?: string; transferItemId?: string };

const BUCKETS = new Set(['droidlinkx-files', 'droidlinkx-transfers']);

/**
 * Issues a short-lived signed URL for a private object. The caller must own the row, and the
 * object must live under the caller's folder. Service-role keys never leave the function.
 */
Deno.serve(serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') throw new HttpError(405, 'METHOD', 'POST required');

  const { user } = await requireUser(req);
  const body = await readJson<Body>(req);
  const supabase = serviceClient();

  let storagePath: string;
  let bucket = 'droidlinkx-files';
  let fileName = 'download';
  let mimeType = 'application/octet-stream';
  let fileId: string | null = null;

  if (body.fileId) {
    fileId = requireUuid(body.fileId, 'fileId');
    const { data: file, error } = await supabase
      .from('files')
      .select('id, owner_id, name, mime_type, storage_path, deleted_at')
      .eq('id', fileId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (error) throw new HttpError(500, 'DATABASE', 'File lookup failed');
    if (!file || file.deleted_at) throw new HttpError(404, 'NOT_FOUND', 'File not found');
    storagePath = file.storage_path;
    fileName = file.name;
    mimeType = file.mime_type;
    const [prefix] = storagePath.split('/');
    if (prefix !== user.id) throw new HttpError(403, 'FORBIDDEN', 'Stored object is outside your folder');
  } else if (body.transferItemId) {
    const itemId = requireUuid(body.transferItemId, 'transferItemId');
    const { data: item, error } = await supabase
      .from('transfer_items')
      .select('id, name, mime_type, storage_path, transfer_id, file_transfers!inner(owner_id)')
      .eq('id', itemId)
      .eq('file_transfers.owner_id', user.id)
      .maybeSingle();
    if (error) throw new HttpError(500, 'DATABASE', 'Transfer item lookup failed');
    if (!item || !item.storage_path) throw new HttpError(404, 'NOT_FOUND', 'Transfer item not found');
    storagePath = item.storage_path;
    bucket = 'droidlinkx-transfers';
    fileName = item.name;
    mimeType = item.mime_type;
    if (storagePath.split('/')[0] !== user.id) throw new HttpError(403, 'FORBIDDEN', 'Stored object is outside your folder');
  } else {
    throw new HttpError(422, 'VALIDATION', 'fileId or transferItemId is required');
  }

  if (!BUCKETS.has(bucket)) throw new HttpError(400, 'VALIDATION', 'Unsupported bucket');

  const ttl = env.downloadUrlTtlSeconds;
  const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, ttl, {
    download: fileName,
  });
  if (signError || !signed?.signedUrl) {
    console.error('[generate-secure-download] signing failed', signError);
    throw new HttpError(500, 'STORAGE', 'A signed URL could not be generated');
  }

  await audit({
    ownerId: user.id,
    action: 'download_link_issued',
    actorType: 'user',
    actorId: user.id,
    detail: { fileId, bucket, storagePath },
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });

  return json({
    url: signed.signedUrl,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    ttl,
    name: fileName,
    mimeType,
    bucket,
  }, 200, origin);
}));
