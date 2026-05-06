/**
 * GET /api/cron/prospect-enrich — weekly Vercel cron that runs the builder
 * enrichment agent on ONE prospect per invocation.
 *
 * Schedule: Mondays 7am CT (registered in src/lib/cron.ts as
 * `prospect-enrich`, schedule `0 7 * * 1`).
 *
 * Per-invocation budget:
 *   - One prospect.
 *   - Claude budget capped at $1 inside enrichProspect().
 *   - Vercel function maxDuration is 300s; one prospect run is ~30-90s.
 *
 * Why one-at-a-time and not a batch:
 *   - Vercel hard-kills functions at maxDuration without running finally{}.
 *     A batch run that crosses the cap would leave half-enriched rows and
 *     a zombie CronRun row (the cron.ts watchdog cleans these up but it's
 *     a 10-minute lag and a noisy alert to Nate).
 *   - Weekly cadence × ~1 prospect/week is fine — manual re-enrich (the
 *     /admin/prospects/[id]/enrich endpoint) is the high-volume path; cron
 *     is the safety net for stale rows.
 *
 * Candidate selection:
 *   `enrichmentConfidence != 'CONFIRMED' OR enrichmentRunAt < NOW() - INTERVAL
 *    '30 days' OR enrichmentRunAt IS NULL`
 *   ordered by `enrichmentRunAt ASC NULLS FIRST` so brand-new prospects
 *   (NULL run-at) are picked before stale-but-CONFIRMED ones.
 *
 * Feature flag: FEATURE_PROSPECT_ENRICH_ENABLED. Returns
 *   `{skipped: 'feature_off'}` with status 200 if not 'true'. The cron still
 *   reports SUCCESS so we don't false-alarm Nate while the feature is dark.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withCronRun } from '@/lib/cron'
import { enrichProspect } from '@/lib/agents/enrich-prospect'

// Vercel route segment config — let the platform schedule this. The schedule
// string itself lives in vercel.json (Agent E owns that file). We mirror the
// schedule in src/lib/cron.ts REGISTERED_CRONS so /admin/crons stops flagging
// "missing" once the route is live.

export async function GET(request: NextRequest) {
  // ── Bearer cron-secret check (canonical pattern from quote-followups) ──
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Feature flag ────────────────────────────────────────────────────────
  // Default off in prod per CLAUDE.md ("default off; flip on after smoke").
  // We return 200 so the cron is recorded as SUCCESS — flagging FAILURE on
  // a deliberately-disabled cron would page Nate every week for nothing.
  if (process.env.FEATURE_PROSPECT_ENRICH_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'feature_off' })
  }

  // Wrap in withCronRun so /admin/crons gets last-run/last-status. The
  // wrapper handles startCronRun + finishCronRun + zombie-watchdog sweep.
  return withCronRun('prospect-enrich', async () => {
    // ── Pick the next candidate ──────────────────────────────────────────
    // Three-condition OR per scope spec:
    //   1. confidence != CONFIRMED  → keep retrying low-confidence rows
    //   2. enrichmentRunAt < NOW() - 30d  → re-verify stale CONFIRMED rows
    //   3. enrichmentRunAt IS NULL  → never enriched yet
    // Order: NULLS FIRST so brand-new rows leapfrog stale-but-known ones.
    // LIMIT 1 because Vercel maxDuration risk (see file header).
    const candidates: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "companyName"
       FROM "Prospect"
       WHERE ("enrichmentConfidence" IS NULL
              OR "enrichmentConfidence" != 'CONFIRMED'
              OR "enrichmentRunAt" IS NULL
              OR "enrichmentRunAt" < NOW() - INTERVAL '30 days')
         AND "status" != 'CONVERTED'
         AND "status" != 'DEAD'
       ORDER BY "enrichmentRunAt" ASC NULLS FIRST, "createdAt" ASC
       LIMIT 1`
    )

    if (candidates.length === 0) {
      // Nothing to enrich — common steady-state once the backlog is cleared.
      return NextResponse.json({ skipped: 'no_candidates', processed: 0 })
    }

    const prospect = candidates[0]

    try {
      const result = await enrichProspect({
        prospectId: prospect.id,
        // staffId omitted → enrichProspect defaults to 'system' for audit.
        caller: 'cron',
      })

      return NextResponse.json({
        processed: 1,
        prospectId: prospect.id,
        companyName: prospect.companyName,
        confidence: result.confidence,
        contactEmail: result.contactEmail,
        founderName: result.founderName,
        domain: result.domain,
        icpTier: result.icpTier,
        costUsd: result.costUsd,
        searchesPerformed: result.searchesPerformed,
      })
    } catch (err: any) {
      // Surface the failure but with enough detail that the
      // notifyCronFailure email gives Nate the prospect id + company name
      // so he can manually re-run from /admin/prospects/[id]/enrich. We
      // re-throw so withCronRun marks FAILURE — that triggers the alerting
      // path in finishCronRun.
      logger.error('prospect_enrich_cron_failed', err, {
        prospectId: prospect.id,
        companyName: prospect.companyName,
      })
      throw new Error(
        `enrichProspect failed for ${prospect.companyName} (${prospect.id}): ${
          err?.message || String(err)
        }`
      )
    }
  })
}
