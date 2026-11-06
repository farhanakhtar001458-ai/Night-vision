import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { env } from './env.ts';
import { HttpError } from './http.ts';

/** Full-privilege client. Only ever constructed inside an Edge Function (never shipped to clients). */
export function serviceClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('authorization') ?? '';
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: authorization ? { Authorization: authorization } : {} },
  });
}

/** Resolves the authenticated Supabase user or throws 401. Uses GoTrue, not a local token parser. */
export async function requireUser(req: Request): Promise<{ user: User; client: SupabaseClient }> {
  const authorization = req.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'UNAUTHORIZED', 'A Supabase access token is required');
  }
  const client = userClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'The access token is invalid or expired');
  }
  return { user: data.user, client };
}

/** Fails loudly instead of returning an empty result when the service query errors. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) {
    console.error(`[droidlinkx] ${context} failed`, result.error);
    throw new HttpError(500, 'DATABASE', `Database operation failed: ${context}`);
  }
  return result.data as T;
}
