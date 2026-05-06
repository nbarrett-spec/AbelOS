// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/hyphen/unmatched
//
// Lists HyphenDocument rows that are not confidently tied to a Job — any row
// where jobId IS NULL OR matchConfidence <> 'HIGH'. Feeds the admin review
// UI so an operator can manually reassign to the correct Job.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authError = checkStaffAuth(request)
    if (authError) return authError

    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 1000)

    const docs = await (prisma as any).hyphenDocument.findMany({
      where: {
        OR: [
          { jobId: null },
          { NOT: { matchConfidence: 'HIGH' } },
        ],
      },
      orderBy: { scrapedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sourceId: true,
        eventType: true,
        docCategory: true,
        fileName: true,
        fileUrl: true,
        fileSizeBytes: true,
        poNumber: true,
        builderName: true,
        jobAddress: true,
        lotBlock: true,
        planElvSwing: true,
        matchConfidence: true,
        matchMethod: true,
        jobId: true,
        builderId: true,
        scrapedAt: true,
      },
    })

    const counts = {
      total: docs.length,
      unmatched: docs.filter((d: any) => d.jobId === null).length,
      low: docs.filter((d: any) => d.matchConfidence === 'LOW').length,
      medium: docs.filter((d: any) => d.matchConfidence === 'MEDIUM').length,
    }

    return NextResponse.json({ counts, docs })
  } catch (err: any) {
    console.error('GET /api/ops/hyphen/unmatched error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
