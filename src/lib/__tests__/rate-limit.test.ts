/**
 * Smoke tests for rate-limit module.
 *
 * Tests the in-memory limiter (no Redis needed). Verifies:
 * - Requests within the limit succeed
 * - Requests over the limit are rejected
 * - Window expiry resets the counter
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Ensure Upstash isn't loaded — we test the in-memory path
vi.stubEnv('UPSTASH_REDIS_REST_URL', '')

import { createRateLimiter } from '../rate-limit'

describe('in-memory rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests within the limit', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 })

    const r1 = await limiter.check('user-a')
    expect(r1.success).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = await limiter.check('user-a')
    expect(r2.success).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = await limiter.check('user-a')
    expect(r3.success).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('rejects requests over the limit', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })

    await limiter.check('user-b')
    await limiter.check('user-b')

    const r3 = await limiter.check('user-b')
    expect(r3.success).toBe(false)
    expect(r3.remaining).toBe(0)
    expect(r3.resetIn).toBeGreaterThan(0)
  })

  it('tracks different keys independently', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })

    const a = await limiter.check('user-x')
    const b = await limiter.check('user-y')
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)

    // Both are now at their limit
    expect((await limiter.check('user-x')).success).toBe(false)
    expect((await limiter.check('user-y')).success).toBe(false)
  })

  it('resets after the window expires', async () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 })

    await limiter.check('user-c')
    expect((await limiter.check('user-c')).success).toBe(false)

    // Advance past the window
    vi.advanceTimersByTime(11_000)

    const after = await limiter.check('user-c')
    expect(after.success).toBe(true)
  })
})
