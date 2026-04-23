/**
 * GET /api/v1/engine/inbox/patterns?since=<ISO>&limit=<n>
 *
 * Aggregated behavioral signal for the NUC brain — "how is the ops team
 * actually handling inbox work?" Aggregates across resolved items over the
 * provided window and returns:
 *
 *   - perType[]:
 *       { type, resolvedCount, resolutionTimeMs: { p50, p75, p90, p95 },
 *         commonResolutions: [{ result, count }],
 *         fastestResolvers:  [{ staffId, name, medianMs, resolvedCount }] }
 *   - escalatedItems[]: items with >1 escalation event recorded in AuditLog.
 *       (Escalation = AuditLog.action ILIKE '%ESCAL%' on an InboxItem.)
 *
 * The `since` param is required-ish — if omitted we default to the last 30
 * days so a broken coordinator can't inadvertently scan the whole table.
 *
 * Auth: Bearer ENGINE_BRIDGE_TOKEN via verifyEngineToken().
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_DAYS = 30
const MAX_ESCALATED_ITEMS = 100
const TOP_RESOLUTIONS_PER_TYPE = 5
const TOP_FAST_RESOLVERS_PER_TYPE = 5
// Minimum sample size before we trust a staffer's median for "fastest" — below
// this we'd be ranking lucky one-offs, not real behavior.
const MIN_RESOLUTIONS_FOR_FAST_RANK = 3

function pickPercentile(sortedAsc: number[], pct: number): number | null {
  if (sortedAsc.length === 0) return null
  if (sortedAsc.length === 1) return sortedAsc[0]
  // Nearest-rank method; good enough for an ops signal and avoids fractional
  // interpolation on tiny samples where it would be misleading.
  const rank = Math.ceil((pct / 100) * sortedAsc.length)
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))
  return sortedAsc[idx]
}

function median(sortedAsc: number[]): number | null {
  if (sortedAsc.length === 0) return null
  const mid = Math.floor(sortedAsc.length / 2)
  if (sortedAsc.length % 2 === 1) return sortedAsc[mid]
  return Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2)
}

// Normalize a resolution `result` JSON blob into a stable key we can count.
// The NUC sees strings like "APPROVE:vendor_swap" more usefully than whole
// payload blobs. Fall back to aegisStatus if result is empty.
function resolutionKey(row: {
  result: unknown
  aegisStatus: string | null
}): string {
  const r = row.result
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const obj = r as Record<string, any>
    const primary =
      (typeof obj.action === 'string' && obj.action) ||
      (typeof obj.decision === 'string' && obj.decision) ||
      (typeof obj.outcome === 'string' && obj.outcome) ||
      (typeof obj.resolution === 'string' && obj.resolution) ||
      null
    const qualifier =
      (typeof obj.reason === 'string' && obj.reason) ||
      (typeof obj.reasonCode === 'string' && obj.reasonCode) ||
      (typeof obj.subtype === 'string' && obj.subtype) ||
      null
    if (primary && qualifier) return `${primary}:${qualifier}`
    if (primary) return primary
  }
  if (typeof r === 'string' && r.length > 0 && r.length <= 80) return r
  return row.aegisStatus || 'UNKNOWN'
}

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const sinceRaw = url.searchParams.get('since')
  let since: Date
  if (sinceRaw) {
    const parsed = new Date(sinceRaw)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'bad_request', message: "'since' must be a valid ISO-8601 timestamp" },
        { status: 400 }
      )
    }
    since = parsed
  } else {
    since = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  }

  try {
    // ── Pull every resolved item in the window. We fetch only the columns
    // we need, not the full actionData blob. ──
    const resolved = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         i."id",
         i."type",
         i."source",
         i."status"       AS "aegisStatus",
         i."result",
         i."resolvedBy",
         i."resolvedAt",
         i."createdAt",
         s."firstName"    AS "resolverFirstName",
         s."lastName"     AS "resolverLastName",
         s."role"::text   AS "resolverRole"
       FROM "InboxItem" i
       LEFT JOIN "Staff" s ON s."id" = i."resolvedBy"
       WHERE i."resolvedAt" IS NOT NULL
         AND i."resolvedAt" >= $1
       ORDER BY i."resolvedAt" DESC`,
      since
    )

    // ── Bucket by type and compute per-type aggregates. ──
    const byType = new Map<
      string,
      {
        type: string
        resolvedCount: number
        durations: number[]
        resolutionCounts: Map<string, number>
        // staffId -> durations + display name
        perResolver: Map<
          string,
          { staffId: string; name: string; role: string | null; durations: number[] }
        >
      }
    >()

    for (const r of resolved) {
      const type = r.type || 'UNKNOWN'
      if (!byType.has(type)) {
        byType.set(type, {
          type,
          resolvedCount: 0,
          durations: [],
          resolutionCounts: new Map<string, number>(),
          perResolver: new Map(),
        })
      }
      const bucket = byType.get(type)!
      bucket.resolvedCount += 1

      // Resolution time
      const created = r.createdAt ? new Date(r.createdAt) : null
      const resolvedAt = r.resolvedAt ? new Date(r.resolvedAt) : null
      const durationMs =
        created && resolvedAt ? Math.max(0, resolvedAt.getTime() - created.getTime()) : null
      if (durationMs !== null) {
        bucket.durations.push(durationMs)
      }

      // Resolution key frequencies
      const key = resolutionKey({ result: r.result, aegisStatus: r.aegisStatus })
      bucket.resolutionCounts.set(key, (bucket.resolutionCounts.get(key) || 0) + 1)

      // Per-resolver durations (for fastest-resolver ranking)
      if (r.resolvedBy && durationMs !== null) {
        const name =
          [r.resolverFirstName, r.resolverLastName].filter(Boolean).join(' ').trim() ||
          r.resolvedBy
        const prior = bucket.perResolver.get(r.resolvedBy)
        if (prior) {
          prior.durations.push(durationMs)
        } else {
          bucket.perResolver.set(r.resolvedBy, {
            staffId: r.resolvedBy,
            name,
            role: r.resolverRole || null,
            durations: [durationMs],
          })
        }
      }
    }

    // ── Assemble perType output. ──
    const perType = Array.from(byType.values())
      .map((b) => {
        const sortedDurations = [...b.durations].sort((a, c) => a - c)
        const commonResolutions = Array.from(b.resolutionCounts.entries())
          .map(([result, count]) => ({ result, count }))
          .sort((a, c) => c.count - a.count)
          .slice(0, TOP_RESOLUTIONS_PER_TYPE)

        const fastestResolvers = Array.from(b.perResolver.values())
          .filter((r) => r.durations.length >= MIN_RESOLUTIONS_FOR_FAST_RANK)
          .map((r) => {
            const sorted = [...r.durations].sort((a, c) => a - c)
            return {
              staffId: r.staffId,
              name: r.name,
              role: r.role,
              resolvedCount: r.durations.length,
              medianMs: median(sorted),
            }
          })
          .sort((a, c) => (a.medianMs ?? Infinity) - (c.medianMs ?? Infinity))
          .slice(0, TOP_FAST_RESOLVERS_PER_TYPE)

        return {
          type: b.type,
          resolvedCount: b.resolvedCount,
          resolutionTimeMs: {
            p50: pickPercentile(sortedDurations, 50),
            p75: pickPercentile(sortedDurations, 75),
            p90: pickPercentile(sortedDurations, 90),
            p95: pickPercentile(sortedDurations, 95),
          },
          commonResolutions,
          fastestResolvers,
        }
      })
      .sort((a, c) => c.resolvedCount - a.resolvedCount)

    // ── Items with >1 escalation event inside the window. ──
    // Counts AuditLog rows whose action name contains "ESCAL" (matches
    // ESCALATE, ESCALATED, ESCALATION, escalate_to_manager, etc.). We keep
    // this generous because escalation action strings aren't standardized
    // across Aegis yet; the >1 threshold filters the noise.
    let escalatedItems: any[] = []
    try {
      const escalRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
           a."entityId"               AS "inboxItemId",
           COUNT(*)::int              AS "escalationCount",
           MIN(a."createdAt")         AS "firstEscalationAt",
           MAX(a."createdAt")         AS "lastEscalationAt",
           i."type",
           i."source",
           i."title",
           i."priority",
           i."status"::text           AS "aegisStatus",
           i."assignedTo",
           i."resolvedBy",
           i."resolvedAt",
           i."createdAt"              AS "itemCreatedAt"
         FROM "AuditLog" a
         JOIN "InboxItem" i ON i."id" = a."entityId"
         WHERE a."entity" = 'InboxItem'
           AND a."action" ILIKE '%ESCAL%'
           AND a."createdAt" >= $1
         GROUP BY a."entityId", i."type", i."source", i."title", i."priority",
                  i."status", i."assignedTo", i."resolvedBy", i."resolvedAt",
                  i."createdAt"
         HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC, MAX(a."createdAt") DESC
         LIMIT $2`,
        since,
        MAX_ESCALATED_ITEMS
      )
      escalatedItems = escalRows.map((r) => ({
        inboxItemId: r.inboxItemId,
        type: r.type,
        source: r.source,
        title: r.title,
        priority: r.priority,
        aegisStatus: r.aegisStatus,
        escalationCount: r.escalationCount,
        firstEscalationAt: r.firstEscalationAt,
        lastEscalationAt: r.lastEscalationAt,
        assignedTo: r.assignedTo,
        resolvedBy: r.resolvedBy,
        resolvedAt: r.resolvedAt,
        createdAt: r.itemCreatedAt,
      }))
    } catch {
      // AuditLog may not exist in every environment; return empty rather than 500.
      escalatedItems = []
    }

    return NextResponse.json({
      ok: true,
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      totals: {
        resolvedItems: resolved.length,
        types: perType.length,
        escalatedItems: escalatedItems.length,
      },
      perType,
      escalatedItems,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: String(e?.message || e) },
      { status: 500 }
    )
  }
}
