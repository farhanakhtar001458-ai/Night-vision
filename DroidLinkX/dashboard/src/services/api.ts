import type { Session } from '@supabase/supabase-js';
import {
  SIGNALING_URL,
  STUN_URLS,
  SUPABASE_PROJECT_URL,
  SUPABASE_PUBLIC_KEY,
  TURN_URLS,
  supabase,
} from '@/lib/supabase';
import type {
  ActivityEntry,
  BrowserSession,
  ClipboardEntry,
  Connection,
  Device,
  DeviceSession,
  NotificationRecord,
  PublicUser,
  RelayFile,
  ServerConfig,
  StorageSummary,
  Tokens,
  Transfer,
  TransferItem,
} from '@/lib/types';

const STORAGE_KEY = 'droidlinkx.session.v1';
const CHUNK_SIZE = 8 * 1024 * 1024;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export type StoredSession = { tokens: Tokens; user: PublicUser };

type Listener = (session: StoredSession | null) => void;

class SessionStore {
  private session: StoredSession | null = null;
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.session = this.read();
  }

  private read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed?.tokens?.accessToken) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  get current(): StoredSession | null {
    return this.session;
  }

  set(session: StoredSession | null): void {
    this.session = session;
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage can be unavailable in private mode */
    }
    this.listeners.forEach((listener) => listener(session));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const sessionStore = new SessionStore();

/* ----------------------------- helpers ------------------------------ */

function tokensFrom(session: Session): Tokens {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: session.access_token,
    expiresIn: Math.max(0, (session.expires_at ?? now) - now),
    refreshToken: session.refresh_token,
    refreshExpiresIn: 0,
    tokenType: 'Bearer',
  };
}

function userFrom(session: Session): PublicUser {
  const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    displayName: (metadata.display_name as string) ?? session.user.email?.split('@')[0] ?? 'Owner',
    status: 'active',
    createdAt: session.user.created_at ?? new Date().toISOString(),
    lastLoginAt: session.user.last_sign_in_at ?? null,
  };
}

function adopt(session: Session | null): StoredSession | null {
  if (!session) {
    sessionStore.set(null);
    return null;
  }
  const stored: StoredSession = { tokens: tokensFrom(session), user: userFrom(session) };
  sessionStore.set(stored);
  return stored;
}

// Keep the local mirror in sync with GoTrue (token refresh, sign-out in another tab).
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    const stored: StoredSession = { tokens: tokensFrom(session), user: userFrom(session) };
    sessionStore.set(stored);
  } else {
    sessionStore.set(null);
  }
});

function fail(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const message = error instanceof Error ? error.message : 'Request failed';
  const status = (error as { status?: number }).status ?? 500;
  throw new ApiError(status, 'REQUEST_FAILED', message);
}

function requireSession(): StoredSession {
  const session = sessionStore.current;
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue');
  return session;
}

function ownerId(): string {
  return requireSession().user.id;
}

/** Invokes an Edge Function and normalises its error envelope into ApiError. */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let status = 500;
    let code = 'FUNCTION_ERROR';
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      status = context.status;
      try {
        const parsed = (await context.json()) as { error?: { code?: string; message?: string } };
        if (parsed?.error) {
          code = parsed.error.code ?? code;
          message = parsed.error.message ?? message;
        }
      } catch {
        /* non-JSON error body */
      }
    }
    throw new ApiError(status, code, message || 'The server rejected the request');
  }
  return data as T;
}

/** Authenticated direct-to-Storage upload (used for chunk parts and browser uploads with progress). */
function putObject(
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const token = sessionStore.current?.tokens.accessToken;
  if (!token) return Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'Sign in to upload files'));
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = `${SUPABASE_PROJECT_URL}/storage/v1/object/${bucket}/${encoded}`;

  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.setRequestHeader('authorization', `Bearer ${token}`);
    request.setRequestHeader('apikey', SUPABASE_PUBLIC_KEY);
    request.setRequestHeader('x-upsert', 'true');
    request.setRequestHeader('cache-control', 'max-age=3600');
    request.setRequestHeader('content-type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new ApiError(request.status, 'STORAGE', request.responseText || 'Storage upload was rejected'));
    };
    request.onerror = () => reject(new ApiError(0, 'NETWORK', 'The storage upload failed'));
    request.send(body);
  });
}

const sanitizeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';

const categoryOf = (mime: string): string => {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['application/zip', 'application/x-tar', 'application/gzip'].includes(mime)) return 'archive';
  return 'document';
};

type Row = Record<string, unknown>;

/* ------------------------------- auth ------------------------------- */

export const authApi = {
  async register(input: { email: string; password: string; displayName: string }): Promise<StoredSession> {
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      options: { data: { display_name: input.displayName.trim() } },
    });
    if (error) throw new ApiError(error.status ?? 400, error.code ?? 'SIGNUP_FAILED', error.message);
    if (!data.session) {
      throw new ApiError(
        409,
        'CONFIRMATION_REQUIRED',
        'Check your inbox to confirm the address before signing in.',
      );
    }
    const stored = adopt(data.session);
    if (!stored) throw new ApiError(500, 'SESSION', 'The account was created but no session was returned');
    return stored;
  },

  async login(input: { email: string; password: string }): Promise<StoredSession> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email.trim().toLowerCase(),
      password: input.password,
    });
    if (error) {
      throw new ApiError(error.status ?? 401, error.code ?? 'INVALID_CREDENTIALS', error.message);
    }
    const stored = adopt(data.session);
    if (!stored) throw new ApiError(500, 'SESSION', 'No session was returned');
    return stored;
  },

  async me(): Promise<{ user: PublicUser; counts: { devices: number; online: number } }> {
    const session = requireSession();
    const [{ data: profile }, { count: devices }, { count: online }] = await Promise.all([
      supabase.from('profiles').select('display_name, email').eq('id', session.user.id).maybeSingle(),
      supabase.from('devices').select('id', { count: 'exact', head: true }).eq('owner_id', session.user.id).eq('status', 'active'),
      supabase.from('devices').select('id', { count: 'exact', head: true }).eq('owner_id', session.user.id).eq('online', true).eq('status', 'active'),
    ]);
    return {
      user: { ...session.user, displayName: (profile?.display_name as string) ?? session.user.displayName },
      counts: { devices: devices ?? 0, online: online ?? 0 },
    };
  },

  async logout(): Promise<void> {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch {
      /* signing out locally must always succeed */
    } finally {
      sessionStore.set(null);
    }
  },

  async updateProfile(input: { displayName?: string; settings?: Record<string, unknown> }): Promise<PublicUser> {
    const session = requireSession();
    const patch: Row = {};
    if (input.displayName) patch.display_name = input.displayName;
    if (input.settings) patch.settings = input.settings;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('profiles').update(patch).eq('id', session.user.id);
      if (error) fail(error);
    }
    if (input.displayName) {
      await supabase.auth.updateUser({ data: { display_name: input.displayName } });
    }
    const { data } = await supabase.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle();
    const user: PublicUser = { ...session.user, displayName: (data?.display_name as string) ?? session.user.displayName };
    sessionStore.set({ ...session, user });
    return user;
  },

  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    const session = requireSession();
    // Re-authenticate first: Supabase does not ask for the current password on updateUser.
    const { error: reauth } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: input.currentPassword,
    });
    if (reauth) throw new ApiError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect');
    const { error } = await supabase.auth.updateUser({ password: input.newPassword });
    if (error) throw new ApiError(error.status ?? 400, error.code ?? 'PASSWORD', error.message);
    const { data } = await supabase.auth.getSession();
    if (data.session) adopt(data.session);
  },

  async restore(): Promise<StoredSession | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      sessionStore.set(null);
      return null;
    }
    const stored = adopt(data.session);
    try {
      const me = await this.me();
      if (!stored) return null;
      const next: StoredSession = { ...stored, user: me.user };
      sessionStore.set(next);
      return next;
    } catch {
      return stored;
    }
  },
};

/* ----------------------------- mapping ------------------------------ */

function mapDevice(row: Row): Device {
  const permissionsRow = (row.device_permissions as Row[] | undefined) ?? [];
  const permissions: Record<string, boolean> = {};
  for (const permission of permissionsRow) {
    permissions[permission.permission as string] = Boolean(permission.granted);
  }
  return {
    id: row.id as string,
    name: (row.name as string) ?? 'Android device',
    manufacturer: (row.manufacturer as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    androidVersion: (row.android_version as string | null) ?? null,
    sdkInt: (row.sdk_int as number | null) ?? null,
    appVersion: (row.app_version as string | null) ?? null,
    platform: (row.platform as string) ?? 'android',
    status: (row.status as string) ?? 'active',
    trusted: Boolean(row.trusted),
    online: Boolean(row.online),
    connectionQuality: (row.connection_quality as string) ?? 'offline',
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    telemetry: ((row.telemetry as Device['telemetry']) ?? {}),
    permissions,
  };
}

const DEVICE_SELECT = '*, device_permissions(permission, granted)';

function mapTransferItem(row: Row): TransferItem {
  return {
    id: row.id as string,
    index: Number(row.item_index ?? 0),
    name: (row.name as string) ?? 'file',
    path: (row.relative_path as string) ?? '/',
    size: Number(row.size ?? 0),
    sha256: (row.sha256 as string | null) ?? null,
    status: (row.status as string) ?? 'pending',
    bytesReceived: Number(row.bytes_received ?? 0),
    receivedChunks: Number(row.received_chunks ?? 0),
    checksumVerified: Boolean(row.checksum_verified),
    fileId: null,
    error: (row.error as string | null) ?? null,
  };
}

function mapTransfer(row: Row): Transfer {
  const itemRows = ((row.transfer_items as Row[] | undefined) ?? []).slice().sort((a, b) => Number(a.item_index) - Number(b.item_index));
  const items = itemRows.map(mapTransferItem);
  const total = Number(row.total_bytes ?? 0);
  const transferred = Number(row.transferred_bytes ?? 0);
  const receivedChunkIndexes: Array<{ item_index: number; chunk_index: number }> = [];
  for (const item of items) {
    for (let chunk = 0; chunk < item.receivedChunks; chunk += 1) {
      receivedChunkIndexes.push({ item_index: item.index, chunk_index: chunk });
    }
  }
  return {
    id: row.id as string,
    direction: (row.direction as string) ?? 'dashboard_to_device',
    mode: (row.mode as string) ?? 'relay',
    status: (row.status as string) ?? 'pending',
    sourceDeviceId: (row.source_device_id as string | null) ?? null,
    targetDeviceId: (row.target_device_id as string | null) ?? null,
    totalBytes: total,
    transferredBytes: transferred,
    percent: total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0,
    itemCount: Number(row.item_count ?? items.length),
    completedItems: Number(row.completed_items ?? 0),
    error: (row.error as string | null) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    chunkSize: CHUNK_SIZE,
    items,
    receivedChunkIndexes,
  };
}

function mapFile(row: Row): RelayFile {
  return {
    id: row.id as string,
    name: (row.name as string) ?? 'file',
    path: (row.path as string) ?? '/',
    size: Number(row.size ?? 0),
    mime: (row.mime_type as string) ?? 'application/octet-stream',
    category: (row.category as string) ?? 'document',
    sha256: (row.sha256 as string | null) ?? null,
    deviceId: (row.device_id as string | null) ?? null,
    direction: 'device_to_cloud',
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    expiresAt: null,
    downloadUrl: '',
  };
}

/* ------------------------------ devices ----------------------------- */

export const devicesApi = {
  async list(): Promise<Device[]> {
    const { data, error } = await supabase
      .from('devices')
      .select(DEVICE_SELECT)
      .order('created_at', { ascending: true });
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(mapDevice);
  },

  async get(id: string): Promise<Device> {
    const { data, error } = await supabase.from('devices').select(DEVICE_SELECT).eq('id', id).maybeSingle();
    if (error) fail(error);
    if (!data) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    return mapDevice(data as Row);
  },

  async rename(id: string, name: string): Promise<Device> {
    const { error } = await supabase.from('devices').update({ name }).eq('id', id);
    if (error) fail(error);
    return this.get(id);
  },

  async setTrusted(id: string, trusted: boolean): Promise<Device> {
    const { error } = await supabase.from('devices').update({ trusted }).eq('id', id);
    if (error) fail(error);
    return this.get(id);
  },

  async revoke(id: string): Promise<void> {
    await invoke('revoke-device', { deviceId: id, delete: true });
  },

  async revokeSessions(id: string): Promise<number> {
    const result = await invoke<{ sessionsRevoked: number }>('revoke-device', { deviceId: id, sessionsOnly: true });
    return result.sessionsRevoked ?? 0;
  },

  async history(id: string): Promise<Array<{ id: string; connectionId: string | null; event: string; detail: Record<string, unknown>; createdAt: string }>> {
    const { data, error } = await supabase
      .from('connection_events')
      .select('id, connection_id, event, detail, created_at')
      .eq('device_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      connectionId: (row.connection_id as string | null) ?? null,
      event: row.event as string,
      detail: (row.detail as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
    }));
  },

  async setPermission(id: string, permission: string, granted: boolean): Promise<Record<string, boolean>> {
    const { error } = await supabase
      .from('device_permissions')
      .upsert({ device_id: id, permission, granted, updated_at: new Date().toISOString() }, { onConflict: 'device_id,permission' });
    if (error) fail(error);
    const { data } = await supabase.from('device_permissions').select('permission, granted').eq('device_id', id);
    const result: Record<string, boolean> = {};
    for (const row of (data ?? []) as Row[]) result[row.permission as string] = Boolean(row.granted);
    return result;
  },

  async enroll(input: {
    name: string;
    manufacturer?: string;
    model?: string;
    androidVersion?: string;
    sdkInt?: number;
    appVersion?: string;
  }): Promise<{ device: Device; deviceId: string; deviceSecret: string; wsUrl: string }> {
    const result = await invoke<{ device: Row; deviceId: string; deviceSecret: string }>('enroll-device', input);
    return {
      device: mapDevice(result.device),
      deviceId: result.deviceId,
      deviceSecret: result.deviceSecret,
      wsUrl: SIGNALING_URL,
    };
  },
};

/* ------------------------------- files ------------------------------ */

export const filesApi = {
  async list(params: { category?: string; search?: string; deviceId?: string } = {}): Promise<{ files: RelayFile[]; storage: StorageSummary }> {
    let query = supabase.from('files').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(300);
    if (params.category) query = query.eq('category', params.category);
    if (params.deviceId) query = query.eq('device_id', params.deviceId);
    if (params.search) query = query.ilike('name', `%${params.search}%`);
    const { data, error } = await query;
    if (error) fail(error);
    const files = ((data ?? []) as Row[]).map(mapFile);
    const storage: StorageSummary = {
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      fileCount: files.length,
      byCategory: files.reduce<Record<string, number>>((acc, file) => {
        acc[file.category] = (acc[file.category] ?? 0) + file.size;
        return acc;
      }, {}),
    };
    return { files, storage };
  },

  async upload(file: File, options: { deviceId?: string; checksum: string; onProgress?: (percent: number) => void }): Promise<RelayFile> {
    const uid = ownerId();
    const mime = file.type || 'application/octet-stream';
    const path = `${uid}/${crypto.randomUUID()}-${sanitizeName(file.name)}`;
    await putObject('droidlinkx-files', path, file, mime, options.onProgress);
    const { data, error } = await supabase
      .from('files')
      .insert({
        owner_id: uid,
        device_id: options.deviceId ?? null,
        name: file.name,
        path: '/',
        mime_type: mime,
        category: categoryOf(mime),
        size: file.size,
        sha256: options.checksum,
        storage_path: path,
      })
      .select('*')
      .single();
    if (error) fail(error);
    return mapFile(data as Row);
  },

  async rename(id: string, name: string): Promise<RelayFile> {
    const { data, error } = await supabase.from('files').update({ name }).eq('id', id).select('*').single();
    if (error) fail(error);
    return mapFile(data as Row);
  },

  async remove(id: string): Promise<void> {
    const { data } = await supabase.from('files').select('storage_path').eq('id', id).maybeSingle();
    const { error } = await supabase.from('files').delete().eq('id', id);
    if (error) fail(error);
    const path = data?.storage_path as string | undefined;
    if (path) await supabase.storage.from('droidlinkx-files').remove([path]);
  },

  async download(file: RelayFile, transferName: string): Promise<void> {
    const signed = await invoke<{ url: string }>('generate-secure-download', { fileId: file.id });
    const response = await fetch(signed.url);
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'The signed download link could not be used');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = transferName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};

/* ----------------------------- transfers ---------------------------- */

export const transfersApi = {
  async list(): Promise<Transfer[]> {
    const { data, error } = await supabase
      .from('file_transfers')
      .select('*, transfer_items(*)')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(mapTransfer);
  },

  async get(id: string): Promise<Transfer> {
    const { data, error } = await supabase.from('file_transfers').select('*, transfer_items(*)').eq('id', id).maybeSingle();
    if (error) fail(error);
    if (!data) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found');
    return mapTransfer(data as Row);
  },

  async history(): Promise<Array<{ id: string; transferId: string; event: string; bytes: number; direction: string; createdAt: string }>> {
    const { data, error } = await supabase
      .from('transfer_history')
      .select('id, transfer_id, event, bytes, created_at, file_transfers(direction)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      transferId: row.transfer_id as string,
      event: row.event as string,
      bytes: Number(row.bytes ?? 0),
      direction: ((row.file_transfers as Row | null)?.direction as string) ?? 'dashboard_to_device',
      createdAt: row.created_at as string,
    }));
  },

  async create(input: {
    direction: string;
    mode?: 'direct' | 'relay';
    sourceDeviceId?: string | null;
    targetDeviceId?: string | null;
    items: Array<{ name: string; size: number; sha256?: string | null; relativePath?: string }>;
  }): Promise<{ transfer: Transfer }> {
    const result = await invoke<{ transfer: Row; items: Row[]; chunkSize: number }>('initiate-transfer', {
      direction: input.direction,
      mode: input.mode ?? 'relay',
      sourceDeviceId: input.sourceDeviceId ?? null,
      targetDeviceId: input.targetDeviceId ?? null,
      items: input.items,
    });
    return { transfer: mapTransfer({ ...result.transfer, transfer_items: result.items }) };
  },

  /** Uploads one 8 MiB part; parts are idempotent, so an interrupted transfer resumes cleanly. */
  async uploadChunk(transferId: string, index: number, chunkIndex: number, chunk: Blob): Promise<Transfer> {
    const uid = ownerId();
    const path = `${uid}/${transferId}/parts/${index}/${chunkIndex}.part`;
    await putObject('droidlinkx-transfers', path, chunk, 'application/octet-stream');
    const bytes = chunkIndex * CHUNK_SIZE + chunk.size;
    const { error } = await supabase
      .from('transfer_items')
      .update({ bytes_received: bytes, received_chunks: chunkIndex + 1, status: 'uploading' })
      .eq('transfer_id', transferId)
      .eq('item_index', index);
    if (error) fail(error);
    return this.get(transferId);
  },

  async completeItem(transferId: string, index: number, sha256?: string): Promise<Transfer> {
    const result = await invoke<{ transfer: Row }>('finalize-transfer', { transferId, itemIndex: index, sha256 });
    return mapTransfer(result.transfer);
  },

  async action(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry'): Promise<Transfer> {
    const status = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'active';
    const { error } = await supabase
      .from('file_transfers')
      .update({ status, error: action === 'retry' ? null : undefined })
      .eq('id', id);
    if (error) fail(error);
    const { data: transfer } = await supabase.from('file_transfers').select('owner_id').eq('id', id).maybeSingle();
    if (transfer?.owner_id) {
      await supabase.from('transfer_history').insert({
        transfer_id: id,
        owner_id: transfer.owner_id as string,
        event: `transfer_${action}`,
      });
    }
    return this.get(id);
  },
};

/* ------------------------------ misc -------------------------------- */

function mapConnection(row: Row): Connection {
  return {
    id: row.id as string,
    sourceDeviceId: (row.source_device_id as string) ?? '',
    targetDeviceId: (row.target_device_id as string | null) ?? null,
    type: (row.type as string) ?? 'mirror',
    status: (row.status as string) ?? 'pending',
    requestedBy: (row.requested_by as string) ?? 'user',
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    acceptedAt: (row.accepted_at as string | null) ?? null,
    endedAt: (row.ended_at as string | null) ?? null,
    endedReason: (row.ended_reason as string | null) ?? null,
    expiresAt: (row.expires_at as string) ?? new Date().toISOString(),
    turn: null,
  };
}

const signalingConfig = (): ServerConfig => ({
  turnConfigured: TURN_URLS.length > 0,
  stunUrls: STUN_URLS,
  turnUrls: TURN_URLS,
});

export const connectionsApi = {
  async create(input: { sourceDeviceId: string; targetDeviceId?: string | null; type: 'mirror' | 'camera' | 'file' | 'control' | 'clipboard' }): Promise<{ connection: Connection }> {
    const result = await invoke<{ connection: Row; iceServers?: RTCIceServer[] }>('authorize-connection', input);
    return { connection: mapConnection(result.connection) };
  },

  async status(deviceId?: string): Promise<{ connections: Connection[]; config: ServerConfig }> {
    let query = supabase
      .from('connection_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (deviceId) query = query.or(`source_device_id.eq.${deviceId},target_device_id.eq.${deviceId}`);
    const { data, error } = await query;
    if (error) fail(error);
    return { connections: ((data ?? []) as Row[]).map(mapConnection), config: signalingConfig() };
  },

  async accept(connectionId: string): Promise<Connection> {
    const { data, error } = await supabase
      .from('connection_sessions')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', connectionId)
      .select('*')
      .single();
    if (error) fail(error);
    const row = data as Row;
    await supabase.from('connection_events').insert({
      connection_id: connectionId,
      owner_id: row.owner_id as string,
      device_id: (row.target_device_id ?? row.source_device_id) as string | null,
      event: 'connection_accepted',
      detail: { by: 'user' },
    });
    return mapConnection(row);
  },

  async terminate(connectionId: string, reason?: string): Promise<void> {
    const { data, error } = await supabase
      .from('connection_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString(), ended_reason: reason ?? 'user_hangup' })
      .eq('id', connectionId)
      .select('owner_id, source_device_id, target_device_id')
      .single();
    if (error) fail(error);
    const row = data as Row;
    await supabase.from('connection_events').insert({
      connection_id: connectionId,
      owner_id: row.owner_id as string,
      device_id: (row.target_device_id ?? row.source_device_id) as string | null,
      event: 'connection_ended',
      detail: { reason: reason ?? 'user_hangup' },
    });
  },

  async ice(connectionId: string): Promise<{ iceServers: RTCIceServer[]; ttl: number | null }> {
    return invoke<{ iceServers: RTCIceServer[]; ttl: number | null }>('authorize-connection', { connectionId });
  },
};

export const notificationsApi = {
  async list(deviceId?: string): Promise<NotificationRecord[]> {
    let query = supabase
      .from('notification_records')
      .select('*, devices(name)')
      .order('posted_at', { ascending: false })
      .limit(200);
    if (deviceId) query = query.eq('device_id', deviceId);
    const { data, error } = await query;
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      deviceId: row.device_id as string,
      deviceName: ((row.devices as Row | null)?.name as string) ?? 'Device',
      packageName: row.package_name as string,
      appName: row.app_name as string,
      title: (row.title as string | null) ?? null,
      content: (row.content as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      postedAt: row.posted_at as string,
    }));
  },

  async clear(): Promise<number> {
    const { error, count } = await supabase
      .from('notification_records')
      .delete({ count: 'exact' })
      .eq('owner_id', ownerId());
    if (error) fail(error);
    return count ?? 0;
  },
};

const SENSITIVE_PATTERN = /(otp|one[- ]time|password|passcode|2fa|verification code|\b\d{6}\b)/i;

export const clipboardApi = {
  async list(): Promise<ClipboardEntry[]> {
    const { data, error } = await supabase
      .from('clipboard_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      direction: row.direction as string,
      contentType: (row.content_type as string) ?? 'text/plain',
      content: row.content as string,
      sensitive: Boolean(row.is_sensitive),
      createdAt: row.created_at as string,
      expiresAt: (row.expires_at as string | null) ?? null,
    }));
  },

  async sync(content: string, force = false): Promise<void> {
    const sensitive = SENSITIVE_PATTERN.test(content);
    if (sensitive && !force) {
      throw new ApiError(409, 'SENSITIVE_CONTENT', 'This looks like a password or one-time code. Confirm the override to sync it anyway.');
    }
    const uid = ownerId();
    const { error } = await supabase.from('clipboard_entries').insert({
      owner_id: uid,
      direction: 'cloud_to_device',
      content,
      content_type: 'text/plain',
      is_sensitive: sensitive,
    });
    if (error) fail(error);
    await supabase.from('activity_logs').insert({
      owner_id: uid,
      actor_type: 'user',
      actor_id: uid,
      action: 'clipboard_pushed',
      detail: { sensitive },
    });
  },

  async latest(): Promise<string | null> {
    const { data, error } = await supabase
      .from('clipboard_entries')
      .select('content')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error);
    return (data?.content as string | undefined) ?? null;
  },
};

export const activityApi = {
  async list(): Promise<ActivityEntry[]> {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*, devices(name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      action: row.action as string,
      actorType: (row.actor_type as string) ?? 'user',
      targetType: row.device_id ? 'device' : null,
      targetId: (row.device_id as string | null) ?? null,
      metadata: (row.detail as Record<string, unknown>) ?? {},
      deviceId: (row.device_id as string | null) ?? null,
      deviceName: ((row.devices as Row | null)?.name as string) ?? null,
      ip: (row.ip as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  },
};

export const securityApi = {
  async sessions(): Promise<{ sessions: DeviceSession[]; browserSessions: BrowserSession[] }> {
    const { data, error } = await supabase
      .from('device_sessions')
      .select('*, devices(name, online)')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) fail(error);
    const sessions = ((data ?? []) as Row[]).map((row) => {
      const device = (row.devices as Row | null) ?? null;
      const revoked = Boolean(row.revoked_at);
      return {
        id: row.id as string,
        deviceId: row.device_id as string,
        deviceName: (device?.name as string) ?? 'Device',
        state: revoked ? 'revoked' : 'active',
        online: Boolean(device?.online),
        ip: (row.ip as string | null) ?? null,
        userAgent: (row.user_agent as string | null) ?? null,
        startedAt: row.created_at as string,
        lastHeartbeatAt: (row.last_heartbeat_at as string | null) ?? null,
        endedAt: (row.revoked_at as string | null) ?? null,
        endedReason: revoked ? 'revoked' : null,
      } satisfies DeviceSession;
    });
    // Supabase Auth owns browser refresh tokens; per-browser enumeration is not exposed to clients.
    return { sessions, browserSessions: [] };
  },

  async revoke(sessionId: string): Promise<void> {
    await invoke('revoke-device', { sessionId, sessionsOnly: true });
  },

  async revokeAll(): Promise<void> {
    await supabase.auth.signOut({ scope: 'global' });
    sessionStore.set(null);
  },

  async health(): Promise<{
    status: string;
    database: string;
    liveSockets: number;
    webrtc: ServerConfig;
    time: string;
  }> {
    let database = 'unreachable';
    try {
      const token = sessionStore.current?.tokens.accessToken;
      const response = await fetch(`${SUPABASE_PROJECT_URL}/rest/v1/devices?select=id&limit=1`, {
        headers: token ? { apikey: SUPABASE_PUBLIC_KEY, authorization: `Bearer ${token}` } : { apikey: SUPABASE_PUBLIC_KEY },
      });
      database = response.ok ? 'ok' : `error ${response.status}`;
    } catch {
      database = 'unreachable';
    }

    let liveSockets = 0;
    let signalingStatus = 'unreachable';
    try {
      const response = await fetch(`${SIGNALING_URL.replace(/^ws/, 'http').replace(/\/ws$/, '')}/health`);
      if (response.ok) {
        const body = (await response.json()) as { status?: string; connections?: number };
        signalingStatus = body.status ?? 'ok';
        liveSockets = body.connections ?? 0;
      }
    } catch {
      signalingStatus = 'unreachable';
    }

    const healthy = database === 'ok' && signalingStatus === 'ok';
    return {
      status: healthy ? 'ok' : 'degraded',
      database,
      liveSockets,
      webrtc: signalingConfig(),
      time: new Date().toISOString(),
    };
  },
};

export const signalingApi = {
  async config(): Promise<ServerConfig> {
    return signalingConfig();
  },

  /**
   * TURN credentials are minted per connection by the authorize-connection Edge Function; without a
   * connection id only public STUN is advertised.
   */
  async turn(): Promise<{ urls: string[]; username: string; credential: string; ttl: number }> {
    return { urls: TURN_URLS, username: '', credential: '', ttl: 0 };
  },
};

export { signalingConfig };
