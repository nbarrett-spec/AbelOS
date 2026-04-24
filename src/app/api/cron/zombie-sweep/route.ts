/**
 * Cron: Zombie Sweep (belt-and-suspenders)
 *
 * Runs every 10 minutes. Sweeps any CronRun row stuck in RUNNING for more
 * than the threshold across every cron name, in a single UPDATE.
 *
 * The global watchdog inside startCronRun() (src/lib/cron.ts) already runs
 * a 10-min sweep on every cron start, so this cron is redundant whenever
 * another cron has fired recently. It exists for the corner cases:
 *   - quiet windows when no other crons are firing (e.g. 2am weekend)
 *   - if a batch of crons fails in a way that prevents startCronRun() from
 *     reaching the sweep block
 *
 * On 2026-04-23 shortage-forecast left 3 RUNNING rows at 19:10/19:14/19:16
 * because the then-15-min name-scoped watchdog couldn't match them. The
 * inline watchdog now sweeps globally; this cron is the safety net.
 *
 * Sweep semantics:
 *   - status: any RUNNING row older than THRESHOLD_MINUTES is closed
 *   - cron name: ALL cron names (no name filter — that bug cost us 3 zombies
 *     on 2026-04-23)
 *   - FAILURE vs SUCCESS: inflow-sync writes a SyncLog row BEFORE Vercel
 *     kills the function, so the business work actually succeeded even
 *     though CronRun never got updated. We cross-check SyncLog; if a
 *     SUCCESS/PARTIAL SyncLog row exists inside the RUNNING window, stamp
 *     CronRun SUCCESS (no false-FAILURE alert for Nate). Every other cron
 *     is stamped FAILURE with a canonical zombie-sweep error.
 *   - error message: only written when currently NULL, so a real error set
 *     by a handler before Vercel killed it isn't clobbered.
 *
 * Response shape (per Wave-1 A2 contract):
 *   { ok: true, zombiesClosed: N, byName: { cronName: count, ... } }
 *
 * If the CronRun table does not yet exist (fresh env, pre-migration), we
 * swallow the error and return { ok: true, zombiesClosed: 0, byName: {} }.
 *
 * Auth: CRON_SECRET. Registered in vercel.json.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'
import { notifyCronFailure } from '@/lib/cron-alerting'

// 15 min is past Vercel's 300s kill (5 min) with wide margin. Every long
// cron we run has maxDuration ≤ 300s, so anything still RUNNING after
// 15 min is definitively dead.
const THRESHOLD_MINUTES = 15

// Canonical error stamped on swept zombies. Only written when the existing
// error column is NULL — a handler that actually captured an error before
// getting killed keeps its message.
const ZOMBIE_ERROR = 'Zombie sweep: exceeded 15min runtime'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('zombie-sweep', 'schedule')
  const started = Date.now()

  try {
    // GLOBAL sweep — no name filter. Mirrors the sweep in cron.ts::startCronRun.
    // Exclude our own fresh RUNNING row (the threshold guards self-sweep
    // anyway, but being explicit avoids any chance of a race).
    //
    // SyncLog reconciliation: inflow-sync often succeeds even when its
    // CronRun row is stuck — the business work (SyncLog.status = SUCCESS)
    // landed before Vercel killed the function. We keep that reconciliation
    // so we don't fire false-FAILURE alerts for completed syncs.
    //
    // Error preservation: only stamp ZOMBIE_ERROR when the row's error is
    // NULL. If a handler already captured a real error before getting
    // killed, don't clobber it.
    let swept: Array<{
      id: string
      name: string
      status: string
      durationMs: number
      error: string | null
    }> = []

    try {
      swept = await prisma.$queryRawUnsafe<typeof swept>(
        `UPDATE "CronRun" cr
           SET "status" = CASE
                 WHEN cr."name" = 'inflow-sync' AND EXISTS (
                   SELECT 1 FROM "SyncLog" sl
                    WHERE sl."provider" = 'INFLOW'
                      AND sl."status" IN ('SUCCESS','PARTIAL')
                      AND sl."startedAt" >= cr."startedAt"
                      AND sl."startedAt" <= cr."startedAt" + INTERVAL '10 minutes'
                 ) THEN 'SUCCESS'
                 ELSE 'FAILURE'
               END,
               "finishedAt" = NOW(),
               "durationMs" = EXTRACT(EPOCH FROM (NOW() - cr."startedAt")) * 1000,
               "error" = CASE
                 WHEN cr."name" = 'inflow-sync' AND EXISTS (
                   SELECT 1 FROM "SyncLog" sl
                    WHERE sl."provider" = 'INFLOW'
                      AND sl."status" IN ('SUCCESS','PARTIAL')
                      AND sl."startedAt" >= cr."startedAt"
                      AND sl."startedAt" <= cr."startedAt" + INTERVAL '10 minutes'
                 ) THEN NULL
                 WHEN cr."error" IS NULL THEN $2
                 ELSE cr."error"
               END
         WHERE cr."status" = 'RUNNING'
           AND cr."id" <> $1
           AND cr."startedAt" < NOW() - INTERVAL '${THRESHOLD_MINUTES} minutes'
         RETURNING cr."id", cr."name", cr."status", cr."durationMs", cr."error"`,
        runId,
        ZOMBIE_ERROR
      )
    } catch (sweepErr: any) {
      // CronRun table missing (fresh env pre-migration) is the one failure
      // mode we want to silently tolerate — return ok:true with 0 closed.
      // Any other SQL error should surface via the outer catch.
      const msg = sweepErr?.message || String(sweepErr)
      if (/relation .*CronRun.* does not exist|no such table/i.test(msg)) {
        logger.info('zombie_sweep_table_missing', { msg })
        const payload = { ok: true, zombiesClosed: 0, byName: {} as Record<string, number> }
        await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result: payload })
        return NextResponse.json(payload)
      }
      throw sweepErr
    }

    // Per-cron breakdown for logging + response.
    const byName: Record<string, number> = {}
    for (const row of swept) {
      const name = String(row.name)
      byName[name] = (byName[name] || 0) + 1
    }

    logger.info('zombie_sweep_closed', {
      zombiesClosed: swept.length,
      byName,
      thresholdMinutes: THRESHOLD_MINUTES,
    })

    // Fire alerts only for real FAILUREs — not for SyncLog-reconciled SUCCESS
    // rows (those finished the work, just didn't get their own finish-row).
    for (const row of swept) {
      if (row.status === 'FAILURE') {
        notifyCronFailure({
          cronName: String(row.name),
          error: String(row.error || ZOMBIE_ERROR),
          durationMs: Number(row.durationMs) || 0,
          runId: String(row.id),
        }).catch((e) => {
          logger.error('zombie_sweep_alert_failed', e, { id: row.id, name: row.name })
        })
      }
    }

    const payload = {
      ok: true,
      zombiesClosed: swept.length,
      byName,
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: {
        ...payload,
        thresholdMinutes: THRESHOLD_MINUTES,
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        swept: swept.map((r) => ({
          id: r.id,
          name: r.name,
          reconciledStatus: r.status,
          durationMs: Number(r.durationMs) || 0,
        })),
      },
    })
    return NextResponse.json(payload)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: msg })
    return NextResponse.json(
      { ok: false, error: msg, timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}
