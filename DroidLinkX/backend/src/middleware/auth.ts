import type { NextFunction, Request, Response } from 'express';
import { tryVerifyAccessToken, type AccessTokenPayload } from '../security/tokens.js';
import { AppError } from '../utils/errors.js';
import { one } from '../database/pool.js';
import { cache } from '../store/cache.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      device?: AccessTokenPayload;
      requestId?: string;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token;
}

async function assertUserActive(userId: string): Promise<void> {
  const row = await one<{ status: string }>('SELECT status FROM users WHERE id = $1', [userId]);
  if (!row || row.status !== 'active') throw new AppError('UNAUTHORIZED', 'Account is not active');
}

/** Authenticated owner (web dashboard / Android app UI). */
export async function requireUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw new AppError('UNAUTHORIZED', 'Missing bearer token');
    const payload = tryVerifyAccessToken(token, 'user');
    if (!payload) throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
    if (await cache().get(`revoked:token:${payload.jti}`)) {
      throw new AppError('UNAUTHORIZED', 'Session has been revoked');
    }
    await assertUserActive(payload.sub);
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Authenticated device. Devices receive their own short-scoped token through
 * POST /api/devices/token after proving possession of their device secret.
 * A device token is always bound to a device_sessions row so it can be revoked.
 */
export async function requireDevice(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw new AppError('UNAUTHORIZED', 'Missing bearer token');
    const payload = tryVerifyAccessToken(token, 'device');
    if (!payload) throw new AppError('UNAUTHORIZED', 'Invalid or expired device token');
    if (await cache().get(`revoked:device:${payload.sid ?? payload.sub}`)) {
      throw new AppError('UNAUTHORIZED', 'Device session revoked');
    }
    const session = await one<{ id: string; state: string; device_id: string }>(
      `SELECT s.id, s.state, s.device_id
         FROM device_sessions s
         JOIN devices d ON d.id = s.device_id
        WHERE s.id = $1 AND s.device_id = $2 AND d.status = 'active' AND d.revoked_at IS NULL`,
      [payload.sid ?? '', payload.sub],
    );
    if (!session || session.state !== 'active') throw new AppError('UNAUTHORIZED', 'Device session is not active');
    req.device = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/** Allows either an owner token or a device token for the same owner. */
export async function requireUserOrDevice(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearer(req);
  if (!token) {
    next(new AppError('UNAUTHORIZED', 'Missing bearer token'));
    return;
  }
  const user = tryVerifyAccessToken(token, 'user');
  if (user) {
    await requireUser(req, _res, next);
    return;
  }
  const device = tryVerifyAccessToken(token, 'device');
  if (device) {
    await requireDevice(req, _res, next);
    return;
  }
  next(new AppError('UNAUTHORIZED', 'Invalid or expired token'));
}

export function ownerId(req: Request): string {
  const id = req.user?.sub ?? req.device?.uid;
  if (!id) throw new AppError('UNAUTHORIZED', 'No authenticated owner context');
  return id;
}

export function deviceId(req: Request): string {
  if (!req.device) throw new AppError('FORBIDDEN', 'Device credentials required for this operation');
  return req.device.sub;
}
