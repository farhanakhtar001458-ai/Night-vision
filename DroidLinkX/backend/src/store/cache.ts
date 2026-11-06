import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type CacheStore = {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic counter used by the rate limiter. Returns the new value and TTL remaining. */
  incr(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }>;
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, handler: (payload: string) => void): Promise<() => void>;
  close(): Promise<void>;
};

const prefix = (key: string) => `${env.REDIS_PREFIX}${key}`;

class MemoryStore implements CacheStore {
  readonly kind = 'memory' as const;
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(0);
  }

  private live(key: string): { value: string; expiresAt: number } | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== 0 && entry.expiresAt < Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(prefix(key))?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(prefix(key), {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
    });
  }

  async del(key: string): Promise<void> {
    this.values.delete(prefix(key));
  }

  async incr(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }> {
    const full = prefix(key);
    const existing = this.live(full);
    if (!existing) {
      this.values.set(full, { value: '1', expiresAt: Date.now() + ttlSeconds * 1000 });
      return { count: 1, ttl: ttlSeconds };
    }
    const count = Number.parseInt(existing.value, 10) + 1;
    this.values.set(full, { value: String(count), expiresAt: existing.expiresAt });
    return { count, ttl: Math.max(1, Math.ceil((existing.expiresAt - Date.now()) / 1000)) };
  }

  async publish(channel: string, payload: string): Promise<void> {
    this.bus.emit(channel, payload);
  }

  async subscribe(channel: string, handler: (payload: string) => void): Promise<() => void> {
    this.bus.on(channel, handler);
    return () => this.bus.off(channel, handler);
  }

  async close(): Promise<void> {
    this.values.clear();
  }
}

class RedisStore implements CacheStore {
  readonly kind = 'redis' as const;
  private readonly client: Redis;
  private readonly subscriber: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.subscriber = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.client.on('error', (err: Error) => logger.error({ err }, 'redis client error'));
    this.subscriber.on('error', (err: Error) => logger.error({ err }, 'redis subscriber error'));
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(prefix(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.client.set(prefix(key), value, 'EX', ttlSeconds);
    else await this.client.set(prefix(key), value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(prefix(key));
  }

  async incr(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }> {
    const full = prefix(key);
    const results = await this.client
      .multi()
      .incr(full)
      .ttl(full)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 1);
    let ttl = Number(results?.[1]?.[1] ?? -1);
    if (ttl < 0) {
      await this.client.expire(full, ttlSeconds);
      ttl = ttlSeconds;
    }
    return { count, ttl };
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.client.publish(prefix(channel), payload);
  }

  async subscribe(channel: string, handler: (payload: string) => void): Promise<() => void> {
    const full = prefix(channel);
    const listener = (incoming: string, message: string) => {
      if (incoming === full) handler(message);
    };
    await this.subscriber.subscribe(full);
    this.subscriber.on('message', listener);
    return () => {
      this.subscriber.off('message', listener);
      void this.subscriber.unsubscribe(full);
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }
}

let store: CacheStore | null = null;

export function cache(): CacheStore {
  if (!store) {
    if (env.REDIS_URL) {
      store = new RedisStore(env.REDIS_URL);
      logger.info('cache backend: redis');
    } else {
      store = new MemoryStore();
      logger.warn('cache backend: in-process memory (REDIS_URL not set). Single-instance only.');
    }
  }
  return store;
}

export async function closeCache(): Promise<void> {
  if (store) await store.close();
  store = null;
}
