import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'droidlinkx-backend' },
  redact: {
    paths: ['req.headers.authorization', 'headers.authorization', 'password', '*.password', '*.secret', 'token'],
    remove: true,
  },
  transport: env.isProd || env.isTest ? undefined : { target: 'pino/file', options: { destination: 1 } },
});
