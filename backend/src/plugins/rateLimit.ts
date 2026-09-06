import { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../infra';

// Redis-backed rate limiting (spec §4.7), layered on top of credits so a
// single workspace can't burst through the LLM provider's own rate limit
// and degrade things for other tenants.
//
// Uses a fixed window via INCR + EXPIRE: two commands, no Lua, and good
// enough for this purpose. A sliding window would be smoother but needs a
// sorted set per key and more round trips.

export function rateLimit(options: { limit: number; windowSeconds: number; key: string }) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    // Per-user where authenticated, per-IP otherwise.
    const identity = request.user?.sub ?? request.ip;
    const redisKey = `ratelimit:${options.key}:${identity}`;

    try {
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, options.windowSeconds);

      if (count > options.limit) {
        const ttl = await redis.ttl(redisKey);
        reply.header('Retry-After', Math.max(ttl, 1));
        return reply.code(429).send({
          error: `Too many requests. Try again in ${Math.max(ttl, 1)} seconds.`,
        });
      }

      reply.header('X-RateLimit-Limit', options.limit);
      reply.header('X-RateLimit-Remaining', Math.max(options.limit - count, 0));
    } catch (err) {
      // Redis being down should not take the API down with it — log and
      // allow the request through rather than failing closed on a
      // non-security control.
      request.log.warn({ err }, 'rate limiter unavailable, allowing request');
    }
  };
}
