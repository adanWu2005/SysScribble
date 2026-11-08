import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { RATE_LIMITS, type RateLimitKey } from '@wb/shared';
import { ApiError } from '@/lib/api';
import { getRedis } from '@/lib/redis';

const limiters = new Map<RateLimitKey, Ratelimit>();

function limiterFor(key: RateLimitKey): Ratelimit {
  const existing = limiters.get(key);
  if (existing) return existing;
  const { limit, window } = RATE_LIMITS[key];
  const created = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `rl:${key}`,
  });
  limiters.set(key, created);
  return created;
}

/**
 * Sliding-window limit per user (PRD §5.6). Fails closed: these routes spend real money,
 * so if the limiter is unreachable the request is refused rather than let through.
 */
export async function enforceRateLimit(key: RateLimitKey, userId: string): Promise<void> {
  let result: { success: boolean; reset: number };
  try {
    result = await limiterFor(key).limit(userId);
  } catch (err) {
    console.error('[ratelimit] unavailable', key, err instanceof Error ? err.message : err);
    throw new ApiError(503, 'UNAVAILABLE', 'Temporarily unavailable, please try again');
  }
  if (!result.success) {
    const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests, please slow down', { retryAfterSec });
  }
}
