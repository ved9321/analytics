// Singletons for the three free, self-hostable pieces of infrastructure
// this project depends on: Postgres (via Prisma), Redis, and structured
// logging. Anthropic is the only paid dependency, and it lives entirely in
// src/modules/chat/llmProviderRouter.ts — nothing here talks to it.
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import pino from 'pino';
import { env } from './env';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export const logger = pino({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  enableOfflineQueue: false,
  retryStrategy: (attempt) => Math.min(30_000, Math.max(1_000, attempt * 2_000)),
});

let lastRedisErrorAt = 0;
redis.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorAt < 30_000) return;
  lastRedisErrorAt = now;
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Redis unavailable; rate limiting and scheduled jobs will retry');
});

// TTL guidance from the platform spec §4.3 — apply these once you add a
// caching layer in front of MetricEvent reads (not wired up yet in this
// scaffold; the demo data volumes are small enough that querying Postgres
// directly is fine for now).
export const CACHE_TTL_SECONDS = {
  dashboardTile: 60 * 15,
  historicalTrend: 60 * 60 * 24,
};
