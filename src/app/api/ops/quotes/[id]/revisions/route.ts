export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { listQuoteRevisions } from '@/lib/quote-revisions'

// ──────────────────────────────────────────────────────────────────────
// GET /api/ops/quotes/[id]/revisions
// Returns the full revision history for a quote (newest first), each
// row including the snapshot at that revision and the diff against the
// previous revision (`changes`). Powers the Revision History panel on
// the quote detail page.
// ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const revisions = await listQuoteRevisions(params.id)
    return NextResponse.json({
      quoteId: params.id,
      count: revisions.length,
      revisions,
    })
  } catch (e: any) {
    console.error('GET /api/ops/quotes/[id]/revisions error:', e)
    return NextResponse.json(
      { error: 'Internal server error', details: e?.message || String(e) },
      { status: 500 }
    )
  }
}
