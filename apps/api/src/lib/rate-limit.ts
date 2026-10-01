import type { Redis } from "ioredis";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
}

/**
 * Fixed window counter: INCR, and start the TTL only on the window's first hit. Simple and
 * cheap (one round trip); a burst at a window edge can reach 2x the limit, acceptable for
 * a cost guard. Per-plan limits for the whole product come with billing (Week 5).
 */
export function createRedisRateLimiter(
  redis: Redis,
  options: { prefix: string; limit: number; windowSeconds: number },
): RateLimiter {
  return {
    async consume(key) {
      const redisKey = `${options.prefix}:ratelimit:${key}`;
      const results = await redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, options.windowSeconds, "NX")
        .ttl(redisKey)
        .exec();
      const count = Number(results?.[0]?.[1]);
      const ttl = Number(results?.[2]?.[1]);
      if (!Number.isFinite(count)) throw new Error("Rate limiter: unexpected Redis reply");
      return {
        allowed: count <= options.limit,
        retryAfterSeconds: ttl > 0 ? ttl : options.windowSeconds,
      };
    },
  };
}
