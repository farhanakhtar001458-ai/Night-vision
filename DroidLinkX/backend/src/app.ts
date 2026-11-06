import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './auth/routes.js';
import { devicesRouter } from './devices/routes.js';
import { sessionsRouter } from './sessions/routes.js';
import { connectionsRouter } from './connections/routes.js';
import { filesRouter } from './files/routes.js';
import { transfersRouter } from './transfers/routes.js';
import { notificationsRouter, clipboardRouter } from './notifications/routes.js';
import { activityRouter } from './activity/routes.js';
import { signalingRouter } from './signaling/routes.js';
import { publicConfig } from './connections/service.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: false,
      exposedHeaders: ['X-Content-Sha256', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      maxAge: 600,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && incoming.length <= 100 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
          requestId: req.requestId,
          ip: req.ip,
        },
        'http request',
      );
    });
    next();
  });

  // JSON for everything except the raw chunk/upload pipelines, which declare their own parsers.
  app.use((req, res, next) => {
    const isRaw = req.path.startsWith('/api/files/upload') || /^\/api\/transfers\/[^/]+\/items\/\d+\/chunks\//.test(req.path);
    if (isRaw) return next();
    return express.json({ limit: '1mb' })(req, res, next);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'droidlinkx-backend', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get('/api/health', async (_req, res) => {
    const { pool } = await import('./database/pool.js');
    const { socketCount } = await import('./realtime/hub.js');
    let database = 'down';
    try {
      await pool.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    res.status(database === 'up' ? 200 : 503).json({
      status: database === 'up' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      database,
      liveSockets: socketCount(),
      webrtc: publicConfig(),
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/connections', connectionsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/transfers', transfersRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/clipboard', clipboardRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/signaling', signalingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
