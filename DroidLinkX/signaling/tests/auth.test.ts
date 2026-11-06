import { createHmac } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AuthError, TokenVerifier } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { Directory, DeviceRow, DeviceSessionRow, ConnectionRow, DeviceSummary } from '../src/supabase.js';

const config: Config = {
  port: 0,
  supabaseUrl: 'https://project.supabase.co',
  serviceRoleKey: 'service-role-key',
  deviceJwtSecret: 'device-secret-for-tests',
  userJwtSecret: 'user-secret-for-tests',
  jwksUrl: '',
  heartbeatMs: 30_000,
  maxConnections: 10,
  corsOrigins: ['*'],
  allowedClockSkewSeconds: 30,
};

const OWNER = '11111111-1111-1111-1111-111111111111';
const DEVICE = 'aaaaaaaa-0000-0000-0000-000000000001';
const SESSION = '99999999-9999-9999-9999-999999999999';

class FakeDirectory implements Directory {
  sessionValid = true;
  deviceStatus = 'active';
  deviceOwner = OWNER;
  async getDeviceSession(_sessionId: string): Promise<DeviceSessionRow | null> {
    if (!this.sessionValid) return null;
    return {
      id: SESSION,
      device_id: DEVICE,
      owner_id: this.deviceOwner,
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  async getDevice(_deviceId: string): Promise<DeviceRow | null> {
    return { id: DEVICE, owner_id: this.deviceOwner, status: this.deviceStatus, online: false };
  }
  async listDevices(_ownerId: string): Promise<DeviceSummary[]> {
    return [];
  }
  async updateConnectionStatus(): Promise<void> {}
  async getConnection(): Promise<ConnectionRow | null> {
    return null;
  }
  async setDevicePresence(): Promise<void> {}
  async recordConnectionEvent(): Promise<void> {}
  async broadcast(): Promise<void> {}
}

function mintDeviceToken(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: OWNER,
    did: DEVICE,
    sid: SESSION,
    typ: 'device',
    iss: 'droidlinkx',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  })).toString('base64url');
  const signature = createHmac('sha256', config.deviceJwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('device token verification', () => {
  it('accepts a well-formed device token bound to an active session', async () => {
    const directory = new FakeDirectory();
    const verifier = new TokenVerifier(config, directory);
    const principal = await verifier.verify(mintDeviceToken(), 'device');
    expect(principal).toMatchObject({ role: 'device', ownerId: OWNER, deviceId: DEVICE, sessionId: SESSION });
  });

  it('rejects a tampered signature', async () => {
    const verifier = new TokenVerifier(config, new FakeDirectory());
    const token = mintDeviceToken();
    const tampered = `${token.slice(0, -2)}xx`;
    await expect(verifier.verify(tampered, 'device')).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects an expired device token', async () => {
    const verifier = new TokenVerifier(config, new FakeDirectory());
    await expect(verifier.verify(mintDeviceToken({ exp: Math.floor(Date.now() / 1000) - 5 }), 'device')).rejects.toThrow(/expired/i);
  });

  it('rejects a device whose session was revoked', async () => {
    const directory = new FakeDirectory();
    directory.sessionValid = false;
    const verifier = new TokenVerifier(config, directory);
    await expect(verifier.verify(mintDeviceToken(), 'device')).rejects.toThrow(/session/i);
  });

  it('rejects a device that the owner revoked', async () => {
    const directory = new FakeDirectory();
    directory.deviceStatus = 'revoked';
    const verifier = new TokenVerifier(config, directory);
    await expect(verifier.verify(mintDeviceToken(), 'device')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a device token signed with a different secret', async () => {
    const verifier = new TokenVerifier({ ...config, deviceJwtSecret: 'other-secret' }, new FakeDirectory());
    await expect(verifier.verify(mintDeviceToken(), 'device')).rejects.toThrow(/signature/i);
  });
});

describe('owner token verification', () => {
  it('accepts a Supabase user token signed with the project secret', async () => {
    const verifier = new TokenVerifier(config, new FakeDirectory());
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(OWNER)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.userJwtSecret));
    const principal = await verifier.verify(token, 'user');
    expect(principal).toMatchObject({ role: 'user', userId: OWNER });
  });

  it('rejects a user token signed with the wrong secret', async () => {
    const verifier = new TokenVerifier(config, new FakeDirectory());
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(OWNER)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('not-the-secret'));
    await expect(verifier.verify(token, 'user')).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects an anon-role token', async () => {
    const verifier = new TokenVerifier(config, new FakeDirectory());
    const token = await new SignJWT({ role: 'anon' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(OWNER)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.userJwtSecret));
    await expect(verifier.verify(token, 'user')).rejects.toMatchObject({ status: 403 });
  });
});
