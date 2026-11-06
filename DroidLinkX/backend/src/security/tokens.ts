import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export type TokenKind = 'user' | 'device';

export type AccessTokenPayload = {
  sub: string; // user id (kind=user) | device id (kind=device)
  typ: TokenKind;
  jti: string;
  uid: string; // owning user id
  sid?: string; // device session id
  email?: string;
};

export function signAccessToken(payload: AccessTokenPayload): { token: string; expiresIn: number } {
  const expiresIn = payload.typ === 'device' ? env.DEVICE_TOKEN_TTL : env.ACCESS_TOKEN_TTL;
  const options: SignOptions = { algorithm: 'HS256', expiresIn, issuer: 'droidlinkx', audience: payload.typ };
  const token = jwt.sign(payload, env.JWT_SECRET, options);
  return { token, expiresIn };
}

export function verifyAccessToken(token: string, kind: TokenKind): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'droidlinkx',
    audience: kind,
  });
  if (typeof decoded === 'string') throw new Error('Malformed token payload');
  const payload = decoded as unknown as AccessTokenPayload;
  if (payload.typ !== kind || !payload.sub || !payload.uid || !payload.jti) {
    throw new Error('Invalid token payload');
  }
  return payload;
}

export function tryVerifyAccessToken(token: string, kind: TokenKind): AccessTokenPayload | null {
  try {
    return verifyAccessToken(token, kind);
  } catch {
    return null;
  }
}
