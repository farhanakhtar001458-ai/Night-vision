import { SIGNALING_URL, supabase } from '@/lib/supabase';
import { sessionStore } from '@/services/api';
import type { RealtimeEvent } from '@/lib/types';

export type RealtimeStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

type Handler = (event: RealtimeEvent) => void;
type StatusHandler = (status: RealtimeStatus, detail?: string) => void;
type Payload = { new?: Record<string, unknown>; old?: Record<string, unknown> };

const BASE_DELAY_MS = 800;
const MAX_DELAY_MS = 30_000;
const HEARTBEAT_MS = 25_000;

const SIGNAL_TYPES = new Set([
  'rtc:offer',
  'rtc:answer',
  'rtc:ice',
  'rtc:hangup',
  'connection:accept',
  'connection:reject',
]);

const BROADCAST_EVENTS = [
  'device:enrolled',
  'device:revoked',
  'device:status',
  'device:online',
  'device:offline',
  'connection:request',
  'transfer:created',
  'transfer:completed',
  'clipboard:update',
  'notification:sync',
];

/**
 * Two transports, on purpose:
 *  - Supabase Realtime carries durable state (devices, connections, transfers, activity) over
 *    postgres_changes plus private broadcast.
 *  - The dedicated signalling relay carries WebRTC SDP/ICE only. Video never travels through the
 *    database or Supabase Realtime.
 */
export class RealtimeClient {
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private socket: WebSocket | null = null;
  private tokenProvider: (() => string | null) | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private currentStatus: RealtimeStatus = 'idle';
  private dataSubscribed = false;
  private socketOpen = false;

  get status(): RealtimeStatus {
    return this.currentStatus;
  }

  connect(tokenProvider: () => string | null): void {
    this.tokenProvider = tokenProvider;
    this.intentionalClose = false;
    this.subscribeData();
    this.openSocket();
  }

  private setStatus(status: RealtimeStatus, detail?: string): void {
    this.currentStatus = status;
    this.statusHandlers.forEach((handler) => handler(status, detail));
    this.emit({ type: `realtime:${status}`, detail });
  }

  /* ------------------------- Supabase Realtime ------------------------- */

  private subscribeData(): void {
    const session = sessionStore.current;
    if (!session || this.dataSubscribed) return;
    const uid = session.user.id;
    supabase.realtime.setAuth(session.tokens.accessToken);

    const channel = supabase.channel(`owner:${uid}`, {
      config: { broadcast: { self: true }, presence: { key: uid } },
    });

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `owner_id=eq.${uid}` }, (payload) =>
      this.onDeviceChange(payload as Payload),
    );
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'file_transfers', filter: `owner_id=eq.${uid}` }, (payload) =>
      this.onTransferChange(payload as Payload),
    );
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'transfer_items' }, (payload) =>
      this.onTransferItemChange(payload as Payload),
    );
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'connection_sessions', filter: `owner_id=eq.${uid}` }, (payload) =>
      this.onConnectionChange(payload as Payload),
    );
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `owner_id=eq.${uid}` }, (payload) => {
      const row = (payload as Payload).new ?? {};
      this.emit({ type: 'activity:created', ...row });
    });

    for (const event of BROADCAST_EVENTS) {
      channel.on('broadcast', { event }, (message) => {
        const payload = (message as { payload?: Record<string, unknown> }).payload ?? {};
        this.emit({ type: event, ...payload });
      });
    }

    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        this.dataSubscribed = true;
        this.emit({ type: 'realtime:channel', status });
        if (this.socketOpen) this.setStatus('online');
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.dataSubscribed = false;
        this.setStatus('reconnecting', error?.message ?? 'Supabase Realtime is reconnecting');
      }
    });

    this.channel = channel;
  }

  private onDeviceChange(payload: Payload): void {
    const next = payload.new ?? {};
    const previous = payload.old ?? {};
    const deviceId = next.id as string | undefined;
    if (!deviceId) return;
    if (next.online === true && previous.online !== true) {
      this.emit({ type: 'device:online', deviceId, at: next.last_seen_at });
    }
    if (next.online === false && previous.online === true) {
      this.emit({ type: 'device:offline', deviceId, at: next.last_seen_at });
    }
    const telemetry = (next.telemetry as Record<string, unknown>) ?? {};
    this.emit({
      type: 'device:heartbeat',
      deviceId,
      battery: telemetry.battery,
      charging: telemetry.charging,
      network: telemetry.network,
      at: next.last_seen_at,
    });
    this.emit({ type: 'device:updated', deviceId, device: next });
  }

  private onTransferChange(payload: Payload): void {
    const row = payload.new ?? {};
    this.emit({
      type: 'transfer:progress',
      transferId: row.id,
      status: row.status,
      bytes: row.transferred_bytes,
      total: row.total_bytes,
    });
  }

  private onTransferItemChange(payload: Payload): void {
    const row = payload.new ?? {};
    this.emit({
      type: 'transfer:progress',
      transferId: row.transfer_id,
      itemIndex: row.item_index,
      status: row.status,
      bytes: row.bytes_received,
      total: row.size,
    });
    if (row.status === 'completed') {
      this.emit({ type: 'transfer:completed', transferId: row.transfer_id, itemIndex: row.item_index });
    }
  }

  private onConnectionChange(payload: Payload): void {
    const row = payload.new ?? {};
    const type = row.status === 'pending' ? 'connection:request' : row.status === 'ended' ? 'connection:ended' : 'connection:updated';
    this.emit({ type, connectionId: row.id, status: row.status, connectionType: row.type });
  }

  /* ---------------------- dedicated signalling relay -------------------- */

  private openSocket(): void {
    const token = this.tokenProvider?.() ?? null;
    if (!token) {
      this.setStatus(this.dataSubscribed ? 'online' : 'idle');
      return;
    }
    this.closeSocket();
    if (!this.socketOpen) this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const url = `${SIGNALING_URL}?token=${encodeURIComponent(token)}&role=user`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.socketOpen = true;
      this.setStatus('online');
      this.startHeartbeat();
    };

    socket.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data as string) as RealtimeEvent;
        if (event.type === 'hello') {
          this.attempt = 0;
          this.setStatus('online');
        }
        this.emit(event);
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = (event) => {
      this.socketOpen = false;
      this.stopHeartbeat();
      if (this.intentionalClose) {
        this.setStatus('idle');
        return;
      }
      if (event.code === 4403 || event.code === 4401) {
        this.setStatus('offline', 'Signalling rejected the session');
        this.scheduleReconnect();
        return;
      }
      this.setStatus(this.dataSubscribed ? 'online' : 'reconnecting', `Signalling closed (${event.code})`);
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      /* close handler drives the retry policy */
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    this.attempt += 1;
    const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 1.9 ** Math.min(this.attempt, 8));
    const jitter = exponential * (0.75 + Math.random() * 0.5);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openSocket(), Math.round(jitter));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private closeSocket(): void {
    if (!this.socket) return;
    this.socket.onclose = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onopen = null;
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
    this.socketOpen = false;
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.closeSocket();
    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.dataSubscribed = false;
    this.attempt = 0;
    this.setStatus('idle');
  }

  /** RTC frames go to the relay; everything else is broadcast on the owner's private channel. */
  send(event: Record<string, unknown>): boolean {
    const type = String(event.type ?? '');
    if (SIGNAL_TYPES.has(type)) {
      if (this.socket?.readyState !== WebSocket.OPEN) return false;
      this.socket.send(JSON.stringify(event));
      return true;
    }
    const session = sessionStore.current;
    if (!this.channel || !session) return false;
    void this.channel.send({ type: 'broadcast', event: type, payload: event });
    return true;
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.currentStatus);
    return () => this.statusHandlers.delete(handler);
  }

  private emit(event: RealtimeEvent): void {
    this.handlers.get(event.type)?.forEach((handler) => handler(event));
    this.handlers.get('*')?.forEach((handler) => handler(event));
  }
}

export const realtime = new RealtimeClient();
