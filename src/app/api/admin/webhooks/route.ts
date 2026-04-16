export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { listRecentWebhooks, getWebhookStats } from '@/lib/webhook'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/webhooks
//
// Lists recent WebhookEvent rows with optional filters:
//   ?provider=stripe
//   ?status=DEAD_LETTER
//   ?limit=100&offset=0
//
// Also returns aggregate stats over the past 30 days so the admin page can
// render status cards.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const provider = searchParams.get('provider') || undefined
  const status = searchParams.get('status') || undefined
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100'), 1), 500)
  const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0)

  try {
    const [events, stats] = await Promise.all([
      listRecentWebhooks({ provider, status, limit, offset }),
      getWebhookStats(),
    ])
    return NextResponse.json({ events, stats })
  } catch (e: any) {
    console.error('[admin/webhooks GET] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to load webhooks' },
      { status: 500 }
    )
  }
}
