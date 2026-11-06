import type { WebSocket } from 'ws';
import type { Principal } from './auth.js';

export type Client = {
  id: string;
  socket: WebSocket;
  principal: Principal;
  userId: string | null;
  deviceId: string | null;
  alive: boolean;
  framesInWindow: number;
  windowStartedAt: number;
};

/** In-memory registry of authenticated sockets. One instance per signalling process. */
export class Hub {
  private readonly byUser = new Map<string, Set<Client>>();
  private readonly byDevice = new Map<string, Client>();

  add(client: Client): void {
    if (client.userId) {
      const set = this.byUser.get(client.userId) ?? new Set<Client>();
      set.add(client);
      this.byUser.set(client.userId, set);
    }
    if (client.deviceId) {
      const previous = this.byDevice.get(client.deviceId);
      if (previous && previous.id !== client.id) {
        // A device can only hold one signalling socket; the newest authenticated session wins.
        previous.socket.close(4409, 'replaced by a newer device session');
      }
      this.byDevice.set(client.deviceId, client);
    }
  }

  remove(client: Client): void {
    if (client.userId) {
      const set = this.byUser.get(client.userId);
      set?.delete(client);
      if (set && set.size === 0) this.byUser.delete(client.userId);
    }
    if (client.deviceId && this.byDevice.get(client.deviceId)?.id === client.id) {
      this.byDevice.delete(client.deviceId);
    }
  }

  device(deviceId: string): Client | undefined {
    return this.byDevice.get(deviceId);
  }

  hasDevice(deviceId: string): boolean {
    return this.byDevice.has(deviceId);
  }

  onlineDeviceIds(): string[] {
    return [...this.byDevice.keys()];
  }

  sendToUser(userId: string, frame: Record<string, unknown>, excludeId?: string): number {
    let delivered = 0;
    for (const client of this.byUser.get(userId) ?? []) {
      if (client.id === excludeId) continue;
      if (send(client, frame)) delivered += 1;
    }
    return delivered;
  }

  sendToDevice(deviceId: string, frame: Record<string, unknown>): boolean {
    const client = this.byDevice.get(deviceId);
    return client ? send(client, frame) : false;
  }

  sendToOwnerDevicesAndTerminals(userId: string, frame: Record<string, unknown>, excludeId?: string): void {
    this.sendToUser(userId, frame, excludeId);
  }

  connectionCount(): number {
    let count = 0;
    for (const set of this.byUser.values()) count += set.size;
    return count + this.byDevice.size;
  }
}

export function send(client: Client, frame: Record<string, unknown>): boolean {
  if (client.socket.readyState !== 1) return false;
  try {
    client.socket.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

/** Simple per-socket frame budget: protects the relay from runaway clients. */
export function allowFrame(client: Client, limit = 240, windowMs = 10_000): boolean {
  const now = Date.now();
  if (now - client.windowStartedAt > windowMs) {
    client.windowStartedAt = now;
    client.framesInWindow = 0;
  }
  client.framesInWindow += 1;
  return client.framesInWindow <= limit;
}
