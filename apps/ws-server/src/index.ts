import { createSupabaseJwtVerifier } from '@wb/shared/server';
import { loadEnv } from './env';
import { createLogger } from './logger';
import { SupabaseRoleStore, SupabaseSnapshotStore, createAdminClient } from './persistence/supabaseStores';
import { RedisBus } from './redis/bus';
import { createWsServer } from './server';

function portFromArgs(fallback: number): number {
  const index = process.argv.indexOf('--port');
  const value = index >= 0 ? Number(process.argv[index + 1]) : Number.NaN;
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL);
const admin = createAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const server = createWsServer({
  allowedOrigins: env.ALLOWED_ORIGINS,
  verifyJwt: createSupabaseJwtVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET }),
  bus: new RedisBus(env.REDIS_URL, log),
  snapshots: new SupabaseSnapshotStore(admin),
  roles: new SupabaseRoleStore(admin),
  log,
});

const port = await server.listen(portFromArgs(env.PORT), env.HOST);
log.info({ port }, 'ws-server listening');

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down, flushing rooms');
  await server.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
