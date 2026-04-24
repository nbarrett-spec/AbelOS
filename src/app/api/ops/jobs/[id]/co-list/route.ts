// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/jobs/[id]/co-list
//
// Returns every Change-Order-kind HyphenDocument linked to the given Job,
// sorted by scrapedAt DESC. Filters on:
//   eventType = 'change_order_detail'  (canonical NUC event)
//   OR docCategory = 'Change Orders'   (category tag on PDF payloads)
//
// Added Wave-D (D9) to back the ChangeOrderInbox card on the Job detail
// Documents tab. Read-only. Auth: staff only.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'bad_request', message: 'id required' }, { status: 400 })
  }

  const docs = await (prisma as any).hyphenDocument.findMany({
    where: {
      jobId: id,
      OR: [
        { eventType: 'change_order_detail' },
        { docCategory: 'Change Orders' },
      ],
    },
    orderBy: { scrapedAt: 'desc' },
  })

  const lastSyncedAt = (docs as any[])[0]?.scrapedAt ?? null

  return NextResponse.json({
    jobId: id,
    total: docs.length,
    lastSyncedAt,
    changeOrders: docs,
  })
}
