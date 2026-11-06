import { query, one, withTransaction } from '../database/pool.js';
import { hashSecret, hashToken, randomToken, verifySecret } from '../security/crypto.js';
import { signAccessToken } from '../security/tokens.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { recordActivity } from '../activity/service.js';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: string;
  settings: Record<string, unknown>;
  created_at: Date;
  last_login_at: Date | null;
};

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  };
}

export type TokenBundle = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
};

async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ip?: string },
  familyId?: string,
): Promise<{ refreshToken: string; familyId: string; expiresAt: Date }> {
  const refreshToken = randomToken(48);
  const family = familyId ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, family, hashToken(refreshToken), expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  return { refreshToken, familyId: family, expiresAt };
}

async function issueUserSession(
  user: UserRow,
  meta: { userAgent?: string; ip?: string },
  familyId?: string,
): Promise<TokenBundle> {
  const refresh = await issueRefreshToken(user.id, meta, familyId);
  const jti = crypto.randomUUID();
  const { token, expiresIn } = signAccessToken({
    sub: user.id,
    uid: user.id,
    typ: 'user',
    jti,
    email: user.email,
  });
  return {
    accessToken: token,
    expiresIn,
    refreshToken: refresh.refreshToken,
    refreshExpiresIn: Math.floor((refresh.expiresAt.getTime() - Date.now()) / 1000),
    tokenType: 'Bearer',
  };
}

export async function register(
  input: { email: string; password: string; displayName: string },
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: PublicUser; tokens: TokenBundle }> {
  const email = input.email.trim().toLowerCase();
  const existing = await one<{ id: string }>('SELECT id FROM users WHERE email_lower = $1', [email]);
  if (existing) throw new AppError('CONFLICT', 'An account with this email already exists');

  const passwordHash = await hashSecret(input.password);
  const row = await one<UserRow>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [email, passwordHash, input.displayName.trim()],
  );
  if (!row) throw new AppError('INTERNAL', 'Failed to create the account');

  const tokens = await issueUserSession(row, meta);
  await recordActivity({
    userId: row.id,
    actorType: 'user',
    action: 'auth.register',
    targetType: 'user',
    targetId: row.id,
    ip: meta.ip ?? null,
  });
  return { user: toPublicUser(row), tokens };
}

export async function login(
  input: { email: string; password: string },
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: PublicUser; tokens: TokenBundle }> {
  const email = input.email.trim().toLowerCase();
  const row = await one<UserRow>('SELECT * FROM users WHERE email_lower = $1', [email]);
  const genericFailure = new AppError('UNAUTHORIZED', 'Invalid email or password');

  if (!row) {
    // Constant-ish work to avoid trivially distinguishing unknown accounts.
    await verifySecret(input.password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    throw genericFailure;
  }
  const ok = await verifySecret(input.password, row.password_hash);
  if (!ok) {
    await recordActivity({
      userId: row.id,
      actorType: 'user',
      action: 'auth.login_failed',
      targetType: 'user',
      targetId: row.id,
      ip: meta.ip ?? null,
    });
    throw genericFailure;
  }
  if (row.status !== 'active') throw new AppError('FORBIDDEN', 'This account is not active');

  await query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [row.id]);
  const tokens = await issueUserSession(row, meta);
  await recordActivity({
    userId: row.id,
    actorType: 'user',
    action: 'auth.login',
    targetType: 'user',
    targetId: row.id,
    ip: meta.ip ?? null,
  });
  return { user: toPublicUser({ ...row, last_login_at: new Date() }), tokens };
}

export async function refresh(
  refreshToken: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: PublicUser; tokens: TokenBundle }> {
  const tokenHash = hashToken(refreshToken);
  const row = await one<{
    id: string;
    user_id: string;
    family_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    replaced_by: string | null;
  }>('SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1', [
    tokenHash,
  ]);

  if (!row) throw new AppError('UNAUTHORIZED', 'Invalid refresh token');

  // Reuse of a rotated token means the token leaked: burn the whole family.
  if (row.revoked_at || row.replaced_by) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
    await recordActivity({
      userId: row.user_id,
      actorType: 'user',
      action: 'auth.refresh_reuse_detected',
      targetType: 'refresh_family',
      targetId: row.family_id,
      ip: meta.ip ?? null,
    });
    throw new AppError('UNAUTHORIZED', 'Refresh token has already been used. All sessions in this family were revoked.');
  }
  if (row.expires_at.getTime() < Date.now()) throw new AppError('UNAUTHORIZED', 'Refresh token expired');

  const user = await one<UserRow>('SELECT * FROM users WHERE id = $1', [row.user_id]);
  if (!user || user.status !== 'active') throw new AppError('UNAUTHORIZED', 'Account is not active');

  const rotated = await withTransaction(async (client) => {
    const next = randomToken(48);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [row.user_id, row.family_id, hashToken(next), expiresAt, meta.userAgent ?? null, meta.ip ?? null],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [
      row.id,
      inserted.rows[0]!.id,
    ]);
    return { next, expiresAt };
  });

  const jti = crypto.randomUUID();
  const access = signAccessToken({ sub: user.id, uid: user.id, typ: 'user', jti, email: user.email });
  return {
    user: toPublicUser(user),
    tokens: {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rotated.next,
      refreshExpiresIn: Math.floor((rotated.expiresAt.getTime() - Date.now()) / 1000),
      tokenType: 'Bearer',
    },
  };
}

export async function logout(input: { refreshToken?: string; userId: string; jti?: string; ip?: string }): Promise<void> {
  if (input.refreshToken) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
      hashToken(input.refreshToken),
    ]);
  }
  if (input.jti) {
    const { cache } = await import('../store/cache.js');
    await cache().set(`revoked:token:${input.jti}`, '1', env.ACCESS_TOKEN_TTL);
  }
  await recordActivity({
    userId: input.userId,
    actorType: 'user',
    action: 'auth.logout',
    targetType: 'user',
    targetId: input.userId,
    ip: input.ip ?? null,
  });
}

export async function getUser(userId: string): Promise<PublicUser> {
  const row = await one<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  if (!row) throw new AppError('NOT_FOUND', 'Account not found');
  return toPublicUser(row);
}

export async function updateProfile(
  userId: string,
  input: { displayName?: string; settings?: Record<string, unknown> },
): Promise<PublicUser> {
  const row = await one<UserRow>(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            settings = CASE WHEN $3::jsonb IS NULL THEN settings ELSE settings || $3::jsonb END,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [userId, input.displayName ?? null, input.settings ? JSON.stringify(input.settings) : null],
  );
  if (!row) throw new AppError('NOT_FOUND', 'Account not found');
  return toPublicUser(row);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!row) throw new AppError('NOT_FOUND', 'Account not found');
  const ok = await verifySecret(currentPassword, row.password_hash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Current password is incorrect');
  const newHash = await hashSecret(newPassword);
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, newHash]);
  // Password change invalidates every refresh token for this account.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  await recordActivity({ userId, actorType: 'user', action: 'auth.password_changed', targetType: 'user', targetId: userId });
}
