export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import {
  ensureSubstitutionRequestTable,
  runAllocationSwap,
} from '@/lib/substitution-requests'
import { sendSubstitutionDecisionEmail } from '@/lib/email/substitution-approved'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/substitutions/requests/[id]/approve
//
// Approves a PENDING SubstitutionRequest and runs the actual allocation
// swap — same transaction as the direct-apply path for IDENTICAL/COMPATIBLE
// subs. Transitions status PENDING → APPLIED and stamps approvedAt / appliedAt.
//
// Role gate: ADMIN, MANAGER, or PROJECT_MANAGER. A PM assigned to the job
// can always approve their own jobs; other PMs can still approve (same
// authority tier). If a stricter "only-my-jobs" rule is needed later, add a
// join on Job.assignedPMId.
//
// Body: { note?: string }   // optional note shown in the approved email
// ──────────────────────────────────────────────────────────────────────────

interface Body {
  note?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['PROJECT_MANAGER', 'MANAGER', 'ADMIN'],
  })
  if (auth.error) return auth.error
  const approverId = auth.session.staffId

  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'request id required' }, { status: 400 })
  }

  let body: Body = {}
  try {
    body = await request.json()
  } catch {
    // Body is optional
  }

  try {
    await ensureSubstitutionRequestTable()

    // Load the request + substitution metadata + job context.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         sr.id, sr."jobId", sr."originalAllocationId",
         sr."originalProductId", sr."substituteProductId",
         sr.quantity, sr.status, sr."requestedById",
         psub."substitutionType", psub."conditions",
         po.sku AS "originalSku",
         ps.sku AS "substituteSku",
         j."jobNumber",
         rs.email AS "requesterEmail",
         rs."firstName" AS "requesterFirstName"
       FROM "SubstitutionRequest" sr
       LEFT JOIN "ProductSubstitution" psub
              ON psub."primaryProductId"    = sr."originalProductId"
             AND psub."substituteProductId" = sr."substituteProductId"
             AND psub.active = true
       LEFT JOIN "Product" po ON po.id = sr."originalProductId"
       LEFT JOIN "Product" ps ON ps.id = sr."substituteProductId"
       LEFT JOIN "Job"     j  ON j.id  = sr."jobId"
       LEFT JOIN "Staff"   rs ON rs.id = sr."requestedById"
       WHERE sr.id = $1
       LIMIT 1`,
      id
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    const req_ = rows[0]
    if (req_.status !== 'PENDING') {
      return NextResponse.json(
        {
          error: `Request is ${req_.status} — only PENDING requests can be approved`,
        },
        { status: 409 }
      )
    }

    const noteSuffix = `${req_.substitutionType ?? 'CONDITIONAL'}${
      req_.conditions ? ` — ${req_.conditions}` : ''
    } — approved by ${approverId}`

    // Run the swap + flip the request status atomically.
    const result = await prisma.$transaction(async (tx) => {
      const swap = await runAllocationSwap(tx, {
        originalProductId: req_.originalProductId,
        substituteProductId: req_.substituteProductId,
        jobId: req_.jobId,
        quantity: Number(req_.quantity),
        allocationId: req_.originalAllocationId ?? null,
        staffId: approverId,
        noteSuffix,
      })

      await tx.$executeRawUnsafe(
        `UPDATE "SubstitutionRequest"
            SET status = 'APPLIED',
                "approvedById" = $2,
                "approvedAt" = NOW(),
                "appliedAt" = NOW()
          WHERE id = $1`,
        id,
        approverId
      )

      return swap
    })

    // Notify the requester (non-fatal)
    try {
      if (req_.requesterEmail) {
        const approverRow: any[] = await prisma.$queryRawUnsafe(
          `SELECT "firstName", "lastName" FROM "Staff" WHERE id = $1 LIMIT 1`,
          approverId
        )
        const approverName =
          approverRow.length > 0
            ? `${approverRow[0].firstName ?? ''} ${
                approverRow[0].lastName ?? ''
              }`.trim() || 'A manager'
            : 'A manager'
        await sendSubstitutionDecisionEmail({
          to: req_.requesterEmail,
          recipientFirstName: req_.requesterFirstName || 'there',
          requestId: id,
          jobId: req_.jobId,
          jobNumber: req_.jobNumber ?? req_.jobId,
          originalSku: req_.originalSku ?? null,
          substituteSku: req_.substituteSku ?? null,
          quantity: Number(req_.quantity),
          decision: 'APPROVED',
          decidedByName: approverName,
          decisionNote: body.note ?? null,
          newAllocationId: result.newAllocation.id,
        })
      }
    } catch (emailErr) {
      console.warn(
        '[substitutions/requests/approve] requester email failed:',
        emailErr
      )
    }

    return NextResponse.json({
      ok: true,
      requestId: id,
      status: 'APPLIED',
      ...result,
    })
  } catch (err: any) {
    console.error('[substitutions/requests/approve POST]', err)
    return NextResponse.json(
      { error: 'Failed to approve substitution', details: err?.message },
      { status: 500 }
    )
  }
}
