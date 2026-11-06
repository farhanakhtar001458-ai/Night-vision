/** Web Crypto helpers shared by Edge Functions (Deno runtime). */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/** Constant-time comparison so secret checks do not leak timing information. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

async function hmacKey(secret: string, hash: 'SHA-256' | 'SHA-1'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
}

export async function hmacSign(secret: string, payload: string, hash: 'SHA-256' | 'SHA-1' = 'SHA-256'): Promise<ArrayBuffer> {
  const key = await hmacKey(secret, hash);
  return crypto.subtle.sign('HMAC', key, encoder.encode(payload));
}

export async function hmacBase64Url(secret: string, payload: string): Promise<string> {
  return toBase64Url(new Uint8Array(await hmacSign(secret, payload)));
}

export async function hmacBase64(secret: string, payload: string, hash: 'SHA-256' | 'SHA-1' = 'SHA-1'): Promise<string> {
  const signature = new Uint8Array(await hmacSign(secret, payload, hash));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}
