import { env } from './env.ts';

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = env.appOrigins;
  const allowOrigin = allowed.includes('*')
    ? '*'
    : origin && allowed.includes(origin)
      ? origin
      : allowed[0] ?? '*';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey, x-device-token',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

export function handleOptions(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== 'object') throw new Error('not an object');
    return body as T;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
}

export function requireString(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(422, 'VALIDATION', `${field} is required`);
  }
  if (value.length > maxLength) {
    throw new HttpError(422, 'VALIDATION', `${field} must be at most ${maxLength} characters`);
  }
  return value.trim();
}

export function optionalString(value: unknown, maxLength = 512): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(422, 'VALIDATION', 'Expected a string value');
  return value.trim().slice(0, maxLength) || null;
}

export function requireUuid(value: unknown, field: string): string {
  const text = requireString(value, field, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(422, 'VALIDATION', `${field} must be a UUID`);
  }
  return text;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

/** Wraps a handler so every failure becomes the shared error envelope. */
export function serve(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const origin = req.headers.get('origin');
    const preflight = handleOptions(req);
    if (preflight) return preflight;
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status, origin);
      }
      console.error('[droidlinkx] unhandled function error', error);
      return json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } }, 500, origin);
    }
  };
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return req.headers.get('x-real-ip');
}
