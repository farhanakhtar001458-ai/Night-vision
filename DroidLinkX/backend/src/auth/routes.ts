import { Router } from 'express';
import { z } from 'zod';
import { body } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireUser } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import * as authService from './service.js';
import { query } from '../database/pool.js';

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v), 'Password must contain a letter')
  .refine((v) => /\d/.test(v), 'Password must contain a number');

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: passwordSchema,
  displayName: z.string().min(2).max(80),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const refreshSchema = z.object({ refreshToken: z.string().min(20).max(500) });
const logoutSchema = z.object({ refreshToken: z.string().min(20).max(500).optional() });

const profileSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  settings: z.record(z.unknown()).optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const authRouter = Router();

authRouter.post(
  '/register',
  rateLimit({ name: 'auth:register', limit: 10, windowSeconds: 3600 }),
  asyncHandler(async (req, res) => {
    const payload = body(req, registerSchema);
    const result = await authService.register(payload, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  rateLimit({ name: 'auth:login', limit: 20, windowSeconds: 900 }),
  asyncHandler(async (req, res) => {
    const payload = body(req, loginSchema);
    const result = await authService.login(payload, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.json(result);
  }),
);

authRouter.post(
  '/refresh',
  rateLimit({ name: 'auth:refresh', limit: 120, windowSeconds: 900 }),
  asyncHandler(async (req, res) => {
    const payload = body(req, refreshSchema);
    const result = await authService.refresh(payload.refreshToken, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.json(result);
  }),
);

authRouter.post(
  '/logout',
  requireUser,
  asyncHandler(async (req, res) => {
    const payload = body(req, logoutSchema);
    await authService.logout({
      refreshToken: payload.refreshToken,
      userId: req.user!.sub,
      jti: req.user!.jti,
      ip: req.ip,
    });
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireUser,
  asyncHandler(async (req, res) => {
    const [user, counts] = await Promise.all([
      authService.getUser(req.user!.sub),
      query<{ devices: number; online: number }>(
        `SELECT count(*)::int AS devices,
                count(*) FILTER (WHERE online)::int AS online
           FROM devices WHERE user_id = $1 AND status = 'active'`,
        [req.user!.sub],
      ),
    ]);
    res.json({ user, counts: counts.rows[0] ?? { devices: 0, online: 0 } });
  }),
);

authRouter.patch(
  '/me',
  requireUser,
  asyncHandler(async (req, res) => {
    const payload = body(req, profileSchema);
    if (!payload.displayName && !payload.settings) throw new AppError('BAD_REQUEST', 'Nothing to update');
    const user = await authService.updateProfile(req.user!.sub, payload);
    res.json({ user });
  }),
);

authRouter.post(
  '/password',
  requireUser,
  rateLimit({ name: 'auth:password', limit: 10, windowSeconds: 3600 }),
  asyncHandler(async (req, res) => {
    const payload = body(req, passwordChangeSchema);
    await authService.changePassword(req.user!.sub, payload.currentPassword, payload.newPassword);
    res.status(204).send();
  }),
);
