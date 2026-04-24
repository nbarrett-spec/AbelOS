/**
 * GET /api/ops/nuc/status
 *
 * DB-backed NUC status for the executive dashboard. Returns the latest
 * heartbeat(s) from the NucHeartbeat table — populated by the NUC's
 * push-based heartbeat cron (POST /api/v1/engine/heartbeat).
 *
 * This replaces the old pull-based /api/integrations/nuc/health which
 * tried to reach the NUC's Tailscale IP directly (fails on Vercel).
 *
 * Auth: staff session (checkStaffAuth).
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     nodes: [{
 *       nodeId, nodeRole, engineVersion, status, moduleStatus,
 *       latencyMs, uptimeSeconds, errorCount, lastScanAt, receivedAt,
 *       staleSeconds, isStale
 *     }],
 *     coordinator: { ... } | null,      // shortcut to the coordinator node
 *     checkedAt: string
 *   }
 *
 * A heartbeat is considered "stale" if receivedAt > 180s ago (3 missed ticks).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

const STALE_THRESHOLD_S = 180 // 3 missed 60s heartbeats

interface HeartbeatRow {
  nodeId: string
  nodeRole: string
  engineVersion: string | null
  status: string
  moduleStatus: any
  latencyMs: number | null
  uptimeSeconds: number | null
  errorCount: number | null
  lastScanAt: Date | null
  meta: any
  receivedAt: Date
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows: HeartbeatRow[] = await prisma.$queryRawUnsafe(
      `SELECT "nodeId", "nodeRole", "engineVersion", "status",
              "moduleStatus", "latencyMs", "uptimeSeconds", "errorCount",
              "lastScanAt", "meta", "receivedAt"
       FROM "NucHeartbeat"
       ORDER BY "receivedAt" DESC
       LIMIT 20`
    )

    const now = Date.now()
    const nodes = rows.map((r) => {
      const staleSeconds = Math.round((now - new Date(r.receivedAt).getTime()) / 1000)
      return {
        nodeId: r.nodeId,
        nodeRole: r.nodeRole,
        engineVersion: r.engineVersion,
        status: r.status,
        moduleStatus: r.moduleStatus,
        latencyMs: r.latencyMs,
        uptimeSeconds: r.uptimeSeconds,
        errorCount: r.errorCount,
        lastScanAt: r.lastScanAt ? new Date(r.lastScanAt).toISOString() : null,
        receivedAt: new Date(r.receivedAt).toISOString(),
        staleSeconds,
        isStale: staleSeconds > STALE_THRESHOLD_S,
      }
    })

    const coordinator = nodes.find((n) => n.nodeRole === 'coordinator') || null

    // Determine overall ok: coordinator exists, is not stale, and reports online
    const ok = coordinator
      ? !coordinator.isStale && coordinator.status === 'online'
      : false

    return NextResponse.json({
      ok,
      nodes,
      coordinator,
      checkedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    // Table might not exist yet — return graceful offline
    console.error('[GET /api/ops/nuc/status] error', err)
    return NextResponse.json({
      ok: false,
      nodes: [],
      coordinator: null,
      error: 'NucHeartbeat table not found or query failed',
      checkedAt: new Date().toISOString(),
    })
  }
}
