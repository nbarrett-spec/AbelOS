export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runReadinessChecks } from '@/lib/readiness'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// Uptime probe cron.
//
// Runs the same readiness checks as /api/health/ready and persists the
// result to UptimeProbe. /admin/health uses this history to show an uptime
// % and latency trend so ops can spot gradual degradation before an
// external monitor pages anyone.
//
// Runs every 5 minutes. Probes are cheap (one SELECT 1 + env var check),
// so the retention budget is driven by row count, not cost.
//
// We retain 30 days of history — anything older is pruned on each run.
// ──────────────────────────────────────────────────────────────────────────

const RETENTION_DAYS = 30

let tableReady: Promise<void> | null = null

async function ensureUptimeTable(): Promise<void> {
  if (tableReady) return tableReady
  tableReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "UptimeProbe" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          "status" TEXT NOT NULL,
          "totalMs" INTEGER NOT NULL,
          "dbMs" INTEGER,
          "dbOk" BOOLEAN NOT NULL,
          "envOk" BOOLEAN NOT NULL,
          "error" TEXT
        )
      `)
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_uptimeprobe_created" ON "UptimeProbe" ("createdAt" DESC)`
      )
    } catch {
      // swallow — best-effort
    }
  })()
  return tableReady
}

async function handle(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('uptime-probe', 'schedule')
  const started = Date.now()

  try {
    await ensureUptimeTable()

    const snapshot = await runReadinessChecks()
    const db = snapshot.checks.find((c) => c.name === 'database')
    const env = snapshot.checks.find((c) => c.name === 'required-env')
    const firstError = snapshot.checks.find((c) => !c.ok && c.error)?.error

    await prisma.$executeRawUnsafe(
      `INSERT INTO "UptimeProbe" ("status", "totalMs", "dbMs", "dbOk", "envOk", "error")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      snapshot.status,
      snapshot.totalMs,
      db?.ms ?? null,
      db?.ok ?? false,
      env?.ok ?? false,
      firstError ?? null
    )

    // Prune anything older than retention window. Cheap because of the index.
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UptimeProbe" WHERE "createdAt" < NOW() - INTERVAL '${RETENTION_DAYS} days'`
    )

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      status: snapshot.status,
      totalMs: snapshot.totalMs,
      dbMs: db?.ms,
    }
    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    return NextResponse.json(result)
  } catch (error: any) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}
export async function POST(request: NextRequest) {
  return handle(request)
}
