import { createClient, type Session } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/**
 * The browser only ever sees the public anon key. Row Level Security enforces ownership and all
 * privileged operations (device secrets, chunk assembly, signed downloads) run in Edge Functions.
 */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(
  SUPABASE_URL || 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY || 'public-anon-key-not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'droidlinkx.supabase.auth',
    },
  },
);

export const SUPABASE_PROJECT_URL = SUPABASE_URL;
export const SUPABASE_PUBLIC_KEY = SUPABASE_ANON_KEY;

const httpBase = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
const defaultSignaling = httpBase.replace(/^http/, 'ws') + '/ws';

/** Dedicated signalling relay (WebRTC only). Data events come from Supabase Realtime. */
export const SIGNALING_URL =
  (import.meta.env.VITE_SIGNALING_URL as string | undefined)?.trim() || defaultSignaling;

export const STUN_URLS = ((import.meta.env.VITE_STUN_URLS as string | undefined) ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

export const TURN_URLS = ((import.meta.env.VITE_TURN_URLS as string | undefined) ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

export type SupabaseAuthSession = Session;
