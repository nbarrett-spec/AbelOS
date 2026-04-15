/**
 * Rate limiter for API routes.
 *
 * Uses Upstash Redis (@upstash/ratelimit) in production for shared state
 * across serverless instances. Falls back to an in-memory Map when
 * UPSTASH_REDIS_REST_URL is not set (local dev).
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 30 })
 *   // In your route handler:
 *   const ip = request.headers.get('x-forwarded-for') || 'unknown'
 *   const { success, remaining, resetIn } = await limiter.check(ip)
 *   if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ── Upstash Redis client (null when env vars are absent) ─────────────
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null

// ── Shared interfaces (unchanged) ───────────────────────────────────

interface RateLimiterOptions {
  /** Time window in milliseconds */
  windowMs: number
  /** Max requests per window */
  max: number
}

interface RateLimitResult {
  success: boolean
  remaining: number
  /** Milliseconds until the oldest request expires */
  resetIn: number
}

interface RateLimiter {
  check: (key: string) => Promise<RateLimitResult>
}

// ── In-memory fallback (local dev) ──────────────────────────────────

const store = new Map<string, number[]>()

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, timestamps] of store.entries()) {
      const valid = timestamps.filter(t => now - t < 300_000)
      if (valid.length === 0) {
        store.delete(key)
      } else {
        store.set(key, valid)
      }
    }
  }, 300_000)
}

function createInMemoryLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max } = options
  startCleanup()

  return {
    async check(key: string): Promise<RateLimitResult> {
      const now = Date.now()
      const timestamps = store.get(key) || []
      const valid = timestamps.filter(t => now - t < windowMs)

      if (valid.length >= max) {
        const oldest = valid[0]
        return {
          success: false,
          remaining: 0,
          resetIn: windowMs - (now - oldest),
        }
      }

      valid.push(now)
      store.set(key, valid)

      return {
        success: true,
        remaining: max - valid.length,
        resetIn: windowMs - (now - valid[0]),
      }
    },
  }
}

// ── Upstash-backed limiter ──────────────────────────────────────────

function createUpstashLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max } = options

  // Sliding window: `max` requests per `windowMs` milliseconds.
  // The prefix scopes keys so different limiters don't collide.
  const limiter = new Ratelimit({
    redis: redis!,
    limiter: Ratelimit.slidingWindow(max, `${windowMs} ms`),
    prefix: `rl:${windowMs}:${max}`,
  })

  return {
    async check(key: string): Promise<RateLimitResult> {
      const result = await limiter.limit(key)
      return {
        success: result.success,
        remaining: result.remaining,
        resetIn: Math.max(result.reset - Date.now(), 0),
      }
    },
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  if (redis) {
    return createUpstashLimiter(options)
  }
  return createInMemoryLimiter(options)
}

// ── Pre-built limiters ──────────────────────────────────────────────

export const authLimiter = createRateLimiter({ windowMs: 60_000, max: 10 })    // 10 login attempts/min
export const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 60 })     // 60 requests/min
export const syncLimiter = createRateLimiter({ windowMs: 300_000, max: 5 })    // 5 syncs per 5 min
export const publicFormLimiter = createRateLimiter({ windowMs: 60_000, max: 5 })  // 5 form submits/min
export const oauthLimiter = createRateLimiter({ windowMs: 60_000, max: 30 })   // 30 token mints/min
export const tokenEndpointLimiter = createRateLimiter({ windowMs: 60_000, max: 20 }) // 20 lookups/min

// ── Headers helper (unchanged) ──────────────────────────────────────

export function getRateLimitHeaders(result: RateLimitResult, max: number) {
  return {
    'X-RateLimit-Limit': String(max),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetIn / 1000)),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Convenience wrapper for route handlers
//
// Example:
//   const limited = await checkRateLimit(request, authLimiter, 10, 'login')
//   if (limited) return limited
// ──────────────────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function getClientKey(request: NextRequest, suffix?: string): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  return suffix ? `${ip}:${suffix}` : ip
}

/**
 * One-call rate limit check. Returns a NextResponse if the limit is exceeded,
 * or null if the request is allowed through.
 */
export async function checkRateLimit(
  request: NextRequest,
  limiter: RateLimiter,
  max: number,
  keySuffix?: string
): Promise<NextResponse | null> {
  const key = getClientKey(request, keySuffix)
  const result = await limiter.check(key)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: getRateLimitHeaders(result, max) }
    )
  }
  return null
}
