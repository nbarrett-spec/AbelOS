/**
 * Cron: BPW Pulte Sync — DISABLED 2026-04-23
 *
 * BPW = "Builder Portal Web" — Pulte's builder API. The Pulte account
 * was lost 2026-04-20 (Doug Gough confirmed Treeline → 84 Lumber;
 * Mobberly Farms moved March). This sync is therefore obsolete.
 *
 * History: 100% failure since 2026-04-21 02:30 UTC because
 * IntegrationProvider enum never contained BPW_PULTE, so every
 * findUnique({ provider: 'BPW_PULTE' }) threw validator errors.
 *
 * The schedule entry in vercel.json has been removed in the same
 * commit. The route is retained as a 410 stub so any stale external
 * caller gets a clear signal instead of a 500.
 *
 * Auth: still requires Authorization: Bearer <CRON_SECRET> so a 410
 * is only returned to authorized callers; unauthorized requests get
 * 401 and don't learn anything about the endpoint's status.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  // Verify CRON_SECRET bearer auth
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(
    {
      success: false,
      disabled: true,
      reason: 'Pulte account lost 2026-04-20; BPW sync retired 2026-04-23.',
    },
    { status: 410 },
  )
}
