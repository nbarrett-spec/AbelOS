export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { getRedis } from '@/lib/redis'
import { getStaffFromHeaders } from '@/lib/audit'

// Hashed-set per record → staffId → { isTyping, at }
function recordKey(recordType: string, recordId: string) {
  return `presence:record:${recordType}:${recordId}`
}
const TTL_SECONDS = 60

type ActivityEntry = {
  staffId: string
  name: string
  isTyping: boolean
  at: number
}

/**
 * POST /api/ops/presence/activity
 * Body: { recordId: string, recordType?: string, isTyping: boolean }
 *
 * Records active editing / typing state for a staffer on a specific record.
 * Used by PresenceAvatars to show the gold halo ring and three-dot typing dot.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const recordId: string | undefined = body?.recordId
    const recordType: string = body?.recordType || 'record'
    const isTyping: boolean = Boolean(body?.isTyping)

    if (!recordId) {
      return NextResponse.json({ error: 'recordId required' }, { status: 400 })
    }

    const { staffId, staffName } = getStaffFromHeaders(request.headers)
    const redis = getRedis()
    if (!redis) return NextResponse.json({ ok: true, degraded: true })

    const entry: ActivityEntry = {
      staffId,
      name: staffName,
      isTyping,
      at: Date.now(),
    }
    const key = recordKey(recordType, recordId)
    await redis.hset(key, { [staffId]: JSON.stringify(entry) })
    await redis.expire(key, TTL_SECONDS * 3)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}

/**
 * GET /api/ops/presence/activity?recordType=order&recordId=abc
 * Returns active editors on the record (within last 60s).
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const recordId = request.nextUrl.searchParams.get('recordId')
    const recordType = request.nextUrl.searchParams.get('recordType') || 'record'
    if (!recordId) {
      return NextResponse.json({ error: 'recordId required' }, { status: 400 })
    }

    const redis = getRedis()
    if (!redis) return NextResponse.json({ editors: [] })

    const key = recordKey(recordType, recordId)
    const raw = (await redis.hgetall(key)) as Record<string, string> | null
    const now = Date.now()
    const editors: ActivityEntry[] = []
    if (raw) {
      for (const [, v] of Object.entries(raw)) {
        try {
          const parsed = typeof v === 'string' ? JSON.parse(v) : (v as any)
          if (parsed?.at && now - Number(parsed.at) < TTL_SECONDS * 1000) editors.push(parsed)
        } catch {}
      }
    }

    return NextResponse.json({ editors })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
