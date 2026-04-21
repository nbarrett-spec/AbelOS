export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/mrp/demand-heatmap
 *
 * Returns a SKU × next-N-weeks grid of required quantities. Demand is derived
 * from Order.deliveryDate rolled up to ISO week buckets.
 *
 * Query params:
 *   ?weeks=8        (default 8)
 *   ?limit=40       (max SKUs returned; sorted by total demand DESC)
 *   ?category=...   (optional single-category filter)
 *
 * Keeps payload tight — we only ship the grid of integers + metadata the
 * front end needs to paint cells. Cell color intensity is computed client-side
 * against maxCellValue.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const weeks = Math.max(2, Math.min(26, parseInt(searchParams.get('weeks') || '8', 10)))
    const limit = Math.max(10, Math.min(200, parseInt(searchParams.get('limit') || '40', 10)))
    const category = searchParams.get('category')

    // Anchor on Monday of "this week" in UTC
    const now = new Date()
    const dow = now.getUTCDay() // 0 Sun..6 Sat
    const daysFromMonday = dow === 0 ? 6 : dow - 1
    const weekStart0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday))
    const horizonEnd = new Date(weekStart0.getTime() + weeks * 7 * 24 * 60 * 60 * 1000)

    // Pull orders that have a delivery in the horizon
    const orders = await prisma.order.findMany({
      where: {
        deliveryDate: { gte: weekStart0, lt: horizonEnd },
        status: { notIn: ['CANCELLED', 'COMPLETE'] },
      },
      select: {
        id: true,
        deliveryDate: true,
        items: {
          select: {
            quantity: true,
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                category: true,
              },
            },
          },
        },
      },
    })

    // Bucket by (productId, weekIndex)
    const productMap = new Map<
      string,
      { sku: string; name: string; category: string | null; buckets: number[]; total: number }
    >()

    for (const o of orders) {
      if (!o.deliveryDate) continue
      const weekIndex = Math.floor(
        (o.deliveryDate.getTime() - weekStart0.getTime()) / (7 * 24 * 60 * 60 * 1000)
      )
      if (weekIndex < 0 || weekIndex >= weeks) continue
      for (const it of o.items) {
        if (!it.product) continue
        if (category && it.product.category !== category) continue
        const key = it.product.id
        let row = productMap.get(key)
        if (!row) {
          row = {
            sku: it.product.sku,
            name: it.product.name,
            category: it.product.category,
            buckets: new Array(weeks).fill(0),
            total: 0,
          }
          productMap.set(key, row)
        }
        row.buckets[weekIndex] += it.quantity
        row.total += it.quantity
      }
    }

    const rows = Array.from(productMap.entries())
      .map(([productId, r]) => ({ productId, ...r }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)

    const maxCellValue = rows.reduce(
      (max, r) => Math.max(max, ...r.buckets),
      0
    )

    const weekLabels: string[] = []
    for (let i = 0; i < weeks; i++) {
      const d = new Date(weekStart0.getTime() + i * 7 * 24 * 60 * 60 * 1000)
      // "Apr 20"
      weekLabels.push(
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      )
    }

    return NextResponse.json({
      asOf: new Date().toISOString(),
      weekStart: weekStart0.toISOString(),
      weeks,
      weekLabels,
      maxCellValue,
      rows,
      totalSkus: productMap.size,
    })
  } catch (err: any) {
    console.error('[mrp demand-heatmap] error', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to build demand heatmap' },
      { status: 500 }
    )
  }
}
