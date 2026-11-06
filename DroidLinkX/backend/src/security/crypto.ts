import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;

/** Password/secret hashing with scrypt. Format: scrypt$N$r$p$salt$hash (all base64url). */
export async function hashSecret(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEYLEN);
  return ['scrypt', SCRYPT_N, SCRYPT_r, SCRYPT_p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifySecret(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const derived = await scrypt(plain, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Opaque token hashes are stored with a server-side pepper from the JWT secret material. */
export function hashToken(token: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(token).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Short-lived HMAC signed download tokens: `<fileId>.<expEpoch>.<sig>`. */
export function signDownloadToken(fileId: string, ttlSeconds: number = env.DOWNLOAD_URL_TTL): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${fileId}.${exp}`;
  const sig = createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyDownloadToken(token: string): { fileId: string; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [fileId, expRaw, sig] = parts as [string, string, string];
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const expected = createHmac('sha256', env.JWT_SECRET).update(`${fileId}.${exp}`).digest('base64url');
  return constantTimeEqual(sig, expected) ? { fileId, exp } : null;
}

/** coturn REST API credential: username is `<expiry>:<identity>`, password is base64(HMAC-SHA1(secret, username)). */
export function turnCredentials(identity: string): { urls: string[]; username: string; credential: string; ttl: number } | null {
  if (!env.TURN_SECRET || env.TURN_URLS.length === 0) return null;
  const ttl = env.TURN_TTL;
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${identity}`;
  const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
  return { urls: [...env.TURN_URLS], username, credential, ttl };
}

/** Detects common sensitive clipboard / notification payloads so they are never silently persisted. */
export function looksSensitive(text: string): boolean {
  if (!text) return false;
  const normalised = text.trim();
  const otp = /\b\d{4,8}\b/;
  const otpWords = /(otp|one[- ]time|verification code|2fa|two[- ]factor|passcode)/i;
  const secretWords = /(password|passwd|pwd|pin|cvv|card number|seed phrase|private key|recovery code)/i;
  const longNumeric = /^\d{12,19}$/;
  return otpWords.test(normalised) || secretWords.test(normalised) || longNumeric.test(normalised) || (otp.test(normalised) && normalised.length < 12);
}
