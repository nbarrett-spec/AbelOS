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
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      disabled: true,
      reason: 'Pulte account lost 2026-04-20; BPW sync retired 2026-04-23.',
    },
    { status: 410 },
  )
}
