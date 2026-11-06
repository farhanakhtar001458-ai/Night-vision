import { createServer } from 'node:http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';
import { runMigrations } from './database/migrate.js';
import { closePool, query } from './database/pool.js';
import { closeCache } from './store/cache.js';
import { attachWebSocketServer, shutdownWebSocketServer } from './websocket/server.js';
import { startFanoutListener, stopFanoutListener, verifiedOnline } from './realtime/hub.js';
import { ensureStorageDirs } from './files/storage.js';
import { expireStaleConnections } from './connections/service.js';
import { purgeExpired } from './files/service.js';

async function main(): Promise<void> {
  await ensureStorageDirs();
  const applied = await runMigrations();
  if (applied.length) logger.info({ applied }, 'database migrated');
  await startFanoutListener();

  const app = createApp();
  const server = createServer(app);
  attachWebSocketServer(server);

  const maintenance = setInterval(() => {
    void (async () => {
      try {
        const expired = await expireStaleConnections();
        if (expired) logger.info({ expired }, 'expired stale connection requests');
        const purged = await purgeExpired();
        if (purged) logger.info({ purged }, 'purged expired relay files');
        // Reconcile presence: a device is only online while its authenticated socket is live.
        const devices = await query<{ id: string }>(`SELECT id FROM devices WHERE online = true`);
        for (const device of devices.rows) {
          if (!(await verifiedOnline(device.id))) {
            await query('UPDATE devices SET online = false WHERE id = $1', [device.id]);
          }
        }
      } catch (err) {
        logger.error({ err }, 'maintenance task failed');
      }
    })();
  }, 60_000);
  maintenance.unref?.();

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, ws: '/ws' }, 'DroidLink X backend listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(maintenance);
    shutdownWebSocketServer();
    server.close(() => {
      void (async () => {
        await stopFanoutListener();
        await closeCache();
        await closePool();
        process.exit(0);
      })();
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
