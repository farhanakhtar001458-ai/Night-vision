process.env.RATE_LIMIT_STRICT = 'true';

import { beforeEach, describe, expect, it } from 'vitest';

// Imported after the strict flag is set so the limiter keeps its production thresholds.
const { api, registerOwner, resetDatabase } = await import('./helpers.js');

describe('rate limiting (production thresholds)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rate limits login attempts and advertises the window', async () => {
    let limited: { status: number; body: { error: { code: string } }; headers: Record<string, string> } | null = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const res = await api()
        .post('/api/auth/login')
        .send({ email: 'nobody@droidlinkx.test', password: 'WrongPassword123' });
      if (res.status === 429) {
        limited = res as never;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.body.error.code).toBe('RATE_LIMITED');
    expect(limited!.headers['retry-after']).toBeDefined();
    expect(Number(limited!.headers['x-ratelimit-limit'])).toBe(20);
  });

  it('caps device enrollment attempts per window', async () => {
    const owner = await registerOwner();
    let limited = false;
    for (let attempt = 0; attempt < 33; attempt += 1) {
      const res = await api()
        .post('/api/devices/enroll')
        .set('authorization', `Bearer ${owner.accessToken}`)
        .send({ name: `Device ${attempt}` });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
