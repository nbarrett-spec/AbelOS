// A-BIZ-9 — reject a queued price change.
//
// POST /api/ops/pricing/changes/:id/reject
// Body: { reason: string }   (required, non-empty)
//
// Effect:
//   1. Verify request is PENDING.
//   2. Mark REJECTED with reason in `notes`, reviewerId, reviewedAt.
//   3. Leave Product.basePrice untouched.
//   4. Audit (severity INFO — reject is the no-op outcome).
//
// Auth: ADMIN | MANAGER | ACCOUNTING.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface RejectBody {
  reason?: string
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

  let body: RejectBody = {}
  try {
    body = (await request.json().catch(() => ({}))) as RejectBody
  } catch {}

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json(
      { error: 'reason is required' },
      { status: 400 }
    )
  }

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

    await prisma.priceChangeRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewerId: auth.session.staffId,
        reviewedAt: new Date(),
        notes: reason.slice(0, 1000),
      },
    })

    await audit(
      request,
      'PRICE_CHANGE_REJECT',
      'PriceChangeRequest',
      id,
      {
        productId: existing.productId,
        oldCost: existing.oldCost,
        newCost: existing.newCost,
        oldPrice: existing.oldPrice,
        rejectedSuggestion: existing.suggestedPrice,
        reason: reason.slice(0, 500),
        triggerSource: existing.triggerSource,
      },
      'INFO'
    ).catch(() => {})

    return NextResponse.json({ ok: true, id })
  } catch (e: any) {
    console.error('[pricing/changes reject] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to reject' },
      { status: 500 }
    )
  }
}
