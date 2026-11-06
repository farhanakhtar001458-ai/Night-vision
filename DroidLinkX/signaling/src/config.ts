const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`[signaling] missing required environment variable ${name}`);
  return value;
};

export type Config = {
  port: number;
  supabaseUrl: string;
  serviceRoleKey: string;
  deviceJwtSecret: string;
  userJwtSecret: string;
  jwksUrl: string;
  heartbeatMs: number;
  maxConnections: number;
  corsOrigins: string[];
  allowedClockSkewSeconds: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/, '');
  return {
    port: Number(env.PORT ?? 8090),
    // The service role key is used only for server-side REST calls (session validation, presence).
    supabaseUrl: supabaseUrl ?? '',
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    deviceJwtSecret: env.DEVICE_JWT_SECRET ?? '',
    userJwtSecret: env.SUPABASE_JWT_SECRET ?? '',
    jwksUrl: env.SUPABASE_JWKS_URL ?? (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : ''),
    heartbeatMs: Number(env.HEARTBEAT_MS ?? '30000'),
    maxConnections: Number(env.MAX_CONNECTIONS ?? '2000'),
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((origin) => origin.trim()).filter(Boolean),
    allowedClockSkewSeconds: Number(env.CLOCK_SKEW_SECONDS ?? '30'),
  };
}

export function assertConfig(config: Config): void {
  if (!config.supabaseUrl) throw new Error('[signaling] SUPABASE_URL is required');
  if (!config.serviceRoleKey) throw new Error('[signaling] SUPABASE_SERVICE_ROLE_KEY is required');
  if (!config.deviceJwtSecret) throw new Error('[signaling] DEVICE_JWT_SECRET is required');
  if (!config.userJwtSecret && !config.jwksUrl) {
    throw new Error('[signaling] provide SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL to verify owner tokens');
  }
}

export { required };
