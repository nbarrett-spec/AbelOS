export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { getRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { getStaffFromHeaders } from '@/lib/audit'

// Hashed-set key per path → staffId → { name, lastSeen }
function pathKey(path: string) {
  return `presence:path:${path}`
}
const TTL_SECONDS = 60
const STALE_MS = 60_000

type PresenceEntry = {
  staffId: string
  name: string
  at: number
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/presence — client pings every 30s while viewing a page
// Body: { path: string }
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const path: string | undefined = body?.path
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'path required' }, { status: 400 })
    }

    const { staffId, staffName } = getStaffFromHeaders(request.headers)
    const redis = getRedis()
    if (!redis) {
      // Local dev: accept but don't persist
      return NextResponse.json({ ok: true, degraded: true })
    }

    const entry: PresenceEntry = {
      staffId,
      name: staffName,
      at: Date.now(),
    }
    await redis.hset(pathKey(path), { [staffId]: JSON.stringify(entry) })
    await redis.expire(pathKey(path), TTL_SECONDS * 3) // auto-clean stale keys

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/presence?path=/ops/orders/abc
// Returns active staff viewing the page (lastSeen < 60s ago)
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const path = request.nextUrl.searchParams.get('path')
    if (!path) {
      return NextResponse.json({ error: 'path required' }, { status: 400 })
    }

    const redis = getRedis()
    if (!redis) {
      return NextResponse.json({ viewers: [] })
    }

    const raw = (await redis.hgetall(pathKey(path))) as Record<string, string> | null
    const now = Date.now()
    const entries: PresenceEntry[] = []
    if (raw) {
      for (const [, v] of Object.entries(raw)) {
        try {
          const parsed = typeof v === 'string' ? JSON.parse(v) : (v as any)
          if (parsed?.at && now - Number(parsed.at) < STALE_MS) entries.push(parsed)
        } catch {}
      }
    }

    if (entries.length === 0) return NextResponse.json({ viewers: [] })

    // Enrich with avatar-initials-ready data. Optionally look up headshots.
    const ids = entries.map((e) => e.staffId)
    let headshots: Record<string, string | null> = {}
    try {
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT "id", "headshotUrl" FROM "Staff" WHERE "id" = ANY($1::text[])`,
        ids
      )) as Array<{ id: string; headshotUrl: string | null }>
      headshots = Object.fromEntries(rows.map((r) => [r.id, r.headshotUrl]))
    } catch {
      // headshotUrl column may not exist — safe to skip
    }

    const viewers = entries
      .sort((a, b) => b.at - a.at)
      .map((e) => ({
        staffId: e.staffId,
        name: e.name,
        avatar: headshots[e.staffId] || null,
        lastSeen: new Date(e.at).toISOString(),
      }))

    return NextResponse.json({ viewers })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
