export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { ensureSubstitutionRequestTable } from '@/lib/substitution-requests'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/substitutions/requests
//
// Lists substitution requests. Default filter: status=PENDING (the approval
// queue). Optional ?status=APPROVED|REJECTED|APPLIED|ALL to widen.
//
// Response is flattened to be friendly to the /ops/substitutions/requests
// page — it joins in job number, builder name, original/substitute SKUs, and
// requester name so the page can render everything without N+1 fetches.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const rawStatus = (searchParams.get('status') || 'PENDING').toUpperCase()
  const status = ['PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'ALL'].includes(
    rawStatus
  )
    ? rawStatus
    : 'PENDING'

  try {
    await ensureSubstitutionRequestTable()

    const whereClause =
      status === 'ALL' ? '' : `WHERE sr."status" = '${status}'`

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         sr.id,
         sr."jobId",
         sr."originalAllocationId",
         sr."originalProductId",
         sr."substituteProductId",
         sr.quantity,
         sr."requestedById",
         sr.reason,
         sr.status,
         sr."approvedById",
         sr."approvedAt",
         sr."rejectionNote",
         sr."createdAt",
         sr."appliedAt",
         j."jobNumber",
         j."assignedPMId",
         b.name      AS "builderName",
         po.sku       AS "originalSku",
         po.name      AS "originalName",
         ps.sku       AS "substituteSku",
         ps.name      AS "substituteName",
         psub."compatibility",
         psub."conditions",
         psub."priceDelta",
         rs."firstName" AS "requesterFirstName",
         rs."lastName"  AS "requesterLastName",
         rs.email       AS "requesterEmail"
       FROM "SubstitutionRequest" sr
       LEFT JOIN "Job"     j  ON j.id  = sr."jobId"
       LEFT JOIN "Builder" b  ON b.id  = j."builderId"
       LEFT JOIN "Product" po ON po.id = sr."originalProductId"
       LEFT JOIN "Product" ps ON ps.id = sr."substituteProductId"
       LEFT JOIN "ProductSubstitution" psub
              ON psub."primaryProductId"    = sr."originalProductId"
             AND psub."substituteProductId" = sr."substituteProductId"
             AND psub.active = true
       LEFT JOIN "Staff"   rs ON rs.id = sr."requestedById"
       ${whereClause}
       ORDER BY sr."createdAt" DESC
       LIMIT 200`
    )

    return NextResponse.json({
      status,
      count: rows.length,
      requests: rows.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        builderName: r.builderName,
        assignedPMId: r.assignedPMId,
        originalAllocationId: r.originalAllocationId,
        originalProductId: r.originalProductId,
        originalSku: r.originalSku,
        originalName: r.originalName,
        substituteProductId: r.substituteProductId,
        substituteSku: r.substituteSku,
        substituteName: r.substituteName,
        compatibility: r.compatibility,
        conditions: r.conditions,
        priceDelta: r.priceDelta == null ? null : Number(r.priceDelta),
        quantity: Number(r.quantity),
        requestedById: r.requestedById,
        requesterName:
          `${r.requesterFirstName ?? ''} ${r.requesterLastName ?? ''}`.trim() ||
          null,
        requesterEmail: r.requesterEmail,
        reason: r.reason,
        status: r.status,
        approvedById: r.approvedById,
        approvedAt: r.approvedAt,
        rejectionNote: r.rejectionNote,
        createdAt: r.createdAt,
        appliedAt: r.appliedAt,
      })),
    })
  } catch (err: any) {
    console.error('[substitutions/requests GET]', err)
    return NextResponse.json(
      { error: 'Failed to load substitution requests', details: err?.message },
      { status: 500 }
    )
  }
}
