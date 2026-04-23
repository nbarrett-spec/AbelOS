export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { withCronRun } from '@/lib/cron'
import { getRedis } from '@/lib/redis'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/admin/test-cron-alert
//
// End-to-end smoke test for the cron-failure alerting pipeline added in
// src/lib/cron-alerting.ts. Runs a throwing handler inside withCronRun so:
//
//   1. A row is inserted in CronRun with status=FAILURE and a synthetic
//      error message.
//   2. finishCronRun() sees status=FAILURE and dispatches notifyCronFailure.
//   3. notifyCronFailure claims the Redis rate-limit key, sends email to
//      CRON_FAILURE_NOTIFY_EMAILS (or Nate/Clint defaults), and optionally
//      captures to Sentry.
//
// Because the rate limiter is real, this endpoint also supports a ?reset=1
// query param that deletes the rate-limit key first so repeat tests actually
// fire an email. Gated to staff.
//
// The synthetic cron name is "__test-cron-alert" with a double-underscore
// prefix so it's easy to filter out of observability dashboards.
// ──────────────────────────────────────────────────────────────────────────

const TEST_CRON_NAME = '__test-cron-alert'

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const url = new URL(request.url)
  const reset = url.searchParams.get('reset') === '1'

  if (reset) {
    const redis = getRedis()
    if (redis) {
      try {
        await redis.del(`cron-alert:${TEST_CRON_NAME}`)
      } catch {
        // swallow — not fatal
      }
    }
  }

  // Run withCronRun with a throwing body. withCronRun will mark the run
  // FAILURE, call finishCronRun, and re-throw — we catch the re-throw here
  // so the endpoint returns a 200 with the diagnostics rather than a 500.
  let caught: Error | null = null
  try {
    await withCronRun(TEST_CRON_NAME, async () => {
      throw new Error(
        `Synthetic failure from /api/admin/test-cron-alert at ${new Date().toISOString()} — this is a deliberate test of the cron alerting pipeline and can be safely ignored.`
      )
    }, { triggeredBy: 'manual' })
  } catch (e: any) {
    caught = e
  }

  return NextResponse.json({
    ok: true,
    cronName: TEST_CRON_NAME,
    rateLimitReset: reset,
    threw: Boolean(caught),
    errorMessage: caught?.message ?? null,
    note:
      'Alert dispatch is fire-and-forget inside finishCronRun. Check recipient inboxes in 10-30s. Use ?reset=1 to clear the rate-limit key before re-running.',
  })
}

// GET returns diagnostics about whether a test would actually send email.
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const rawRecipients = (process.env.CRON_FAILURE_NOTIFY_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
  const recipients = rawRecipients.length > 0
    ? rawRecipients
    : ['n.barrett@abellumber.com', 'c.vinson@abellumber.com']

  const redis = getRedis()
  let rateLimitActive = false
  if (redis) {
    try {
      const v = await redis.get(`cron-alert:${TEST_CRON_NAME}`)
      rateLimitActive = v !== null
    } catch {
      // swallow
    }
  }

  return NextResponse.json({
    cronName: TEST_CRON_NAME,
    recipients,
    usingDefaultRecipients: rawRecipients.length === 0,
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    sentryConfigured: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
    redisConfigured: Boolean(redis),
    rateLimitActive,
    note:
      'POST to this endpoint (optionally with ?reset=1) to fire a synthetic cron failure and exercise the alerting pipeline end-to-end.',
  })
}
