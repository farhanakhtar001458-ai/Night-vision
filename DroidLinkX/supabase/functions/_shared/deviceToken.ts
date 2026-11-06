import { env } from './env.ts';
import { fromBase64Url, hmacBase64Url, toBase64Url } from './crypto.ts';
import { HttpError } from './http.ts';

export type DeviceClaims = {
  sub: string; // owner id
  did: string; // device id
  sid: string; // device_sessions.id
  jti: string;
  typ: 'device';
  iat: number;
  exp: number;
  iss: 'droidlinkx';
};

/**
 * Short-lived-ish device bearer signed with DEVICE_JWT_SECRET (HS256, Web Crypto).
 * The signalling service verifies the same token with the shared secret; neither side stores it.
 */
export async function signDeviceToken(claims: Omit<DeviceClaims, 'typ' | 'iat' | 'exp' | 'iss'>): Promise<{ token: string; expiresIn: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = env.deviceTokenTtlSeconds;
  const payload: DeviceClaims = {
    ...claims,
    typ: 'device',
    iss: 'droidlinkx',
    iat: now,
    exp: now + expiresIn,
  };
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacBase64Url(env.deviceJwtSecret, `${header}.${body}`);
  return { token: `${header}.${body}.${signature}`, expiresIn };
}

export async function verifyDeviceToken(token: string): Promise<DeviceClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'DEVICE_TOKEN', 'Malformed device token');
  const [header, body, signature] = parts as [string, string, string];
  const expected = await hmacBase64Url(env.deviceJwtSecret, `${header}.${body}`);
  if (expected !== signature) throw new HttpError(401, 'DEVICE_TOKEN', 'Device token signature is invalid');

  let claims: DeviceClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as DeviceClaims;
  } catch {
    throw new HttpError(401, 'DEVICE_TOKEN', 'Device token payload is unreadable');
  }
  if (claims.typ !== 'device' || claims.iss !== 'droidlinkx') {
    throw new HttpError(401, 'DEVICE_TOKEN', 'Device token type is invalid');
  }
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, 'DEVICE_TOKEN', 'Device token has expired');
  }
  return claims;
}

export function readDeviceToken(req: Request): string {
  const header = req.headers.get('x-device-token');
  if (header) return header.trim();
  const authorization = req.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  throw new HttpError(401, 'DEVICE_TOKEN', 'A device token is required');
}
