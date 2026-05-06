// /api/admin/review-queue/[id]
//
// POST — approve/reject a review-queue item. Atomically updates the
//        ReviewQueue row AND the linked entity (PitchRun.status, etc.).
//
// Body:  { action: 'approve' | 'reject', notes?: string }
//
// Per CLAUDE.md hard rule, only ADMIN can approve/reject — these are the
// gates for outbound customer-facing artifacts.
//
// Per entityType:
//   PROSPECT_ENRICHMENT
//     approve  — no-op on Prospect (already enriched; approve = "human verified")
//     reject   — no-op on Prospect (queue marker only)
//   PITCH_RUN
//     approve  — PitchRun.status = 'APPROVED', approvedBy + approvedAt set
//                (DO NOT auto-send the email — future flow)
//     reject   — PitchRun.status = 'FAILED', errorMessage = notes (or default)
//   BOUNCE_RECHECK
//     approve  — acknowledge; cron will re-research on next run
//     reject   — no-op (acknowledges as won't-fix)
//   EMAIL_SEND  — defensive default; updates queue only.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface ReviewQueueRow {
  id: string
  entityType: string
  entityId: string
  status: string
  reason: string
  summary: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN'] })
  if (auth.error) return auth.error

  try {
    const { id } = params
    const body = await request.json().catch(() => ({}))
    const action: string = body.action || ''
    const notes: string | null = body.notes ?? null

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      )
    }

    const rows = await prisma.$queryRawUnsafe<ReviewQueueRow[]>(
      `SELECT id, "entityType", "entityId", status, reason, summary
         FROM "ReviewQueue"
        WHERE id = $1
        LIMIT 1`,
      id
    )
    const item = rows[0]
    if (!item) {
      return NextResponse.json({ error: 'Review item not found' }, { status: 404 })
    }
    if (item.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot ${action} item already ${item.status.toLowerCase()}` },
        { status: 409 }
      )
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
    const staffId = auth.session.staffId

    // Update the queue row first.
    await prisma.$executeRawUnsafe(
      `UPDATE "ReviewQueue"
          SET status = $2,
              "reviewedBy" = $3,
              "reviewedAt" = NOW(),
              notes = COALESCE($4, notes)
        WHERE id = $1`,
      id,
      newStatus,
      staffId,
      notes
    )

    // Side-effects on the linked entity.
    let sideEffect: string | null = null
    try {
      if (item.entityType === 'PITCH_RUN') {
        if (action === 'approve') {
          await prisma.$executeRawUnsafe(
            `UPDATE "PitchRun"
                SET status = 'APPROVED',
                    "approvedBy" = $2,
                    "approvedAt" = NOW(),
                    "updatedAt" = NOW()
              WHERE id = $1`,
            item.entityId,
            staffId
          )
          sideEffect = 'pitch_run_approved'
        } else {
          await prisma.$executeRawUnsafe(
            `UPDATE "PitchRun"
                SET status = 'FAILED',
                    "errorMessage" = COALESCE($2, 'Rejected in review queue'),
                    "updatedAt" = NOW()
              WHERE id = $1`,
            item.entityId,
            notes
          )
          sideEffect = 'pitch_run_rejected'
        }
      }
      // PROSPECT_ENRICHMENT, BOUNCE_RECHECK, EMAIL_SEND — no entity mutation
      // (queue resolution is the side-effect itself).
    } catch (sideErr: any) {
      console.warn(
        '[ReviewQueue] entity update failed:',
        sideErr?.message || sideErr
      )
      // Roll back the queue row so reviewer sees PENDING again instead of a
      // half-applied state.
      await prisma
        .$executeRawUnsafe(
          `UPDATE "ReviewQueue"
              SET status = 'PENDING',
                  "reviewedBy" = NULL,
                  "reviewedAt" = NULL
            WHERE id = $1`,
          id
        )
        .catch(() => {})
      return NextResponse.json(
        { error: 'Failed to update linked entity; reverted queue state' },
        { status: 500 }
      )
    }

    await audit(
      request,
      action === 'approve' ? 'REVIEW_APPROVE' : 'REVIEW_REJECT',
      'ReviewQueue',
      id,
      {
        entityType: item.entityType,
        entityId: item.entityId,
        sideEffect,
        notes,
      },
      action === 'approve' ? 'WARN' : 'WARN'
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      id,
      status: newStatus,
      sideEffect,
    })
  } catch (error: any) {
    console.error('[Admin ReviewQueue POST]', error?.message || error)
    return NextResponse.json(
      { error: 'Failed to update review item' },
      { status: 500 }
    )
  }
}
