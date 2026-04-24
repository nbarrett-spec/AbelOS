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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('zombie-sweep', 'schedule')
  const started = Date.now()

  try {
    // Mirrors the sweep in cron.ts::startCronRun — same SyncLog reconciliation
    // logic so an inflow-sync run whose SyncLog says SUCCESS but whose CronRun
    // never got the finishCronRun update gets correctly stamped SUCCESS
    // (not a false FAILURE). Without this, we'd flip a completed sync's
    // CronRun row back to FAILURE on every zombie-sweep pass — noise in
    // /admin/crons and spurious alerts to Nate.
    //
    // Exclude our own fresh RUNNING row. startCronRun just inserted it,
    // and the threshold guards against self-sweep anyway, but being explicit
    // avoids any chance of a race.
    const swept = await prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; status: string; durationMs: number; error: string }>
    >(
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
               ELSE 'TIMEOUT: swept by /api/cron/zombie-sweep (>${THRESHOLD_MINUTES} min in RUNNING). Likely Vercel maxDuration kill.'
             END
       WHERE cr."status" = 'RUNNING'
         AND cr."id" <> $1
         AND cr."startedAt" < NOW() - INTERVAL '${THRESHOLD_MINUTES} minutes'
       RETURNING cr."id", cr."name", cr."status", cr."durationMs", cr."error"`,
      runId
    )

    // Fire alerts only for real FAILUREs — not for SyncLog-reconciled SUCCESS
    // rows (those finished the work, just didn't get their own finish-row).
    for (const row of swept) {
      if (row.status === 'FAILURE') {
        notifyCronFailure({
          cronName: String(row.name),
          error: String(row.error || 'TIMEOUT'),
          durationMs: Number(row.durationMs) || 0,
          runId: String(row.id),
        }).catch((e) => {
          logger.error('zombie_sweep_alert_failed', e, { id: row.id, name: row.name })
        })
      }
    }

    const payload = {
      success: true,
      sweptCount: swept.length,
      swept: swept.map((r) => ({
        id: r.id,
        name: r.name,
        reconciledStatus: r.status, // SUCCESS if SyncLog proved work completed, else FAILURE
        durationMs: Number(r.durationMs) || 0,
      })),
      thresholdMinutes: THRESHOLD_MINUTES,
      durationMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: msg })
    return NextResponse.json(
      { error: msg, timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}
