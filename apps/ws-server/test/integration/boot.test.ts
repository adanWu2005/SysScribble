import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JWT_SECRET, ORIGIN, SUPABASE_URL, freePort, startRedis, until, type RedisInstance } from '../helpers/harness';

const ROOT = join(__dirname, '..', '..');

/** The other tests call createWsServer directly. This one runs what production runs. */
describe('real entry point', () => {
  let redis: RedisInstance;
  let child: ChildProcess | undefined;
  let output = '';
  let exited = false;

  beforeAll(async () => {
    redis = await startRedis();
  });

  afterAll(async () => {
    if (child && !exited) {
      const stopped = new Promise((resolve) => child?.once('exit', resolve));
      child.kill();
      await stopped;
    }
    await redis.stop();
  });

  function start(env: Record<string, string>): ChildProcess {
    // One process, not npx or the tsx CLI, because on Windows kill() does not reach grandchildren.
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    proc.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    proc.on('exit', () => (exited = true));
    return proc;
  }

  it('boots with a valid environment and serves health checks', async () => {
    const port = await freePort();
    child = start({
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      REDIS_URL: redis.url,
      ALLOWED_ORIGINS: ORIGIN,
    });
    await until(() => output.includes('ws-server listening') || exited, 20_000, 'server start');
    expect(exited, output).toBe(false);

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    const refused = await fetch(`http://127.0.0.1:${port}/anything`);
    expect(refused.status).toBe(404);
  }, 30_000);
});
