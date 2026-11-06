import { Router } from 'express';
import { z } from 'zod';
import { querySchema } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async.js';
import { requireUser } from '../middleware/auth.js';
import { turnCredentials } from '../security/crypto.js';
import { publicConfig } from '../connections/service.js';
import { env } from '../config/env.js';

const iceQuery = z.object({ connectionId: z.string().uuid().optional() });

export const signalingRouter = Router();

/** Public ICE configuration (STUN always, TURN URLs when configured). No secrets leak here. */
signalingRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json(publicConfig());
  }),
);

/** Time-limited TURN credentials, bound to the authenticated owner. */
signalingRouter.get(
  '/turn',
  requireUser,
  asyncHandler(async (req, res) => {
    const { connectionId } = querySchema(req, iceQuery);
    const credentials = turnCredentials(`${req.user!.sub}:${connectionId ?? 'adhoc'}`);
    if (!credentials) {
      res.status(503).json({
        error: {
          code: 'NOT_CONFIGURED',
          message: 'TURN is not configured on this server. Direct peer-to-peer connections may fail behind strict NAT.',
        },
        turnConfigured: false,
        stunUrls: publicConfig().stunUrls,
        turnUrls: env.TURN_URLS,
      });
      return;
    }
    res.json(credentials);
  }),
);
