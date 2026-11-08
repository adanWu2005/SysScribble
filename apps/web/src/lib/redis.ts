import 'server-only';
import { Redis } from '@upstash/redis';
import { getServerEnv } from '@/lib/env.server';

let redis: Redis | null = null;

/** Upstash REST client — used for PUBLISH (control events) and rate limiting. */
export function getRedis(): Redis {
  if (redis) return redis;
  const env = getServerEnv();
  redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}
