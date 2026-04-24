/**
 * POST /api/v1/engine/heartbeat
 *
 * Push-based health reporting. The NUC coordinator (and eventually worker
 * NUCs) POST a health snapshot here every 60s. Aegis upserts into the
 * NucHeartbeat table so the executive dashboard can show NUC status without
 * needing to reach the Tailscale IP.
 *
 * Auth: ENGINE_BRIDGE_TOKEN bearer token (same as other /api/v1/engine/* routes).
 *
 * Body:
 *   {
 *     nodeId:          string       (required — e.g. "coordinator", "worker-sales-1")
 *     nodeRole?:       string       ("coordinator" | "worker")
 *     engineVersion?:  string
 *     status?:         string       ("online" | "degraded" | "error")
 *     moduleStatus?:   Record<string, "ok" | "degraded" | "error">
 *     latencyMs?:      number       (self-reported internal latency)
 *     uptimeSeconds?:  number
 *     errorCount?:     number
 *     lastScanAt?:     string       (ISO timestamp of last completed scan)
 *     meta?:           object       (arbitrary extra data)
 *   }
 *
 * Returns: { ok: true, receivedAt: string }
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const {
      nodeId,
      nodeRole = 'coordinator',
      engineVersion,
      status = 'online',
      moduleStatus,
      latencyMs,
      uptimeSeconds,
      errorCount,
      lastScanAt,
      meta,
    } = body

    if (!nodeId || typeof nodeId !== 'string') {
      return NextResponse.json(
        { error: 'nodeId is required and must be a string' },
        { status: 400 }
      )
    }

    const now = new Date()

    // Upsert: one row per nodeId, updated on each heartbeat tick.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "NucHeartbeat" (
        "id", "nodeId", "nodeRole", "engineVersion", "status",
        "moduleStatus", "latencyMs", "uptimeSeconds", "errorCount",
        "lastScanAt", "meta", "receivedAt", "createdAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4,
        $5::jsonb, $6, $7, $8,
        $9, $10::jsonb, $11, $11
      )
      ON CONFLICT ("nodeId") DO UPDATE SET
        "nodeRole"      = EXCLUDED."nodeRole",
        "engineVersion" = EXCLUDED."engineVersion",
        "status"        = EXCLUDED."status",
        "moduleStatus"  = EXCLUDED."moduleStatus",
        "latencyMs"     = EXCLUDED."latencyMs",
        "uptimeSeconds" = EXCLUDED."uptimeSeconds",
        "errorCount"    = EXCLUDED."errorCount",
        "lastScanAt"    = EXCLUDED."lastScanAt",
        "meta"          = EXCLUDED."meta",
        "receivedAt"    = EXCLUDED."receivedAt"`,
      nodeId,
      nodeRole,
      engineVersion || null,
      status,
      JSON.stringify(moduleStatus || {}),
      latencyMs != null ? Math.round(latencyMs) : null,
      uptimeSeconds != null ? Math.round(uptimeSeconds) : null,
      errorCount != null ? Math.round(errorCount) : null,
      lastScanAt ? new Date(lastScanAt) : null,
      JSON.stringify(meta || {}),
      now
    )

    return NextResponse.json({ ok: true, receivedAt: now.toISOString() })
  } catch (err: any) {
    console.error('[POST /api/v1/engine/heartbeat] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to store heartbeat' },
      { status: 500 }
    )
  }
}
