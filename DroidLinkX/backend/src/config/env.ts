import 'dotenv/config';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional().default(''),
  REDIS_PREFIX: z.string().default('droidlinkx:'),

  JWT_SECRET: z.string().default(''),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
  DEVICE_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),

  TURN_URLS: z.string().default(''),
  TURN_SECRET: z.string().default(''),
  TURN_TTL: z.coerce.number().int().positive().default(3600),

  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
  DOWNLOAD_URL_TTL: z.coerce.number().int().positive().default(300),

  TRUST_PROXY: bool(false),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid backend configuration -> ${details}`);
}

const raw = parsed.data;

// Development/test convenience: ephemeral secret, loudly announced. Production must provide one.
let jwtSecret = raw.JWT_SECRET;
if (!jwtSecret) {
  if (raw.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  jwtSecret = randomBytes(48).toString('base64url');
  // eslint-disable-next-line no-console
  console.warn('[config] JWT_SECRET not set - using an ephemeral development secret (tokens die on restart)');
}

export const env = {
  ...raw,
  JWT_SECRET: jwtSecret,
  CORS_ORIGINS: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  TURN_URLS: raw.TURN_URLS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
} as const;

export type Env = typeof env;
