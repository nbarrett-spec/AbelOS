export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { ensureSubstitutionRequestTable } from '@/lib/substitution-requests'
import { sendSubstitutionDecisionEmail } from '@/lib/email/substitution-approved'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/substitutions/requests/[id]/reject
//
// Rejects a PENDING SubstitutionRequest. No allocation moves; the requester
// is notified by email with the rejection note so they can pick a different
// sub (or talk to the approver).
//
// Role gate: ADMIN, MANAGER, or PROJECT_MANAGER.
//
// Body: { note: string }   // required — rejection reason, shown to requester
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const note = (body.note ?? '').trim()
  if (!note) {
    return NextResponse.json(
      { error: 'note is required when rejecting a substitution request' },
      { status: 400 }
    )
  }

  try {
    await ensureSubstitutionRequestTable()

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT sr.id, sr."jobId", sr."originalProductId", sr."substituteProductId",
              sr.quantity, sr.status, sr."requestedById",
              po.sku AS "originalSku",
              ps.sku AS "substituteSku",
              j."jobNumber",
              rs.email AS "requesterEmail",
              rs."firstName" AS "requesterFirstName"
         FROM "SubstitutionRequest" sr
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
          error: `Request is ${req_.status} — only PENDING requests can be rejected`,
        },
        { status: 409 }
      )
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "SubstitutionRequest"
          SET status = 'REJECTED',
              "approvedById" = $2,
              "approvedAt" = NOW(),
              "rejectionNote" = $3
        WHERE id = $1`,
      id,
      approverId,
      note
    )

    // Notify requester (non-fatal)
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
          decision: 'REJECTED',
          decidedByName: approverName,
          decisionNote: note,
          newAllocationId: null,
        })
      }
    } catch (emailErr) {
      console.warn(
        '[substitutions/requests/reject] requester email failed:',
        emailErr
      )
    }

    return NextResponse.json({
      ok: true,
      requestId: id,
      status: 'REJECTED',
    })
  } catch (err: any) {
    console.error('[substitutions/requests/reject POST]', err)
    return NextResponse.json(
      { error: 'Failed to reject substitution', details: err?.message },
      { status: 500 }
    )
  }
}
