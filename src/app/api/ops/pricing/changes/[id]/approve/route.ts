// A-BIZ-9 — approve a queued price change.
//
// POST /api/ops/pricing/changes/:id/approve
// Body (optional): { overridePrice?: number, notes?: string }
//
// Effect:
//   1. Verify the request is PENDING (idempotent: re-approve = 409).
//   2. Update Product.basePrice to overridePrice ?? suggestedPrice.
//   3. Mark the row APPROVED with reviewerId/reviewedAt.
//   4. Audit (severity WARN — pricing change is material).
//
// Auth: ADMIN | MANAGER | ACCOUNTING — only people authorized to commit
// pricing decisions. PURCHASING can see the queue but cannot approve.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface ApproveBody {
  overridePrice?: number
  notes?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'] as any,
  })
  if (auth.error) return auth.error

  const id = params.id
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  let body: ApproveBody = {}
  try {
    const json = await request.json().catch(() => ({}))
    if (json && typeof json === 'object') body = json as ApproveBody
  } catch {}

  const overridePrice =
    body.overridePrice != null && Number.isFinite(body.overridePrice) && body.overridePrice > 0
      ? Number(body.overridePrice)
      : undefined
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined

  try {
    const existing = await prisma.priceChangeRequest.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (existing.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Already ${existing.status.toLowerCase()}` },
        { status: 409 }
      )
    }

    const finalPrice = overridePrice ?? existing.suggestedPrice
    const finalMargin =
      finalPrice > 0 ? ((finalPrice - existing.newCost) / finalPrice) * 100 : 0

    // Apply atomically. Both updates must land or neither — otherwise the
    // queue and the catalog can drift.
    await prisma.$transaction([
      prisma.product.update({
        where: { id: existing.productId },
        data: { basePrice: finalPrice },
      }),
      prisma.priceChangeRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewerId: auth.session.staffId,
          reviewedAt: new Date(),
          // Stash the actual applied price + margin in notes so the audit
          // trail captures override decisions in the queue itself, not just
          // the AuditLog table.
          notes:
            (notes ? `${notes} | ` : '') +
            (overridePrice != null
              ? `Approved with override $${overridePrice.toFixed(2)} (margin ${finalMargin.toFixed(1)}%)`
              : `Approved at suggested price (margin ${finalMargin.toFixed(1)}%)`),
        },
      }),
    ])

    await audit(
      request,
      'PRICE_CHANGE_APPROVE',
      'PriceChangeRequest',
      id,
      {
        productId: existing.productId,
        oldCost: existing.oldCost,
        newCost: existing.newCost,
        oldPrice: existing.oldPrice,
        suggestedPrice: existing.suggestedPrice,
        appliedPrice: finalPrice,
        overridden: overridePrice != null,
        marginPct: finalMargin,
        triggerSource: existing.triggerSource,
      },
      'WARN'
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      id,
      productId: existing.productId,
      appliedPrice: finalPrice,
      marginPct: finalMargin,
    })
  } catch (e: any) {
    console.error('[pricing/changes approve] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to approve' },
      { status: 500 }
    )
  }
}
