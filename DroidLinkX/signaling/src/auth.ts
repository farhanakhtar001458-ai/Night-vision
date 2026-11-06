import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from './config.js';
import type { Directory } from './supabase.js';

export type Principal =
  | { role: 'user'; userId: string; tokenId: string | null; expiresAt: number | null }
  | { role: 'device'; ownerId: string; deviceId: string; sessionId: string; expiresAt: number | null };

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

type DeviceClaims = {
  sub?: string;
  did?: string;
  sid?: string;
  jti?: string;
  typ?: string;
  iss?: string;
  exp?: number;
};

const b64urlToBuffer = (value: string): Buffer => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verifies device tokens (HS256, DEVICE_JWT_SECRET) and Supabase owner tokens (HS256 or JWKS). */
export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;

  constructor(private readonly config: Config, private readonly directory: Directory) {
    this.jwks = config.jwksUrl ? createRemoteJWKSet(new URL(config.jwksUrl)) : null;
  }

  async verifyDevice(rawToken: string): Promise<Principal> {
    const parts = rawToken.split('.');
    if (parts.length !== 3) throw new AuthError(401, 'Malformed device token');
    const [header, payload, signature] = parts as [string, string, string];
    const expected = createHmac('sha256', this.config.deviceJwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    if (!safeEqual(expected, signature)) throw new AuthError(401, 'Device token signature is invalid');

    let claims: DeviceClaims;
    try {
      claims = JSON.parse(b64urlToBuffer(payload).toString('utf8')) as DeviceClaims;
    } catch {
      throw new AuthError(401, 'Device token payload is unreadable');
    }
    if (claims.typ !== 'device' || claims.iss !== 'droidlinkx') throw new AuthError(401, 'Device token type is invalid');
    if (!claims.did || !claims.sid || !claims.sub) throw new AuthError(401, 'Device token is incomplete');
    if (!claims.exp || claims.exp * 1000 < Date.now()) throw new AuthError(401, 'Device token has expired');

    const session = await this.directory.getDeviceSession(claims.sid);
    if (!session || session.device_id !== claims.did) throw new AuthError(401, 'Device session is not valid');
    const device = await this.directory.getDevice(claims.did);
    if (!device) throw new AuthError(403, 'Device no longer exists');
    if (device.status !== 'active') throw new AuthError(403, 'Device has been revoked');
    if (device.owner_id !== claims.sub || session.owner_id !== claims.sub) {
      throw new AuthError(403, 'Device ownership mismatch');
    }

    return {
      role: 'device',
      ownerId: claims.sub,
      deviceId: claims.did,
      sessionId: claims.sid,
      expiresAt: claims.exp * 1000,
    };
  }

  async verifyUser(rawToken: string): Promise<Principal> {
    let payload: JWTPayload;
    try {
      if (this.config.userJwtSecret) {
        ({ payload } = await jwtVerify(rawToken, new TextEncoder().encode(this.config.userJwtSecret), {
          clockTolerance: this.config.allowedClockSkewSeconds,
        }));
      } else if (this.jwks) {
        ({ payload } = await jwtVerify(rawToken, this.jwks, {
          clockTolerance: this.config.allowedClockSkewSeconds,
        }));
      } else {
        throw new AuthError(401, 'No owner token verification method configured');
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, 'Owner token is invalid or expired');
    }

    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) throw new AuthError(401, 'Owner token has no subject');
    if (typeof payload.role === 'string' && payload.role !== 'authenticated') {
      throw new AuthError(403, 'Token is not an authenticated owner token');
    }

    return {
      role: 'user',
      userId,
      tokenId: typeof payload.jti === 'string' ? payload.jti : null,
      expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
    };
  }

  async verify(rawToken: string, role: 'user' | 'device'): Promise<Principal> {
    return role === 'device' ? this.verifyDevice(rawToken) : this.verifyUser(rawToken);
  }
}
