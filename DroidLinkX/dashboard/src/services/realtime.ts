import type { RealtimeEvent } from '@/lib/types';

export type RealtimeStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

type Handler = (event: RealtimeEvent) => void;
type StatusHandler = (status: RealtimeStatus, detail?: string) => void;

const BASE_DELAY_MS = 800;
const MAX_DELAY_MS = 30_000;
const HEARTBEAT_MS = 25_000;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private tokenProvider: (() => string | null) | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private currentStatus: RealtimeStatus = 'idle';

  get status(): RealtimeStatus {
    return this.currentStatus;
  }

  connect(tokenProvider: () => string | null): void {
    this.tokenProvider = tokenProvider;
    this.intentionalClose = false;
    this.open();
  }

  private setStatus(status: RealtimeStatus, detail?: string): void {
    this.currentStatus = status;
    this.statusHandlers.forEach((handler) => handler(status, detail));
    this.emit({ type: `realtime:${status}`, detail });
  }

  private open(): void {
    const token = this.tokenProvider?.() ?? null;
    if (!token) {
      this.setStatus('idle');
      return;
    }
    this.closeSocket();
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}&role=user`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
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
      this.stopHeartbeat();
      if (this.intentionalClose) {
        this.setStatus('idle');
        return;
      }
      if (event.code === 4403 || event.code === 4401) {
        this.setStatus('offline', 'Session rejected by the server');
        this.scheduleReconnect();
        return;
      }
      this.setStatus('reconnecting', `Connection closed (${event.code})`);
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
    this.reconnectTimer = setTimeout(() => this.open(), Math.round(jitter));
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
    if (this.socket) {
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
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.closeSocket();
    this.attempt = 0;
    this.setStatus('idle');
  }

  send(event: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
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
