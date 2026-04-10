export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/ops/migrate/fix-order-totals
 *
 * Fixes orders with $0 totals by recalculating from their line items.
 * During the InFlow import, some orders got lineTotal = 0 even though
 * the items had valid quantity and unitPrice. This recalculates:
 *   - OrderItem.lineTotal = quantity × unitPrice (if lineTotal is 0 but qty/price exist)
 *   - Order.subtotal = SUM(lineTotal)
 *   - Order.total = subtotal + taxAmount + shippingCost
 *
 * Safe to run multiple times.
 */
export async function POST(request: NextRequest) {
  try {
    const results: string[] = []
    let ordersFixed = 0
    let itemsFixed = 0

    // Find orders with $0 total that have line items
    const zeroOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o.id, o."orderNumber", o.total, o."taxAmount", o."shippingCost",
        COUNT(oi.id)::int as "itemCount"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o.total = 0 OR o.total IS NULL
      GROUP BY o.id
      HAVING COUNT(oi.id) > 0
    `)

    results.push(`Found ${zeroOrders.length} orders with $0 total that have line items`)

    for (const order of zeroOrders) {
      // Get line items for this order
      const items: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, quantity, "unitPrice", "lineTotal"
        FROM "OrderItem"
        WHERE "orderId" = $1
      `, order.id)

      let newSubtotal = 0
      let itemFixCount = 0

      for (const item of items) {
        const qty = Number(item.quantity) || 0
        const price = Number(item.unitPrice) || 0
        const currentLineTotal = Number(item.lineTotal) || 0

        if (currentLineTotal === 0 && qty > 0 && price > 0) {
          const correctLineTotal = qty * price
          await prisma.$executeRawUnsafe(`
            UPDATE "OrderItem" SET "lineTotal" = $1 WHERE id = $2
          `, correctLineTotal, item.id)
          newSubtotal += correctLineTotal
          itemFixCount++
        } else {
          newSubtotal += currentLineTotal
        }
      }

      if (newSubtotal > 0) {
        const taxAmount = Number(order.taxAmount) || 0
        const shippingCost = Number(order.shippingCost) || 0
        const newTotal = newSubtotal + taxAmount + shippingCost

        await prisma.$executeRawUnsafe(`
          UPDATE "Order"
          SET subtotal = $1, total = $2, "updatedAt" = NOW()
          WHERE id = $3
        `, newSubtotal, newTotal, order.id)

        ordersFixed++
        itemsFixed += itemFixCount
        results.push(`Fixed ${order.orderNumber}: ${items.length} items, new total = $${newTotal.toFixed(2)}`)
      }
    }

    // Also check for orders where subtotal/total don't match line item sums
    const mismatchOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o.id, o."orderNumber", o.total, o.subtotal, o."taxAmount", o."shippingCost",
        COALESCE(SUM(oi."lineTotal"), 0) as "itemsTotal",
        COUNT(oi.id)::int as "itemCount"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o.total > 0
      GROUP BY o.id
      HAVING ABS(o.subtotal - COALESCE(SUM(oi."lineTotal"), 0)) > 1
    `)

    results.push(`Found ${mismatchOrders.length} orders with subtotal/line-item mismatch (>$1 difference)`)

    return NextResponse.json({
      success: true,
      message: 'Order totals fix complete',
      ordersFixed,
      itemsFixed,
      mismatchOrders: mismatchOrders.length,
      results,
    })
  } catch (error: any) {
    console.error('Fix order totals error:', error)
    return NextResponse.json(
      { error: 'Failed to fix order totals', details: error.message },
      { status: 500 }
    )
  }
}
