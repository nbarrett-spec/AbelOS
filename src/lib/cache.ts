/**
 * Lightweight read-through cache built on the shared Upstash Redis client.
 *
 * Behavior:
 *  - If Redis is not configured (local dev), `cached()` is a pass-through:
 *    it just calls `fn()`. No throws, no surprises.
 *  - All Redis errors are swallowed so a Redis blip can never break a request.
 *  - Default policy: rely on TTL expiry for staleness — we do NOT bust on writes.
 *    The 30-120s lag is acceptable for the KPIs we cache and avoids the complexity
 *    of fanning invalidations out from every mutation surface. If a specific
 *    endpoint needs sub-second freshness, do not wrap it in `cached()`.
 *
 * Usage:
 *   const data = await cached(`payments:aging:${dateFrom}:${dateTo}`, 60, async () => {
 *     return await prisma.$queryRawUnsafe(...)
 *   })
 */

import { getRedis } from './redis'

/**
 * Read-through cache. Returns cached value if present, otherwise computes
 * via `fn()`, stores with TTL, and returns the fresh value.
 *
 * - `key` should encode all filter params so different queries don't collide.
 * - `ttlSeconds` is the cache lifetime. Pick based on staleness tolerance.
 *   30s for fast-moving dashboards, 60s for KPIs, 120s+ for catalogs.
 * - `fn` is the expensive operation (DB query, aggregation, etc).
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const redis = getRedis()
  if (!redis) return fn()

  try {
    const hit = await redis.get<T>(key)
    if (hit !== null && hit !== undefined) return hit as T
  } catch {
    // Cache read failed — fall through to the source of truth.
  }

  const result = await fn()

  // Fire-and-forget the write. Don't block the response on cache fill,
  // and never surface a cache write error to the caller.
  try {
    await redis.setex(key, ttlSeconds, result as unknown as string).catch(() => {})
  } catch {
    // best-effort
  }

  return result
}

/**
 * Best-effort cache bust. Pass an exact key to delete, or use the wildcard
 * variant via `bustPrefix` if you need pattern matching.
 *
 * Returns the number of keys deleted (0 if Redis is unavailable or the key
 * didn't exist). Errors are swallowed.
 */
export async function bust(key: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  try {
    const n = await redis.del(key)
    return typeof n === 'number' ? n : 0
  } catch {
    return 0
  }
}

/**
 * Delete every key matching a prefix (uses SCAN under the hood).
 * Use sparingly — prefer exact-key `bust()` when you can.
 *
 * Note: Upstash REST does not stream SCAN cursors as cheaply as native Redis,
 * so do not call this in a hot path.
 */
export async function bustPrefix(prefix: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  try {
    let cursor = 0
    let total = 0
    const pattern = `${prefix}*`
    do {
      // Upstash returns [cursor, keys[]]; type its result loosely and coerce.
      const result = (await redis.scan(cursor, { match: pattern, count: 200 })) as unknown as [
        number | string,
        string[],
      ]
      const next = result[0]
      const keys = result[1]
      cursor = typeof next === 'number' ? next : parseInt(String(next), 10) || 0
      if (keys && keys.length > 0) {
        const n = await redis.del(...keys)
        total += typeof n === 'number' ? n : 0
      }
    } while (cursor !== 0)
    return total
  } catch {
    return 0
  }
}
