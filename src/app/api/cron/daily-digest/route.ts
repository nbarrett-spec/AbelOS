/**
 * Daily Digest Cron — /api/cron/daily-digest
 *
 * Fires at 11:00 UTC (6:00 AM CT) every day. For every active staff
 * member, compose + send the personalized digest email. Designed so that:
 *   - Missing RESEND_API_KEY returns 200 with skipped counts (cron stays
 *     green; Vercel won't retry into a loop)
 *   - Staff opted out (preferences.digestOptOut) are skipped silently
 *   - Empty digests are skipped (no inbox noise)
 *   - Duplicate sends on the same day are blocked via EmailSendLog
 *   - Throttled to 5 sends/sec so we don't hammer Resend
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron'
import { sendDigest } from '@/lib/digest-email'
import { logger } from '@/lib/logger'

// Resend rate limit headroom — cap at 5/sec so concurrent transactional
// mail (collections, quote-ready, etc.) still has budget.
const SENDS_PER_SECOND = 5
const MIN_INTERVAL_MS = Math.ceil(1000 / SENDS_PER_SECOND)

async function sleep(ms: number) {
  if (ms <= 0) return
  await new Promise((r) => setTimeout(r, ms))
}

interface CronRunSummary {
  total: number
  sent: number
  skipped_optout: number
  skipped_empty: number
  skipped_duplicate: number
  skipped_no_email: number
  skipped_no_api_key: number
  failed: number
  durationMs: number
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun('daily-digest', async () => {
    const started = Date.now()

    // Pull every active staff member with an email. We do the opt-out /
    // empty-digest checks per-staff inside sendDigest — centralizing that
    // logic so the preview + test paths behave identically.
    const staffList = await prisma.staff.findMany({
      where: {
        active: true,
        email: { not: '' },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    })

    const summary: CronRunSummary = {
      total: staffList.length,
      sent: 0,
      skipped_optout: 0,
      skipped_empty: 0,
      skipped_duplicate: 0,
      skipped_no_email: 0,
      skipped_no_api_key: 0,
      failed: 0,
      durationMs: 0,
    }

    // Throttle the outer loop. Each iteration sleeps MIN_INTERVAL_MS
    // AFTER the send so bursts don't stack past the 5/sec cap. We don't
    // parallelize — keeps the throttle enforceable and the digest compose
    // stays O(1) per staff in DB cost.
    for (const s of staffList) {
      const iterationStart = Date.now()
      try {
        const result = await sendDigest(s.id)
        switch (result.status) {
          case 'SENT':
            summary.sent++
            break
          case 'SKIPPED_OPTOUT':
            summary.skipped_optout++
            break
          case 'SKIPPED_EMPTY':
            summary.skipped_empty++
            break
          case 'SKIPPED_DUPLICATE':
            summary.skipped_duplicate++
            break
          case 'SKIPPED_NO_EMAIL':
            summary.skipped_no_email++
            break
          case 'SKIPPED_NO_API_KEY':
            summary.skipped_no_api_key++
            break
          case 'FAILED':
            summary.failed++
            logger.warn('daily_digest_send_failed', {
              staffId: s.id,
              error: result.error,
            })
            break
        }
      } catch (e) {
        summary.failed++
        logger.error('daily_digest_iteration_error', e as any, { staffId: s.id })
      }

      // Only sleep if we actually hit Resend (or might have). Skips are
      // cheap; skipping the sleep on bulk opt-outs keeps the cron brisk.
      const elapsed = Date.now() - iterationStart
      await sleep(MIN_INTERVAL_MS - elapsed)
    }

    summary.durationMs = Date.now() - started
    return NextResponse.json({ ok: true, summary })
  })
}
