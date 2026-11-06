import type { Config } from './config.js';

export type DeviceSessionRow = {
  id: string;
  device_id: string;
  owner_id: string;
  revoked_at: string | null;
  expires_at: string;
};

export type ConnectionRow = {
  id: string;
  owner_id: string;
  source_device_id: string | null;
  target_device_id: string | null;
  status: string;
  expires_at: string;
};

export type DeviceRow = { id: string; owner_id: string; status: string; online: boolean };

/** Thin PostgREST client: the signalling service never talks SQL and never needs a database driver. */
export class SupabaseRest {
  constructor(private readonly config: Config, private readonly fetchImpl: typeof fetch = fetch) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.config.serviceRoleKey,
      authorization: `Bearer ${this.config.serviceRoleKey}`,
      'content-type': 'application/json',
      ...extra,
    };
  }

  async get<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const url = new URL(`${this.config.supabaseUrl}/rest/v1/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`supabase ${path} ${response.status}: ${await response.text()}`);
    return (await response.json()) as T[];
  }

  async patch(path: string, params: Record<string, string>, body: Record<string, unknown>): Promise<void> {
    const url = new URL(`${this.config.supabaseUrl}/rest/v1/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: this.headers({ prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`supabase ${path} patch ${response.status}: ${await response.text()}`);
  }

  async post(path: string, body: unknown): Promise<void> {
    const response = await this.fetchImpl(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      method: 'POST',
      headers: this.headers({ prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`supabase ${path} insert ${response.status}: ${await response.text()}`);
  }

  async broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
    const response = await this.fetchImpl(`${this.config.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
    });
    if (!response.ok) throw new Error(`broadcast ${response.status}`);
  }
}

export type DeviceSummary = { id: string; name: string; online: boolean; status: string };

export interface Directory {
  getDeviceSession(sessionId: string): Promise<DeviceSessionRow | null>;
  listDevices(ownerId: string): Promise<DeviceSummary[]>;
  updateConnectionStatus(connectionId: string, status: string, reason?: string): Promise<void>;
  getDevice(deviceId: string): Promise<DeviceRow | null>;
  getConnection(connectionId: string): Promise<ConnectionRow | null>;
  setDevicePresence(deviceId: string, online: boolean, at: string): Promise<void>;
  recordConnectionEvent(connection: ConnectionRow, event: string, detail: Record<string, unknown>): Promise<void>;
  broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void>;
}

export class SupabaseDirectory implements Directory {
  constructor(private readonly rest: SupabaseRest) {}

  async getDeviceSession(sessionId: string): Promise<DeviceSessionRow | null> {
    const rows = await this.rest.get<DeviceSessionRow>('device_sessions', {
      select: 'id,device_id,owner_id,revoked_at,expires_at',
      id: `eq.${sessionId}`,
      expires_at: `gt.${new Date().toISOString()}`,
      revoked_at: 'is.null',
      limit: '1',
    });
    return rows[0] ?? null;
  }

  async listDevices(ownerId: string): Promise<DeviceSummary[]> {
    return this.rest.get<DeviceSummary>('devices', {
      select: 'id,name,online,status',
      owner_id: `eq.${ownerId}`,
      order: 'created_at.asc',
    });
  }

  async updateConnectionStatus(connectionId: string, status: string, reason?: string): Promise<void> {
    await this.rest.patch(
      'connection_sessions',
      { id: `eq.${connectionId}` },
      {
        status,
        ...(status === 'accepted' ? { accepted_at: new Date().toISOString() } : {}),
        ...(status === 'ended' || status === 'rejected'
          ? { ended_at: new Date().toISOString(), ended_reason: reason ?? status }
          : {}),
      },
    );
  }

  async getDevice(deviceId: string): Promise<DeviceRow | null> {
    const rows = await this.rest.get<DeviceRow>('devices', {
      select: 'id,owner_id,status,online',
      id: `eq.${deviceId}`,
      limit: '1',
    });
    return rows[0] ?? null;
  }

  async getConnection(connectionId: string): Promise<ConnectionRow | null> {
    const rows = await this.rest.get<ConnectionRow>('connection_sessions', {
      select: 'id,owner_id,source_device_id,target_device_id,status,expires_at',
      id: `eq.${connectionId}`,
      limit: '1',
    });
    return rows[0] ?? null;
  }

  async setDevicePresence(deviceId: string, online: boolean, at: string): Promise<void> {
    await this.rest.patch(
      'devices',
      { id: `eq.${deviceId}` },
      {
        online,
        connection_quality: online ? 'good' : 'offline',
        ...(online ? { last_seen_at: at } : {}),
      },
    );
  }

  async recordConnectionEvent(connection: ConnectionRow, event: string, detail: Record<string, unknown>): Promise<void> {
    await this.rest.post('connection_events', {
      connection_id: connection.id,
      owner_id: connection.owner_id,
      device_id: connection.target_device_id ?? connection.source_device_id,
      event,
      detail,
    });
  }

  async broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
    await this.rest.broadcast(topic, event, payload);
  }
}
