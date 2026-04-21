/**
 * Shared Upstash Redis client.
 *
 * Returns `null` when Upstash env vars are absent so callers can degrade
 * gracefully in local dev (no real-time, but nothing throws).
 */

import { Redis } from '@upstash/redis'

let _redis: Redis | null | undefined

export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  } else {
    _redis = null
  }
  return _redis
}

/** Event published by `audit()` and any other mutation surface. */
export interface LiveEvent {
  topic: string
  id?: string
  action: string
  at: string
  entity?: string
  entityId?: string
  staffId?: string
}

export const EVENTS_CHANNEL = 'abel:events'
export const EVENTS_LIST = 'abel:events:recent'
const MAX_RECENT = 200

/**
 * Publish a live event.
 *
 * Upstash's REST API doesn't support classic pub/sub, so we use two primitives:
 *   1. PUBLISH for any subscribers that do (EventSource pollers tail the list)
 *   2. LPUSH + LTRIM to keep a ring buffer of recent events
 *   3. SET on `abel:events:tick` so SSE clients can poll cheaply
 */
export async function publishEvent(evt: LiveEvent): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const payload = JSON.stringify(evt)
  try {
    // Fire all three in parallel; swallow errors — real-time is best-effort.
    await Promise.all([
      redis.lpush(EVENTS_LIST, payload),
      redis.ltrim(EVENTS_LIST, 0, MAX_RECENT - 1),
      redis.set('abel:events:tick', Date.now().toString()),
      // PUBLISH is a no-op on Upstash REST but harmless to call
      redis.publish?.(EVENTS_CHANNEL, payload).catch(() => {}),
    ])
  } catch {
    // best-effort
  }
}

/** Fetch last N events (most-recent first). */
export async function getRecentEvents(limit = 50): Promise<LiveEvent[]> {
  const redis = getRedis()
  if (!redis) return []
  try {
    const rows = await redis.lrange(EVENTS_LIST, 0, Math.max(0, limit - 1))
    return (rows as unknown as string[])
      .map((r) => {
        try { return typeof r === 'string' ? JSON.parse(r) : r } catch { return null }
      })
      .filter(Boolean) as LiveEvent[]
  } catch {
    return []
  }
}

/** Read the last event tick (ms epoch). */
export async function getEventTick(): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  try {
    const v = await redis.get<string | number>('abel:events:tick')
    if (v == null) return 0
    return typeof v === 'number' ? v : parseInt(String(v), 10) || 0
  } catch {
    return 0
  }
}
