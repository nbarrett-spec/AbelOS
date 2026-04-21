/**
 * /api/presence — lightweight "who else is here" tracking.
 *
 * Transport: lazy polling (no websocket server required). Clients POST a
 * heartbeat every ~30s, and GET the active viewer list for a resource.
 * Records are bucketed per-resource with a 90s TTL so stale viewers age out
 * without a cleanup job.
 *
 * Storage:
 *   - Upstash Redis when configured (canonical)
 *   - Falls back to in-memory Map in local dev / when Upstash is absent
 *
 * Privacy: only staff sessions can POST. Returned user list only exposes
 * staffId, firstName+lastName, and seenAt — no email, no role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'
import { getRedis } from '@/lib/redis'

// ── Constants ─────────────────────────────────────────────────────────────
const TTL_SECONDS = 90
const MAX_VIEWERS_RETURNED = 12

// ── In-memory fallback store ─────────────────────────────────────────────
// Key: resource id → Map<staffId, { name, seenAt }>
const MEM: Map<string, Map<string, { name: string; seenAt: number }>> = new Map()

function memPrune(bucket: Map<string, { name: string; seenAt: number }>) {
  const cutoff = Date.now() - TTL_SECONDS * 1000
  for (const [k, v] of bucket.entries()) {
    if (v.seenAt < cutoff) bucket.delete(k)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────
function normalizeResource(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim().slice(0, 128)
  if (!s) return null
  // Very permissive — allow "order:abc123", "builder:xyz", etc.
  return s
}

function redisKey(resource: string): string {
  return `presence:${resource}`
}

// ── POST — heartbeat ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { resource?: string } = {}
  try { body = await req.json() } catch { /* empty body OK */ }
  const resource = normalizeResource(body.resource)
  if (!resource) return NextResponse.json({ error: 'missing resource' }, { status: 400 })

  const name = `${session.firstName ?? ''} ${session.lastName ?? ''}`.trim() || session.email
  const now = Date.now()
  const redis = getRedis()

  if (redis) {
    const key = redisKey(resource)
    await redis.hset(key, { [session.staffId]: JSON.stringify({ name, seenAt: now }) })
    await redis.expire(key, TTL_SECONDS)
  } else {
    let bucket = MEM.get(resource)
    if (!bucket) { bucket = new Map(); MEM.set(resource, bucket) }
    bucket.set(session.staffId, { name, seenAt: now })
    memPrune(bucket)
  }

  return NextResponse.json({ ok: true })
}

// ── GET — list viewers ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const resource = normalizeResource(req.nextUrl.searchParams.get('resource'))
  if (!resource) return NextResponse.json({ error: 'missing resource' }, { status: 400 })

  const now = Date.now()
  const cutoff = now - TTL_SECONDS * 1000
  const redis = getRedis()
  const out: Array<{ id: string; name: string; seenAt: string }> = []

  if (redis) {
    const key = redisKey(resource)
    const entries = (await redis.hgetall<Record<string, string>>(key)) ?? {}
    for (const [staffId, rawVal] of Object.entries(entries)) {
      try {
        // @upstash/redis returns parsed objects directly when stored as JSON strings.
        const parsed: { name: string; seenAt: number } =
          typeof rawVal === 'string' ? JSON.parse(rawVal) : (rawVal as any)
        if (!parsed || typeof parsed.seenAt !== 'number') continue
        if (parsed.seenAt < cutoff) continue
        // Exclude self so the bar only shows "others".
        if (staffId === session.staffId) continue
        out.push({ id: staffId, name: parsed.name, seenAt: new Date(parsed.seenAt).toISOString() })
      } catch { /* skip malformed */ }
    }
  } else {
    const bucket = MEM.get(resource)
    if (bucket) {
      memPrune(bucket)
      for (const [staffId, v] of bucket.entries()) {
        if (staffId === session.staffId) continue
        out.push({ id: staffId, name: v.name, seenAt: new Date(v.seenAt).toISOString() })
      }
    }
  }

  // Most recent first, clamp
  out.sort((a, b) => b.seenAt.localeCompare(a.seenAt))
  return NextResponse.json({ users: out.slice(0, MAX_VIEWERS_RETURNED) })
}
