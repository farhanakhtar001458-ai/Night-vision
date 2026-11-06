import { assertConfig, loadConfig } from './config.js';
import { TokenVerifier } from './auth.js';
import { SupabaseDirectory, SupabaseRest } from './supabase.js';
import { startSignalingServer } from './server.js';

const config = loadConfig();
assertConfig(config);

const rest = new SupabaseRest(config);
const directory = new SupabaseDirectory(rest);
const verifier = new TokenVerifier(config, directory);

const signaling = startSignalingServer({ config, verifier, directory });

const shutdown = async (signal: string): Promise<void> => {
  console.info(`[signaling] ${signal} received, draining connections`);
  await signaling.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
