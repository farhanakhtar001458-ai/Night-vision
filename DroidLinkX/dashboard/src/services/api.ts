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
} from '@/lib/types';

const STORAGE_KEY = 'droidlinkx.session.v1';

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
      if (!parsed?.tokens?.accessToken || !parsed?.tokens?.refreshToken) return null;
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
      /* storage may be unavailable in private mode */
    }
    this.listeners.forEach((listener) => listener(session));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const sessionStore = new SessionStore();

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Send the raw body untouched (used by file/chunk uploads). */
  raw?: boolean;
  auth?: boolean;
  retryOnAuthError?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const current = sessionStore.current;
  if (!current) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.tokens.refreshToken }),
        });
        if (!response.ok) {
          sessionStore.set(null);
          return false;
        }
        const data = (await response.json()) as { user: PublicUser; tokens: Tokens };
        sessionStore.set({ tokens: data.tokens, user: data.user });
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

async function parseError(response: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    /* non-JSON error */
  }
  const code = body?.error?.code ?? `HTTP_${response.status}`;
  const message = body?.error?.message ?? response.statusText ?? 'Request failed';
  return new ApiError(response.status, code, message, body?.error?.details);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal, raw = false, auth = true } = options;
  const session = sessionStore.current;

  const finalHeaders: Record<string, string> = { ...headers };
  if (auth && session) finalHeaders.authorization = `Bearer ${session.tokens.accessToken}`;
  if (body !== undefined && !raw && !finalHeaders['content-type']) {
    finalHeaders['content-type'] = 'application/json';
  }

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    signal,
    credentials: 'same-origin',
  });

  if (response.status === 401 && auth && options.retryOnAuthError !== false && session) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, retryOnAuthError: false });
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ------------------------------- auth ------------------------------- */

export const authApi = {
  async register(input: { email: string; password: string; displayName: string }): Promise<StoredSession> {
    const data = await request<{ user: PublicUser; tokens: Tokens }>('/api/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
    });
    const session = { user: data.user, tokens: data.tokens };
    sessionStore.set(session);
    return session;
  },

  async login(input: { email: string; password: string }): Promise<StoredSession> {
    const data = await request<{ user: PublicUser; tokens: Tokens }>('/api/auth/login', {
      method: 'POST',
      body: input,
      auth: false,
    });
    const session = { user: data.user, tokens: data.tokens };
    sessionStore.set(session);
    return session;
  },

  async me(): Promise<{ user: PublicUser; counts: { devices: number; online: number } }> {
    return request('/api/auth/me');
  },

  async logout(): Promise<void> {
    const session = sessionStore.current;
    try {
      if (session) {
        await request('/api/auth/logout', {
          method: 'POST',
          body: { refreshToken: session.tokens.refreshToken },
          retryOnAuthError: false,
        });
      }
    } catch {
      /* logging out locally must always succeed */
    } finally {
      sessionStore.set(null);
    }
  },

  async updateProfile(input: { displayName?: string; settings?: Record<string, unknown> }): Promise<PublicUser> {
    const data = await request<{ user: PublicUser }>('/api/auth/me', { method: 'PATCH', body: input });
    const current = sessionStore.current;
    if (current) sessionStore.set({ ...current, user: data.user });
    return data.user;
  },

  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    await request('/api/auth/password', { method: 'POST', body: input });
  },

  async restore(): Promise<StoredSession | null> {
    if (!sessionStore.current) return null;
    try {
      const refreshed = await refreshSession();
      if (!refreshed) return null;
      const me = await request<{ user: PublicUser }>('/api/auth/me');
      const current = sessionStore.current;
      if (!current) return null;
      const session = { ...current, user: me.user };
      sessionStore.set(session);
      return session;
    } catch {
      return null;
    }
  },
};

/* ------------------------------ devices ----------------------------- */

export const devicesApi = {
  async list(): Promise<Device[]> {
    const data = await request<{ devices: Device[] }>('/api/devices');
    return data.devices;
  },
  async get(id: string): Promise<Device> {
    const data = await request<{ device: Device }>(`/api/devices/${id}`);
    return data.device;
  },
  async rename(id: string, name: string): Promise<Device> {
    const data = await request<{ device: Device }>(`/api/devices/${id}`, { method: 'PATCH', body: { name } });
    return data.device;
  },
  async setTrusted(id: string, trusted: boolean): Promise<Device> {
    const data = await request<{ device: Device }>(`/api/devices/${id}`, { method: 'PATCH', body: { trusted } });
    return data.device;
  },
  async revoke(id: string): Promise<void> {
    await request(`/api/devices/${id}`, { method: 'DELETE' });
  },
  async revokeSessions(id: string): Promise<number> {
    const data = await request<{ revoked: number }>(`/api/devices/${id}/revoke-sessions`, { method: 'POST' });
    return data.revoked;
  },
  async history(id: string): Promise<Array<{ id: string; connectionId: string | null; event: string; detail: Record<string, unknown>; createdAt: string }>> {
    const data = await request<{ events: Array<{ id: string; connectionId: string | null; event: string; detail: Record<string, unknown>; createdAt: string }> }>(
      `/api/devices/${id}/history`,
    );
    return data.events;
  },
  async setPermission(id: string, permission: string, granted: boolean): Promise<Record<string, boolean>> {
    const data = await request<{ permissions: Record<string, boolean> }>(`/api/devices/${id}/permissions/${permission}`, {
      method: 'PUT',
      body: { granted },
    });
    return data.permissions;
  },
  /** Owner-authorized enrollment performed from the dashboard for a device that is being set up. */
  async enroll(input: {
    name: string;
    manufacturer?: string;
    model?: string;
    androidVersion?: string;
    sdkInt?: number;
    appVersion?: string;
  }): Promise<{ device: Device; deviceId: string; deviceSecret: string; wsUrl: string }> {
    return request('/api/devices/enroll', { method: 'POST', body: input });
  },
};

/* ------------------------------- files ------------------------------ */

export const filesApi = {
  async list(params: { category?: string; search?: string; deviceId?: string } = {}): Promise<{ files: RelayFile[]; storage: StorageSummary }> {
    const query = new URLSearchParams();
    if (params.category) query.set('category', params.category);
    if (params.search) query.set('search', params.search);
    if (params.deviceId) query.set('deviceId', params.deviceId);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/api/files${suffix}`);
  },
  async upload(file: File, options: { deviceId?: string; checksum: string; onProgress?: (percent: number) => void }): Promise<RelayFile> {
    const data = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read the file'));
      reader.readAsArrayBuffer(file);
    });
    options.onProgress?.(35);
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-file-mime': file.type || 'application/octet-stream',
      'x-content-sha256': options.checksum,
    };
    if (options.deviceId) headers['x-device-id'] = options.deviceId;
    const response = await request<{ file: RelayFile }>('/api/files/upload', {
      method: 'POST',
      raw: true,
      body: data,
      headers,
    });
    options.onProgress?.(100);
    return response.file;
  },
  async rename(id: string, name: string): Promise<RelayFile> {
    const data = await request<{ file: RelayFile }>(`/api/files/${id}`, { method: 'PATCH', body: { name } });
    return data.file;
  },
  async remove(id: string): Promise<void> {
    await request(`/api/files/${id}`, { method: 'DELETE' });
  },
  async download(file: RelayFile, transferName: string): Promise<void> {
    const response = await fetch(file.downloadUrl);
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
    const data = await request<{ transfers: Transfer[] }>('/api/transfers');
    return data.transfers;
  },
  async get(id: string): Promise<Transfer> {
    const data = await request<{ transfer: Transfer }>(`/api/transfers/${id}`);
    return data.transfer;
  },
  async history(): Promise<Array<{ id: string; transferId: string; event: string; bytes: number; direction: string; createdAt: string }>> {
    const data = await request<{ history: Array<{ id: string; transferId: string; event: string; bytes: number; direction: string; createdAt: string }> }>(
      '/api/transfers/history',
    );
    return data.history;
  },
  async create(input: {
    direction: string;
    mode?: 'direct' | 'relay';
    sourceDeviceId?: string | null;
    targetDeviceId?: string | null;
    items: Array<{ name: string; size: number; sha256?: string | null; relativePath?: string }>;
  }): Promise<{ transfer: Transfer }> {
    return request('/api/transfers', { method: 'POST', body: input });
  },
  async uploadChunk(transferId: string, index: number, chunkIndex: number, chunk: Blob): Promise<Transfer> {
    const data = await request<{ transfer: Transfer }>(`/api/transfers/${transferId}/items/${index}/chunks/${chunkIndex}`, {
      method: 'PUT',
      raw: true,
      body: chunk,
      headers: { 'content-type': 'application/octet-stream' },
    });
    return data.transfer;
  },
  async completeItem(transferId: string, index: number, sha256?: string): Promise<Transfer> {
    const headers: Record<string, string> = {};
    if (sha256) headers['x-content-sha256'] = sha256;
    const data = await request<{ transfer: Transfer }>(`/api/transfers/${transferId}/items/${index}/complete`, {
      method: 'POST',
      headers,
    });
    return data.transfer;
  },
  async action(id: string, action: 'pause' | 'resume' | 'cancel' | 'retry'): Promise<Transfer> {
    const data = await request<{ transfer: Transfer }>(`/api/transfers/${id}/${action}`, { method: 'POST' });
    return data.transfer;
  },
};

/* ------------------------------ misc -------------------------------- */

export const connectionsApi = {
  async create(input: { sourceDeviceId: string; targetDeviceId?: string | null; type: 'mirror' | 'camera' | 'file' | 'control' | 'clipboard' }): Promise<{ connection: Connection }> {
    return request('/api/connections/create', { method: 'POST', body: input });
  },
  async status(deviceId?: string): Promise<{ connections: Connection[]; config: ServerConfig }> {
    const suffix = deviceId ? `?deviceId=${deviceId}` : '';
    return request(`/api/connections/status${suffix}`);
  },
  async accept(connectionId: string): Promise<Connection> {
    const data = await request<{ connection: Connection }>('/api/connections/accept', { method: 'POST', body: { connectionId } });
    return data.connection;
  },
  async terminate(connectionId: string, reason?: string): Promise<void> {
    await request('/api/connections/terminate', { method: 'POST', body: { connectionId, reason } });
  },
  async ice(connectionId: string): Promise<{ iceServers: RTCIceServer[]; ttl: number | null }> {
    return request(`/api/connections/ice?connectionId=${connectionId}`);
  },
};

export const notificationsApi = {
  async list(deviceId?: string): Promise<NotificationRecord[]> {
    const suffix = deviceId ? `?deviceId=${deviceId}` : '';
    const data = await request<{ notifications: NotificationRecord[] }>(`/api/notifications${suffix}`);
    return data.notifications;
  },
  async clear(): Promise<number> {
    const data = await request<{ deleted: number }>('/api/notifications', { method: 'DELETE' });
    return data.deleted;
  },
};

export const clipboardApi = {
  async list(): Promise<ClipboardEntry[]> {
    const data = await request<{ entries: ClipboardEntry[] }>('/api/clipboard');
    return data.entries;
  },
  async sync(content: string, force = false): Promise<void> {
    await request('/api/clipboard/sync', { method: 'POST', body: { content, force } });
  },
  async latest(): Promise<string | null> {
    const data = await request<{ content: string | null }>('/api/clipboard/latest');
    return data.content;
  },
};

export const activityApi = {
  async list(): Promise<ActivityEntry[]> {
    const data = await request<{ activity: ActivityEntry[] }>('/api/activity');
    return data.activity;
  },
};

export const securityApi = {
  async sessions(): Promise<{ sessions: DeviceSession[]; browserSessions: BrowserSession[] }> {
    return request('/api/sessions');
  },
  async revoke(sessionId: string): Promise<void> {
    await request('/api/sessions/revoke', { method: 'POST', body: { sessionId } });
  },
  async revokeAll(): Promise<void> {
    await request('/api/sessions/revoke-all', { method: 'POST' });
  },
  async health(): Promise<{
    status: string;
    database: string;
    liveSockets: number;
    webrtc: ServerConfig;
    time: string;
  }> {
    return request('/api/health', { auth: false });
  },
};

export const signalingApi = {
  async config(): Promise<ServerConfig> {
    return request('/api/signaling/config', { auth: false });
  },
  async turn(): Promise<{ urls: string[]; username: string; credential: string; ttl: number }> {
    return request('/api/signaling/turn');
  },
};
