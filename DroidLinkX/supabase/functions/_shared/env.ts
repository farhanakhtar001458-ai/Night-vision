/** Environment shared by every Edge Function. Secrets live in Supabase function secrets only. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required function secret: ${name}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return Deno.env.get('SUPABASE_URL') ?? requireEnv('SUPABASE_URL');
  },
  get anonKey() {
    return Deno.env.get('SUPABASE_ANON_KEY') ?? requireEnv('SUPABASE_ANON_KEY');
  },
  get serviceRoleKey() {
    return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  },
  get deviceJwtSecret() {
    return Deno.env.get('DEVICE_JWT_SECRET') ?? requireEnv('DEVICE_JWT_SECRET');
  },
  get deviceTokenTtlSeconds() {
    return Number(Deno.env.get('DEVICE_TOKEN_TTL_SECONDS') ?? '2592000');
  },
  get turnSecret() {
    return Deno.env.get('TURN_SECRET') ?? '';
  },
  get turnUrls() {
    return (Deno.env.get('TURN_URLS') ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  },
  get stunUrls() {
    return (Deno.env.get('STUN_URLS') ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  },
  get turnTtlSeconds() {
    return Number(Deno.env.get('TURN_TTL_SECONDS') ?? '3600');
  },
  get signalingUrl() {
    return Deno.env.get('SIGNALING_URL') ?? '';
  },
  get appOrigins() {
    return (Deno.env.get('APP_ORIGINS') ?? '*')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  },
  get maxDevicesPerOwner() {
    return Number(Deno.env.get('MAX_DEVICES_PER_OWNER') ?? '25');
  },
  get maxTransferBytes() {
    return Number(Deno.env.get('MAX_TRANSFER_BYTES') ?? String(2 * 1024 * 1024 * 1024));
  },
  get downloadUrlTtlSeconds() {
    return Number(Deno.env.get('DOWNLOAD_URL_TTL_SECONDS') ?? '300');
  },
};
