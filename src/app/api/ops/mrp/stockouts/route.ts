export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { runMrpProjection } from '@/lib/mrp'

/**
 * GET /api/ops/mrp/stockouts
 *
 * Returns only the products projected to go below safety stock within the horizon,
 * ordered by daysUntilStockout ascending.
 *
 * Labor / service / overhead products are excluded — MRP suggestions are only meaningful
 * for physical inventory. This is a stricter filter than auto-po (no opt-back-in).
 *
 * Query params:
 *   ?horizonDays=90
 *   ?leadBufferDays=3
 *   ?vendorId=xxx          (filter to one preferred vendor)
 *   ?urgency=CRITICAL|HIGH|NORMAL|LOW
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const horizonDays = parseInt(searchParams.get('horizonDays') || '90', 10)
    const leadBufferDays = parseInt(searchParams.get('leadBufferDays') || '3', 10)
    const vendorId = searchParams.get('vendorId')
    const urgencyFilter = searchParams.get('urgency')

    const projection = await runMrpProjection({ horizonDays, leadBufferDays })

    let stockouts = projection.products.filter((p) => p.stockoutDate !== null)

    // Exclude labor / service / overhead products. PHYSICAL or NULL only.
    if (stockouts.length > 0) {
      const candidateIds = stockouts.map((p) => p.productId)
      const physicalRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `
        SELECT "id"
        FROM "Product"
        WHERE "id" = ANY($1::text[])
          AND ("productType" = 'PHYSICAL' OR "productType" IS NULL)
        `,
        candidateIds
      )
      const physicalSet = new Set(physicalRows.map((r) => r.id))
      stockouts = stockouts.filter((p) => physicalSet.has(p.productId))
    }

    if (vendorId) {
      stockouts = stockouts.filter((p) => p.preferredVendor?.vendorId === vendorId)
    }

    const enriched = stockouts.map((p) => ({
      ...p,
      urgency: urgencyFromDays(p.daysUntilStockout),
      // Only return short summary schedule (sample every 7 days) to keep payload light
      schedule: p.schedule.filter((_, i) => i % 7 === 0 || i === p.schedule.length - 1),
    }))

    const filtered = urgencyFilter
      ? enriched.filter((p) => p.urgency === urgencyFilter)
      : enriched

    const summary = {
      total: filtered.length,
      critical: filtered.filter((p) => p.urgency === 'CRITICAL').length,
      high: filtered.filter((p) => p.urgency === 'HIGH').length,
      normal: filtered.filter((p) => p.urgency === 'NORMAL').length,
      low: filtered.filter((p) => p.urgency === 'LOW').length,
      estimatedReorderValue: filtered.reduce(
        (sum, p) =>
          sum + (p.preferredVendor?.vendorCost || 0) * Math.max(p.shortfallQty, p.reorderQty || 0),
        0
      ),
    }

    return NextResponse.json(
      {
        asOf: projection.asOf,
        horizonDays: projection.horizonDays,
        leadBufferDays: projection.leadBufferDays,
        unscheduledJobCount: projection.unscheduledJobCount,
        summary,
        stockouts: filtered,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, max-age=60' },
      }
    )
  } catch (error: any) {
    console.error('[mrp/stockouts] error:', error)
    return NextResponse.json(
      { error: 'Failed to compute stockouts', details: String(error?.message || error) },
      { status: 500 }
    )
  }
}

function urgencyFromDays(days: number | null): 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' {
  if (days === null) return 'LOW'
  if (days < 7) return 'CRITICAL'
  if (days < 14) return 'HIGH'
  if (days < 30) return 'NORMAL'
  return 'LOW'
}
