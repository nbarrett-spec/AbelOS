export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import {
  diffSnapshots,
  emitToBrain,
  type ParsedPriceRow,
} from '@/lib/integrations/boise-pricing-watcher'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/boise-pricing-sync
//
// Daily at 7am Central (12 UTC). Auth: Bearer ${CRON_SECRET}.
//
// Boise does NOT publish a dealer pricing API. The "live" source today is
// uploads via /api/admin/boise/upload-pricing (Nate or Dawn drops the
// monthly/weekly price sheet from the rep) — and, if enabled, an inbound
// Gmail rule that auto-uploads attachments. This cron's job is therefore:
//
//   1. Look at the most recent BoisePriceSnapshot.
//   2. If it's NEWER than the last cron run, re-emit the diff against the
//      prior snapshot (so Brain gets the events even if the upload happened
//      outside of business hours / a worker hadn't been awake yet).
//   3. If no recent snapshot, log "no-op — waiting for upload" and exit OK.
//
// This makes the cron the safety net rather than the trigger. When/if a
// real Boise API or a Gmail-attachment processor ships, this cron picks it
// up by virtue of new snapshots landing.
// ──────────────────────────────────────────────────────────────────────────

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('boise-pricing-sync', 'schedule')
  const started = Date.now()

  try {
    // Fetch the two most recent snapshots
    const snaps: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "createdAt", "effectiveDate", "priceMap", "totalSkus"
       FROM "BoisePriceSnapshot"
       ORDER BY "createdAt" DESC
       LIMIT 2`
    )

    if (!snaps.length) {
      const msg = 'no_snapshots_yet'
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
        result: { status: msg },
      })
      return NextResponse.json({ success: true, status: msg })
    }

    const current = snaps[0]
    const prev = snaps[1] // may be undefined

    // Skip if last cron-run already saw this snapshot (avoid duplicate emit).
    const lastRuns: any[] = await prisma.$queryRawUnsafe(
      `SELECT result FROM "CronRun"
       WHERE name = 'boise-pricing-sync' AND status = 'SUCCESS'
         AND id <> $1
       ORDER BY "startedAt" DESC LIMIT 1`,
      runId
    )
    const lastEmittedId =
      lastRuns[0]?.result?.snapshotId ?? lastRuns[0]?.result?.snapshot_id ?? null
    if (lastEmittedId === current.id) {
      const msg = 'no_new_snapshot_since_last_run'
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
        result: { status: msg, snapshotId: current.id },
      })
      return NextResponse.json({
        success: true,
        status: msg,
        snapshotId: current.id,
      })
    }

    // Reconstruct ParsedPriceRow[] from JSON priceMap
    const currentMap = current.priceMap as Record<
      string,
      { name: string | null; price: number; uom?: string | null; category?: string | null }
    >
    const currentRows: ParsedPriceRow[] = Object.entries(currentMap).map(([sku, v]) => ({
      sku,
      name: v.name ?? null,
      category: v.category ?? null,
      unitPrice: v.price,
      uom: v.uom ?? null,
    }))

    const diff = diffSnapshots(currentRows, prev?.priceMap ?? null, {
      thresholdPct: 1.0,
      topN: 50,
    })

    let brain: { sent: number; skipped: boolean; error?: string } = {
      sent: 0,
      skipped: true,
    }
    if (prev) {
      brain = await emitToBrain(diff.topMovers, current.id, current.effectiveDate ?? null)
    }

    const result = {
      snapshotId: current.id,
      previousSnapshotId: prev?.id ?? null,
      totalSkus: diff.totalSkus,
      newSkus: diff.newSkus,
      removedSkus: diff.removedSkus,
      changedSkus: diff.changedSkus,
      topMoverCount: diff.topMovers.length,
      brain,
    }

    const ok = !brain.error
    await finishCronRun(runId, ok ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result,
      error: brain.error,
    })

    return NextResponse.json({ success: ok, ...result }, { status: ok ? 200 : 207 })
  } catch (error: any) {
    console.error('boise-pricing-sync cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
