// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/jobs/[id]/documents
//
// Returns every HyphenDocument linked to the given Job, grouped by
// docCategory (Plans, Red Lines, Change Orders, Schedules, Other).
// Auth: staff only via checkStaffAuth.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const CATEGORY_ORDER = ['Plans', 'Red Lines', 'Change Orders', 'Schedules', 'Other']

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authError = checkStaffAuth(request)
    if (authError) return authError

    const { id } = params
    if (!id) {
      return NextResponse.json({ error: 'bad_request', message: 'id required' }, { status: 400 })
    }

    const docs = await (prisma as any).hyphenDocument.findMany({
      where: { jobId: id },
      orderBy: { scrapedAt: 'desc' },
    })

    // Group by docCategory (fallback to 'Other' when null/unknown).
    const grouped: Record<string, any[]> = {}
    for (const cat of CATEGORY_ORDER) grouped[cat] = []
    for (const d of docs as any[]) {
      const cat =
        d.docCategory && CATEGORY_ORDER.includes(d.docCategory) ? d.docCategory : 'Other'
      grouped[cat].push(d)
    }

    const counts = Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, (v as any[]).length]),
    )

    return NextResponse.json({
      jobId: id,
      total: docs.length,
      counts,
      groups: CATEGORY_ORDER.map((cat) => ({ category: cat, docs: grouped[cat] })),
    })
  } catch (err: any) {
    console.error('GET /api/ops/jobs/[id]/documents error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
