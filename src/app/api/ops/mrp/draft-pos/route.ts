export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { runMrpProjection } from '@/lib/mrp'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/mrp/draft-pos
 *
 * Generate SmartPORecommendation rows for stockouts surfaced by the MRP projection.
 * Drops them into the existing approval channel — they appear in
 * /ops/procurement-intelligence and can be converted to DRAFT POs from there.
 *
 * Body:
 *   {
 *     vendorId?: string,           // limit to one preferred vendor
 *     productIds?: string[],       // limit to specific products
 *     horizonDays?: number,        // projection horizon (default 90)
 *     leadBufferDays?: number,     // default 3
 *     dryRun?: boolean             // return what would be created without writing
 *   }
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Mrp', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json().catch(() => ({}))
    const {
      vendorId,
      productIds,
      horizonDays = 90,
      leadBufferDays = 3,
      dryRun = false,
    } = body as {
      vendorId?: string
      productIds?: string[]
      horizonDays?: number
      leadBufferDays?: number
      dryRun?: boolean
    }

    const projection = await runMrpProjection({
      horizonDays,
      leadBufferDays,
      productIds: productIds && productIds.length > 0 ? productIds : undefined,
    })

    let stockouts = projection.products.filter((p) => p.stockoutDate !== null && p.preferredVendor)

    if (vendorId) {
      stockouts = stockouts.filter((p) => p.preferredVendor?.vendorId === vendorId)
    }

    if (stockouts.length === 0) {
      return NextResponse.json({
        created: 0,
        skipped: 0,
        dryRun,
        recommendations: [],
        message: 'No stockouts requiring action.',
      })
    }

    // Skip products that already have an open MRP recommendation
    const productIdList = stockouts.map((s) => s.productId)
    const existingRows = await prisma.$queryRawUnsafe<Array<{ productId: string }>>(
      `
      SELECT DISTINCT "productId"
      FROM "SmartPORecommendation"
      WHERE "productId" = ANY($1::text[])
        AND "status" = 'PENDING'
        AND "recommendationType" = 'MRP_FORWARD'
      `,
      productIdList
    )
    const existingSet = new Set(existingRows.map((r) => r.productId))

    const created: Array<Record<string, any>> = []
    let skipped = 0

    for (const item of stockouts) {
      if (existingSet.has(item.productId)) {
        skipped++
        continue
      }

      const vendor = item.preferredVendor!
      const recommendedQty = computeRecommendedQty(item)
      const estimatedCost = (vendor.vendorCost || 0) * recommendedQty
      const urgency = urgencyFromDays(item.daysUntilStockout)
      const orderByDate = computeOrderByDate(item.stockoutDate, vendor.leadTimeDays)

      const triggerReason =
        `MRP forecast: ${item.sku} projected to drop below safety stock on ` +
        `${item.stockoutDate} (in ${item.daysUntilStockout ?? '?'} days). ` +
        `Driving demand: ${item.drivingJobIds.length} active job(s). ` +
        `Recommended order qty: ${recommendedQty}.`

      const aiReasoning =
        `Time-phased projection over ${horizonDays} days using ${leadBufferDays}d lead buffer. ` +
        `Current onHand=${item.onHand}, committed=${item.committed}, ` +
        `totalDemand=${item.totalDemand}, totalInbound=${item.totalInbound}, ` +
        `endingBalance=${item.endingBalance}, shortfall=${item.shortfallQty}. ` +
        `Order via ${vendor.name} (lead ${vendor.leadTimeDays ?? '?'}d).`

      if (!dryRun) {
        const recId = `mrp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
        try {
          await prisma.$executeRawUnsafe(
            `
            INSERT INTO "SmartPORecommendation" (
              "id", "vendorId", "productId", "productCategory",
              "recommendationType", "urgency", "triggerReason",
              "recommendedQty", "estimatedCost", "estimatedSavings",
              "targetDeliveryDate", "orderByDate",
              "relatedJobIds", "relatedOrderIds",
              "status", "aiConfidence", "aiReasoning",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4,
              'MRP_FORWARD', $5, $6,
              $7, $8, 0,
              $9, $10,
              $11::jsonb, '[]'::jsonb,
              'PENDING', 0.85, $12,
              NOW(), NOW()
            )
            `,
            recId,
            vendor.vendorId,
            item.productId,
            item.category,
            urgency,
            triggerReason,
            recommendedQty,
            estimatedCost,
            item.stockoutDate ? new Date(item.stockoutDate) : null,
            orderByDate,
            JSON.stringify(item.drivingJobIds),
            aiReasoning
          )
        } catch (err: any) {
          console.warn('[mrp/draft-pos] insert failed for', item.productId, err?.message)
          continue
        }
      }

      created.push({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        vendorId: vendor.vendorId,
        vendorName: vendor.name,
        recommendedQty,
        estimatedCost: Math.round(estimatedCost * 100) / 100,
        urgency,
        stockoutDate: item.stockoutDate,
        orderByDate: orderByDate?.toISOString().slice(0, 10) ?? null,
        triggerReason,
      })
    }

    return NextResponse.json({
      created: created.length,
      skipped,
      dryRun,
      asOf: projection.asOf,
      totalEstimatedSpend: Math.round(
        created.reduce((sum, c) => sum + c.estimatedCost, 0) * 100
      ) / 100,
      recommendations: created,
    })
  } catch (error: any) {
    console.error('[mrp/draft-pos] error:', error)
    return NextResponse.json(
      { error: 'Failed to create draft POs', details: String(error?.message || error) },
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

function computeRecommendedQty(item: {
  shortfallQty: number
  reorderQty: number
  safetyStock: number
  preferredVendor: { minOrderQty: number } | null
}): number {
  // Cover the shortfall + a little safety + reorderQty if it's set
  const base = Math.max(
    item.shortfallQty + item.safetyStock,
    item.reorderQty || 0,
    1
  )
  const minOrder = item.preferredVendor?.minOrderQty ?? 1
  return Math.max(base, minOrder)
}

function computeOrderByDate(stockoutDate: string | null, leadTimeDays: number | null): Date {
  if (!stockoutDate) return new Date()
  const stockout = new Date(stockoutDate)
  const lead = leadTimeDays && leadTimeDays > 0 ? leadTimeDays : 14
  const orderBy = new Date(stockout)
  orderBy.setDate(orderBy.getDate() - lead)
  // Don't return a date in the past
  const now = new Date()
  return orderBy < now ? now : orderBy
}
