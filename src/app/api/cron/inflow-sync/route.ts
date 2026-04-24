/**
 * Cron: InFlow Inventory Sync
 *
 * Runs every 15 minutes (was hourly pre-Wave-2). Product catalog / stock / PO
 * data drifts intraday; hourly was stale enough that MRP projections and
 * shortage alerts fired on yesterday's numbers. 15-min cadence with a
 * 3-minute soft budget per invocation gets us near-real-time without
 * stacking runs against InFlow's 60 req/min rate limit.
 *
 * Execution model (Wave-2, 2026-04-23):
 *
 *   - maxDuration=240s (60s under Vercel's 300s hard kill so finishCronRun
 *     can actually fire; watchdog in startCronRun cleans up anyone we miss).
 *   - Time budget 180s (3 min). After each phase we check remaining budget;
 *     under it, we skip the next phase and save the cursor. The skipped
 *     phase runs on the next 15-min tick (at worst 15 min later).
 *   - Zombie guard at top: if another inflow-sync row is still RUNNING and
 *     younger than 15 min, we bail with 200 { skipped: 'concurrent_run' }.
 *     Prevents Vercel stacking invocations during incidents.
 *   - SyncCursor row per phase: products → inventory → purchaseOrders →
 *     salesOrders, cycling. We start wherever the last run left off, so
 *     no single phase starves the others.
 *
 * Preserves Wave-1 A4's circuit breaker + degraded-endpoint logic intact.
 * Requires CRON_SECRET for auth.
 */

export const dynamic = 'force-dynamic'
// Vercel hard-kills at 300s. 240 gives 60s headroom for finishCronRun to
// write back, which matters because any row still RUNNING at kill-time
// becomes a zombie the watchdog has to sweep.
export const maxDuration = 240

import { NextRequest, NextResponse } from 'next/server'
import {
  syncProducts as syncInflowProducts,
  syncInventory as syncInflowInventory,
  syncPurchaseOrders as syncInflowPurchaseOrders,
  syncSalesOrders as syncInflowSalesOrders,
  degradedEndpoint,
  resetDegradedTracker,
} from '@/lib/integrations/inflow'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { prisma } from '@/lib/prisma'

// If a single InFlow endpoint trips this many consecutive failures inside one
// run, bail early and mark the CronRun FAILED with error='InFlow endpoint
// degraded'. Prevents a single borked endpoint from burning the whole time
// budget retrying itself to death. See fetchWithBackoff in lib/integrations/inflow.
const DEGRADED_FAILURE_THRESHOLD = 10

// Soft time budget (ms) per invocation. Dropped from 700s → 180s for the
// 15-min cadence. Each run processes whatever fits; the cursor preserves
// position so the next tick picks up where we left off.
const TIME_BUDGET_MS = 180_000

// Rough pre-flight estimate per phase (ms). Used by budgetOkay() to decide
// whether to attempt a phase. Must stay conservative — overshooting the
// budget costs us the post-phase cursor write. Values calibrated from
// April 2026 production observations (see commit history).
const PHASE_MIN_MS = {
  products: 150_000, // big; usually the only phase that fits in a 3-min run
  inventory: 120_000,
  purchaseOrders: 20_000,
  salesOrders: 20_000,
} as const

// Phase order — cursor advances through this list. After salesOrders we
// wrap back to products. Sticking to a fixed rotation means no phase goes
// longer than 4 * 15min = 60 min between attempts even in the worst case.
const PHASE_ORDER = ['products', 'inventory', 'purchaseOrders', 'salesOrders'] as const
type PhaseName = (typeof PHASE_ORDER)[number]

const CURSOR_NAME = 'inflow-sync'

// ──────────────────────────────────────────────────────────────────────────
// SyncCursor table — raw SQL, no Prisma model. Follows the AuditLog /
// CronRun pattern: CREATE TABLE IF NOT EXISTS on first call, so we never
// need a migration to ship a new cursor-backed cron.
//
//   name            text primary key   e.g. 'inflow-sync'
//   lastCursor      text               last completed phase name
//   lastRunAt       timestamptz        NOW() on write
//   itemsProcessed  int                cumulative items since epoch (diag)
//   meta            jsonb              free-form: last per-phase result, etc.
// ──────────────────────────────────────────────────────────────────────────
let cursorTableEnsured = false
async function ensureCursorTable() {
  if (cursorTableEnsured) return
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "SyncCursor" (
         "name" TEXT PRIMARY KEY,
         "lastCursor" TEXT,
         "lastRunAt" TIMESTAMPTZ DEFAULT NOW(),
         "itemsProcessed" INTEGER DEFAULT 0,
         "meta" JSONB
       )`
    )
    cursorTableEnsured = true
  } catch {
    // Don't fail the run if the table create races. Subsequent reads/writes
    // will either succeed or surface their own error.
    cursorTableEnsured = true
  }
}

interface CursorRow {
  name: string
  lastCursor: string | null
  lastRunAt: Date | null
  itemsProcessed: number | null
  meta: any
}

async function readCursor(): Promise<CursorRow | null> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "name", "lastCursor", "lastRunAt", "itemsProcessed", "meta"
         FROM "SyncCursor" WHERE "name" = $1 LIMIT 1`,
      CURSOR_NAME
    )
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function writeCursor(params: {
  lastCursor: string | null
  itemsDelta: number
  meta: Record<string, any>
}) {
  try {
    const metaJson = JSON.stringify(params.meta ?? {}).slice(0, 20000)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SyncCursor" ("name", "lastCursor", "lastRunAt", "itemsProcessed", "meta")
       VALUES ($1, $2, NOW(), $3, $4::jsonb)
       ON CONFLICT ("name") DO UPDATE
         SET "lastCursor" = EXCLUDED."lastCursor",
             "lastRunAt" = NOW(),
             "itemsProcessed" = COALESCE("SyncCursor"."itemsProcessed", 0) + $3,
             "meta" = EXCLUDED."meta"`,
      CURSOR_NAME,
      params.lastCursor,
      params.itemsDelta | 0,
      metaJson
    )
  } catch {
    // Best-effort — next run will fall back to phase-0 if we can't write.
  }
}

/**
 * Given the `lastCursor` from the previous run, return the phase order to
 * attempt this run. We start at the NEXT phase after the last one that
 * completed (rotation). If the cursor is empty or unknown, start at 'products'.
 */
function planPhases(lastCursor: string | null): PhaseName[] {
  const rotated: PhaseName[] = []
  const startIdx = lastCursor
    ? (PHASE_ORDER.indexOf(lastCursor as PhaseName) + 1) % PHASE_ORDER.length
    : 0
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    rotated.push(PHASE_ORDER[(startIdx + i) % PHASE_ORDER.length])
  }
  return rotated
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Zombie / concurrency guard.
  //
  // At 15-min cadence Vercel can and does stack invocations when the previous
  // one runs long. A running inflow-sync can hold up to 60s of InFlow rate-
  // limit budget, so stacking two live runs can blow the quota for both.
  // If there's already a RUNNING row younger than 15 min, bail immediately —
  // the existing invocation will either finish or the watchdog in
  // startCronRun (10-min stale sweep) will clean it up on the next tick.
  //
  // Inline SQL rather than a shared helper because this is the only cron
  // that needs pre-start zombie detection today. `zombie-sweep` cron runs
  // every 10 min and handles post-mortem cleanup globally.
  // ────────────────────────────────────────────────────────────────────────
  try {
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "startedAt" FROM "CronRun"
         WHERE "name" = 'inflow-sync'
           AND "status" = 'RUNNING'
           AND "startedAt" > NOW() - INTERVAL '15 minutes'
         ORDER BY "startedAt" DESC
         LIMIT 1`
    )
    if (Array.isArray(existing) && existing.length > 0) {
      return NextResponse.json({
        ok: true,
        skipped: 'concurrent_run',
        existingRunId: String(existing[0].id),
        startedAt: existing[0].startedAt,
        message: 'Another inflow-sync run is already in flight (<15min old). Skipping.',
      })
    }
  } catch {
    // If the zombie check itself errors, proceed — the watchdog sweep in
    // startCronRun will still catch anything that goes bad.
  }

  const runId = await startCronRun('inflow-sync', 'schedule')
  const started = Date.now()

  // Warm-invocation safety: the InFlow client keeps the degraded-endpoint
  // counter in module-scope memory. If a prior run left it dirty, a fresh
  // run would bail immediately. Clear before we start.
  resetDegradedTracker()

  await ensureCursorTable()
  const priorCursor = await readCursor()
  const phasePlan = planPhases(priorCursor?.lastCursor ?? null)

  try {
    const startTime = Date.now()
    const results: any[] = []
    const skipped: string[] = []
    const ran: PhaseName[] = []
    let degraded: string | null = null
    let lastCompletedPhase: PhaseName | null = (priorCursor?.lastCursor as PhaseName) ?? null

    // Budget gate — if fewer than `minMsNeeded` remain, skip this phase.
    const elapsed = () => Date.now() - startTime
    const budgetOkay = (minMsNeeded: number) =>
      elapsed() + minMsNeeded < TIME_BUDGET_MS

    // Short-circuit helper: if any endpoint has gone chronically bad (>=10
    // consecutive failures inside this run, tracked by fetchWithBackoff),
    // stop scheduling new phases. We return early below with status='FAILURE'
    // and error='InFlow endpoint degraded' rather than thrashing through the
    // remaining time budget on an endpoint that clearly isn't going to come
    // back in the next 60s.
    const checkDegraded = () => {
      degraded = degradedEndpoint(DEGRADED_FAILURE_THRESHOLD)
      return degraded
    }

    // Dispatch table maps phase name → sync function. Kept local so the
    // PHASE_ORDER rotation and the dispatch can't drift out of sync.
    const phaseFn: Record<PhaseName, () => Promise<any>> = {
      products: syncInflowProducts,
      inventory: syncInflowInventory,
      purchaseOrders: syncInflowPurchaseOrders,
      salesOrders: syncInflowSalesOrders,
    }

    // Walk the planned phase order. Stop early on degraded endpoint or when
    // the budget is exhausted. Whichever phase completes last wins the
    // cursor write — next invocation starts at the NEXT phase.
    for (const phase of phasePlan) {
      if (degraded) {
        skipped.push(phase)
        continue
      }
      if (!budgetOkay(PHASE_MIN_MS[phase])) {
        skipped.push(phase)
        continue
      }

      try {
        const result = await phaseFn[phase]()
        results.push(result)
        ran.push(phase)
        lastCompletedPhase = phase
      } catch (phaseErr) {
        // A phase threw — treat like a sync failure but don't abort the
        // whole run; subsequent phases might still succeed and progress
        // the cursor. The outer CronRun status picks up the failure below.
        results.push({
          syncType: phase,
          status: 'FAILED',
          error: phaseErr instanceof Error ? phaseErr.message : String(phaseErr),
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsFailed: 0,
        })
        ran.push(phase)
        lastCompletedPhase = phase
      }

      checkDegraded()
    }

    const duration = Date.now() - startTime
    const partial = skipped.length > 0 || degraded !== null

    const itemsDelta = results.reduce(
      (sum, r) => sum + (Number(r?.recordsProcessed) || 0),
      0
    )

    const summary = {
      totalProcessed: itemsDelta,
      totalCreated: results.reduce((sum, r) => sum + (Number(r?.recordsCreated) || 0), 0),
      totalUpdated: results.reduce((sum, r) => sum + (Number(r?.recordsUpdated) || 0), 0),
      totalFailed: results.reduce((sum, r) => sum + (Number(r?.recordsFailed) || 0), 0),
      anyFailures: results.some((r) => r?.status === 'FAILED'),
      ranPhases: ran,
      skippedPhases: skipped,
      degradedEndpoint: degraded,
      partial,
    }

    // Save cursor — even on partial/degraded runs. Whichever phase
    // completed last wins; next invocation starts at the next phase in
    // PHASE_ORDER. If no phase ran (all skipped by budget), leave the
    // cursor where it was so progress doesn't slip.
    if (lastCompletedPhase && (ran.length > 0 || lastCompletedPhase !== (priorCursor?.lastCursor ?? null))) {
      await writeCursor({
        lastCursor: lastCompletedPhase,
        itemsDelta,
        meta: {
          ran,
          skipped,
          degraded,
          durationMs: duration,
          lastResults: results.map((r) => ({
            syncType: r?.syncType,
            status: r?.status,
            recordsProcessed: r?.recordsProcessed ?? 0,
          })),
        },
      })
    }

    // If the circuit breaker tripped, force the CronRun row to FAILURE with
    // a clear error string. Downstream alerting keys off this.
    const cronFailed = summary.anyFailures || degraded !== null

    const payload = {
      success: !cronFailed,
      message: degraded
        ? `InFlow endpoint degraded: ${degraded} (>=${DEGRADED_FAILURE_THRESHOLD} consecutive failures). Remaining phases skipped.`
        : summary.anyFailures
          ? 'InFlow sync completed with errors'
          : partial
            ? `InFlow sync partial: ran ${ran.join(', ') || 'none'}; skipped ${skipped.join(', ') || 'none'} (time budget or degraded)`
            : 'InFlow sync completed successfully',
      duration_ms: duration,
      summary,
      results,
      cursor: {
        priorPhase: priorCursor?.lastCursor ?? null,
        lastCompletedPhase,
        nextPhase: lastCompletedPhase
          ? PHASE_ORDER[(PHASE_ORDER.indexOf(lastCompletedPhase) + 1) % PHASE_ORDER.length]
          : PHASE_ORDER[0],
      },
      timestamp: new Date().toISOString(),
    }

    await finishCronRun(runId, cronFailed ? 'FAILURE' : 'SUCCESS', Date.now() - started, {
      result: {
        ...payload,
        itemsProcessed: itemsDelta,
        partial,
      },
      error: degraded
        ? `InFlow endpoint degraded: ${degraded}`
        : summary.anyFailures
          ? 'One or more InFlow sync operations failed'
          : undefined,
    })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[InFlow Sync] Error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
