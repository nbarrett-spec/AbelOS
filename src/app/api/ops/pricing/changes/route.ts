// A-BIZ-9 — list endpoint for the price-change review queue.
//
// GET /api/ops/pricing/changes?status=PENDING
//
// Auth: ADMIN | MANAGER | ACCOUNTING | PURCHASING | SALES_REP
//   - PURCHASING is the role that triggers cost updates (vendor uploads)
//   - ACCOUNTING owns margin
//   - SALES_REP needs visibility for builder pricing impact
//
// Returns: { items: ChangeRow[], total }
//   ChangeRow joins the Product so the UI can show SKU/name/category
//   without a second round-trip per row.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

const ALLOWED_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED'])

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PURCHASING', 'SALES_REP'] as any,
  })
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const statusRaw = (searchParams.get('status') || 'PENDING').toUpperCase()
  const status = ALLOWED_STATUSES.has(statusRaw) ? statusRaw : 'PENDING'
  const take = Math.min(parseInt(searchParams.get('take') || '100'), 500)
  const skip = Math.max(parseInt(searchParams.get('skip') || '0'), 0)

  try {
    const [requests, total] = await Promise.all([
      prisma.priceChangeRequest.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.priceChangeRequest.count({ where: { status } }),
    ])

    // Pull product detail in one query, not N. Empty `requests` short-circuits.
    const productIds = Array.from(new Set(requests.map(r => r.productId)))
    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, name: true, category: true },
        })
      : []
    const productMap = new Map(products.map(p => [p.id, p]))

    const items = requests.map(r => {
      const p = productMap.get(r.productId)
      const costDeltaPct =
        r.oldCost > 0 ? ((r.newCost - r.oldCost) / r.oldCost) * 100 : 0
      const priceDeltaPct =
        r.oldPrice > 0
          ? ((r.suggestedPrice - r.oldPrice) / r.oldPrice) * 100
          : 0
      return {
        id: r.id,
        productId: r.productId,
        sku: p?.sku ?? null,
        name: p?.name ?? null,
        category: p?.category ?? null,
        oldCost: r.oldCost,
        newCost: r.newCost,
        oldPrice: r.oldPrice,
        suggestedPrice: r.suggestedPrice,
        marginPct: r.marginPct,
        costDeltaPct,
        priceDeltaPct,
        status: r.status,
        triggerSource: r.triggerSource,
        reviewerId: r.reviewerId,
        reviewedAt: r.reviewedAt,
        notes: r.notes,
        createdAt: r.createdAt,
      }
    })

    return NextResponse.json({ items, total, status, take, skip })
  } catch (e: any) {
    console.error('[pricing/changes GET] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Failed to load price-change requests' },
      { status: 500 }
    )
  }
}
